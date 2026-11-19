/** Account erasure cloud function contract. Keep status mirrors pinned by tests. */

const COLLECTIONS = Object.freeze({
  USERS: 'users',
  TRIPS: 'trips',
  TRIP_ITEMS: 'trip_items',
  REMINDER_TASKS: 'reminder_tasks',
  REMINDER_CART: 'reminder_cart',
  SEARCH_HISTORY: 'search_history',
  FEEDBACKS: 'feedbacks',
  ORDERS: 'orders',
  AFTER_SALES_CASES: 'after_sales_cases',
  ADMIN_AUDIT_LOGS: 'admin_audit_logs',
  REMINDER_EVENTS: 'reminder_events',
  USER_RUNTIME: 'user_runtime',
  REWARDED_AD_ATTEMPTS: 'rewarded_ad_attempts',
});

const CONFIRMATION = 'ERASE_MY_ACCOUNT';
const RECENT_CLOSED_SAFETY_MS = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

const OrderStatus = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  REFUNDED: 'REFUNDED',
});

const GrantStatus = Object.freeze({
  GRANTED: 'GRANTED',
  FAILED: 'FAILED',
  REVERTED: 'REVERTED',
});

const RefundStatus = Object.freeze({
  NONE: 'NONE',
  REQUESTED: 'REQUESTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PROCESSING: 'PROCESSING',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
});

const CaseStatus = Object.freeze({
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
});

const ACTIVE_CASE_STATUSES = new Set([
  CaseStatus.SUBMITTED,
  CaseStatus.AUTO_CHECKING,
  CaseStatus.UNDER_REVIEW,
  CaseStatus.APPROVED,
  CaseStatus.PROCESSING,
  CaseStatus.REFUND_FAILED,
]);

const ACTIVE_REFUND_STATUSES = new Set([
  RefundStatus.REQUESTED,
  RefundStatus.UNDER_REVIEW,
  RefundStatus.PROCESSING,
  RefundStatus.FAILED,
]);

const ERRORS = Object.freeze({
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  ERASURE_BLOCKED: { code: 1047, message: '当前账户还有未处理事项，暂时不能注销' },
  ERASURE_CONFIRM_REQUIRED: { code: 1048, message: '请完成注销确认' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
  SERVER_ERROR: { code: 1500, message: '服务异常，请稍后重试' },
});

function ok(data = {}) {
  return { success: true, ...data };
}

function fail(err, extra = {}) {
  const value = typeof err === 'string' ? { code: ERRORS.BAD_PARAM.code, message: err } : err;
  return { success: false, error: value.message, errorCode: value.code, ...extra };
}

module.exports = {
  COLLECTIONS,
  CONFIRMATION,
  RECENT_CLOSED_SAFETY_MS,
  AUDIT_RETENTION_MS,
  OrderStatus,
  GrantStatus,
  RefundStatus,
  CaseStatus,
  ACTIVE_CASE_STATUSES,
  ACTIVE_REFUND_STATUSES,
  ERRORS,
  ok,
  fail,
};
