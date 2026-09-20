/**
 * 日期与格式化工具 — 全系统时间 GMT+8 (TIME-RULE-001)
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/** 格式化日期为 "M月D日" */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/** 格式化日期为 "M月D日 周X" */
function formatDateWithWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
}

/** 格式化日期范围为 "5月31日 周日 - 6月04日 周四" */
function formatDateRange(start, end) {
  return formatDateWithWeek(start) + ' - ' + formatDateWithWeek(end);
}

/** 计算天数差 */
function dayDiff(start, end) {
  const s = new Date(start + 'T00:00:00+08:00');
  const e = new Date(end + 'T00:00:00+08:00');
  return Math.round((e - s) / 86400000) + 1;
}

/** ISO 日期字符串转 "HH:MM" */
function formatTime(isoStr) {
  const d = new Date(isoStr);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** ISO 日期字符串转 "M月D日" (放票日) */
function formatReleaseDate(isoStr) {
  const d = new Date(isoStr);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/** 倒计时计算 */
function countdown(releaseAt, offsetMin) {
  const target = new Date(releaseAt).getTime() - offsetMin * 60000;
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return { text: '', urgent: false, expired: true };
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return {
    text: '还剩' + hours + 'h ' + minutes + 'm',
    urgent: diff < 3600000,
    expired: false,
  };
}

/** 难度标签样式映射 */
function difficultyClass(label) {
  if (!label) return '';
  const map = { EXTREME: 'extreme', NORMAL: 'normal', EASY: 'easy' };
  return map[label.key] || '';
}

/** 日期选择器默认值（今天+7天范围） */
function defaultDateRange() {
  const today = new Date();
  const start = new Date(today.getTime() + 7 * 86400000);
  const end = new Date(start.getTime() + 4 * 86400000);
  const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return { start: fmt(start), end: fmt(end) };
}

/* 2026-09-14：原 rangesMerge / mergeRanges（前端侧的 TRIP-RULE-002 合并判定与并集）
   已删除——行程合并在云端 trip.create 内完成（含 canMerge/mergeRange/collapse），
   前端不再持有第二份副本，避免口径分叉。 */

/** 给景点卡数组打 selected 标记，供 WXML 直接绑定（WXML 不支持 indexOf 方法调用） */
function markSpotsSelected(list, ids) {
  const set = {};
  (ids || []).forEach(id => { set[id] = true; });
  return (list || []).map(s => Object.assign({}, s, { selected: !!set[s.spotId] }));
}

/* ===== 行程状态墙视图层（2026-09-20 首页行程化改版）=====
   只做「云端返回值 → 模板字符串」的映射。
   ⚠️ 状态本身（ticketState / canMark / progress）一律用云端算好的，
   前端不重新推导一遍——那必然会漂。 */

const DAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 把 "YYYY-MM-DD" 按北京时间解析（避免设备时区把日期移一天） */
function parseDay(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
}

/** 「10月2日 · 周五」（状态墙的日期分段标题） */
function dayTitleOf(dateStr) {
  const p = parseDay(dateStr);
  return p.m + '月' + p.d + '日 · ' + DAY_CN[p.weekday];
}

/** 「10月3日 20:00」（放票行 / 挽回候选） */
function monthDayTime(date) {
  if (!date) return '';
  const d = new Date(date);
  // 用北京时间读，避免跨时区把 20:00 显示成 12:00
  const b = new Date(d.getTime() + 8 * 3600000);
  return (b.getUTCMonth() + 1) + '月' + b.getUTCDate() + '日 ' + pad(b.getUTCHours()) + ':' + pad(b.getUTCMinutes());
}

/** 「10月2日 ~ 10月4日」（摘要卡日期范围） */
function monthDayRange(start, end) {
  const s = parseDay(start); const e = parseDay(end);
  return s.m + '月' + s.d + '日 ~ ' + e.m + '月' + e.d + '日';
}

/** 距出行日还有几天（倒计时）。当天 = 0，已过为负 */
function daysUntil(dateStr) {
  const t = new Date(); const b = new Date(t.getTime() + 8 * 3600000);
  const today = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 12);
  const p = parseDay(dateStr);
  const target = Date.UTC(p.y, p.m - 1, p.d, 12);
  return Math.round((target - today) / 86400000);
}

/** 倒计时文案：「还有27天」/「今天出发」/「已结束」 */
function countdownTextOf(dateStr) {
  const n = daysUntil(dateStr);
  if (n > 0) return '还有' + n + '天';
  if (n === 0) return '就是今天';
  return '已结束';
}

/** 票务展示态 → 样式类（与 app.wxss 的 --state-* 对应） */
function stateClass(state) {
  const map = {
    PENDING: 'pending', BOOKABLE: 'bookable', SUCCESS: 'success',
    FAILED: 'failed', UNMARKED: 'unmarked', NO_RESERVATION: 'free',
  };
  return map[state] || 'pending';
}

/** 提醒送达态 → 样式类 */
function reminderClass(state) {
  const map = { NOT_SET: 'none', WAITING: 'waiting', TRIGGERED: 'done', MISSED: 'miss' };
  return map[state] || 'none';
}

/**
 * 行程项卡片的副行文案（放票行）。
 * 免预约项没有放票时刻，说「无需预约」——不能留空，留空用户会以为数据没加载出来。
 */
function releaseLineOf(item) {
  if (!item || item.reservationRequired === false) return '无需预约 · 随到随玩';
  if (!item.releaseAt) return '暂无固定放票时刻';
  return monthDayTime(item.releaseAt) + ' 放票';
}

module.exports = {
  WEEKDAYS, DAY_CN, pad, formatDate, formatDateWithWeek,
  formatDateRange, dayDiff, formatTime, formatReleaseDate,
  countdown, difficultyClass, defaultDateRange, markSpotsSelected,
  parseDay, dayTitleOf, monthDayTime, monthDayRange, daysUntil,
  countdownTextOf, stateClass, reminderClass, releaseLineOf,
};
