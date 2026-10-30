/**
 * 会员保护额度一次性迁移。
 *
 * 管理员分批调用；每批最多 50 个用户，重复执行安全：
 * - protectedTaskQuota = max(5, 当前未来 WAITING 提醒数)
 * - lastReminderCreatedAt = 该用户历史提醒的最大 createdAt
 *
 * 必须在 MEMBERSHIP_ENFORCEMENT_MODE=all 之前完成。迁移不会删除或改写提醒任务。
 */

const { ok } = require('./schema');

const BATCH_SIZE = 50;

async function migrateProtectionBatch(db, { cursor = null } = {}) {
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

  return ok({
    scanned: users.length,
    updated,
    nextCursor,
    hasMore: users.length === BATCH_SIZE,
    batchSize: BATCH_SIZE,
  });
}

module.exports = { BATCH_SIZE, migrateProtectionBatch };
