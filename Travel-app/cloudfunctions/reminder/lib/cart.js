/**
 * 行程清单规则（CART-RULE，2026-09-16 行程化 P1；2026-09-20 改为「提交前暂存区」）
 *
 * 清单是**提交至行程的前一个步骤**：
 *   - 没提交之前，它就暂存在清单页里（跟着用户走，下次进来还在）；
 *   - 提交（cart.commit）之后立即清空。
 *
 * ⚠️ 2026-09-20 起「生成预约时间线」是**纯预览**，不加行程、不落库。
 * 所以用户点「加入清单」时**还没有行程**——清单行统一挂占位 tripId
 * （PENDING_CART_TRIP_ID），提交时才由 trip.create 建/合并行程并整批改挂。
 *
 * 清单同时承载需预约项和免预约项：
 * - 需预约项：releaseAt 必有，remindOn 可勾选；
 * - 免预约项：releaseAt=null，remindOn 恒 false；
 * - 弱提醒景点默认不勾提醒，用户可在清单里手动改。
 */

const { COLLECTIONS, ERRORS, PENDING_CART_TRIP_ID, ok, fail, difficultyOf } = require('./schema');
const time = require('./time');
const item = require('./item');
const tripItem = require('./trip-item');


/**
 * 清单归属的 tripId 归一化。
 *
 * 不传 = 操作「当前暂存清单」。纯预览化之后前端没有真实 tripId 可传，
 * 但老调用方（以及已提交过行程的老数据）仍会传真实 tripId —— 两种都要能用，
 * 否则升级瞬间正在填写中的清单会凭空消失。
 */
function cartTripIdOf(tripId) {
  return tripId || PENDING_CART_TRIP_ID;
}

/** 清单是否属于暂存区（未提交） */
function isPending(tripId) {
  return !tripId || tripId === PENDING_CART_TRIP_ID;
}

/** CART-RULE-002 聚合展示：项数、景点数、将设提醒数 */
function summarize(items) {
  const spotCount = new Set(items.map(i => i.spotId)).size;
  const reminderCount = items.filter(i => i.remindOn === true).length;
  return {
    count: items.length,
    spotCount,
    reminderCount,
    noReminderCount: items.length - reminderCount,
    text: reminderCount > 0
      ? `已选 ${items.length} 项，其中 ${reminderCount} 个将设提醒`
      : `已选 ${items.length} 项，均无需提醒`,
  };
}

/** 清单分组标题用「M月D日 · 周X」。 */
function formatVisitDateLabel(visitDate) {
  return time.formatMonthDayWeek(visitDate).replace(' (', ' · ').replace(')', '');
}

/** 放票副行用「MM月DD日 HH:mm 放票」，月/日保留前导零。 */
function formatReleaseDateLabel(releaseAt) {
  const p = time.beijingParts(new Date(releaseAt));
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${mm}月${dd}日`;
}

/**
 * 清单按**出行日**分组，而不是按放票日。
 *
 * 用户在这一页管理的是“哪天去哪些地方”；放票时间只作为该行程项的属性。
 * 免预约项与需预约项共用同一个出行日分组，不再单列“无需预约”块。
 */
function groupByVisitDate(items) {
  const dates = [...new Set(items.map(i => i.visitDate).filter(Boolean))].sort();
  const firstDate = dates[0];
  return dates.map(visitDate => ({
    key: visitDate,
    label: formatVisitDateLabel(visitDate),
    dayLabel: firstDate ? `【第${time.diffDays(firstDate, visitDate) + 1}天】` : '',
    items: items
      .filter(i => i.visitDate === visitDate)
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
}

/** CART-RULE-001 加入清单（单条） */
async function add(db, userId, { tripId, spotId, visitDate, releaseAt, remindOn }) {
  if (!spotId || !visitDate) return fail(ERRORS.BAD_PARAM);
  const targetTripId = cartTripIdOf(tripId);
  const nowTs = time.now();

  const [spotRes, ruleRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId }).get(),
  ]);
  const spot = (spotRes.data || [])[0];
  if (!spot) return fail(ERRORS.SPOT_NOT_FOUND);
  const rule = (ruleRes.data || [])[0] || null;
  const reservationRequired = spot.reservationRequired !== false;

  let resolvedReleaseAt = null;
  let resolvedRemindOn = false;
  if (reservationRequired) {
    /* ⚠️ **放票时刻服务端自己推**，不信任调用方传的那个（2026-09-24）：
       它由 `visitDate − advanceDays` 在 `lib/item.js` 里唯一推出，调用方再传一遍
       就是第二套口径，迟早对不上。

       ⚠️ 更要紧的是：**「约其他日」这条动线根本没有 releaseAt 可传**。
       它拿到的是用户从日历里选的一个日期（`date-picker-sheet` 只回 visitDate），
       以前这里直接 `!releaseAt → BAD_PARAM`，用户点「确定」只会看到
       「请检查输入」——挽回线点得开、走不通。别把这道校验改回去：
       用户要的是「换一天再抢」，页面不该为了凑一个参数去重算放票时刻。 */
    const derived = item.deriveReleaseAt(spot, rule, visitDate);
    if (!derived) return fail(ERRORS.BAD_PARAM);
    resolvedReleaseAt = derived;
    /* 已过放票时刻的项只能“仅加行程”：此时提醒已经不可能送达，
       不能再让用户在清单里切换成一个最终必然失败的开关。 */
    const releasePassed = new Date(resolvedReleaseAt).getTime() <= nowTs.getTime();
    resolvedRemindOn = releasePassed
      ? false
      : (typeof remindOn === 'boolean' ? remindOn : tripItem.defaultRemindOn(spot));
  }

  // 逻辑唯一约束 (userId, tripId, spotId, visitDate) —— 在暂存区里就是 (userId, spotId, visitDate)
  const exist = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: targetTripId, spotId, visitDate }).get();
  if ((exist.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  /* 已落为行程项的不再进入清单 —— 按 (userId, spotId, visitDate) 跨行程查。
     纯预览态下预览本身看不到「已在行程」（预览不查已落库数据），
     所以这道去重必须在这里拦住，否则用户会重复提交同一天同一景点。 */
  const itemRes = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, spotId, visitDate }).get();
  if ((itemRes.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  const res = await db.collection(COLLECTIONS.REMINDER_CART).add({
    data: {
      userId,
      tripId: targetTripId,
      spotId,
      visitDate,
      releaseAt: resolvedReleaseAt,
      remindOn: resolvedRemindOn,
      reservationRequired,
      createdAt: nowTs,
    },
  });
  return ok({ cartId: res._id, remindOn: resolvedRemindOn });
}

/** CART-RULE-004 批量加入：仅作用于当前选中的 Tab */
async function addBatch(db, userId, tripId, events, scope, scopeKey) {
  const { EventSelectStatus } = require('./schema');
  if (!scope || !scopeKey) return fail(ERRORS.BAD_PARAM);
  const inScope = scope === 'departure'
    ? (e) => e.visitDate === scopeKey
    : (e) => e.spotId === scopeKey;

  const selectable = events.filter(e => e.status === EventSelectStatus.SELECTABLE && inScope(e));
  let added = 0;
  const skipped = [];
  for (const e of selectable) {
    const r = await add(db, userId, {
      tripId,
      spotId: e.spotId,
      visitDate: e.visitDate,
      releaseAt: e.releaseAt,
      remindOn: e.remindOnDefault,
    });
    if (r.success) added += 1;
    else skipped.push({ spotId: e.spotId, visitDate: e.visitDate, reason: r.error });
  }
  return ok({ added, skipped, total: selectable.length, scope, scopeKey });
}

/** 修改某项是否设置提醒 */
async function updateRemindOn(db, userId, cartId, remindOn) {
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ _id: cartId, userId }).get();
  const item = (res.data || [])[0];
  if (!item) return fail(ERRORS.BAD_PARAM);
  if (item.reservationRequired === false && remindOn) return fail(ERRORS.BAD_PARAM);
  const releasePassed = item.reservationRequired !== false
    && item.releaseAt
    && new Date(item.releaseAt).getTime() <= time.now().getTime();
  if (releasePassed) return fail(ERRORS.REMINDER_WINDOW_CLOSED);
  await db.collection(COLLECTIONS.REMINDER_CART).doc(cartId).update({
    data: { remindOn: remindOn === true },
  });
  return ok({ cartId, remindOn: remindOn === true });
}

/** 删除单条 */
async function remove(db, userId, cartId) {
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ _id: cartId, userId }).get();
  if (!(res.data || []).length) return fail(ERRORS.BAD_PARAM);
  await db.collection(COLLECTIONS.REMINDER_CART).doc(cartId).remove();
  return ok({ cartId });
}

/**
 * 清空清单。
 *
 * 默认只清**暂存区**（不传 tripId）。传了真实 tripId 时清那一个行程的清单
 * （老调用方兼容）；显式传 all=true 才清该用户全部清单。
 *
 * ⚠️ 不要退回「不传就清全部」——那会连带清掉正在填写中的其他草稿。
 */
async function clear(db, userId, tripId = null) {
  const where = tripId === null
    ? { userId, tripId: PENDING_CART_TRIP_ID }
    : { userId, tripId };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).remove();
  return ok({ removed: res.stats ? res.stats.removed : 0 });
}

/**
 * 列出清单，关联景点名并分组。
 *
 * 不传 tripId = 读**暂存区**（这正是「添加提醒」页要的：用户挑完日期先放这里，
 * 提交时才建行程）。传真实 tripId 则读那个行程的清单（老链路兼容）。
 */
async function list(db, userId, tripId = null) {
  const where = { userId, tripId: cartTripIdOf(tripId) };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const items = res.data || [];
  const nowTs = time.now();

  const spotIds = [...new Set(items.map(i => i.spotId))];
  let spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: db.command.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }

  const enriched = items.map(i => {
    const spot = spotMap[i.spotId];
    const reservationRequired = i.reservationRequired !== false && (!spot || spot.reservationRequired !== false);
    const releasePassed = reservationRequired
      && i.releaseAt
      && new Date(i.releaseAt).getTime() <= nowTs.getTime();
    const releaseAt = reservationRequired && i.releaseAt ? new Date(i.releaseAt) : null;
    const msLeft = releaseAt ? releaseAt.getTime() - nowTs.getTime() : 0;
    const totalMin = Math.max(0, Math.floor(msLeft / 60000));
    return {
      ...i,
      reservationRequired,
      remindOn: reservationRequired && !releasePassed && i.remindOn === true,
      remindLocked: !!releasePassed,
      spotName: spot ? spot.name : '未知景点',
      difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
      weak: reservationRequired && !!spot && (spot.difficultyScore || 0) <= 2,
      releaseDateLabel: releaseAt
        ? formatReleaseDateLabel(releaseAt)
        : '',
      releaseLabel: releaseAt
        ? `${formatReleaseDateLabel(releaseAt)} ${time.formatHourMinute(releaseAt)} 放票`
        : '',
      releaseTimeLabel: reservationRequired
        ? (releaseAt ? time.formatHourMinute(releaseAt) : '')
        : '无需预约',
      visitDateLabel: reservationRequired
        ? `约 ${time.formatMonthDayWeek(i.visitDate)} 门票`
        : `${time.formatMonthDayWeek(i.visitDate)} · 随到随玩`,
      countdown: releaseAt
        ? {
          hours: Math.floor(totalMin / 60),
          minutes: totalMin % 60,
          text: `还剩${Math.floor(totalMin / 60)}h ${totalMin % 60}m`,
          urgent: msLeft > 0 && msLeft < 3600 * 1000,
          expired: msLeft <= 0,
        }
        : null,
    };
  });

  return ok({
    items: enriched,
    groups: groupByVisitDate(enriched),
    summary: summarize(enriched),
  });
}

module.exports = {
  cartTripIdOf,
  isPending,
  summarize,
  groupByVisitDate,
  add,
  addBatch,
  updateRemindOn,
  remove,
  clear,
  list,
};
