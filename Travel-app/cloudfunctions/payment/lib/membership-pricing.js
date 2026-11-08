/**
 * 客服工作台两档会员定价开关。
 *
 * 配置由 payment 写入、reminder 读取。配置缺失时默认仅白名单可见。
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
const MODE_LABEL = Object.freeze({
  [PricingMode.TEST]: '测试账号',
  [PricingMode.ALL]: '全量用户',
});
const MODE_DESCRIPTION = Object.freeze({
  [PricingMode.TEST]: '仅测试 OpenID 可见 ¥3 / ¥4.9 / ¥1.9 两档方案，其他用户继续现有 ¥6 方案。',
  [PricingMode.ALL]: '所有声明 two-tier-v5 能力的新客户端使用 ¥3 / ¥4.9 / ¥1.9；旧客户端继续原契约。',
});
const MODE_SHORT_DESCRIPTION = Object.freeze({
  [PricingMode.TEST]: '仅测试账号使用两档定价',
  [PricingMode.ALL]: '新客户端全量使用两档定价',
});

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
}

async function write(target, { mode, updatedBy, now }) {
  const normalized = normalizedMode(mode);
  if (!normalized) throw new Error('invalid membership pricing mode');
  await target.collection(COLLECTIONS.PAYMENT_CONFIG)
    .doc(PRICING_CONFIG_ID)
    .set({
      data: {
        mode: normalized,
        updatedAt: now || new Date(),
        updatedBy: String(updatedBy || ''),
      },
    });
  return normalized;
}

function adminView(current) {
  const state = current || fallbackState();
  return {
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode],
    description: MODE_DESCRIPTION[state.mode],
    shortDescription: MODE_SHORT_DESCRIPTION[state.mode],
    configured: state.configured === true,
    source: state.source || 'DEFAULT',
    updatedAt: state.updatedAt || null,
    updatedBy: state.updatedBy || '',
    readError: state.readError === true,
  };
}

module.exports = {
  PRICING_CONFIG_ID,
  PricingMode,
  VALID_MODES,
  MODE_LABEL,
  MODE_DESCRIPTION,
  MODE_SHORT_DESCRIPTION,
  normalizedMode,
  fallbackState,
  read,
  invalidate,
  write,
  adminView,
};
