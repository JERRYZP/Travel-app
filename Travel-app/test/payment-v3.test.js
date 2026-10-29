/**
 * 微信支付 API v3：请求签名、支付参数、回调验签与资源解密。
 *
 * 使用临时 RSA 密钥和固定 AES 密钥，不连接微信支付网络。
 */
const crypto = require('crypto');
const wxpay = require('../cloudfunctions/payment/lib/wxpay-v3');
const { amountOf } = require('../cloudfunctions/payment/lib/order');

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

function verify(message, signature, publicKey) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(message, 'utf8');
  verifier.end();
  return verifier.verify(publicKey, signature, 'base64');
}

function sign(message, privateKey) {
  return crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
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

function run() {
  console.log('=== 1. API v3 商户请求签名 ===');
  const merchant = rsaPair();
  const body = '{"amount":{"total":200}}';
  const authorization = wxpay.authorizationHeader({
    method: 'POST',
    path: '/v3/pay/transactions/jsapi',
    body,
    mchId: '1900000000',
    serialNo: 'MERCHANT_SERIAL',
    privateKey: merchant.privateKey,
    timestamp: '1700000000',
    nonceStr: 'merchant-nonce',
  });
  eq(authorization.startsWith('WECHATPAY2-SHA256-RSA2048 '), true, '生成 v3 Authorization');
  const signature = authorization.match(/signature="([^"]+)"/)[1];
  eq(verify('POST\n/v3/pay/transactions/jsapi\n1700000000\nmerchant-nonce\n' + body + '\n', signature, merchant.publicKey), true, '请求签名可被商户公钥验证');
  eq(authorization.includes('serial_no="MERCHANT_SERIAL"'), true, 'Authorization 带证书序列号');

  console.log('\n=== 2. JSAPI 支付参数签名 ===');
  const payParams = wxpay.signPayParams({
    appId: 'wx05c160a589b97d76',
    prepayId: 'wx201410272009395522657a690389285100',
    privateKey: merchant.privateKey,
    timeStamp: '1700000000',
    nonceStr: 'pay-nonce',
  });
  eq(payParams.signType, 'RSA', 'paySign 使用 RSA');
  eq(payParams.package, 'prepay_id=wx201410272009395522657a690389285100', 'package 使用 prepay_id');
  eq(verify(
    'wx05c160a589b97d76\n1700000000\npay-nonce\nprepay_id=wx201410272009395522657a690389285100\n',
    payParams.paySign,
    merchant.publicKey
  ), true, '支付参数签名可验证');

  console.log('\n=== 3. 回调签名与时间窗 ===');
  const platform = rsaPair();
  const callbackBody = JSON.stringify({
    event_type: 'TRANSACTION.SUCCESS',
    resource: { algorithm: 'AEAD_AES_256_GCM' },
  });
  const callbackTimestamp = wxpay.timestampSeconds();
  const callbackNonce = 'callback-nonce';
  const callbackSignature = sign(
    `${callbackTimestamp}\n${callbackNonce}\n${callbackBody}\n`,
    platform.privateKey
  );
  const config = {
    platformPublicKey: platform.publicKey,
    platformPublicKeyId: 'PUB_KEY_ID_TEST',
    maxSkewSeconds: 300,
  };
  const callbackHeaders = {
    'Wechatpay-Timestamp': callbackTimestamp,
    'Wechatpay-Nonce': callbackNonce,
    'Wechatpay-Signature': callbackSignature,
    'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
  };
  eq(wxpay.verifyCallbackSignature({
    headers: callbackHeaders,
    body: callbackBody,
    config,
  }), true, '正确的回调签名通过');
  eq(wxpay.verifyCallbackSignature({
    headers: callbackHeaders,
    body: callbackBody.replace('SUCCESS', 'FAIL'),
    config,
  }), false, '篡改回调原文被拒绝');
  eq(wxpay.verifyCallbackSignature({
    headers: { ...callbackHeaders, 'Wechatpay-Serial': 'WRONG_ID' },
    body: callbackBody,
    config,
  }), false, '错误的微信支付公钥 ID 被拒绝');
  const missingSerialHeaders = { ...callbackHeaders };
  delete missingSerialHeaders['Wechatpay-Serial'];
  eq(wxpay.verifyCallbackSignature({
    headers: missingSerialHeaders,
    body: callbackBody,
    config,
  }), false, '缺少微信支付公钥 ID 被拒绝');

  console.log('\n=== 4. APIv3 回调资源解密与金额读取 ===');
  const apiV3Key = '0123456789abcdef0123456789abcdef';
  const transaction = {
    appid: 'wx05c160a589b97d76',
    mchid: '1900000000',
    out_trade_no: 'T20261029ABC',
    transaction_id: '42000000000000000000000000000000',
    trade_state: 'SUCCESS',
    amount: { total: 200, currency: 'CNY' },
  };
  const resource = encryptResource(transaction, apiV3Key);
  const decrypted = wxpay.decryptResource(resource, apiV3Key);
  eq(decrypted.transaction_id, transaction.transaction_id, '回调资源解密出微信交易号');
  eq(decrypted.trade_state, 'SUCCESS', '回调资源保留支付状态');
  eq(amountOf(decrypted), 200, 'amountOf 支持 v3 amount.total');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

try {
  run();
} catch (err) {
  console.error('测试异常:', err);
  process.exit(1);
}
