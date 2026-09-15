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

module.exports = {
  WEEKDAYS, pad, formatDate, formatDateWithWeek,
  formatDateRange, dayDiff, formatTime, formatReleaseDate,
  countdown, difficultyClass, defaultDateRange, markSpotsSelected,
};
