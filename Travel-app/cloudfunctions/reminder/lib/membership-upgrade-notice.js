/**
 * 会员升级临时公告。
 *
 * 运行期真身为 payment_config/membership_upgrade_notice。
 * 这里只负责读取和判断当前是否可见；客户端不得自行推断活动是否有效。
 */

const { COLLECTIONS } = require('./schema');

const CONFIG_ID = 'membership_upgrade_notice';
const DEFAULT_CACHE_MS = 45 * 1000;
const cache = new WeakMap();

function timeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isActive(config = {}, now = new Date()) {
  if (!config || config.enabled !== true) return false;
  const nowMs = new Date(now).getTime();
  const startsAt = timeMs(config.startsAt);
  const endsAt = timeMs(config.endsAt);
  if (startsAt && startsAt > nowMs) return false;
  if (endsAt && endsAt <= nowMs) return false;
  return true;
}

function publicViewOf(config = {}, now = new Date(), options = {}) {
  config = config || {};
  const startsAt = timeMs(config.startsAt);
  const memberSince = timeMs(options.memberSince);
  if (options.newPlan !== true || options.member !== true || !isActive(config, now)) return null;
  if (!startsAt || !memberSince || memberSince >= startsAt) return null;
  return {
    id: String(config.noticeId || CONFIG_ID),
    endsAt: config.endsAt || null,
  };
}

function adminViewOf(config = {}, now = new Date()) {
  const configured = !!config && config.configured !== false && !!config._id;
  return {
    configured,
    enabled: config.enabled === true,
    active: isActive(config, now),
    noticeId: String(config.noticeId || CONFIG_ID),
    startsAt: config.startsAt || null,
    endsAt: config.endsAt || null,
    updatedAt: config.updatedAt || null,
    updatedBy: config.updatedBy || '',
    readError: config.readError === true,
  };
}

async function read(db, options = {}) {
  const useCache = options.cache !== false;
  const nowMs = Date.now();
  if (useCache) {
    const cached = cache.get(db);
    if (cached && nowMs - cached.at < DEFAULT_CACHE_MS) return cached.value;
  }
  let value;
  try {
    const res = await db.collection(COLLECTIONS.PAYMENT_CONFIG)
      .where({ _id: CONFIG_ID })
      .limit(1)
      .get();
    value = (res.data || [])[0] || {
      _id: '',
      enabled: false,
      configured: false,
    };
  } catch (err) {
    console.error('[membership-upgrade-notice] read failed', err && err.message);
    value = { _id: '', enabled: false, configured: false, readError: true };
  }
  if (useCache) cache.set(db, { at: nowMs, value });
  return value;
}

function invalidate(db) {
  cache.delete(db);
}

module.exports = {
  CONFIG_ID,
  isActive,
  publicViewOf,
  adminViewOf,
  read,
  invalidate,
};
