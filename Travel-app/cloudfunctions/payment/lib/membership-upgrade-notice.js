/**
 * 会员升级临时公告管理。
 *
 * 只控制「我的」页一次性横幅的开关和有效期，不影响会员权益。
 */

const { COLLECTIONS } = require('./schema');

const CONFIG_ID = 'membership_upgrade_notice';
const DEFAULT_CACHE_MS = 45 * 1000;
const cache = new WeakMap();

function timeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function timeText(value) {
  const ms = timeMs(value);
  if (!ms) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${hh}:${mm}`;
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

function adminViewOf(config = {}, now = new Date()) {
  const configured = !!config && config.configured !== false && !!config._id;
  const enabled = config.enabled === true;
  const active = isActive(config, now);
  const endsMs = timeMs(config.endsAt);
  const expired = enabled && endsMs > 0 && endsMs <= new Date(now).getTime();
  const readError = config.readError === true;
  let statusLabel = configured ? '已下架' : '未开启';
  let description = configured
    ? '公告已关闭，不影响会员权益和订单。'
    : '尚未创建临时公告配置。';
  let actionText = '恢复';
  let toggleToEnabled = true;
  if (readError) {
    statusLabel = '读取失败';
    description = '配置读取失败，当前不会向用户展示公告。';
    actionText = '不可操作';
    toggleToEnabled = false;
  } else if (active) {
    statusLabel = '展示中';
    description = '白名单用户进入“我的”页时会看到临时公告。';
    actionText = '下架';
    toggleToEnabled = false;
  } else if (enabled) {
    statusLabel = expired ? '已到期' : '已排期';
    description = expired
      ? '已到截止时间，当前不会向用户展示。'
      : '尚未到开始时间，当前不会向用户展示。';
    actionText = expired ? '重新展示' : '取消排期';
    toggleToEnabled = expired;
  }
  return {
    configured,
    enabled,
    active,
    noticeId: String(config.noticeId || CONFIG_ID),
    startsAt: config.startsAt || null,
    endsAt: config.endsAt || null,
    endsAtText: timeText(config.endsAt),
    updatedAt: config.updatedAt || null,
    updatedBy: config.updatedBy || '',
    readError,
    statusLabel,
    description,
    actionText,
    toggleToEnabled,
    unavailable: readError,
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
  adminViewOf,
  read,
  invalidate,
};
