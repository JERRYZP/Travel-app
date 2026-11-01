/**
 * 退款 HTTP 回调：路由、验签、解密、权益回收和重复回调幂等。
 */
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, CaseStatus, RefundStatus, GrantStatus, OrderStatus,
} = require('../cloudfunctions/payment/lib/schema');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', message, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', message, '=', a);
};

function rsaPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function encryptResource(value, apiV3Key) {
  const associatedData = 'refund';
  const nonce = '123456789012';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    associated_data: associatedData,
    original_type: 'refund',
    nonce,
  };
}

function signedRequest(platform, resource) {
  const body = JSON.stringify({
    id: 'EV-REFUND-1',
    event_type: 'REFUND.SUCCESS',
    resource_type: 'encrypt-resource',
    resource,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'refund-callback-nonce';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`, 'utf8'),
    platform.privateKey
  ).toString('base64');
  return {
    path: '/payment/refund-notify',
    body,
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Signature': signature,
      'Wechatpay-Serial': 'PUB_KEY_ID_REFUND_TEST',
    },
  };
}

async function loadPayment(db) {
  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    if (request === 'wx-server-sdk' && parent && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: '' }; },
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
  const platform = rsaPair();
  const merchant = rsaPair();
  const apiV3Key = '0123456789abcdef0123456789abcdef';
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'u1', openId: 'openid_refund', memberLevel: 'MEMBER',
    memberExpiresAt: new Date(Date.now() + 30 * 86400000), taskPackCount: 1,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'o1', userId: 'openid_refund', outTradeNo: 'TREFUND001', packageId: 'member',
    productType: 'MEMBER', title: '会员 30 天', amountFen: 200,
    status: OrderStatus.PAID, grantStatus: GrantStatus.GRANTED, refundStatus: RefundStatus.PROCESSING,
    paidAt: new Date(), entitlementGrant: {
      memberDaysAddedMs: 30 * 86400000,
      taskPackDelta: 0,
      taskPackCountAdded: 0,
      taskPackSlotsAdded: 0,
      appliedAt: new Date(),
    },
  }]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'c1', caseNo: 'ASC1', userId: 'openid_refund', orderId: 'o1',
    outTradeNo: 'TREFUND001', outRefundNo: 'RFTREFUND001', title: '会员 30 天',
    amountFen: 200, type: 'UNUSED_REFUND', status: CaseStatus.PROCESSING,
    refundStatus: RefundStatus.PROCESSING, createdAt: new Date(),
  }]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    WECHAT_PAY_APP_ID: 'wx05c160a589b97d76',
    WECHAT_PAY_MCH_ID: '1900000000',
    WECHAT_PAY_SERIAL_NO: 'MERCHANT_SERIAL',
    WECHAT_PAY_PRIVATE_KEY: merchant.privateKey,
    WECHAT_PAY_API_V3_KEY: apiV3Key,
    WECHAT_PAY_NOTIFY_URL: 'https://example.com/payment/notify',
    WECHAT_PAY_REFUND_NOTIFY_URL: 'https://example.com/payment/refund-notify',
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID: 'PUB_KEY_ID_REFUND_TEST',
  });

  const payment = await loadPayment(db);
  const refund = {
    mchid: '1900000000',
    out_trade_no: 'TREFUND001',
    out_refund_no: 'RFTREFUND001',
    refund_id: '5030000000000000000000000001',
    refund_status: 'SUCCESS',
    success_time: new Date().toISOString(),
    amount: { total: 200, refund: 200, currency: 'CNY' },
  };
  const request = signedRequest(platform, encryptResource(refund, apiV3Key));

  try {
    const mismatch = signedRequest(platform, encryptResource({
      ...refund,
      out_trade_no: 'TWRONGORDER',
    }, apiV3Key));
    const rejected = await payment.main(mismatch);
    eq(rejected.statusCode, 500, '退款回调原商户订单号不一致时拒绝并让微信重试');
    eq(db._dump(COLLECTIONS.ORDERS)[0].refundStatus, RefundStatus.PROCESSING, '校验失败不推进退款状态');

    const response = await payment.main(request);
    eq(response.statusCode, 200, '合法退款回调返回 200');
    let order = db._dump(COLLECTIONS.ORDERS)[0];
    let user = db._dump(COLLECTIONS.USERS)[0];
    let item = db._dump(COLLECTIONS.AFTER_SALES_CASES)[0];
    eq(order.refundStatus, RefundStatus.REFUNDED, '订单独立退款状态为 REFUNDED');
    eq(order.status, OrderStatus.PAID, '订单主状态不改为 REFUNDED');
    eq(order.grantStatus, GrantStatus.REVERTED, '本单权益标记已回收');
    eq(item.status, CaseStatus.REFUNDED, '售后单标记已退款');
    eq(user.taskPackCount, 1, '会员退款不回收无关的任务包');

    const again = await payment.main(request);
    eq(again.statusCode, 200, '重复退款回调仍返回 200');
    order = db._dump(COLLECTIONS.ORDERS)[0];
    user = db._dump(COLLECTIONS.USERS)[0];
    eq(order.grantStatus, GrantStatus.REVERTED, '重复回调不改变已回收状态');
    eq(user.taskPackCount, 1, '重复回调不会再次扣减无关任务包');

    const tampered = { ...request, path: '/unknown/refund-notify', body: request.body.replace('SUCCESS', 'ABNORMAL') };
    const notFound = await payment.main(tampered);
    eq(notFound.statusCode, 404, '未知退款路由不能按请求体猜路由');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
