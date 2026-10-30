/**
 * 会员保护额度一次性迁移。
 *
 * 管理员分批调用；每批最多 50 个用户，重复执行安全：
 * - protectedTaskQuota = max(5, 当前未来 WAITING 提醒数)
 * - lastReminderCreatedAt = 该用户历史提醒的最大 createdAt
 *
 * 必须在 MEMBERSHIP_ENFORCEMENT_MODE=all 之前完成。迁移不会删除或改写提醒任务。
 */

const { COLLECTIONS, ok } = require('./schema');

const BATCH_SIZE = 50;
const MIGRATION_MARKER_CASE_ID = '__protection_migration_v1__';
const MIGRATION_COMPLETE_ACTION = 'PROTECTION_MIGRATION_COMPLETE';

async function protectionMigrationCompleted(db) {
  const res = await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS)
    .where({ caseId: MIGRATION_MARKER_CASE_ID })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const marker = (res.data || [])[0];
  return !!(marker && marker.action === MIGRATION_COMPLETE_ACTION);
}

async function markProtectionMigrationCompleted(db, { adminOpenId = '', nextCursor = null, scanned = 0, updated = 0 } = {}) {
  if (await protectionMigrationCompleted(db)) return;
  await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: String(adminOpenId || ''),
      action: MIGRATION_COMPLETE_ACTION,
      caseId: MIGRATION_MARKER_CASE_ID,
      orderId: '',
      details: {
        version: 1,
        nextCursor: nextCursor || null,
        finalBatchScanned: scanned,
        finalBatchUpdated: updated,
      },
      createdAt: new Date(),
    },
  });
}

async function migrateProtectionBatch(db, { cursor = null, adminOpenId = '' } = {}) {
  if (!cursor && await protectionMigrationCompleted(db)) {
    return ok({
      scanned: 0,
      updated: 0,
      nextCursor: null,
      hasMore: false,
      batchSize: BATCH_SIZE,
      alreadyCompleted: true,
    });
  }

  const nowTs = new Date();
  // 用默认 _id 游标分页，避免同一 createdAt 的第 50 位之后被跳过。
  const where = cursor ? { _id: db.command.gt(String(cursor)) } : {};
  const userRes = await db.collection('users')
    .where(where)
    .orderBy('_id', 'asc')
    .limit(BATCH_SIZE)
    .get();
  const users = userRes.data || [];
  let updated = 0;
  let nextCursor = cursor || null;

  for (const user of users) {
    nextCursor = user._id || nextCursor;
    if (!user._id) continue;
    const [activeRes, latestRes] = await Promise.all([
      db.collection('reminder_tasks')
        .where({
          userId: user.openId,
          backendStatus: 'WAITING',
          releaseAt: db.command.gt(nowTs),
        })
        .count(),
      db.collection('reminder_tasks')
        .where({ userId: user.openId })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
    ]);
    const latest = (latestRes.data || [])[0] || null;
    const patch = {
      protectedTaskQuota: Math.max(5, Number(activeRes.total) || 0),
      protectionMigratedAt: nowTs,
      protectionMigrationVersion: 1,
    };
    if (!user.lastReminderCreatedAt && latest && latest.createdAt) {
      patch.lastReminderCreatedAt = latest.createdAt;
    }
    await db.collection('users').doc(user._id).update({ data: patch });
    updated += 1;
  }

  const hasMore = users.length === BATCH_SIZE;
  if (!hasMore) {
    await markProtectionMigrationCompleted(db, {
      adminOpenId,
      nextCursor,
      scanned: users.length,
      updated,
    });
  }

  return ok({
    scanned: users.length,
    updated,
    nextCursor,
    hasMore,
    batchSize: BATCH_SIZE,
  });
}

module.exports = {
  BATCH_SIZE,
  MIGRATION_MARKER_CASE_ID,
  MIGRATION_COMPLETE_ACTION,
  protectionMigrationCompleted,
  migrateProtectionBatch,
};
