/**
 * 行程只读分享（PAGE-018）
 *
 * 唯一真身是 trips 文档上的三个内部字段：
 *   shareToken / shareCreatedAt / shareUpdatedAt
 *
 * 普通行程接口只允许下发 shareActive，原始令牌只能由主人通过
 * tripShare.create / tripShare.status 获取。公开页按令牌查询，永远不接受
 * tripId / userId / OpenID 作为授权依据。
 */

const crypto = require('crypto');
const { COLLECTIONS, ERRORS, ok, fail } = require('./schema');
const time = require('./time');
const item = require('./item');
const userDomain = require('./user');
const tripWindow = require('./trip-window');

const SHARE_DAYS_AFTER_END = 7;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ITEM_PAGE_SIZE = 100;
const shareLocks = new Map();

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function withShareLock(userId, tripId, task) {
  const key = `${userId}:${tripId}`;
  const previous = shareLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => gate);
  shareLocks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (shareLocks.get(key) === queued) shareLocks.delete(key);
  }
}

function expiresOnOf(trip) {
  const window = tripWindow.windowOf(trip);
  if (!window.endDate) return '';
  return time.addDays(window.endDate, SHARE_DAYS_AFTER_END);
}

function shareStatusOf(trip, today = time.todayStr()) {
  if (!trip) return 'NONE';
  if (trip.shareToken) {
    return String(today) <= expiresOnOf(trip) ? 'ACTIVE' : 'EXPIRED';
  }
  return (trip.shareCreatedAt || trip.shareUpdatedAt) ? 'REVOKED' : 'NONE';
}

function isShareActive(trip, today = time.todayStr()) {
  if (trip && !trip.shareToken && trip.shareActive === true) return true;
  return shareStatusOf(trip, today) === 'ACTIVE';
}

/**
 * 普通行程读取的安全投影。只列已知公开字段，避免以后给 trips 增加内部字段时
 * 因 `...trip` 被顺手泄露。
 */
function publicTrip(trip, today = time.todayStr()) {
  if (!trip) return null;
  const window = tripWindow.windowOf(trip);
  return {
    _id: trip._id,
    city: trip.city,
    startDate: trip.startDate,
    endDate: trip.endDate,
    windowStartDate: window.startDate,
    windowEndDate: window.endDate,
    windowUpdatedAt: trip.windowUpdatedAt || null,
    windowVersion: tripWindow.versionOfTrip(trip),
    name: trip.name,
    spotIds: Array.isArray(trip.spotIds) ? [...trip.spotIds] : [],
    spots: Array.isArray(trip.spots) ? trip.spots.map(s => ({ ...s })) : [],
    status: trip.status,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    nextReminderAt: trip.nextReminderAt === undefined ? null : trip.nextReminderAt,
    shareActive: isShareActive(trip, today),
  };
}

async function findOwnedTrip(db, userId, tripId) {
  const id = String(tripId || '');
  if (!id) return null;
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ _id: id, userId })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function hasWindowTripItems(db, trip) {
  if (!trip) return false;
  const window = tripWindow.windowOf(trip);
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({
      userId: trip.userId,
      tripId: trip._id,
      visitDate: db.command.gte(window.startDate).and(db.command.lte(window.endDate)),
    })
    .limit(1)
    .get();
  return (res.data || []).length > 0;
}

async function listAllTripItems(db, userId, tripId) {
  const rows = [];
  let offset = 0;
  while (true) {
    const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
      .where({ userId, tripId })
      .orderBy('visitDate', 'asc')
      .skip(offset)
      .limit(ITEM_PAGE_SIZE)
      .get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < ITEM_PAGE_SIZE) break;
    offset += batch.length;
  }
  return rows;
}

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * 分享卡标题的主人昵称。只从应用内资料读取，不能冒充微信昵称；
 * 资料读取失败也不能阻断分享主流程。
 */
async function ownerNicknameOf(db, userId) {
  try {
    const owner = await userDomain.findUser(db, userId);
    const nickname = String((owner && owner.nickname) || '').trim().slice(0, 32);
    return nickname || '朋友';
  } catch (err) {
    return '朋友';
  }
}

/**
 * 幂等创建：已有有效分享原样返回同一令牌。
 * 只允许当前未结束、属于调用者且至少有一个行程项的整趟行程。
 */
async function create(db, userId, params = {}) {
  const trip = await findOwnedTrip(db, userId, params.tripId);
  if (!trip) return fail(ERRORS.BAD_PARAM);

  const nowTs = params.nowTs || time.now();
  const today = time.todayStr(nowTs);
  const window = tripWindow.windowOf(trip);
  if (window.endDate < today) return fail(ERRORS.TRIP_SHARE_UNAVAILABLE);
  if (!(await hasWindowTripItems(db, trip))) return fail(ERRORS.TRIP_SHARE_UNAVAILABLE);

  return withShareLock(userId, trip._id, async () => {
    const result = await db.runTransaction(async transaction => {
      const freshRes = await transaction.collection(COLLECTIONS.TRIPS).doc(trip._id).get();
      const fresh = docDataOf(freshRes);
      if (!fresh) return { missing: true };
      if (isShareActive(fresh, today)) {
        return {
          token: fresh.shareToken,
          expiresOn: expiresOnOf(fresh),
          reused: true,
        };
      }
      const token = newToken();
      await transaction.collection(COLLECTIONS.TRIPS).doc(trip._id).update({
        data: {
          shareToken: token,
          shareCreatedAt: nowTs,
          shareUpdatedAt: nowTs,
        },
      });
      return { token, expiresOn: expiresOnOf(fresh), reused: false };
    });
    if (result.missing) return fail(ERRORS.BAD_PARAM);
    return ok({
      tripId: trip._id,
      ownerNickname: await ownerNicknameOf(db, userId),
      ...result,
    });
  });
}

/**
 * 主人查询分享状态。有效时返回令牌，供分享浮层复用同一链接；
 * 过期与已停止都只返回状态，不返回公开页数据。
 */
async function status(db, userId, params = {}) {
  const trip = await findOwnedTrip(db, userId, params.tripId);
  if (!trip) return fail(ERRORS.BAD_PARAM);

  const window = tripWindow.windowOf(trip);
  const state = shareStatusOf(trip, time.todayStr(params.nowTs || time.now()));
  return ok({
    tripId: trip._id,
    ownerNickname: await ownerNicknameOf(db, userId),
    status: state,
    shareActive: state === 'ACTIVE',
    token: state === 'ACTIVE' ? trip.shareToken : '',
    expiresOn: state === 'ACTIVE' ? expiresOnOf(trip) : '',
    canCreate: window.endDate >= time.todayStr(params.nowTs || time.now()),
  });
}

/** 停止分享是幂等的；成功后旧令牌立即失效。 */
async function revoke(db, userId, params = {}) {
  const trip = await findOwnedTrip(db, userId, params.tripId);
  if (!trip) return fail(ERRORS.BAD_PARAM);

  const nowTs = params.nowTs || time.now();
  return withShareLock(userId, trip._id, async () => {
    const result = await db.runTransaction(async transaction => {
      const freshRes = await transaction.collection(COLLECTIONS.TRIPS).doc(trip._id).get();
      const fresh = docDataOf(freshRes);
      if (!fresh) return { missing: true };
      if (!fresh.shareToken) {
        return {
          revoked: false,
          status: shareStatusOf(fresh, time.todayStr(nowTs)),
        };
      }
      await transaction.collection(COLLECTIONS.TRIPS).doc(trip._id).update({
        data: {
          shareToken: '',
          shareUpdatedAt: nowTs,
        },
      });
      return { revoked: true, status: 'REVOKED' };
    });
    if (result.missing) return fail(ERRORS.BAD_PARAM);
    return ok({ tripId: trip._id, ...result });
  });
}

function invalidShare() {
  return fail(ERRORS.TRIP_SHARE_INVALID);
}

/**
 * 公开只读投影。输出是白名单，绝不夹带 userId / tripId / itemId /
 * releaseAt / result / ticketState / reminder。
 */
async function open(db, token, params = {}) {
  const safeToken = String(token || '');
  if (!TOKEN_PATTERN.test(safeToken)) return invalidShare();

  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ shareToken: safeToken })
    .limit(1)
    .get();
  const trip = (res.data || [])[0];
  if (!trip) return invalidShare();

  const today = time.todayStr(params.nowTs || time.now());
  if (!isShareActive(trip, today)) return invalidShare();

  const window = tripWindow.windowOf(trip);
  const allRows = await listAllTripItems(db, trip.userId, trip._id);
  const rows = allRows.filter(row => tripWindow.inWindow(row.visitDate, window));
  if (!rows.length) return invalidShare();

  const { spotMap } = await item.loadSpotContext(db, rows.map(row => row.spotId));
  const normalized = rows.map(row => ({
    visitDate: row.visitDate,
    spotId: row.spotId,
    spotName: (spotMap[row.spotId] && spotMap[row.spotId].name) || row.spotId,
  })).sort((a, b) => {
    const byDate = String(a.visitDate).localeCompare(String(b.visitDate));
    if (byDate !== 0) return byDate;
    return String(a.spotName).localeCompare(String(b.spotName));
  });

  const grouped = new Map();
  normalized.forEach(row => {
    if (!grouped.has(row.visitDate)) grouped.set(row.visitDate, []);
    grouped.get(row.visitDate).push({
      spotId: row.spotId,
      spotName: row.spotName,
    });
  });

  const days = [...grouped.entries()].map(([visitDate, items]) => ({
    visitDate,
    dayNumber: time.diffDays(window.startDate, visitDate) + 1,
    items,
  }));
  const spotCount = new Set(normalized.map(row => row.spotId)).size;

  return ok({
    share: {
      readOnly: true,
      expiresOn: expiresOnOf(trip),
    },
    trip: {
      city: trip.city,
      startDate: window.startDate,
      endDate: window.endDate,
      dayCount: time.diffDays(window.startDate, window.endDate) + 1,
      spotCount,
      days,
    },
  });
}

module.exports = {
  SHARE_DAYS_AFTER_END,
  expiresOnOf,
  shareStatusOf,
  isShareActive,
  publicTrip,
  create,
  status,
  revoke,
  open,
};
