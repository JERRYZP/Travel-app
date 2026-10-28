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
      return Promise.resolve(queryCount >= 2 ? { status: 'PAID' } : { status: 'PENDING' });
    },
  },
};

global.wx = {
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
  eq(result.membership.member, true, '权益刷新后返回会员状态');
  eq(calls.join(','), 'createOrder,create,query,query,status', '客户端付款后先查单，权益最后确认');

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

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
