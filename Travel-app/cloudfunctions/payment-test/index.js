/**
 * 微信支付 API v3 独立测试探针。
 *
 * 只验证真实 JSAPI 支付、微信服务器回调和主动查单，不读写 users/orders。
 * 该函数只部署到 unpay 测试环境，不允许用于正式会员发放。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const wxpay = require('./lib/wxpay-v3');

const DEFAULT_ALLOWED_OPENIDS = Object.freeze([
  'oZ6IFxvYK1mKzBaehMcOPIl_CgN0',
  'oZ6IFxmYI3grd17Aa2rEem2SMqNo',
  'oZ6IFxi1K98ihzn5DH6KP5Jx9_bs',
]);

function maskOpenId(value) {
  const raw = String(value || '');
  if (raw.length <= 8) return raw ? '***' : '';
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

function allowedOpenIds() {
  const raw = String(process.env.PAYMENT_PROBE_ALLOWED_OPENIDS || '').trim();
  const values = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_OPENIDS;
  return new Set(values);
}

function isAllowed(openid) {
  return !!openid && allowedOpenIds().has(openid);
}

function httpEventOf(event = {}) {
  return event && Object.prototype.hasOwnProperty.call(event, 'body')
    && (event.headers || event.requestContext || event.httpMethod);
}

function rawBodyOf(event = {}) {
  if (typeof event.body !== 'string') return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function resultOk(data = {}) {
  return { success: true, ...data };
}

function resultFail(message, errorCode) {
  return { success: false, error: message, errorCode };
}

function callbackJson(statusCode, code, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ code, message }),
  };
}

function makeOutTradeNo() {
  return `PTP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`.slice(0, 32);
}

function amountFenOf() {
  const value = Number(process.env.PAYMENT_PROBE_AMOUNT_FEN || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

async function handleHttpCallback(event) {
  const config = wxpay.configOf();
  if (!wxpay.hasCallbackPublicKey(config) || !config.apiV3Key) {
    return callbackJson(500, 'FAIL', '支付回调配置未完成');
  }

  const body = rawBodyOf(event);
  if (!body) return callbackJson(400, 'FAIL', '请求体为空');
  if (!wxpay.verifyCallbackSignature({ headers: event.headers || {}, body, config })) {
    return callbackJson(401, 'FAIL', '签名校验失败');
  }

  let notification;
  try {
    notification = JSON.parse(body);
  } catch (err) {
    return callbackJson(400, 'FAIL', '回调 JSON 不合法');
  }
  if (notification.event_type && notification.event_type !== 'TRANSACTION.SUCCESS') {
    return callbackJson(200, 'SUCCESS', '成功');
  }

  let transaction;
  try {
    transaction = wxpay.decryptResource(notification.resource, config.apiV3Key);
  } catch (err) {
    console.error('[payment-test] decrypt failed', err.message);
    return callbackJson(400, 'FAIL', '回调资源解密失败');
  }

  const expectedAmount = amountFenOf();
  if (transaction.trade_state !== 'SUCCESS'
    || transaction.mchid !== config.mchId
    || transaction.appid !== config.appId
    || Number(transaction.amount && transaction.amount.total) !== expectedAmount) {
    console.error('[payment-test] callback validation failed');
    return callbackJson(400, 'FAIL', '支付结果校验失败');
  }

  console.log('[payment-test] callback verified', {
    outTradeNo: transaction.out_trade_no,
    transactionId: transaction.transaction_id,
    amountFen: transaction.amount.total,
    tradeState: transaction.trade_state,
  });
  return callbackJson(200, 'SUCCESS', '成功');
}

async function handleCreate() {
  const context = cloud.getWXContext();
  if (!isAllowed(context.OPENID)) {
    return resultFail(`当前测试账号未授权（${maskOpenId(context.OPENID)}）`, 403);
  }

  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return resultFail('支付环境变量未配置完成', 1023);

  const outTradeNo = makeOutTradeNo();
  const amountFen = amountFenOf();
  const order = {
    outTradeNo,
    body: '智序准点游-支付功能测试',
    amountFen,
  };
  const data = await wxpay.createJsapiOrder({
    order,
    openid: context.OPENID,
    config,
  });
  if (!data.prepay_id) return resultFail('微信支付未返回 prepay_id', 1023);
  return resultOk({
    outTradeNo,
    amountFen,
    payment: wxpay.signPayParams({
      appId: config.appId,
      prepayId: data.prepay_id,
      privateKey: config.privateKey,
    }),
  });
}

async function handleQuery(event) {
  const context = cloud.getWXContext();
  if (!isAllowed(context.OPENID)) {
    return resultFail(`当前测试账号未授权（${maskOpenId(context.OPENID)}）`, 403);
  }
  const outTradeNo = String(event.outTradeNo || '').trim();
  if (!outTradeNo) return resultFail('缺少 outTradeNo', 1010);

  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return resultFail('支付环境变量未配置完成', 1023);
  const data = await wxpay.queryOrder({ outTradeNo, config });
  if (data.payer && data.payer.openid && data.payer.openid !== context.OPENID) {
    return resultFail('订单不属于当前测试账号', 1024);
  }
  return resultOk({
    outTradeNo,
    tradeState: data.trade_state || '',
    amountFen: Number(data.amount && data.amount.total),
    transactionId: data.transaction_id || '',
  });
}

exports.main = async (event = {}) => {
  if (httpEventOf(event)) return handleHttpCallback(event);
  try {
    if (event.action === 'create') return await handleCreate();
    if (event.action === 'query') return await handleQuery(event);
    return resultFail('unknown action', 1099);
  } catch (err) {
    console.error('[payment-test] failed', {
      name: err.name,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
    });
    return resultFail(err.code || '支付测试失败', 1500);
  }
};
