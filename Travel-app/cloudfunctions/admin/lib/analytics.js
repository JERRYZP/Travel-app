/** 提醒事件按景点聚合成每日永久汇总。 */
const time = require('./time');
const { EVENT_TYPES, METRIC_TYPES } = require('./schema');

function unique(list) {
  return [...new Set((list || []).filter(v => v !== null && v !== undefined && v !== ''))];
}

function eventOnDate(date, dateKey) {
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) && time.toDateStr(new Date(date)) === dateKey;
}

function groupDayEvents(events) {
  const bySpot = new Map();
  for (const event of (events || [])) {
    const spotId = event.spotId || 'unknown';
    if (!bySpot.has(spotId)) bySpot.set(spotId, []);
    bySpot.get(spotId).push(event);
  }
  return bySpot;
}

function buildDailyStatDocs(events, dateKey) {
  const bySpot = groupDayEvents(events);
  const docs = [];

  for (const [spotId, spotRows] of bySpot.entries()) {
    const created = unique(spotRows
      .filter(e => e.eventType === EVENT_TYPES.TASK_CREATED && eventOnDate(e.eventAt, dateKey))
      .map(e => e.taskId));
    const rebuilt = unique(spotRows
      .filter(e => e.eventType === EVENT_TYPES.TASK_REBUILT && eventOnDate(e.eventAt, dateKey))
      .map(e => e.taskId));
    const canceled = unique(spotRows
      .filter(e => e.eventType === EVENT_TYPES.TASK_CANCELED && eventOnDate(e.eventAt, dateKey))
      .map(e => e.taskId));
    const due = unique(spotRows
      .filter(e => eventOnDate(e.releaseAt, dateKey))
      .map(e => e.taskId));
    const triggered = unique(spotRows
      .filter(e => e.eventType === EVENT_TYPES.TASK_TRIGGERED && eventOnDate(e.releaseAt, dateKey))
      .map(e => e.taskId));
    const missed = unique(spotRows
      .filter(e => e.eventType === EVENT_TYPES.TASK_MISSED && eventOnDate(e.releaseAt, dateKey))
      .map(e => e.taskId));
    const sendSuccess = spotRows.filter(e =>
      e.eventType === EVENT_TYPES.SEND_SUCCEEDED && eventOnDate(e.eventAt, dateKey)).length;
    const sendFailed = spotRows.filter(e =>
      e.eventType === EVENT_TYPES.SEND_FAILED && eventOnDate(e.eventAt, dateKey)).length;
    const sendSkipped = spotRows.filter(e =>
      e.eventType === EVENT_TYPES.SEND_SKIPPED && eventOnDate(e.eventAt, dateKey)).length;

    docs.push({
      dateKey,
      metricType: METRIC_TYPES.CREATED,
      spotId,
      counts: {
        taskCreatedCount: created.length,
        taskRebuiltCount: rebuilt.length,
        taskCanceledCount: canceled.length,
        distinctCreatedUserCount: unique(spotRows
          .filter(e => e.eventType === EVENT_TYPES.TASK_CREATED && eventOnDate(e.eventAt, dateKey))
          .map(e => e.userId)).length,
      },
    });
    docs.push({
      dateKey,
      metricType: METRIC_TYPES.DUE,
      spotId,
      counts: {
        dueTaskCount: due.length,
        triggeredTaskCount: triggered.length,
        missedTaskCount: missed.length,
      },
    });
    docs.push({
      dateKey,
      metricType: METRIC_TYPES.DELIVERY,
      spotId,
      counts: {
        sendSuccessCount: sendSuccess,
        sendFailureCount: sendFailed,
        sendSkippedCount: sendSkipped,
      },
    });
  }
  return docs;
}

module.exports = { buildDailyStatDocs };
