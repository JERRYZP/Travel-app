/**
 * 行程窗口：用户可编辑的展示 / 分享边界。
 *
 * `trips.startDate/endDate` 仍表示提醒数据的实际覆盖范围；
 * 手动编辑后的 `windowStartDate/windowEndDate` 只影响首页标识与分享投影。
 * 老数据没有窗口字段时回退到实际覆盖范围，不需要迁移。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  return DATE_RE.test(String(value || ''));
}

function windowOf(trip) {
  const fallbackStart = validDate(trip && trip.startDate) ? trip.startDate : '';
  const fallbackEnd = validDate(trip && trip.endDate) ? trip.endDate : '';
  const startDate = validDate(trip && trip.windowStartDate)
    ? trip.windowStartDate
    : fallbackStart;
  const endDate = validDate(trip && trip.windowEndDate)
    ? trip.windowEndDate
    : fallbackEnd;
  return {
    startDate,
    endDate,
    explicit: validDate(trip && trip.windowStartDate) && validDate(trip && trip.windowEndDate),
  };
}

function effectiveEndDateOf(trip) {
  const window = windowOf(trip);
  const candidates = [trip && trip.endDate, window.endDate].filter(Boolean);
  return candidates.sort().pop() || '';
}

function positionOf(visitDate, window) {
  const date = String(visitDate || '');
  if (!date || !window || !window.startDate || !window.endDate) return 'INSIDE';
  if (date < window.startDate) return 'BEFORE';
  if (date > window.endDate) return 'AFTER';
  return 'INSIDE';
}

function inWindow(visitDate, window) {
  return positionOf(visitDate, window) === 'INSIDE';
}

function versionOf(value) {
  if (!value) return '';
  if (value instanceof Date) return String(value.getTime());
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? String(ms) : String(value);
}

function versionOfTrip(trip) {
  return versionOf(trip && (trip.windowUpdatedAt || trip.updatedAt));
}

module.exports = {
  validDate,
  windowOf,
  effectiveEndDateOf,
  positionOf,
  inWindow,
  versionOf,
  versionOfTrip,
};
