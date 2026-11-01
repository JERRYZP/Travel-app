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
const createPayloads = [];
let queryCount = 0;
let paymentMode = 'success';
let queryMode = 'normal';
let createResponse = null;
let virtualCalls = 0;
let classicCalls = 0;
let loginCalls = 0;
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
    create(payload) {
      calls.push('create');
      createPayloads.push(payload);
      return Promise.resolve(createResponse || { payment: { paySign: 'x' } });
    },
    query() {
      calls.push('query');
      queryCount += 1;
      if (queryMode === 'flaky' && queryCount === 1) {
        return Promise.reject({ errorCode: 1023, error: '模拟网络抖动' });
      }
      if (queryMode === 'unknown') {
        return Promise.resolve({
          status: 'PAID',
          entitlementStatus: 'PAID_GRANT_UNKNOWN',
        });
      }
      return Promise.resolve(queryCount >= 2
        ? {
          status: 'PAID',
          entitlementStatus: 'PAID_GRANTED',
          memberExpiresAt: '2026-12-01T00:00:00.000Z',
          taskPackSlots: 0,
        }
        : { status: 'PENDING', entitlementStatus: 'PENDING' });
    },
  },
};

global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  login(opts) {
    loginCalls += 1;
    opts.success({ code: 'login-code-1' });
  },
  requestPayment(opts) {
    classicCalls += 1;
    if (paymentMode === 'cancel') {
      opts.fail({ errMsg: 'requestPayment:fail cancel' });
      return;
    }
    opts.success({ errMsg: 'requestPayment:ok' });
  },
  requestVirtualPayment(opts) {
    virtualCalls += 1;
    if (paymentMode === 'virtual-cancel') {
      opts.fail({ errMsg: 'requestVirtualPayment:fail cancel' });
      return;
    }
    if (paymentMode === 'virtual-cancel-code') {
      opts.fail({ errMsg: 'requestVirtualPayment:fail', errCode: -2 });
      return;
    }
    opts.success({ errMsg: 'requestVirtualPayment:ok' });
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
  eq(classicCalls, 1, '旧通道继续使用 wx.requestPayment');
  eq(createPayloads[0].loginCode, 'login-code-1', '支付前取得 wx.login code，旧通道可安全忽略');
  eq(createPayloads[0].clientSupportsVirtualPay, true, '新版客户端声明支持虚拟支付');

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

  console.log('\n=== 3b. 权益状态未知时保留订单供前台继续核验 ===');
  calls.length = 0;
  queryCount = 0;
  queryMode = 'unknown';
  result = await membershipPay.purchase('member');
  eq(result.status, 'PAID_GRANT_UNKNOWN', '服务端未知发放状态不会被当做到账');
  eq(membershipPay.pendingOrder() && membershipPay.pendingOrder().orderId, 'order_1',
    '未知发放状态保留本地待确认订单');
  queryMode = 'normal';
  membershipPay.clearPendingOrder('order_1');

  console.log('\n=== 4. 服务端返回虚拟支付参数时使用 wx.requestVirtualPayment ===');
  calls.length = 0;
  queryCount = 0;
  paymentMode = 'success';
  const classicBeforeVirtual = classicCalls;
  createResponse = {
    paymentProvider: 'VIRTUAL_PAY',
    virtualPayment: {
      mode: 'short_series_goods',
      signData: '{"offerId":"offer"}',
      paySig: 'pay-sig',
      signature: 'user-signature',
    },
  };
  result = await membershipPay.purchase('member');
  eq(result.status, 'PAID_GRANTED', '虚拟支付仍以服务端查单结果为权益依据');
  eq(virtualCalls, 1, '虚拟支付通道调用 wx.requestVirtualPayment');
  eq(classicCalls, classicBeforeVirtual, '虚拟支付不会误走 wx.requestPayment');
  eq(calls.join(','), 'createOrder,create,query,query', '两个通道共用支付后查单流程');
  eq(createPayloads[createPayloads.length - 1].loginCode, 'login-code-1', '虚拟支付把一次性登录 code 交给云端换 session_key');
  eq(createPayloads[createPayloads.length - 1].clientSupportsVirtualPay, true,
    '虚拟支付请求显式声明客户端能力');
  eq(loginCalls, 5, '每次支付尝试都会刷新一次性 login code');

  console.log('\n=== 5. 虚拟支付按官方错误码识别用户取消 ===');
  calls.length = 0;
  queryCount = 0;
  paymentMode = 'virtual-cancel-code';
  cancelled = false;
  try {
    await membershipPay.purchase('member');
  } catch (err) {
    cancelled = !!(err && err.cancelled);
  }
  eq(cancelled, true, 'errCode=-2 时识别为支付取消');
  eq(calls.join(','), 'createOrder,create', '按错误码取消后不误查支付结果');

  paymentMode = 'success';
  createResponse = null;

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
