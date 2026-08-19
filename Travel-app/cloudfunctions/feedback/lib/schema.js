/**
 * feedback 云函数 —— 集合名、枚举与错误码（与 reminder/lib/schema.js 同风格）
 *
 * 意见反馈 / 信息纠错 共用一张 feedbacks 集合，type 区分两类。
 */

/** 集合名 */
const COLLECTIONS = {
  FEEDBACKS: 'feedbacks', // TABLE-008
};

/** 反馈大类 */
const FeedbackType = {
  FEEDBACK: 'feedback',     // 意见反馈
  CORRECTION: 'correction', // 信息纠错
};

/** 处理状态（运营在云开发控制台查看/跟进） */
const FeedbackStatus = {
  OPEN: 'OPEN',
  PROCESSED: 'PROCESSED',
  IGNORED: 'IGNORED',
};

/** 意见反馈子类：V1 只保留 建议 / Bug */
const FeedbackCategory = {
  SUGGESTION: 'suggestion',
  BUG: 'bug',
};

/** 信息纠错类型（key 稳定入库，前端展示 label） */
const CORRECTION_ERROR_TYPES = [
  'RELEASE_TIME',  // 放票时间
  'RELEASE_RULE',  // 放票规则
  'OPEN_TIME',     // 开放时间
  'TICKET_PRICE',  // 票价
  'ADDRESS',       // 地址
  'CLOSED_DAYS',   // 闭馆日
  'OTHER',         // 其他
];

/**
 * 管理员 openid 白名单（反馈管理页使用）。
 * 获取方式：云开发控制台 -> 数据库 -> feedbacks 集合 -> 打开自己提交的记录，复制 userId 字段。
 * 填入后需重新部署 feedback 云函数。
 */
const ADMIN_OPENIDS = [
  'ot0AjxqLvqyo1HcAIWTQsxjIU7Lk',
];

/** 是否管理员 */
function isAdmin(userId) {
  return ADMIN_OPENIDS.includes(userId);
}

/** 错误码（沿用 3.9 风格，1000/1010/1099 与 reminder 一致） */
const ERRORS = {
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  CONTENT_EMPTY: { code: 1020, message: '内容不能为空' },
  FORBIDDEN: { code: 1040, message: '无权限' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
  SERVER_ERROR: { code: 1500, message: '服务异常，请稍后重试' },
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
  FeedbackType,
  FeedbackStatus,
  FeedbackCategory,
  CORRECTION_ERROR_TYPES,
  ADMIN_OPENIDS,
  isAdmin,
  ERRORS,
  ok,
  fail,
};
