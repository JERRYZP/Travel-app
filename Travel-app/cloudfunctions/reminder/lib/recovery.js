/**
 * 挽回建议（决策文档 4.3，2026-09-16 首页行程化 P2）
 *
 * 「没抢到」之后的第三层动线：告诉用户「还能怎么办」。
 *
 * ⚠️ 最重要的一条规则：**什么都不建议是合法的。**
 * 失败时刻的空转建议比没有建议更伤信任。三层里有两层是「返回空数组」。
 *
 * 三层（按优先级短路）：
 *   ① 用户已设备选、且备选还没到放票时间 → **静默**。备选的存在本身就是挽回方案，
 *      用户已经安排好了，再弹建议等于打扰。此时提醒照常按原计划发。
 *   ② 用户没设备选，但行程内还有可行动日期 → 返回候选（已开票 / 未开票）。
 *   ③ 没设备选、行程内也没有可用日期 → **静默**。
 *      不提供「延长行程」：延长出去的新日期同样无票可抢，等于空转建议。
 *
 * 数据红线（最高优先级）：
 * - **不做同日回流票**。V1 没有可靠的官方数据源，宁可没有，不编一个。
 * - 不出现任何余票字段。`BOOK_NOW` 只说「已开票，去官方渠道预约」，
 *   **不承诺一定有余票**，也不给「已约满」结论——没有可靠余票数据时不编结论。
 * - 候选日的开放性判定统一走 time.isOpenOn，禁止在业务代码里自行 includes。
 */

const { COLLECTIONS, TicketResult, ok, fail, ERRORS } = require('./schema');
const time = require('./time');
const item = require('./item');

/** 候选日的行动类型 */
const RecoveryAction = {
  BOOK_NOW: 'BOOK_NOW',           // 已开票：去官方渠道预约
  SET_REMINDER: 'SET_REMINDER',   // 未开票：设提醒
};

/* 每个景点最多给几条候选。不设这个上限时，同景点会把名额占满
   （行程一长，故宫一个人就能凑出十几条），用户看不到「换个景点」这类选项，
   而浮层里超过 6 条也就不叫「建议」了。 */
const MAX_PER_SPOT = 2;
const MAX_TOTAL = 6;

/**
 * 判断某个日期对某景点是否「可行动」。
 *
 * 不可行动的情况（决策文档 4.3 第 4 点）：已过、闭馆、无放票规则。
 * @returns {{ok:boolean, releaseAt:Date|null, action:string|null, label:string}}
 */
function candidateOf(spot, rule, visitDate, nowTs) {
  // ⚠️ 必须传 nowTs：不传就会读真实时钟，导致「已过」判定既不可测
  // 又和同一个 nowTs 下的放票时刻比较口径不一致
  const today = time.todayStr(nowTs);

  // 已过 —— 含当天也不行：当天已经没时间再去抢了
  if (visitDate <= today) return { ok: false };

  // 闭馆 / 白名单不可约日（统一走 isOpenOn，勿自行 includes）
  if (!time.isOpenOn(rule, time.dayNameOf(visitDate))) return { ok: false };

  const label = time.formatMonthDayWeekCn(visitDate);

  // 免预约景点：无需抢票，不构成「挽回」——它本来就不在提醒动线上
  if (!spot || spot.reservationRequired === false) return { ok: false };

  // 无放票规则（如环球影城）：不可行动，不返回
  const releaseAt = item.deriveReleaseAt(spot, rule, visitDate);
  if (!releaseAt) return { ok: false };

  if (releaseAt.getTime() <= nowTs.getTime()) {
    // 已开票：只陈述事实，不承诺有余票
    return {
      ok: true,
      releaseAt,
      action: RecoveryAction.BOOK_NOW,
      label: `${label} 已开票，去官方渠道预约`,
    };
  }

  return {
    ok: true,
    releaseAt,
    action: RecoveryAction.SET_REMINDER,
    label: `${label} ${time.formatHourMinute(releaseAt)} 放票`,
  };
}

/**
 * 纯函数版挽回建议：给定行程内全部行程项（已装饰）+ 景点/规则上下文，
 * 算出「没抢到的那一条」还能换哪些日期。
 *
 * 抽成纯函数是为了能脱离数据库单测三层分支——这部分的正确性靠文案口径，
 * 不是靠 IO。
 *
 * @param {object} p
 * @param {object} p.failed      被标记 FAILED 的那条（decorateItem 结果）
 * @param {Array}  p.siblings    同一行程内的全部行程项（decorateItem 结果）
 * @param {object} p.trip        行程 {startDate, endDate}，决定候选日期池
 * @param {object} p.spotMap     spotId → spot
 * @param {object} p.ruleMap     spotId → rule
 * @param {Date}   [p.nowTs]
 * @returns {Array} 候选数组，可能为空
 */
function buildCandidates({ failed, siblings, trip, spotMap = {}, ruleMap = {}, nowTs = time.now() }) {
  const sameSpot = (siblings || []).filter(s =>
    s.spotId === failed.spotId && s.itemId !== failed.itemId);

  /* 第 ① 层：用户已经自己设了备选，且备选还没到放票时间 → 静默。
     备选的存在本身就是挽回方案；此时提醒会照常发，不需要我们再建议什么。 */
  const pendingBackup = sameSpot.some(s => !s.ended && !s.canMark && s.ticketState === 'PENDING');
  if (pendingBackup) return [];

  /* 候选日期池 = **行程本身的日期范围**，不是「已经加过的日子」。
     差别的关键：行程开头的那些天，放票时间往往早就过了——它们正是
     「已开票、现在就能去官方渠道约」的候选。只看已加过的日子就永远看不到这类建议。 */
  const startDate = trip && trip.startDate ? trip.startDate : failed.visitDate;
  const endDate = trip && trip.endDate ? trip.endDate : failed.visitDate;
  const visitDatePool = time.dateRange(startDate, endDate);

  /* ⚠️ 必须排除掉「用户刚刚失败的那一天」。
     把 10月2日 原样建议回去，等于对用户说「再约一次 10月2日吧」——
     他刚告诉你那天没成。这是最容易写错、也最伤信任的一条。 */
  const takenDates = new Set(
    [failed.visitDate].concat(sameSpot.map(s => s.visitDate))
  );

  const candidates = [];
  const seen = new Set();

  const pushFor = (spotId) => {
    const spot = spotMap[spotId];
    const rule = ruleMap[spotId];
    // 无 spot / 无 rule 的景点一律跳过：没有规则就推不出放票时刻，也就无从判断可行动性
    if (!spot || !rule) return;
    const mine = [];
    for (const visitDate of visitDatePool) {
      if (spotId === failed.spotId && takenDates.has(visitDate)) continue;
      const key = `${spotId}|${visitDate}`;
      if (seen.has(key)) continue;
      const c = candidateOf(spot, rule, visitDate, nowTs);
      if (!c.ok) continue;
      seen.add(key);
      mine.push({
        spotId,
        spotName: spot.name,
        visitDate,
        releaseAt: c.releaseAt,
        action: c.action,
        label: c.label,
      });
    }
    /* 名额在两个行动类型之间**各取一半**，而不是简单地取前 N 条。
       前 N 条会被日期早的 BOOK_NOW 全占掉，用户就看不到「等下一场放票」这条路，
       而它往往才是真的能约上的那条。 */
    const bookNow = mine.filter(c => c.action === RecoveryAction.BOOK_NOW);
    const setReminder = mine.filter(c => c.action === RecoveryAction.SET_REMINDER);
    const quota = Math.max(1, Math.floor(MAX_PER_SPOT / 2));
    const picked = [
      ...bookNow.slice(0, quota),
      ...setReminder.slice(0, quota),
    ];
    // 某一类为空时补足另一类，保证「有可用日期」的景点至少给出 2 条
    if (picked.length < MAX_PER_SPOT) {
      const rest = mine.filter(c => picked.indexOf(c) === -1);
      picked.push(...rest.slice(0, MAX_PER_SPOT - picked.length));
    }
    candidates.push(...picked);
  };

  // 同景点优先（用户本来就想约这个），行程内其他景点次之
  pushFor(failed.spotId);
  for (const s of (siblings || [])) {
    if (s.tripId === failed.tripId && s.spotId !== failed.spotId) pushFor(s.spotId);
  }

  /* 第 ③ 层：什么都没有 → 返回空。
     调用方据此保持静默，不弹浮层、不给「延长行程」这类空转建议。 */
  if (candidates.length === 0) return [];

  // 同景点内先按「已开票优先、日期升序」排，再整体按同样规则排，最后截断总数
  const rank = (a, b) => {
    const pa = a.action === RecoveryAction.BOOK_NOW ? 0 : 1;
    const pb = b.action === RecoveryAction.BOOK_NOW ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.visitDate.localeCompare(b.visitDate);
  };
  return candidates.sort((a, b) => {
    const d = rank(a, b);
    return d !== 0 ? d : String(a.spotId).localeCompare(String(b.spotId));
  }).slice(0, MAX_TOTAL);
}

/**
 * 把「哪些行程项还能挽回」一次算清，供 `home.bootstrap` 内联回填。
 *
 * ⚠️ **2026-09-24 从页面侧搬到这里，是一次真 bug 的修复**，别改回逐条调 action：
 *   首页原先在 `loadHome` 之后由**页面**对每条 FAILED 项并发调一次
 *   `tripItem.recoveryCandidates`，把结果塞进组件的 `recoverable`。
 *   那条链路有两个各自独立的断点，症状却是同一个「约其他日永远不出现」：
 *     ① `didMark` 触发的那次重载是 silent 的，早期版本压根没在这一支里重算候选；
 *     ② 更隐蔽的是，重算走的是**另一次云端往返**，它与 bootstrap 的返回体之间
 *        没有任何顺序保证。标记后立即落地的响应体已经带着 `result = FAILED`，
 *        而候选还在路上——卡片此时按「FAILED 但不可挽回」渲染（菜单里那一项
 *        要的是 `recoverable`，气泡也压着不显示），用户看到的就是「没有挽回线」。
 *   算在 bootstrap 里，候选与它要解释的那条行程项**同一次响应**到达，
 *   不存在「谁先到」这个问题，也顺手把 N 条行程项的 N 次并发往返收敛掉。
 *
 * 行程项按 `tripId` 分组调用 `buildCandidates`：同一批 `siblings` 只算一次，
 * 而 `buildCandidates` 本来就要看同行程的兄弟项（第①层的「已设备选」判据）。
 *
 * @returns {Object} itemId → 候选数组。**只含非空**，所以 `Object.keys` 就是
 *                   「哪些行程项可以挽回」，调用方直接拿去回填 `recoverable`。
 */
function recoverableMapOf({ decorated, trips, spotMap, ruleMap, nowTs }) {
  const byItemId = {};
  const tripById = {};
  for (const t of (trips || [])) tripById[t._id] = t;

  const byTrip = {};
  for (const d of (decorated || [])) {
    if (d.result !== TicketResult.FAILED || d.ended) continue;
    if (!byTrip[d.tripId]) byTrip[d.tripId] = [];
    byTrip[d.tripId].push(d);
  }

  for (const tripId of Object.keys(byTrip)) {
    const list = byTrip[tripId];
    /* 同行程的全部行程项（不只 FAILED 的那几条）：
       「已设备选且备选未到放票时间 → 静默」这一层要看得到那些备选。 */
    const siblings = (decorated || []).filter(d => d.tripId === tripId);
    const trip = tripById[tripId] || null;
    for (const failed of list) {
      const found = buildCandidates({ failed, siblings, trip, spotMap, ruleMap, nowTs });
      /* 空候选 = 不打扰，**不写进 map**：调用方据此只发有挽回空间的 itemId，
         而不是让前端再筛一遍「长度 > 0」。 */
      if (found.length) byItemId[failed.itemId] = found;
    }
  }
  return byItemId;
}

/**
 * 数据库入口：tripItem.recoveryCandidates
 *
 * 「建议」入口是**固定**的（决策文档 4.3）：卡片右侧菜单里随时能重新打开，
 * 不因为用户一次划掉就找不回来。因此这个 action 允许对任意已标记 FAILED
 * 的行程项重复调用，不做「只能调一次」的限制。
 *
 * ⚠️ 首页已改为在 `home.bootstrap` 里内联回填（见上方 `recoverableMapOf`），
 * 不再调这个 action；它留着给「重新打开挽回浮层」这类按需入口用，不要删。
 */
async function candidates(db, userId, itemId) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);

  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ _id: itemId, userId }).get();
  const target = (res.data || [])[0];
  if (!target) return fail(ERRORS.ITEM_NOT_FOUND);

  const nowTs = time.now();
  const [tripItems, tripRes] = await Promise.all([
    item.listItemsByTrip(db, userId, target.tripId),
    db.collection(COLLECTIONS.TRIPS).where({ _id: target.tripId, userId }).get(),
  ]);
  const trip = (tripRes.data || [])[0] || null;
  const { spotMap, ruleMap } = await item.loadSpotContext(db, tripItems.map(i => i.spotId));

  const decorated = tripItems.map(it => item.decorateItem({
    item: it,
    spot: spotMap[it.spotId],
    rule: ruleMap[it.spotId],
    task: null,
    nowTs,
  }));
  const failed = decorated.find(d => d.itemId === itemId) || decorated.find(d => d.spotId === target.spotId);

  const list = buildCandidates({
    failed: failed || { spotId: target.spotId, tripId: target.tripId, visitDate: target.visitDate, itemId },
    siblings: decorated,
    trip,
    spotMap,
    ruleMap,
    nowTs,
  });

  return ok({ candidates: list });
}

module.exports = {
  RecoveryAction,
  candidateOf,
  buildCandidates,
  recoverableMapOf,
  candidates,
};
