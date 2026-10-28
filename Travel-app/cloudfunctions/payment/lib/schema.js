/**
 * payment 云函数独立部署所需的最小契约镜像。
 *
 * 云函数按目录独立打包，不能 require 同级 reminder 目录。集合名、订单状态、
 * 会员等级和错误码必须与 cloudfunctions/reminder/lib/schema.js 保持一致，
 * test/payment-order.test.js 会钉住支付侧实际使用的字段。
 */

const COLLECTIONS = {
  USERS: 'users',
  ORDERS: 'orders',
};

const MemberLevel = {
  NORMAL: 'NORMAL',
  MEMBER: 'MEMBER',
};

const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  REFUNDED: 'REFUNDED',
};

const ERRORS = {
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  MEMBERSHIP_REQUIRED: { code: 1022, message: '请先开通会员再加购任务位' },
  PAYMENT_NOT_READY: { code: 1023, message: '支付通道准备中，请稍后再试' },
  ORDER_NOT_FOUND: { code: 1024, message: '订单不存在或已失效' },
  ORDER_AMOUNT_MISMATCH: { code: 1025, message: '订单金额校验失败' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
};

function ok(data = {}) {
  return { success: true, ...data };
}

function fail(err, extra = {}) {
  const e = typeof err === 'string' ? { code: ERRORS.BAD_PARAM.code, message: err } : err;
  return { success: false, error: e.message, errorCode: e.code, ...extra };
}

module.exports = {
  COLLECTIONS,
  MemberLevel,
  OrderStatus,
  ERRORS,
  ok,
  fail,
};
