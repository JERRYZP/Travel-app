/**
 * 行程项规则（2026-09-16 首页行程状态墙 P1）
 *
 * 行程项 = tripId + spotId + visitDate，是首页状态墙、票务结果和提醒任务的事实来源。
 *
 * 本模块只放**纯函数与持久化辅助**；展示态推导在 `lib/item.js`，
 * 用户操作（标记/撤销/改提醒/删除）在 `lib/trip-item-actions.js`。
 */

const { COLLECTIONS } = require('./schema');
const time = require('./time');

/** 同一行程 + 同一景点的多个备选日期归为一个需求组 */
function backupGroupIdOf(tripId, spotId) {
  return `${tripId}:${spotId}`;
}

/** 弱提醒：需预约、可提醒且难度 ≤2；默认不勾提醒 */
function isWeakSpot(spot) {
  return !!spot && spot.reservationRequired !== false && (spot.difficultyScore || 0) <= 2;
}

/** 未显式传 remindOn 时的默认值：强提醒默认开，弱提醒默认关，免预约恒关 */
function defaultRemindOn(spot) {
  if (!spot || spot.reservationRequired === false) return false;
  return !isWeakSpot(spot);
}

/** 行程项目标结构 */
function makeItemData({ userId, tripId, spotId, visitDate, remindOn, nowTs = time.now() }) {
  return {
    userId,
    tripId,
    spotId,
    visitDate,
    backupGroupId: backupGroupIdOf(tripId, spotId),
    remindOn: remindOn === true,
    result: null,
    resultAt: null,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
}

/** 读取某行程下已有行程项，按 tripId|spotId|visitDate 建立映射，供提交去重和状态推导 */
async function existingItemMap(db, userId, tripId = null) {
  const where = tripId ? { userId, tripId } : { userId };
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS).where(where).get();
  const map = {};
  for (const item of (res.data || [])) {
    map[`${item.tripId}|${item.spotId}|${item.visitDate}`] = item;
  }
  return map;
}

module.exports = {
  backupGroupIdOf,
  isWeakSpot,
  defaultRemindOn,
  makeItemData,
  existingItemMap,
};
