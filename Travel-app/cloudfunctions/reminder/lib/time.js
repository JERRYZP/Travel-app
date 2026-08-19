/**
 * GMT+8 统一时间层（TIME-RULE-001）
 *
 * 云函数运行在 UTC 时区，直接用 new Date().getHours() 会比北京时间少 8 小时，
 * 20:00 放票会被算成 12:00。本模块是全后端唯一的时间入口，
 * 禁止在业务代码里裸用 new Date() 取年/月/日/时/分。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 星期索引 → closedDays 里使用的英文名（release_rules.closedDays） */
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * 当前时刻。返回真实 UTC 时间戳的 Date，用于与 releaseAt 做绝对时间比较。
 * 取「北京时间的年月日时分」请用 beijingParts()。
 */
function now() {
  return new Date();
}

/**
 * 把任意时刻拆成北京时间的各部分。
 * 做法：先把时间戳平移 +8h，再用 getUTC* 读取，从而绕开运行环境本地时区。
 */
function beijingParts(date = now()) {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}

/** 北京时间的日期字符串 "YYYY-MM-DD" */
function toDateStr(date = now()) {
  const p = beijingParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 今天（北京时间）的日期字符串 */
function todayStr() {
  return toDateStr(now());
}

/**
 * 把「北京时间的日期 + HH:mm」解析为绝对时刻。
 * 这是 releaseAt 的唯一生成方式（TIMELINE-RULE-001）。
 * @param {string} dateStr "YYYY-MM-DD"（视为北京时间当日）
 * @param {string} timeStr "HH:mm"，如 "20:00"
 * @returns {Date}
 */
function parseBeijing(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  // Date.UTC 得到的是「把该年月日时分当作 UTC」的时间戳，减去 8h 即为北京时间对应的真实时刻
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - BEIJING_OFFSET_MS);
}

/** 日期字符串加减天数，仍返回 "YYYY-MM-DD"（按北京时间自然日） */
function addDays(dateStr, days) {
  const base = parseBeijing(dateStr, '00:00');
  return toDateStr(new Date(base.getTime() + days * DAY_MS));
}

/** 两个日期字符串相差的自然日数（b - a） */
function diffDays(a, b) {
  return Math.round((parseBeijing(b, '00:00') - parseBeijing(a, '00:00')) / DAY_MS);
}

/** 该日期（北京时间）落在星期几，返回 closedDays 用的英文名 */
function dayNameOf(dateStr) {
  return beijingParts(parseBeijing(dateStr, '12:00')).dayName;
}

/** 生成 [startDate, endDate] 区间内的全部日期字符串（含端点） */
function dateRange(startDate, endDate) {
  const out = [];
  const total = diffDays(startDate, endDate);
  for (let i = 0; i <= total; i += 1) out.push(addDays(startDate, i));
  return out;
}

/** 时刻加减分钟 */
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * UI 用的「M月D日 (周X)」（PAGE-005 事件卡、PAGE-007 清单行）
 */
function formatMonthDayWeek(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日 (周${cn[p.weekday]})`;
}

/** UI 用的「M月D日」（PAGE-009 任务分组标题，设计稿不带星期） */
function formatMonthDay(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  return `${p.month}月${p.day}日`;
}

/** UI 用的「M月D日（周X）」（全角括号、无空格，PAGE-009 任务副标题，对齐设计稿） */
function formatMonthDayWeekCn(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日（周${cn[p.weekday]}）`;
}

/** UI 用的「HH:mm」（按北京时间显示 releaseAt） */
function formatHourMinute(date) {
  const p = beijingParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** ICS 需要的 UTC 基本格式：20260531T120000Z（ICS-RULE-001） */
function toIcsUtc(date) {
  const s = date.toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

module.exports = {
  BEIJING_OFFSET_MS,
  DAY_MS,
  DAY_NAMES,
  now,
  beijingParts,
  toDateStr,
  todayStr,
  parseBeijing,
  addDays,
  diffDays,
  dayNameOf,
  dateRange,
  addMinutes,
  formatMonthDayWeek,
  formatMonthDay,
  formatMonthDayWeekCn,
  formatHourMinute,
  toIcsUtc,
};
