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
  AFTER_SALES_CASES: 'after_sales_cases',
  ADMIN_AUDIT_LOGS: 'admin_audit_logs',
  REMINDER_TASKS: 'reminder_tasks',
  REMINDER_EVENTS: 'reminder_events',
  PAYMENT_RECONCILE_STATE: 'payment_reconcile_state',
  PAYMENT_CONFIG: 'payment_config',
};

const MemberLevel = {
  NORMAL: 'NORMAL',
  MEMBER: 'MEMBER',
};

const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  REFUNDED: 'REFUNDED', // 历史兼容，新流程不写这个订单状态
};

const MembershipSalesState = {
  OPEN: 'OPEN',
  PAUSED: 'PAUSED',
};

const RefundStatus = {
  NONE: 'NONE',
  REQUESTED: 'REQUESTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PROCESSING: 'PROCESSING',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
};

const GrantStatus = {
  NONE: 'NONE',
  GRANTED: 'GRANTED',
  FAILED: 'FAILED',
  REVERTED: 'REVERTED',
};

const CaseType = {
  RIGHTS_NOT_RECEIVED: 'RIGHTS_NOT_RECEIVED',
  DUPLICATE_CHARGE: 'DUPLICATE_CHARGE',
  UNUSED_REFUND: 'UNUSED_REFUND',
  ENTITLEMENT_MISMATCH: 'ENTITLEMENT_MISMATCH',
  OTHER: 'OTHER',
};

const CaseStatus = {
  SUBMITTED: 'SUBMITTED',
  AUTO_CHECKING: 'AUTO_CHECKING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  PROCESSING: 'PROCESSING',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
  REFUND_FAILED: 'REFUND_FAILED',
  CANCELLED: 'CANCELLED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
};

const ERRORS = {
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  MEMBERSHIP_REQUIRED: { code: 1022, message: '请先开通会员再加购提醒名额' },
  PAYMENT_NOT_READY: { code: 1023, message: '支付通道准备中，请稍后再试' },
  ORDER_NOT_FOUND: { code: 1024, message: '订单不存在或已失效' },
  ORDER_AMOUNT_MISMATCH: { code: 1025, message: '订单金额校验失败' },
  ORDER_EXPIRED: { code: 1027, message: '订单已过期，请重新下单' },
  AFTER_SALES_EXISTS: { code: 1028, message: '该订单已有处理中或已完成的售后申请' },
  REFUND_NOT_ELIGIBLE: { code: 1029, message: '当前订单暂不符合退款申请条件' },
  CASE_NOT_FOUND: { code: 1030, message: '售后记录不存在' },
  TASK_QUOTA_BUSY: { code: 1031, message: '提醒名额正在更新，请稍后重试' },
  MEMBERSHIP_SALES_PAUSED: { code: 1032, message: '会员购买暂停中，请稍后再试' },
  MEMBERSHIP_ENFORCEMENT_NOT_READY: {
    code: 1033,
    message: '上线前数据迁移未完成，不能切换全量会员限制',
  },
  FORBIDDEN: { code: 1040, message: '无权限' },
  SERVER_ERROR: { code: 1500, message: '服务异常，请稍后重试' },
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
  RefundStatus,
  GrantStatus,
  MembershipSalesState,
  CaseType,
  CaseStatus,
  ERRORS,
  ok,
  fail,
};
