/**
 * 会员与任务位支付入口。
 *
 * 支付协议：微信支付 API v3 直连，不依赖 cloud.cloudPay 或云开发服务商。
 * 普通调用：wx.cloud.callFunction({ name: 'payment', data: { action: 'create' | 'query' } })
 * 支付回调：CloudBase HTTP 网关 -> 本函数，必须校验 Wechatpay 原始签名后再解密资源。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, OrderStatus, ok, fail } = require('./lib/schema');
const {
  amountOf, findOrderById, findOrderByOutTradeNo, fulfillOrder, isQueryPaidResult,
} = require('./lib/order');
const wxpay = require('./lib/wxpay-v3');

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

function callbackResponse(statusCode, code, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ code, message }),
  };
}

function callbackSuccess() {
  return callbackResponse(200, 'SUCCESS', '成功');
}

function callbackFailure(message, statusCode = 400) {
  return callbackResponse(statusCode, 'FAIL', message);
}

function safeLog(event, details = {}) {
  console.log('[payment] callback', {
    event: event && event.event_type,
    resourceType: event && event.resource_type,
    ...details,
  });
}

async function handleHttpCallback(event) {
  const config = wxpay.configOf();
  if (!wxpay.hasCallbackPublicKey(config) || !config.apiV3Key) {
    console.error('[payment] callback configuration missing');
    return callbackFailure('支付回调配置未完成', 500);
  }

  const body = rawBodyOf(event);
  if (!body) return callbackFailure('请求体为空');

  const verified = wxpay.verifyCallbackSignature({
    headers: event.headers || {},
    body,
    config,
  });
  if (!verified) {
    console.error('[payment] callback signature verification failed');
    return callbackFailure('签名校验失败', 401);
  }

  let notification;
  try {
    notification = JSON.parse(body);
  } catch (err) {
    return callbackFailure('回调 JSON 不合法');
  }

  if (notification.event_type && notification.event_type !== 'TRANSACTION.SUCCESS') {
    safeLog(notification);
    return callbackSuccess();
  }

  let transaction;
  try {
    transaction = wxpay.decryptResource(notification.resource, config.apiV3Key);
  } catch (err) {
    console.error('[payment] callback resource decrypt failed', err.message);
    return callbackFailure('回调资源解密失败', 400);
  }

  const outTradeNo = transaction.out_trade_no || '';
  safeLog(notification, { outTradeNo });
  if (transaction.trade_state !== 'SUCCESS') return callbackSuccess();

  const order = await findOrderByOutTradeNo(db, outTradeNo);
  if (!order) {
    console.error('[payment] callback order not found', { outTradeNo });
    return callbackFailure('订单不存在', 500);
  }

  if (transaction.mchid !== config.mchId || transaction.appid !== config.appId) {
    console.error('[payment] callback merchant/appid mismatch', { outTradeNo });
    return callbackFailure('商户或小程序不匹配', 400);
  }

  const result = await fulfillOrder(db, order, {
    totalFee: amountOf(transaction),
    transactionId: transaction.transaction_id || '',
    raw: {
      tradeState: transaction.trade_state,
      appId: transaction.appid,
      mchId: transaction.mchid,
      outTradeNo,
    },
  });
  if (!result.success) {
    console.error('[payment] callback fulfill failed', {
      outTradeNo,
      errorCode: result.errorCode,
    });
    return callbackFailure(result.error || '订单发放失败', result.errorCode === 1025 ? 400 : 500);
  }
  return callbackSuccess();
}

async function createPayment(context, event) {
  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);

  const order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID) {
    return ok({ orderId: order._id, status: OrderStatus.PAID, alreadyPaid: true });
  }
  if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_NOT_FOUND);

  const result = await wxpay.createJsapiOrder({
    order,
    openid: context.OPENID,
    config,
  });
  if (!result.prepay_id) throw new wxpay.WxPayApiError('微信支付未返回 prepay_id');

  const payment = wxpay.signPayParams({
    appId: config.appId,
    prepayId: result.prepay_id,
    privateKey: config.privateKey,
  });
  return ok({
    orderId: order._id,
    outTradeNo: order.outTradeNo,
    status: OrderStatus.PENDING,
    payment,
  });
}

async function queryPayment(context, event) {
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID) {
    return ok({ orderId: order._id, status: OrderStatus.PAID });
  }

  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) {
    return ok({ orderId: order._id, status: order.status, pending: true });
  }

  const result = await wxpay.queryOrder({ outTradeNo: order.outTradeNo, config });
  if (isQueryPaidResult(result)) {
    if (result.mchid !== config.mchId || result.appid !== config.appId) {
      return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '支付查询商户校验失败' });
    }
    const fulfilled = await fulfillOrder(db, order, {
      totalFee: amountOf(result),
      transactionId: result.transaction_id || '',
      raw: {
        tradeState: result.trade_state,
        appId: result.appid,
        mchId: result.mchid,
        outTradeNo: order.outTradeNo,
      },
    });
    if (!fulfilled.success) return fulfilled;
    order = { ...order, status: OrderStatus.PAID };
  }
  return ok({
    orderId: order._id,
    status: order.status,
    pending: order.status === OrderStatus.PENDING,
  });
}

exports.main = async (event = {}) => {
  if (httpEventOf(event)) return handleHttpCallback(event);

  const context = cloud.getWXContext();
  if (!context.OPENID) return fail(ERRORS.UNAUTHORIZED);

  try {
    if (event.action === 'create') return await createPayment(context, event);
    if (event.action === 'query') return await queryPayment(context, event);
    return fail(ERRORS.UNKNOWN_ACTION);
  } catch (err) {
    console.error('[payment] failed', {
      name: err.name,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
    });
    return fail({
      code: ERRORS.PAYMENT_NOT_READY.code,
      message: err.code || '支付通道准备中，请稍后再试',
    });
  }
};
