/** 事件聚合纯函数：概览、景点排行、每日永久汇总都共用同一口径。 */
const time = require('./time');
const { EVENT_TYPES, METRIC_TYPES } = require('./schema');

function unique(list) {
  return [...new Set((list || []).filter(v => v !== null && v !== undefined && v !== ''))];
}

function tsOf(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function inRange(value, start, endExclusive) {
  const ts = tsOf(value);
  return ts !== null && ts >= start.getTime() && ts < endExclusive.getTime();
}

function eventOnDate(date, dateKey) {
  return tsOf(date) !== null && time.toDateStr(new Date(date)) === dateKey;
}

function summarizeEvents(events, { startDate, endDate }) {
  const start = time.dayStart(startDate);
  const end = time.nextDayStart(endDate);
  const rows = events || [];

  const createdRows = rows.filter(e => e.eventType === EVENT_TYPES.TASK_CREATED && inRange(e.eventAt, start, end));
  const rebuiltRows = rows.filter(e => e.eventType === EVENT_TYPES.TASK_REBUILT && inRange(e.eventAt, start, end));
  const canceledRows = rows.filter(e => e.eventType === EVENT_TYPES.TASK_CANCELED && inRange(e.eventAt, start, end));
  const dueRows = rows.filter(e => inRange(e.releaseAt, start, end));
  const triggeredRows = rows.filter(e => e.eventType === EVENT_TYPES.TASK_TRIGGERED && inRange(e.releaseAt, start, end));
  const missedRows = rows.filter(e => e.eventType === EVENT_TYPES.TASK_MISSED && inRange(e.releaseAt, start, end));
  const successRows = rows.filter(e => e.eventType === EVENT_TYPES.SEND_SUCCEEDED && inRange(e.eventAt, start, end));
  const failedRows = rows.filter(e => e.eventType === EVENT_TYPES.SEND_FAILED && inRange(e.eventAt, start, end));
  const skippedRows = rows.filter(e => e.eventType === EVENT_TYPES.SEND_SKIPPED && inRange(e.eventAt, start, end));

  const dueTaskIds = unique(dueRows.map(e => e.taskId));
  const triggeredTaskIds = unique(triggeredRows.map(e => e.taskId));
  const missedTaskIds = unique(missedRows.map(e => e.taskId));
  const terminal = triggeredTaskIds.length + missedTaskIds.length;

  return {
    taskCreatedCount: unique(createdRows.map(e => e.taskId)).length,
    taskRebuiltCount: unique(rebuiltRows.map(e => e.taskId)).length,
    taskCanceledCount: unique(canceledRows.map(e => e.taskId)).length,
    distinctCreatedUserCount: unique(createdRows.map(e => e.userId)).length,
    dueTaskCount: dueTaskIds.length,
    triggeredTaskCount: triggeredTaskIds.length,
    missedTaskCount: missedTaskIds.length,
    sendSuccessCount: successRows.length,
    sendFailureCount: failedRows.length,
    sendSkippedCount: skippedRows.length,
    dueHandlingRate: time.rate(triggeredTaskIds.length, terminal),
    sendSuccessRate: time.rate(successRows.length, successRows.length + failedRows.length),
  };
}

function groupSpotEvents(events, range) {
  const bySpot = new Map();
  for (const event of (events || [])) {
    const spotId = event.spotId || 'unknown';
    if (!bySpot.has(spotId)) bySpot.set(spotId, []);
    bySpot.get(spotId).push(event);
  }
  return [...bySpot.entries()].map(([spotId, rows]) => Object.assign(
    { spotId },
    summarizeEvents(rows, range)
  )).sort((a, b) => b.taskCreatedCount - a.taskCreatedCount || b.dueTaskCount - a.dueTaskCount || a.spotId.localeCompare(b.spotId));
}

function groupDayEvents(events, dateKey) {
  const bySpot = new Map();
  for (const event of (events || [])) {
    const spotId = event.spotId || 'unknown';
    if (!bySpot.has(spotId)) bySpot.set(spotId, []);
    bySpot.get(spotId).push(event);
  }
  return bySpot;
}

function buildDailyStatDocs(events, dateKey) {
  const rows = events || [];
  const bySpot = groupDayEvents(rows, dateKey);
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

function mergeSummaryRows(rows) {
  const out = {
    taskCreatedCount: 0,
    taskRebuiltCount: 0,
    taskCanceledCount: 0,
    distinctCreatedUserCount: 0,
    dueTaskCount: 0,
    triggeredTaskCount: 0,
    missedTaskCount: 0,
    sendSuccessCount: 0,
    sendFailureCount: 0,
    sendSkippedCount: 0,
  };
  for (const row of rows || []) {
    for (const key of Object.keys(out)) out[key] += Number(row.counts && row.counts[key]) || Number(row[key]) || 0;
  }
  const terminal = out.triggeredTaskCount + out.missedTaskCount;
  out.dueHandlingRate = time.rate(out.triggeredTaskCount, terminal);
  out.sendSuccessRate = time.rate(out.sendSuccessCount, out.sendSuccessCount + out.sendFailureCount);
  return out;
}

module.exports = {
  unique,
  inRange,
  summarizeEvents,
  groupSpotEvents,
  buildDailyStatDocs,
  mergeSummaryRows,
};
