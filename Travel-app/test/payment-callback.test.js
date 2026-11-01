/**
 * payment 云函数 HTTP 回调集成：HTTP 网关原始 body -> 验签 -> 解密 -> 发放权益。
 */
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const { COLLECTIONS, OrderStatus, CaseStatus, RefundStatus, GrantStatus } = require('../cloudfunctions/payment/lib/schema');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};

function rsaPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function encryptResource(transaction, apiV3Key) {
  const associatedData = 'transaction';
  const nonce = '123456789012';
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8')
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(transaction), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    associated_data: associatedData,
    original_type: 'transaction',
    nonce,
  };
}

function callbackRequest(platform, resource, bodyExtra = {}) {
  const body = JSON.stringify({
    id: 'EV-20261029',
    create_time: '2026-10-29T23:30:00+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    summary: '支付成功',
    resource,
    ...bodyExtra,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'callback-nonce';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`, 'utf8'),
    platform.privateKey
  ).toString('base64');
  return {
    body,
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Signature': signature,
      'Wechatpay-Serial': 'PUB_KEY_ID_CALLBACK_TEST',
    },
  };
}

async function main() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const apiV3Key = '0123456789abcdef0123456789abcdef';
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_callback_001',
    openId: 'openid_callback_001',
    memberLevel: 'NORMAL',
    memberExpiresAt: null,
    taskPackCount: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_callback_001',
    userId: 'openid_callback_001',
    outTradeNo: 'T20261029CALLBACK',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    body: '智序准点游-会员 30 天',
    amountFen: 200,
    memberDays: 30,
    memberFloorDays: 0,
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    paidAt: null,
  }]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    WECHAT_PAY_APP_ID: 'wx05c160a589b97d76',
    WECHAT_PAY_MCH_ID: '1900000000',
    WECHAT_PAY_SERIAL_NO: 'MERCHANT_SERIAL',
    WECHAT_PAY_PRIVATE_KEY: merchant.privateKey,
    WECHAT_PAY_API_V3_KEY: apiV3Key,
    WECHAT_PAY_NOTIFY_URL: 'https://example.com/payment/notify',
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID: 'PUB_KEY_ID_CALLBACK_TEST',
    WECHAT_PAY_CALLBACK_MAX_SKEW_SECONDS: '300',
  });

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

  let payment;
  try {
    payment = require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }

  try {
    const transaction = {
      appid: 'wx05c160a589b97d76',
      mchid: '1900000000',
      out_trade_no: 'T20261029CALLBACK',
      transaction_id: '42000000000000000000000000000000',
      trade_state: 'SUCCESS',
      amount: { total: 200, currency: 'CNY' },
    };
    const resource = encryptResource(transaction, apiV3Key);
    const request = callbackRequest(platform, resource);
    const response = await payment.main(request);
    const responseBody = JSON.parse(response.body);
    eq(response.statusCode, 200, '合法回调返回 HTTP 200');
    eq(responseBody.code, 'SUCCESS', '合法回调返回 SUCCESS');
    const order = db._dump(COLLECTIONS.ORDERS)[0];
    const user = db._dump(COLLECTIONS.USERS)[0];
    eq(order.status, OrderStatus.PAID, '订单由回调置为 PAID');
    eq(order.transactionId, transaction.transaction_id, '订单保存微信交易号');
    eq(order.paymentResult.amountFen, 200, 'paymentResult 只保存最小审计字段');
    eq(user.memberLevel, 'MEMBER', '用户获得会员');

    db._seed(COLLECTIONS.USERS, [{
      _id: 'user_callback_grant_failed',
      openId: 'openid_callback_grant_failed',
      memberLevel: 'NORMAL',
      memberExpiresAt: null,
      taskPackCount: 0,
    }]);
    db._seed(COLLECTIONS.ORDERS, [{
      _id: 'order_callback_grant_failed',
      userId: 'openid_callback_grant_failed',
      outTradeNo: 'T20261029GRANTFAILED',
      packageId: 'member',
      productType: 'MEMBER',
      title: '会员 30 天',
      body: '智序准点游-会员 30 天',
      amountFen: 200,
      memberDays: 30,
      memberFloorDays: 0,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      paidAt: null,
    }]);
    const originalStartTransaction = db.startTransaction;
    db.startTransaction = async () => {
      const tx = await originalStartTransaction();
      const originalCollection = tx.collection.bind(tx);
      tx.collection = (name) => {
        const collection = originalCollection(name);
        if (name !== COLLECTIONS.USERS) return collection;
        return {
          ...collection,
          doc: (id) => {
            const base = collection.doc(id);
            return {
              ...base,
              update: async ({ data }) => {
                if (Object.prototype.hasOwnProperty.call(data || {}, 'memberExpiresAt')) {
                  throw new Error('模拟权益写入失败');
                }
                return base.update({ data });
              },
            };
          },
        };
      };
      return tx;
    };
    const failedTransaction = {
      ...transaction,
      out_trade_no: 'T20261029GRANTFAILED',
      transaction_id: '42000000000000000000000000000002',
    };
    const failedResponse = await payment.main(callbackRequest(
      platform,
      encryptResource(failedTransaction, apiV3Key)
    ));
    db.startTransaction = originalStartTransaction;
    eq(failedResponse.statusCode, 500, '权益发放事务失败时返回 5xx 让微信重试');
    const failedOrder = db._dump(COLLECTIONS.ORDERS)
      .find(item => item._id === 'order_callback_grant_failed');
    const grantCase = db._dump(COLLECTIONS.AFTER_SALES_CASES)
      .find(item => item.orderId === failedOrder._id);
    eq(failedOrder.status, OrderStatus.PAID, '支付已确认的订单不回到 PENDING');
    eq(failedOrder.grantStatus, GrantStatus.FAILED, '权益发放失败单独标记');
    eq(failedOrder.refundStatus, RefundStatus.NONE, '补发异常不污染退款生命周期');
    eq(!!grantCase, true, '权益发放失败自动生成售后单');
    eq(grantCase && grantCase.status, CaseStatus.AUTO_CHECKING, '权益异常进入自动核验队列');
    eq(grantCase && grantCase.priority, 'HIGH', '权益异常为高优先级');

    const tampered = { ...request, body: request.body.replace('支付成功', '支付成功 ') };
    const rejected = await payment.main(tampered);
    eq(rejected.statusCode, 401, '篡改原始 body 的 HTTP 回调被拒绝');
    const badResource = await payment.main(callbackRequest(platform, {
      ...resource,
      ciphertext: 'AAAA',
    }));
    eq(badResource.statusCode, 500, '签名有效但资源无法解密时返回 5xx 让微信重试');
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
