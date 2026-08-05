/**
 * 提醒清单（提交缓冲区）规则 CART-RULE-001 ~ 005（产品文档 3.4）
 *
 * 清单只是缓冲区：加入/删除/清空都不创建任务、不写 ICS。
 * 唯一约束 (userId, spotId, visitDate) —— 云数据库无原生唯一索引，靠查重实现。
 */

const { COLLECTIONS, ERRORS, ok, fail } = require('./schema');
const time = require('./time');

/**
 * CART-RULE-002 聚合展示：「已选 N 项，覆盖 M 个景点」
 */
function summarize(items) {
  const spotCount = new Set(items.map(i => i.spotId)).size;
  return {
    count: items.length,
    spotCount,
    text: `已选 ${items.length} 项，覆盖 ${spotCount} 个景点`,
  };
}

/**
 * PAGE-007 按放票日期分组，行内含倒计时（<1h 变紧急色）
 */
function groupByReleaseDate(items, nowTs = time.now()) {
  const map = new Map();
  for (const it of items) {
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
        urgent: msLeft > 0 && msLeft < 3600 * 1000, // <1h
        expired: msLeft <= 0,
      },
    });
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateStr, list]) => ({
      key: dateStr,
      label: time.formatMonthDayWeek(dateStr),
      items: list.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    }));
}

/**
 * CART-RULE-001 加入清单（单条）
 * ERROR-1002 重复提交 → 「这条提醒已经在清单里啦」
 */
async function add(db, userId, { tripId, spotId, visitDate, releaseAt }) {
  if (!tripId || !spotId || !visitDate || !releaseAt) return fail(ERRORS.BAD_PARAM);

  // 唯一约束查重（userId, spotId, visitDate）
  const exist = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, spotId, visitDate }).get();
  if ((exist.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  // 已提交为任务的也不应再入清单（STATE-003：WAITING 不可再选）
  const task = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, spotId, visitDate }).get();
  if ((task.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  const res = await db.collection(COLLECTIONS.REMINDER_CART).add({
    data: {
      userId,
      tripId,
      spotId,
      visitDate,
      releaseAt: new Date(releaseAt),
      createdAt: time.now(),
    },
  });
  return ok({ cartId: res._id });
}

/**
 * CART-RULE-004 批量提醒：仅作用于当前选中的 Tab，不跨 Tab
 *
 * @param {string} scope 'departure' = 出发日视图（按 visitDate 过滤）
 *                       'spot'      = 景点视图（按 spotId 过滤）
 * @param {string} scopeKey 选中的 Tab key（visitDate 或 spotId）
 */
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
      tripId, spotId: e.spotId, visitDate: e.visitDate, releaseAt: e.releaseAt,
    });
    if (r.success) added += 1;
    else skipped.push({ spotId: e.spotId, visitDate: e.visitDate, reason: r.error });
  }
  return ok({ added, skipped, total: selectable.length, scope, scopeKey });
}

/** 删除单条（PAGE-007 垃圾桶，即时生效） */
async function remove(db, userId, cartId) {
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ _id: cartId, userId }).get();
  if (!(res.data || []).length) return fail(ERRORS.BAD_PARAM);

  await db.collection(COLLECTIONS.REMINDER_CART).doc(cartId).remove();
  return ok({ cartId });
}

/** 清空（需前端 Dialog 确认后调用） */
async function clear(db, userId, tripId = null) {
  const where = tripId ? { userId, tripId } : { userId };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).remove();
  return ok({ removed: res.stats ? res.stats.removed : 0 });
}

/**
 * 列出清单（PAGE-007 主数据 + 底部清单条）
 * CART-RULE-003 持久化：存云数据库，跨设备/重启不丢
 */
async function list(db, userId, tripId = null) {
  const where = tripId ? { userId, tripId } : { userId };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const items = res.data || [];

  // 关联景点名（PAGE-007 行内展示；注意本页景点名不可点，UI-004 唯一豁免）
  const spotIds = [...new Set(items.map(i => i.spotId))];
  let spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: db.command.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }

  const enriched = items.map(i => ({
    ...i,
    spotName: spotMap[i.spotId] ? spotMap[i.spotId].name : '未知景点',
  }));

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
  remove,
  clear,
  list,
};
