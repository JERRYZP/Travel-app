/**
 * 客服工作台提醒质量统计。
 *
 * 这里只读 reminder_events / reminder_tasks，按北京时间自然日和任务聚合：
 * - 任务的所有 offset 都在计划时间后 120 秒内发送成功，才算准时；
 * - 未送达、跳过、终态或发送证据缺失都单独计数；
 * - 页面只消费服务端给出的状态，不重新推导阈值。
 */

const { COLLECTIONS, ok } = require('./schema');
const { beijingDayRange } = require('./admin-orders');

const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const WINDOW_HOURS = 8;
const BASELINE_DAYS = 5;
const DELAY_TOLERANCE_SECONDS = 120;
const ON_TIME_RATE_THRESHOLD = 99;
const PAGE_SIZE = 100;
const MAX_EVENT_ROWS = 20000;
const MAX_TASK_ROWS = 10000;

const EVENT_TYPES = {
  TASK_CREATED: 'TASK_CREATED',
  TASK_REBUILT: 'TASK_REBUILT',
  TASK_CANCELED: 'TASK_CANCELED',
  SEND_SUCCEEDED: 'SEND_SUCCEEDED',
  SEND_FAILED: 'SEND_FAILED',
  SEND_SKIPPED: 'SEND_SKIPPED',
  TASK_TRIGGERED: 'TASK_TRIGGERED',
  TASK_MISSED: 'TASK_MISSED',
};

const STATUS = {
  HEALTHY: 'HEALTHY',
  ALERT: 'ALERT',
  EMPTY: 'EMPTY',
};

function timestampOf(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function dateKeyOf(value) {
  const ts = timestampOf(value);
  return ts == null ? '' : beijingDayRange(new Date(ts)).dateKey;
}

function uniqueOffsets(events) {
  return [...new Set((events || [])
    .map(event => Number(event.offset))
    .filter(offset => Number.isFinite(offset)))];
}

async function fetchAll(query, maxRows) {
  const rows = [];
  let skip = 0;
  while (true) {
    const res = await query.skip(skip).limit(PAGE_SIZE).get();
    const batch = res.data || [];
    rows.push(...batch);
    if (rows.length >= maxRows) {
      return { rows: rows.slice(0, maxRows), truncated: true };
    }
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
    skip += batch.length;
  }
}

function rateTextValue(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function delayOfSuccess(event, releaseAt, offset) {
  const actualTs = timestampOf(event.eventAt);
  let scheduledTs = timestampOf(event.scheduledAt);
  if (scheduledTs == null) {
    const releaseTs = timestampOf(releaseAt);
    if (releaseTs != null && Number.isFinite(Number(offset))) {
      scheduledTs = releaseTs - Number(offset) * 60 * 1000;
    }
  }
  if (actualTs == null || scheduledTs == null) return null;
  return Math.max(0, actualTs - scheduledTs);
}

/**
 * 兼容事件账本上线前/漏写事件的已发送任务：
 * 任务已进入 TRIGGERED、sentOffsets 覆盖全部计划 offset 且存在 triggeredAt 时，
 * 用最后一次计划发送时间与 triggeredAt 计算延迟。没有完整任务证据仍计 UNKNOWN，
 * 不把缺失证据静默洗成准时。
 */
function delayOfTaskFallback(task, expectedOffsets) {
  if (!task || task.backendStatus !== 'TRIGGERED') return null;
  const sentOffsets = new Set((Array.isArray(task.sentOffsets) ? task.sentOffsets : [])
    .map(Number)
    .filter(Number.isFinite));
  if (!expectedOffsets.length || !expectedOffsets.every(offset => sentOffsets.has(offset))) {
    return null;
  }
  const triggeredTs = timestampOf(task.triggeredAt);
  const releaseTs = timestampOf(task.releaseAt);
  if (triggeredTs == null || releaseTs == null) return null;
  // offset 越大，计划发送越早；最后一次计划发送使用最小 offset。
  const finalOffset = Math.min(...expectedOffsets);
  const scheduledTs = releaseTs - finalOffset * 60 * 1000;
  return Math.max(0, triggeredTs - scheduledTs);
}

function classifyTask(task, events = []) {
  const types = new Set(events.map(event => event.eventType));
  const canceled = types.has(EVENT_TYPES.TASK_CANCELED);
  const terminal = types.has(EVENT_TYPES.TASK_TRIGGERED)
    || types.has(EVENT_TYPES.TASK_MISSED)
    || (task && ['TRIGGERED', 'MISSED'].includes(task.backendStatus));
  const sendEvents = events.filter(event =>
    event.eventType === EVENT_TYPES.SEND_SUCCEEDED
    || event.eventType === EVENT_TYPES.SEND_FAILED
    || event.eventType === EVENT_TYPES.SEND_SKIPPED);

  // 用户在首次发送前主动取消的任务不属于提醒质量分母。
  if (canceled && !terminal && sendEvents.length === 0) return null;

  if (types.has(EVENT_TYPES.TASK_MISSED)
    || (task && task.backendStatus === 'MISSED')) {
    return { outcome: 'missed', delayMs: null };
  }

  if (types.has(EVENT_TYPES.SEND_SKIPPED)) {
    return { outcome: 'skipped', delayMs: null };
  }

  if (!terminal) {
    return { outcome: 'unknown', delayMs: null };
  }

  const successEvents = events.filter(event =>
    event.eventType === EVENT_TYPES.SEND_SUCCEEDED);
  const expectedOffsets = task && Array.isArray(task.offsets) && task.offsets.length
    ? [...new Set(task.offsets.map(Number).filter(Number.isFinite))]
    : uniqueOffsets(sendEvents);
  const successByOffset = new Map();

  for (const event of successEvents) {
    const offset = Number(event.offset);
    if (!Number.isFinite(offset)) continue;
    const previous = successByOffset.get(offset);
    const previousTs = previous ? timestampOf(previous.eventAt) : null;
    const currentTs = timestampOf(event.eventAt);
    if (previousTs == null || (currentTs != null && currentTs < previousTs)) {
      successByOffset.set(offset, event);
    }
  }

  let delays = [];
  if (expectedOffsets.length) {
    if (successEvents.length) {
      if (!expectedOffsets.every(offset => successByOffset.has(offset))) {
        return { outcome: 'unknown', delayMs: null };
      }
      delays = expectedOffsets
        .map(offset => delayOfSuccess(
          successByOffset.get(offset),
          (task && task.releaseAt) || (successByOffset.get(offset) || {}).releaseAt,
          offset
        ));
    } else if (task) {
      const fallbackDelay = delayOfTaskFallback(task, expectedOffsets);
      if (fallbackDelay == null) return { outcome: 'unknown', delayMs: null };
      delays = [fallbackDelay];
    } else {
      return { outcome: 'unknown', delayMs: null };
    }
  } else if (successEvents.length) {
    delays = successEvents.map(event => delayOfSuccess(
      event,
      (task && task.releaseAt) || event.releaseAt,
      event.offset
    ));
  } else if (task) {
    const fallbackDelay = delayOfTaskFallback(task, expectedOffsets);
    if (fallbackDelay == null) return { outcome: 'unknown', delayMs: null };
    delays = [fallbackDelay];
  } else {
    return { outcome: 'unknown', delayMs: null };
  }

  if (!delays.length || delays.some(delay => delay == null)) {
    return { outcome: 'unknown', delayMs: null };
  }

  const maxDelayMs = Math.max(...delays);
  return {
    outcome: maxDelayMs <= DELAY_TOLERANCE_SECONDS * 1000 ? 'onTime' : 'late',
    delayMs: maxDelayMs,
  };
}

function isSupersededBeforeSend(entry, events, rebuilds) {
  if (entry.task || !entry.createdAt || !entry.itemId) return false;
  if (events.some(event => event.eventType === EVENT_TYPES.TASK_TRIGGERED
    || event.eventType === EVENT_TYPES.TASK_MISSED
    || event.eventType === EVENT_TYPES.SEND_SUCCEEDED
    || event.eventType === EVENT_TYPES.SEND_FAILED
    || event.eventType === EVENT_TYPES.SEND_SKIPPED)) {
    return false;
  }
  const createdTs = timestampOf(entry.createdAt);
  const releaseTs = timestampOf(entry.releaseAt);
  if (createdTs == null || releaseTs == null) return false;
  return (rebuilds || []).some(rebuild => {
    if (String(rebuild.taskId || '') === String(entry.taskId || '')) return false;
    const rebuiltTs = timestampOf(rebuild.eventAt);
    return rebuiltTs != null && rebuiltTs >= createdTs && rebuiltTs < releaseTs;
  });
}

function summarizeRecords(records = []) {
  const counts = {
    expectedCount: records.length,
    onTimeCount: 0,
    lateCount: 0,
    missedCount: 0,
    skippedCount: 0,
    unknownCount: 0,
  };
  for (const record of records) {
    if (record.outcome === 'onTime') counts.onTimeCount += 1;
    if (record.outcome === 'late') counts.lateCount += 1;
    if (record.outcome === 'missed') counts.missedCount += 1;
    if (record.outcome === 'skipped') counts.skippedCount += 1;
    if (record.outcome === 'unknown') counts.unknownCount += 1;
  }
  const onTimeRate = rateTextValue(counts.onTimeCount, counts.expectedCount);
  const reasonCodes = [];
  if (counts.missedCount) reasonCodes.push('MISSED');
  if (counts.skippedCount) reasonCodes.push('SKIPPED');
  if (counts.unknownCount) reasonCodes.push('UNKNOWN');
  if (onTimeRate != null && onTimeRate < ON_TIME_RATE_THRESHOLD) {
    reasonCodes.push('BELOW_THRESHOLD');
  }
  if (counts.lateCount) reasonCodes.push('LATE');
  return {
    ...counts,
    onTimeRate,
    reasonCodes,
  };
}

function statusOf(summary) {
  if (!summary.expectedCount) return STATUS.EMPTY;
  if (summary.onTimeRate != null && summary.onTimeRate < ON_TIME_RATE_THRESHOLD) {
    return STATUS.ALERT;
  }
  return STATUS.HEALTHY;
}

function beijingClock(value) {
  const shifted = new Date(timestampOf(value) + BEIJING_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

function relativeDateLabel(dateKey, today, yesterday) {
  if (dateKey === today.dateKey) return '今日';
  if (dateKey === yesterday.dateKey) return '昨日';
  const [, month, day] = String(dateKey).split('-').map(Number);
  return `${month}月${day}日`;
}

function beijingHour(value) {
  return new Date(timestampOf(value) + BEIJING_OFFSET_MS).getUTCHours();
}

function qualityWindow(nowTs = new Date()) {
  const today = beijingDayRange(nowTs);
  const yesterday = beijingDayRange(new Date(today.start.getTime() - DAY_MS / 2));
  const hour = beijingHour(nowTs);
  let start;
  let end;
  let nextUpdateAt;
  if (hour < 13) {
    start = new Date(today.start.getTime() + 13 * 60 * 60 * 1000 - DAY_MS);
    end = new Date(today.start.getTime() + 21 * 60 * 60 * 1000 - DAY_MS);
    nextUpdateAt = new Date(today.start.getTime() + 13 * 60 * 60 * 1000);
  } else if (hour < 21) {
    start = new Date(today.start.getTime() + 5 * 60 * 60 * 1000);
    end = new Date(today.start.getTime() + 13 * 60 * 60 * 1000);
    nextUpdateAt = new Date(today.start.getTime() + 21 * 60 * 60 * 1000);
  } else {
    start = new Date(today.start.getTime() + 13 * 60 * 60 * 1000);
    end = new Date(today.start.getTime() + 21 * 60 * 60 * 1000);
    nextUpdateAt = new Date(today.start.getTime() + DAY_MS + 13 * 60 * 60 * 1000);
  }
  const startDateKey = dateKeyOf(start);
  const endClock = beijingClock(end);
  return {
    start,
    end,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    nextUpdateAt: nextUpdateAt.toISOString(),
    dateKey: startDateKey,
    label: `${relativeDateLabel(startDateKey, today, yesterday)} ${beijingClock(start)}-${endClock === '00:00' ? '24:00' : endClock}`,
    updatedLabel: endClock,
  };
}

function qualityWindows(nowTs) {
  const today = beijingDayRange(nowTs);
  const yesterday = beijingDayRange(new Date(today.start.getTime() - DAY_MS / 2));
  const baselineStart = new Date(yesterday.start.getTime() - BASELINE_DAYS * DAY_MS);
  const currentWindow = qualityWindow(nowTs);
  const start = new Date(Math.min(baselineStart.getTime(), currentWindow.start.getTime()));
  const end = currentWindow.end;
  const baselineDates = [];
  for (let index = 0; index < BASELINE_DAYS; index += 1) {
    baselineDates.push(dateKeyOf(new Date(baselineStart.getTime() + index * DAY_MS + DAY_MS / 2)));
  }
  return {
    start,
    end,
    today,
    yesterday,
    currentWindow,
    baselineStartDate: baselineDates[0],
    baselineEndDate: baselineDates[baselineDates.length - 1],
    baselineDates,
  };
}

async function statsForAdmin(db, nowTs = new Date()) {
  const _ = db.command;
  const windows = qualityWindows(nowTs);
  const eventQuery = db.collection(COLLECTIONS.REMINDER_EVENTS)
    .where({ releaseAt: _.gte(windows.start).and(_.lt(windows.end)) })
    .orderBy('releaseAt', 'asc');
  const taskQuery = db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ releaseAt: _.gte(windows.start).and(_.lt(windows.end)) })
    .orderBy('releaseAt', 'asc');
  const [eventResult, taskResult] = await Promise.all([
    fetchAll(eventQuery, MAX_EVENT_ROWS),
    fetchAll(taskQuery, MAX_TASK_ROWS),
  ]);
  const dataTruncated = eventResult.truncated || taskResult.truncated;

  const tasksById = new Map();
  for (const task of taskResult.rows) {
    const id = String(task._id || '');
    if (id) tasksById.set(id, task);
  }

  const eventsByTask = new Map();
  const rebuildsByItem = new Map();
  const expected = new Map();
  for (const event of eventResult.rows) {
    const taskId = String(event.taskId || '');
    if (!taskId) continue;
    if (!eventsByTask.has(taskId)) eventsByTask.set(taskId, []);
    eventsByTask.get(taskId).push(event);
    if (event.eventType === EVENT_TYPES.TASK_CREATED
      || event.eventType === EVENT_TYPES.TASK_REBUILT) {
      expected.set(taskId, {
        taskId,
        itemId: event.itemId || null,
        createdAt: event.eventAt,
        releaseAt: event.releaseAt,
        task: tasksById.get(taskId) || null,
      });
    }
    if (event.eventType === EVENT_TYPES.TASK_REBUILT && event.itemId) {
      const itemId = String(event.itemId);
      if (!rebuildsByItem.has(itemId)) rebuildsByItem.set(itemId, []);
      rebuildsByItem.get(itemId).push(event);
    }
  }
  for (const [taskId, task] of tasksById.entries()) {
    if (!expected.has(taskId)) {
      expected.set(taskId, { taskId, releaseAt: task.releaseAt, task });
    }
  }

  const records = [];
  for (const entry of expected.values()) {
    const dateKey = dateKeyOf(entry.releaseAt);
    const taskEvents = eventsByTask.get(entry.taskId) || [];
    if (isSupersededBeforeSend(
      entry,
      taskEvents,
      rebuildsByItem.get(String(entry.itemId || '')) || []
    )) continue;
    const record = classifyTask(entry.task, taskEvents);
    if (!record) continue;
    records.push({
      ...record,
      dateKey,
      releaseAt: entry.releaseAt,
    });
  }

  const inRange = (value, start, end) => {
    const ts = timestampOf(value);
    return ts != null && ts >= start.getTime() && ts < end.getTime();
  };
  const windowRecords = records.filter(record => inRange(
    record.releaseAt,
    windows.currentWindow.start,
    windows.currentWindow.end
  ));
  const baselineRecords = records.filter(record =>
    windows.baselineDates.includes(record.dateKey));
  const windowSummary = summarizeRecords(windowRecords);
  const baselineSummary = summarizeRecords(baselineRecords);
  const baseline = {
    startDate: windows.baselineStartDate,
    endDate: windows.baselineEndDate,
    daysWithData: windows.baselineDates
      .filter(dateKey => records.some(record => record.dateKey === dateKey)).length,
    expectedCount: baselineSummary.expectedCount,
    onTimeRate: baselineSummary.onTimeRate,
  };

  const currentWindow = {
    ...windows.currentWindow,
    durationHours: WINDOW_HOURS,
    expectedCount: windowSummary.expectedCount,
    onTimeCount: windowSummary.onTimeCount,
    lateCount: windowSummary.lateCount,
    missedCount: windowSummary.missedCount,
    skippedCount: windowSummary.skippedCount,
    unknownCount: windowSummary.unknownCount,
    onTimeRate: windowSummary.onTimeRate,
    status: statusOf(windowSummary),
    reasonCodes: windowSummary.reasonCodes,
  };

  return ok({
    quality: {
      timezone: 'Asia/Shanghai',
      threshold: {
        onTimeRate: ON_TIME_RATE_THRESHOLD,
        delayToleranceSeconds: DELAY_TOLERANCE_SECONDS,
      },
      currentWindow,
      baseline5d: baseline,
      dataTruncated,
      generatedAt: new Date(nowTs).toISOString(),
    },
  });
}

module.exports = {
  EVENT_TYPES,
  STATUS,
  DELAY_TOLERANCE_SECONDS,
  ON_TIME_RATE_THRESHOLD,
  WINDOW_HOURS,
  classifyTask,
  summarizeRecords,
  statusOf,
  qualityWindow,
  qualityWindows,
  statsForAdmin,
};
