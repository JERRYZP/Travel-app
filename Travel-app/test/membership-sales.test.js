/**
 * 会员购买断路器：服务端闸门、管理切换和已支付链路隔离。
 *
 * 运行：node test/membership-sales.test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, OrderStatus, GrantStatus, MembershipSalesState,
} = require('../cloudfunctions/payment/lib/schema');
const reminderSchema = require('../cloudfunctions/reminder/lib/schema');
const membership = require('../cloudfunctions/reminder/lib/membership');
const reminderSales = require('../cloudfunctions/reminder/lib/membership-sales');
const paymentSales = require('../cloudfunctions/payment/lib/membership-sales');
const membershipEntry = require('../miniprogram/utils/membership-entry');
const reminderFlow = require('../miniprogram/utils/reminder-flow');

const USER = 'openid_sales_user';
const ADMIN = 'openid_sales_admin';
const NEW_PLAN = Object.freeze({ membershipCapabilities: Object.freeze(['unlimited-v3']) });
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

function loadPayment(db, openId) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: openId, SOURCE: 'wx_client' }; },
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
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;

  console.log('=== 1. 唯一配置与默认开放 ===');
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_sales_user',
    openId: USER,
    nickname: '销售测试用户',
    memberLevel: 'NORMAL',
    taskPackCount: 0,
  }]);
  const initial = await membership.status(db, USER, undefined, NEW_PLAN);
  eq(initial.sales.state, MembershipSalesState.OPEN, '缺少配置文档时默认开放');
  eq(initial.sales.purchaseEnabled, true, '默认允许购买');
  eq(initial.packages.find(item => item.id === 'member').available, true, '会员套餐默认可购买');
  eq(reminderSales.SALES_CONFIG_ID, paymentSales.SALES_CONFIG_ID, '两云函数使用同一配置文档 ID');
  eq(reminderSales.PAUSED_MESSAGE, paymentSales.PAUSED_MESSAGE, '两云函数使用同一停售提示');
  eq(reminderSales.UNKNOWN_MESSAGE, paymentSales.UNKNOWN_MESSAGE, '两云函数使用同一读取失败提示');
  eq(reminderSchema.COLLECTIONS.PAYMENT_CONFIG, 'payment_config', 'reminder 使用统一配置集合');

  console.log('\n=== 2. 创建订单和待支付发起支付被阻断 ===');
  const created = await membership.createOrder(db, USER, {
    packageId: 'member',
    requestId: 'req_sales_open_001',
    membershipCapabilities: ['unlimited-v3'],
  });
  eq(created.success, true, '开放时允许创建订单');
  await paymentSales.write(db, {
    state: MembershipSalesState.PAUSED,
    reason: '支付渠道异常',
    updatedBy: ADMIN,
  });
  const pausedStatus = await membership.status(db, USER, undefined, NEW_PLAN);
  eq(pausedStatus.sales.purchaseEnabled, false, '暂停后状态返回不可购买');
  eq(pausedStatus.packages.every(item => item.available === false), true, '暂停后所有套餐不可购买');
  const blockedOrder = await membership.createOrder(db, USER, {
    packageId: 'member',
    requestId: 'req_sales_paused_002',
    membershipCapabilities: ['unlimited-v3'],
  });
  eq(blockedOrder.success, false, '暂停后不能创建新订单');
  eq(blockedOrder.errorCode, 1032, '创建订单返回停售错误码');
  eq(db._dump(COLLECTIONS.ORDERS).length, 1, '停售请求没有写入第二笔订单');

  const pendingList = await membership.listOrders(db, USER);
  const pending = pendingList.items[0];
  eq(pending.actionFlags.canPay, false, '暂停后待支付订单不能继续支付');
  eq(pending.actionFlags.canCancel, true, '待支付订单仍可取消');
  eq(pending.actionFlags.canRebuy, false, '暂停后不能重新购买');

  const userPayment = loadPayment(db, USER);
  const blockedPayment = await userPayment.main({
    action: 'create',
    orderId: created.orderId,
  });
  eq(blockedPayment.success, false, '暂停后 payment.create 拒绝待支付订单');
  eq(blockedPayment.errorCode, 1032, '支付发起返回停售错误码');

  console.log('\n=== 3. 已支付订单查单不受停售影响 ===');
  await db.collection(COLLECTIONS.ORDERS).doc(created.orderId).update({
    data: {
      status: OrderStatus.PAID,
      grantStatus: GrantStatus.GRANTED,
      paidAt: new Date(),
      transactionId: 'wx_sales_paid_001',
      paymentProvider: 'WECHAT_PAY_V3',
    },
  });
  const queried = await userPayment.main({ action: 'query', orderId: created.orderId });
  eq(queried.success, true, '停售期间仍可查询已支付订单');
  eq(queried.entitlementStatus, 'PAID_GRANTED', '已支付权益状态保持可读');

  console.log('\n=== 4. 管理员切换、鉴权与审计 ===');
  const adminPayment = loadPayment(db, ADMIN);
  const adminStatus = await adminPayment.main({ action: 'afterSales.adminStatus' });
  eq(adminStatus.membershipSales.purchaseEnabled, false, '管理员可读取停售状态');
  eq(adminStatus.membershipSales.reason, '支付渠道异常', '管理员可读取停售原因');
  const denied = await userPayment.main({
    action: 'afterSales.adminSetMembershipSales',
    state: MembershipSalesState.PAUSED,
    reason: '越权',
  });
  eq(denied.errorCode, 1040, '非管理员不能切换会员购买');
  const resumed = await adminPayment.main({
    action: 'afterSales.adminSetMembershipSales',
    state: MembershipSalesState.OPEN,
    reason: '恢复会员购买',
  });
  eq(resumed.success, true, '管理员可恢复会员购买');
  eq(resumed.membershipSales.purchaseEnabled, true, '恢复后立即允许购买');
  const audits = db._dump(COLLECTIONS.ADMIN_AUDIT_LOGS);
  eq(audits.some(item => item.action === 'SET_MEMBERSHIP_SALES'), true, '切换动作写入审计日志');

  console.log('\n=== 5. 提醒入口暂停态 ===');
  const limit = membershipEntry.viewOf({
    errorCode: 1026,
    membership: pausedStatus.membership,
    taskLimit: {
      limit: pausedStatus.membership.taskLimit,
      used: pausedStatus.membership.taskUsed,
      remaining: pausedStatus.membership.taskRemaining,
      requested: 6,
      shortfall: 6,
    },
    packages: pausedStatus.packages,
    sales: pausedStatus.sales,
  });
  eq(limit.purchaseEnabled, false, '提醒入口消费服务端停售状态');
  eq(limit.packageId, '', '停售时不传可支付套餐');
  eq(limit.payText, '会员购买暂停中', '停售时按钮文案明确');
  eq(membershipEntry.payConfirmOf(limit), null, '停售时不生成支付确认单');
  const originalWx = global.wx;
  global.wx = { showToast() {} };
  const page = {
    data: {
      membershipLimit: limit,
      taskLimitPayConfirm: null,
      taskLimitPayButtonText: '',
      taskLimitPaying: false,
      taskLimitPayDisabled: false,
      taskLimitPayFeedback: '',
    },
    setData(patch) { Object.assign(this.data, patch); },
  };
  eq(reminderFlow.openTaskLimitPayment(page), false, '提醒浮层停售时不打开支付确认');
  eq(page.data.taskLimitPayDisabled, true, '提醒浮层停售时禁用支付按钮');
  global.wx = originalWx;

  const root = path.join(__dirname, '..');
  const membershipWxml = fs.readFileSync(
    path.join(root, 'miniprogram/pages/membership/membership.wxml'),
    'utf8'
  );
  eq(membershipWxml.includes('sales-paused-card'), true, '会员页展示停售说明');

  if (fail > 0) {
    console.error(`\n${fail} membership sales assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll membership sales tests passed.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
