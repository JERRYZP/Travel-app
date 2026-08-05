/**
 * 行程规则 TRIP-RULE-001 ~ 006（产品文档 3.2）
 *
 * 纯函数部分（合并判定、命名、排序）不依赖数据库，便于本地断言测试。
 */

const { COLLECTIONS, TripStatus, V1, ERRORS, ok, fail } = require('./schema');
const time = require('./time');

/* ============ 纯函数区：可脱离云环境测试 ============ */

/**
 * TRIP-RULE-002 合并判定：同城市，且（日期有交集 或 首尾相接）
 * 首尾相接 = 一方 endDate + 1天 === 另一方 startDate
 *
 * 文档正例：
 *   北京 5.31-6.4 + 6.5-6.8 → 可合并（相接）
 *   北京 5.31-6.4 + 6.6-6.8 → 不可合并（隔了 6.5）
 */
function canMerge(a, b) {
  if (a.city !== b.city) return false;
  // 有交集：a 起点 ≤ b 终点 且 b 起点 ≤ a 终点
  const overlap = a.startDate <= b.endDate && b.startDate <= a.endDate;
  if (overlap) return true;
  // 首尾相接（两个方向）
  return time.addDays(a.endDate, 1) === b.startDate
    || time.addDays(b.endDate, 1) === a.startDate;
}

/** 合并后的日期取并集 */
function mergeRange(a, b) {
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

/**
 * TRIP-RULE-003 系统命名「北京 5.31-6.4」，用户不可编辑
 */
function buildName(city, startDate, endDate) {
  const short = (d) => {
    const p = time.beijingParts(time.parseBeijing(d, '12:00'));
    return `${p.month}.${p.day}`;
  };
  return `${city} ${short(startDate)}-${short(endDate)}`;
}

/** ERROR-1006 行程日期合法性 */
function validateRange(startDate, endDate) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startDate || '') || !re.test(endDate || '')) return false;
  return startDate <= endDate;
}

/**
 * TRIP-RULE-005 排序：按「最近一条待提醒任务的提醒时间」升序，无待提醒任务的沉底
 * @param {Array} trips 每项需带 nextReminderAt（Date|null）
 */
function sortTrips(trips) {
  return [...trips].sort((x, y) => {
    const a = x.nextReminderAt ? new Date(x.nextReminderAt).getTime() : Infinity;
    const b = y.nextReminderAt ? new Date(y.nextReminderAt).getTime() : Infinity;
    if (a !== b) return a - b;
    // 都无待提醒任务时，用开始日期兜底保证顺序稳定
    return String(x.startDate).localeCompare(String(y.startDate));
  });
}

/**
 * 把一批待合并行程滚雪球式合并到一起。
 * 新行程可能同时与多个既有行程相接，需反复合并直到不再变化。
 * @returns {{range: {startDate,endDate}, mergedIds: string[]}}
 */
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

/* ============ 数据库操作区 ============ */

/**
 * TRIP-RULE-001/002 创建或合并行程
 * @returns {{tripId, merged: boolean, mergedFrom: string[]}}
 */
async function createOrMerge(db, userId, { startDate, endDate, spotIds = [], city = V1.CITY }) {
  if (!validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);

  const existRes = await db.collection(COLLECTIONS.TRIPS)
    .where({ userId, city, status: TripStatus.ACTIVE })
    .get();
  const existing = existRes.data || [];

  const { range, mergedIds } = collapse({ city, startDate, endDate }, existing);

  // 合并目标景点：新增的 + 被合并行程原有的，去重
  const spotSet = new Set(spotIds);
  existing.filter(t => mergedIds.includes(t._id))
    .forEach(t => (t.spotIds || []).forEach(id => spotSet.add(id)));
  const finalSpotIds = [...spotSet];

  const name = buildName(city, range.startDate, range.endDate);
  const nowTs = time.now();

  if (mergedIds.length === 0) {
    const res = await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        userId,
        city,
        startDate: range.startDate,
        endDate: range.endDate,
        name,
        spotIds: finalSpotIds,
        status: TripStatus.ACTIVE,
        createdAt: nowTs,
        updatedAt: nowTs,
      },
    });
    return ok({ tripId: res._id, merged: false, mergedFrom: [], trip: {
      _id: res._id, city, ...range, name, spotIds: finalSpotIds, status: TripStatus.ACTIVE,
    } });
  }

  // 保留第一个被合并的行程作为存续行程，其余删除（其任务需改挂，由调用方按 TIMELINE-RULE-002 重算）
  const keepId = mergedIds[0];
  const dropIds = mergedIds.slice(1);

  await db.collection(COLLECTIONS.TRIPS).doc(keepId).update({
    data: {
      startDate: range.startDate,
      endDate: range.endDate,
      name,
      spotIds: finalSpotIds,
      updatedAt: nowTs,
    },
  });

  for (const id of dropIds) {
    // 被吞并行程的任务与清单改挂到存续行程
    await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId, tripId: id })
      .update({ data: { tripId: keepId } });
    await db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId, tripId: id })
      .update({ data: { tripId: keepId } });
    await db.collection(COLLECTIONS.TRIPS).doc(id).remove();
  }

  return ok({
    tripId: keepId,
    merged: true,
    mergedFrom: mergedIds,
    trip: { _id: keepId, city, ...range, name, spotIds: finalSpotIds, status: TripStatus.ACTIVE },
  });
}

/** 更新想去景点列表（PAGE-003 带回结果） */
async function updateSpots(db, userId, tripId, spotIds) {
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ _id: tripId, userId })
    .get();
  if (!res.data || res.data.length === 0) return fail(ERRORS.BAD_PARAM);

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).update({
    data: { spotIds: [...new Set(spotIds)], updatedAt: time.now() },
  });
  return ok({ tripId, spotIds: [...new Set(spotIds)] });
}

/** 修改行程日期范围（会触发时间线重算，由调用方负责） */
async function updateRange(db, userId, tripId, startDate, endDate) {
  if (!validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);
  const res = await db.collection(COLLECTIONS.TRIPS).where({ _id: tripId, userId }).get();
  const trip = (res.data || [])[0];
  if (!trip) return fail(ERRORS.BAD_PARAM);

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).update({
    data: {
      startDate,
      endDate,
      name: buildName(trip.city, startDate, endDate),
      updatedAt: time.now(),
    },
  });
  return ok({ tripId, startDate, endDate });
}

/**
 * TRIP-RULE-004 级联删除：行程下任务与清单均空 → 行程自动删除
 * @returns {boolean} 是否发生了删除
 */
async function removeIfEmpty(db, userId, tripId) {
  const taskCount = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, tripId }).count();
  if (taskCount.total > 0) return false;

  const cartCount = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId }).count();
  if (cartCount.total > 0) return false;

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  return true;
}

/**
 * 列出行程，附带 TRIP-RULE-005 排序所需的 nextReminderAt 与 TRIP-RULE-006 分组信息
 */
async function list(db, userId) {
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ userId })
    .get();
  const trips = res.data || [];

  const { ReminderBackendStatus } = require('./schema');
  for (const t of trips) {
    const waiting = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId, tripId: t._id, backendStatus: ReminderBackendStatus.WAITING })
      .orderBy('releaseAt', 'asc')
      .limit(1)
      .get();
    t.nextReminderAt = (waiting.data || []).length ? waiting.data[0].releaseAt : null;
  }

  const sorted = sortTrips(trips);
  return ok({
    trips: sorted,
    // TRIP-RULE-006：仅 ≥2 个行程时前端显示分组 Tab 行
    showGroupTabs: sorted.length >= 2,
  });
}

module.exports = {
  // 纯函数
  canMerge,
  mergeRange,
  buildName,
  validateRange,
  sortTrips,
  collapse,
  // DB
  createOrMerge,
  updateSpots,
  updateRange,
  removeIfEmpty,
  list,
};
