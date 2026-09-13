/**
 * GMT+8 统一时间层（TIME-RULE-001）
 *
 * 云函数运行在 UTC 时区，直接用 new Date().getHours() 会比北京时间少 8 小时，
 * 20:00 放票会被算成 12:00。本模块是全后端唯一的时间入口，
 * 禁止在业务代码里裸用 new Date() 取年/月/日/时/分。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 星期索引 → closedDays / openDays 里使用的英文名（release_rules） */
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

/** 该日期（北京时间）落在星期几，返回 closedDays / openDays 用的英文名 */
function dayNameOf(dateStr) {
  return beijingParts(parseBeijing(dateStr, '12:00')).dayName;
}

/**
 * 开放日判定（唯一的闭馆/开放日入口，勿在业务代码里自行 includes）
 *
 * 两套语义，openDays 非空时**接管**、不与 closedDays 叠加（叠加会得出空集）：
 * - openDays 非空（白名单）：仅这些星期可约/开放。用于平时只开周末、
 *   假期另行公告的景点（北大/清华），把「默认全开、排除几天」反转过来。
 * - 否则（黑名单）：closedDays 列出的星期不可约/不开放，缺省即全年开放。
 *
 * @param {object} rule release_rules 记录，可为空
 * @param {string} dayName 英文星期名（time.dayNameOf 的返回值）
 * @returns {boolean}
 */
function isOpenOn(rule, dayName) {
  if (!rule) return true;
  const open = rule.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(rule.closedDays || []).includes(dayName);
}

/**
 * 该星期名对应的中文标签，如 monday → 周一。
 * 供闭馆日/开放日文案拼装复用（cloudfunctions/spots 与前端 mock 各有一份调用方）。
 */
const DAY_CN = {
  sunday: '周日', monday: '周一', tuesday: '周二', wednesday: '周三',
  thursday: '周四', friday: '周五', saturday: '周六',
};
function dayNamesCn(days) {
  return (days || []).map(d => DAY_CN[d] || d);
}

/**
 * 闭馆 / 开放日标签（cloudfunctions/spots 与前端 mock 共用同一份文案逻辑）
 *
 * 四态，按优先级：
 * 1. openDays 非空（白名单）→ 「仅周六、周日开放」
 * 2. closedDays 非空（黑名单）→ 「周一闭馆」
 * 3. 都没配但有 closedDaysNote → 用 note。用于「园中园周一闭馆、公园本体全开」的天坛/北海：
 *    呈现上要说清周一有东西不开，但**不能**改 closedDays —— 那会让 App 报「周一闭馆」，
 *    而公园其实开着，等于放假提醒（同 2026-09-11 人民大会堂那类错误）。
 * 4. 否则 → 「全年开放」
 */
function openDaysLabel(rule) {
  if (!rule) return '';
  const open = rule.openDays || [];
  if (open.length > 0) return '仅' + dayNamesCn(open).join('、') + '开放';
  const closed = rule.closedDays || [];
  if (closed.length > 0) return dayNamesCn(closed).join('、') + '闭馆';
  if (rule.closedDaysNote) return rule.closedDaysNote;
  return '全年开放';
}

/**
 * 当前生效中的官方公告。过了 `specialNoticeUntil`（含当天）就**自动**不再下发。
 *
 * 为什么需要它：公告的有效期原先只写在 `specialNotice` 的自由文本里（「…8月31日…」），
 * 代码读不出来，只能靠人记得清理 —— 2026-09-11 就出过一次，
 * 毛主席纪念堂 8/31 已到期的公告在 App 上继续顶着红条显示「暂停对外开放」11 天。
 * 新增公告时一并填 `specialNoticeUntil`（YYYY-MM-DD），到期自动失效，不需要改代码。
 *
 * `specialNoticeUntil` 缺省 = 无到期日（长期有效），向后兼容存量数据。
 */
function activeNoticeOf(rule, at = now()) {
  if (!rule || !rule.specialNotice) return '';
  const until = rule.specialNoticeUntil;
  if (!until) return rule.specialNotice;
  return toDateStr(at) <= until ? rule.specialNotice : '';
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
  isOpenOn,
  DAY_CN,
  dayNamesCn,
  openDaysLabel,
  activeNoticeOf,
  dateRange,
  addMinutes,
  formatMonthDayWeek,
  formatMonthDay,
  formatMonthDayWeekCn,
  formatHourMinute,
  toIcsUtc,
};
