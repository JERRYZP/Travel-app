/**
 * 客服工作台会员提醒名额限制开关。
 *
 * 配置文档由 payment 写入、reminder 读取。payment 不根据环境变量推断运行态，
 * 文档缺失时明确返回“等待接管”，避免后台展示一个猜测出来的模式。
 */

const { COLLECTIONS } = require('./schema');

const ENFORCEMENT_CONFIG_ID = 'membership_enforcement';
const DEFAULT_CACHE_MS = 45 * 1000;
const configCache = new WeakMap();
const EnforcementMode = Object.freeze({
  OFF: 'off',
  TEST: 'test',
  ALL: 'all',
});
const VALID_MODES = Object.freeze(Object.values(EnforcementMode));
const MODE_LABEL = Object.freeze({
  [EnforcementMode.OFF]: '已关闭',
  [EnforcementMode.TEST]: '测试账号',
  [EnforcementMode.ALL]: '全量用户',
});
const MODE_DESCRIPTION = Object.freeze({
  [EnforcementMode.OFF]: '所有新提醒进入历史保护池，不占免费或会员名额。',
  [EnforcementMode.TEST]: '仅测试 OpenID 的新提醒受名额限制，其他用户进入保护池。',
  [EnforcementMode.ALL]: '所有用户的新提醒按免费 5 个或会员不限名额规则校验。',
});
const MODE_SHORT_DESCRIPTION = Object.freeze({
  [EnforcementMode.OFF]: '新提醒不进入名额池',
  [EnforcementMode.TEST]: '仅测试账号受名额限制',
  [EnforcementMode.ALL]: '全部新提醒受名额限制',
});

function normalizedMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : '';
}

function unconfiguredState(overrides = {}) {
  return {
    mode: '',
    configured: false,
    source: 'UNSET',
    updatedAt: null,
    updatedBy: '',
    readError: false,
    ...overrides,
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
      const value = unconfiguredState();
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const mode = normalizedMode(current.mode);
    if (!mode) {
      const value = unconfiguredState({
        configured: true,
        source: 'INVALID',
        updatedAt: current.updatedAt || null,
        updatedBy: current.updatedBy || '',
        readError: true,
      });
      if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
      return value;
    }
    const value = {
      mode,
      configured: true,
      source: 'DB',
      updatedAt: current.updatedAt || null,
      updatedBy: current.updatedBy || '',
      readError: false,
    };
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  } catch (err) {
    const value = unconfiguredState({
      source: 'ERROR',
      readError: true,
    });
    if (cacheMs > 0) configCache.set(db, { at: Date.now(), value });
    return value;
  }
}

function invalidate(db) {
  if (db) configCache.delete(db);
}

async function write(target, { mode, updatedBy, now }) {
  const normalized = normalizedMode(mode);
  if (!normalized) throw new Error('invalid membership enforcement mode');
  await target.collection(COLLECTIONS.PAYMENT_CONFIG)
    .doc(ENFORCEMENT_CONFIG_ID)
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
  const state = current || unconfiguredState();
  if (!state.mode) {
    return {
      mode: '',
      modeLabel: '环境变量',
      description: state.readError
        ? '后台配置读取失败，reminder 暂按环境变量执行。'
        : '尚未写入后台配置，reminder 暂按环境变量执行。',
      shortDescription: state.readError
        ? '配置异常，暂按环境变量执行'
        : '尚未接管，暂按环境变量执行',
      configured: state.configured === true,
      source: state.source || 'UNSET',
      updatedAt: state.updatedAt || null,
      updatedBy: state.updatedBy || '',
      readError: state.readError === true,
    };
  }
  return {
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode],
    description: MODE_DESCRIPTION[state.mode],
    shortDescription: MODE_SHORT_DESCRIPTION[state.mode],
    configured: state.configured === true,
    source: state.source || 'DB',
    updatedAt: state.updatedAt || null,
    updatedBy: state.updatedBy || '',
    readError: state.readError === true,
  };
}

module.exports = {
  ENFORCEMENT_CONFIG_ID,
  EnforcementMode,
  VALID_MODES,
  MODE_LABEL,
  MODE_DESCRIPTION,
  MODE_SHORT_DESCRIPTION,
  normalizedMode,
  read,
  invalidate,
  write,
  adminView,
};
