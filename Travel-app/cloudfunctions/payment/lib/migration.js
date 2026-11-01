/**
 * 会员保护额度一次性迁移。
 *
 * 管理员分批调用；每批最多 50 个用户，重复执行安全：
 * - protectedTaskQuota = max(5, 当前未来 WAITING 提醒数)
 * - lastReminderCreatedAt = 该用户历史提醒的最大 createdAt
 *
 * 必须在 MEMBERSHIP_ENFORCEMENT_MODE=all 之前完成。迁移不会删除或改写提醒任务。
 */

const { COLLECTIONS, OrderStatus, GrantStatus, RefundStatus, ok } = require('./schema');
const afterSales = require('./after-sales');

const BATCH_SIZE = 50;
const MIGRATION_MARKER_CASE_ID = '__protection_migration_v1__';
const MIGRATION_COMPLETE_ACTION = 'PROTECTION_MIGRATION_COMPLETE';
const ENTITLEMENT_MIGRATION_MARKER_CASE_ID = '__entitlement_ledger_migration_v2__';
const ENTITLEMENT_MIGRATION_COMPLETE_ACTION = 'ENTITLEMENT_LEDGER_MIGRATION_COMPLETE';
const ENTITLEMENT_MIGRATION_VERSION = 2;
const LEGACY_TASK_PACK_SIZE = 5;
const ORDER_PAGE_SIZE = 100;

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

async function entitlementMigrationCompleted(db) {
  const res = await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS)
    .where({ caseId: ENTITLEMENT_MIGRATION_MARKER_CASE_ID })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const marker = (res.data || [])[0];
  return !!(marker && marker.action === ENTITLEMENT_MIGRATION_COMPLETE_ACTION);
}

async function markEntitlementMigrationCompleted(db, {
  adminOpenId = '',
  nextCursor = null,
  scanned = 0,
  updated = 0,
  manualReview = 0,
  legacyBackfill = 0,
} = {}) {
  if (await entitlementMigrationCompleted(db)) return;
  await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: String(adminOpenId || ''),
      action: ENTITLEMENT_MIGRATION_COMPLETE_ACTION,
      caseId: ENTITLEMENT_MIGRATION_MARKER_CASE_ID,
      orderId: '',
      details: {
        version: ENTITLEMENT_MIGRATION_VERSION,
        nextCursor: nextCursor || null,
        finalBatchScanned: scanned,
        finalBatchUpdated: updated,
        finalBatchManualReview: manualReview,
        finalBatchLegacyBackfill: legacyBackfill,
      },
      createdAt: new Date(),
    },
  });
}

async function paidOrdersOfUser(db, userId) {
  const orders = [];
  let cursor = null;
  while (true) {
    const where = { userId, status: OrderStatus.PAID };
    if (cursor) where._id = db.command.gt(cursor);
    const res = await db.collection(COLLECTIONS.ORDERS)
      .where(where)
      .orderBy('_id', 'asc')
      .limit(ORDER_PAGE_SIZE)
      .get();
    const page = res.data || [];
    orders.push(...page);
    if (page.length < ORDER_PAGE_SIZE) break;
    cursor = page[page.length - 1]._id;
  }
  return orders;
}

function isTaskPackOrder(order = {}) {
  return order.productType === 'TASK_PACK' || order.packageId === 'task_pack_5';
}

function isLiveGrantedTaskPack(order = {}) {
  return isTaskPackOrder(order)
    && order.status === OrderStatus.PAID
    && order.grantStatus === GrantStatus.GRANTED
    && order.refundStatus !== RefundStatus.REFUNDED;
}

function grantedPackTotals(orders = []) {
  return orders.reduce((total, order) => {
    if (!isLiveGrantedTaskPack(order)) return total;
    const grant = order.entitlementGrant || {};
    const count = Math.max(0,
      Number(grant.taskPackCountAdded != null ? grant.taskPackCountAdded : grant.taskPackDelta) || 1
    );
    const slots = grant.taskPackSlotsAdded != null
      ? Math.max(0, Number(grant.taskPackSlotsAdded) || 0)
      : count * Math.max(0, Number(order.addedSlots) || LEGACY_TASK_PACK_SIZE);
    return { count: total.count + count, slots: total.slots + slots };
  }, { count: 0, slots: 0 });
}

function entitlementLedgerDiffOf(user, orders = []) {
  const currentCount = Math.max(0, parseInt(user.taskPackCount, 10) || 0);
  const currentSlots = Math.max(0, parseInt(user.taskPackSlots, 10) || 0);
  const granted = grantedPackTotals(orders);
  const nextCount = Math.max(currentCount, granted.count);
  const unaccountedPackCount = Math.max(0, currentCount - granted.count);
  const nextSlots = Math.max(
    currentSlots,
    currentCount * LEGACY_TASK_PACK_SIZE,
    granted.slots + unaccountedPackCount * LEGACY_TASK_PACK_SIZE
  );
  const legacyGranted = orders.filter(order => isLiveGrantedTaskPack(order)
    && !(order.entitlementGrant || {}).legacyBackfill
    && Number(order.grantSchemaVersion) !== ENTITLEMENT_MIGRATION_VERSION);
  const manualReview = orders.filter(order => order.status === OrderStatus.PAID
    && (!order.grantStatus || order.grantStatus === GrantStatus.NONE)
    && order.refundStatus !== RefundStatus.REFUNDED
    && order.grantStatus !== GrantStatus.REVERTED);
  return {
    userId: user.openId,
    userDocumentId: user._id,
    before: { taskPackCount: currentCount, taskPackSlots: currentSlots },
    after: { taskPackCount: nextCount, taskPackSlots: nextSlots },
    changed: user.taskPackCount !== nextCount || user.taskPackSlots !== nextSlots,
    grantedOrders: granted.count,
    legacyGranted,
    manualReview,
  };
}

async function applyEntitlementOrderMigration(db, diff, nowTs) {
  for (const order of diff.legacyGranted) {
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        entitlementGrant: { ...(order.entitlementGrant || {}), legacyBackfill: true },
        legacyBackfilledAt: nowTs,
        updatedAt: nowTs,
      },
    });
  }
  for (const order of diff.manualReview) {
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        grantReviewRequired: true,
        grantReviewReason: 'MISSING_GRANT_STATUS',
        entitlementGrant: { ...(order.entitlementGrant || {}), legacyBackfillReview: true },
        updatedAt: nowTs,
      },
    });
    await afterSales.createCaseRecord(db, order.userId, {
      orderId: order._id,
      type: 'RIGHTS_NOT_RECEIVED',
      requestId: `migration_entitlement_${order._id}`,
      reasonCode: 'MIGRATION_GRANT_STATUS_UNKNOWN',
      description: '历史订单缺少明确权益发放状态，迁移时转入人工核查。',
    }, {
      priority: 'HIGH',
      systemGenerated: true,
      migrationVersion: ENTITLEMENT_MIGRATION_VERSION,
    });
  }
}

/**
 * 会员名额账本迁移。dryRun 只输出差异，不写用户、订单或售后记录。
 * 正式迁移按 users._id 游标分批，重复执行不会重复创建活动售后。
 */
async function migrateEntitlementLedgerBatch(db, {
  cursor = null,
  adminOpenId = '',
  dryRun = false,
} = {}) {
  const dry = dryRun === true;
  if (!cursor && !dry && await entitlementMigrationCompleted(db)) {
    return ok({
      scanned: 0,
      updated: 0,
      nextCursor: null,
      hasMore: false,
      batchSize: BATCH_SIZE,
      alreadyCompleted: true,
      dryRun: false,
    });
  }

  const nowTs = new Date();
  const where = cursor ? { _id: db.command.gt(String(cursor)) } : {};
  const userRes = await db.collection(COLLECTIONS.USERS)
    .where(where)
    .orderBy('_id', 'asc')
    .limit(BATCH_SIZE)
    .get();
  const users = userRes.data || [];
  const diffs = [];
  let updated = 0;
  let manualReviewCount = 0;
  let legacyBackfillCount = 0;
  let nextCursor = cursor || null;

  for (const user of users) {
    nextCursor = user._id || nextCursor;
    const orders = await paidOrdersOfUser(db, user.openId);
    const diff = entitlementLedgerDiffOf(user, orders);
    diffs.push({
      userId: diff.userId,
      userDocumentId: diff.userDocumentId,
      before: diff.before,
      after: diff.after,
      changed: diff.changed,
      grantedOrderCount: diff.grantedOrders,
      legacyBackfillCount: diff.legacyGranted.length,
      manualReviewCount: diff.manualReview.length,
    });
    manualReviewCount += diff.manualReview.length;
    legacyBackfillCount += diff.legacyGranted.length;
    if (dry) continue;

    await db.collection(COLLECTIONS.USERS).doc(user._id).update({
      data: {
        taskPackCount: diff.after.taskPackCount,
        taskPackSlots: diff.after.taskPackSlots,
        entitlementLedgerMigratedAt: nowTs,
        entitlementLedgerMigrationVersion: ENTITLEMENT_MIGRATION_VERSION,
      },
    });
    await applyEntitlementOrderMigration(db, diff, nowTs);
    updated += 1;
  }

  const hasMore = users.length === BATCH_SIZE;
  if (!dry && !hasMore) {
    await markEntitlementMigrationCompleted(db, {
      adminOpenId,
      nextCursor,
      scanned: users.length,
      updated,
      manualReview: manualReviewCount,
      legacyBackfill: legacyBackfillCount,
    });
  }

  return ok({
    scanned: users.length,
    updated,
    nextCursor,
    hasMore,
    batchSize: BATCH_SIZE,
    dryRun: dry,
    manualReviewCount,
    legacyBackfillCount,
    diffs,
  });
}

module.exports = {
  BATCH_SIZE,
  MIGRATION_MARKER_CASE_ID,
  MIGRATION_COMPLETE_ACTION,
  ENTITLEMENT_MIGRATION_MARKER_CASE_ID,
  ENTITLEMENT_MIGRATION_COMPLETE_ACTION,
  ENTITLEMENT_MIGRATION_VERSION,
  protectionMigrationCompleted,
  migrateProtectionBatch,
  entitlementMigrationCompleted,
  migrateEntitlementLedgerBatch,
};
