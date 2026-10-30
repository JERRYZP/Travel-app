/**
 * 售后资格、退款回收和老用户保护额度迁移。
 */
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, CaseStatus, RefundStatus, GrantStatus, OrderStatus,
} = require('../cloudfunctions/payment/lib/schema');
const afterSales = require('../cloudfunctions/payment/lib/after-sales');
const { reverseOrderEntitlement, fulfillOrder } = require('../cloudfunctions/payment/lib/order');
const { migrateProtectionBatch } = require('../cloudfunctions/payment/lib/migration');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const USER = 'openid_after_sales';
const DAY = 86400000;

function seedUser(db, patch = {}) {
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_after_sales',
    openId: USER,
    nickname: '测试用户',
    memberLevel: 'MEMBER',
    memberExpiresAt: new Date(Date.now() + 30 * DAY),
    taskPackCount: 1,
    protectedTaskQuota: 12,
    ...patch,
  }]);
}

function seedPaidOrder(db, patch = {}) {
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_paid_001',
    userId: USER,
    outTradeNo: 'T20261030TEST',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 200,
    memberDays: 30,
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.GRANTED,
    refundStatus: RefundStatus.NONE,
    paidAt: new Date(Date.now() - 3600000),
    createdAt: new Date(Date.now() - 3700000),
    entitlementGrant: {
      memberDaysAddedMs: 30 * DAY,
      taskPackDelta: 0,
      appliedAt: new Date(Date.now() - 3500000),
    },
    ...patch,
  }]);
}

async function run() {
  console.log('=== 0. 售后管理员只认显式环境变量 ===');
  eq(afterSales.isAfterSalesAdmin('admin_openid', {}), false, '未配置白名单时售后工作台关闭');
  eq(afterSales.isAfterSalesAdmin('admin_openid', {
    AFTER_SALES_ADMIN_OPENIDS: 'admin_openid, second_admin',
  }), true, '显式配置的管理员可进入工作台');
  eq(afterSales.isAfterSalesAdmin('other_openid', {
    AFTER_SALES_ADMIN_OPENIDS: 'admin_openid, second_admin',
  }), false, '非白名单账号仍被拒绝');

  console.log('=== 1. 24 小时未使用退款资格 ===');
  let db = createDb();
  seedUser(db);
  seedPaidOrder(db);
  let order = db._dump(COLLECTIONS.ORDERS)[0];
  let user = db._dump(COLLECTIONS.USERS)[0];
  let eligible = afterSales.refundEligibilityOf(order, user);
  eq(eligible.eligibleForReview, true, '支付 1 小时且未新增提醒可申请');
  eligible = afterSales.refundEligibilityOf(order, {
    ...user, lastReminderCreatedAt: new Date(),
  });
  eq(eligible.eligibleForReview, false, '支付后新增提醒不可按未使用退款');

  console.log('\n=== 2. 售后单幂等与驳回原因约束 ===');
  const created = await afterSales.createCaseRecord(db, USER, {
    orderId: order._id, type: 'UNUSED_REFUND', description: '买错了',
  }, { eligibility: eligible });
  eq(created.success, true, '创建售后单');
  eq(created.case.status, CaseStatus.UNDER_REVIEW, '未使用退款进入客服审核');
  const duplicate = await afterSales.createCaseRecord(db, USER, {
    orderId: order._id, type: 'UNUSED_REFUND',
  }, { eligibility: eligible });
  eq(duplicate.success, false, '同一订单不能重复创建处理中售后');
  eq(duplicate.errorCode, 1028, '返回售后已存在错误码');

  console.log('\n=== 3. 重复支付证据与确定性退款单号 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db, {
    _id: 'older', outTradeNo: 'TOLDER',
    createdAt: new Date(Date.now() - 60000), paidAt: new Date(Date.now() - 60000),
  });
  seedPaidOrder(db, {
    _id: 'newer', outTradeNo: 'TNEWER', createdAt: new Date(), paidAt: new Date(),
  });
  const newer = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'newer');
  const evidence = await afterSales.duplicateEvidence(db, newer);
  eq(evidence.duplicate, true, '发现 10 分钟内同商品重复支付');
  eq(evidence.olderOrderId, 'older', '证据指向较早订单');
  eq(afterSales.outRefundNoOf(newer), 'RFTNEWER', '退款单号由商户订单号确定性生成');
  const group = await afterSales.duplicateChargeTarget(db, db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'older'));
  eq(group.targetOrderId, 'newer', '从较早订单回调也能定位整组中较新的重复支付订单');

  console.log('\n=== 4. 退款按本单快照回收，不删除提醒 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db, {
    grantStatus: GrantStatus.GRANTED,
    entitlementGrant: { memberDaysAddedMs: 30 * DAY, taskPackDelta: 1 },
  });
  const beforeUser = db._dump(COLLECTIONS.USERS)[0];
  const beforeExpiry = new Date(beforeUser.memberExpiresAt).getTime();
  const reversed = await reverseOrderEntitlement(db, db._dump(COLLECTIONS.ORDERS)[0], 200);
  eq(reversed.success, true, '退款权益回收成功');
  const afterUser = db._dump(COLLECTIONS.USERS)[0];
  const afterOrder = db._dump(COLLECTIONS.ORDERS)[0];
  eq(afterUser.taskPackCount, 0, '只回收本单新增任务包');
  eq(new Date(afterUser.memberExpiresAt).getTime() <= beforeExpiry - 29 * DAY, true, '只回收本单新增会员时长');
  eq(afterOrder.refundStatus, RefundStatus.REFUNDED, '退款状态独立写入');
  eq(afterOrder.grantStatus, GrantStatus.REVERTED, '权益标记已回收');
  eq(afterOrder.status, OrderStatus.PAID, '订单主状态不混入退款生命周期');
  const expiryAfterRefund = new Date(afterUser.memberExpiresAt).getTime();
  const replay = await fulfillOrder(db, afterOrder, { totalFee: 200 });
  eq(replay.entitlementStatus, 'REFUNDED', '退款后重复支付回调不重新发权益');
  eq(
    new Date(db._dump(COLLECTIONS.USERS)[0].memberExpiresAt).getTime(),
    expiryAfterRefund,
    '退款后会员到期时间不再变化'
  );

  console.log('\n=== 4b. 历史订单无权益快照时按订单商品回收 ===');
  db = createDb();
  seedUser(db, { memberExpiresAt: new Date(Date.now() + 30 * DAY), taskPackCount: 0 });
  seedPaidOrder(db, { entitlementGrant: null, memberDays: 30, productType: 'MEMBER' });
  const legacyBefore = new Date(db._dump(COLLECTIONS.USERS)[0].memberExpiresAt).getTime();
  const legacyReversed = await reverseOrderEntitlement(db, db._dump(COLLECTIONS.ORDERS)[0], 200);
  eq(legacyReversed.success, true, '历史订单可完成退款权益回收');
  eq(
    new Date(db._dump(COLLECTIONS.USERS)[0].memberExpiresAt).getTime() <= legacyBefore - 29 * DAY,
    true,
    '无快照时按订单 30 天商品快照回收会员时长'
  );
  eq(db._dump(COLLECTIONS.ORDERS)[0].entitlementGrant.legacyBackfill, true,
    '历史订单回写兼容回收快照');

  console.log('\n=== 5. 重复退款幂等 ===');
  const again = await reverseOrderEntitlement(db, afterOrder, 200);
  eq(again.success, true, '重复退款回调仍返回成功');
  eq(again.alreadyReverted, true, '不会再次扣减权益');

  console.log('\n=== 6. 权益未到账不污染退款生命周期 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db, {
    refundStatus: RefundStatus.NONE,
    grantStatus: GrantStatus.FAILED,
    grantError: '模拟事务失败',
    entitlementGrant: null,
  });
  const failedOrder = db._dump(COLLECTIONS.ORDERS)[0];
  const rightsCase = await afterSales.createCaseRecord(db, USER, {
    orderId: failedOrder._id,
    type: 'RIGHTS_NOT_RECEIVED',
    reasonCode: 'SYSTEM_GRANT_FAILED',
    description: '系统自动转补发队列',
  }, { priority: 'HIGH', systemGenerated: true });
  eq(rightsCase.success, true, '权益未到账可进入售后队列');
  eq(rightsCase.case.status, CaseStatus.AUTO_CHECKING, '权益异常进入自动核验');
  eq(rightsCase.case.priority, 'HIGH', '权益异常为高优先级');
  eq(db._dump(COLLECTIONS.ORDERS)[0].refundStatus, RefundStatus.NONE, '补发权益不会提前标记退款中');
  const history = await afterSales.userCaseHistory(db, USER, failedOrder._id);
  eq(history.stats.total, 1, '售后历史统计累计申请数');
  eq(history.stats.active, 1, '售后历史统计处理中数量');
  eq(history.stats.sameOrder, 1, '售后历史统计本订单重复申请数');

  console.log('\n=== 7. 老用户保护额度迁移 ===');
  db = createDb();
  const now = new Date();
  db._seed(COLLECTIONS.USERS, [
    { _id: 'u12', openId: 'openid_12', createdAt: new Date('2026-01-01') },
    { _id: 'u2', openId: 'openid_2', createdAt: new Date('2026-02-01') },
  ]);
  db._seed(COLLECTIONS.REMINDER_TASKS, [
    ...Array.from({ length: 12 }, (_, i) => ({
      _id: `task12_${i}`, userId: 'openid_12', backendStatus: 'WAITING',
      releaseAt: new Date(now.getTime() + (i + 1) * DAY), createdAt: new Date(now.getTime() - i * 1000),
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      _id: `task2_${i}`, userId: 'openid_2', backendStatus: 'WAITING',
      releaseAt: new Date(now.getTime() + (i + 1) * DAY), createdAt: new Date(now.getTime() - i * 1000),
    })),
  ]);
  const migrated = await migrateProtectionBatch(db);
  eq(migrated.success, true, '迁移批次执行成功');
  eq(db._dump(COLLECTIONS.USERS).find(u => u._id === 'u12').protectedTaskQuota, 12, '12 条老任务保护 12 个额度');
  eq(db._dump(COLLECTIONS.USERS).find(u => u._id === 'u2').protectedTaskQuota, 5, '少量老任务仍保底 5 个额度');
  eq(!!db._dump(COLLECTIONS.USERS).find(u => u._id === 'u12').lastReminderCreatedAt, true, '回填最近提醒创建时间');

  console.log('\n=== 8. 保护额度迁移按 _id 游标不漏同时间用户 ===');
  db = createDb();
  const sameCreatedAt = new Date('2026-03-01');
  db._seed(COLLECTIONS.USERS, Array.from({ length: 55 }, (_, i) => ({
    _id: `batch_user_${String(i).padStart(2, '0')}`,
    openId: `batch_openid_${i}`,
    createdAt: sameCreatedAt,
  })));
  const firstBatch = await migrateProtectionBatch(db);
  const secondBatch = await migrateProtectionBatch(db, { cursor: firstBatch.nextCursor });
  eq(firstBatch.scanned, 50, '第一批处理 50 人');
  eq(firstBatch.hasMore, true, '第一批提示继续');
  eq(secondBatch.scanned, 5, '第二批处理剩余 5 人');
  eq(secondBatch.hasMore, false, '迁移完成');
  eq(
    db._dump(COLLECTIONS.USERS).filter(u => u.protectionMigratedAt).length,
    55,
    '同一 createdAt 的 55 人全部被迁移'
  );

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
