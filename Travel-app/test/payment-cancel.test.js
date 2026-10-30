/**
 * 取消订单：必须先查单确认未支付；查单校验失败时不得继续向微信关单。
 */
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const { COLLECTIONS, OrderStatus } = require('../cloudfunctions/payment/lib/schema');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', message, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', message, '=', a);
};

async function run() {
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_cancel',
    openId: 'openid_cancel',
    memberLevel: 'NORMAL',
    memberExpiresAt: null,
    taskPackCount: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_cancel',
    userId: 'openid_cancel',
    outTradeNo: 'TCANCEL001',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 200,
    memberDays: 30,
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  }]);

  let closeCalls = 0;
  let queryResult = {
    appid: 'wx05c160a589b97d76',
    mchid: '1900000000',
    out_trade_no: 'TCANCEL001',
    trade_state: 'NOTPAY',
  };
  const config = { appId: 'wx05c160a589b97d76', mchId: '1900000000' };
  const wxpayStub = {
    configOf: () => config,
    hasApiConfig: () => true,
    queryOrder: async () => queryResult,
    closeOrder: async () => { closeCalls += 1; return {}; },
    WxPayApiError: class WxPayApiError extends Error {},
  };
  const cloudStub = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_cancel' }),
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent) {
    const fromPaymentIndex = parent && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`);
    if (fromPaymentIndex && request === 'wx-server-sdk') return cloudStub;
    if (fromPaymentIndex && request === './lib/wxpay-v3') return wxpayStub;
    return originalLoad.apply(this, arguments);
  };
  let payment;
  try {
    payment = require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }

  console.log('=== 1. 查单确认未支付后才允许关单 ===');
  const closed = await payment.main({ action: 'cancel', orderId: 'order_cancel' });
  eq(closed.success, true, '未支付订单可取消');
  eq(closeCalls, 1, '查单成功后调用微信关单');
  eq(db._dump(COLLECTIONS.ORDERS)[0].status, OrderStatus.CLOSED, '本地订单置为 CLOSED');

  console.log('\n=== 2. 查单校验失败不得继续关单 ===');
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_cancel',
    userId: 'openid_cancel',
    outTradeNo: 'TCANCEL001',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 200,
    memberDays: 30,
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  }]);
  closeCalls = 0;
  queryResult = { ...queryResult, mchid: 'WRONG_MERCHANT' };
  const rejected = await payment.main({ action: 'cancel', orderId: 'order_cancel' });
  eq(rejected.success, false, '查单商户不匹配时取消失败');
  eq(closeCalls, 0, '校验异常时没有调用微信关单');
  eq(db._dump(COLLECTIONS.ORDERS)[0].status, OrderStatus.PENDING, '原订单仍保持待支付，等待人工/定时核查');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
