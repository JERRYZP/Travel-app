/**
 * 售后资格、退款回收和老用户保护额度迁移。
 */
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, CaseStatus, CaseType, RefundStatus, GrantStatus, OrderStatus,
} = require('../cloudfunctions/payment/lib/schema');
const afterSales = require('../cloudfunctions/payment/lib/after-sales');
const { reverseOrderEntitlement, fulfillOrder } = require('../cloudfunctions/payment/lib/order');
const wxpay = require('../cloudfunctions/payment/lib/wxpay-v3');
const {
  migrateProtectionBatch,
  protectionMigrationCompleted,
  migrateEntitlementLedgerBatch,
  entitlementMigrationCompleted,
} = require('../cloudfunctions/payment/lib/migration');

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

function seedRefundFailedCase(db, patch = {}) {
  seedUser(db);
  seedPaidOrder(db, {
    refundStatus: RefundStatus.FAILED,
    paymentProvider: 'WECHAT_PAY_V3',
    activeAfterSalesCaseId: 'case_refund_failed_cancel',
    ...(patch.order || {}),
  });
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'case_refund_failed_cancel',
    caseNo: 'ASCANCELFAILED',
    userId: USER,
    orderId: 'order_paid_001',
    outTradeNo: 'T20261030TEST',
    title: '会员 30 天',
    amountFen: 200,
    type: 'UNUSED_REFUND',
    status: CaseStatus.REFUND_FAILED,
    refundStatus: RefundStatus.FAILED,
    outRefundNo: 'RFT20261030TEST',
    failureReason: '基本账户余额不足，请充值后重新发起',
    fundingBlocked: true,
    createdAt: new Date(Date.now() - 1800000),
    updatedAt: new Date(Date.now() - 600000),
    ...(patch.case || {}),
  }]);
}

function loadPayment(db, options = {}) {
  const openId = options.openId || USER;
  const moduleStubs = options.moduleStubs || {};
  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    const fromPaymentIndex = parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`);
    if (fromPaymentIndex && Object.prototype.hasOwnProperty.call(moduleStubs, request)) {
      return moduleStubs[request];
    }
    if (request === 'wx-server-sdk' && fromPaymentIndex) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: openId }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/payment/index.js')];
    return require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }
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
  const missingRequest = await afterSales.createCaseRecord(db, USER, {
    orderId: order._id, type: 'UNUSED_REFUND', description: '缺少请求号',
  }, { eligibility: eligible });
  eq(missingRequest.success, false, '用户售后缺少 requestId 时拒绝');
  eq(missingRequest.errorCode, 1010, '缺少 requestId 返回参数错误');
  const created = await afterSales.createCaseRecord(db, USER, {
    orderId: order._id, type: 'UNUSED_REFUND', requestId: 'req_after_sales_original_001', description: '买错了',
  }, { eligibility: eligible });
  eq(created.success, true, '创建售后单');
  eq(created.case.status, CaseStatus.UNDER_REVIEW, '未使用退款进入客服审核');
  const duplicate = await afterSales.createCaseRecord(db, USER, {
    orderId: order._id, type: 'UNUSED_REFUND', requestId: 'req_after_sales_duplicate_001',
  }, { eligibility: eligible });
  eq(duplicate.success, false, '同一订单不能重复创建处理中售后');
  eq(duplicate.errorCode, 1028, '返回售后已存在错误码');

  console.log('\n=== 2a. 首次售后兼容真实云数据库 document-not-found 与不可写 _id ===');
  db = createDb({ cloudGetOnMissing: true, cloudSetRejectsId: true });
  seedUser(db);
  seedPaidOrder(db);
  const cloudMissingCreated = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'ENTITLEMENT_MISMATCH',
    requestId: 'req_after_sales_cloud_missing_001',
  }, { eligibility: afterSales.refundEligibilityOf(
    db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
  ) });
  eq(cloudMissingCreated.success, true, '确定性售后单不存在时仍可首次创建');
  eq(cloudMissingCreated.case.type, 'ENTITLEMENT_MISMATCH', '首次创建的售后类型正确');
  const cloudMissingRetry = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'ENTITLEMENT_MISMATCH',
    requestId: 'req_after_sales_cloud_missing_001',
  }, { eligibility: {} });
  eq(cloudMissingRetry.success, true, '同一 requestId 重试返回成功');
  eq(cloudMissingRetry.idempotent, true, '真实缺失语义下重试仍保持幂等');

  console.log('\n=== 2aa. 云函数入口真实写入和异常错误码契约 ===');
  db = createDb({ cloudGetOnMissing: true, cloudSetRejectsId: true });
  seedUser(db);
  seedPaidOrder(db);
  const payment = loadPayment(db);
  const mainCreated = await payment.main({
    action: 'afterSales.submit',
    orderId: 'order_paid_001',
    type: 'ENTITLEMENT_MISMATCH',
    requestId: 'req_after_sales_main_strict_001',
  }, { OPENID: USER });
  eq(mainCreated.success, true, '严格云数据库语义下售后入口可完成首次写入');
  const originalCreateCaseRecord = afterSales.createCaseRecord;
  try {
    afterSales.createCaseRecord = async () => { throw new Error('synthetic database failure'); };
    const unexpected = await payment.main({
      action: 'afterSales.submit',
      orderId: 'order_paid_001',
      type: 'ENTITLEMENT_MISMATCH',
      requestId: 'req_after_sales_main_unexpected_001',
    }, { OPENID: USER });
    eq(unexpected.errorCode, 1500, '未分类异常返回通用服务错误码');
    eq(unexpected.error, '服务异常，请稍后重试', '未分类异常不再伪装成支付通道未就绪');
  } finally {
    afterSales.createCaseRecord = originalCreateCaseRecord;
  }

  console.log('\n=== 2b. requestId 幂等、并发唯一与终态解绑 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db);
  const concurrentRequestId = 'req_after_sales_concurrent_001';
  const concurrentResults = await Promise.all([
    afterSales.createCaseRecord(db, USER, {
      orderId: 'order_paid_001',
      type: 'UNUSED_REFUND',
      requestId: concurrentRequestId,
    }, { eligibility: afterSales.refundEligibilityOf(
      db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
    ) }),
    afterSales.createCaseRecord(db, USER, {
      orderId: 'order_paid_001',
      type: 'UNUSED_REFUND',
      requestId: concurrentRequestId,
    }, { eligibility: afterSales.refundEligibilityOf(
      db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
    ) }),
  ]);
  eq(concurrentResults.every(result => result.success === true), true,
    '同一 requestId 并发提交均返回成功');
  eq(concurrentResults[0].case._id, concurrentResults[1].case._id, '同一 requestId 返回同一售后单');
  eq(db._dump(COLLECTIONS.AFTER_SALES_CASES).length, 1, '并发提交只写入一条售后单');
  const activeCaseId = db._dump(COLLECTIONS.ORDERS)[0].activeAfterSalesCaseId;
  eq(activeCaseId, concurrentResults[0].case._id, '订单事务内绑定唯一活动售后单');
  const blocked = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'UNUSED_REFUND',
    requestId: 'req_after_sales_concurrent_002',
  }, { eligibility: afterSales.refundEligibilityOf(
    db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
  ) });
  eq(blocked.success, false, '存在活动售后时新请求被拒绝');
  eq(blocked.errorCode, 1028, '并发唯一冲突返回售后已存在');
  await afterSales.updateCase(db, activeCaseId, {
    status: CaseStatus.REJECTED,
    decisionNote: '测试终态解绑',
  });
  eq(db._dump(COLLECTIONS.ORDERS)[0].activeAfterSalesCaseId, '',
    '售后进入终态后清空订单活动指针');
  const sameAfterTerminal = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'UNUSED_REFUND',
    requestId: concurrentRequestId,
  }, { eligibility: afterSales.refundEligibilityOf(
    db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
  ) });
  eq(sameAfterTerminal.success && sameAfterTerminal.case._id === activeCaseId, true,
    '同一 requestId 在售后终态后仍返回原售后单');
  await db.collection(COLLECTIONS.ORDERS).doc('order_paid_001').update({
    data: { refundStatus: RefundStatus.REFUNDED, grantStatus: GrantStatus.REVERTED },
  });
  const sameAfterRefund = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'UNUSED_REFUND',
    requestId: concurrentRequestId,
  }, { eligibility: {} });
  eq(sameAfterRefund.success && sameAfterRefund.case._id === activeCaseId, true,
    '订单退款完成后同一 requestId 仍保持幂等');
  const newAfterRefund = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'RIGHTS_NOT_RECEIVED',
    requestId: 'req_after_sales_after_refund_001',
  }, { eligibility: {} });
  eq(newAfterRefund.success, false, '订单退款完成后拒绝新建售后');
  eq(newAfterRefund.errorCode, 1028, '退款完成后的新售后返回已存在');

  console.log('\n=== 2d. 平台退款首次补建售后兼容真实云数据库写入 ===');
  db = createDb({ cloudGetOnMissing: true, cloudSetRejectsId: true });
  seedUser(db);
  seedPaidOrder(db);
  const platformOrder = db._dump(COLLECTIONS.ORDERS)[0];
  const platformCase = await afterSales.createPlatformRefundCase(
    db,
    platformOrder,
    'RF_CLOUD_MISSING_001',
    { paymentChannel: 'WECHAT_VIRTUAL' }
  );
  eq(!!platformCase._id, true, '平台退款可首次补建售后记录');
  eq(platformCase.systemGenerated, true, '平台退款售后标记为系统自动生成');
  const platformReplay = await afterSales.createPlatformRefundCase(
    db,
    platformOrder,
    'RF_CLOUD_MISSING_001',
    { paymentChannel: 'WECHAT_VIRTUAL' }
  );
  eq(platformReplay._id, platformCase._id, '平台退款重复推送复用同一售后记录');

  console.log('\n=== 2e. 售后终态不能误清另一条新活动售后 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db);
  const olderCase = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_paid_001',
    type: 'UNUSED_REFUND',
    requestId: 'req_after_sales_older_case_001',
  }, { eligibility: afterSales.refundEligibilityOf(
    db._dump(COLLECTIONS.ORDERS)[0], db._dump(COLLECTIONS.USERS)[0]
  ) });
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'case_newer_active',
    userId: USER,
    orderId: 'order_paid_001',
    type: 'RIGHTS_NOT_RECEIVED',
    status: CaseStatus.AUTO_CHECKING,
    createdAt: new Date(),
  }]);
  await db.collection(COLLECTIONS.ORDERS).doc('order_paid_001').update({
    data: { activeAfterSalesCaseId: 'case_newer_active' },
  });
  await afterSales.updateCase(db, olderCase.case._id, { status: CaseStatus.REJECTED });
  eq(db._dump(COLLECTIONS.ORDERS)[0].activeAfterSalesCaseId, 'case_newer_active',
    '旧售后终态只清自己的指针，不覆盖新活动售后');

  console.log('\n=== 3. 重复支付证据与确定性退款单号 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db, {
    _id: 'older', outTradeNo: 'TOLDER',
    createdAt: new Date(Date.now() - 30000), paidAt: new Date(Date.now() - 30000),
  });
  seedPaidOrder(db, {
    _id: 'newer', outTradeNo: 'TNEWER', createdAt: new Date(), paidAt: new Date(),
  });
  const newer = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'newer');
  const evidence = await afterSales.duplicateEvidence(db, newer);
  eq(evidence.duplicate, true, '发现 1 分钟内同商品重复支付');
  eq(evidence.windowMinutes, 1, '判定窗口为 1 分钟');
  eq(evidence.olderOrderId, 'older', '证据指向较早订单');
  eq(afterSales.outRefundNoOf(newer), 'RFTNEWER', '退款单号由商户订单号确定性生成');
  const group = await afterSales.duplicateChargeTarget(db, db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'older'));
  eq(group.targetOrderId, 'newer', '从较早订单回调也能定位整组中较新的重复支付订单');

  // 同一会员在短时间内主动续费也可能发生，间隔超过 1 分钟就不该判成重复支付。
  seedPaidOrder(db, {
    _id: 'later', outTradeNo: 'TLATER',
    createdAt: new Date(Date.now() + 120000), paidAt: new Date(Date.now() + 120000),
  });
  const later = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'later');
  const wideEvidence = await afterSales.duplicateEvidence(db, later);
  eq(wideEvidence.duplicate, false, '间隔超过 1 分钟的连续购买不判为重复支付');

  console.log('\n=== 3.1 有升级包时先退会员被服务端拦截 ===');
  db = createDb();
  const dependencyExpiry = new Date(Date.now() + 10 * DAY);
  seedUser(db, {
    memberExpiresAt: dependencyExpiry,
    memberTier: 'UNLIMITED',
    memberTierOrderId: 'order_upgrade_dependency',
  });
  seedPaidOrder(db, {
    _id: 'order_base_dependency',
    packageId: 'member_quota_10',
    productType: 'MEMBER',
    amountFen: 300,
    memberDays: 30,
    memberFloorDays: 30,
    entitlementGrant: {
      memberDaysAddedMs: 30 * DAY,
      beforeTier: '',
      appliedAt: new Date(Date.now() - 3500000),
    },
  });
  db._seed(COLLECTIONS.ORDERS, [
    db._dump(COLLECTIONS.ORDERS)[0],
    {
      _id: 'order_upgrade_dependency',
      userId: USER,
      outTradeNo: 'TUPGRADEDEPENDENCY',
      packageId: 'member_unlimited_upgrade',
      productType: 'MEMBER',
      membershipTier: 'UNLIMITED',
      unlimited: true,
      upgrade: true,
      title: '升级不限提醒名额',
      amountFen: 190,
      memberDays: 0,
      status: OrderStatus.PAID,
      grantStatus: GrantStatus.GRANTED,
      refundStatus: RefundStatus.NONE,
      paidAt: new Date(Date.now() - 1800000),
      createdAt: new Date(Date.now() - 1900000),
      upgradeExpiresAt: dependencyExpiry,
      entitlementGrant: {
        beforeTier: 'QUOTA_10',
        beforeTierOrderId: 'order_base_dependency',
        memberDaysAddedMs: 0,
        appliedAt: new Date(Date.now() - 1700000),
      },
    },
  ]);
  const dependencyBlocked = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_base_dependency',
    type: CaseType.UNUSED_REFUND,
    requestId: 'req_dependency_base_refund',
  });
  eq(dependencyBlocked.success, false, '先退会员被服务端拒绝');
  eq(dependencyBlocked.errorCode, 1034, '返回升级包退款依赖错误码');
  eq(dependencyBlocked.dependentUpgradeOrderId, 'order_upgrade_dependency',
    '返回需要先处理的升级单');
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_credit_converted',
    userId: USER,
    outTradeNo: 'TCREDITCONVERTED',
    packageId: 'member_unlimited_upgrade',
    productType: 'MEMBER',
    title: '升级不限提醒名额',
    amountFen: 190,
    memberDays: 0,
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.REVERTED,
    refundStatus: RefundStatus.NONE,
    paidAt: new Date(Date.now() - 1800000),
    entitlementGrant: {
      creditConverted: true,
      creditId: 'upgrade_credit_test',
      memberDaysAddedMs: 0,
      appliedAt: new Date(Date.now() - 1700000),
      revertedAt: new Date(),
    },
  }]);
  const convertedCreditCase = await afterSales.createCaseRecord(db, USER, {
    orderId: 'order_credit_converted',
    type: CaseType.UNUSED_REFUND,
    requestId: 'req_credit_converted_refund',
  });
  eq(convertedCreditCase.success, false, '已转权益券的升级单拒绝普通退款接口');
  eq(convertedCreditCase.errorCode, 1029, '权益券订单返回不可退款错误码');

  console.log('\n=== 4. 退款按本单快照回收，不删除提醒 ===');
  db = createDb();
  seedUser(db, {
    memberExpiresAt: new Date(Date.now() + 40 * DAY),
    taskPackCount: 1,
    taskPackSlots: 10,
  });
  seedPaidOrder(db, {
    packageId: 'task_pack_5',
    productType: 'TASK_PACK',
    amountFen: 300,
    addedSlots: 10,
    memberDays: 0,
    memberFloorDays: 30,
    grantStatus: GrantStatus.GRANTED,
    entitlementGrant: {
      memberDaysAddedMs: 0,
      taskPackDelta: 1,
      taskPackCountAdded: 1,
      taskPackSlotsAdded: 10,
    },
  });
  const beforeUser = db._dump(COLLECTIONS.USERS)[0];
  const beforeExpiry = new Date(beforeUser.memberExpiresAt).getTime();
  const reversed = await reverseOrderEntitlement(db, db._dump(COLLECTIONS.ORDERS)[0], 200);
  eq(reversed.success, true, '退款权益回收成功');
  const afterUser = db._dump(COLLECTIONS.USERS)[0];
  const afterOrder = db._dump(COLLECTIONS.ORDERS)[0];
  eq(afterUser.taskPackCount, 0, '只回收本单新增任务包');
  eq(afterUser.taskPackSlots, 0, '只回收本单新增名额数');
  eq(new Date(afterUser.memberExpiresAt).getTime(), beforeExpiry, '无会员时长增量时不误扣有效期');
  eq(afterOrder.refundStatus, RefundStatus.REFUNDED, '退款状态独立写入');
  eq(afterOrder.grantStatus, GrantStatus.REVERTED, '权益标记已回收');
  eq(afterOrder.status, OrderStatus.PAID, '订单主状态不混入退款生命周期');
  const expiryAfterRefund = new Date(afterUser.memberExpiresAt).getTime();
  const replay = await fulfillOrder(db, afterOrder, { totalFee: 300 });
  eq(replay.entitlementStatus, 'REFUNDED', '退款后重复支付回调不重新发权益');
  const stillGrantedSnapshot = { ...afterOrder, grantStatus: GrantStatus.GRANTED };
  const replayGrantedSnapshot = await fulfillOrder(db, stillGrantedSnapshot, { totalFee: 300 });
  eq(replayGrantedSnapshot.entitlementStatus, 'REFUNDED',
    '已退款订单即使残留 GRANTED 快照也不能重新当作已到账');
  const refundedStatusReplay = await reverseOrderEntitlement(db, {
    ...afterOrder,
    status: OrderStatus.REFUNDED,
  }, 300);
  eq(refundedStatusReplay.success && refundedStatusReplay.alreadyReverted, true,
    '历史订单主状态已退款时重复回调保持幂等');
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
    requestId: afterSales.systemRequestIdOf('GRANT_FAILED', failedOrder._id),
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

  console.log('\n=== 6b. 工作台待处理数只统计未结束售后 ===');
  db = createDb();
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [
    ...Object.values(CaseStatus)
      .filter(status => afterSales.ACTIVE_CASE_STATUSES.has(status))
      .map((status, index) => ({ _id: `active_${index}`, status })),
    ...Object.values(CaseStatus)
      .filter(status => !afterSales.ACTIVE_CASE_STATUSES.has(status))
      .map((status, index) => ({ _id: `closed_${index}`, status })),
  ]);
  eq(
    await afterSales.countActiveCases(db),
    afterSales.ACTIVE_CASE_STATUSES.size,
    '服务端待处理数覆盖全部未结束状态并排除终态'
  );

  console.log('\n=== 6c. 用户可以取消未处理售后并释放订单锁 ===');
  db = createDb();
  seedUser(db);
  seedPaidOrder(db);
  const cancellableOrder = db._dump(COLLECTIONS.ORDERS)[0];
  const cancellableUser = db._dump(COLLECTIONS.USERS)[0];
  const cancellableCreated = await afterSales.createCaseRecord(db, USER, {
    orderId: cancellableOrder._id,
    type: 'UNUSED_REFUND',
    requestId: 'req_user_cancel_after_sales_001',
    description: '暂时不需要退款了',
  }, {
    eligibility: afterSales.refundEligibilityOf(cancellableOrder, cancellableUser),
  });
  const cancellableCaseId = cancellableCreated.case._id;
  const cancelled = await afterSales.cancelCaseForUser(db, USER, cancellableCaseId, {
    expectedStatus: CaseStatus.UNDER_REVIEW,
  });
  eq(cancelled.success, true, '审核中的售后可以取消');
  eq(cancelled.case.status, CaseStatus.CANCELLED, '售后进入用户取消终态');
  eq(cancelled.case.cancelledBy, 'USER', '保留取消人');
  eq(!!cancelled.case.cancelledAtText, true, '保留用户取消时间');
  let cancelledOrder = db._dump(COLLECTIONS.ORDERS)[0];
  let cancelledUser = db._dump(COLLECTIONS.USERS)[0];
  eq(cancelledOrder.activeAfterSalesCaseId, '', '取消后释放订单售后锁');
  eq(cancelledOrder.refundStatus, RefundStatus.NONE, '取消后订单可重新申请售后');
  eq(cancelledOrder.grantStatus, GrantStatus.GRANTED, '取消不回收已发放权益');
  eq(cancelledUser.taskPackCount, cancellableUser.taskPackCount, '取消不改变名额包');
  eq(
    new Date(cancelledUser.memberExpiresAt).getTime(),
    new Date(cancellableUser.memberExpiresAt).getTime(),
    '取消不改变会员期限'
  );
  const cancelledHistory = await afterSales.userCaseHistory(db, USER, cancellableOrder._id);
  eq(cancelledHistory.stats.cancelled, 1, '售后历史统计用户取消数');
  eq(cancelledHistory.stats.active, 0, '用户取消后不进入待处理数量');
  eq(await afterSales.countActiveCases(db), 0, '工作台待处理数排除用户取消单');
  const cancelledAgain = await afterSales.cancelCaseForUser(db, USER, cancellableCaseId);
  eq(cancelledAgain.success && cancelledAgain.idempotent, true, '重复取消保持幂等');
  const otherUserCancelled = await afterSales.cancelCaseForUser(db, 'another_openid', cancellableCaseId);
  eq(otherUserCancelled.success, false, '其他用户不能取消售后');
  eq(otherUserCancelled.errorCode, 1030, '其他用户按记录不存在处理');
  eq(
    await afterSales.markRefundProcessing(db, { _id: cancellableCaseId, orderId: cancellableOrder._id }, 'RFTEST'),
    false,
    '已取消售后不能被并发退款流程改回处理中'
  );
  const reapplied = await afterSales.createCaseRecord(db, USER, {
    orderId: cancellableOrder._id,
    type: 'ENTITLEMENT_MISMATCH',
    requestId: 'req_user_reapply_after_cancel_001',
    description: '取消后重新核对权益',
  }, {});
  eq(reapplied.success, true, '取消后可以重新提交售后');
  eq(reapplied.case.status, CaseStatus.UNDER_REVIEW, '重新申请进入正常审核流程');

  console.log('\n=== 6d. 退款处理中不能由用户取消 ===');
  db = createDb();
  seedRefundFailedCase(db, {
    order: { refundStatus: RefundStatus.PROCESSING },
    case: { status: CaseStatus.PROCESSING, refundStatus: RefundStatus.PROCESSING },
  });
  const processingCancel = await afterSales.cancelCaseForUser(
    db,
    USER,
    'case_refund_failed_cancel',
    { expectedStatus: CaseStatus.PROCESSING }
  );
  eq(processingCancel.success, false, '退款处理中拒绝取消');
  eq(processingCancel.errorCode, 1029, '退款处理中返回不可取消错误码');

  console.log('\n=== 6e. 异常退款仅在远端无退款单时允许取消 ===');
  db = createDb();
  seedRefundFailedCase(db);
  const notFoundWxpay = {
    ...wxpay,
    configOf: () => ({ mchId: 'merchant_test' }),
    hasApiConfig: () => true,
    queryRefund: async () => {
      throw new wxpay.WxPayApiError('退款单不存在', {
        statusCode: 404,
        code: 'RESOURCE_NOT_EXISTS',
      });
    },
  };
  let cancelPayment = loadPayment(db, { moduleStubs: { './lib/wxpay-v3': notFoundWxpay } });
  const remoteAbsentCancel = await cancelPayment.main({
    action: 'afterSales.cancel',
    caseId: 'case_refund_failed_cancel',
  });
  eq(remoteAbsentCancel.success, true, '远端确认无退款单后允许取消异常售后');
  eq(remoteAbsentCancel.case.status, CaseStatus.CANCELLED, '异常售后取消成功');
  eq(db._dump(COLLECTIONS.ORDERS)[0].refundStatus, RefundStatus.NONE, '异常售后取消后释放退款状态');

  db = createDb();
  seedRefundFailedCase(db);
  const remoteExistsWxpay = {
    ...wxpay,
    configOf: () => ({ mchId: 'merchant_test' }),
    hasApiConfig: () => true,
    queryRefund: async () => ({ status: 'PROCESSING', out_refund_no: 'RFT20261030TEST' }),
  };
  cancelPayment = loadPayment(db, { moduleStubs: { './lib/wxpay-v3': remoteExistsWxpay } });
  const remoteExistsCancel = await cancelPayment.main({
    action: 'afterSales.cancel',
    caseId: 'case_refund_failed_cancel',
  });
  eq(remoteExistsCancel.success, false, '远端已有退款单时拒绝取消异常售后');
  eq(
    db._dump(COLLECTIONS.AFTER_SALES_CASES)[0].status,
    CaseStatus.REFUND_FAILED,
    '远端已有退款单时保留异常售后状态'
  );

  db = createDb();
  seedRefundFailedCase(db);
  const timeoutWxpay = {
    ...wxpay,
    configOf: () => ({ mchId: 'merchant_test' }),
    hasApiConfig: () => true,
    queryRefund: async () => { throw new Error('退款查询超时'); },
  };
  cancelPayment = loadPayment(db, { moduleStubs: { './lib/wxpay-v3': timeoutWxpay } });
  const uncertainCancel = await cancelPayment.main({
    action: 'afterSales.cancel',
    caseId: 'case_refund_failed_cancel',
  });
  eq(uncertainCancel.success, false, '退款查询超时时拒绝取消');
  eq(
    db._dump(COLLECTIONS.AFTER_SALES_CASES)[0].status,
    CaseStatus.REFUND_FAILED,
    '无法确认退款记录时保持异常售后状态'
  );

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
  eq(await protectionMigrationCompleted(db), true, '迁移完成后写入全管理员共享的完成标记');
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
  eq(await protectionMigrationCompleted(db), true, '最后一批完成时写入完成标记');
  const repeated = await migrateProtectionBatch(db);
  eq(repeated.alreadyCompleted, true, '完成后重复调用直接返回，不再改写用户额度');
  eq(
    db._dump(COLLECTIONS.USERS).filter(u => u.protectionMigratedAt).length,
    55,
    '同一 createdAt 的 55 人全部被迁移'
  );

  console.log('\n=== 9. 名额账本迁移 dryRun、历史 5 个与新 10 个混算 ===');
  db = createDb();
  db._seed(COLLECTIONS.USERS, [
    {
      _id: 'ledger_u1', openId: 'ledger_openid_1',
      taskPackCount: 2, taskPackSlots: null,
    },
    {
      _id: 'ledger_u2', openId: 'ledger_openid_2',
      taskPackCount: 1,
    },
    {
      _id: 'ledger_u3', openId: 'ledger_openid_3',
      taskPackCount: 0, taskPackSlots: 0,
    },
  ]);
  db._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'ledger_old_pack', userId: 'ledger_openid_1', packageId: 'task_pack_5',
      productType: 'TASK_PACK', status: OrderStatus.PAID, grantStatus: GrantStatus.GRANTED,
      refundStatus: RefundStatus.NONE, amountFen: 300,
      entitlementGrant: { taskPackDelta: 1, taskPackCountAdded: 1, appliedAt: new Date() },
    },
    {
      _id: 'ledger_new_pack', userId: 'ledger_openid_1', packageId: 'task_pack_5',
      productType: 'TASK_PACK', status: OrderStatus.PAID, grantStatus: GrantStatus.GRANTED,
      refundStatus: RefundStatus.NONE, amountFen: 300, addedSlots: 10,
      entitlementGrant: { taskPackDelta: 1, taskPackCountAdded: 1, taskPackSlotsAdded: 10, appliedAt: new Date() },
    },
    {
      _id: 'ledger_unknown_member', userId: 'ledger_openid_3', packageId: 'member',
      productType: 'MEMBER', status: OrderStatus.PAID, grantStatus: null,
      refundStatus: RefundStatus.NONE, amountFen: 300, memberDays: 30,
      entitlementGrant: null,
    },
  ]);
  const dryRun = await migrateEntitlementLedgerBatch(db, { dryRun: true });
  eq(dryRun.success, true, '名额账本 dryRun 执行成功');
  eq(dryRun.updated, 0, 'dryRun 不写用户');
  const dryDiff = dryRun.diffs.find(item => item.userDocumentId === 'ledger_u1');
  eq(JSON.stringify(dryDiff.after), JSON.stringify({ taskPackCount: 2, taskPackSlots: 15 }),
    '历史包按 5 个、新包按 10 个混合累计');
  eq(db._dump(COLLECTIONS.USERS).find(item => item._id === 'ledger_u1').taskPackSlots == null,
    true, 'dryRun 不修改用户账本字段');
  eq(db._dump(COLLECTIONS.AFTER_SALES_CASES).length, 0, 'dryRun 不创建人工售后');

  const ledgerMigrated = await migrateEntitlementLedgerBatch(db);
  eq(ledgerMigrated.updated, 3, '正式迁移更新全部批次用户');
  const ledgerUser1 = db._dump(COLLECTIONS.USERS).find(item => item._id === 'ledger_u1');
  const ledgerUser2 = db._dump(COLLECTIONS.USERS).find(item => item._id === 'ledger_u2');
  eq(ledgerUser1.taskPackCount, 2, '迁移保留包数');
  eq(ledgerUser1.taskPackSlots, 15, '迁移写入混合名额总数');
  eq(ledgerUser2.taskPackCount, 1, '缺订单的历史用户保留原包数');
  eq(ledgerUser2.taskPackSlots, 5, '历史包最低按每包 5 个保护');
  eq(!!ledgerUser1.entitlementLedgerMigratedAt, true, '用户写入迁移版本时间');
  const oldPack = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ledger_old_pack');
  eq(oldPack.entitlementGrant.legacyBackfill, true, '可确认的历史发放订单标记 legacyBackfill');
  const unknownOrder = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ledger_unknown_member');
  eq(unknownOrder.grantReviewRequired, true, '无法确认发放状态的历史订单进入人工核查');
  eq(db._dump(COLLECTIONS.AFTER_SALES_CASES).some(item => item.orderId === 'ledger_unknown_member'),
    true, '人工核查订单生成售后工作台记录');
  eq(await entitlementMigrationCompleted(db), true, '最后一批写入名额账本迁移完成标记');

  const repeatedLedger = await migrateEntitlementLedgerBatch(db);
  eq(repeatedLedger.alreadyCompleted, true, '名额账本迁移完成后重复调用不改写数据');

  console.log('\n=== 10. 名额账本 dryRun 游标覆盖超过 100 人 ===');
  db = createDb();
  db._seed(COLLECTIONS.USERS, Array.from({ length: 105 }, (_, i) => ({
    _id: `ledger_batch_${String(i).padStart(3, '0')}`,
    openId: `ledger_batch_openid_${i}`,
    taskPackCount: 0,
    taskPackSlots: 0,
  })));
  const ledgerBatch1 = await migrateEntitlementLedgerBatch(db, { dryRun: true });
  const ledgerBatch2 = await migrateEntitlementLedgerBatch(db, {
    cursor: ledgerBatch1.nextCursor,
    dryRun: true,
  });
  const ledgerBatch3 = await migrateEntitlementLedgerBatch(db, {
    cursor: ledgerBatch2.nextCursor,
    dryRun: true,
  });
  eq(ledgerBatch1.scanned, 50, 'dryRun 第一批扫描 50 人');
  eq(ledgerBatch2.scanned, 50, 'dryRun 第二批扫描 50 人');
  eq(ledgerBatch3.scanned, 5, 'dryRun 第三批扫描剩余 5 人');
  eq(ledgerBatch3.hasMore, false, 'dryRun 游标完整覆盖尾部用户');
  eq(await entitlementMigrationCompleted(db), false, 'dryRun 不写完成标记');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
