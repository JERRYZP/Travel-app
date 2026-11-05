/**
 * 用户首页派生读模型。
 *
 * 源数据仍是 trips / trip_items / reminder_tasks / reminder_cart / users。
 * 本集合只保存一次重建时的源快照，任何时刻都可以丢弃并重新生成。
 */

const crypto = require('crypto');
const { COLLECTIONS } = require('./schema');

const SCHEMA_VERSION = 'user_runtime/v1';
const RuntimeMode = Object.freeze({
  OFF: 'off',
  SHADOW: 'shadow',
  ON: 'on',
});
const VALID_MODES = new Set(Object.values(RuntimeMode));
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function modeOf(env = process.env) {
  const mode = String(env.HOME_RUNTIME_MODE || RuntimeMode.OFF).trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : RuntimeMode.OFF;
}

function runtimeIdOf(userId) {
  return crypto.createHash('sha256').update(String(userId || ''), 'utf8').digest('hex');
}

function maxAgeMsOf(env = process.env) {
  const value = Number(env.HOME_RUNTIME_MAX_AGE_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_AGE_MS;
}

async function read(db, userId) {
  const _id = runtimeIdOf(userId);
  try {
    const res = await db.collection(COLLECTIONS.USER_RUNTIME)
      .where({ _id })
      .limit(1)
      .get();
    const doc = (res.data || [])[0] || null;
    if (!doc || doc.schemaVersion !== SCHEMA_VERSION || !doc.sources) return null;
    return doc;
  } catch (err) {
    const message = String(err && (err.errMsg || err.message) || '');
    if (/-502005|collection not exists|Db or Table not exist/i.test(message)) return null;
    throw err;
  }
}

function isUsable(doc, nowMs = Date.now(), options = {}) {
  if (!doc || doc.stale === true) return false;
  const maxAge = options.maxAgeMs == null ? maxAgeMsOf() : Number(options.maxAgeMs);
  const builtAt = new Date(doc.builtAt || 0).getTime();
  return Number.isFinite(builtAt) && builtAt > 0 && nowMs - builtAt <= maxAge;
}

async function write(db, userId, sources, nowTs = new Date()) {
  const _id = runtimeIdOf(userId);
  const data = {
    userId,
    schemaVersion: SCHEMA_VERSION,
    builtAt: nowTs,
    stale: false,
    sources,
  };
  await db.collection(COLLECTIONS.USER_RUNTIME).doc(_id).set({ data });
  return { _id, ...data };
}

async function invalidate(db, userId, nowTs = new Date()) {
  if (!userId) return false;
  try {
    await db.collection(COLLECTIONS.USER_RUNTIME)
      .doc(runtimeIdOf(userId))
      .update({
        data: {
          stale: true,
          staleAt: nowTs,
        },
      });
    return true;
  } catch (err) {
    /* doc 不存在时 update 是空操作；其他错误也不能阻断用户写路径。 */
    console.warn('[user-runtime] invalidate-failed', err && err.message);
    return false;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedHash(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function comparisonShape(home) {
  return {
    serverNow: home && home.serverNow,
    primaryTripId: home && home.primaryTripId,
    trips: (home && home.trips || []).map(trip => ({
      _id: trip._id,
      startDate: trip.startDate,
      endDate: trip.endDate,
      windowStartDate: trip.windowStartDate,
      windowEndDate: trip.windowEndDate,
      progress: trip.progress,
      windowProgress: trip.windowProgress,
      itemCount: trip.itemCount,
      windowItemCount: trip.windowItemCount,
      outsideItemCount: trip.outsideItemCount,
      items: (trip.items || []).map(item => ({
        itemId: item.itemId,
        spotId: item.spotId,
        visitDate: item.visitDate,
        ticketState: item.ticketState,
        reminder: item.reminder,
        result: item.result,
        windowPosition: item.windowPosition,
      })),
    })),
    history: (home && home.history || []).map(trip => ({
      _id: trip._id,
      startDate: trip.startDate,
      endDate: trip.endDate,
      windowStartDate: trip.windowStartDate,
      windowEndDate: trip.windowEndDate,
      progress: trip.progress,
      windowProgress: trip.windowProgress,
    })),
    reminderQuotaWarning: home && home.reminderQuotaWarning,
    membership: home && home.membership,
    recoverableIds: home && home.recoverableIds,
  };
}

module.exports = {
  SCHEMA_VERSION,
  RuntimeMode,
  modeOf,
  runtimeIdOf,
  maxAgeMsOf,
  read,
  isUsable,
  write,
  invalidate,
  stableJson,
  normalizedHash,
  comparisonShape,
};
