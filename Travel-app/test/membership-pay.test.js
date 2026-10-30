/**
 * 会员支付客户端流程：requestPayment 成功后仍以服务端查单/权益为准。
 *
 * 运行：node test/membership-pay.test.js
 */
const Module = require('module');
const path = require('path');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const calls = [];
let queryCount = 0;
let paymentMode = 'success';
let queryMode = 'normal';
const storage = {};

const apiStub = {
  reminder: {
    membership: {
      createOrder() {
        calls.push('createOrder');
        return Promise.resolve({ orderId: 'order_1' });
      },
      status() {
        calls.push('status');
        return Promise.resolve({ success: true, membership: { member: true } });
      },
    },
  },
  payment: {
    create() {
      calls.push('create');
      return Promise.resolve({ payment: { paySign: 'x' } });
    },
    query() {
      calls.push('query');
      queryCount += 1;
      if (queryMode === 'flaky' && queryCount === 1) {
        return Promise.reject({ errorCode: 1023, error: '模拟网络抖动' });
      }
      return Promise.resolve(queryCount >= 2 ? { status: 'PAID' } : { status: 'PENDING' });
    },
  },
};

global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  requestPayment(opts) {
    if (paymentMode === 'cancel') {
      opts.fail({ errMsg: 'requestPayment:fail cancel' });
      return;
    }
    opts.success({ errMsg: 'requestPayment:ok' });
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent) {
  if (request === './api.js' && parent && parent.filename.endsWith(`${path.sep}membership-pay.js`)) {
    return apiStub;
  }
  return originalLoad.apply(this, arguments);
};
const membershipPay = require('../miniprogram/utils/membership-pay.js');
Module._load = originalLoad;

async function run() {
  console.log('=== 1. 支付成功仍需查单 ===');
  calls.length = 0;
  queryCount = 0;
  let result = await membershipPay.purchase('member');
  eq(result.status, 'PAID_GRANTED', '服务端确认后返回持久权益状态');
  eq(calls.join(','), 'createOrder,create,query,query', '客户端付款后先查单，不再用 Toast 代替权益状态');
  eq(membershipPay.pendingOrder(), null, '权益到账后清除本地待确认订单');

  console.log('\n=== 2. 用户取消支付不查单、不刷新权益 ===');
  calls.length = 0;
  queryCount = 0;
  paymentMode = 'cancel';
  let cancelled = false;
  try {
    await membershipPay.purchase('member');
  } catch (err) {
    cancelled = !!(err && err.cancelled);
  }
  eq(cancelled, true, '返回取消标记');
  eq(calls.join(','), 'createOrder,create', '取消后不查单、不发权益');
  eq(membershipPay.pendingOrder() && membershipPay.pendingOrder().orderId, 'order_1', '取消后保留订单供恢复与继续支付');

  console.log('\n=== 3. 支付成功后的单次查单抖动不伪装成支付失败 ===');
  calls.length = 0;
  queryCount = 0;
  paymentMode = 'success';
  queryMode = 'flaky';
  result = await membershipPay.purchase('member');
  eq(result.status, 'PAID_GRANTED', '查单抖动后继续轮询并收敛到已到账');
  eq(queryCount, 2, '第一次查询失败后仍会重试');
  eq(membershipPay.pendingOrder(), null, '最终到账后清除待确认订单');
  queryMode = 'normal';

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
