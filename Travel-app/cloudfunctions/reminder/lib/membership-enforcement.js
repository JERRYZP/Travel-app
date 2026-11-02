/**
 * 会员提醒名额限制模式。
 *
 * payment_config/membership_enforcement 是运行期唯一真身。配置缺失、值非法
 * 或读取失败时回退到 MEMBERSHIP_ENFORCEMENT_MODE，避免数据库异常阻断提醒链路。
 */

const { COLLECTIONS } = require('./schema');

const ENFORCEMENT_CONFIG_ID = 'membership_enforcement';
const EnforcementMode = Object.freeze({
  OFF: 'off',
  TEST: 'test',
  ALL: 'all',
});
const VALID_MODES = Object.freeze(Object.values(EnforcementMode));
const DEFAULT_ENV_MODE = EnforcementMode.TEST;
const DEFAULT_CACHE_MS = 45 * 1000;
const configCache = new WeakMap();

function normalizedMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : '';
}

function envModeOf() {
  const raw = String(process.env.MEMBERSHIP_ENFORCEMENT_MODE || DEFAULT_ENV_MODE)
    .trim()
    .toLowerCase();
  return VALID_MODES.includes(raw) ? raw : EnforcementMode.OFF;
}

function envFallbackState(reason = '', readError = false) {
  return {
    mode: envModeOf(),
    configured: false,
    source: 'ENV',
    reason,
    updatedAt: null,
    updatedBy: '',
    readError,
  };
}

async function read(db, options = {}) {
  const cacheMs = options.cache === true ? DEFAULT_CACHE_MS : 0;
  const cached = cacheMs > 0 ? configCache.get(db) : null;
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  try {
    const res = await db.collection(COLLECTIONS.PAYMENT_CONFIG)
      .where({ _id: ENFORCEMENT_CONFIG_ID })
      .limit(1)
      .get();
    const current = (res.data || [])[0];
    if (!current) {
      const value = envFallbackState();
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const mode = normalizedMode(current.mode);
    if (!mode) {
      const value = envFallbackState('会员限制模式配置无效，暂按环境变量执行');
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const value = {
      mode,
      configured: true,
      source: 'DB',
      reason: '',
      updatedAt: current.updatedAt || null,
      updatedBy: current.updatedBy || '',
      readError: false,
    };
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  } catch (err) {
    const value = envFallbackState('会员限制模式读取失败，暂按环境变量执行', true);
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  }
}

function invalidate(db) {
  if (db) configCache.delete(db);
  else configCache.clear?.();
}

function shouldEnforceForMode(mode, userId, testOpenIds) {
  if (mode === EnforcementMode.ALL) return true;
  if (mode === EnforcementMode.OFF) return false;
  return testOpenIds.has(userId);
}

module.exports = {
  ENFORCEMENT_CONFIG_ID,
  EnforcementMode,
  VALID_MODES,
  DEFAULT_ENV_MODE,
  normalizedMode,
  envModeOf,
  read,
  invalidate,
  shouldEnforceForMode,
};
