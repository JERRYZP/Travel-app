/**
 * 微信小程序虚拟支付协议层。
 *
 * 负责客户端拉起支付所需的 signData/paySig/signature，以及服务端查单、
 * 退款接口。会员权益和订单状态仍由 ./order.js 统一处理。
 */

const crypto = require('crypto');
const https = require('https');
const wechatAuth = require('./wechat-auth');

const API_HOST = 'api.weixin.qq.com';
const REQUEST_TIMEOUT_MS = 10000;
const CLIENT_PAYMENT_URI = 'requestVirtualPayment';
const ATTACH_VERSION = 'v1';

const VirtualOrderStatus = Object.freeze({
  INIT: 0,
  CREATED: 1,
  PAID: 2,
  DELIVERING: 3,
  DELIVERED: 4,
  REFUND_MERCHANT_DONE: 5,
  CLOSED: 6,
  REFUND_FAILED: 7,
  REFUNDED: 8,
});

const VirtualOrderType = Object.freeze({
  NORMAL: 0,
  NORMAL_REFUND: 1,
  APPLE: 7,
  APPLE_REFUND: 8,
});

class VirtualPayApiError extends Error {
  constructor(message, { errcode = 0, statusCode = 0, path = '' } = {}) {
    super(message);
    this.name = 'VirtualPayApiError';
    this.errcode = errcode;
    this.statusCode = statusCode;
    this.path = path;
  }
}

function normalizeEnvironment(value, fallback = 0) {
  const number = Number(value);
  if (number === 0 || number === 1) return number;
  return Number(fallback) === 1 ? 1 : 0;
}

function appKeyOf(virtualEnv, env = process.env) {
  return virtualEnv === 1
    ? String(env.WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY || env.WECHAT_VIRTUAL_PAY_APP_KEY || '').trim()
    : String(env.WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY || env.WECHAT_VIRTUAL_PAY_APP_KEY || '').trim();
}

function configOf(env = process.env) {
  const virtualEnv = normalizeEnvironment(env.WECHAT_VIRTUAL_PAY_ENV, 0);
  const appKey = appKeyOf(virtualEnv, env);
  const auth = wechatAuth.configOf(env);
  return {
    appId: auth.appId,
    appSecret: auth.appSecret,
    offerId: String(env.WECHAT_VIRTUAL_PAY_OFFER_ID || '').trim(),
    env: virtualEnv,
    appKey,
    memberProductId: String(env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER || '').trim(),
    memberUnlimitedProductId: String(env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED || '').trim(),
    memberUnlimitedV6ProductId: String(env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED_V6 || '').trim(),
    taskPackProductId: String(env.WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK || '').trim(),
    memberQuota10ProductId: String(
      env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_QUOTA_10 || ''
    ).trim(),
    memberTwoTierUnlimitedProductId: String(
      env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_TWO_TIER_UNLIMITED || ''
    ).trim(),
    memberUnlimitedUpgradeProductId: String(
      env.WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED_UPGRADE || ''
    ).trim(),
  };
}

function configForOrder(order = {}, env = process.env, fallbackEnvironment) {
  const base = configOf(env);
  const storedEnvironment = order && order.virtualEnv != null
    ? Number(order.virtualEnv)
    : NaN;
  const targetEnvironment = storedEnvironment === 0 || storedEnvironment === 1
    ? storedEnvironment
    : normalizeEnvironment(fallbackEnvironment, base.env);
  if (targetEnvironment === base.env) return { ...base, env: targetEnvironment };
  return {
    ...base,
    env: targetEnvironment,
    appKey: appKeyOf(targetEnvironment, env),
  };
}

function hasProductConfig(config = {}) {
  return !!(config.memberProductId && config.taskPackProductId);
}

function hasPaymentConfig(config = {}) {
  return hasApiConfig(config) && hasProductConfig(config);
}

function hasApiConfig(config = {}) {
  return !!(config.appId
    && config.appSecret
    && config.offerId
    && config.appKey);
}

function expectedProductIdOf(order = {}, config = {}) {
  if (order.packageId === 'member_quota_10') return config.memberQuota10ProductId || '';
  if (order.packageId === 'member_unlimited') {
    return config.memberTwoTierUnlimitedProductId || '';
  }
  if (order.packageId === 'member_unlimited_upgrade') {
    return config.memberUnlimitedUpgradeProductId || '';
  }
  if (order.productType === 'MEMBER') {
    const unlimited = order.unlimitedReminders === true
      || /^member-unlimited-30d-v[34]$/.test(String(order.specVersion || ''));
    if (!unlimited) return config.memberProductId || '';
    const amountFen = Number(order.amountFen);
    if (amountFen === 600) return config.memberUnlimitedV6ProductId || '';
    if (amountFen === 800) return config.memberUnlimitedProductId || '';
    return '';
  }
  if (order.productType === 'TASK_PACK') return config.taskPackProductId || '';
  return '';
}

function validateOrderSku(order = {}, config = {}) {
  const productId = String(expectedProductIdOf(order, config) || '').trim();
  if (!productId) throw new VirtualPayApiError('虚拟支付商品未配置');
  if (!['MEMBER', 'TASK_PACK'].includes(order.productType)) {
    throw new VirtualPayApiError('订单商品类型不支持虚拟支付');
  }
  const amountFen = Number(order.amountFen);
  if (!Number.isInteger(amountFen) || amountFen <= 0) {
    throw new VirtualPayApiError('虚拟支付订单金额不合法');
  }
  if (order.addedSlots != null && Number(order.addedSlots) < 0) {
    throw new VirtualPayApiError('订单权益快照不合法');
  }
  return productId;
}

function attachOf(order = {}) {
  return [ATTACH_VERSION, order._id || '', order.packageId || '', order.specVersion || '']
    .join('|')
    .slice(0, 128);
}

function assertGrantProduct(order = {}, config = {}) {
  const expected = validateOrderSku(order, config);
  const saved = String(order.virtualProductId || '').trim();
  if (!saved) throw new VirtualPayApiError('订单缺少虚拟支付商品快照');
  if (saved !== expected) throw new VirtualPayApiError('订单商品快照与当前配置不一致');
  return saved;
}

function productIdOf(order = {}, config = {}) {
  return validateOrderSku(order, config);
}

function bizMetaMatchesOrder(result = {}, order = {}) {
  const raw = result.biz_meta != null ? result.biz_meta : result.bizMeta;
  if (raw == null || raw === '') return true;
  let meta = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return true;
    if (text === attachOf(order)) return true;
    try { meta = JSON.parse(text); } catch (err) { meta = text; }
  }
  if (meta && typeof meta === 'object') {
    const keys = ['orderId', 'order_id', 'packageId', 'package_id', 'specVersion', 'spec_version'];
    const hasKnownKey = keys.some(key => meta[key] != null);
    if (!hasKnownKey) return true;
    const orderId = meta.orderId != null ? meta.orderId : meta.order_id;
    const packageId = meta.packageId != null ? meta.packageId : meta.package_id;
    const specVersion = meta.specVersion != null ? meta.specVersion : meta.spec_version;
    if (orderId != null && String(orderId) !== String(order._id || '')) return false;
    if (packageId != null && String(packageId) !== String(order.packageId || '')) return false;
    if (specVersion != null && String(specVersion) !== String(order.specVersion || '')) return false;
    return true;
  }
  const text = String(meta || '');
  if (text.startsWith(`${ATTACH_VERSION}|`)) {
    const parts = text.split('|');
    return parts[1] === String(order._id || '')
      && parts[2] === String(order.packageId || '')
      && parts[3] === String(order.specVersion || '');
  }
  // 平台可能写入与业务无关的扩展信息；只有可识别的标识才参与核对。
  return true;
}

function buildSignData(order = {}, config = {}) {
  const productId = validateOrderSku(order, config);
  const amountFen = Number(order.amountFen);
  return JSON.stringify({
    offerId: config.offerId,
    buyQuantity: 1,
    env: config.env,
    currencyType: 'CNY',
    productId,
    goodsPrice: amountFen,
    outTradeNo: order.outTradeNo,
    attach: attachOf(order),
  });
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac('sha256', String(key)).update(String(message), 'utf8').digest('hex');
}

function paySigOf(signData, appKey) {
  return hmacSha256Hex(appKey, `${CLIENT_PAYMENT_URI}&${signData}`);
}

function userSignatureOf(signData, sessionKey) {
  return hmacSha256Hex(sessionKey, signData);
}

function createClientPayment({ order, sessionKey, config = configOf() }) {
  if (!hasApiConfig(config)) throw new VirtualPayApiError('虚拟支付配置未完成');
  if (!sessionKey) throw new VirtualPayApiError('缺少用户登录态');
  const signData = buildSignData(order, config);
  return {
    mode: 'short_series_goods',
    signData,
    paySig: paySigOf(signData, config.appKey),
    signature: userSignatureOf(signData, sessionKey),
  };
}

function serverPaySigOf(path, body, appKey) {
  return hmacSha256Hex(appKey, `${path}&${body}`);
}

function queryString(params = {}) {
  return Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

function requestJson({ path, query, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const pathWithQuery = query ? `${path}?${queryString(query)}` : path;
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      port: 443,
      path: pathWithQuery,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'travel-app-payment/1.0',
      },
      timeout: timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (err) {
          reject(new VirtualPayApiError('虚拟支付接口返回了无法解析的数据', {
            statusCode: res.statusCode,
            path,
          }));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new VirtualPayApiError(data.errmsg || `虚拟支付接口 HTTP ${res.statusCode}`, {
            errcode: Number(data.errcode) || 0,
            statusCode: res.statusCode,
            path,
          }));
          return;
        }
        if (Number(data.errcode) && Number(data.errcode) !== 0) {
          reject(new VirtualPayApiError(data.errmsg || '虚拟支付接口调用失败', {
            errcode: Number(data.errcode),
            statusCode: res.statusCode,
            path,
          }));
          return;
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('虚拟支付接口请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function apiPost(path, body, config = configOf(), options = {}) {
  const payload = JSON.stringify(body || {});
  let accessToken = options.accessToken || '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!accessToken) {
      accessToken = await wechatAuth.getStableAccessToken({
        config,
        forceRefresh: attempt > 0,
        now: options.now,
      });
    }
    try {
      return await requestJson({
        path,
        query: {
          access_token: accessToken,
          pay_sig: serverPaySigOf(path, payload, config.appKey),
        },
        body,
      });
    } catch (err) {
      const invalidToken = [40001, 40014, 41001, 42001].includes(Number(err && err.errcode));
      if (attempt === 0 && !options.accessToken && invalidToken) {
        accessToken = '';
        continue;
      }
      throw err;
    }
  }
  throw new VirtualPayApiError('虚拟支付接口鉴权失败');
}

async function queryOrderById(orderId, { config = configOf(), openId, accessToken, now } = {}) {
  if (!orderId) throw new VirtualPayApiError('缺少虚拟支付订单号');
  const result = await apiPost('/xpay/query_order', {
    openid: openId || '',
    env: config.env,
    order_id: orderId,
  }, config, { accessToken, now });
  return result.order || result;
}

async function queryPaymentOrder({ order, config, accessToken, now } = {}) {
  if (!order || !order.outTradeNo) throw new VirtualPayApiError('缺少支付订单');
  const resolvedConfig = config || configForOrder(order);
  return queryOrderById(order.outTradeNo, {
    config: resolvedConfig,
    openId: order.userId,
    accessToken,
    now,
  });
}

async function queryRefund({ outRefundNo, order, config, accessToken, now } = {}) {
  if (!outRefundNo) throw new VirtualPayApiError('缺少退款单号');
  const resolvedConfig = config || configForOrder(order || {});
  return queryOrderById(outRefundNo, {
    config: resolvedConfig,
    openId: order ? order.userId : '',
    accessToken,
    now,
  });
}

function refundReasonCode(reason) {
  const text = String(reason || '');
  if (/价格|贵/.test(text)) return 4;
  if (/意愿|不需要|买错|重复/.test(text)) return 3;
  if (/问题|故障|异常|无法/.test(text)) return 1;
  if (/售后|客服/.test(text)) return 2;
  return 5;
}

async function createRefund({
  order,
  outRefundNo,
  reason,
  queryResult,
  config,
  accessToken,
  now,
} = {}) {
  if (!order || !order.outTradeNo) throw new VirtualPayApiError('缺少支付订单');
  if (!outRefundNo) throw new VirtualPayApiError('缺少退款单号');
  const resolvedConfig = config || configForOrder(order);
  const current = queryResult || await queryPaymentOrder({
    order,
    config: resolvedConfig,
    accessToken,
    now,
  });
  if (isAppleOrder(current)) {
    throw new VirtualPayApiError('Apple 订单需由用户在 App Store 发起退款', {
      errcode: -15001,
    });
  }
  const leftFee = Number(current.left_fee != null ? current.left_fee : current.paid_fee);
  const refundFee = Number(order.amountFen);
  if (!Number.isInteger(leftFee) || leftFee <= 0) {
    throw new VirtualPayApiError('虚拟支付订单没有可退金额');
  }
  if (refundFee <= 0 || refundFee > leftFee) {
    throw new VirtualPayApiError('退款金额超过订单剩余可退金额');
  }
  return apiPost('/xpay/refund_order', {
    openid: order.userId,
    order_id: order.outTradeNo,
    refund_order_id: outRefundNo,
    left_fee: leftFee,
    refund_fee: refundFee,
    biz_meta: JSON.stringify({
      orderId: order._id,
      packageId: order.packageId || '',
    }).slice(0, 1024),
    refund_reason: String(refundReasonCode(reason)),
    req_from: '1',
    env: resolvedConfig.env,
  }, resolvedConfig, { accessToken, now });
}

function statusOf(result = {}) {
  return Number(result.status != null ? result.status : result.order_status);
}

function orderTypeOf(result = {}) {
  return Number(result.order_type != null ? result.order_type : result.orderType);
}

function isAppleOrder(result = {}) {
  return [VirtualOrderType.APPLE, VirtualOrderType.APPLE_REFUND].includes(orderTypeOf(result));
}

function isPaidResult(result = {}) {
  return [
    VirtualOrderStatus.PAID,
    VirtualOrderStatus.DELIVERING,
    VirtualOrderStatus.DELIVERED,
  ].includes(statusOf(result));
}

function isClosedResult(result = {}) {
  return statusOf(result) === VirtualOrderStatus.CLOSED;
}

function isRefundedResult(result = {}) {
  return statusOf(result) === VirtualOrderStatus.REFUNDED;
}

function isRefundProcessingResult(result = {}) {
  return statusOf(result) === VirtualOrderStatus.REFUND_MERCHANT_DONE;
}

function isRefundFailedResult(result = {}) {
  return statusOf(result) === VirtualOrderStatus.REFUND_FAILED;
}

function paidAmountOf(result = {}) {
  const raw = result.paid_fee != null ? result.paid_fee : result.order_fee;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function orderFeeOf(result = {}) {
  const raw = result.order_fee != null ? result.order_fee : result.paid_fee;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function environmentOf(result = {}) {
  const value = Number(result.env_type);
  if (value === 1) return 0;
  if (value === 2) return 1;
  return null;
}

module.exports = {
  VirtualOrderStatus,
  VirtualOrderType,
  VirtualPayApiError,
  configOf,
  configForOrder,
  hasProductConfig,
  hasPaymentConfig,
  hasApiConfig,
  expectedProductIdOf,
  validateOrderSku,
  assertGrantProduct,
  productIdOf,
  attachOf,
  bizMetaMatchesOrder,
  buildSignData,
  hmacSha256Hex,
  paySigOf,
  userSignatureOf,
  createClientPayment,
  serverPaySigOf,
  queryOrderById,
  queryPaymentOrder,
  queryRefund,
  createRefund,
  statusOf,
  orderTypeOf,
  isAppleOrder,
  isPaidResult,
  isClosedResult,
  isRefundedResult,
  isRefundProcessingResult,
  isRefundFailedResult,
  paidAmountOf,
  orderFeeOf,
  environmentOf,
};
