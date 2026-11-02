/**
 * Mock 后端 -- 测试号不支持云开发时的内存模拟
 *
 * 联调正式 appid 时：把 USE_MOCK 改成 false，走真实云函数（utils/api.js 自动切换）。
 * 内存数据在小程序一次运行内连贯，重新编译会重置。
 */

const USE_MOCK = false;

const { SPOTS, RULES } = require('./mock-data.js');


/* ===== 内存数据库（一次运行内连贯，重新编译重置） ===== */
const db = {
  trips: {},
  carts: {},
  tasks: {},
  items: {},
  feedbacks: {},
  orders: {},
  afterSalesCases: {},
  paymentConfig: {
    membership_sales: { state: 'OPEN', reason: '', updatedAt: null, updatedBy: '' },
    membership_enforcement: { mode: 'all', updatedAt: null, updatedBy: '' },
  },
  searchHistory: [],
};
/* 暂存清单的占位 tripId（镜像 schema.PENDING_CART_TRIP_ID，2026-09-20 清单改暂存区）：
   「生成时间线」改为纯预览后，用户加入清单时还没有行程，未提交的行统一挂这个值，
   提交时才建/合并行程并整批改挂。⚠️ 不是真实行程，不要拿去 db.trips 里查。 */
const PENDING_CART_TRIP_ID = '__pending__';
/* 人工结果撤销窗口（镜像 schema.V1.RESULT_UNDO_SECONDS，2026-09-17 由 10 秒收紧为 4 秒） */
const RESULT_UNDO_SECONDS = 4;
/* 放票后未标记转为中性态的时间（镜像 schema.V1.UNMARKED_AFTER_HOURS） */
const UNMARKED_AFTER_HOURS = 24;

let tripSeq = 0;
let cartSeq = 0;
let taskSeq = 0;
let itemSeq = 0;
let feedbackSeq = 0;
let orderSeq = 0;
let subscribeSeq = 0;
const subscribeQuotas = {};

/**
 * 台账自愈判定（镜像 cloudfunctions/reminder/lib/quota.js 的 shouldHealQuota，
 * 以及 cloudfunctions/notifier/index.js 的同名副本）。
 * ⚠️ 必须带 lastSendError 前置条件：为空 = 从未尝试发送 = 链路故障，额度在微信侧依然有效，
 * 清零等于白丢用户已授权的额度；失败原因是本地配置/网络时同理。
 */
const LOCAL_FAILURE_HINTS = ['未配置', '未设置', 'access_token', 'accesstoken', '网络', 'timeout', '超时', 'empty response'];

function shouldHealQuota(lastSendError) {
  const reason = String(lastSendError == null ? '' : lastSendError).trim();
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return !LOCAL_FAILURE_HINTS.some(hint => lower.includes(hint.toLowerCase()));
}

/** 清零本地台账（mock 单模板世界，直接清所有模板键），返回是否真的清过 */
function healSubscribeQuotas() {
  const keys = Object.keys(subscribeQuotas).filter(k => subscribeQuotas[k] > 0);
  if (!keys.length) return false;
  keys.forEach(k => { subscribeQuotas[k] = 0; });
  subscribeSeq = 0;
  mockUser.subscribeQuota = 0;
  mockUser.subscribeQuotas = subscribeQuotas;
  return true;
}

/* ===== GMT+8 统一时间层（镜像 cloudfunctions/reminder/lib/time.js，TIME-RULE-001） ===== */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad(n) { return String(n).padStart(2, '0'); }
function beijingParts(date = new Date()) {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}
function toDateStr(date = new Date()) {
  const p = beijingParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function fmt(date) { return toDateStr(date); }
function parseBeijing(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - BEIJING_OFFSET_MS);
}
function addDays(dateStr, days) {
  const base = parseBeijing(dateStr, '00:00');
  return toDateStr(new Date(base.getTime() + days * DAY_MS));
}
function diffDays(a, b) {
  return Math.round((parseBeijing(b, '00:00') - parseBeijing(a, '00:00')) / DAY_MS);
}
function dayNameOf(dateStr) { return beijingParts(parseBeijing(dateStr, '12:00')).dayName; }
function dateRange(startDate, endDate) {
  const out = [];
  const total = diffDays(startDate, endDate);
  for (let i = 0; i <= total; i += 1) out.push(addDays(startDate, i));
  return out;
}
function formatMonthDayWeek(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日 (周${cn[p.weekday]})`;
}
function formatMonthDay(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  return `${p.month}月${p.day}日`;
}
function formatMonthDayWeekCn(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日（周${cn[p.weekday]}）`;
}
function formatHourMinute(date) {
  const p = beijingParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/* ===== 卡片组装（镜像 cloudfunctions/spots，TAG-RULE-001 / 2026 分层） ===== */
function computeDifficultyLabel(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约', color: 'red' };
  if (score === 3) return { key: 'NORMAL', text: '较难约', color: 'orange' };
  return { key: 'EASY', text: '容易约', color: 'green' };
}
const DAY_CN = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日' };
/* 镜像 cloudfunctions/spots：四态 —— openDays 白名单 → closedDays 黑名单 → closedDaysNote（园中园） → 全年开放 */
function closedDaysLabel(days, openDays, note) {
  const open = openDays || [];
  if (open.length > 0) return '仅' + open.map(d => DAY_CN[d] || d).join('、') + '开放';
  if (days && days.length > 0) return days.map(d => DAY_CN[d] || d).join('、') + '闭馆';
  if (note) return note;
  return '全年开放';
}
/* 镜像 cloudfunctions/spots：公告过了 specialNoticeUntil（含当天）自动不下发 */
function activeNoticeOf(rule) {
  if (!rule || !rule.specialNotice) return '';
  const until = rule.specialNoticeUntil;
  if (!until) return rule.specialNotice;
  return toDateStr(new Date()) <= until ? rule.specialNotice : '';
}
/* 镜像 cloudfunctions/spots：openDays 白名单优先，不与 closedDays 叠加 */
function isOpenOn(rule, dayName) {
  if (!rule) return true;
  const open = rule.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(rule.closedDays || []).includes(dayName);
}
function computeReleaseStatus(rule, now = new Date()) {
  if (!rule || !rule.releaseTime) return 'NOT_RELEASED';
  const p = beijingParts(now);
  if (!isOpenOn(rule, p.dayName)) return 'NOT_RELEASED';
  const [h, m] = rule.releaseTime.split(':').map(Number);
  if (p.hour * 60 + p.minute < h * 60 + m) return 'NOT_RELEASED';
  return 'BOOKABLE';
}
function computeEarliestDate(rule, now = new Date()) {
  if (!rule || !rule.advanceDays) return null;
  let target = addDays(toDateStr(now), rule.advanceDays);
  for (let i = 0; i < 7; i += 1) {
    if (isOpenOn(rule, dayNameOf(target))) return target;
    target = addDays(target, 1);
  }
  return null;
}
function cardDescOf(rule, now = new Date()) {
  if (!rule) return '';
  const p = beijingParts(now);
  if (rule.peakPrice || rule.offPrice) {
    const isPeak = p.month >= 4 && p.month <= 10;
    const frag = (isPeak ? rule.peakPrice : rule.offPrice) || rule.peakPrice || rule.offPrice;
    return '随到随买，当前' + frag;
  }
  const base = rule.cardPrice || rule.ticketPrice || '';
  return base ? '随到随买，' + base : '';
}
function weakLine(rule) {
  if (!rule) return '票量充足，无需卡点抢票';
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) {
    const adv = rule.advanceDays ? `提前${rule.advanceDays}天 ` : '';
    return `${adv}${Array.isArray(rt) ? rt.join('、') : rt}放票 · 票量充足，无需卡点`;
  }
  return '票量充足，无需卡点抢票';
}
function buildTags(rule) {
  const t = [];
  if (rule.advanceDays) t.push(`提前${rule.advanceDays}天放票`);
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) t.push(`每日${Array.isArray(rt) ? rt.join('、') : rt}放票`);
  return t;
}
function buildCard(spot) {
  const now = new Date();
  const rule = RULES.find(r => r.spotId === spot.spotId) || null;
  const status = computeReleaseStatus(rule, now);
  const remindable = spot.reservationRequired !== false && !!(rule && rule.advanceDays && (rule.releaseTimes || rule.releaseTime));
  const weak = spot.reservationRequired !== false
    && spot.strongReminder !== true
    && (spot.difficultyScore || 0) <= 2;
  let cardDesc = cardDescOf(rule, now);
  if (remindable && weak) cardDesc = weakLine(rule);
  else if (!remindable && spot.reservationRequired !== false) cardDesc = '无固定放票时刻，随买随用';
  return {
    spotId: spot.spotId,
    name: spot.name,
    shortName: spot.shortName || spot.name,
    aliases: spot.aliases || [],
    category: spot.category,
    audienceTags: spot.audienceTags || [],
    district: spot.district,
    difficultyScore: spot.difficultyScore,
    difficultyLabel: computeDifficultyLabel(spot.difficultyScore),
    popularityScore: spot.popularityScore,
    reservationRequired: spot.reservationRequired !== false,
    remindable,
    addable: true,
    weak,
    cardDesc,
    tags: rule ? buildTags(rule) : [],
    advanceDays: rule ? rule.advanceDays : null,
    releaseTime: rule ? (rule.releaseTimes || rule.releaseTime) : null,
    ticketPrice: rule ? (rule.ticketPrice || '') : '',
    openTime: rule ? (rule.openTime || '') : '',
    closedDays: rule ? (rule.closedDays || []) : [],
    openDays: rule ? (rule.openDays || []) : [],
    releaseStatus: status,
    earliestDate: computeEarliestDate(rule, now),
    lastCheckedDate: rule ? (rule.lastCheckedDate || '') : '',
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
    stale: status === 'BOOKABLE',
  };
}

/* ===== 行程规则（镜像 lib/trip.js：TRIP-RULE-002/003，2026-09-14 A 方案） ===== */
function buildMockTripName(city, startDate, endDate) {
  const short = (d) => { const p = beijingParts(parseBeijing(d, '12:00')); return `${p.month}.${p.day}`; };
  return `${city} ${short(startDate)}-${short(endDate)}`;
}

/* ---------- 合并判定与景点段（镜像 lib/trip.js 纯函数区） ---------- */

/**
 * TRIP-RULE-002 合并判定（2026-09-23 收敛：同城即合并，不再按日期间隔拆分）
 *
 * ⚠️ **必须与云端 `cloudfunctions/reminder/lib/trip.js` 逐字同口径**。
 * 这里一度还留着旧的「交集或首尾相接」，云端早已改成同城即合并——
 * 模拟器里两个北京行程分段显示，真机上并成一段，而两边的单测都是绿的
 * （各自测自己的分支）。镜像漂移就是这么发生的：改一边必须改另一边。
 *
 * 旧逻辑（若将来要恢复间隔拆分）：同城市 &&（日期有交集 或 一方 endDate+1 === 另一方 startDate）。
 */
function canMerge(a, b) {
  return (a.city || '') === (b.city || '');
}

/** 日期段取并集 */
function mergeRange(a, b) {
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

/** 把「景点 × 日期段」摊平成行程的 spots 字段 */
function makeSpotSegments(spotIds, startDate, endDate) {
  return [...new Set(spotIds || [])].map(spotId => ({ spotId, startDate, endDate }));
}

/** 景点段归一化：新数据用 spots；老数据（只有 spotIds）按行程整段回退 */
function normalizeSpots(trip) {
  const segs = Array.isArray(trip.spots) ? trip.spots.filter(s => s && s.spotId) : [];
  if (segs.length > 0) return segs.map(s => ({ spotId: s.spotId, startDate: s.startDate, endDate: s.endDate }));
  return makeSpotSegments(trip.spotIds || [], trip.startDate, trip.endDate);
}

/** 景点段合并：同 spotId 取并集（mergeRange 只回日期，spotId 必须补回） */
function mergeSpots(a, b) {
  const map = new Map();
  for (const s of [...(a || []), ...(b || [])]) {
    if (!s || !s.spotId) continue;
    const cur = map.get(s.spotId);
    map.set(s.spotId, cur
      ? { spotId: s.spotId, ...mergeRange(cur, s) }
      : { spotId: s.spotId, startDate: s.startDate, endDate: s.endDate });
  }
  return [...map.values()];
}

/** 滚雪球式合并：新行程可能同时与多个既有行程相接 */
function collapse(incoming, existing) {
  let range = { city: incoming.city, startDate: incoming.startDate, endDate: incoming.endDate };
  const mergedIds = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of existing) {
      if (mergedIds.includes(t._id)) continue;
      if (canMerge(range, t)) {
        range = { city: range.city, ...mergeRange(range, t) };
        mergedIds.push(t._id);
        changed = true;
      }
    }
  }
  return { range, mergedIds };
}

/** 行程范围/景点变化后，清掉不再合法的清单项（按该景点自己的日期段判定） */
function pruneStaleCart(tripId) {
  const trip = db.trips[tripId];
  if (!trip) return;
  const segMap = {};
  normalizeSpots(trip).forEach(s => { segMap[s.spotId] = s; });
  Object.keys(db.carts).forEach((id) => {
    const c = db.carts[id];
    if (c.tripId !== tripId) return;
    const seg = segMap[c.spotId];
    const dateOk = Boolean(seg) && c.visitDate >= seg.startDate && c.visitDate <= seg.endDate;
    if (!seg || !dateOk) delete db.carts[id];
  });
}

/**
 * TRIP-RULE-004（2026-09-14 补充口径）显式清理，镜像 lib/trip.js 的 purgeIfNoTask：
 * 用户主动删除任务后，行程若已无任何任务 → 行程连同其提醒清单一并删除。
 * 与 trip.list 读取时兜底（清单非空即保留，保护草稿行程）不同，这里不看清单。
 */
/**
 * 行程判空只看行程项（镜像 lib/trip.js 的 dropTripIfEmpty / purgeIfNoItem）：
 * 只有免预约景点、没设提醒的行程**不能**被当成空壳删掉。
 */
function dropTripIfNoItem(tripId) {
  if (!tripId || tripId === PENDING_CART_TRIP_ID) return false;
  if (Object.values(db.tasks).some(t => t.tripId === tripId)) return false;
  if (Object.values(db.items).some(i => i.tripId === tripId)) return false;
  Object.keys(db.carts).forEach(id => { if (db.carts[id].tripId === tripId) delete db.carts[id]; });
  delete db.trips[tripId];
  clearPendingIfNoItems();
  return true;
}

/** 用户显式删掉最后一笔行程项后，清掉失去归属的暂存清单；普通新草稿不受影响。 */
function clearPendingIfNoItems() {
  if (Object.values(db.items).length > 0) return 0;
  let removed = 0;
  Object.keys(db.carts).forEach(id => {
    if (db.carts[id].tripId === PENDING_CART_TRIP_ID) {
      delete db.carts[id];
      removed += 1;
    }
  });
  return removed;
}

/** 摘要卡「即将提醒」胶囊：接下来的 limit 场放票（镜像云端 task.buildReleasePills）。
    ⚠️ 不限 BANNER_WINDOW_HOURS 窗口——横幅只覆盖眼下一小时，胶囊摊开的是「后面还有哪几场」。 */
function releasePillsOf(decorated, nowTs, limit) {
  /* 先按**放票时刻**分组再取前 limit 组：同一时刻的多条提醒合成一颗胶囊
     （「今天17:00 城楼/国博放票」）。limit 数的是**时间点**，不是项数。 */
  const groups = new Map();
  (decorated || [])
    .filter(d => d.releaseAt && new Date(d.releaseAt).getTime() > nowTs.getTime())
    .forEach(d => {
      const ts = new Date(d.releaseAt).getTime();
      if (!groups.has(ts)) groups.set(ts, []);
      groups.get(ts).push(d);
    });
  const today = fmt(nowTs);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([ts, items], i) => {
      const sorted = items.slice().sort((a, b) => String(a.spotName || '').localeCompare(String(b.spotName || '')));
      const rel = new Date(ts);
      const dayWord = fmt(rel) === today ? '今天' : (fmt(rel) === addDays(today, 1) ? '明天' : formatMonthDay(fmt(rel)));
      return {
        itemId: sorted[0].itemId, spotId: sorted[0].spotId,
        itemIds: sorted.map(x => x.itemId), spotIds: sorted.map(x => x.spotId),
        /* ⚠️ 末尾不带「放票」二字（与云端 task.buildReleasePills 逐字一致） */
        text: `${dayWord}${formatHourMinute(rel)} ${sorted.map(x => x.spotShort || x.spotName).join('/')}`,
        releaseAt: sorted[0].releaseAt, visitDate: sorted[0].visitDate,
        count: sorted.length, nearest: i === 0,
      };
    });
}

/** 清单归属的 tripId：不传 = 暂存区（镜像 cart.cartTripIdOf） */
function cartTripIdOf(tripId) { return tripId || PENDING_CART_TRIP_ID; }

/**
 * 挽回建议（镜像 lib/recovery.js 的三层）：
 *   ① 已设备选且备选未开票 → 静默（备选本身就是挽回方案）
 *   ② 没设备选、行程内还有可行动日期 → 给候选
 *   ③ 都没有 → 静默。**什么都不建议是合法的。**
 * 候选池 = 行程本身的日期范围（不含刚失败的那一天）。
 * 数据红线：不做同日回流票，不出现任何余票字段。
 *
 * ⚠️ `nowTs` / `decorated` 可传：`home.bootstrap` 要把候选与行程项算在**同一份
 * 响应、同一个时刻**上（镜像 repo 的 `recoverableMapOf` 为什么必须内联的那段）。
 * 不传时退回「读真实时钟 + 自己装饰兄弟项」的旧口径，供单测与 standalone 入口用。
 */
function mockRecoveryCandidates(failed, nowTs, decorated) {
  nowTs = nowTs || new Date();
  const trip = db.trips[failed.tripId] || null;
  const siblings = decorated || Object.values(db.items).filter(i => i.tripId === failed.tripId);

  /* 第 ① 层：同景点还有没到放票时间的备选 → 不打扰 */
  const sameSpot = siblings.filter(i =>
    i.spotId === failed.spotId && (i._id || i.itemId) !== (failed._id || failed.itemId));
  const pendingBackup = sameSpot.some(i => {
    /* `decorated` 传进来时已经是装饰结果（有 ticketState / ended / canMark），
       只有裸库文档才需要现算一次。 */
    const d = ('ticketState' in i) ? i : decorateItem(i, nowTs);
    return !d.ended && !d.canMark && d.ticketState === 'PENDING';
  });
  if (pendingBackup) return [];

  const startDate = trip ? trip.startDate : failed.visitDate;
  const endDate = trip ? trip.endDate : failed.visitDate;
  /* ⚠️ 必须排除「刚失败的那一天」：把 10月2日 原样建议回去，
     等于对用户刚说没成的事再说一次「再约这天吧」 */
  const taken = new Set([failed.visitDate].concat(sameSpot.map(i => i.visitDate)));
  const today = fmt(nowTs);

  const out = [];
  const seen = {};
  const collect = (spotId) => {
    const spot = SPOTS.find(s => s.spotId === spotId);
    const rule = RULES.find(r => r.spotId === spotId);
    if (!spot || !rule) return;
    const mine = [];
    dateRange(startDate, endDate).forEach(visitDate => {
      if (spotId === failed.spotId && taken.has(visitDate)) return;
      const key = spotId + '|' + visitDate;
      if (seen[key]) return;
      if (visitDate <= today) return;                          // 已过
      if (!isOpenOn(rule, dayNameOf(visitDate))) return;        // 闭馆 / 白名单不可约
      if (spot.reservationRequired === false) return;           // 免预约不构成挽回
      const releaseAt = deriveReleaseAt(spot, rule, visitDate);
      if (!releaseAt) return;                                   // 无固定放票规则
      seen[key] = true;
      const alreadyOnSale = releaseAt.getTime() <= nowTs.getTime();
      mine.push({
        spotId, spotName: spot.name, visitDate, releaseAt,
        action: alreadyOnSale ? 'BOOK_NOW' : 'SET_REMINDER',
        label: alreadyOnSale
          ? formatMonthDayWeekCn(visitDate) + ' 已开票，去官方渠道预约'
          : formatMonthDayWeekCn(visitDate) + ' ' + formatHourMinute(releaseAt) + ' 放票',
      });
    });
    /* 名额按行动类型各取一半：简单取前 N 条会被日期早的 BOOK_NOW 占满，
       用户就看不到「等下一场放票」这条路 */
    const bookNow = mine.filter(c => c.action === 'BOOK_NOW');
    const setReminder = mine.filter(c => c.action === 'SET_REMINDER');
    out.push(...bookNow.slice(0, 1), ...setReminder.slice(0, 1));
    if (out.length === 0) {
      const rest = mine.filter(c => out.indexOf(c) === -1);
      out.push(...rest.slice(0, 2));
    }
  };

  collect(failed.spotId);
  siblings.forEach(i => { if (i.spotId !== failed.spotId) collect(i.spotId); });

  return out.sort((a, b) => {
    const pa = a.action === 'BOOK_NOW' ? 0 : 1;
    const pb = b.action === 'BOOK_NOW' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.visitDate.localeCompare(b.visitDate);
  }).slice(0, 6);
}

/**
 * 「哪些行程项还能挽回」一次算清（镜像云端 `recovery.recoverableMapOf`，
 * 供 `home.bootstrap` 内联回填）。
 *
 * ⚠️ 2026-09-24：首页原先在 bootstrap 之后**另起一次请求**逐条算候选，
 *    两次响应之间没有顺序保证——卡片先按「FAILED 但不可挽回」渲染，
 *    挽回线就永远不出现（只在真机上偶发，本地看不出）。所以它必须内联。
 */
function mockRecoverableIds(decorated, nowTs) {
  const fails = decorated.filter(d => d.result === 'FAILED' && !d.ended);
  if (!fails.length) return [];
  const ids = [];
  fails.forEach(f => {
    const siblings = decorated.filter(d => d.tripId === f.tripId);
    /* 裸库文档形状与装饰结果不同（`_id` vs `itemId`），这里统一成装饰结果的读法 */
    if (mockRecoveryCandidates(
      { _id: f.itemId, itemId: f.itemId, tripId: f.tripId, spotId: f.spotId, visitDate: f.visitDate },
      nowTs,
      siblings
    ).length) ids.push(f.itemId);
  });
  return ids;
}

function purgeTripIfNoTask(tripId) {
  if (!tripId) return false;
  if (Object.values(db.tasks).some(t => t.tripId === tripId)) return false;
  if (Object.values(db.items).some(i => i.tripId === tripId)) return false;
  Object.keys(db.carts).forEach(id => { if (db.carts[id].tripId === tripId) delete db.carts[id]; });
  delete db.trips[tripId];
  clearPendingIfNoItems();
  return true;
}

/* ===== 时间线（镜像 lib/timeline.js：TIMELINE-RULE-001~005） ===== */
function difficultyOf(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约' };
  if (score === 3) return { key: 'NORMAL', text: '较难约' };
  return { key: 'EASY', text: '容易约' };
}
function hasReleaseSchedule(rule) {
  return !!(rule && rule.advanceDays && (rule.releaseTime || (rule.releaseTimes || []).length));
}
function buildEvents(spot, rule, seg) {
  const base = {
    spotId: spot.spotId,
    spotName: spot.name,
    reservationRequired: spot.reservationRequired !== false,
    remindable: false,
    weak: spot.reservationRequired !== false
      && spot.strongReminder !== true
      && (spot.difficultyScore || 0) <= 2,
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
  };
  if (spot.reservationRequired === false) {
    return dateRange(seg.startDate, seg.endDate).map(visitDate => ({
      ...base,
      difficulty: null,
      visitDate,
      releaseAt: null,
      releaseDateStr: '',
      releaseTimeStr: '',
      visitDateLabel: formatMonthDayWeek(visitDate),
      advanceDays: null,
      remindOnDefault: false,
    }));
  }
  if (!hasReleaseSchedule(rule)) {
    return dateRange(seg.startDate, seg.endDate)
      .filter(visitDate => !rule || isOpenOn(rule, dayNameOf(visitDate)))
      .map(visitDate => ({
        ...base,
        difficulty: difficultyOf(spot.difficultyScore),
        visitDate,
        releaseAt: null,
        releaseDateStr: '',
        releaseTimeStr: '随买随用',
        visitDateLabel: formatMonthDayWeek(visitDate),
        advanceDays: null,
        remindOnDefault: false,
      }));
  }
  const events = [];
  for (const visitDate of dateRange(seg.startDate, seg.endDate)) {
    if (!isOpenOn(rule, dayNameOf(visitDate))) continue;
    const releaseDate = addDays(visitDate, -rule.advanceDays);
    events.push({
      ...base,
      remindable: true,
      difficulty: difficultyOf(spot.difficultyScore),
      visitDate,
      releaseAt: parseBeijing(releaseDate, rule.releaseTime),
      releaseDateStr: releaseDate,
      releaseTimeStr: rule.releaseTime,
      visitDateLabel: formatMonthDayWeek(visitDate),
      advanceDays: rule.advanceDays,
      remindOnDefault: !base.weak,
    });
  }
  return events;
}
function releaseStateOf(event, nowTs = new Date()) {
  if (!event || event.reservationRequired === false) {
    return { key: 'NO_RESERVATION', label: '无需预约' };
  }
  if (event.remindable === false || !event.releaseAt) {
    return { key: 'NO_FIXED_RELEASE', label: '随买随用' };
  }
  const releaseAt = event.releaseAt instanceof Date ? event.releaseAt : new Date(event.releaseAt);
  if (Number.isNaN(releaseAt.getTime()) || releaseAt.getTime() > nowTs.getTime()) {
    return { key: 'NOT_RELEASED', label: '待开票' };
  }
  return { key: 'RELEASED', label: '已开票' };
}
function resolveStatus(event, ctx = {}) {
  const { inCart = false, committed = false } = ctx || {};
  if (committed) return 'COMMITTED';
  if (inCart) return 'IN_CART';
  return 'SELECTABLE';
}
/* ⚠️ 与 `cloudfunctions/reminder/lib/timeline.js` 的 buttonOf **逐字一致**（2026-09-24 统一文案）：
   加清单类按钮文案 = 「加入清单 / 已加清单 / 已加行程」。改一边必须改另一边，否则模拟器与
   真机文案对不上，而两边单测各自都是绿的。 */
function buttonOf(status, event = {}) {
  const tripOnly = event.reservationRequired === false || event.remindable === false;
  switch (status) {
    case 'SELECTABLE': return tripOnly ? { text: '加入行程', enabled: true } : { text: '加入清单', enabled: true };
    case 'IN_CART': return { text: tripOnly ? '已加入清单' : '已加清单', enabled: true, openCart: true };
    case 'COMMITTED': return { text: '已加行程', enabled: false };
    default: return { text: '', enabled: false };
  }
}
function defaultScrollIndex(events, nowTs = new Date()) {
  const sorted = [...events].sort((a, b) => a.releaseAt - b.releaseAt);
  const idx = sorted.findIndex(e => e.releaseAt && e.releaseAt.getTime() > nowTs.getTime());
  return idx === -1 ? Math.max(0, sorted.length - 1) : idx;
}
function groupByDeparture(events, nowTs, tripStartDate = '') {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.visitDate)) map.set(e.visitDate, []);
    map.get(e.visitDate).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([visitDate, list]) => {
      const sorted = list.sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
      return {
        key: visitDate,
        label: formatMonthDayWeek(visitDate),
        /* 与云端一致：相对行程首日算，首日无事件也不能把次日误标成第1天。 */
        dayLabel: tripStartDate ? `【第${diffDays(tripStartDate, visitDate) + 1}天】` : '',
        events: sorted,
        count: sorted.length,
        scrollIndex: defaultScrollIndex(sorted, nowTs),
      };
    });
}
function groupBySpot(events, nowTs) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.spotId)) map.set(e.spotId, []);
    map.get(e.spotId).push(e);
  }
  return [...map.entries()].map(([spotId, list]) => {
    const sorted = list.sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
    return { key: spotId, label: sorted[0].spotName, events: sorted, count: sorted.length, scrollIndex: defaultScrollIndex(sorted, nowTs) };
  }).sort((a, b) => (a.events[0].releaseAt ? a.events[0].releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.events[0].releaseAt ? b.events[0].releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
}
/* ===== 行程项展示态推导（镜像 cloudfunctions/reminder/lib/item.js）=====
   六个展示态的唯一真身在前端这一侧的副本。⚠️ 云端改动必须同步这里，
   test/mock-mirror.test.js 会交叉断言两边对同一组输入给出同一结果。 */

/** 放票时刻由规则推算（镜像 item.deriveReleaseAt / timeline.buildEvents 的口径） */
function deriveReleaseAt(spot, rule, visitDate) {
  if (!spot || spot.reservationRequired === false) return null;
  if (!rule || !rule.advanceDays) return null;
  const releaseTime = rule.releaseTime || (rule.releaseTimes || [])[0];
  if (!releaseTime) return null;
  return parseBeijing(addDays(visitDate, -rule.advanceDays), releaseTime);
}

/* ⚠️ 云端 `cloudfunctions/reminder/lib/item.js` 的 TICKET_STATE_LABEL 是唯一真身，
   这里是镜像，`test/mock-mirror.test.js` 交叉比对。
   2026-09-22 六个展示态**整体换词**（待抢→待抢票、可抢→可抢票、已成→已约到、
   未成→未抢到、开过票了→未标记；2026-09-28「未标记」→「待确认」），换的是**文案不是语义**：
   `UNMARKED` 仍是中性态，别因为「待确认」字面需要用户确认就把它改判成失败。 */
const TICKET_LABEL = {
  PENDING: '待抢票', BOOKABLE: '可抢票', SUCCESS: '已约到',
  FAILED: '未抢到',
  /* UNMARKED 是中性态，不是「未抢到」——放票过了 24 小时没标记不代表没抢到 */
  UNMARKED: '待确认',
  NO_RESERVATION: '免预约',
};
const REMINDER_LABEL = { NOT_SET: '未设提醒', WAITING: '待提醒', TRIGGERED: '已提醒', MISSED: '未送达' };

/**
 * ENUM-007 票务展示状态。计算顺序固定：
 * 免预约 → 人工结果 → 放票前 → 放票后 24h 内 → 待确认
 */
function ticketStateLabelOf(state) { return TICKET_LABEL[state] || '待抢票'; }

/**
 * 现在还能不能开启/取消提醒（镜像 item.canSetReminder，2026-09-23）。
 * 判据 = 需预约 && 有放票时刻 && **放票时刻还没到**。放票一过，开启会即刻被判
 * MISSED（刚点完就看到「未送达」），取消则无任务可取消 —— 两个动作都没有意义。
 * ⚠️ 与「待抢票」不等价：清单先加、放票后才提交的项是可抢票态，但也没有入口。
 */
function canSetReminderOf(reservationRequired, releaseAt, nowTs) {
  if (reservationRequired === false) return false;
  if (!releaseAt) return false;
  return new Date(releaseAt).getTime() > nowTs.getTime();
}

function ticketStateOf(item, reservationRequired, releaseAt, nowTs) {
  if (reservationRequired === false) return 'NO_RESERVATION';
  if (item && item.result === 'SUCCESS') return 'SUCCESS';
  if (item && item.result === 'FAILED') return 'FAILED';
  if (!releaseAt) return 'PENDING';
  const passed = nowTs.getTime() - new Date(releaseAt).getTime();
  if (passed < 0) return 'PENDING';
  return passed <= UNMARKED_AFTER_HOURS * 3600000 ? 'BOOKABLE' : 'UNMARKED';
}

/** 提醒送达态，与票务状态分离（ENUM-009） */
function reminderStateOf(task, remindOn, nowTs) {
  if (!remindOn || !task) return { state: 'NOT_SET', stateLabel: REMINDER_LABEL.NOT_SET, reason: null };
  let status = task.backendStatus;
  if (status === 'WAITING' && task.releaseAt && new Date(task.releaseAt).getTime() <= nowTs.getTime()) {
    status = 'MISSED';
  }
  let state = 'WAITING';
  if (status === 'TRIGGERED') state = 'TRIGGERED';
  else if (status === 'MISSED') state = 'MISSED';
  const reason = state === 'MISSED' ? (task.missedReason || task.lastSendError || '超过放票时间点未触发成功') : null;  return { state, stateLabel: REMINDER_LABEL[state], reason, channels: task.channels || [], offsets: task.offsets || [] };
}

/** 组装对外行程项（镜像 item.decorateItem，字段名/语义必须逐一对齐） */
function decorateItem(item, nowTs) {
  const spot = SPOTS.find(s => s.spotId === item.spotId);
  const rule = RULES.find(r => r.spotId === item.spotId) || null;
  const reservationRequired = !spot || spot.reservationRequired !== false;
  const releaseAt = deriveReleaseAt(spot, rule, item.visitDate);
  const ticketState = ticketStateOf(item, reservationRequired, releaseAt, nowTs);
  const task = Object.values(db.tasks).find(t => t.itemId === item._id) || null;
  const marked = item.result === 'SUCCESS' || item.result === 'FAILED';
  return {
    itemId: item._id,
    tripId: item.tripId,
    spotId: item.spotId,
    spotName: spot ? spot.name : '未知景点',
    spotShort: spot ? (spot.shortName || spot.name) : '未知景点',
    visitDate: item.visitDate,
    backupGroupId: item.backupGroupId || (item.tripId + ':' + item.spotId),
    reservationRequired,
    remindOn: reservationRequired && item.remindOn === true,
    releaseAt,
    difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
    ticketState,
    ticketStateLabel: TICKET_LABEL[ticketState],
    /* 预约入口不因进入「待确认」或标记失败而消失，保留到出行日 23:59 */
    bookingEntryEnabled: reservationRequired && Boolean(item.visitDate) && fmt(new Date()) <= item.visitDate,
    canMark: reservationRequired && Boolean(releaseAt)
      && nowTs.getTime() >= new Date(releaseAt).getTime()
      && !marked && fmt(new Date()) <= item.visitDate,
    /* 菜单据此渲染「开启提醒 / 取消提醒」，与 updateReminder 的闸门同源 */
    canSetReminder: canSetReminderOf(reservationRequired, releaseAt, nowTs),
    result: item.result || null,
    resultAt: item.resultAt || null,
    undoUntil: item.resultAt
      ? new Date(new Date(item.resultAt).getTime() + RESULT_UNDO_SECONDS * 1000) : null,
    ended: fmt(new Date()) > item.visitDate,
    reminder: reminderStateOf(task, reservationRequired && item.remindOn === true, nowTs),
  };
}

/** 门票进度：分母按 backupGroupId 去重，免预约不进分母（镜像 item.backupGroupProgress） */
function backupGroupProgress(items) {
  const groups = {};
  let noReservationCount = 0;
  (items || []).forEach(it => {
    if (it.reservationRequired === false) { noReservationCount += 1; return; }
    const key = it.backupGroupId || (it.tripId + ':' + it.spotId);
    (groups[key] = groups[key] || []).push(it);
  });
  let done = 0;
  Object.keys(groups).forEach(k => {
    if (groups[k].some(i => i.result === 'SUCCESS')) done += 1;
  });
  return { done, total: Object.keys(groups).length, noReservationCount };
}

/**
 * 纯预览（镜像 cloudfunctions/reminder/lib/timeline.preview，2026-09-20）
 *
 * 按当前所选日期段与景点独立计算，**不创建/改写任何行程，也不读任何已落库状态**。
 * 所以这里刻意不查 db.carts / db.items / db.tasks —— 查了就会把历史状态带进预览，
 * 用户换一批日期重新生成时会看到属于上一趟行程的「已在行程」。
 */
function previewTimeline(input) {
  const segs = (Array.isArray(input.segments) && input.segments.length > 0)
    ? input.segments.filter(sg => sg && sg.spotId && sg.startDate && sg.endDate)
    : (input.spotIds || []).map(spotId => ({ spotId, startDate: input.startDate, endDate: input.endDate }));
  const startDate = input.startDate;
  const endDate = input.endDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || startDate > endDate) {
    return { success: false, error: '行程日期不合法', errorCode: 1006 };
  }
  if (segs.length === 0) {
    return { success: true, events: [], byDeparture: [], bySpot: [], closedSpots: [], closedDaySkips: [], empty: true, emptyReason: '先选择想去的景点' };
  }

  /* ⚠️ 预览只读两样，界线各不相同（与云端 lib/timeline.js 的 preview 逐条对齐）：
     ① 当前暂存清单：用户正在这一页做的工作，不反映它按钮就像坏的（点了没变化、
        再点提示「已经在清单里啦」）；
     ② committedTripId 那一趟行程的行程项：用户此刻正在编辑的那趟已经有的项，
        要标成「已加入行程」禁选，否则他看不见已有项、不知道还该补哪个。
        只读这一趟，绝不读别趟——读别趟会把属于另一趟行程的状态带进预览。 */
  const want = cartTripIdOf(null);
  const cartKeys = {};
  Object.values(db.carts).forEach(c => {
    if (c.tripId === want) cartKeys[c.spotId + '|' + c.visitDate] = true;
  });
  const committedKeys = {};
  if (input.committedTripId) {
    /* 按 userId 一起过滤：只读**自己**那一趟的项。云端查询天生带 userId，
       这里漏掉就等于 mock 比云端宽松，而宽松的那一侧永远测不出越权。 */
    Object.values(db.items).forEach(it => {
      if (it.tripId === input.committedTripId && it.userId === mockUser.openId) {
        committedKeys[it.spotId + '|' + it.visitDate] = true;
      }
    });
  }

  const nowTs = new Date();
  const events = [];
  const closedSpots = [];
  const closedDaySkips = [];

  segs.forEach(seg => {
    const spot = SPOTS.find(s => s.spotId === seg.spotId);
    if (!spot) return;
    const rule = RULES.find(r => r.spotId === seg.spotId) || null;
    const built = buildEvents(spot, rule, seg);
    if (built.length === 0) {
      if (!hasReleaseSchedule(rule)) {
        closedSpots.push({ spotId: seg.spotId, spotName: spot.name, note: '无固定放票时刻，暂不生成提醒' });
      } else {
        closedSpots.push({ spotId: seg.spotId, spotName: spot.name, note: (rule.openDays || []).length > 0 ? '行程期间不可约' : '行程期间闭馆' });
      }
      return;
    }
    const skipped = rule ? dateRange(seg.startDate, seg.endDate).filter(d => !isOpenOn(rule, dayNameOf(d))) : [];
    if (skipped.length > 0) {
      const isWhitelist = (rule.openDays || []).length > 0;
      closedDaySkips.push({
        spotId: seg.spotId,
        spotName: spot.name,
        note: skipped.map(d => formatMonthDayWeek(d)).join('、') + (isWhitelist ? ' 不可约，已为你跳过' : ' 闭馆，已为你跳过'),
      });
    }
    built.forEach(event => {
      /* inCart = 当前暂存清单；committed = 仅限 committedTripId 那一趟行程 */
      const key = event.spotId + '|' + event.visitDate;
      const status = resolveStatus(event, {
        inCart: !!cartKeys[key],
        committed: !!committedKeys[key],
      });
      const releaseState = releaseStateOf(event, nowTs);
      events.push({
        ...event,
        releaseState: releaseState.key,
        releaseStateLabel: releaseState.label,
        status,
        button: buttonOf(status, event),
        stale: false,
      });
    });
  });

  return {
    success: true,
    events,
    byDeparture: groupByDeparture(events, nowTs, startDate),
    bySpot: groupBySpot ? groupBySpot(events) : [],
    closedSpots,
    closedDaySkips,
    empty: events.length === 0,
    emptyReason: events.length === 0
      ? (closedSpots.length > 0 ? '该日期段暂无可提醒的放票时间' : '先选择想去的景点') : null,
  };
}

function generateTimeline(tripId) {
  const trip = db.trips[tripId];
  if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
  const segs = normalizeSpots(trip);
  const spotIds = segs.map(s => s.spotId);
  if (spotIds.length === 0) {
    return { success: true, tripId, events: [], byDeparture: [], bySpot: [], closedSpots: [], empty: true, emptyReason: '先选择想去的景点' };
  }
  const segMap = {};
  segs.forEach(s => { segMap[s.spotId] = s; });
  const nowTs = new Date();
  const events = [];
  const closedSpots = [];
  const closedDaySkips = [];
  for (const spotId of spotIds) {
    const seg = segMap[spotId];
    if (!seg) continue;
    const spot = SPOTS.find(s => s.spotId === spotId);
    if (!spot) continue;
    const rule = RULES.find(r => r.spotId === spotId) || null;
    const built = buildEvents(spot, rule, seg);
    if (built.length === 0) {
      if (!hasReleaseSchedule(rule)) {
        closedSpots.push({ spotId, spotName: spot.name, note: '无固定放票时刻，暂不生成提醒' });
      } else {
        closedSpots.push({ spotId, spotName: spot.name, note: (rule.openDays || []).length > 0 ? '行程期间不可约' : '行程期间闭馆' });
      }
      continue;
    }
    // 与云端 timeline.generate 一致的 closedDaySkips（按该景点自己的段统计）
    const skipped = rule
      ? dateRange(seg.startDate, seg.endDate).filter(d => !isOpenOn(rule, dayNameOf(d)))
      : [];
    if (skipped.length > 0) {
      const isWhitelist = (rule.openDays || []).length > 0;
      closedDaySkips.push({
        spotId,
        spotName: spot.name,
        note: skipped.map(d => formatMonthDayWeek(d)).join('、') + (isWhitelist ? ' 不可约，已为你跳过' : ' 闭馆，已为你跳过'),
      });
    }
    for (const event of built) {
      const key = `${event.spotId}|${event.visitDate}`;
      const inCart = Object.values(db.carts).some(c => c.tripId === tripId && `${c.spotId}|${c.visitDate}` === key);
      const committed = Object.values(db.items).some(i => i.tripId === tripId && `${i.spotId}|${i.visitDate}` === key);
      const status = resolveStatus(event, { inCart, committed });
      const releaseState = releaseStateOf(event, nowTs);
      events.push({
        ...event,
        releaseState: releaseState.key,
        releaseStateLabel: releaseState.label,
        status,
        button: buttonOf(status, event),
        stale: false,
      });
    }
  }
  const validKeys = new Set(events.map(e => `${e.spotId}|${e.visitDate}`));
  Object.keys(db.carts).forEach((id) => {
    const c = db.carts[id];
    if (c.tripId === tripId && !validKeys.has(`${c.spotId}|${c.visitDate}`)) delete db.carts[id];
  });
  events.sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
  return {
    success: true,
    tripId,
    trip: { _id: tripId, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, spotIds, spots: segs },
    events,
    byDeparture: groupByDeparture(events, nowTs, trip.startDate),
    bySpot: groupBySpot ? groupBySpot(events) : [],
    closedSpots,
    closedDaySkips,
    empty: events.length === 0,
    emptyReason: events.length === 0 ? (closedSpots.length > 0 ? '该行程暂无可提醒的放票时间' : '先选择想去的景点') : null,
  };
}

/* ===== Banner（镜像 lib/task.js buildBanner：REMINDER-RULE-008） ===== */
function buildMockBanner(tasks, nowTs = new Date()) {
  const soon = tasks
    .filter(t => t.backendStatus === 'WAITING')
    .map(t => ({ ...t, releaseAtTs: new Date(t.releaseAt).getTime() }))
    .filter(t => { const diff = t.releaseAtTs - nowTs.getTime(); return diff > 0 && diff <= 3600 * 1000; })
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];
  if (!soon) return null;
  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - nowTs.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  const isToday = toDateStr(releaseAt) === toDateStr(nowTs);
  const isTomorrow = toDateStr(releaseAt) === addDays(toDateStr(nowTs), 1);
  const rp = beijingParts(releaseAt);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${rp.month}月${rp.day}日`);
  const vp = beijingParts(parseBeijing(soon.visitDate, '12:00'));
  return {
    type: 'UPCOMING',
    text: `${dayWord}${formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${vp.month}月${vp.day}日的门票`,
    taskId: soon._id,
    minutesLeft,
  };
}

/* ===== 授权额度健康度（镜像 reminder/lib/task.js，按未发送 offset 计数） ===== */
const MOCK_QUOTA_SAFE_BUFFER = 1;
const MOCK_QUOTA_WARNING_WINDOW_HOURS = 48;

function mockReminderHealthOf(tasks, remainingQuota, nowTs = new Date()) {
  const nowMs = nowTs.getTime();
  const quota = Math.max(0, Number(remainingQuota) || 0);
  let pendingMessageCount = 0;
  let nearestRemindAt = null;

  (tasks || []).forEach(t => {
    if (!t || t.backendStatus !== 'WAITING') return;
    const releaseMs = new Date(t.releaseAt).getTime();
    if (!Number.isFinite(releaseMs) || releaseMs <= nowMs) return;
    const sent = new Set(t.sentOffsets || []);
    (t.offsets || []).forEach(offset => {
      if (sent.has(offset)) return;
      pendingMessageCount += 1;
      const remindAt = new Date(releaseMs - offset * 60000);
      if (!nearestRemindAt || remindAt.getTime() < nearestRemindAt.getTime()) nearestRemindAt = remindAt;
    });
  });

  let level = 'idle';
  if (pendingMessageCount > 0) {
    if (quota >= pendingMessageCount + MOCK_QUOTA_SAFE_BUFFER) level = 'ready';
    else if (quota === pendingMessageCount) level = 'low';
    else if (quota > 0) level = 'short';
    else level = 'exhausted';
  }

  return {
    level,
    remainingQuota: quota,
    pendingMessageCount,
    nearestRemindAt,
    shortfall: Math.max(0, pendingMessageCount - quota),
    replenishNeeded: Math.max(0, pendingMessageCount + MOCK_QUOTA_SAFE_BUFFER - quota),
  };
}

function mockReminderQuotaWarningOf(health, nowTs = new Date()) {
  if (!health || !['low', 'short', 'exhausted'].includes(health.level)) return null;
  if (!health.nearestRemindAt) return null;
  /* 与云端 task.buildReminderQuotaWarning 同口径：short/exhausted 是真实缺口，
     不受 48 小时窗口限制；只有 low（刚好够、仅缺 1 次缓冲）保留窗口。 */
  const withinWindow = health.nearestRemindAt.getTime() - nowTs.getTime()
    <= MOCK_QUOTA_WARNING_WINDOW_HOURS * 3600000;
  if (health.level === 'low' && !withinWindow) return null;
  let text = '';
  if (health.level === 'low') text = '提醒授权即将用完，建议续收 1 次。';
  else if (health.level === 'exhausted') text = '提醒授权已用完，未来提醒可能收不到。';
  else text = `还有${health.pendingMessageCount}条提醒待发送，还差${health.shortfall}次授权，可能收不到。`;
  return Object.assign({}, health, { type: 'QUOTA', text });
}

/* ===== 无感登录（2026-08-24 重构：进小程序即自动建号，镜像 reminder user.profile） ===== */
function genAutoProfile() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return {
    nickname: '用户' + s,
    avatarUrl: '/images/avatars/default-' + (1 + Math.floor(Math.random() * 6)) + '.png',
  };
}
const mockUser = {
  openId: 'mock-user',
  ...genAutoProfile(),
  phone: '',
  memberLevel: 'NORMAL',
  memberSince: null,
  memberExpiresAt: null,
  taskPackCount: 0,
  taskPackSlots: 0,
  protectedTaskQuota: 5,
  protectionMigratedAt: new Date(),
  lastReminderCreatedAt: null,
  points: 0,
  subscribeQuota: 0,
  subscribeQuotas: {},
  notifyPrefs: { officialAccount: false, sms: false, offsets: [5, 2] },
};

const FREE_TASK_SLOTS = 5;
const MEMBER_TASK_SLOTS = 15;
const TASK_PACK_SIZE = 10;
const LEGACY_TASK_PACK_SIZE = 5;
const MEMBER_PRICE_FEN = 300;
const TASK_PACK_PRICE_FEN = 300;
const MEMBER_DURATION_DAYS = 30;
const MOCK_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

function mockPriceText(amountFen) {
  return `¥${(Number(amountFen) / 100).toFixed(2).replace(/\.00$/, '')}`;
}

const MOCK_MEMBERSHIP_PACKAGES = Object.freeze([
  {
    id: 'member',
    type: 'MEMBER',
    title: '会员 30 天',
    priceFen: MEMBER_PRICE_FEN,
    taskSlots: MEMBER_TASK_SLOTS,
    addedSlots: MEMBER_TASK_SLOTS - FREE_TASK_SLOTS,
    memberDays: MEMBER_DURATION_DAYS,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: `${MEMBER_DURATION_DAYS} 天内最多 ${MEMBER_TASK_SLOTS} 个提醒名额`,
    badge: '推荐',
    specVersion: 'member-30d-v2',
  },
  {
    id: 'task_pack_5',
    type: 'TASK_PACK',
    title: `${TASK_PACK_SIZE} 个提醒名额`,
    priceFen: TASK_PACK_PRICE_FEN,
    taskSlots: TASK_PACK_SIZE,
    addedSlots: TASK_PACK_SIZE,
    memberDays: 0,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: '名额永久记录，会员有效期内生效',
    badge: '',
    specVersion: 'task-pack-10-v2',
  },
]);

function mockPackageOf(packageId) {
  return MOCK_MEMBERSHIP_PACKAGES.find(item => item.id === packageId) || null;
}

function mockMembershipSnapshot(nowTs = new Date()) {
  const memberExpiresMs = new Date(mockUser.memberExpiresAt || 0).getTime();
  const member = Number.isFinite(memberExpiresMs) && memberExpiresMs > nowTs.getTime();
  const taskPackCount = member ? Math.max(0, Number(mockUser.taskPackCount) || 0) : 0;
  const taskPackSlots = member
    ? Math.max(0, mockUser.taskPackSlots != null
      ? Number(mockUser.taskPackSlots) || 0
      : taskPackCount * LEGACY_TASK_PACK_SIZE)
    : 0;
  const protectedTaskQuota = Math.max(FREE_TASK_SLOTS, Number(mockUser.protectedTaskQuota) || FREE_TASK_SLOTS);
  const entitlementTaskLimit = FREE_TASK_SLOTS
    + (member ? MEMBER_TASK_SLOTS - FREE_TASK_SLOTS : 0)
    + taskPackSlots;
  const activeTasks = Object.values(db.tasks).filter(t =>
    t.backendStatus === 'WAITING'
    && Number.isFinite(new Date(t.releaseAt).getTime())
    && new Date(t.releaseAt).getTime() > nowTs.getTime());
  const protectedTaskUsed = activeTasks.filter(t => {
    if (t.quotaPool === 'PROTECTED') return true;
    if (t.quotaPool === 'ENTITLEMENT') return false;
    return true;
  }).length;
  const taskUsed = activeTasks.length - protectedTaskUsed;
  return {
    member,
    memberLevel: member ? 'MEMBER' : 'NORMAL',
    memberExpiresAt: mockUser.memberExpiresAt || null,
    memberExpiresAtText: member
      ? `${beijingParts(new Date(memberExpiresMs)).year}年${beijingParts(new Date(memberExpiresMs)).month}月${beijingParts(new Date(memberExpiresMs)).day}日`
      : '',
    memberDaysRemaining: member
      ? Math.max(1, Math.ceil((memberExpiresMs - nowTs.getTime()) / DAY_MS))
      : 0,
    taskLimit: entitlementTaskLimit,
    entitlementTaskLimit,
    protectedTaskQuota: Math.max(protectedTaskQuota, protectedTaskUsed),
    taskUsed,
    protectedTaskUsed,
    entitlementTaskUsed: taskUsed,
    taskRemaining: Math.max(0, entitlementTaskLimit - taskUsed),
    taskPackCount,
    taskPackSlots,
    ownedTaskPackCount: Math.max(0, Number(mockUser.taskPackCount) || 0),
    memberDurationDays: MEMBER_DURATION_DAYS,
    freeTaskSlots: FREE_TASK_SLOTS,
    memberTaskSlots: MEMBER_TASK_SLOTS,
    taskPackSize: TASK_PACK_SIZE,
  };
}

function mockMembershipSalesView() {
  const current = db.paymentConfig.membership_sales || {};
  const purchaseEnabled = current.state !== 'PAUSED';
  return {
    state: purchaseEnabled ? 'OPEN' : 'PAUSED',
    purchaseEnabled,
    message: purchaseEnabled
      ? ''
      : '会员购买暂停中，已有会员权益、订单和售后不受影响。',
    reason: current.reason || '',
    updatedAt: current.updatedAt || null,
    updatedBy: current.updatedBy || '',
  };
}

function mockMembershipEnforcementView() {
  const current = db.paymentConfig.membership_enforcement || {};
  const mode = ['off', 'test', 'all'].includes(current.mode) ? current.mode : '';
  const labels = { off: '已关闭', test: '测试账号', all: '全量用户' };
  const descriptions = {
    off: '所有新提醒进入历史保护池，不占免费或会员名额。',
    test: '仅测试 OpenID 的新提醒受名额限制，其他用户进入保护池。',
    all: '所有用户的新提醒都受 5 / 15 个名额限制。',
  };
  const shortDescriptions = {
    off: '新提醒不进入名额池',
    test: '仅测试账号受名额限制',
    all: '全部新提醒受名额限制',
  };
  return {
    mode,
    modeLabel: mode ? labels[mode] : '环境变量',
    description: mode
      ? descriptions[mode]
      : '尚未写入后台配置，reminder 暂按环境变量执行。',
    shortDescription: mode
      ? shortDescriptions[mode]
      : '尚未接管，暂按环境变量执行',
    configured: !!mode,
    source: mode ? 'DB' : 'UNSET',
    updatedAt: current.updatedAt || null,
    updatedBy: current.updatedBy || '',
    readError: false,
  };
}

function mockMembershipPackages(snapshot) {
  const sales = mockMembershipSalesView();
  return MOCK_MEMBERSHIP_PACKAGES.map(item => {
    const priceText = mockPriceText(item.priceFen);
    const isMemberPackage = item.type === 'MEMBER';
    const available = sales.purchaseEnabled && (isMemberPackage || snapshot.member);
    return {
      ...item,
      priceText,
      available,
      actionText: !sales.purchaseEnabled
        ? sales.message
        : (isMemberPackage
          ? `${snapshot.member ? '续费' : '开通会员'} ${priceText}`
          : (snapshot.member ? `加购 ${item.addedSlots} 个名额 ${priceText}` : '先开通会员')),
    };
  });
}


const MOCK_REFUND_LABEL = {
  NONE: '',
  REQUESTED: '售后处理中',
  UNDER_REVIEW: '退款审核中',
  PROCESSING: '退款处理中',
  REFUNDED: '已退款',
  REJECTED: '退款未通过',
  FAILED: '退款异常',
};
const MOCK_CASE_STATUS_LABEL = {
  SUBMITTED: '已提交',
  AUTO_CHECKING: '自动核验中',
  UNDER_REVIEW: '客服审核中',
  PROCESSING: '退款处理中',
  REFUNDED: '已退款',
  REJECTED: '已驳回',
  REFUND_FAILED: '退款异常',
  CANCELLED: '用户已取消',
};
const MOCK_CASE_TYPE_LABEL = {
  RIGHTS_NOT_RECEIVED: '权益未到账',
  DUPLICATE_CHARGE: '重复支付',
  UNUSED_REFUND: '未使用退款',
  ENTITLEMENT_MISMATCH: '权益不符',
  OTHER: '其他问题',
};

function mockOrderEligibility(order) {
  const paidMs = new Date(order.paidAt || 0).getTime();
  const lastMs = new Date(mockUser.lastReminderCreatedAt || 0).getTime();
  const nowMs = Date.now();
  const refundStatus = order.refundStatus || 'NONE';
  const inProgress = ['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'].includes(refundStatus);
  const usedAfterPurchase = paidMs > 0 && lastMs > paidMs;
  const withinWindow = paidMs > 0 && nowMs - paidMs <= 24 * 60 * 60 * 1000;
  return {
    withinWindow,
    usedAfterPurchase,
    alreadyRefunded: refundStatus === 'REFUNDED',
    refundInProgress: inProgress,
    hoursSincePaid: paidMs ? Math.floor((nowMs - paidMs) / 3600000) : null,
    eligibleForReview: order.status === 'PAID' && withinWindow && !usedAfterPurchase && !inProgress,
  };
}

function mockOrderActions(order, eligibility) {
  const purchaseEnabled = mockMembershipSalesView().purchaseEnabled;
  const refundStatus = order.refundStatus || 'NONE';
  const createdMs = new Date(order.createdAt || 0).getTime();
  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : (createdMs + 15 * 60 * 1000);
  const pendingExpired = order.status === 'PENDING' && expiresMs > 0 && expiresMs <= Date.now();
  const canAfterSales = order.status === 'PAID'
    && ['NONE', 'REQUESTED', 'UNDER_REVIEW', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED'].includes(refundStatus);
  const canSync = order.status === 'PAID' && ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus);
  const actionFlags = {
    canPay: purchaseEnabled && order.status === 'PENDING' && !pendingExpired,
    canCancel: order.status === 'PENDING' && !pendingExpired,
    canSync,
    canAfterSales,
    canRebuy: purchaseEnabled && (order.status === 'CLOSED' || pendingExpired),
    afterSalesLabel: ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus) ? '未到账/申请售后' : '查看售后进度',
  };
  const actions = [];
  if (actionFlags.canPay) actions.push({ key: 'PAY', label: '继续支付' });
  if (actionFlags.canCancel) actions.push({ key: 'CANCEL', label: '取消订单' });
  if (actionFlags.canSync) actions.push({ key: 'SYNC', label: '同步支付结果' });
  if (actionFlags.canAfterSales) actions.push({ key: 'AFTER_SALES', label: actionFlags.afterSalesLabel });
  if (actionFlags.canRebuy) actions.push({ key: 'REBUY', label: '重新购买' });
  return {
    actions,
    actionFlags,
    canRequestRefund: eligibility.eligibleForReview,
  };
}

function mockOrderView(order) {
  const refundStatus = order.refundStatus || 'NONE';
  const eligibility = mockOrderEligibility(order);
  const actionState = mockOrderActions(order, eligibility);
  const createdMs = new Date(order.createdAt || 0).getTime();
  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : (createdMs + 15 * 60 * 1000);
  return {
    _id: order._id,
    outTradeNo: order.outTradeNo,
    packageId: order.packageId,
    productType: order.productType,
    title: order.title,
    amountFen: order.amountFen,
    amountText: `¥${(order.amountFen / 100).toFixed(2).replace(/\.00$/, '')}`,
    addedSlots: order.addedSlots || 0,
    memberDays: order.memberDays || 0,
    status: order.status,
    statusLabel: ({ PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', REFUNDED: '已退款' })[order.status] || '处理中',
    refundStatus,
    refundStatusLabel: MOCK_REFUND_LABEL[refundStatus] || '',
    refundAmountFen: order.refundedAmountFen || 0,
    refundedAtText: order.refundedAt
      ? `${fmt(order.refundedAt)} ${pad(beijingParts(order.refundedAt).hour)}:${pad(beijingParts(order.refundedAt).minute)}` : '',
    grantStatus: order.grantStatus || (order.status === 'PAID' ? 'UNKNOWN' : 'NONE'),
    entitlementStatus: refundStatus === 'REFUNDED' || order.grantStatus === 'REVERTED'
      ? 'REFUNDED'
      : (order.status === 'PAID'
        ? (order.grantStatus === 'FAILED'
          ? 'PAID_GRANT_FAILED'
          : (order.grantStatus === 'GRANTED' ? 'PAID_GRANTED' : 'PAID_GRANT_UNKNOWN'))
        : (order.status === 'CLOSED' ? 'CLOSED' : 'PENDING')),
    entitlementGrant: order.entitlementGrant || null,
    canRequestRefund: actionState.canRequestRefund,
    refundEligibility: eligibility,
    isExpired: order.status === 'PENDING' && expiresMs > 0 && expiresMs <= Date.now(),
    actions: actionState.actions,
    actionFlags: actionState.actionFlags,
    createdAt: order.createdAt,
    createdAtText: order.createdAt
      ? `${fmt(order.createdAt)} ${pad(beijingParts(order.createdAt).hour)}:${pad(beijingParts(order.createdAt).minute)}` : '',
    expiresAt: order.expiresAt || null,
    paidAt: order.paidAt || null,
    paidAtText: order.paidAt
      ? `${fmt(order.paidAt)} ${pad(beijingParts(order.paidAt).hour)}:${pad(beijingParts(order.paidAt).minute)}` : '',
  };
}

function mockAdminOrderView(order, options = {}) {
  const view = mockOrderView(order);
  const relatedCases = Object.values(db.afterSalesCases)
    .filter(item => item.orderId === order._id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latestCase = relatedCases[0] || null;
  const user = {
    openId: mockUser.openId,
    nickname: mockUser.nickname,
    avatarUrl: mockUser.avatarUrl,
    member: new Date(mockUser.memberExpiresAt || 0).getTime() > Date.now(),
    memberExpiresAt: mockUser.memberExpiresAt || null,
    memberExpiresAtText: mockUser.memberExpiresAt
      ? new Date(new Date(mockUser.memberExpiresAt).getTime() + 8 * 60 * 60 * 1000)
        .toISOString().slice(0, 10)
      : '',
    taskPackCount: Math.max(0, Number(mockUser.taskPackCount) || 0),
    taskPackSlots: Math.max(0, Number(mockUser.taskPackSlots) || 0),
    lastReminderCreatedAt: mockUser.lastReminderCreatedAt || null,
  };
  const result = {
    ...view,
    orderId: order._id,
    grantStatusLabel: view.grantStatus === 'GRANTED'
      ? '已发放'
      : (view.grantStatus === 'FAILED' ? '发放失败' : (view.grantStatus === 'REVERTED' ? '已回收' : '未发放')),
    entitlementStatusLabel: ({
      PENDING: '待支付',
      PAID_GRANTED: '权益已到账',
      PAID_GRANT_FAILED: '权益发放异常',
      PAID_GRANT_UNKNOWN: '权益待核验',
      CLOSED: '订单已关闭',
      REFUNDED: '权益已回收',
    })[view.entitlementStatus] || '状态待核验',
    paymentChannelLabel: view.paymentChannel === 'APPLE'
      ? 'Apple'
      : (view.paymentChannel === 'WECHAT_VIRTUAL' ? '微信虚拟支付' : '微信支付'),
    user,
    cases: {
      count: relatedCases.length,
      latestCaseId: latestCase ? latestCase._id : '',
      latestCaseNo: latestCase ? latestCase.caseNo : '',
      latestStatus: latestCase ? latestCase.status : '',
      latestStatusLabel: latestCase ? mockCaseView(latestCase).statusLabel : '',
    },
  };
  if (options.detail) {
    result.transactionId = order.transactionId || '';
    result.paymentState = {
      tradeState: order.paymentResult && order.paymentResult.tradeState || '',
      amountFen: order.paymentResult && order.paymentResult.amountFen || 0,
    };
    result.entitlementGrant = order.entitlementGrant ? {
      ...order.entitlementGrant,
      memberDaysAdded: Math.round(
        Math.max(0, Number(order.entitlementGrant.memberDaysAddedMs) || 0) / 86400000
      ),
    } : null;
    result.relatedCases = relatedCases.map(mockCaseView);
  }
  return result;
}

function mockCaseView(item) {
  const status = item.status || 'SUBMITTED';
  return {
    _id: item._id,
    caseNo: item.caseNo,
    orderId: item.orderId,
    outTradeNo: item.outTradeNo,
    title: item.title,
    amountFen: item.amountFen,
    amountText: `¥${(item.amountFen / 100).toFixed(2).replace(/\.00$/, '')}`,
    type: item.type,
    typeLabel: MOCK_CASE_TYPE_LABEL[item.type] || '其他问题',
    priority: item.priority || (['RIGHTS_NOT_RECEIVED', 'DUPLICATE_CHARGE'].includes(item.type) ? 'HIGH' : 'NORMAL'),
    priorityLabel: (item.priority || (['RIGHTS_NOT_RECEIVED', 'DUPLICATE_CHARGE'].includes(item.type) ? 'HIGH' : 'NORMAL')) === 'HIGH' ? '高优先级' : '普通',
    reasonCode: item.reasonCode || '',
    description: item.description || '',
    status,
    statusLabel: MOCK_CASE_STATUS_LABEL[status] || '处理中',
    canCancel: ['SUBMITTED', 'AUTO_CHECKING', 'UNDER_REVIEW', 'APPROVED', 'REFUND_FAILED'].includes(status),
    refundStatus: item.refundStatus || 'NONE',
    refundStatusLabel: MOCK_CASE_STATUS_LABEL[status] || '处理中',
    failureReason: item.failureReason || '',
    failureCode: item.failureCode || '',
    fundingBlocked: item.fundingBlocked === true,
    fundingBlockedAt: item.fundingBlockedAt || null,
    fundingBlockedAtText: item.fundingBlockedAt
      ? `${fmt(item.fundingBlockedAt)} ${pad(beijingParts(item.fundingBlockedAt).hour)}:${pad(beijingParts(item.fundingBlockedAt).minute)}` : '',
    decisionNote: item.decisionNote || '',
    outRefundNo: item.outRefundNo || '',
    refundAmountFen: item.refundAmountFen || 0,
    refundAmountText: `¥${((item.refundAmountFen || item.amountFen) / 100).toFixed(2).replace(/\.00$/, '')}`,
    evidence: item.evidence || {},
    createdAt: item.createdAt,
    createdAtText: item.createdAt
      ? `${fmt(item.createdAt)} ${pad(beijingParts(item.createdAt).hour)}:${pad(beijingParts(item.createdAt).minute)}` : '',
    reviewedAtText: '',
    refundedAtText: item.refundedAt
      ? `${fmt(item.refundedAt)} ${pad(beijingParts(item.refundedAt).hour)}:${pad(beijingParts(item.refundedAt).minute)}` : '',
    cancelledAt: item.cancelledAt || null,
    cancelledAtText: item.cancelledAt
      ? `${fmt(item.cancelledAt)} ${pad(beijingParts(item.cancelledAt).hour)}:${pad(beijingParts(item.cancelledAt).minute)}` : '',
    cancelledBy: item.cancelledBy || '',
    cancellationReason: item.cancellationReason || '',
  };
}

function mockTaskLimitError(needed) {
  const current = mockMembershipSnapshot();
  const want = Math.max(0, Number(needed) || 0);
  if (want <= current.taskRemaining) return null;
  const taskLimit = {
    limit: current.taskLimit,
    used: current.taskUsed,
    remaining: current.taskRemaining,
    requested: want,
    shortfall: Math.max(0, want - current.taskRemaining),
  };
  return {
    success: false,
    error: '提醒名额不足，请先开通会员或加购名额',
    errorCode: 1026,
    membership: current,
    taskLimit,
    packages: mockMembershipPackages(current),
  };
}

const handlers = {
  /* ----- spots ----- */
  'list': () => ({ success: true, data: SPOTS.map(s => buildCard(s)).sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0)) }),
  'detail': (data) => {
    const spot = SPOTS.find(s => s.spotId === data.spotId);
    if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
    const entries = [];
    if (spot.officialAppid) entries.push({ type: 'MINIPROGRAM', label: '官方小程序', appid: spot.officialAppid, path: spot.officialPath || '', url: spot.officialWebUrl || '', hint: '点击直接跳转官方小程序预约' });
    if (spot.officialAccount) entries.push({ type: 'OFFICIAL_ACCOUNT', label: '微信公众号', value: spot.officialAccount, qrCode: spot.qrCode || '', hint: '点击参与预约 → 填写信息 → 预约成功' });
    if (spot.officialWebUrl) entries.push({ type: 'WEB', label: '景区官网', url: spot.officialWebUrl, hint: '点击预约入口 → 扫小程序码' });
    const rule = RULES.find(r => r.spotId === data.spotId) || {};
    return { success: true, data: { ...buildCard(spot), address: spot.address || spot.district, location: null, entries, bookingTips: rule.bookingTips || '', specialNotice: activeNoticeOf(rule), openTime: rule.openTime || '', ticketPrice: rule.ticketPrice || '', idRequirement: rule.idRequirement || '', ageLimit: rule.ageLimit || '', closedDaysLabel: closedDaysLabel(rule.closedDays, rule.openDays, rule.closedDaysNote), closedDaysNote: (rule.closedDaysNote && (((rule.openDays || []).length > 0) || ((rule.closedDays || []).length > 0))) ? rule.closedDaysNote : '' } };
  },
  'batch': (data) => ({ success: true, data: SPOTS.filter(s => (data.spotIds || []).includes(s.spotId)).map(buildCard) }),
  'search': (data) => {
    const kw = String(data.keyword || '').trim().toLowerCase();
    if (!kw) return { success: true, data: [] };
    const hits = SPOTS.filter(s => s.name.toLowerCase().includes(kw) || s.spotId.includes(kw) || (s.aliases || []).some(a => String(a).toLowerCase().includes(kw))).map(buildCard).sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
    db.searchHistory = [data.keyword, ...db.searchHistory.filter(k => k !== data.keyword)].slice(0, 10);
    return { success: true, data: hits };
  },
  'searchHistory': () => ({ success: true, data: db.searchHistory }),
  'clearSearchHistory': () => { db.searchHistory = []; return { success: true, removed: 0 }; },

  /* ----- trip ----- */
  'trip.create': (data) => {
    /* TRIP-RULE-002 创建或合并（2026-09-14 恢复自动合并，镜像云函数 trip.create）：
       同城市且日期相交/相接 → 合并成一个行程（= 一个任务分组 Tab），日期取并集；
       但各景点保留自己被选中时的日期段（spots），时间线不会冒出没选过的组合。 */
    const city = data.city || '北京';
    const startDate = data.startDate;
    const endDate = data.endDate;
    const incomingRange = { city, startDate, endDate };
    const incomingSpots = (Array.isArray(data.spotSegments) && data.spotSegments.length > 0)
      ? data.spotSegments.filter(sg => sg && sg.spotId && sg.startDate && sg.endDate)
        .map(sg => ({ spotId: sg.spotId, startDate: sg.startDate, endDate: sg.endDate }))
      : makeSpotSegments(data.spotIds || [], startDate, endDate);

    const existing = Object.values(db.trips).filter(t => t.city === city && t.status === 'ACTIVE');

    /* adjustTripId：「在当前内联时间线的行程上重新生成」→ 该行程景点段按本次输入替换 */
    const adjust = data.adjustTripId ? existing.find(t => t._id === data.adjustTripId) : null;
    const adjustMerges = Boolean(adjust && canMerge(incomingRange, adjust));
    const pool = adjustMerges ? existing.filter(t => t._id !== adjust._id) : existing;

    const { range, mergedIds } = collapse(incomingRange, pool);

    /* 景点段：被并进来的行程各自的段 + 本次输入的段。
       调整模式本次输入在前（替换语义）；否则既有在前、本次追加在后（想去列表顺序稳定） */
    const mergedTrips = pool.filter(t => mergedIds.includes(t._id));
    const otherSpots = mergedTrips.reduce((acc, t) => acc.concat(normalizeSpots(t)), []);
    const finalSpots = adjustMerges
      ? mergeSpots(incomingSpots, otherSpots)
      : mergeSpots(otherSpots, incomingSpots);
    const finalSpotIds = finalSpots.map(s => s.spotId);
    const name = buildMockTripName(city, range.startDate, range.endDate);

    const keepId = adjustMerges ? adjust._id : (mergedIds[0] || '');

    if (!keepId) {
      const tripId = 'mock-trip-' + (++tripSeq);
      db.trips[tripId] = {
        _id: tripId, city,
        startDate: range.startDate, endDate: range.endDate,
        spotIds: finalSpotIds, spots: finalSpots,
        name, status: 'ACTIVE',
      };
      return { success: true, tripId, merged: false, mergedFrom: [], trip: db.trips[tripId] };
    }

    const trip = db.trips[keepId];
    trip.startDate = range.startDate;
    trip.endDate = range.endDate;
    trip.name = name;
    trip.spotIds = finalSpotIds;
    trip.spots = finalSpots;

    mergedIds.filter(id => id !== keepId).forEach((id) => {
      // 被吞并行程的任务与清单改挂到存续行程（提醒本身不受影响）
      Object.keys(db.tasks).forEach(k => { if (db.tasks[k].tripId === id) db.tasks[k].tripId = keepId; });
      Object.keys(db.carts).forEach(k => { if (db.carts[k].tripId === id) db.carts[k].tripId = keepId; });
      Object.keys(db.items).forEach(k => {
        if (db.items[k].tripId !== id) return;
        db.items[k].tripId = keepId;
        db.items[k].backupGroupId = keepId + ':' + db.items[k].spotId;
        /* 行程段变了 → 放票时刻要重算（它由 visitDate 推导）。
           itemId 保持不动：它是 tasks join items 的键。 */
        const spot = SPOTS.find(sp => sp.spotId === db.items[k].spotId);
        const rule = RULES.find(r => r.spotId === db.items[k].spotId) || null;
        const releaseAt = deriveReleaseAt(spot, rule, db.items[k].visitDate);
        Object.keys(db.tasks).forEach(tk => {
          if (db.tasks[tk].itemId !== db.items[k]._id) return;
          db.tasks[tk].tripId = keepId;
          if (releaseAt) db.tasks[tk].releaseAt = releaseAt;
        });
      });
      delete db.trips[id];
    });

    return { success: true, tripId: keepId, merged: mergedIds.length > 0, mergedFrom: mergedIds, trip };
  },
  'trip.list': () => {
    /* TRIP-RULE-004 读取时兜底：任务 / 行程项 / 清单全空的孤儿行程自动删除（同步云函数）。
       行程项是 V2 判断「行程是否为空」的事实来源，三样都空才算孤儿。 */
    const kept = Object.values(db.trips).filter(t => {
      const hasTask = Object.values(db.tasks).some(x => x.tripId === t._id);
      const hasCart = Object.values(db.carts).some(c => c.tripId === t._id);
      const hasItem = Object.values(db.items).some(i => i.tripId === t._id);
      if (hasTask || hasCart || hasItem) return true;
      delete db.trips[t._id];
      return false;
    });
    const sorted = kept.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    // 老数据只有 spotIds → 统一补出 spots 段（按行程整段），前端可放心依赖
    sorted.forEach(t => { t.spots = normalizeSpots(t); });
    return { success: true, trips: sorted, showGroupTabs: sorted.length >= 2 };
  },
  'trip.updateSpots': (data) => {
    const trip = db.trips[data.tripId];
    if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
    /* 已在行程里的景点保留自己的日期段（不因一次增删被拉回整段）；
       新加入的景点用本次传入的段，缺省则用行程当前范围 */
    const startDate = data.startDate || trip.startDate;
    const endDate = data.endDate || trip.endDate;
    const next = [...new Set(data.spotIds || [])];
    const prevMap = new Map(normalizeSpots(trip).map(s => [s.spotId, s]));
    const spots = next.map(spotId => prevMap.get(spotId) || { spotId, startDate, endDate });
    trip.spotIds = next;
    trip.spots = spots;
    pruneStaleCart(data.tripId);
    return { success: true, tripId: data.tripId, spotIds: next, spots };
  },
  'trip.updateRange': (data) => {
    const trip = db.trips[data.tripId];
    if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
    /* 行程总范围变了 → 各景点段裁剪到新范围内（无交集时收敛到新范围），
       保证「景点段 ⊄ 行程范围」这种非法状态不出现 */
    const spots = normalizeSpots(trip).map(s => {
      const seg = {
        spotId: s.spotId,
        startDate: s.startDate > data.startDate ? s.startDate : data.startDate,
        endDate: s.endDate < data.endDate ? s.endDate : data.endDate,
      };
      return seg.startDate > seg.endDate ? { spotId: s.spotId, startDate: data.startDate, endDate: data.endDate } : seg;
    });
    trip.startDate = data.startDate;
    trip.endDate = data.endDate;
    trip.name = buildMockTripName(trip.city, data.startDate, data.endDate);
    trip.spotIds = spots.map(s => s.spotId);
    trip.spots = spots;
    pruneStaleCart(data.tripId);
    return { success: true, tripId: data.tripId, startDate: trip.startDate, endDate: trip.endDate, spots };
  },
  /* 显式删除行程（含其任务与提醒清单）：清理「进行中 0 / 已过期 0」的空壳行程（同步云函数 trip.remove） */
  'trip.remove': (data) => {
    if (!db.trips[data.tripId]) return { success: false, error: '参数不合法', errorCode: 1010 };
    let removedTasks = 0;
    let removedCartItems = 0;
    let removedItems = 0;
    Object.keys(db.tasks).forEach(id => { if (db.tasks[id].tripId === data.tripId) { delete db.tasks[id]; removedTasks += 1; } });
    Object.keys(db.carts).forEach(id => { if (db.carts[id].tripId === data.tripId) { delete db.carts[id]; removedCartItems += 1; } });
    Object.keys(db.items).forEach(id => { if (db.items[id].tripId === data.tripId) { delete db.items[id]; removedItems += 1; } });
    delete db.trips[data.tripId];
    clearPendingIfNoItems();
    return { success: true, tripId: data.tripId, removedTasks, removedCartItems, removedItems };
  },

  /* ----- timeline ----- */
  'timeline.generate': (data) => generateTimeline(data.tripId),
  'timeline.preview': (data) => previewTimeline(data),

  /* ----- cart ----- */
  'cart.planDates': (data) => {
    const spot = SPOTS.find(s => s.spotId === data.spotId);
    if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
    const rule = RULES.find(r => r.spotId === data.spotId) || null;
    const visitDates = [...new Set((data.visitDates || []).filter(Boolean).map(String))].sort();
    if (!visitDates.length) return { success: false, error: '参数不合法', errorCode: 1010 };
    const nowMs = Date.now();
    const dates = visitDates.map(visitDate => {
      const inCart = Object.values(db.carts).some(c => c.spotId === spot.spotId && c.visitDate === visitDate);
      const inTrip = Object.values(db.items).some(i => i.spotId === spot.spotId && i.visitDate === visitDate);
      const releaseAt = deriveReleaseAt(spot, rule, visitDate);
      const releaseMs = releaseAt ? new Date(releaseAt).getTime() : 0;
      let status = 'REMINDABLE';
      let reason = '';
      if (inTrip) { status = 'IN_TRIP'; reason = 'IN_TRIP'; }
      else if (inCart) { status = 'IN_CART'; reason = 'IN_CART'; }
      else if (spot.reservationRequired === false) { status = 'TRIP_ONLY'; reason = 'NO_RESERVATION'; }
      else if (!releaseAt) { status = 'TRIP_ONLY'; reason = 'NO_FIXED_RELEASE'; }
      else if (releaseMs <= nowMs) { status = 'TRIP_ONLY'; reason = 'RELEASE_PASSED'; }
      return {
        visitDate,
        status,
        reason,
        releaseAt,
        addable: status === 'REMINDABLE' || status === 'TRIP_ONLY',
        reminderAllowed: status === 'REMINDABLE',
      };
    });
    const summary = {
      requested: dates.length,
      addable: dates.filter(d => d.addable).length,
      reminder: dates.filter(d => d.reminderAllowed).length,
      tripOnly: dates.filter(d => d.status === 'TRIP_ONLY').length,
      existing: dates.filter(d => d.status === 'IN_CART' || d.status === 'IN_TRIP').length,
      releasePassed: dates.filter(d => d.reason === 'RELEASE_PASSED').length,
      noFixedRelease: dates.filter(d => d.reason === 'NO_FIXED_RELEASE').length,
      noReservation: dates.filter(d => d.reason === 'NO_RESERVATION').length,
    };
    return { success: true, spotId: spot.spotId, spotName: spot.name, dates, summary };
  },
  'cart.addDates': (data) => {
    const plan = handlers['cart.planDates'](data);
    if (!plan.success) return plan;
    const items = [];
    plan.dates.filter(d => d.addable).forEach(d => {
      const r = handlers['cart.add']({
        spotId: data.spotId,
        visitDate: d.visitDate,
        remindOn: d.reminderAllowed,
      });
      if (r.success) {
        items.push({
          cartId: r.cartId,
          visitDate: d.visitDate,
          remindOn: r.remindOn,
          status: d.status,
          reason: d.reason,
        });
      }
    });
    return {
      success: true,
      spotId: plan.spotId,
      spotName: plan.spotName,
      dates: plan.dates,
      summary: plan.summary,
      items,
      addedCartIds: items.map(i => i.cartId),
      added: items.length,
      addedReminders: items.filter(i => i.remindOn).length,
      addedTripOnly: items.filter(i => !i.remindOn).length,
    };
  },
  'cart.add': (data) => {
    const spot = SPOTS.find(s => s.spotId === data.spotId);
    if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
    const rule = RULES.find(r => r.spotId === data.spotId) || null;
    const reservationRequired = spot.reservationRequired !== false;
    const remindable = reservationRequired && hasReleaseSchedule(rule);
    /* ⚠️ 放票时刻与云端一样**由服务端推**，不信任调用方传的（2026-09-24）：
       「约其他日」只拿得到用户选的 visitDate，压根没有 releaseAt 可传
       （见 lib/cart.js 里同一条注释）。 */
    const derivedReleaseAt = reservationRequired ? deriveReleaseAt(spot, rule, data.visitDate) : null;
    if (reservationRequired && remindable && !derivedReleaseAt) return { success: false, error: '参数不合法', errorCode: 1010 };
    /* 不传 tripId = 操作「当前暂存清单」（纯预览化后的常规路径） */
    const targetTripId = cartTripIdOf(data.tripId);
    const exists = Object.values(db.carts).some(c => c.tripId === targetTripId && c.spotId === data.spotId && c.visitDate === data.visitDate);
    /* 已落为行程项的不再进清单：按 (spotId, visitDate) 跨行程查。
       纯预览态下预览本身看不到「已在行程」，这道去重必须在这里拦住。 */
    const itemExists = Object.values(db.items).some(i => i.spotId === data.spotId && i.visitDate === data.visitDate);
    if (exists || itemExists) return { success: false, error: '这条已经在清单里啦', errorCode: 1002 };
    const weak = reservationRequired
      && spot.strongReminder !== true
      && (spot.difficultyScore || 0) <= 2;
    const releasePassed = !!derivedReleaseAt && new Date(derivedReleaseAt).getTime() <= Date.now();
    const remindOn = reservationRequired && remindable && !!derivedReleaseAt && !releasePassed
      ? (typeof data.remindOn === 'boolean' ? data.remindOn : !weak)
      : false;
    const cartId = 'mock-cart-' + (++cartSeq);
    db.carts[cartId] = {
      _id: cartId,
      tripId: targetTripId,
      spotId: data.spotId,
      visitDate: data.visitDate,
      releaseAt: derivedReleaseAt,
      remindOn,
      reservationRequired,
    };
    let remindBlockedReason = '';
    if (spot.reservationRequired === false) remindBlockedReason = 'NO_RESERVATION';
    else if (!derivedReleaseAt) remindBlockedReason = 'NO_FIXED_RELEASE';
    else if (releasePassed) remindBlockedReason = 'RELEASE_PASSED';
    return { success: true, cartId, remindOn, remindBlockedReason };
  },
  'cart.addAll': (data) => {
    /* 服务端按同一份输入重算预览，不信任前端传来的事件与状态 */
    const tl = previewTimeline(data);
    const inScope = data.scope === 'departure' ? (e => e.visitDate === data.scopeKey) : (e => e.spotId === data.scopeKey);
    let added = 0;
    let addedReminders = 0;
    let addedTripOnly = 0;
    const skipped = [];
    tl.events.filter(e => e.status === 'SELECTABLE' && inScope(e)).forEach(e => {
      const r = handlers['cart.add']({
        tripId: data.tripId,
        spotId: e.spotId,
        visitDate: e.visitDate,
        releaseAt: e.releaseAt,
        remindOn: e.remindOnDefault,
      });
      if (r.success) {
        added += 1;
        if (r.remindOn) addedReminders += 1;
        else addedTripOnly += 1;
      }
      else skipped.push({ spotId: e.spotId, visitDate: e.visitDate, reason: r.error });
    });
    return {
      success: true,
      added,
      addedReminders,
      addedTripOnly,
      skipped,
      total: added + skipped.length,
      scope: data.scope,
      scopeKey: data.scopeKey,
    };
  },
  'cart.updateRemindOn': (data) => {
    const item = db.carts[data.cartId];
    const canRemind = item && item.reservationRequired !== false && !!item.releaseAt;
    if (!item || (data.remindOn && !canRemind)) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    const releasePassed = item.reservationRequired !== false
      && item.releaseAt
      && new Date(item.releaseAt).getTime() <= Date.now();
    if (releasePassed) return { success: false, error: '已过放票时间，提醒无法开启或取消', errorCode: 1017 };
    item.remindOn = data.remindOn === true;
    return { success: true, cartId: data.cartId, remindOn: item.remindOn };
  },
  'cart.remove': (data) => { delete db.carts[data.cartId]; return { success: true, cartId: data.cartId }; },
  /* 默认只清暂存区；传真实 tripId 才清那个行程的清单（镜像 cart.clear） */
  'cart.clear': (data) => {
    const want = cartTripIdOf(data && data.tripId);
    Object.keys(db.carts).forEach(id => { if (db.carts[id].tripId === want) delete db.carts[id]; });
    return { success: true, removed: 0 };
  },
  /* CART-RULE-007：只保留本次日期段 × 景点集合内的暂存项（镜像 cart.pruneScope） */
  'cart.pruneScope': (data) => {
    const { startDate, endDate, spotIds } = data || {};
    if (!startDate || !endDate || startDate > endDate) {
      return { success: false, error: '行程日期不合法', errorCode: 1006 };
    }
    if (!Array.isArray(spotIds) || spotIds.length === 0) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    const keepSpots = new Set(spotIds.map(String));
    let removed = 0;
    Object.keys(db.carts).forEach(id => {
      const item = db.carts[id];
      if (item.tripId !== PENDING_CART_TRIP_ID) return;
      const stale = !keepSpots.has(String(item.spotId || ''))
        || !item.visitDate
        || item.visitDate < startDate
        || item.visitDate > endDate;
      if (stale) { delete db.carts[id]; removed += 1; }
    });
    return { success: true, removed };
  },
  'cart.list': (data) => {
    /* 不传 tripId = 读暂存区（「添加提醒」页要的就是这个） */
    const want = cartTripIdOf(data && data.tripId);
    const items = Object.values(db.carts).filter(c => c.tripId === want);
    const now = new Date();
    const enriched = items.map(c => {
      const spot = SPOTS.find(s => s.spotId === c.spotId);
      const reservationRequired = c.reservationRequired !== false && (!spot || spot.reservationRequired !== false);
      if (!reservationRequired) {
        return {
          ...c,
          reservationRequired: false,
          remindOn: false,
          remindLocked: false,
          spotName: spot ? spot.name : '未知景点',
          spotShort: spot ? (spot.shortName || spot.name) : '未知景点',
          difficulty: null,
          weak: false,
          releaseAt: null,
          releaseDateLabel: '',
          releaseTimeLabel: '无需预约',
          visitDateLabel: formatMonthDayWeek(c.visitDate) + ' · 随到随玩',
          countdown: null,
        };
      }
      if (!c.releaseAt) {
        return {
          ...c,
          reservationRequired: true,
          noFixedRelease: true,
          remindOn: false,
          remindLocked: true,
          spotName: spot ? spot.name : '未知景点',
          spotShort: spot ? (spot.shortName || spot.name) : '未知景点',
          difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
          weak: !!spot && spot.strongReminder !== true && (spot.difficultyScore || 0) <= 2,
          releaseAt: null,
          releaseDateLabel: '',
          releaseLabel: '',
          releaseTimeLabel: '随买随用',
          visitDateLabel: formatMonthDayWeek(c.visitDate) + ' · 随买随用',
          countdown: null,
        };
      }
      const releaseAt = new Date(c.releaseAt);
      const msLeft = releaseAt.getTime() - now.getTime();
      const expired = msLeft <= 0;
      const h = Math.max(0, Math.floor(msLeft / 3600000));
      const m = Math.max(0, Math.floor((msLeft % 3600000) / 60000));
      const releaseDateParts = fmt(releaseAt).split('-');
      return {
        ...c,
        reservationRequired: true,
        remindOn: !expired && c.remindOn === true,
        remindLocked: expired,
        spotName: spot ? spot.name : '未知景点',
    spotShort: spot ? (spot.shortName || spot.name) : '未知景点',
        difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
        weak: reservationRequired && !!spot
          && spot.strongReminder !== true
          && (spot.difficultyScore || 0) <= 2,
        releaseDateLabel: `${releaseDateParts[1]}月${releaseDateParts[2]}日`,
        releaseLabel: `${releaseDateParts[1]}月${releaseDateParts[2]}日 ${formatHourMinute(releaseAt)} 放票`,
        releaseTimeLabel: formatHourMinute(releaseAt),
        visitDateLabel: '约 ' + formatMonthDayWeek(c.visitDate) + ' 门票',
        countdown: expired
          ? { hours: 0, minutes: 0, text: '', urgent: false, expired: true }
          : { hours: h, minutes: m, text: '还剩' + h + 'h ' + m + 'm', urgent: msLeft < 3600000, expired: false },
      };
    });
    const visitDates = [...new Set(enriched.map(c => c.visitDate).filter(Boolean))].sort();
    const firstDate = visitDates[0];
    const groups = visitDates.map(visitDate => ({
      key: visitDate,
      label: formatMonthDayWeek(visitDate).replace(' (', ' · ').replace(')', ''),
      dayLabel: firstDate ? `【第${diffDays(firstDate, visitDate) + 1}天】` : '',
      items: enriched
        .filter(c => c.visitDate === visitDate)
        .sort((a, b) => {
          const af = a.reservationRequired === false ? 1 : 0;
          const bf = b.reservationRequired === false ? 1 : 0;
          if (af !== bf) return af - bf;
          const at = a.releaseAt ? new Date(a.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bt = b.releaseAt ? new Date(b.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
          if (at !== bt) return at - bt;
          return String(a.spotName || '').localeCompare(String(b.spotName || ''), 'zh-CN');
        }),
    }));
    const spotCount = new Set(items.map(c => c.spotId)).size;
    const reminderCount = enriched.filter(c => c.remindOn).length;
    const summary = {
      count: items.length,
      spotCount,
      reminderCount,
      noReminderCount: items.length - reminderCount,
      text: reminderCount > 0 ? `已选 ${items.length} 项，其中 ${reminderCount} 个将设提醒` : `已选 ${items.length} 项，均无需提醒`,
    };
    return {
      success: true,
      items: enriched,
      groups,
      summary,
      membership: data && data.includeMembership ? mockMembershipSnapshot(now) : null,
    };
  },

  /* ----- task ----- */
  'cart.commit': (data) => handlers['task.submit'](data),
  'task.submit': (data) => {
    /* 2026-09-20 起这是**唯一**创建行程的地方（「生成时间线」已改为纯预览）：
       读暂存清单 → 建/合并行程 → 落行程项 → 为勾了提醒的项建任务 → 清空清单 */
    const disableReminders = data.disableReminders === true;
    const want = cartTripIdOf(data.tripId);
    const cartIds = Array.isArray(data.cartIds)
      ? [...new Set(data.cartIds.filter(Boolean).map(String))]
      : [];
    if (data.cartId && cartIds.length) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    const cartIdSet = cartIds.length ? new Set(cartIds) : null;
    if (disableReminders && data.tripId && data.tripId !== PENDING_CART_TRIP_ID) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    const cartItems = Object.values(db.carts).filter(c =>
      c.tripId === want
      && (!data.cartId || c._id === data.cartId)
      && (!cartIdSet || cartIdSet.has(c._id)));
    if (cartItems.length === 0) return { success: false, error: '先添加至少一条提醒', errorCode: 1009 };
    const nowTs = new Date();
    const pastReleaseOf = c => !!c.releaseAt && new Date(c.releaseAt).getTime() <= nowTs.getTime();
    const reminderItems = disableReminders ? [] : cartItems.filter(c =>
      c.reservationRequired !== false && !!c.releaseAt && c.remindOn === true && !pastReleaseOf(c));
    const channels = data.channels || [];
    const offsets = data.offsets || [];
    if (reminderItems.length > 0 && (channels.length === 0 || offsets.length === 0 || reminderItems.some(c => !c.releaseAt))) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    const limitError = mockTaskLimitError(reminderItems.length);
    if (limitError) return limitError;
    /* 各景点保留自己的日期段（提交时由 visitDate 集合推导），
       这样合并后「故宫 10.2-10.3 + 国博 10.4」不会互相膨胀成 10.2-10.4 */
    const segMap = {};
    cartItems.forEach(c => {
      const cur = segMap[c.spotId];
      if (!cur) segMap[c.spotId] = { spotId: c.spotId, startDate: c.visitDate, endDate: c.visitDate };
      else {
        if (c.visitDate < cur.startDate) cur.startDate = c.visitDate;
        if (c.visitDate > cur.endDate) cur.endDate = c.visitDate;
      }
    });
    const segs = Object.values(segMap);
    const startDate = segs.reduce((m, x) => (x.startDate < m ? x.startDate : m), segs[0].startDate);
    const endDate = segs.reduce((m, x) => (x.endDate > m ? x.endDate : m), segs[0].endDate);

    /* 清单已挂真实行程（老链路）→ 直接用；暂存区 → 建/合并行程 */
    let targetTripId = data.tripId && data.tripId !== PENDING_CART_TRIP_ID ? data.tripId : '';
    if (!targetTripId) {
      const created = handlers['trip.create']({
        startDate, endDate, spotIds: segs.map(x => x.spotId), spotSegments: segs,
      });
      targetTripId = created.tripId;
    }

    let created = 0;
    let createdItems = 0;
    let expiredReminder = 0;
    cartItems.forEach(c => {
      /* ⚠️ 放票已过的项**落 false**（镜像 task.submit，2026-09-23）：
         任务一生出来就会被收敛成 MISSED，用户提交一次就凭空收获一条失败提醒。 */
      const wanted = !disableReminders && c.reservationRequired !== false && !!c.releaseAt && c.remindOn === true;
      const pastRelease = pastReleaseOf(c);
      const remindOn = wanted && !pastRelease;
      if (wanted && pastRelease) expiredReminder += 1;
      let item = Object.values(db.items).find(i => i.tripId === targetTripId && i.spotId === c.spotId && i.visitDate === c.visitDate);
      if (!item) {
        const itemId = 'mock-item-' + (++itemSeq);
        item = {
          _id: itemId,
          userId: 'mock-user',
          tripId: targetTripId,
          spotId: c.spotId,
          visitDate: c.visitDate,
          backupGroupId: targetTripId + ':' + c.spotId,
          remindOn,
          result: null,
          resultAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        db.items[itemId] = item;
        createdItems += 1;
      } else {
        item.remindOn = remindOn;
      }
      if (remindOn) {
        const taskId = 'mock-task-' + (++taskSeq);
        db.tasks[taskId] = {
          _id: taskId,
          templateId: 'mock-template',
          itemId: item._id,
          tripId: targetTripId,
          spotId: c.spotId,
          visitDate: c.visitDate,
          releaseAt: c.releaseAt,
          offsets,
          channels,
          backendStatus: 'WAITING',
          quotaPool: 'ENTITLEMENT',
          sentOffsets: [],
          createdAt: new Date(),
        };
        created += 1;
      }
      delete db.carts[c._id];
    });
    if (created > 0) mockUser.lastReminderCreatedAt = new Date();
    return {
      success: true,
      created,
      createdItems,
      createdTasks: created,
      addedReminderCount: created,
      addedTripItemCount: cartItems.length,
      noReminder: disableReminders ? cartItems.length : cartItems.length - reminderItems.length,
      /* 勾了提醒但因放票时刻已过而没建任务的条数（镜像 lib/task.js） */
      expiredReminder: disableReminders ? 0 : expiredReminder,
      disableReminders,
      /* 契约 8.5 要求回传 tripId：前端据此写 globalData.currentTripId */
      tripId: targetTripId,
      toast: created > 0
        ? `已加入行程 · 已设置 ${created} 个提醒`
        : (expiredReminder > 0
          ? `已加入行程 · ${expiredReminder} 项已过放票时间，提醒无法设置`
          : `已加入行程 · ${createdItems} 项`),
      needsOaAuth: !disableReminders && channels.includes('OFFICIAL_ACCOUNT'),
    };
  },
  'task.list': (data) => {
    let all = Object.values(db.tasks);
    if (data.tripId) all = all.filter(t => t.tripId === data.tripId);
    const now = new Date();
    /* 镜像 lib/task.js 的 effectiveStatusOf：已过 releaseAt 仍是 WAITING = 未送达（REMINDER-RULE-004） */
    const LABELS = { WAITING: '待提醒', TRIGGERED: '已提醒', MISSED: '未送达' };
    const enriched = all.map(t => {
      const spot = SPOTS.find(s => s.spotId === t.spotId);
      const releaseAt = new Date(t.releaseAt);
      const msLeft = releaseAt.getTime() - now.getTime();
      const status = (t.backendStatus === 'WAITING' && msLeft <= 0) ? 'MISSED' : t.backendStatus;
      const expired = status === 'MISSED' || msLeft <= 0;
      return {
        ...t, backendStatus: status,
        spotName: spot ? spot.name : '未知景点',
    spotShort: spot ? (spot.shortName || spot.name) : '未知景点', difficultyScore: spot ? spot.difficultyScore : null,
        releaseTimeLabel: formatHourMinute(releaseAt), releaseDateStr: fmt(releaseAt),
        grabLabel: `开抢${formatMonthDayWeekCn(t.visitDate)}门票`, statusLabel: LABELS[status] || '待提醒',
        countdown: msLeft > 0 && msLeft < 3 * 3600000 ? { text: `还剩${pad(Math.floor(msLeft / 3600000))}h ${pad(Math.floor((msLeft % 3600000) / 60000))}m`, urgent: true } : null,
        expired,
      };
    });
    const active = enriched.filter(t => !t.expired);
    const past = enriched.filter(t => t.expired);
    /* 台账自愈（镜像 lib/task.js 的 sweepOverdue + quota.js 的 shouldHealQuota）：
       任务已过期未送达、且本地台账仍记有额度 → 清零，避免页面显示假额度让用户以为覆盖到了 */
    if (all.some(t =>
      t.backendStatus === 'WAITING' &&
      new Date(t.releaseAt).getTime() <= now.getTime() &&
      shouldHealQuota(t.lastSendError))) {
      healSubscribeQuotas();
    }
    const shown = data.filter === 'expired' ? past : active;
    const map = {};
    shown.forEach(t => { (map[t.releaseDateStr] = map[t.releaseDateStr] || []).push(t); });
    const groups = Object.keys(map).sort((a, b) => data.filter === 'expired' ? b.localeCompare(a) : a.localeCompare(b)).map(k => ({ key: k, label: formatMonthDay(k), items: map[k].sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)) }));
    return { success: true, groups, counts: { active: active.length, expired: past.length }, banner: buildMockBanner(enriched, now), homeMode: enriched.length === 0 ? 1 : 2 };
  },
  /* REMINDER-RULE-005（2026-09-14 放宽）：WAITING / MISSED 可单删，TRIGGERED 只能走「清空任务」 */
  'task.remove': (data) => {
    const t = db.tasks[data.taskId];
    if (!t) return { success: false, error: '参数不合法', errorCode: 1010 };
    if (t.backendStatus !== 'WAITING' && t.backendStatus !== 'MISSED') {
      return { success: false, error: '已提醒的任务不可单条删除，可在「清空任务」中批量清理', errorCode: 1012 };
    }
    delete db.tasks[data.taskId];
    /* TRIP-RULE-004（主动删除口径）：行程内已无任务 → 行程与提醒清单一并删除 */
    const tripRemoved = purgeTripIfNoTask(t.tripId);
    return { success: true, taskId: data.taskId, tripId: t.tripId, tripRemoved };
  },
  'task.clear': (data) => {
    let targets = Object.values(db.tasks);
    if (data && data.tripId) targets = targets.filter(t => t.tripId === data.tripId);
    if (data && data.filter) {
      const now = new Date();
      targets = targets.filter(t => {
        const msLeft = new Date(t.releaseAt).getTime() - now.getTime();
        /* 镜像 lib/task.js clear：MISSED 或已过放票时刻点都算「已过期」 */
        const expired = t.backendStatus === 'MISSED' || msLeft <= 0;
        return data.filter === 'expired' ? expired : !expired;
      });
    }
    const affectedTripIds = [...new Set(targets.map(t => t.tripId).filter(Boolean))];
    targets.forEach(t => { delete db.tasks[t._id]; });
    /* TRIP-RULE-004（主动删除口径）：清空后行程内已无任务 → 行程与提醒清单一并删除（同步云函数） */
    const removedTripIds = affectedTripIds.filter(tid => purgeTripIfNoTask(tid));
    return { success: true, cleared: targets.length, affectedTripIds, removedTripIds };
  },

  /* ----- 行程项（镜像 cloudfunctions/reminder/lib/trip-item-actions.js，API-契约 8.4）----- */
  'tripItem.markResult': (data) => {
    const item = db.items[data.itemId];
    if (!item) return { success: false, error: '行程项不存在', errorCode: 1013 };
    if (data.result !== 'SUCCESS' && data.result !== 'FAILED') {
      return { success: false, error: '当前行程项不可标记结果', errorCode: 1014 };
    }
    const nowTs = new Date();
    const decorated = decorateItem(item, nowTs);
    if (!decorated.canMark) {
      /* 已标记过 → 用「不可标记」而不是「撤销窗口」的语义；
         日期已结束用 1016，其余（还没开票 / 免预约）用 1014 */
      if (decorated.ended) return { success: false, error: '行程项所在日期已结束', errorCode: 1016 };
      return { success: false, error: '当前行程项不可标记结果', errorCode: 1014 };
    }
    item.result = data.result;
    item.resultAt = nowTs;
    item.updatedAt = nowTs;

    /* 备选收束提示（只在「抢到了」时给）：同一备选组里还没处理的日期 */
    let backupPrompt = null;
    if (data.result === 'SUCCESS') {
      const groupId = item.backupGroupId || (item.tripId + ':' + item.spotId);
      const pending = Object.values(db.items)
        .filter(i => i.backupGroupId === groupId && i._id !== item._id && !i.result && fmt(new Date()) <= i.visitDate)
        .map(i => decorateItem(i, nowTs));
      if (pending.length > 0) {
        const spot = SPOTS.find(sp => sp.spotId === item.spotId);
        const spotName = spot ? spot.name : '该景点';
        backupPrompt = {
          groupId,
          spotName,
          confirmedLabel: formatMonthDayWeekCn(item.visitDate),
          text: '已确认' + formatMonthDayWeekCn(item.visitDate) + '去' + spotName,
          pending: pending.map(p => ({
            itemId: p.itemId, visitDate: p.visitDate,
            visitDateLabel: formatMonthDayWeekCn(p.visitDate), ticketState: p.ticketState,
          })),
        };
      }
    }
    return { success: true, item: decorateItem(item, nowTs), backupPrompt };
  },
  'tripItem.undoResult': (data) => {
    const item = db.items[data.itemId];
    if (!item) return { success: false, error: '行程项不存在', errorCode: 1013 };
    if (!item.result || !item.resultAt) return { success: false, error: '当前行程项不可标记结果', errorCode: 1014 };
    if (data.expectedResultAt
      && new Date(data.expectedResultAt).getTime() !== new Date(item.resultAt).getTime()) {
      return { success: false, error: '当前行程项不可标记结果', errorCode: 1014 };
    }
    const deadline = new Date(item.resultAt).getTime() + RESULT_UNDO_SECONDS * 1000;
    if (Date.now() > deadline) return { success: false, error: '撤销时间已过', errorCode: 1015 };
    item.result = null;
    item.resultAt = null;
    return { success: true, item: decorateItem(item, new Date()) };
  },
  'tripItem.updateReminder': (data) => {
    const item = db.items[data.itemId];
    if (!item) return { success: false, error: '行程项不存在', errorCode: 1013 };
    const spot = SPOTS.find(s => s.spotId === item.spotId);
    const rule = RULES.find(r => r.spotId === item.spotId) || null;
    const reservationRequired = !spot || spot.reservationRequired !== false;
    const releaseAt = deriveReleaseAt(spot, rule, item.visitDate);
    /* 免预约项没有提醒可言：明确拒绝，不静默忽略——否则前端会以为设上了 */
    if (data.remindOn === true && !reservationRequired) return { success: false, error: '参数不合法', errorCode: 1010 };
    if (data.remindOn === true && !releaseAt) return { success: false, error: '参数不合法', errorCode: 1010 };
    /* 放票时刻已过 → 开启与取消都没有意义（镜像 trip-item-actions，2026-09-23） */
    if (!canSetReminderOf(reservationRequired, releaseAt, new Date())) {
      return { success: false, error: '已过放票时间，提醒无法开启或取消', errorCode: 1017 };
    }

    const taskKeys = Object.keys(db.tasks).filter(k => db.tasks[k].itemId === item._id);
    const tasks = taskKeys.map(k => db.tasks[k]);
    const activeKeys = taskKeys.filter(k => db.tasks[k].backendStatus === 'WAITING');
    const next = data.remindOn === true;
    if (next && activeKeys.length === 0) {
      const limitError = mockTaskLimitError(1);
      if (limitError) return limitError;
    }
    /* ⚠️ 关闭时若还留着终态任务（已触发/已失败），**保留 remindOn** ——
       否则 chip 会从「未送达」变成「未设提醒」，把静默失败的信号抹掉
       （镜像 trip-item-actions 的 keepEndedRecord，2026-09-23） */
    const turningOff = !next && item.remindOn === true;
    const keepEndedRecord = !next && tasks.some(t => t.backendStatus !== 'WAITING');
    item.remindOn = next ? true : (turningOff ? keepEndedRecord : item.remindOn === true);
    item.updatedAt = new Date();

    if (!next) {
      /* ⚠️ 只删未触发的。已触发的是历史记录，且微信额度不退。 */
      activeKeys.forEach(k => { delete db.tasks[k]; });
    } else {
      const cur = tasks[0];
      const channels = (data.channels || []).length ? data.channels : ((cur || {}).channels || []);
      const offsets = (data.offsets || []).length ? data.offsets : ((cur || {}).offsets || []);
      if (!channels.length || !offsets.length) return { success: false, error: '参数不合法', errorCode: 1010 };
      /* 「当前任务可用吗」= 它还得是待发的。终态残留不能当成「已有提醒」。 */
      const curActive = !!cur && cur.backendStatus === 'WAITING';
      const changed = !curActive
        || String(cur.offsets || []) !== String(offsets)
        || String(cur.channels || []) !== String(channels);
      if (changed) {
        /* 只删未触发的，终态留着当历史（同 trip-item-actions） */
        const quotaPool = curActive ? (cur.quotaPool || 'ENTITLEMENT') : 'ENTITLEMENT';
        activeKeys.forEach(k => { delete db.tasks[k]; });
        const taskId = 'mock-task-' + (++taskSeq);
        db.tasks[taskId] = {
          _id: taskId, templateId: 'mock-template', itemId: item._id, tripId: item.tripId, spotId: item.spotId,
          visitDate: item.visitDate, releaseAt, offsets, channels,
          backendStatus: 'WAITING', quotaPool, sentOffsets: [], createdAt: new Date(),
        };
        mockUser.lastReminderCreatedAt = new Date();
      }
    }
    return {
      success: true,
      item: decorateItem(item, new Date()),
      quotaRefunded: false,
      missedKept: !!(item.remindOn && tasks.some(t => t.backendStatus === 'MISSED')),
    };
  },
  'tripItem.remove': (data) => {
    const item = db.items[data.itemId];
    if (!item) return { success: false, error: '行程项不存在', errorCode: 1013 };
    let removedTasks = 0;
    Object.keys(db.tasks).forEach(k => {
      if (db.tasks[k].itemId === item._id) { delete db.tasks[k]; removedTasks += 1; }
    });
    delete db.items[item._id];
    const tripRemoved = dropTripIfNoItem(item.tripId);
    return { success: true, itemId: data.itemId, tripId: item.tripId, removedTasks, tripRemoved };
  },
  'tripItem.removeVisitDate': (data) => {
    const wantedIds = new Set((Array.isArray(data.itemIds) ? data.itemIds : []).filter(Boolean));
    const targetMap = new Map();
    Object.values(db.items).forEach(i => {
      if (i.tripId !== data.tripId || i.visitDate !== data.visitDate) return;
      if (wantedIds.size === 0 || wantedIds.has(i._id)) targetMap.set(i._id, i);
    });
    /* ID 查询在真实云端与日期查询取并集；mock 同样把日期组作为基线，
       避免只拿到前端传来的部分 ID 时漏删。 */
    Object.values(db.items).forEach(i => {
      if (i.tripId === data.tripId && i.visitDate === data.visitDate) targetMap.set(i._id, i);
    });
    const targets = [...targetMap.values()];
    if (targets.length === 0) return { success: false, error: '行程项不存在', errorCode: 1013 };
    let removedTasks = 0;
    targets.forEach(i => {
      Object.keys(db.tasks).forEach(k => {
        if (db.tasks[k].itemId === i._id) { delete db.tasks[k]; removedTasks += 1; }
      });
      delete db.items[i._id];
    });
    const tripRemoved = dropTripIfNoItem(data.tripId);
    return { success: true, tripId: data.tripId, visitDate: data.visitDate, removedItems: targets.length, removedTasks, tripRemoved };
  },
  'tripItem.recoveryCandidates': (data) => {
    const target = db.items[data.itemId];
    if (!target) return { success: false, error: '行程项不存在', errorCode: 1013 };
    return { success: true, candidates: mockRecoveryCandidates(target) };
  },

  /* ----- user ----- */
  'user.profile': () => ({
    success: true,
    user: {
      ...mockUser,
      subscribeQuota: subscribeSeq,
      membership: mockMembershipSnapshot(),
      membershipSales: mockMembershipSalesView(),
    },
  }),
  'user.updateProfile': (data) => {
    const nickname = (data.nickname || '').trim().slice(0, 32);
    if (!nickname) return { success: false, error: '昵称不能为空', errorCode: 1010 };
    mockUser.nickname = nickname;
    if (typeof data.avatarUrl === 'string') mockUser.avatarUrl = data.avatarUrl;
    if (typeof data.phone === 'string') {
      const phone = data.phone.trim();
      if (phone && !/^1[3-9]\d{9}$/.test(phone)) return { success: false, error: '手机号格式不正确', errorCode: 1010 };
      mockUser.phone = phone;
    }
    return {
      success: true,
      user: {
        ...mockUser,
        subscribeQuota: subscribeSeq,
        membership: mockMembershipSnapshot(),
        membershipSales: mockMembershipSalesView(),
      },
    };
  },
  'user.updateNotifyPrefs': (data) => {
    mockUser.notifyPrefs = data.notifyPrefs;
    return { success: true, notifyPrefs: data.notifyPrefs };
  },

  /* ----- 会员 / 提醒名额与售后（镜像 reminder + payment） ----- */
  'membership.status': () => {
    const current = mockMembershipSnapshot();
    const sales = mockMembershipSalesView();
    const enforcement = mockMembershipEnforcementView();
    return {
      success: true,
      membership: current,
      packages: mockMembershipPackages(current),
      sales,
      enforced: enforcement.mode === 'all',
    };
  },
  'membership.createOrder': (data) => {
    const sales = mockMembershipSalesView();
    if (!sales.purchaseEnabled) {
      return {
        success: false,
        error: '会员购买暂停中，请稍后再试',
        errorCode: 1032,
        sales,
      };
    }
    const current = mockMembershipSnapshot();
    const pkg = mockPackageOf(data.packageId);
    const requestId = String(data.requestId || '');
    if (!pkg || !MOCK_REQUEST_ID_PATTERN.test(requestId)) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    if (pkg.type === 'TASK_PACK' && !current.member) {
      return { success: false, error: '请先开通会员再加购提醒名额', errorCode: 1022 };
    }

    const requestHash = `${mockUser.openId}:${requestId}`;
    const sameRequest = Object.values(db.orders).find(order => order.requestIdHash === requestHash);
    if (sameRequest) {
      if (sameRequest.packageId !== pkg.id) {
        return { success: false, error: '同一支付请求不能变更商品规格', errorCode: 1010 };
      }
      return {
        success: true,
        orderId: sameRequest._id,
        outTradeNo: sameRequest.outTradeNo,
        amountFen: sameRequest.amountFen,
        packageId: sameRequest.packageId,
        reused: true,
      };
    }

    const orderSpecMatches = order => order
      && order.productType === pkg.type
      && order.packageId === pkg.id
      && Number(order.amountFen) === pkg.priceFen
      && Number(order.addedSlots) === pkg.addedSlots
      && Number(order.memberDays) === pkg.memberDays
      && order.specVersion === pkg.specVersion;

    Object.values(db.orders).forEach(order => {
      if (order.packageId !== data.packageId || order.status !== 'PENDING') return;
      const expired = order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now();
      if (expired || !orderSpecMatches(order)) {
        order.status = 'CLOSED';
        order.closeReason = expired
          ? 'EXPIRED_LOCAL'
          : (Number(order.amountFen) !== pkg.priceFen ? 'PRICE_CHANGED' : 'SPEC_CHANGED');
        order.closedAt = new Date();
        order.updatedAt = new Date();
      }
    });
    const reusable = Object.values(db.orders).find(order =>
      order.status === 'PENDING' && orderSpecMatches(order)
      && (!order.expiresAt || new Date(order.expiresAt).getTime() > Date.now()));
    if (reusable) {
      return {
        success: true,
        orderId: reusable._id,
        outTradeNo: reusable.outTradeNo,
        amountFen: reusable.amountFen,
        packageId: reusable.packageId,
        reused: true,
      };
    }

    const orderId = 'mock-order-' + (++orderSeq);
    const outTradeNo = 'MOCK' + Date.now().toString(36) + orderSeq.toString(36);
    db.orders[orderId] = {
      _id: orderId,
      userId: mockUser.openId,
      userDocumentId: mockUser.openId,
      requestIdHash: requestHash,
      outTradeNo,
      packageId: pkg.id,
      productType: pkg.type,
      specVersion: pkg.specVersion,
      title: pkg.title,
      body: `智序准点游-${pkg.title}`,
      amountFen: pkg.priceFen,
      addedSlots: pkg.addedSlots,
      memberDays: pkg.memberDays,
      memberFloorDays: pkg.memberFloorDays || 0,
      status: 'PENDING',
      refundStatus: 'NONE',
      grantStatus: 'NONE',
      grantSchemaVersion: 2,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
    return { success: true, orderId, outTradeNo, amountFen: pkg.priceFen, packageId: pkg.id };
  },
  'membership.orders': () => {
    const items = Object.values(db.orders)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(mockOrderView);
    return {
      success: true,
      items,
      count: items.length,
      sales: mockMembershipSalesView(),
    };
  },

  'adminOrders.stats': () => {
    const now = new Date();
    const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const startMs = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    ) - 8 * 60 * 60 * 1000;
    const start = new Date(startMs);
    const end = new Date(startMs + DAY_MS);
    const orders = Object.values(db.orders).filter(order => {
      const createdMs = new Date(order.createdAt || 0).getTime();
      return createdMs >= start.getTime() && createdMs < end.getTime();
    });
    const paidOrders = orders.filter(order => {
      const paidMs = new Date(order.paidAt || 0).getTime();
      return Number.isFinite(paidMs) && paidMs > 0;
    });
    const paidAmountFen = paidOrders.reduce(
      (sum, order) => sum + Math.max(0, Number(order.amountFen) || 0),
      0
    );
    const refundedAmountFen = paidOrders.reduce((sum, order) => {
      if (order.refundStatus !== 'REFUNDED' && order.status !== 'REFUNDED') return sum;
      const orderAmountFen = Math.max(0, Number(order.amountFen) || 0);
      const snapshotRefundFen = Math.max(0, Number(order.refundedAmountFen) || 0);
      return sum + Math.min(orderAmountFen, snapshotRefundFen || orderAmountFen);
    }, 0);
    const netAmountFen = paidAmountFen - refundedAmountFen;
    return {
      success: true,
      stats: {
        dateKey: [
          shifted.getUTCFullYear(),
          String(shifted.getUTCMonth() + 1).padStart(2, '0'),
          String(shifted.getUTCDate()).padStart(2, '0'),
        ].join('-'),
        totalOrders: orders.length,
        paidOrders: paidOrders.length,
        paidAmountFen,
        paidAmountText: mockPriceText(paidAmountFen),
        refundedAmountFen,
        refundedAmountText: mockPriceText(refundedAmountFen),
        netAmountFen,
        netAmountText: mockPriceText(netAmountFen),
      },
    };
  },

  'adminOrders.list': (data) => {
    const keyword = String(data.keyword || '').trim();
    const page = Math.max(1, Math.floor(Number(data.page) || 1));
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(data.pageSize) || 20)));
    let orders = Object.values(db.orders);
    if (data.status) orders = orders.filter(order => order.status === data.status);
    if (keyword) {
      orders = orders.filter(order => {
        const caseMatch = Object.values(db.afterSalesCases)
          .some(item => item.orderId === order._id && item.caseNo === keyword);
        return order._id === keyword
          || order.outTradeNo === keyword
          || order.userId === keyword
          || String(mockUser.nickname || '').toLowerCase().includes(keyword.toLowerCase())
          || caseMatch;
      });
    }
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = orders.length;
    const items = orders
      .slice((page - 1) * pageSize, page * pageSize)
      .map(order => mockAdminOrderView(order));
    return {
      success: true,
      items,
      count: items.length,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  },
  'adminOrders.detail': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    const view = mockAdminOrderView(order, { detail: true });
    return { success: true, order: view, user: view.user };
  },

  'create': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    const sales = mockMembershipSalesView();
    if (order.status !== 'PAID' && !sales.purchaseEnabled) {
      return {
        success: false,
        error: '会员购买暂停中，请稍后再试',
        errorCode: 1032,
        sales,
      };
    }
    if (order.status !== 'PAID') {
      const now = new Date();
      const currentExpiryMs = new Date(mockUser.memberExpiresAt || 0).getTime();
      const validCurrentExpiry = Number.isFinite(currentExpiryMs) && currentExpiryMs > now.getTime() ? currentExpiryMs : now.getTime();
      const nextExpiryMs = Math.max(
        order.memberDays ? validCurrentExpiry + order.memberDays * DAY_MS : 0,
        order.memberFloorDays ? now.getTime() + order.memberFloorDays * DAY_MS : 0,
        currentExpiryMs || 0
      );
      order.entitlementGrant = {
        beforeExpiresAt: currentExpiryMs ? new Date(currentExpiryMs) : null,
        afterExpiresAt: new Date(nextExpiryMs),
        memberDaysAddedMs: Math.max(0, nextExpiryMs - validCurrentExpiry),
        taskPackDelta: order.productType === 'TASK_PACK' ? 1 : 0,
        taskPackCountAdded: order.productType === 'TASK_PACK' ? 1 : 0,
        taskPackSlotsAdded: order.productType === 'TASK_PACK'
          ? Math.max(0, Number(order.addedSlots) || LEGACY_TASK_PACK_SIZE)
          : 0,
        appliedAt: now,
        revertedAt: null,
      };
      mockUser.memberLevel = 'MEMBER';
      mockUser.memberSince = mockUser.memberSince || now;
      mockUser.memberExpiresAt = new Date(nextExpiryMs);
      if (order.productType === 'TASK_PACK') {
        mockUser.taskPackCount = Math.max(0, Number(mockUser.taskPackCount) || 0) + 1;
        mockUser.taskPackSlots = Math.max(0, Number(mockUser.taskPackSlots) || 0)
          + order.entitlementGrant.taskPackSlotsAdded;
      }
      order.status = 'PAID';
      order.paidAt = now;
      order.grantStatus = 'GRANTED';
    }
    return {
      success: true,
      orderId: order._id,
      status: 'PAID',
      entitlementStatus: 'PAID_GRANTED',
      memberExpiresAt: mockUser.memberExpiresAt,
      taskPackCount: mockUser.taskPackCount,
      taskPackSlots: mockUser.taskPackSlots,
      mockPaid: true,
      payment: { mock: true },
    };
  },
  'query': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    return {
      success: true,
      ...mockOrderView(order),
      pending: order.status === 'PENDING',
      memberExpiresAt: mockUser.memberExpiresAt || null,
      taskPackCount: mockUser.taskPackCount || 0,
      taskPackSlots: mockUser.taskPackSlots || 0,
    };
  },
  'cancel': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    if (order.status === 'PENDING') {
      order.status = 'CLOSED';
      order.closeReason = 'USER_CANCEL';
    }
    return { success: true, ...mockOrderView(order) };
  },

  'afterSales.submit': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    const existing = Object.values(db.afterSalesCases).find(item => item.orderId === data.orderId && !['REJECTED', 'REFUNDED', 'CANCELLED', 'RESOLVED', 'CLOSED'].includes(item.status));
    if (existing) return { success: false, error: '该订单已有处理中或已完成的售后申请', errorCode: 1028 };
    const eligibility = mockOrderEligibility(order);
    if (data.type === 'RIGHTS_NOT_RECEIVED' && order.grantStatus === 'GRANTED') {
      return { success: true, resolved: true, ...mockOrderView(order) };
    }
    if (data.type === 'UNUSED_REFUND' && !eligibility.eligibleForReview) {
      return { success: false, error: '当前订单暂不符合退款申请条件', errorCode: 1029, eligibility };
    }
    const caseId = 'mock-case-' + (++orderSeq);
    const status = ['RIGHTS_NOT_RECEIVED', 'DUPLICATE_CHARGE'].includes(data.type) ? 'AUTO_CHECKING' : 'UNDER_REVIEW';
    db.afterSalesCases[caseId] = {
      _id: caseId,
      caseNo: 'ASMOCK' + orderSeq,
      orderId: order._id,
      outTradeNo: order.outTradeNo,
      title: order.title,
      amountFen: order.amountFen,
      type: data.type,
      priority: ['RIGHTS_NOT_RECEIVED', 'DUPLICATE_CHARGE'].includes(data.type) ? 'HIGH' : 'NORMAL',
      reasonCode: data.reasonCode || data.type,
      description: data.description || '',
      status,
      refundStatus: data.type === 'UNUSED_REFUND'
        ? 'UNDER_REVIEW'
        : (data.type === 'DUPLICATE_CHARGE' ? 'REQUESTED' : 'NONE'),
      evidence: { eligibility, duplicate: { duplicate: false, windowMinutes: 10 } },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (db.afterSalesCases[caseId].refundStatus !== 'NONE') {
      order.refundStatus = db.afterSalesCases[caseId].refundStatus;
    }
    order.activeAfterSalesCaseId = caseId;
    return { success: true, case: mockCaseView(db.afterSalesCases[caseId]) };
  },
  'afterSales.cancel': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    if (item.status === 'CANCELLED') {
      return { success: true, case: mockCaseView(item), idempotent: true };
    }
    if (!['SUBMITTED', 'AUTO_CHECKING', 'UNDER_REVIEW', 'APPROVED', 'REFUND_FAILED'].includes(item.status)) {
      return { success: false, error: '当前售后状态不能取消', errorCode: 1029 };
    }
    const order = db.orders[item.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    if (order.refundStatus === 'PROCESSING' || order.refundStatus === 'REFUNDED' || order.grantStatus === 'REVERTED') {
      return { success: false, error: '退款已处理或正在处理，当前不能取消售后', errorCode: 1029 };
    }
    const nowTs = new Date();
    item.statusBeforeCancellation = item.status;
    item.refundStatusBeforeCancellation = item.refundStatus || 'NONE';
    item.status = 'CANCELLED';
    item.refundStatus = 'NONE';
    item.cancelledAt = nowTs;
    item.cancelledBy = 'USER';
    item.cancellationReason = '用户主动取消';
    item.fundingBlocked = false;
    item.fundingBlockedAt = null;
    item.updatedAt = nowTs;
    if (order.activeAfterSalesCaseId === item._id) order.activeAfterSalesCaseId = '';
    if (!['PROCESSING', 'REFUNDED'].includes(order.refundStatus)) order.refundStatus = 'NONE';
    return { success: true, case: mockCaseView(item) };
  },
  'afterSales.list': () => ({
    success: true,
    items: Object.values(db.afterSalesCases).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(mockCaseView),
  }),
  'afterSales.detail': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    return { success: true, item: mockCaseView(item) };
  },
  'afterSales.syncRights': (data) => {
    const order = db.orders[data.orderId];
    if (!order) return { success: false, error: '订单不存在或已失效', errorCode: 1024 };
    return { success: true, ...mockOrderView(order), memberExpiresAt: mockUser.memberExpiresAt || null };
  },
  'afterSales.adminStatus': () => {
    const activeStatuses = ['SUBMITTED', 'AUTO_CHECKING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'REFUND_FAILED'];
    const pendingCount = Object.values(db.afterSalesCases)
      .filter(item => activeStatuses.includes(item.status)).length;
    const fundingBlockedCount = Object.values(db.afterSalesCases)
      .filter(item => item.status === 'REFUND_FAILED' && item.fundingBlocked === true).length;
    const sales = mockMembershipSalesView();
    return {
      success: true,
      isAdmin: true,
      migrationCompleted: true,
      entitlementMigrationCompleted: true,
      pendingCount,
      fundingBlockedCount,
      membershipSales: sales,
      membershipEnforcement: mockMembershipEnforcementView(),
    };
  },
  'afterSales.adminSetMembershipSales': (data) => {
    const state = data.state === 'PAUSED' ? 'PAUSED' : 'OPEN';
    const reason = String(data.reason || '').trim();
    if (state === 'PAUSED' && !reason) {
      return { success: false, error: '暂停会员购买时必须填写原因', errorCode: 1010 };
    }
    db.paymentConfig.membership_sales = {
      state,
      reason: state === 'PAUSED' ? reason : '',
      updatedAt: new Date(),
      updatedBy: mockUser.openId,
    };
    return { success: true, membershipSales: mockMembershipSalesView() };
  },
  'afterSales.adminSetMembershipEnforcement': (data) => {
    const mode = String(data.mode || '').trim().toLowerCase();
    if (!['off', 'test', 'all'].includes(mode)) {
      return { success: false, error: '参数不合法', errorCode: 1010 };
    }
    db.paymentConfig.membership_enforcement = {
      mode,
      updatedAt: new Date(),
      updatedBy: mockUser.openId,
    };
    return { success: true, membershipEnforcement: mockMembershipEnforcementView() };
  },
  'afterSales.adminList': (data) => {
    const keyword = String(data.keyword || '').trim();
    const page = Math.max(1, Math.floor(Number(data.page) || 1));
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(data.pageSize) || 20)));
    let items = Object.values(db.afterSalesCases);
    if (data.status) items = items.filter(item => item.status === data.status);
    if (keyword) {
      items = items.filter(item =>
        item.caseNo === keyword
        || item.orderId === keyword
        || item.outTradeNo === keyword
        || item.userId === keyword
        || String(mockUser.nickname || '').toLowerCase().includes(keyword.toLowerCase()));
    }
    items = items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = items.length;
    const pageItems = items
      .slice((page - 1) * pageSize, page * pageSize)
      .map(item => ({
        ...mockCaseView(item),
        user: mockAdminOrderView(db.orders[item.orderId] || { _id: item.orderId }).user,
      }));
    return {
      success: true,
      items: pageItems,
      count: pageItems.length,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  },
  'afterSales.adminDetail': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    const order = db.orders[item.orderId];
    const userCases = Object.values(db.afterSalesCases).filter(entry => entry.orderId === order._id);
    const orderView = mockOrderView(order);
    return {
      success: true,
      case: mockCaseView(item),
      order: {
        ...orderView,
        entitlementGrant: order.entitlementGrant || {},
        paymentResult: order.paymentResult || {},
      },
      user: {
        openId: mockUser.openId,
        nickname: mockUser.nickname,
        memberExpiresAt: mockUser.memberExpiresAt,
        taskPackCount: mockUser.taskPackCount || 0,
        protectedTaskQuota: mockUser.protectedTaskQuota || 5,
        lastReminderCreatedAt: mockUser.lastReminderCreatedAt || null,
      },
      history: {
        items: userCases.map(mockCaseView),
        stats: {
          total: userCases.length,
          refunded: userCases.filter(entry => entry.status === 'REFUNDED').length,
          rejected: userCases.filter(entry => entry.status === 'REJECTED').length,
          cancelled: userCases.filter(entry => entry.status === 'CANCELLED').length,
          active: userCases.filter(entry => !['REFUNDED', 'REJECTED', 'CANCELLED', 'RESOLVED', 'CLOSED'].includes(entry.status)).length,
          sameOrder: userCases.length,
        },
      },
      actionCapabilities: {
        canSyncPayment: !!order && ['PENDING', 'PAID'].includes(order.status),
        canRetryGrant: !!order && order.status === 'PAID' && order.grantStatus === 'FAILED',
        canApproveRefund: !!order && order.status === 'PAID'
          && ['AUTO_CHECKING', 'UNDER_REVIEW', 'REFUND_FAILED'].includes(item.status)
          && order.refundStatus !== 'REFUNDED',
        canReject: ['AUTO_CHECKING', 'UNDER_REVIEW', 'REFUND_FAILED'].includes(item.status),
        canSyncRefund: !!item.outRefundNo && ['PROCESSING', 'REFUND_FAILED'].includes(item.status),
      },
    };
  },
  'afterSales.adminApproveRefund': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    const order = db.orders[item.orderId];
    item.status = 'REFUNDED';
    item.refundStatus = 'REFUNDED';
    item.refundedAt = new Date();
    item.refundAmountFen = order.amountFen;
    order.refundStatus = 'REFUNDED';
    order.refundedAmountFen = order.amountFen;
    order.refundedAt = new Date();
    order.grantStatus = 'REVERTED';
    if (order.entitlementGrant) order.entitlementGrant.revertedAt = new Date();
    const addedMs = order.entitlementGrant ? Number(order.entitlementGrant.memberDaysAddedMs) || 0 : 0;
    const currentExpiry = new Date(mockUser.memberExpiresAt || 0).getTime();
    const nextExpiry = Math.max(Date.now(), currentExpiry - addedMs);
    mockUser.memberExpiresAt = new Date(nextExpiry);
    mockUser.memberLevel = nextExpiry > Date.now() ? 'MEMBER' : 'NORMAL';
    if (order.entitlementGrant && order.entitlementGrant.taskPackDelta) {
      mockUser.taskPackCount = Math.max(0, Number(mockUser.taskPackCount) - order.entitlementGrant.taskPackDelta);
      mockUser.taskPackSlots = Math.max(
        0,
        Number(mockUser.taskPackSlots) - (Number(order.entitlementGrant.taskPackSlotsAdded)
          || Number(order.entitlementGrant.taskPackDelta) * LEGACY_TASK_PACK_SIZE)
      );
    }
    return { success: true, refundStatus: 'REFUNDED', caseId: item._id };
  },
  'afterSales.adminReject': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    if (!String(data.decisionNote || '').trim()) return { success: false, error: '请填写驳回原因', errorCode: 1010 };
    item.status = 'REJECTED';
    item.refundStatus = 'REJECTED';
    item.decisionNote = data.decisionNote;
    db.orders[item.orderId].refundStatus = 'REJECTED';
    return { success: true, case: mockCaseView(item) };
  },
  'afterSales.adminSyncPayment': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    const order = db.orders[item.orderId];
    return { success: true, ...mockOrderView(order), memberExpiresAt: mockUser.memberExpiresAt || null };
  },
  'afterSales.adminRetryGrant': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    const order = db.orders[item.orderId];
    if (!order || order.status !== 'PAID' || order.grantStatus !== 'FAILED') {
      return { success: false, error: '当前订单不需要补发权益', errorCode: 1029 };
    }
    order.grantStatus = 'GRANTED';
    item.status = 'RESOLVED';
    return { success: true, entitlementStatus: 'PAID_GRANTED' };
  },
  'afterSales.adminSyncRefund': (data) => {
    const item = db.afterSalesCases[data.caseId];
    if (!item) return { success: false, error: '售后记录不存在', errorCode: 1030 };
    return { success: true, refundStatus: item.refundStatus || 'PROCESSING', caseId: item._id };
  },
  'afterSales.adminMigrateProtection': () => ({ success: true, scanned: 0, updated: 0, nextCursor: null, hasMore: false }),

  /* ----- 订阅消息额度（一次性订阅，按模板记账） ----- */
  'subscribe.add': (data) => {
    const tpl = data.templateId || 'mock-template';
    subscribeQuotas[tpl] = (subscribeQuotas[tpl] || 0) + 1;
    subscribeSeq = Object.values(subscribeQuotas).reduce((sum, n) => sum + n, 0);
    mockUser.subscribeQuota = subscribeSeq;
    mockUser.subscribeQuotas = subscribeQuotas;
    return { success: true, quota: subscribeQuotas[tpl], totalQuota: subscribeSeq, quotas: subscribeQuotas, templateId: tpl };
  },
  'subscribe.get': (data) => {
    const tpl = data.templateId || 'mock-template';
    const health = mockReminderHealthOf(Object.values(db.tasks), subscribeQuotas[tpl] || 0, new Date());
    return {
      success: true,
      quota: subscribeQuotas[tpl] || 0,
      totalQuota: subscribeSeq,
      quotas: subscribeQuotas,
      templateId: tpl,
      pendingMessageCount: health.pendingMessageCount,
      nearestRemindAt: health.nearestRemindAt,
      level: health.level,
      shortfall: health.shortfall,
      replenishNeeded: health.replenishNeeded,
    };
  },

  /* ----- feedback（意见反馈 / 信息纠错，与 cloudfunctions/feedback/lib/schema.js 对齐） ----- */
  'feedback.submit': (data) => {
    const type = data.type;
    if (type !== 'feedback' && type !== 'correction') return { success: false, error: '类型不合法', errorCode: 1010 };
    if (!data.content || !String(data.content).trim()) return { success: false, error: '内容不能为空', errorCode: 1020 };
    if (type === 'feedback') {
      if (!['suggestion', 'bug'].includes(data.category)) return { success: false, error: '反馈类型不合法', errorCode: 1010 };
    } else {
      if (!data.spotId) return { success: false, error: '请选择景点', errorCode: 1010 };
      if (!['RELEASE_TIME', 'RELEASE_RULE', 'OPEN_TIME', 'TICKET_PRICE', 'ADDRESS', 'CLOSED_DAYS', 'OTHER'].includes(data.errorType)) return { success: false, error: '纠错类型不合法', errorCode: 1010 };
    }
    const isCorrection = type === 'correction';
    const id = 'mock-feedback-' + (++feedbackSeq);
    db.feedbacks[id] = {
      _id: id, userId: 'mock-user', type,
      category: isCorrection ? null : data.category,
      spotId: isCorrection ? data.spotId : null,
      spotName: isCorrection ? (data.spotName || '') : null,
      errorType: isCorrection ? data.errorType : null,
      content: String(data.content).trim(),
      contact: (data.contact || '').trim(),
      status: 'OPEN',
      createdAt: new Date(),
    };
    return { success: true, id };
  },
  'feedback.list': () => ({
    success: true,
    items: Object.values(db.feedbacks)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50),
  }),
  /* mock 用户按普通用户处理；管理员入口必须走真实 feedback 云函数白名单。 */
  'feedback.adminStatus': () => ({ success: true, isAdmin: false }),

  /* 首页聚合（镜像云端 reminder homeBootstrap）：复用各域 handler 组合返回，供 USE_MOCK=true 时首页使用 */
  /* 首页行程状态墙 V2（镜像 reminder/index.js 的 homeBootstrap，API-契约 8.2）*/
  'home.bootstrap': (data) => {
    const includeSpots = !data || data.includeSpots !== false;
    const nowTs = new Date();
    const today = fmt(new Date());

    /* 读取时兜底收敛（REMINDER-RULE-004）：首页不再调 task.list，
       少了这一步，过期任务会静默显示成「待提醒」且毫无提示 */
    const allTasks = Object.values(db.tasks);
    let healed = false;
    allTasks.forEach(t => {
      const spot = SPOTS.find(s => s.spotId === t.spotId);
      const rule = RULES.find(r => r.spotId === t.spotId) || null;
      const releaseAt = t.releaseAt || deriveReleaseAt(spot, rule, t.visitDate);
      if (t.backendStatus === 'WAITING' && releaseAt && new Date(releaseAt).getTime() <= nowTs.getTime()) {
        t.backendStatus = 'MISSED';
        t.missedReason = t.missedReason || t.lastSendError || '超过放票时间点未触发成功';
        if (shouldHealQuota(t.lastSendError)) healed = true;
      }
    });
    if (healed) healSubscribeQuotas();

    const decorated = Object.values(db.items).map(i => decorateItem(i, nowTs));

    const activeTrips = [];
    const historyTrips = [];
    Object.values(db.trips).forEach(t => {
      const mine = decorated.filter(d => d.tripId === t._id);
      const entry = {
        _id: t._id, city: t.city, startDate: t.startDate, endDate: t.endDate, name: t.name,
        progress: backupGroupProgress(mine), itemCount: mine.length,
        /* 首页预填 add-trip 用；与云端 homeBootstrap 同一口径 */
        spotIds: [...new Set(mine.map(i => i.spotId))],
      };
      /* 结束日当天仍属进行中（还能回看和补标），次日才归入历史 */
      if (t.endDate >= today) {
        entry.items = mine.slice().sort((a, b) => {
          const d = String(a.visitDate).localeCompare(String(b.visitDate));
          if (d !== 0) return d;
          return (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER)
            - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER);
        });
        activeTrips.push(entry);
      } else {
        historyTrips.push(entry);
      }
    });
    activeTrips.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    historyTrips.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

    /* 吸顶横幅：跨全部当前/未来行程取全局最近的一条 */
    const soon = decorated
      .filter(d => d.releaseAt && new Date(d.releaseAt).getTime() > nowTs.getTime()
        && new Date(d.releaseAt).getTime() - nowTs.getTime() <= 3600000)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt))[0] || null;
    let stickyBanner = null;
    if (soon) {
      const rel = new Date(soon.releaseAt);
      const minutesLeft = Math.max(1, Math.round((rel.getTime() - nowTs.getTime()) / 60000));
      const dayWord = fmt(rel) === today ? '今天' : (fmt(rel) === addDays(today, 1) ? '明天' : formatMonthDay(fmt(rel)));
      stickyBanner = {
        type: 'UPCOMING',
        /* ⚠️ 不带「还有N分钟」：提醒是在开票**前**发的，横幅讲的是开票时刻本身，
           两者混用会让用户以为「是不是已经提醒过我了」。与云端 task.buildReleaseBanner 逐字一致。 */
        text: `${dayWord}${formatHourMinute(rel)}开抢${soon.spotName}${formatMonthDay(soon.visitDate)}的门票`,
        itemId: soon.itemId, spotId: soon.spotId, visitDate: soon.visitDate,
        releaseAt: soon.releaseAt, minutesLeft,
      };
    }

    /* 自动定位：24 小时内刚开抢、还没标记的一条（优先可抢 —— 还来得及救） */
    const markable = decorated.filter(d => d.canMark)
      .sort((a, b) => {
        const pa = a.ticketState === 'BOOKABLE' ? 0 : 1;
        const pb = b.ticketState === 'BOOKABLE' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return new Date(b.releaseAt) - new Date(a.releaseAt);
      });

    return {
      success: true,
      serverNow: nowTs,
      primaryTripId: activeTrips.length ? activeTrips[0]._id : '',
      scrollTargetId: markable.length ? markable[0].itemId : null,
      trips: activeTrips,
      history: historyTrips,
      stickyBanner,
      reminderQuotaWarning: mockReminderQuotaWarningOf(
        mockReminderHealthOf(Object.values(db.tasks), subscribeSeq, nowTs),
        nowTs
      ),
      membership: mockMembershipSnapshot(nowTs),
      /* 摘要卡底部的「即将提醒」胶囊：与 stickyBanner 平级、独立，不限 1h 窗口 */
      releasePills: releasePillsOf(decorated, nowTs, 2),
      /* 「没抢到」之后还能换哪些日期（决策文档 4.3）。与云端 homeBootstrap 同口径：
         必须跟着这一份响应一起来，页面不得另开一次请求去算。 */
      recoverableIds: mockRecoverableIds(decorated, nowTs),
      homeMode: decorated.length === 0 ? 1 : 2,
      hotSpots: includeSpots ? handlers['list']().data : [],
      /* 旧字段保留一个版本，避免未升级的调用方读不到东西；新首页不消费 */
      groups: [], counts: { active: 0, expired: 0 }, banner: null,
      cart: null, tripTasks: null, showGroupTabs: false,
    };
  },

};

function mockCall(name, data) {
  const action = (data && data.action) || name;
  const h = handlers[action];
  if (!h) return Promise.reject({ success: false, error: 'mock 未实现: ' + name + '.' + action, errorCode: 1099 });
  try {
    return Promise.resolve(h(data || {})).then(res => {
      /* 错误约定统一：mock 与云函数一致，校验失败一律 reject（页面只写 catch → toastError 一套错误处理） */
      if (res && res.success === false) return Promise.reject(res);
      return res;
    });
  } catch (e) {
    return Promise.reject({ success: false, error: e.message, errorCode: 1500 });
  }
}

/* 供页面 fallback 使用：单一数据源，避免各页本地 MOCK 漂移 */
function spotsListCards() { return SPOTS.map(buildCard); }

module.exports = {
  mockCall, USE_MOCK, SPOTS, spotsListCards,
  /* 仅供 test/mock-mirror.test.js 做「云端 vs mock 同一组输入同一结果」的交叉断言。
     页面不要直接用这些内部函数——状态推导请走 home.bootstrap 返回的 ticketState。 */
  __internals: {
    ticketStateOf, ticketStateLabelOf, reminderStateOf, backupGroupProgress,
    canSetReminderOf,
    deriveReleaseAt, releaseStateOf, previewTimeline, mockRecoveryCandidates,
    mockReminderHealthOf, mockReminderQuotaWarningOf,
    mockRules: () => RULES,
    TICKET_LABEL, REMINDER_LABEL,
    RESULT_UNDO_SECONDS, UNMARKED_AFTER_HOURS, PENDING_CART_TRIP_ID,
    /* 内存库本体：仅供测试在「已有一条行程项」这类既成事实下起测 */
    db,
  },
};
