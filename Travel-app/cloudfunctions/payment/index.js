/**
 * 微信云支付入口。
 *
 * 必要环境变量：
 * - WECHAT_PAY_SUB_MCH_ID：云开发微信支付子商户号
 * - WECHAT_PAY_CALLBACK_FUNCTION：支付回调云函数，默认 payment
 * - TCB_ENV：当前云环境 ID，缺省回退项目当前环境
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, OrderStatus, ok, fail } = require('./lib/schema');
const {
  amountOf, findOrderById, findOrderByOutTradeNo, fulfillOrder,
  isCallbackPaidResult, isQueryPaidResult,
} = require('./lib/order');

const DEFAULT_ENV_ID = 'cloud1-d9g9f4hja396d6e92';

function envIdOf(context = {}) {
  return process.env.TCB_ENV || context.ENV || DEFAULT_ENV_ID;
}

function nonceStr() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function callbackResult() {
  return { errcode: 0, errmsg: 'ok' };
}

function isPaymentCallback(event = {}) {
  return !event.action
    && !!(event.outTradeNo || event.out_trade_no)
    && !!(event.returnCode || event.return_code || event.resultCode || event.result_code);
}

async function handleCallback(event = {}) {
  const outTradeNo = event.outTradeNo || event.out_trade_no;
  const order = await findOrderByOutTradeNo(db, outTradeNo);
  if (!order) return { errcode: -1, errmsg: 'order not found' };

  const paid = isCallbackPaidResult(event);
  if (!paid) return { errcode: -1, errmsg: 'payment not successful' };

  const result = await fulfillOrder(db, order, {
    totalFee: amountOf(event),
    transactionId: event.transactionId || event.transaction_id || '',
    raw: event,
  });
  if (!result.success) return { errcode: -1, errmsg: result.error || 'fulfill failed' };
  return callbackResult();
}

exports.main = async (event = {}) => {
  if (isPaymentCallback(event)) return handleCallback(event);

  const context = cloud.getWXContext();
  if (!context.OPENID) return fail(ERRORS.UNAUTHORIZED);

  try {
    if (event.action === 'create') {
      const order = await findOrderById(db, event.orderId);
      if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
      if (order.status === OrderStatus.PAID) {
        return ok({ orderId: order._id, status: OrderStatus.PAID, alreadyPaid: true });
      }
      if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_NOT_FOUND);

      const subMchId = process.env.WECHAT_PAY_SUB_MCH_ID;
      if (!subMchId || !cloud.cloudPay || !cloud.cloudPay.unifiedOrder) {
        return fail(ERRORS.PAYMENT_NOT_READY);
      }

      const result = await cloud.cloudPay.unifiedOrder({
        body: order.body,
        outTradeNo: order.outTradeNo,
        nonceStr: nonceStr(),
        spbillCreateIp: context.CLIENTIP || event.clientIp || '127.0.0.1',
        subMchId,
        totalFee: order.amountFen,
        envId: envIdOf(context),
        functionName: process.env.WECHAT_PAY_CALLBACK_FUNCTION || 'payment',
      });

      const returnCode = result.returnCode || result.return_code;
      const resultCode = result.resultCode || result.result_code;
      if ((returnCode && returnCode !== 'SUCCESS') || (resultCode && resultCode !== 'SUCCESS')) {
        return fail({
          code: ERRORS.PAYMENT_NOT_READY.code,
          message: result.returnMsg || result.return_msg || result.errMsg || '统一下单失败',
        });
      }

      const payment = result.payment || result.payParams || null;
      if (!payment) return fail(ERRORS.PAYMENT_NOT_READY);
      return ok({
        orderId: order._id,
        outTradeNo: order.outTradeNo,
        status: OrderStatus.PENDING,
        payment,
      });
    }

    if (event.action === 'query') {
      let order = await findOrderById(db, event.orderId);
      if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
      if (order.status === OrderStatus.PAID) {
        return ok({ orderId: order._id, status: OrderStatus.PAID });
      }

      const subMchId = process.env.WECHAT_PAY_SUB_MCH_ID;
      if (!subMchId || !cloud.cloudPay || !cloud.cloudPay.queryOrder) {
        return ok({ orderId: order._id, status: order.status, pending: true });
      }
      const result = await cloud.cloudPay.queryOrder({
        subMchId,
        outTradeNo: order.outTradeNo,
        nonceStr: nonceStr(),
      });
      if (isQueryPaidResult(result)) {
        const fulfilled = await fulfillOrder(db, order, {
          totalFee: amountOf(result),
          transactionId: result.transactionId || result.transaction_id || '',
          raw: result,
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

    return fail(ERRORS.UNKNOWN_ACTION);
  } catch (err) {
    console.error('[payment] failed', err);
    return fail({ code: 1500, message: err.message });
  }
};
