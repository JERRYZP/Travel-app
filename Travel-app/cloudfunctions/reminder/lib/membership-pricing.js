/**
 * 两档会员定价灰度。
 *
 * payment_config/membership_pricing 是唯一真身。配置缺失、非法或读取失败时
 * 安全回退 test，只对 MEMBERSHIP_TEST_OPENIDS 开放两档价格。
 */

const { COLLECTIONS } = require('./schema');

const PRICING_CONFIG_ID = 'membership_pricing';
const DEFAULT_CACHE_MS = 45 * 1000;
const configCache = new WeakMap();

const PricingMode = Object.freeze({
  TEST: 'test',
  ALL: 'all',
});
const VALID_MODES = Object.freeze(Object.values(PricingMode));

function normalizedMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : '';
}

function fallbackState(source = 'DEFAULT', readError = false) {
  return {
    mode: PricingMode.TEST,
    configured: false,
    source,
    readError,
    updatedAt: null,
    updatedBy: '',
  };
}

async function read(db, options = {}) {
  const cacheMs = options.cache === true ? DEFAULT_CACHE_MS : 0;
  const cached = cacheMs > 0 ? configCache.get(db) : null;
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  try {
    const res = await db.collection(COLLECTIONS.PAYMENT_CONFIG)
      .where({ _id: PRICING_CONFIG_ID })
      .limit(1)
      .get();
    const current = (res.data || [])[0];
    if (!current) {
      const value = fallbackState();
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const mode = normalizedMode(current.mode);
    if (!mode) {
      const value = fallbackState('INVALID', true);
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const value = {
      mode,
      configured: true,
      source: 'DB',
      readError: false,
      updatedAt: current.updatedAt || null,
      updatedBy: current.updatedBy || '',
    };
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  } catch (err) {
    const value = fallbackState('ERROR', true);
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  }
}

function invalidate(db) {
  if (db) configCache.delete(db);
  else configCache.clear?.();
}

function isAll(state) {
  return !!state && state.mode === PricingMode.ALL;
}

module.exports = {
  PRICING_CONFIG_ID,
  PricingMode,
  VALID_MODES,
  normalizedMode,
  fallbackState,
  read,
  invalidate,
  isAll,
};
