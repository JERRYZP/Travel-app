/**
 * 提醒事件账本写入（统计侧，best-effort）。
 *
 * 事件是运营统计与长期排障的追加式事实，不参与任务状态推导。
 * 任何写入失败都必须只记日志，不能阻断创建任务或发送提醒。
 */

const COLLECTION = 'reminder_events';
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function asDate(value, fallback = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

function expireAtOf(at) {
  return new Date(asDate(at).getTime() + RETENTION_DAYS * DAY_MS);
}

function baseEvent(task, eventType, at, extra = {}) {
  const eventAt = asDate(at);
  return Object.assign({
    eventKey: `${task._id}:${eventType}`,
    eventType,
    eventAt,
    taskId: task._id || null,
    userId: task.userId || null,
    itemId: task.itemId || null,
    tripId: task.tripId || null,
    spotId: task.spotId || null,
    templateId: task.templateId || null,
    channel: (task.channels || [])[0] || null,
    offset: null,
    releaseAt: task.releaseAt ? asDate(task.releaseAt) : null,
    visitDate: task.visitDate || null,
    scheduledAt: null,
    result: null,
    errorCode: null,
    errorMessage: null,
    source: 'reminder',
    expireAt: expireAtOf(eventAt),
  }, extra);
}

function taskEvent(eventType, task, at, extra = {}) {
  return baseEvent(task, eventType, at, extra);
}

function sendEvent(task, offset, sendResult, at, extra = {}) {
  const eventType = sendResult.ok
    ? EVENT_TYPES.SEND_SUCCEEDED
    : (sendResult.skipped ? EVENT_TYPES.SEND_SKIPPED : EVENT_TYPES.SEND_FAILED);
  const eventAt = asDate(at);
  const stableKey = eventType === EVENT_TYPES.SEND_FAILED
    ? `${task._id}:${offset}:${eventType}:${eventAt.getTime()}`
    : `${task._id}:${offset}:${eventType}`;
  return baseEvent(task, eventType, eventAt, Object.assign({
    eventKey: stableKey,
    offset: Number(offset),
    scheduledAt: task.releaseAt
      ? new Date(asDate(task.releaseAt).getTime() - Number(offset) * 60 * 1000)
      : null,
    result: sendResult.ok ? 'SUCCESS' : (sendResult.skipped ? 'SKIPPED' : 'FAILED'),
    errorCode: sendResult.errCode == null ? null : Number(sendResult.errCode),
    errorMessage: sendResult.reason || null,
  }, extra));
}

async function recordEvent(db, event) {
  try {
    await db.collection(COLLECTION).add({ data: event });
    return true;
  } catch (err) {
    console.error('[reminder-events] write-failed', JSON.stringify({
      eventKey: event && event.eventKey,
      eventType: event && event.eventType,
      message: err && err.message,
    }));
    return false;
  }
}

async function recordEvents(db, list) {
  const events = (list || []).filter(Boolean);
  if (events.length === 0) return 0;
  const results = await Promise.all(events.map(event => recordEvent(db, event)));
  return results.filter(Boolean).length;
}

module.exports = {
  COLLECTION,
  RETENTION_DAYS,
  EVENT_TYPES,
  expireAtOf,
  taskEvent,
  sendEvent,
  recordEvent,
  recordEvents,
};
