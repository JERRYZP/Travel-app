/** admin 云函数集合、枚举和错误码。 */
const COLLECTIONS = {
  ADMINS: 'admins',
  USERS: 'users',
  TRIPS: 'trips',
  TRIP_ITEMS: 'trip_items',
  REMINDER_TASKS: 'reminder_tasks',
  SPOTS: 'spots',
  REMINDER_EVENTS: 'reminder_events',
  DAILY_STATS: 'reminder_daily_stats',
  AUDIT_LOGS: 'admin_audit_logs',
};

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  VIEWER: 'VIEWER',
};

const ADMIN_STATUS = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
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
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  FORBIDDEN: { code: 1040, message: '无权限' },
  LOGIN_FAILED: { code: 1041, message: '账号或密码错误' },
  ACCOUNT_LOCKED: { code: 1042, message: '账号已锁定，请稍后再试' },
  SERVER_ERROR: { code: 1500, message: '服务异常，请稍后重试' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
};

function ok(data = {}) {
  return { success: true, ...data };
}

function fail(err, extra = {}) {
  const e = typeof err === 'string' ? ERRORS.BAD_PARAM : err;
  const message = typeof err === 'string' ? err : e.message;
  return { success: false, error: message, errorCode: e.code, ...extra };
}

module.exports = {
  COLLECTIONS,
  ROLES,
  ADMIN_STATUS,
  METRIC_TYPES,
  EVENT_TYPES,
  ERRORS,
  ok,
  fail,
};
