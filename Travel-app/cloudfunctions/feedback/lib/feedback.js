/**
 * feedback 业务逻辑 —— 意见反馈 / 信息纠错 提交、查询与管理员回复
 *
 * 校验规则：
 *   - type ∈ { feedback, correction }
 *   - feedback：category ∈ { suggestion, bug }，content 非空
 *   - correction：spotId 必填，errorType ∈ CORRECTION_ERROR_TYPES，content 非空
 *   - contact 一律选填
 *
 * 回复模型：单条回复，字段 adminReply / adminReplyAt / adminReplyBy 就地覆盖。
 * 不做多轮对话；adminReplyBy 是管理端审计信息，绝不能出现在普通用户的返回值里。
 */

const {
  COLLECTIONS, FeedbackType, FeedbackStatus, FeedbackCategory, CORRECTION_ERROR_TYPES,
  REPLY_MAX_LEN, ERRORS, ok, fail, isAdmin,
} = require('./schema');
const userDirectory = require('./user-directory');

/** 反馈管理页分页 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** 页码归一化：非法值回退默认，pageSize 夹在 [1, MAX_PAGE_SIZE] */
function normalizePage(params = {}) {
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const rawSize = Math.floor(Number(params.pageSize) || DEFAULT_PAGE_SIZE);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** 校验失败返回 { code, message }，通过则返回 null */
function validateSubmit(data) {
  const type = data.type;
  if (type !== FeedbackType.FEEDBACK && type !== FeedbackType.CORRECTION) {
    return { code: ERRORS.BAD_PARAM.code, message: '类型不合法' };
  }
  if (typeof data.content !== 'string' || !data.content.trim()) {
    return { code: ERRORS.CONTENT_EMPTY.code, message: ERRORS.CONTENT_EMPTY.message };
  }

  if (type === FeedbackType.FEEDBACK) {
    if (!Object.values(FeedbackCategory).includes(data.category)) {
      return { code: ERRORS.BAD_PARAM.code, message: '反馈类型不合法' };
    }
  } else {
    if (typeof data.spotId !== 'string' || !data.spotId) {
      return { code: ERRORS.BAD_PARAM.code, message: '请选择景点' };
    }
    if (!CORRECTION_ERROR_TYPES.includes(data.errorType)) {
      return { code: ERRORS.BAD_PARAM.code, message: '纠错类型不合法' };
    }
  }
  return null;
}

async function submit(db, userId, data) {
  const err = validateSubmit(data);
  if (err) return fail({ code: err.code, message: err.message });

  const isCorrection = data.type === FeedbackType.CORRECTION;
  const doc = {
    userId,
    type: data.type,
    category: isCorrection ? null : data.category,
    spotId: isCorrection ? data.spotId : null,
    spotName: isCorrection ? String(data.spotName || '').slice(0, 50) : null,
    errorType: isCorrection ? data.errorType : null,
    content: data.content.trim(),
    contact: typeof data.contact === 'string' ? data.contact.trim() : '',
    status: FeedbackStatus.OPEN,
    adminReply: '',
    adminReplyAt: null,
    adminReplyBy: null,
    createdAt: new Date(),
  };
  const add = await db.collection(COLLECTIONS.FEEDBACKS).add({ data: doc });
  return ok({ id: add._id });
}

/**
 * 用户自己看的历史记录视图。
 *
 * 必须是字段白名单：文档里还有 userId 和 adminReplyBy（回复者 OpenID），
 * 直接返回原始文档会把管理员身份泄露给每个普通用户。
 */
function listViewOf(doc) {
  return {
    _id: doc._id,
    type: doc.type,
    category: doc.category,
    spotId: doc.spotId,
    spotName: doc.spotName,
    errorType: doc.errorType,
    content: doc.content,
    contact: doc.contact || '',
    status: doc.status,
    adminReply: String(doc.adminReply || ''),
    adminReplyAt: doc.adminReplyAt || null,
    createdAt: doc.createdAt,
  };
}

/** 管理端视图：在白名单之上追加提交人信息 */
function adminViewOf(doc, userMap = {}) {
  return {
    ...listViewOf(doc),
    userId: doc.userId,
    adminReplyBy: doc.adminReplyBy || null,
    user: userDirectory.userBriefOf(userMap[doc.userId] || {}, doc.userId),
  };
}

async function list(db, userId) {
  // 客户端用 asOf 回写已读水位，避免把查询开始后新到的管理员操作误清。
  const asOf = new Date();
  const res = await db.collection(COLLECTIONS.FEEDBACKS)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ items: (res.data || []).map(listViewOf), asOf });
}

/**
 * adminStatus -- 当前调用者是否为管理员（客户端仅用于控制隐藏入口显隐）
 * 不返回任何反馈数据；真正的数据操作仍由 adminList/adminUpdateStatus 再次鉴权。
 */
function adminStatus(userId) {
  return ok({ isAdmin: isAdmin(userId) });
}

/**
 * entrySummary -- “我的”页反馈入口统计。
 *
 * 普通用户只拿到自己的未读处理数；管理员额外拿到待处理反馈数。
 * 客户端短缓存该结果，避免每次 onShow 都查库。
 */
async function entrySummary(db, userId) {
  const admin = isAdmin(userId);
  const userRes = await db.collection(COLLECTIONS.USERS)
    .where({ openId: userId })
    .limit(1)
    .get();
  const userDoc = (userRes.data || [])[0] || {};
  const seenAt = userDoc.feedbackSeenAt instanceof Date && !Number.isNaN(userDoc.feedbackSeenAt.getTime())
    ? userDoc.feedbackSeenAt
    : new Date(0);

  const userUnreadQuery = db.collection(COLLECTIONS.FEEDBACKS)
    .where({ userId, handledAt: db.command.gt(seenAt) });
  const [userUnreadRes, adminPendingRes] = await Promise.all([
    userUnreadQuery.count(),
    admin
      ? db.collection(COLLECTIONS.FEEDBACKS)
        .where({ status: FeedbackStatus.OPEN })
        .count()
      : Promise.resolve({ total: 0 }),
  ]);

  return ok({
    isAdmin: admin,
    handledUnreadCount: Math.max(0, Number(userUnreadRes.total) || 0),
    adminPendingCount: admin ? Math.max(0, Number(adminPendingRes.total) || 0) : 0,
  });
}

/**
 * markSeen -- 用户成功打开“我的反馈”后推进已读水位。
 *
 * through 取 feedback.list 返回的 asOf，而不是客户端当前时间。这样列表查询开始后
 * 才发生的新回复或状态操作仍会保留为未读。
 */
async function markSeen(db, userId, { through } = {}) {
  const requested = through ? new Date(through) : null;
  if (!requested || Number.isNaN(requested.getTime())) return fail(ERRORS.BAD_PARAM);

  const target = new Date(Math.min(requested.getTime(), Date.now()));
  const found = await db.collection(COLLECTIONS.USERS)
    .where({ openId: userId })
    .limit(1)
    .get();
  const user = (found.data || [])[0];
  if (!user) return ok({ feedbackSeenAt: target, updated: 0 });

  const current = user.feedbackSeenAt instanceof Date ? user.feedbackSeenAt : new Date(0);
  if (current.getTime() >= target.getTime()) {
    return ok({ feedbackSeenAt: current, updated: 0 });
  }

  const res = await db.collection(COLLECTIONS.USERS).doc(user._id).update({
    data: { feedbackSeenAt: target },
  });
  return ok({
    feedbackSeenAt: target,
    updated: res.stats ? res.stats.updated : 1,
  });
}

/**
 * adminList -- 管理员分页查看全部反馈（反馈管理页）
 *
 * params.type     可选：feedback / correction
 * params.category 可选：suggestion / bug（纠错的 category 恒为 null，天然被排除）
 * params.page / params.pageSize 分页，非法值回退默认
 *
 * 非法筛选值一律忽略而不是报错，与历史行为一致。
 */
async function adminList(db, userId, params = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);

  const pageInfo = normalizePage(params);
  const where = {};
  if (params.type === FeedbackType.FEEDBACK || params.type === FeedbackType.CORRECTION) {
    where.type = params.type;
  }
  if (Object.values(FeedbackCategory).includes(params.category)) {
    where.category = params.category;
  }

  let baseQuery = db.collection(COLLECTIONS.FEEDBACKS);
  if (Object.keys(where).length > 0) baseQuery = baseQuery.where(where);

  // count() 必须建在未加 skip/limit 的查询上，否则 total 会等于本页条数
  const total = Number((await baseQuery.count()).total) || 0;
  const res = await baseQuery
    .orderBy('createdAt', 'desc')
    .skip(pageInfo.skip)
    .limit(pageInfo.pageSize)
    .get();
  const rows = res.data || [];
  const userMap = await userDirectory.userMapByOpenIds(db, rows.map(row => row.userId));
  const items = rows.map(row => adminViewOf(row, userMap));

  return ok({
    items,
    count: items.length,
    total,
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    hasMore: pageInfo.skip + items.length < total,
    type: where.type || '',
    category: where.category || '',
  });
}

/**
 * adminReply -- 管理员对单条反馈写回复（单条，重复回复就地覆盖）
 *
 * 回复即把状态置为 PROCESSED：肯解释拒绝理由，就算处理过了。
 * 返回写入结果，让管理页就地更新卡片，不用重拉第一页。
 */
async function adminReply(db, userId, { id, reply } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string') return fail(ERRORS.BAD_PARAM);
  if (typeof reply !== 'string') return fail(ERRORS.BAD_PARAM);
  const text = reply.trim();
  if (!text) return fail(ERRORS.REPLY_EMPTY);
  if (text.length > REPLY_MAX_LEN) return fail(ERRORS.BAD_PARAM);

  // 用 where 而不是 doc(id).get()：真实云库对缺失文档会抛错，这里需要区分「不存在」和「无变化」
  const found = await db.collection(COLLECTIONS.FEEDBACKS)
    .where({ _id: id })
    .limit(1)
    .get();
  if (!(found.data || []).length) return fail(ERRORS.FEEDBACK_NOT_FOUND);

  const now = new Date();
  const res = await db.collection(COLLECTIONS.FEEDBACKS).doc(id).update({
    data: {
      adminReply: text,
      adminReplyAt: now,
      adminReplyBy: userId,
      status: FeedbackStatus.PROCESSED,
      handledAt: now,
      updatedAt: now,
    },
  });
  return ok({
    updated: res.stats ? res.stats.updated : 1,
    adminReply: text,
    adminReplyAt: now,
    status: FeedbackStatus.PROCESSED,
  });
}

/** adminUpdateStatus -- 管理员更新处理状态（OPEN / PROCESSED / IGNORED） */
async function adminUpdateStatus(db, userId, { id, status } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string') return fail(ERRORS.BAD_PARAM);
  if (!Object.values(FeedbackStatus).includes(status)) return fail(ERRORS.BAD_PARAM);
  const now = new Date();
  const res = await db.collection(COLLECTIONS.FEEDBACKS).doc(id).update({
    data: { status, handledAt: now, updatedAt: now },
  });
  return ok({ updated: res.stats ? res.stats.updated : 1 });
}

module.exports = {
  validateSubmit,
  submit,
  list,
  adminStatus,
  entrySummary,
  markSeen,
  adminList,
  adminReply,
  adminUpdateStatus,
};
