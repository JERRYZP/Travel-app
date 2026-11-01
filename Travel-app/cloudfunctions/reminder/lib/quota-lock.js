/** 用户级提醒额度租约锁。
 *
 * 云数据库事务不支持 where，因此额度读数和任务写入不能塞进同一事务。这里用
 * 用户文档上的短期租约串行化所有会增加已用额度的操作；锁写入和用户文档读取
 * 都在事务内，冲突由 runTransaction 自动重试。进程中断时锁按 TTL 自动过期。
 */

const crypto = require('crypto');
const { COLLECTIONS, ERRORS, fail } = require('./schema');
const userDomain = require('./user');

const DEFAULT_LEASE_MS = 45 * 1000;
const DEFAULT_RETRIES = 4;
const RETRY_DELAY_MS = 80;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function lockIsActive(user, nowMs) {
  return !!user
    && !!user.taskQuotaLockOwner
    && new Date(user.taskQuotaLockExpiresAt || 0).getTime() > nowMs;
}

async function acquireQuotaLock(db, userId, {
  leaseMs = DEFAULT_LEASE_MS,
  retries = DEFAULT_RETRIES,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  const user = await userDomain.ensureUser(db, userId);
  const owner = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await db.runTransaction(async transaction => {
        const fresh = docDataOf(await transaction.collection(COLLECTIONS.USERS).doc(user._id).get());
        if (!fresh) return { acquired: false, reason: 'NO_USER' };
        const nowTs = new Date();
        if (lockIsActive(fresh, nowTs.getTime())) return { acquired: false, reason: 'BUSY' };
        const expiresAt = new Date(nowTs.getTime() + leaseMs);
        await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({
          data: {
            taskQuotaLockOwner: owner,
            taskQuotaLockExpiresAt: expiresAt,
            taskQuotaLockUpdatedAt: nowTs,
          },
        });
        return { acquired: true, owner, expiresAt, user: fresh };
      }, 3);
      if (result && result.acquired) return result;
    } catch (err) {
      if (attempt === retries - 1) throw err;
    }
    if (attempt < retries - 1) await wait(retryDelayMs * (attempt + 1));
  }
  return null;
}

async function releaseQuotaLock(db, lock) {
  if (!lock || !lock.acquired || !lock.owner) return;
  try {
    await db.runTransaction(async transaction => {
      const fresh = docDataOf(await transaction.collection(COLLECTIONS.USERS).doc(lock.user._id).get());
      if (!fresh || fresh.taskQuotaLockOwner !== lock.owner) return;
      await transaction.collection(COLLECTIONS.USERS).doc(lock.user._id).update({
        data: {
          taskQuotaLockOwner: '',
          taskQuotaLockExpiresAt: new Date(0),
          taskQuotaLockUpdatedAt: new Date(),
        },
      });
    }, 3);
  } catch (err) {
    console.error('[quota-lock] release failed', { userId: lock.user && lock.user.openId, message: err.message });
  }
}

async function withQuotaLock(db, userId, operation, options = {}) {
  const lock = await acquireQuotaLock(db, userId, options);
  if (!lock) return fail(ERRORS.TASK_QUOTA_BUSY);
  try {
    return await operation(lock);
  } finally {
    await releaseQuotaLock(db, lock);
  }
}

module.exports = {
  DEFAULT_LEASE_MS,
  acquireQuotaLock,
  releaseQuotaLock,
  withQuotaLock,
};
