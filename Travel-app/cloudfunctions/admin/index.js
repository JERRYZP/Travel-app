/**
 * admin 云函数 —— 内部事件维护任务。
 *
 * Web 管理后台已于 2026-11-20 移除；本函数不再暴露登录、查询或敏感字段接口。
 * 唯一入口是每日定时运行的 internal.rollupDaily：
 * - 重建最近 N 天提醒日汇总；
 * - 补齐缺失的任务终态事件；
 * - 分批清理过期 reminder_events / admin_audit_logs。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, fail } = require('./lib/schema');
const maintenance = require('./lib/admin');

const INTERNAL_ACTION = 'internal.rollupDaily';

exports.main = async (event = {}) => {
  const action = event.action || INTERNAL_ACTION;
  if (action !== INTERNAL_ACTION) return fail(ERRORS.UNKNOWN_ACTION);
  if (!maintenance.isTimerInvocation(event, process.env)) return fail(ERRORS.FORBIDDEN);

  try {
    return await maintenance.rollupDaily(db, event);
  } catch (err) {
    console.error('[admin-maintenance] rollup failed', err);
    return fail(ERRORS.SERVER_ERROR, { message: err.message });
  }
};

exports._internal = { db, maintenance };
