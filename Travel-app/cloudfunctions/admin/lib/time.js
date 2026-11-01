/** GMT+8 时间工具，行为与 reminder/lib/time.js 保持一致。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }
function now() { return new Date(); }

function beijingParts(date = now()) {
  const d = new Date(new Date(date).getTime() + BEIJING_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

function toDateStr(date = now()) {
  const p = beijingParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseBeijing(dateStr, timeStr = '00:00') {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - BEIJING_OFFSET_MS);
}

function addDays(dateStr, days) {
  return toDateStr(new Date(parseBeijing(dateStr, '00:00').getTime() + days * DAY_MS));
}

function dayStart(dateStr) { return parseBeijing(dateStr, '00:00'); }
function nextDayStart(dateStr) { return parseBeijing(addDays(dateStr, 1), '00:00'); }

function dateRange(startDate, endDate) {
  const out = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function lastNDates(days, at = now()) {
  const end = toDateStr(at);
  const start = addDays(end, -(Math.max(1, days) - 1));
  return { start, end, dates: dateRange(start, end) };
}

function isWithin(date, start, endExclusive) {
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) && ts >= start.getTime() && ts < endExclusive.getTime();
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator) / Number(denominator)) * 10000) / 100;
}

module.exports = {
  BEIJING_OFFSET_MS,
  DAY_MS,
  now,
  beijingParts,
  toDateStr,
  parseBeijing,
  addDays,
  dayStart,
  nextDayStart,
  dateRange,
  lastNDates,
  isWithin,
  rate,
};
