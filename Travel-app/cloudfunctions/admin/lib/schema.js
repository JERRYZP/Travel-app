/** 内部维护任务使用的集合、事件和错误定义。 */
const COLLECTIONS = {
  REMINDER_TASKS: 'reminder_tasks',
  REMINDER_EVENTS: 'reminder_events',
  DAILY_STATS: 'reminder_daily_stats',
  AUDIT_LOGS: 'admin_audit_logs',
};

const METRIC_TYPES = {
  CREATED: 'CREATED',
  DUE: 'DUE',
  DELIVERY: 'DELIVERY',
};

const EVENT_TYPES = {
  TASK_CREATED: 'TASK_CREATED',
  TASK_REBUILT: 'TASK_REBUILT',
  TASK_CANCELED: 'TASK_CANCELED',
  SEND_SUCCEEDED: 'SEND_SUCCEEDED',
  SEND_FAILED: 'SEND_FAILED',
  SEND_SKIPPED: 'SEND_SKIPPED',
  TASK_TRIGGERED: 'TASK_TRIGGERED',
  TASK_MISSED: 'TASK_MISSED',
};

const ERRORS = {
  FORBIDDEN: { code: 1040, message: '无权限' },
  SERVER_ERROR: { code: 1500, message: '服务异常，请稍后重试' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
};

function ok(data = {}) {
  return { success: true, ...data };
}

function fail(err, extra = {}) {
  return { success: false, error: err.message, errorCode: err.code, ...extra };
}

module.exports = { COLLECTIONS, METRIC_TYPES, EVENT_TYPES, ERRORS, ok, fail };
