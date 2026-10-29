/**
 * payment-test 独立支付探针：账号白名单、回调验签/解密，不访问数据库和微信网络。
 */
const crypto = require('crypto');
const Module = require('module');
const path = require('path');
const wxpay = require('../cloudfunctions/payment-test/lib/wxpay-v3');

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

function callbackRequest(platform, resource) {
  const body = JSON.stringify({
    id: 'EV-PROBE-20261029',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'probe-nonce';
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
      'Wechatpay-Serial': 'PUB_KEY_ID_PROBE_TEST',
    },
  };
}

async function run() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const apiV3Key = '0123456789abcdef0123456789abcdef';
  const allowed = 'oZ6IFxvYK1mKzBaehMcOPIl_CgN0';
  let currentOpenId = allowed;
  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    WECHAT_PAY_APP_ID: 'wx05c160a589b97d76',
    WECHAT_PAY_MCH_ID: '1900000000',
    WECHAT_PAY_SERIAL_NO: 'MERCHANT_SERIAL',
    WECHAT_PAY_PRIVATE_KEY: merchant.privateKey,
    WECHAT_PAY_API_V3_KEY: apiV3Key,
    WECHAT_PAY_NOTIFY_URL: 'https://example.com/payment/notify-test',
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID: 'PUB_KEY_ID_PROBE_TEST',
    PAYMENT_PROBE_AMOUNT_FEN: '1',
    PAYMENT_PROBE_ALLOWED_OPENIDS: allowed,
  });

  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    if (request === 'wx-server-sdk' && parent && parent.filename.endsWith(`${path.sep}payment-test${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        getWXContext() { return { OPENID: currentOpenId }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };

  let probe;
  try {
    probe = require('../cloudfunctions/payment-test/index.js');
  } finally {
    Module._load = originalLoad;
  }

  try {
    console.log('=== 1. 白名单与创建参数 ===');
    currentOpenId = 'openid_not_allowed';
    const denied = await probe.main({ action: 'create' });
    eq(denied.success, false, '非白名单账号被拒绝');
    eq(denied.errorCode, 403, '返回 403 测试账号错误');

    currentOpenId = allowed;
    wxpay.createJsapiOrder = async () => ({ prepay_id: 'wx-prepay-probe' });
    wxpay.signPayParams = () => ({
      timeStamp: '1700000000', nonceStr: 'n', package: 'prepay_id=wx-prepay-probe', signType: 'RSA', paySign: 's',
    });
    const created = await probe.main({ action: 'create' });
    eq(created.success, true, '白名单账号可创建测试支付参数');
    eq(created.amountFen, 1, '测试金额为 1 分');
    eq(created.payment.package, 'prepay_id=wx-prepay-probe', '返回 requestPayment package');

    console.log('\n=== 2. 微信服务器回调 ===');
    const transaction = {
      appid: 'wx05c160a589b97d76',
      mchid: '1900000000',
      out_trade_no: 'PTP20261029PROBE',
      transaction_id: '42000000000000000000000000000001',
      trade_state: 'SUCCESS',
      amount: { total: 1, currency: 'CNY' },
    };
    const response = await probe.main(callbackRequest(platform, encryptResource(transaction, apiV3Key)));
    eq(response.statusCode, 200, '合法支付回调返回 200');

    const wrongAmount = { ...transaction, amount: { total: 2, currency: 'CNY' } };
    const rejected = await probe.main(callbackRequest(platform, encryptResource(wrongAmount, apiV3Key)));
    eq(rejected.statusCode, 400, '金额不符的回调被拒绝');
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
