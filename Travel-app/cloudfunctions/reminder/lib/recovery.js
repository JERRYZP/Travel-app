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

const { COLLECTIONS, ok, fail, ERRORS } = require('./schema');
const time = require('./time');
const item = require('./item');

/** 候选日的行动类型 */
const RecoveryAction = {
  BOOK_NOW: 'BOOK_NOW',           // 已开票：去官方渠道预约
  SET_REMINDER: 'SET_REMINDER',   // 未开票：设提醒
};

/**
 * 判断某个日期对某景点是否「可行动」。
 *
 * 不可行动的情况（决策文档 4.3 第 4 点）：已过、闭馆、无放票规则。
 * @returns {{ok:boolean, releaseAt:Date|null, action:string|null, label:string}}
 */
function candidateOf(spot, rule, visitDate, nowTs) {
  const today = time.todayStr();

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
 * @param {Array}  p.siblings    同一行程内的其他行程项（decorateItem 结果）
 * @param {object} p.spotMap     spotId → spot
 * @param {object} p.ruleMap     spotId → rule
 * @param {Date}   [p.nowTs]
 * @returns {Array} 候选数组，可能为空
 */
function buildCandidates({ failed, siblings, spotMap = {}, ruleMap = {}, nowTs = time.now() }) {
  const sameSpot = (siblings || []).filter(s =>
    s.spotId === failed.spotId && s.itemId !== failed.itemId);

  /* 第 ① 层：用户已经自己设了备选，且备选还没到放票时间 → 静默。
     备选的存在本身就是挽回方案；此时提醒会照常发，不需要我们再建议什么。 */
  const pendingBackup = sameSpot.some(s => !s.ended && !s.canMark && s.ticketState === 'PENDING');
  if (pendingBackup) return [];

  /* 第 ② 层：没设备选 → 在行程范围内找可行动的其他日期。
     同景点的其他日期优先（用户本来就想约这个景点），其后是行程内其他景点。 */
  const tripId = failed.tripId;
  const inTrip = (siblings || []).filter(s => s.tripId === tripId);

  // 已占用的日期不再作为候选（同景点已有行程项的日期）
  const takenDates = new Set(sameSpot.map(s => s.visitDate));

  /* 候选日期池：同行程其他行程项的出行日 + 失败那条自己的出行日。
     纯预览化之后行程项就是「用户表达过兴趣的日期」，用它当池子最贴切。 */
  const visitDatePool = [...new Set(inTrip.map(s => s.visitDate).concat(failed.visitDate))].sort();

  const candidates = [];
  const seen = new Set();

  const pushFor = (spotId) => {
    const spot = spotMap[spotId];
    const rule = ruleMap[spotId];
    if (!spot || !rule) return;
    for (const visitDate of visitDatePool) {
      if (spotId === failed.spotId && takenDates.has(visitDate)) continue;
      const key = `${spotId}|${visitDate}`;
      if (seen.has(key)) continue;
      const c = candidateOf(spot, rule, visitDate, nowTs);
      if (!c.ok) continue;
      seen.add(key);
      candidates.push({
        spotId,
        spotName: spot.name,
        visitDate,
        releaseAt: c.releaseAt,
        action: c.action,
        label: c.label,
      });
    }
  };

  // 同景点优先（用户本来就想约这个），行程内其他景点次之
  pushFor(failed.spotId);
  for (const s of inTrip) {
    if (s.spotId !== failed.spotId) pushFor(s.spotId);
  }

  /* 第 ③ 层：什么都没有 → 返回空。
     调用方据此保持静默，不弹浮层、不给「延长行程」这类空转建议。 */
  if (candidates.length === 0) return [];

  // 已开票的排前面（现在就能去约），同类型按日期升序
  return candidates.sort((a, b) => {
    const pa = a.action === RecoveryAction.BOOK_NOW ? 0 : 1;
    const pb = b.action === RecoveryAction.BOOK_NOW ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.visitDate.localeCompare(b.visitDate);
  }).slice(0, 6); // 浮层里最多列 6 条，再多就不叫「建议」了
}

/**
 * 数据库入口：tripItem.recoveryCandidates
 *
 * 「建议」入口是**固定**的（决策文档 4.3）：卡片右侧菜单里随时能重新打开，
 * 不因为用户一次划掉就找不回来。因此这个 action 允许对任意已标记 FAILED
 * 的行程项重复调用，不做「只能调一次」的限制。
 */
async function candidates(db, userId, itemId) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);

  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ _id: itemId, userId }).get();
  const target = (res.data || [])[0];
  if (!target) return fail(ERRORS.ITEM_NOT_FOUND);

  const nowTs = time.now();
  const tripItems = await item.listItemsByTrip(db, userId, target.tripId);
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
  candidates,
};
