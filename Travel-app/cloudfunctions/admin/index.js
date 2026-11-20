/**
 * admin 云函数 —— 过期事件清理任务。
 *
 * Web 管理后台已于 2026-11-20 移除；本函数不再提供登录、查询、敏感字段、
 * 日汇总或事件补录接口。唯一入口是受保护的内部清理：
 * - 分批删除超过 180 天的 reminder_events；
 * - 分批删除超过 180 天的 admin_audit_logs。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, fail } = require('./lib/schema');
const maintenance = require('./lib/admin');

const INTERNAL_ACTION = 'internal.cleanupExpired';

exports.main = async (event = {}) => {
  const action = event.action || INTERNAL_ACTION;
  if (action !== INTERNAL_ACTION) return fail(ERRORS.UNKNOWN_ACTION);
  if (!maintenance.isTimerInvocation(event, process.env)) return fail(ERRORS.FORBIDDEN);

  try {
    return await maintenance.cleanupExpired(db);
  } catch (err) {
    console.error('[admin-maintenance] cleanup failed', err);
    return fail(ERRORS.SERVER_ERROR, { message: err.message });
  }
};

exports._internal = { db, maintenance };
