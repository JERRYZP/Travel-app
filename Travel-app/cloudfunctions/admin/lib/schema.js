/** 过期清理任务使用的集合和错误定义。 */
const COLLECTIONS = {
  REMINDER_EVENTS: 'reminder_events',
  AUDIT_LOGS: 'admin_audit_logs',
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

module.exports = { COLLECTIONS, ERRORS, ok, fail };
