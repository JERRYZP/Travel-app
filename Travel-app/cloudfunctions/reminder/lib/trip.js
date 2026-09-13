/**
 * 行程规则 TRIP-RULE-001 ~ 006（产品文档 3.2）
 *
 * 纯函数部分（合并判定、命名、排序）不依赖数据库，便于本地断言测试。
 */

const { COLLECTIONS, TripStatus, V1, ERRORS, ok, fail } = require('./schema');
const time = require('./time');

/* ============ 纯函数区：可脱离云环境测试 ============ */

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
 * TRIP-RULE-005 行程按开始日期升序（从左到右按时间顺序）
 * @param {Array} trips 行程数组
 */
function sortTrips(trips) {
  return [...trips].sort((x, y) => String(x.startDate).localeCompare(String(y.startDate)));
}

/* ============ 数据库操作区 ============ */

/**
 * TRIP-RULE-002 创建行程（2026-08-31 起取消自动合并：zz 决策「生成时间线严格按本次输入」）。
 * 日期与景点严格按传入参数创建独立行程，不再与既有行程做日期并集/景点并集；
 * 连续日期会生成多个行程 Tab（TRIP-RULE-006 分组展示）。保留 merged 返回字段以兼容调用方。
 * @returns {{tripId, merged: boolean, mergedFrom: string[]}}
 */
async function create(db, userId, { startDate, endDate, spotIds = [], city = V1.CITY }) {
  if (!validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);

  const finalSpotIds = [...new Set(spotIds)];
  const name = buildName(city, startDate, endDate);
  const nowTs = time.now();

  const res = await db.collection(COLLECTIONS.TRIPS).add({
    data: {
      userId,
      city,
      startDate,
      endDate,
      name,
      spotIds: finalSpotIds,
      status: TripStatus.ACTIVE,
      createdAt: nowTs,
      updatedAt: nowTs,
    },
  });
  return ok({
    tripId: res._id,
    merged: false,
    mergedFrom: [],
    trip: { _id: res._id, city, startDate, endDate, name, spotIds: finalSpotIds, status: TripStatus.ACTIVE },
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
 * 列出行程，附带 TRIP-RULE-005 排序所需的 nextReminderAt 与 TRIP-RULE-006 分组信息。
 * 读取时兜底清理孤儿行程：任务与清单均空的行程（如生成了时间线但从未提交提醒）
 * 自动删除（TRIP-RULE-004），保证返回的行程都有内容，避免空行程 tab 残留。
 */
async function list(db, userId) {
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ userId })
    .get();
  const kept = [];
  for (const t of (res.data || [])) {
    const removed = await removeIfEmpty(db, userId, t._id);
    if (!removed) kept.push(t);
  }
  const trips = kept;

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
  buildName,
  validateRange,
  sortTrips,
  // DB
  create,
  updateSpots,
  updateRange,
  removeIfEmpty,
  list,
};
