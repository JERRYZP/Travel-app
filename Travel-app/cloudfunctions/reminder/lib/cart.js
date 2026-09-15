/**
 * 加入行程购物车规则（CART-RULE，2026-09-16 行程化 P1）
 *
 * 购物车仍是提交缓冲区，但现在同时承载需预约项和免预约项：
 * - 需预约项：releaseAt 必填，remindOn 可勾选；
 * - 免预约项：releaseAt=null，remindOn 恒 false；
 * - 弱提醒景点默认不勾提醒，用户可在购物车手动改。
 */

const { COLLECTIONS, ERRORS, ok, fail } = require('./schema');
const time = require('./time');
const tripItem = require('./trip-item');

const NO_RESERVATION_GROUP = '__no_reservation__';

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

/**
 * 购物车分组：
 * - 需预约项按放票日期分组；
 * - 免预约项统一放最后一个“无需预约”分组，按出行日排序。
 */
function groupByReleaseDate(items, nowTs = time.now()) {
  const map = new Map();
  for (const it of items) {
    if (it.reservationRequired === false) {
      const key = NO_RESERVATION_GROUP;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        ...it,
        releaseTimeLabel: '无需预约',
        visitDateLabel: `${time.formatMonthDayWeek(it.visitDate)} · 随到随玩`,
        countdown: null,
      });
      continue;
    }

    const releaseAt = new Date(it.releaseAt);
    const dateStr = time.toDateStr(releaseAt);
    if (!map.has(dateStr)) map.set(dateStr, []);

    const msLeft = releaseAt.getTime() - nowTs.getTime();
    const totalMin = Math.max(0, Math.floor(msLeft / 60000));
    map.get(dateStr).push({
      ...it,
      releaseTimeLabel: time.formatHourMinute(releaseAt),
      visitDateLabel: `约 ${time.formatMonthDayWeek(it.visitDate)} 门票`,
      countdown: {
        hours: Math.floor(totalMin / 60),
        minutes: totalMin % 60,
        text: `还剩${Math.floor(totalMin / 60)}h ${totalMin % 60}m`,
        urgent: msLeft > 0 && msLeft < 3600 * 1000,
        expired: msLeft <= 0,
      },
    });
  }

  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === NO_RESERVATION_GROUP) return 1;
      if (b[0] === NO_RESERVATION_GROUP) return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([dateStr, list]) => ({
      key: dateStr,
      label: dateStr === NO_RESERVATION_GROUP ? '无需预约' : time.formatMonthDayWeek(dateStr),
      items: list.sort((a, b) => {
        if (dateStr === NO_RESERVATION_GROUP) return a.visitDate.localeCompare(b.visitDate);
        return new Date(a.releaseAt) - new Date(b.releaseAt);
      }),
    }));
}

/** CART-RULE-001 加入清单（单条） */
async function add(db, userId, { tripId, spotId, visitDate, releaseAt, remindOn }) {
  if (!tripId || !spotId || !visitDate) return fail(ERRORS.BAD_PARAM);

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
    const remindable = !!(rule && rule.advanceDays && (rule.releaseTimes || rule.releaseTime));
    if (!remindable || !releaseAt) return fail(ERRORS.BAD_PARAM);
    resolvedReleaseAt = new Date(releaseAt);
    resolvedRemindOn = typeof remindOn === 'boolean' ? remindOn : tripItem.defaultRemindOn(spot);
  }

  // 逻辑唯一约束 (userId, tripId, spotId, visitDate)
  const exist = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId, spotId, visitDate }).get();
  if ((exist.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  // 已落为行程项的不再进入购物车。
  const itemRes = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId, spotId, visitDate }).get();
  if ((itemRes.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  // 已提交为任务的同样不可再入清单。
  if (reservationRequired) {
    const task = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId, tripId, spotId, visitDate }).get();
    if ((task.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);
  }

  const res = await db.collection(COLLECTIONS.REMINDER_CART).add({
    data: {
      userId,
      tripId,
      spotId,
      visitDate,
      releaseAt: resolvedReleaseAt,
      remindOn: resolvedRemindOn,
      reservationRequired,
      createdAt: time.now(),
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

/** 清空 */
async function clear(db, userId, tripId = null) {
  const where = tripId ? { userId, tripId } : { userId };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).remove();
  return ok({ removed: res.stats ? res.stats.removed : 0 });
}

/** 列出清单，关联景点名并分组 */
async function list(db, userId, tripId = null) {
  const where = tripId ? { userId, tripId } : { userId };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const items = res.data || [];

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
    return {
      ...i,
      reservationRequired,
      remindOn: reservationRequired && i.remindOn === true,
      spotName: spot ? spot.name : '未知景点',
    };
  });

  return ok({
    items: enriched,
    groups: groupByReleaseDate(enriched),
    summary: summarize(enriched),
  });
}

module.exports = {
  summarize,
  groupByReleaseDate,
  add,
  addBatch,
  updateRemindOn,
  remove,
  clear,
  list,
};
