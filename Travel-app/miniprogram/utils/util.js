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

/** 当前自然日（北京时间，YYYY-MM-DD）。 */
function beijingTodayStr(now = new Date()) {
  const p = new Date(now.getTime() + 8 * 3600000);
  return p.getUTCFullYear() + '-' + pad(p.getUTCMonth() + 1) + '-' + pad(p.getUTCDate());
}

/** 日期早于今天时返回已过去的天数；当天与未来返回 0。 */
function pastDaysOf(dateStr, today = beijingTodayStr()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') || dateStr >= today) return 0;
  return Math.max(0, dayDiff(dateStr, today) - 1);
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

/** 「10月2日 ~ 10月4日」（月份相同也重复写，别的场景要完整） */
function monthDayRange(start, end) {
  const s = parseDay(start); const e = parseDay(end);
  return s.m + '月' + s.d + '日 ~ ' + e.m + '月' + e.d + '日';
}

/**
 * 摘要卡副标题「10月2日~10月4日 · 还有27天」（设计稿 UI/V.0.2-0919）。
 *
 * 两个刻意的取舍：
 *  ① **不写月份时给结束日期补月**（跨月时「10月30日~4日」会读成 4 日在前）。
 *  ② 用 `~` 而不是别的连接符——与设计稿逐字一致。
 * 倒计时走 `countdownTextOf`（唯一真身），别在调用方另算一套天数。
 */
function tripMetaLine(start, end, countdown) {
  const s = parseDay(start); const e = parseDay(end);
  const from = s.m + '月' + s.d + '日';
  const to = (s.m === e.m ? '' : e.m + '月') + e.d + '日';
  return from + '~' + to + (countdown ? ' · ' + countdown : '');
}

/** 「北京 9.30-10.3」（行程名）→「北京之行」的展示名 */
function tripDisplayName(trip) {
  const city = (trip && trip.city) || '';
  return city ? city + '之行' : ((trip && trip.name) || '');
}

/**
 * 摘要卡右上角的装饰英文水印（设计稿 UI/V.0.2-0919 的「B E I J I N G  T R I P」）。
 * 逐字大写并用双空格撑开字距——**返回数组**是因为 WXML 里字符间要各自一个元素，
 * 用 CSS letter-spacing 在有字距上限的机型上会缩水，达不到设计稿那种「散开」的效果。
 */
const WATERMARK_WORD = { '北京': 'BEIJING' };
function tripWatermark(trip) {
  const city = (trip && trip.city) || '';
  const latin = WATERMARK_WORD[city];
  return latin ? (latin + '  TRIP').split('') : [];
}

/** 距出行日还有几天（倒计时）。当天 = 0，已过为负 */
function daysUntil(dateStr) {
  const t = new Date(); const b = new Date(t.getTime() + 8 * 3600000);
  const today = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 12);
  const p = parseDay(dateStr);
  const target = Date.UTC(p.y, p.m - 1, p.d, 12);
  return Math.round((target - today) / 86400000);
}

/** 倒计时文案：「还有27天」/「今天出发」/「已结束」
 *  用途：**行程项卡**上某个景点出行日的倒计时（那个位置旁边还有放票行，先说日期更自然）。 */
function countdownTextOf(dateStr) {
  const n = daysUntil(dateStr);
  if (n > 0) return '还有' + n + '天';
  if (n === 0) return '就是今天';
  return '已结束';
}

/**
 * 行程级倒计时（摘要卡副标题用）：「还有27天」/「进行中第1天」/「已结束」。
 *
 * 与 `countdownTextOf` 的差别只在**进行中**这一段：
 *   - 行程项卡说「就是今天」——它旁边是「9月25日 10:00 放票」，先说日期更自然；
 *   - 行程摘要卡说「进行中第N天」——那是**用户此刻正身在其中**的那一趟，
 *     告诉他「第几天了」比「就是今天」有用得多。
 * ⚠️ 两者都是行程/景点的展示文案，`lib/item.js` 的**票务状态推导不碰它们**，
 *   别拿这里的口径去反推服务端状态。
 */
function tripCountdownTextOf(startDate, endDate) {
  const n = daysUntil(startDate);
  if (n > 0) return '还有' + n + '天';
  /* n <= 0：已开始。行程最后一天的**当天仍属进行中**、次日才算结束
     （与服务端同口径，见 index.js 的 activeTrips 拆分 `t.endDate >= today`），
     所以这里必须是 `>= 0` —— 写成 `> 0` 会让最后一天显示成「已结束」。 */
  if (daysUntil(endDate) >= 0) return '进行中第' + (1 - n) + '天';
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
 * 行程项卡片的副行主体（放票行）。
 * 免预约项没有放票时刻，说「无需预约」——不能留空，留空用户会以为数据没加载出来。
 *
 * ⚠️ 2026-09-22 按设计稿**去掉「 放票」后缀**：稿子是「09月26日 10:00」，
 *   「放票」二字由紧跟其后的尾巴（「还有N天」/「现在预约」）承担语义，不必重复。
 *   别把后缀加回来——加了之后副行会出现「10月3日 20:00 放票 · 现在预约」这种自相矛盾的读法。
 */
function releaseLineOf(item) {
  if (!item || item.reservationRequired === false) return '无需预约 · 随到随玩';
  if (!item.releaseAt) return '暂无固定放票时刻';
  return monthDayTime(item.releaseAt);
}

/**
 * 副行尾巴：放票时刻右边那一段状态文本 + 它的色调。
 *
 * 返回 `{ text, tone }` 而不是直接给类名，是因为 **WXML 里不能调用方法、也不能做
 * 字符串拼接以外的判断**（项目踩过：`wx:if` 里写方法调用会静默失效）。
 * 页面只做 `class="tc-sub-tail-{{tone}}"`，所有分支都在这里定死。
 *
 * ⚠️ **判定优先级：先看提醒送达态，再看票务态**。
 *   `MISSED`（提醒没送到）是这个产品里唯一会真正伤到用户的状态——用户以为会被叫醒，
 *   结果没有。它必须压过票务态显示，否则「可抢 + 未送达」的卡片会写成「现在预约」，
 *   把「你被静默失败了」这件事盖掉。
 *
 * ⚠️ 「还有N天」算的是**距放票**天数（稿子里它紧跟在放票时刻后面），
 *   与 `daysUntil` / `countdownTextOf` 那套「距出行日」的北京时区日历日算法**不是一回事**，
 *   不要图省事改去调它们——放票时刻带时分，按毫秒算才对得上。
 */
function releaseRemainderOf(item) {
  if (!item || item.reservationRequired === false) return { text: '', tone: '' };

  /* 提醒没送到压过一切票务态 */
  if (item.reminder && item.reminder.state === 'MISSED') return { text: '· 未送达', tone: 'muted' };

  if (!item.releaseAt) return { text: '', tone: '' };

  const state = item.ticketState;
  if (state === 'SUCCESS') return { text: '· 已约', tone: 'muted' };
  /* 未抢到：票已放出仍可继续抢，副行保留「现在预约 ›」；
     「约其他日」入口移至右侧三点菜单（trip-card.wxml），不再内联。 */
  if (state === 'FAILED') return { text: '· 现在预约 ›', tone: 'go' };
  if (state === 'BOOKABLE' || state === 'UNMARKED') return { text: '· 现在预约 ›', tone: 'go' };

  /* 剩下就是「还没到点」。releaseAt 已过（比如刚放票还没被算成 BOOKABLE）也走现在预约，
     **不能显示「还有-1天」**——实测放票时刻可以落在过去。 */
  const ms = new Date(item.releaseAt).getTime() - Date.now();
  if (ms <= 0) return { text: '· 现在预约 ›', tone: 'go' };
  return { text: '· 还有' + Math.ceil(ms / 86400000) + '天', tone: 'muted' };
}

/**
 * Snackbar 文案分段（撤销条要按结果给「抢到了」上绿、「没抢到」上朱砂）。
 *
 * 返 `{ lead, highlight, tail, tone }`：模板渲染成
 * `{{lead}}<text class="hl-{{tone}}">{{highlight}}</text>{{tail}}`。
 * 放在这里而不是页面里拼，是因为 `doMark` 成功与 `onUndo` 清空两处都要用同一套结构，
 * 页面里各拼一份必然漂。
 */
function snackbarPartsOf(spotName, isSuccess) {
  return {
    lead: (spotName || '该景点') + ' 已标记为「',
    highlight: isSuccess ? '抢到了' : '没抢到',
    tail: '」',
    tone: isSuccess ? 'success' : 'failed',
  };
}

module.exports = {
  WEEKDAYS, DAY_CN, pad, formatDate, formatDateWithWeek,
  formatDateRange, dayDiff, beijingTodayStr, pastDaysOf, formatTime, formatReleaseDate,
  countdown, difficultyClass, defaultDateRange, markSpotsSelected,
  parseDay, dayTitleOf, monthDayTime, monthDayRange, daysUntil,
  countdownTextOf, stateClass, reminderClass, releaseLineOf,
  releaseRemainderOf, snackbarPartsOf,
  tripMetaLine, tripDisplayName, tripWatermark, tripCountdownTextOf,
};
