/**
 * 微信支付 API v3 的纯 Node 实现。
 *
 * 这里只负责协议层：商户请求签名、JSAPI 支付参数、查单、回调验签与
 * 回调资源解密。订单状态和会员权益仍由 ./order.js 处理。
 */

const crypto = require('crypto');
const https = require('https');

const API_HOST = 'api.mch.weixin.qq.com';
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_MAX_SKEW_SECONDS = 300;

class WxPayApiError extends Error {
  constructor(message, { statusCode = 0, code = '' } = {}) {
    super(message);
    this.name = 'WxPayApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function valueOfEnv(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const withNewlines = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  if (withNewlines.includes('-----BEGIN')) return withNewlines;
  try {
    const decoded = Buffer.from(withNewlines, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN') ? decoded : withNewlines;
  } catch (err) {
    return withNewlines;
  }
}

function configOf(env = process.env) {
  return {
    appId: String(env.WECHAT_PAY_APP_ID || 'wx05c160a589b97d76').trim(),
    mchId: String(env.WECHAT_PAY_MCH_ID || '').trim(),
    serialNo: String(env.WECHAT_PAY_SERIAL_NO || '').trim(),
    privateKey: valueOfEnv(env.WECHAT_PAY_PRIVATE_KEY),
    apiV3Key: String(env.WECHAT_PAY_API_V3_KEY || '').trim(),
    notifyUrl: String(env.WECHAT_PAY_NOTIFY_URL || '').trim(),
    refundNotifyUrl: String(env.WECHAT_PAY_REFUND_NOTIFY_URL || '').trim(),
    platformPublicKey: valueOfEnv(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY),
    platformPublicKeyId: String(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID || '').trim(),
    platformCert: valueOfEnv(env.WECHAT_PAY_PLATFORM_CERT),
    platformCertSerial: String(env.WECHAT_PAY_PLATFORM_CERT_SERIAL || '').trim(),
    maxSkewSeconds: Number(env.WECHAT_PAY_CALLBACK_MAX_SKEW_SECONDS || DEFAULT_MAX_SKEW_SECONDS),
  };
}

function hasApiConfig(config = {}) {
  return !!(
    config.appId
    && config.mchId
    && config.serialNo
    && config.privateKey
    && Buffer.byteLength(config.apiV3Key, 'utf8') === 32
    && config.notifyUrl
    && hasCallbackPublicKey(config)
  );
}

function hasCallbackPublicKey(config = {}) {
  return !!((config.platformPublicKey && config.platformPublicKeyId)
    || (config.platformCert && config.platformCertSerial));
}

function hasRefundConfig(config = {}) {
  return hasApiConfig(config) && !!config.refundNotifyUrl;
}

function nonce(size = 16) {
  return crypto.randomBytes(size).toString('hex');
}

function timestampSeconds(now = Date.now()) {
  return String(Math.floor(Number(now) / 1000));
}

function signMessage(message, privateKey) {
  return crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

function requestSignature({ method, path, body = '', timestamp, nonceStr, privateKey }) {
  const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
  return signMessage(message, privateKey);
}

function authorizationHeader({
  method, path, body = '', mchId, serialNo, privateKey,
  timestamp = timestampSeconds(), nonceStr = nonce(),
}) {
  const signature = requestSignature({
    method, path, body, timestamp, nonceStr, privateKey,
  });
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

function request({ method, path, body = '', config }) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'travel-app-payment/1.0',
    Authorization: authorizationHeader({
      method,
      path,
      body,
      mchId: config.mchId,
      serialNo: config.serialNo,
      privateKey: config.privateKey,
    }),
  };
  if (body) headers['Content-Type'] = 'application/json';

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      port: 443,
      path,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (err) {
          data = null;
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: raw,
          data,
        });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new WxPayApiError('微信支付请求超时'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(options) {
  if (!hasCallbackPublicKey(options.config)) {
    throw new WxPayApiError('微信支付响应验签配置缺失', {
      code: 'MISSING_RESPONSE_VERIFY_KEY',
    });
  }
  const response = await request(options);
  const verified = verifyCallbackSignature({
    headers: response.headers,
    body: response.body,
    config: options.config,
  });
  if (!verified) {
    // 连错误响应也必须先通过微信支付签名校验，不能把网关或中间人伪造的
    // err_code/status 当成微信支付结论；失败继续由上层按支付未确认处理。
    throw new WxPayApiError('微信支付响应签名校验失败', {
      statusCode: response.statusCode,
      code: 'INVALID_RESPONSE_SIGNATURE',
    });
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data || {};
    throw new WxPayApiError(data.message || data.errmsg || '微信支付接口请求失败', {
      statusCode: response.statusCode,
      code: data.code || data.err_code || '',
    });
  }
  if (!response.data) throw new WxPayApiError('微信支付接口返回了无法解析的数据');
  return response.data;
}

function beijingRfc3339(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

function createJsapiBody({ appId, mchId, notifyUrl, order, openid }) {
  const body = {
    appid: appId,
    mchid: mchId,
    description: order.body,
    out_trade_no: order.outTradeNo,
    notify_url: notifyUrl,
    amount: {
      total: Number(order.amountFen),
      currency: 'CNY',
    },
    payer: { openid },
  };
  const timeExpire = beijingRfc3339(order.expiresAt);
  if (timeExpire) body.time_expire = timeExpire;
  return body;
}

async function createJsapiOrder({ order, openid, config }) {
  const body = JSON.stringify(createJsapiBody({
    appId: config.appId,
    mchId: config.mchId,
    notifyUrl: config.notifyUrl,
    order,
    openid,
  }));
  const data = await requestJson({
    method: 'POST',
    path: '/v3/pay/transactions/jsapi',
    body,
    config,
  });
  return data;
}

function signPayParams({ appId, prepayId, privateKey, timeStamp = timestampSeconds(), nonceStr = nonce() }) {
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: signMessage(message, privateKey),
  };
}

async function queryOrder({ outTradeNo, config }) {
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchId)}`;
  return requestJson({ method: 'GET', path, config });
}

async function closeOrder({ outTradeNo, config }) {
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`;
  const body = JSON.stringify({ mchid: config.mchId });
  return requestJson({ method: 'POST', path, body, config });
}

function createRefundBody({ order, outRefundNo, reason, config }) {
  const body = {
    out_trade_no: order.outTradeNo,
    out_refund_no: outRefundNo,
    reason: String(reason || '用户申请退款').slice(0, 80),
    notify_url: config.refundNotifyUrl,
    amount: {
      refund: Number(order.amountFen),
      total: Number(order.amountFen),
      currency: 'CNY',
    },
  };
  return body;
}

async function createRefund({ order, outRefundNo, reason, config }) {
  const body = JSON.stringify(createRefundBody({ order, outRefundNo, reason, config }));
  return requestJson({
    method: 'POST',
    path: '/v3/refund/domestic/refunds',
    body,
    config,
  });
}

async function queryRefund({ outRefundNo, config }) {
  const path = `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`;
  return requestJson({ method: 'GET', path, config });
}

function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  const source = headers || {};
  const key = Object.keys(source).find(item => item.toLowerCase() === target);
  if (!key) return '';
  const value = source[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function callbackHeaders(headers = {}) {
  return {
    timestamp: headerValue(headers, 'Wechatpay-Timestamp'),
    nonce: headerValue(headers, 'Wechatpay-Nonce'),
    signature: headerValue(headers, 'Wechatpay-Signature'),
    serial: headerValue(headers, 'Wechatpay-Serial'),
  };
}

function callbackMessage(timestamp, callbackNonce, body) {
  return `${timestamp}\n${callbackNonce}\n${body}\n`;
}

function verifyCallbackSignature({ headers, body, config, now = Date.now() }) {
  const parsed = callbackHeaders(headers);
  if (!parsed.timestamp || !parsed.nonce || !parsed.signature) return false;
  const ts = Number(parsed.timestamp);
  if (!Number.isFinite(ts)) return false;
  const maxSkew = Number.isFinite(Number(config.maxSkewSeconds))
    ? Math.max(30, Number(config.maxSkewSeconds))
    : DEFAULT_MAX_SKEW_SECONDS;
  if (Math.abs(Math.floor(now / 1000) - ts) > maxSkew) return false;

  let publicKey = '';
  let expectedSerial = '';
  if (config.platformPublicKey) {
    publicKey = config.platformPublicKey;
    expectedSerial = config.platformPublicKeyId;
  } else if (config.platformCert) {
    publicKey = config.platformCert;
    expectedSerial = config.platformCertSerial;
  }
  if (!publicKey) return false;
  if (expectedSerial && parsed.serial !== expectedSerial) return false;

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(callbackMessage(parsed.timestamp, parsed.nonce, body), 'utf8');
  verifier.end();
  return verifier.verify(publicKey, parsed.signature, 'base64');
}

function decryptResource(resource = {}, apiV3Key) {
  if (!resource.ciphertext || !resource.nonce) throw new Error('支付回调资源不完整');
  if (resource.algorithm && resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error(`不支持的支付回调加密算法：${resource.algorithm}`);
  }
  const key = Buffer.from(String(apiV3Key), 'utf8');
  if (key.length !== 32) throw new Error('WECHAT_PAY_API_V3_KEY 必须是 32 字节');
  const ciphertext = Buffer.from(String(resource.ciphertext), 'base64');
  if (ciphertext.length <= 16) throw new Error('支付回调密文不合法');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(resource.nonce), 'utf8'));
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(String(resource.associated_data), 'utf8'));
  }
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = {
  API_HOST,
  WxPayApiError,
  valueOfEnv,
  configOf,
  hasApiConfig,
  hasCallbackPublicKey,
  hasRefundConfig,
  nonce,
  timestampSeconds,
  requestSignature,
  authorizationHeader,
  createJsapiBody,
  createJsapiOrder,
  signPayParams,
  queryOrder,
  closeOrder,
  createRefundBody,
  createRefund,
  queryRefund,
  beijingRfc3339,
  callbackHeaders,
  verifyCallbackSignature,
  decryptResource,
};
