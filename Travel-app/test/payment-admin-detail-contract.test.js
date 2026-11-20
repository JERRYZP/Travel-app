/**
 * 客服工作台售后详情真实入口契约。
 *
 * 该测试必须经过 payment.main -> afterSales.adminDetail -> adminCaseBundle，
 * 用于防止“领域函数测试通过，但云函数入口漏依赖/漏导出，线上直接 1500”。
 */
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, CaseStatus, GrantStatus, OrderStatus, RefundStatus,
} = require('../cloudfunctions/payment/lib/schema');
const afterSales = require('../cloudfunctions/payment/lib/after-sales');

const ADMIN = 'openid_after_sales_contract_admin';
const USER = 'openid_after_sales_contract_user';

let fail = 0;
function eq(actual, expected, message) {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
}

function seed(db) {
  const now = Date.now();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_contract',
    openId: USER,
    nickname: '契约用户',
    memberExpiresAt: new Date(now + 30 * 86400000),
    memberTier: 'UNLIMITED',
    taskPackCount: 0,
    taskPackSlots: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_contract',
    userId: USER,
    outTradeNo: 'TCONTRACT001',
    packageId: 'member_unlimited_upgrade',
    productType: 'MEMBER',
    title: '升级不限提醒名额',
    amountFen: 190,
    status: OrderStatus.PAID,
    grantStatus: GrantStatus.GRANTED,
    refundStatus: RefundStatus.UNDER_REVIEW,
    paymentProvider: 'VIRTUAL_PAY',
    paymentResult: { tradeState: 'SUCCESS', amountFen: 190 },
    entitlementGrant: {
      memberDaysAddedMs: 0,
      taskPackDelta: 0,
      beforeTierOrderId: 'order_base_contract',
      appliedAt: new Date(now - 3500000),
    },
    createdAt: new Date(now - 3700000),
    paidAt: new Date(now - 3600000),
  }]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'case_contract',
    caseNo: 'ASCONTRACT001',
    userId: USER,
    orderId: 'order_contract',
    outTradeNo: 'TCONTRACT001',
    title: '升级不限提醒名额',
    amountFen: 190,
    type: 'UNUSED_REFUND',
    status: CaseStatus.UNDER_REVIEW,
    refundStatus: RefundStatus.UNDER_REVIEW,
    createdAt: new Date(now - 1800000),
  }]);
}

function loadPayment(db) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (request === 'fast-xml-parser' && parent && parent.filename.includes(`${path.sep}payment${path.sep}`)) {
      return { XMLParser: class XMLParser {} };
    }
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: ADMIN, SOURCE: 'wx_client' }; },
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
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;
  eq(typeof afterSales.refundEligibilityForOrder, 'function',
    '售后台账导出退款资格聚合函数');

  const db = createDb();
  seed(db);
  const payment = loadPayment(db);
  const result = await payment.main({
    action: 'afterSales.adminDetail',
    caseId: 'case_contract',
  }, { OPENID: ADMIN, SOURCE: 'wx_client' });

  eq(result.success, true, '真实售后详情入口返回成功');
  eq(result.case && result.case.caseNo, 'ASCONTRACT001', '返回目标售后单');
  eq(result.case && result.case.status, CaseStatus.UNDER_REVIEW, '保留客服审核中状态');
  eq(result.actionCapabilities && result.actionCapabilities.canApproveRefund, true,
    '允许同意全额退款');
  eq(result.actionCapabilities && result.actionCapabilities.canReject, true,
    '允许驳回申请');

  if (fail > 0) {
    console.error(`\n${fail} payment admin detail contract assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll payment admin detail contract tests passed.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
