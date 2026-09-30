/**
 * 放票规则的北京时间视图（纯函数）。
 *
 * 只做页面可解释的规则推算，不判断官方真实库存：
 * - 今天是否开放 / 放票
 * - 今日多放票时刻中下一场和已放票状态
 * - 场景卡需要的“按规则推算最早可约日”文案
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingParts(date) {
  const shifted = new Date((date || new Date()).getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function toDateStr(date) {
  const p = beijingParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseDateStr(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr || '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function addDaysStr(dateStr, days) {
  const p = parseDateStr(dateStr);
  if (!p) return '';
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d) + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayNameOfStr(dateStr) {
  const p = parseDateStr(dateStr);
  if (!p) return '';
  return DAY_NAMES[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

function diffDays(fromDateStr, toDateStrValue) {
  const a = parseDateStr(fromDateStr);
  const b = parseDateStr(toDateStrValue);
  if (!a || !b) return 0;
  const av = Date.UTC(a.y, a.m - 1, a.d);
  const bv = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bv - av) / 86400000);
}

function releaseTimesOf(spot) {
  const t = spot && spot.releaseTime;
  if (!t) return [];
  return Array.isArray(t) ? t.slice() : [t];
}

function minutesOf(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}

/** 与云端 isOpenOn 同口径：openDays 非空时接管 closedDays。 */
function isOpenOnDate(spot, dayName) {
  const open = (spot && spot.openDays) || [];
  if (open.length > 0) return open.indexOf(dayName) >= 0;
  return ((spot && spot.closedDays) || []).indexOf(dayName) < 0;
}

function isOpenToday(spot, now) {
  return isOpenOnDate(spot, beijingParts(now || new Date()).dayName);
}

function hasReleaseToday(spot, now) {
  return !!(spot && spot.remindable && releaseTimesOf(spot).length && isOpenToday(spot, now));
}

function formatMonthDay(dateStr) {
  const p = parseDateStr(dateStr);
  return p ? `${p.m}月${p.d}日` : '';
}

function buildSceneSpot(spot, now) {
  const p = beijingParts(now || new Date());
  const times = releaseTimesOf(spot);
  const nowMinutes = p.hour * 60 + p.minute;
  const openToday = isOpenOnDate(spot, p.dayName);
  const nextTime = openToday ? (times.find(t => minutesOf(t) > nowMinutes) || '') : '';
  const allReleased = openToday && !!times.length && !nextTime;
  const releaseText = spot.advanceDays
    ? `提前${spot.advanceDays}天 · ${times.join('、') || '待更新'}放票`
    : (spot.cardDesc || '预约规则以详情为准');
  const earliestText = spot.earliestDate
    ? `按规则推算，最早可约 ${formatMonthDay(spot.earliestDate)}`
    : '暂无固定可约窗口';
  return Object.assign({}, spot, {
    _sceneReleaseText: releaseText,
    _sceneStatus: !openToday ? '今日不开放' : (nextTime ? `今日 ${nextTime} 放票` : (allReleased ? '今日已放票' : '今日不放票')),
    _sceneEarliestText: earliestText,
    _allReleased: allReleased,
    _sortMinutes: nextTime ? minutesOf(nextTime) : Number.MAX_SAFE_INTEGER,
  });
}

function buildTodayRows(spots, now) {
  return (spots || [])
    .filter(s => hasReleaseToday(s, now))
    .map(s => buildSceneSpot(s, now))
    .sort((a, b) => {
      if (a._allReleased !== b._allReleased) return a._allReleased ? 1 : -1;
      if (a._sortMinutes !== b._sortMinutes) return a._sortMinutes - b._sortMinutes;
      if ((b.popularityScore || 0) !== (a.popularityScore || 0)) {
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 最近一次可执行的放票节点。
 *
 * 只做规则推算，不判断官方库存；最多向后找 14 天，覆盖黑白名单和临时不开的日子。
 */
function nextReleaseOf(spot, now) {
  if (!spot || !spot.remindable) return null;
  const times = releaseTimesOf(spot).sort((a, b) => minutesOf(a) - minutesOf(b));
  if (!times.length) return null;

  const current = beijingParts(now || new Date());
  const nowMinutes = current.hour * 60 + current.minute;
  const today = toDateStr(now || new Date());
  for (let offset = 0; offset <= 14; offset += 1) {
    const dateStr = addDaysStr(today, offset);
    if (!isOpenOnDate(spot, dayNameOfStr(dateStr))) continue;
    for (let i = 0; i < times.length; i += 1) {
      const time = times[i];
      if (offset === 0 && minutesOf(time) <= nowMinutes) continue;
      return { dateStr, time, offset, minutes: minutesOf(time) };
    }
  }
  return null;
}

function shiftTime(time, deltaMinutes) {
  const minutes = minutesOf(time);
  if (minutes === Number.MAX_SAFE_INTEGER) return '';
  const shifted = Math.max(0, minutes + deltaMinutes);
  return pad2(Math.floor(shifted / 60)) + ':' + pad2(shifted % 60);
}

/**
 * 新用户首页的内容预览：
 * - rows：按最近放票节点排序的热门景点，页面只渲染前 limit 条；
 * - sample：优先使用国博做示例，缺失时再选最难约的一条，翻译成“出行日 → 抢票时间 → 微信提醒”。
 */
function buildHomeReleasePreview(spots, now, limit = 3) {
  const at = now || new Date();
  const current = beijingParts(at);
  const nowMinutes = current.hour * 60 + current.minute;
  const rows = (spots || [])
    /* 空态是公开内容入口，沿用首页旧网格的 S 级口径：热度 4 以上且难度 4 以上。
       否则“按最近放票排序”会把容易约、但今天恰好放票的场馆顶上来。 */
    .filter(spot => (spot.popularityScore || 0) >= 4 && (spot.difficultyScore || 0) >= 4)
    .map((spot) => {
      const next = nextReleaseOf(spot, at);
      if (!next) return null;
      const todayOpen = isOpenOnDate(spot, current.dayName);
      const times = releaseTimesOf(spot);
      const releasedToday = todayOpen && times.length > 0
        && times.every(t => minutesOf(t) <= nowMinutes);
      let statusText;
      if (releasedToday) statusText = '今天已放票';
      else if (next.offset === 0) statusText = `今天 ${next.time} 放票`;
      else if (next.offset === 1) statusText = `明天 ${next.time} 放票`;
      else statusText = `${formatMonthDay(next.dateStr)} ${next.time} 放票`;
      return Object.assign({}, spot, {
        _nextRelease: next,
        _releaseStatusText: statusText,
        _releaseTone: releasedToday ? 'released' : (next.offset === 0 ? 'today' : 'future'),
        _difficultyText: (spot.difficultyLabel && spot.difficultyLabel.text) || '',
        _difficultyKey: (spot.difficultyLabel && spot.difficultyLabel.key) || '',
      });
    }).filter(Boolean).sort((a, b) => {
      const ad = a._nextRelease.dateStr + ' ' + a._nextRelease.time;
      const bd = b._nextRelease.dateStr + ' ' + b._nextRelease.time;
      if (ad !== bd) return ad.localeCompare(bd);
      if ((b.popularityScore || 0) !== (a.popularityScore || 0)) {
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      }
      return (b.difficultyScore || 0) - (a.difficultyScore || 0);
    });

  const sampleRows = rows.slice(0, Math.max(0, limit));
  const sampleSpot = sampleRows.find(spot => spot.spotId === 'guobo')
    || sampleRows.sort((a, b) => {
      if ((b.difficultyScore || 0) !== (a.difficultyScore || 0)) {
        return (b.difficultyScore || 0) - (a.difficultyScore || 0);
      }
      return (b.popularityScore || 0) - (a.popularityScore || 0);
    })[0];
  let sample = {
    visitText: '出行当天 · 想去的景点',
    releaseText: '按规则算出抢票时间',
    remindText: '提前 5 分钟微信提醒',
  };
  if (sampleSpot) {
    const next = sampleSpot._nextRelease;
    const visitDate = addDaysStr(next.dateStr, sampleSpot.advanceDays || 0);
    const dayLabel = next.offset === 0 ? '今天' : (next.offset === 1 ? '明天' : formatMonthDay(next.dateStr));
    sample = {
      visitText: `${formatMonthDay(visitDate)} · ${sampleSpot.shortName || sampleSpot.name}`,
      releaseText: `${dayLabel} ${next.time} 起抢`,
      remindText: `${shiftTime(next.time, -5)} 微信提醒`,
    };
  }
  return { rows: rows.slice(0, Math.max(0, limit)), sample };
}

module.exports = {
  DAY_NAMES,
  beijingParts,
  toDateStr,
  addDaysStr,
  dayNameOfStr,
  diffDays,
  releaseTimesOf,
  minutesOf,
  isOpenOnDate,
  isOpenToday,
  hasReleaseToday,
  formatMonthDay,
  buildSceneSpot,
  buildTodayRows,
  nextReleaseOf,
  buildHomeReleasePreview,
};
