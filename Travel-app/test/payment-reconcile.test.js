/**
 * 支付补偿游标：每个队列独立持久化，超过单批上限后继续处理尾部记录。
 */
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, OrderStatus, GrantStatus, RefundStatus, CaseStatus,
} = require('../cloudfunctions/payment/lib/schema');

let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

function loadPayment(db) {
  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return {}; },
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
  // 真实云数据库对不存在的 doc.get 会抛错；游标首次运行必须能创建状态文档。
  const db = createDb({ cloudGetOnMissing: true });
  db._seed(COLLECTIONS.ORDERS, [
    ...Array.from({ length: 120 }, (_, index) => ({
      _id: `failed_${String(index).padStart(3, '0')}`,
      status: OrderStatus.PAID,
      grantStatus: GrantStatus.FAILED,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      _id: `pending_${String(index).padStart(3, '0')}`,
      status: OrderStatus.PENDING,
      grantStatus: GrantStatus.NONE,
    })),
  ]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, Array.from({ length: 4 }, (_, index) => ({
    _id: `auto_${String(index).padStart(3, '0')}`,
    status: CaseStatus.AUTO_CHECKING,
  })));

  const payment = loadPayment(db);
  const runQueue = payment._test.runReconcileQueue;
  eq(typeof runQueue, 'function', '补偿队列执行器可单独回归测试');

  const failedIds = [];
  const pendingIds = [];
  const autoIds = [];
  const invoke = (queue, where, target) => runQueue({
    queue,
    where,
    deadline: Date.now() + 30000,
    queueBudgetMs: 5000,
    batchSize: 50,
    now: Date.now,
    handle: async item => {
      target.push(item._id);
      return { success: true, updated: true };
    },
  });

  console.log('=== 1. 超过 100 条积压仍处理尾部 ===');
  const failed1 = await invoke('failedGrants', {
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.FAILED,
  }, failedIds);
  const pendingResult = await invoke('pendingPayments', {
    status: OrderStatus.PENDING,
  }, pendingIds);
  const failed2 = await invoke('failedGrants', {
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.FAILED,
  }, failedIds);
  const failed3 = await invoke('failedGrants', {
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.FAILED,
  }, failedIds);
  eq(failed1.scanned, 50, '异常发放队列第一批处理 50 条');
  eq(failed2.scanned, 50, '第二部分继续处理 50 条');
  eq(failed3.scanned, 20, '第三部分处理最后 20 条');
  eq(new Set(failedIds).size, 120, '连续触发覆盖全部 120 条尾部记录');
  eq(failedIds.includes('failed_119'), true, '最大 _id 的尾部记录不会永久饥饿');
  eq(pendingResult.scanned, 3, '待支付队列未被异常发放游标干扰');
  eq(new Set(pendingIds).size, 3, '独立队列完整处理自己的记录');
  const failedState = db._dump(COLLECTIONS.PAYMENT_RECONCILE_STATE)
    .find(item => item._id === 'failedGrants');
  const pendingState = db._dump(COLLECTIONS.PAYMENT_RECONCILE_STATE)
    .find(item => item._id === 'pendingPayments');
  eq(failedState.cursor, null, '完整轮转后异常发放游标回到队首');
  eq(failedState.round, 1, '完成一轮后轮次加一');
  eq(pendingState.round, 1, '待支付队列维护自己的轮次');

  console.log('\n=== 2. 售后补偿队列独立游标 ===');
  const auto1 = await invoke('autoChecking', {
    status: CaseStatus.AUTO_CHECKING,
  }, autoIds);
  const auto2 = await invoke('autoChecking', {
    status: CaseStatus.AUTO_CHECKING,
  }, autoIds);
  eq(auto1.scanned, 4, '自动核验队列一次处理全部小积压');
  eq(auto2.scanned, 4, '队列完成后下一轮从队首重新检查');
  eq(new Set(autoIds).size, 4, '同一轮内不重复越界扫描');
  eq(autoIds.length, 8, '后续轮次可再次扫描仍待处理记录');

  console.log('\n=== 3. 游标集合缺失时自动创建并继续 ===');
  const missingStateDb = createDb({
    cloudGetOnMissing: true,
    missingCollections: [COLLECTIONS.PAYMENT_RECONCILE_STATE],
  });
  missingStateDb._seed(COLLECTIONS.ORDERS, [{
    _id: 'failed_missing_state',
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.FAILED,
  }]);
  const missingStatePayment = loadPayment(missingStateDb);
  const missingStateIds = [];
  const missingStateResult = await missingStatePayment._test.runReconcileQueue({
    queue: 'failedGrants',
    where: { status: OrderStatus.PAID, grantStatus: GrantStatus.FAILED },
    deadline: Date.now() + 30000,
    queueBudgetMs: 5000,
    batchSize: 50,
    now: Date.now,
    handle: async item => {
      missingStateIds.push(item._id);
      return { success: true, updated: true };
    },
  });
  eq(missingStateResult.scanned, 1, '游标集合首次缺失不影响本批处理');
  eq(missingStateResult.cursorSaved, true, '自动创建集合后游标成功落库');
  eq(missingStateDb._size(COLLECTIONS.PAYMENT_RECONCILE_STATE), 1,
    '上游游标文档已在缺失集合中自动创建');

  console.log('\n=== 4. 游标存储不可用时降级且不阻断处理 ===');
  const degradedStateDb = createDb({
    cloudGetOnMissing: true,
    missingCollections: [COLLECTIONS.PAYMENT_RECONCILE_STATE],
  });
  degradedStateDb._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'refund_degraded_001',
    status: CaseStatus.PROCESSING,
  }]);
  degradedStateDb.createCollection = async () => {
    throw new Error('createCollection permission denied');
  };
  const degradedStatePayment = loadPayment(degradedStateDb);
  const degradedIds = [];
  const degradedStateResult = await degradedStatePayment._test.runReconcileQueue({
    queue: 'refundProcessing',
    where: { status: CaseStatus.PROCESSING },
    deadline: Date.now() + 30000,
    queueBudgetMs: 5000,
    batchSize: 50,
    now: Date.now,
    handle: async item => {
      degradedIds.push(item._id);
      return { success: true, updated: true };
    },
  });
  eq(degradedStateResult.scanned, 1, '无法创建游标集合时仍扫描退款记录');
  eq(degradedStateResult.updated, 1, '无法持久化游标时仍完成退款处理');
  eq(degradedStateResult.cursorSaved, false, '游标存储失败明确返回 false');
  eq(degradedIds[0], 'refund_degraded_001', '退款记录实际进入处理器');

  console.log('\n=== 5. 单个补偿队列失败不阻断退款队列 ===');
  const isolatedDb = createDb({ missingCollections: [COLLECTIONS.ORDERS] });
  isolatedDb._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'not_due',
    status: CaseStatus.SUBMITTED,
  }]);
  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    WECHAT_APP_ID: 'wx_test',
    WECHAT_APP_SECRET: 'test_secret',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'test_offer',
    WECHAT_VIRTUAL_PAY_APP_KEY: 'test_app_key',
  });
  try {
    const isolatedPayment = loadPayment(isolatedDb);
    const isolatedResult = await isolatedPayment._test.reconcile({
      batchSize: 50,
      totalBudgetMs: 30000,
      queueBudgetMs: 5000,
    });
    eq(isolatedResult.success, true, '补偿总任务在单队列异常时仍返回结果');
    eq(isolatedResult.queues.failedGrants.errors, 1,
      '订单集合异常被限制在异常发放队列');
    eq(Object.prototype.hasOwnProperty.call(isolatedResult.queues, 'refundProcessing'), true,
      '后续退款处理队列仍被执行');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }

  console.log('\n=== 6. 退款查询成功后同时收口订单与售后状态 ===');
  const refundDb = createDb({ cloudGetOnMissing: true });
  refundDb._seed(COLLECTIONS.ORDERS, [{
    _id: 'refund_order_status',
    outTradeNo: 'TREFUNDSTATUS001',
    amountFen: 300,
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.FAILED,
    refundStatus: RefundStatus.PROCESSING,
  }]);
  refundDb._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'refund_case_status',
    orderId: 'refund_order_status',
    outRefundNo: 'RFTREFUNDSTATUS001',
    amountFen: 300,
    status: CaseStatus.PROCESSING,
    refundStatus: RefundStatus.PROCESSING,
  }]);
  const refundPayment = loadPayment(refundDb);
  const refundApplied = await refundPayment._test.applyRefundResult(
    refundDb._dump(COLLECTIONS.AFTER_SALES_CASES)[0],
    {
      refund_status: 'SUCCESS',
      out_trade_no: 'TREFUNDSTATUS001',
      out_refund_no: 'RFTREFUNDSTATUS001',
      refund_id: 'wx_refund_status_001',
      amount: { total: 300, refund: 300 },
    },
    'refund_query'
  );
  eq(refundApplied.success, true, '退款查单成功结果可落库');
  eq(refundDb._dump(COLLECTIONS.ORDERS)[0].refundStatus, RefundStatus.REFUNDED,
    '退款查单成功后订单状态更新为 REFUNDED');
  eq(refundDb._dump(COLLECTIONS.AFTER_SALES_CASES)[0].status, CaseStatus.REFUNDED,
    '退款查单成功后售后单状态更新为 REFUNDED');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
