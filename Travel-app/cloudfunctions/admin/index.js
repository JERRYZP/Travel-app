/**
 * admin 云函数 —— 只读 Web 管理后台接口。
 *
 * action:
 *   admin.login
 *   admin.overview / admin.users.list / admin.user.detail
 *   admin.tasks.list / admin.task.detail / admin.spots.stats
 *   admin.audit.viewSensitive
 *   internal.rollupDaily（定时触发器无 action 时默认执行）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, ok, fail } = require('./lib/schema');
const admin = require('./lib/admin');

const AUTH_ACTIONS = new Set([
  'admin.overview',
  'admin.users.list',
  'admin.user.detail',
  'admin.tasks.list',
  'admin.task.detail',
  'admin.spots.stats',
  'admin.audit.viewSensitive',
]);

exports.main = async (event = {}) => {
  const action = event.action || 'internal.rollupDaily';
  try {
    if (action === 'admin.login') {
      return await admin.login(db, event, process.env);
    }
    if (action === 'internal.rollupDaily') {
      if (!admin.isTimerInvocation(event, process.env)) return fail(ERRORS.FORBIDDEN);
      return await admin.rollupDaily(db, event);
    }
    if (!AUTH_ACTIONS.has(action)) return fail(ERRORS.UNKNOWN_ACTION);

    const session = await admin.authenticate(db, event.token, process.env);
    if (!session.ok) return session.response;

    switch (action) {
      case 'admin.overview':
        return await admin.overview(db, event);
      case 'admin.users.list':
        return await admin.usersList(db, event);
      case 'admin.user.detail':
        return await admin.userDetail(db, event);
      case 'admin.tasks.list':
        return await admin.tasksList(db, event);
      case 'admin.task.detail':
        return await admin.taskDetail(db, event);
      case 'admin.spots.stats':
        return await admin.spotsStats(db, event);
      case 'admin.audit.viewSensitive':
        return await admin.viewSensitive(db, session.admin, event);
      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error(`[admin] action=${action} failed`, err);
    return fail(ERRORS.SERVER_ERROR, { message: err.message });
  }
};

exports._internal = { db, admin };
