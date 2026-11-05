/**
 * feedback 云函数 —— 意见反馈 / 信息纠错 统一入口
 *
 * 前端调用形状：
 *   wx.cloud.callFunction({ name: 'feedback', data: { action: 'feedback.submit', ... } })
 *
 * action：feedback.submit（公开提交）/ feedback.list（本人历史）
 *        / feedback.entrySummary / feedback.markSeen（“我的”入口统计与已读）
 *        / feedback.adminStatus（管理员入口校验）
 *        / feedback.adminList / feedback.adminAddReply / feedback.adminUpdateReply
 *        / feedback.adminReply（旧客户端兼容）/ feedback.adminUpdateStatus
 *          （管理员，反馈管理页）
 * 完整契约见 Travel-app/API-契约.md。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { ERRORS, fail } = require('./lib/schema');
const feedback = require('./lib/feedback');

exports.main = async (event) => {
  const { action } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(ERRORS.UNAUTHORIZED);
  const userId = OPENID;

  try {
    switch (action) {
      case 'feedback.submit':
        return await feedback.submit(db, userId, event);
      case 'feedback.list':
        return await feedback.list(db, userId);
      case 'feedback.entrySummary':
        return await feedback.entrySummary(db, userId);
      case 'feedback.markSeen':
        return await feedback.markSeen(db, userId, event);
      case 'feedback.adminStatus':
        return feedback.adminStatus(userId);
      case 'feedback.adminList':
        return await feedback.adminList(db, userId, event);
      case 'feedback.adminAddReply':
        return await feedback.adminAddReply(db, userId, event);
      case 'feedback.adminUpdateReply':
        return await feedback.adminUpdateReply(db, userId, event);
      case 'feedback.adminReply':
        return await feedback.adminReply(db, userId, event);
      case 'feedback.adminUpdateStatus':
        return await feedback.adminUpdateStatus(db, userId, event);
      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error(`[feedback] action=${action} failed`, err);
    return fail(ERRORS.SERVER_ERROR, { message: err.message });
  }
};
