/**
 * 首页悬浮时钟功能推广横幅。
 *
 * 唯一真身为 payment_config/home_clock_promo。
 * 服务端只返回当前有效的活动；客户端不得自行推导有效期。
 */

const { COLLECTIONS } = require('./schema');

const CONFIG_ID = 'home_clock_promo';
const PROMO_ID = 'floating-clock-2026-11';
const DURATION_DAYS = 4;
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
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
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

function publicViewOf(config = {}, now = new Date()) {
  if (!isActive(config, now)) return null;
  return {
    id: String(config.promoId || PROMO_ID),
    endsAt: config.endsAt || null,
    endsAtText: timeText(config.endsAt),
  };
}

function adminViewOf(config = {}, now = new Date()) {
  const configured = !!config && config.configured !== false && !!config._id;
  const enabled = config.enabled === true;
  const active = isActive(config, now);
  const expired = enabled && timeMs(config.endsAt) > 0 && timeMs(config.endsAt) <= new Date(now).getTime();
  const readError = config.readError === true;
  let statusLabel = configured ? '已关闭' : '未开启';
  let description = configured
    ? '横幅已关闭，首页不会展示推广内容。'
    : '尚未创建首页推广配置。';
  let actionText = '开启 4 天';
  let toggleToEnabled = true;
  if (readError) {
    statusLabel = '读取失败';
    description = '配置读取失败，当前不会向用户展示横幅。';
    actionText = '不可操作';
    toggleToEnabled = false;
  } else if (active) {
    statusLabel = '展示中';
    description = '首页会向尚未关闭横幅的用户展示悬浮时钟推广内容。';
    actionText = '关闭';
    toggleToEnabled = false;
  } else if (enabled) {
    statusLabel = expired ? '已到期' : '已排期';
    description = expired ? '活动已到期，首页不再展示横幅。' : '活动将在开始时间后展示横幅。';
    actionText = '重新开启 4 天';
    toggleToEnabled = true;
  }
  return {
    configured,
    enabled,
    active,
    promoId: String(config.promoId || PROMO_ID),
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
    console.error('[home-clock-promo] read failed', err && err.message);
    value = { _id: '', enabled: false, configured: false, readError: true };
  }
  if (useCache) cache.set(db, { at: nowMs, value });
  return value;
}

function invalidate(db) {
  cache.delete(db);
}

function nextWindow(now = new Date()) {
  const start = new Date(now);
  return {
    startsAt: start,
    endsAt: new Date(start.getTime() + DURATION_DAYS * 24 * 60 * 60 * 1000),
  };
}

module.exports = {
  CONFIG_ID,
  PROMO_ID,
  DURATION_DAYS,
  isActive,
  publicViewOf,
  adminViewOf,
  read,
  invalidate,
  nextWindow,
};
