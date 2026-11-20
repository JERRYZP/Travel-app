/** 内部事件维护：日汇总、事件补录和过期清理。 */
const { COLLECTIONS, EVENT_TYPES, ok } = require('./schema');
const time = require('./time');
const analytics = require('./analytics');

const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_PAGE_SIZE = 100;
const QUERY_MAX_ROWS = 10000;

function isTimerInvocation(event = {}, env = process.env) {
  return env.TRIGGER_SRC === 'timer'
    || event.Type === 'Timer'
    || event.type === 'timer'
    || event.TriggerName === 'adminDailyRollup';
}

async function fetchAll(query, maxRows = QUERY_MAX_ROWS) {
  const rows = [];
  let skip = 0;
  while (rows.length < maxRows) {
    const res = await query.skip(skip).limit(QUERY_PAGE_SIZE).get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < QUERY_PAGE_SIZE) break;
    skip += QUERY_PAGE_SIZE;
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length >= maxRows };
}

function mergeUniqueRows(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row._id || row.eventKey, row);
  return [...map.values()];
}

async function loadEventsForRange(db, startDate, endDate) {
  const _ = db.command;
  const start = time.dayStart(startDate);
  const end = time.nextDayStart(endDate);
  const byEventAt = db.collection(COLLECTIONS.REMINDER_EVENTS)
    .where({ eventAt: _.gte(start).and(_.lt(end)) })
    .orderBy('eventAt', 'desc');
  const byReleaseAt = db.collection(COLLECTIONS.REMINDER_EVENTS)
    .where({ releaseAt: _.gte(start).and(_.lt(end)) })
    .orderBy('releaseAt', 'desc');
  const results = await Promise.all([
    fetchAll(byEventAt).catch(() => ({ rows: [], truncated: false })),
    fetchAll(byReleaseAt).catch(() => ({ rows: [], truncated: false })),
  ]);
  return {
    rows: mergeUniqueRows(results[0].rows.concat(results[1].rows)),
    truncated: results.some(r => r.truncated),
  };
}

async function upsertDailyStat(db, doc) {
  const exist = await db.collection(COLLECTIONS.DAILY_STATS)
    .where({ dateKey: doc.dateKey, metricType: doc.metricType, spotId: doc.spotId })
    .limit(1)
    .get();
  const data = Object.assign({}, doc, { refreshedAt: new Date() });
  if ((exist.data || []).length) {
    await db.collection(COLLECTIONS.DAILY_STATS).doc(exist.data[0]._id).update({ data });
  } else {
    await db.collection(COLLECTIONS.DAILY_STATS).add({ data });
  }
  return 1;
}

function taskEventSnapshot(task, eventType, eventAt) {
  return {
    eventKey: `${task._id}:${eventType}`,
    eventType,
    eventAt,
    taskId: task._id,
    userId: task.userId || null,
    itemId: task.itemId || null,
    tripId: task.tripId || null,
    spotId: task.spotId || null,
    templateId: task.templateId || null,
    channel: (task.channels || [])[0] || null,
    offset: null,
    releaseAt: task.releaseAt || null,
    visitDate: task.visitDate || null,
    scheduledAt: null,
    result: eventType === EVENT_TYPES.TASK_TRIGGERED ? 'SUCCESS'
      : (eventType === EVENT_TYPES.TASK_MISSED ? 'FAILED' : null),
    errorCode: null,
    errorMessage: task.missedReason || task.lastSendError || null,
    source: 'admin.reconcile',
    expireAt: new Date(new Date(eventAt).getTime() + RETENTION_DAYS * DAY_MS),
  };
}

async function reconcileTaskEvents(db, startDate, endDate) {
  const _ = db.command;
  const start = time.dayStart(startDate);
  const end = time.nextDayStart(endDate);
  const taskRes = await fetchAll(
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ createdAt: _.gte(start).and(_.lt(end)) })
      .orderBy('createdAt', 'asc'),
    2000
  );
  const tasks = taskRes.rows;
  if (!tasks.length) return 0;

  const keys = [];
  tasks.forEach(t => {
    keys.push(`${t._id}:${EVENT_TYPES.TASK_CREATED}`);
    if (t.backendStatus === 'TRIGGERED') keys.push(`${t._id}:${EVENT_TYPES.TASK_TRIGGERED}`);
    if (t.backendStatus === 'MISSED') keys.push(`${t._id}:${EVENT_TYPES.TASK_MISSED}`);
  });
  const existing = new Set();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await db.collection(COLLECTIONS.REMINDER_EVENTS).where({ eventKey: _.in(chunk) }).get();
    (res.data || []).forEach(e => existing.add(e.eventKey));
  }

  let added = 0;
  for (const task of tasks) {
    const createdKey = `${task._id}:${EVENT_TYPES.TASK_CREATED}`;
    if (!existing.has(createdKey)) {
      await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
        data: taskEventSnapshot(task, EVENT_TYPES.TASK_CREATED, task.createdAt || new Date()),
      });
      added += 1;
    }
    if (task.backendStatus === 'TRIGGERED') {
      const key = `${task._id}:${EVENT_TYPES.TASK_TRIGGERED}`;
      if (!existing.has(key)) {
        await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
          data: taskEventSnapshot(task, EVENT_TYPES.TASK_TRIGGERED, task.triggeredAt || task.releaseAt || new Date()),
        });
        added += 1;
      }
    }
    if (task.backendStatus === 'MISSED') {
      const key = `${task._id}:${EVENT_TYPES.TASK_MISSED}`;
      if (!existing.has(key)) {
        const eventAt = task.lastSendErrorAt || task.releaseAt || task.createdAt || new Date();
        await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
          data: taskEventSnapshot(task, EVENT_TYPES.TASK_MISSED, eventAt),
        });
        added += 1;
      }
    }
  }
  return added;
}

async function cleanupExpired(db, nowTs = new Date()) {
  let removed = 0;
  for (const collection of [COLLECTIONS.REMINDER_EVENTS, COLLECTIONS.AUDIT_LOGS]) {
    try {
      const res = await db.collection(collection).where({ expireAt: db.command.lte(nowTs) }).limit(200).get();
      for (const doc of (res.data || [])) {
        await db.collection(collection).doc(doc._id).remove();
        removed += 1;
      }
    } catch (e) {
      console.error('[admin-maintenance] cleanup-failed', collection, e.message);
    }
  }
  return removed;
}

async function rollupDaily(db, params = {}, nowTs = new Date()) {
  const days = Math.min(30, Math.max(1, Number(params.days) || 7));
  const range = time.lastNDates(days, nowTs);
  let statDocs = 0;

  for (const dateKey of range.dates) {
    const loaded = await loadEventsForRange(db, dateKey, dateKey);
    const docs = analytics.buildDailyStatDocs(loaded.rows, dateKey);
    for (const doc of docs) statDocs += await upsertDailyStat(db, doc);
  }

  const reconciled = await reconcileTaskEvents(db, range.start, range.end);
  const cleaned = await cleanupExpired(db, nowTs);
  return ok({ range, statDocs, reconciled, cleaned });
}

module.exports = {
  isTimerInvocation,
  loadEventsForRange,
  buildDailyStatDocs: analytics.buildDailyStatDocs,
  rollupDaily,
  cleanupExpired,
};
