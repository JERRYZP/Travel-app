/**
 * feedback 业务逻辑 —— 意见反馈 / 信息纠错 提交、查询与管理员回复
 *
 * 校验规则：
 *   - type ∈ { feedback, correction }
 *   - feedback：category ∈ { suggestion, bug }，content 非空
 *   - correction：spotId 必填，errorType ∈ CORRECTION_ERROR_TYPES，content 非空
 *   - contact 一律选填
 *
 * 回复模型：管理员可追加多条单向回复并逐条修改；用户端只读。
 * adminReply / adminReplyAt / adminReplyBy 继续同步为最新一条，供旧客户端兼容。
 * adminReplyBy 是管理端审计信息，绝不能出现在普通用户的返回值里。
 */

const {
  COLLECTIONS, FeedbackType, FeedbackStatus, FeedbackCategory, CORRECTION_ERROR_TYPES,
  REPLY_MAX_LEN, MAX_ADMIN_REPLIES, ERRORS, ok, fail, isAdmin,
} = require('./schema');
const userDirectory = require('./user-directory');
const crypto = require('crypto');

/** 反馈管理页分页 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const REWARD_NOTICE_PAGE_SIZE = 100;
const REWARD_PROGRAM_VERSION = 'feedback-member-30d-v1';

function replyIdOf(nowTs = new Date()) {
  return `fbr_${nowTs.getTime().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 兼容历史单条回复。旧客户端/旧数据只有 adminReply，不要求批量迁移。
 * 管理员身份字段只保留在内部结构中，用户视图会再走白名单投影。
 */
function repliesOf(doc = {}) {
  if (Array.isArray(doc.adminReplies) && doc.adminReplies.length > 0) {
    return doc.adminReplies.map(item => ({
      replyId: String(item.replyId || ''),
      content: String(item.content || ''),
      createdAt: item.createdAt || doc.adminReplyAt || doc.createdAt || null,
      createdBy: String(item.createdBy || ''),
      updatedAt: item.updatedAt || item.createdAt || doc.adminReplyAt || doc.createdAt || null,
      updatedBy: String(item.updatedBy || item.createdBy || ''),
      editCount: Math.max(0, Number(item.editCount) || 0),
      legacy: item.legacy === true,
    })).filter(item => item.replyId && item.content);
  }
  const content = String(doc.adminReply || '').trim();
  if (!content) return [];
  return [{
    replyId: 'legacy',
    content,
    createdAt: doc.adminReplyAt || doc.createdAt || null,
    createdBy: String(doc.adminReplyBy || ''),
    updatedAt: doc.adminReplyAt || doc.createdAt || null,
    updatedBy: String(doc.adminReplyBy || ''),
    editCount: 0,
    legacy: true,
  }];
}

function adminRepliesOf(doc = {}) {
  return repliesOf(doc).map(item => ({ ...item }));
}

function latestReply(replies = []) {
  return [...replies].sort((a, b) => {
    const at = new Date(a.createdAt || 0).getTime();
    const bt = new Date(b.createdAt || 0).getTime();
    if (at !== bt) return bt - at;
    return String(b.replyId).localeCompare(String(a.replyId));
  })[0] || null;
}

function replyMirrorOf(replies = []) {
  const latest = latestReply(replies);
  return {
    adminReply: latest ? latest.content : '',
    adminReplyAt: latest ? latest.createdAt : null,
    adminReplyBy: latest ? latest.createdBy : null,
    adminReplyUpdatedAt: latest ? latest.updatedAt : null,
  };
}

function rewardViewOf(doc = {}, admin = false) {
  const status = ['GRANTED', 'REVOKED'].includes(doc.rewardStatus)
    ? doc.rewardStatus : 'NONE';
  const view = {
    status,
    days: Math.max(0, Number(doc.rewardDays) || 0),
    backfill: doc.rewardBackfill === true,
    grantedAt: doc.rewardGrantedAt || null,
    revokedAt: doc.rewardRevokedAt || null,
    memberExpiresAt: doc.rewardMemberExpiresAt || null,
    updatedAt: doc.rewardUpdatedAt || null,
  };
  if (admin) {
    view.grantedBy = doc.rewardGrantedBy || null;
    view.revokedBy = doc.rewardRevokedBy || null;
    view.memberExpiresBefore = doc.rewardMemberExpiresBefore || null;
    view.memberExpiresAfter = doc.rewardMemberExpiresAfter || null;
    view.backfillable = !doc.rewardProgramVersion;
  }
  return view;
}

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
    adminReplies: [],
    adminReply: '',
    adminReplyAt: null,
    adminReplyBy: null,
    rewardStatus: 'NONE',
    rewardProgramVersion: REWARD_PROGRAM_VERSION,
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
  const replyThread = repliesOf(doc);
  const latest = latestReply(replyThread);
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
    replies: replyThread.map(item => ({
      replyId: item.replyId,
      content: item.content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      edited: item.editCount > 0,
    })),
    adminReply: latest ? latest.content : '',
    adminReplyAt: latest ? latest.createdAt : null,
    reward: rewardViewOf(doc),
    createdAt: doc.createdAt,
  };
}

/** 管理端视图：在白名单之上追加提交人信息 */
function adminViewOf(doc, userMap = {}) {
  return {
    ...listViewOf(doc),
    userId: doc.userId,
    adminReplyBy: doc.adminReplyBy || null,
    replies: adminRepliesOf(doc),
    reward: rewardViewOf(doc, true),
    user: userDirectory.userBriefOf(userMap[doc.userId] || {}, doc.userId),
  };
}

function rewardNoticeViewOf(doc = {}) {
  return {
    feedbackId: doc._id,
    type: doc.type,
    category: doc.category,
    spotName: doc.spotName,
    content: String(doc.content || '').slice(0, 80),
    reward: rewardViewOf(doc),
  };
}

/** 分页读取全部未读奖励通知，避免批量补发超过单页上限时被已读水位静默跳过。 */
async function unseenRewardNoticesOf(db, userId, seenAt) {
  const rows = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(COLLECTIONS.FEEDBACKS)
      .where({ userId, rewardUpdatedAt: db.command.gt(seenAt) })
      .orderBy('rewardUpdatedAt', 'desc')
      .skip(skip)
      .limit(REWARD_NOTICE_PAGE_SIZE)
      .get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < REWARD_NOTICE_PAGE_SIZE) break;
    skip += batch.length;
  }
  return rows;
}

async function list(db, userId) {
  // 客户端用 asOf 回写已读水位，避免把查询开始后新到的管理员操作误清。
  const asOf = new Date();
  const [res, userRes] = await Promise.all([
    db.collection(COLLECTIONS.FEEDBACKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
    db.collection(COLLECTIONS.USERS)
      .where({ openId: userId })
      .limit(1)
      .get(),
  ]);
  const userDoc = (userRes.data || [])[0] || {};
  const seenAt = userDoc.feedbackSeenAt instanceof Date && !Number.isNaN(userDoc.feedbackSeenAt.getTime())
    ? userDoc.feedbackSeenAt
    : new Date(0);
  // 奖励通知按 rewardUpdatedAt 独立读取，不受“最近 50 条反馈”限制。
  const rewardRows = await unseenRewardNoticesOf(db, userId, seenAt);
  return ok({
    items: (res.data || []).map(listViewOf),
    rewardNotices: rewardRows.map(rewardNoticeViewOf),
    asOf,
  });
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

function validateReplyText(reply) {
  if (typeof reply !== 'string') return { error: ERRORS.BAD_PARAM };
  const text = reply.trim();
  if (!text) return { error: ERRORS.REPLY_EMPTY };
  if (text.length > REPLY_MAX_LEN) return { error: ERRORS.BAD_PARAM };
  return { text };
}

async function feedbackById(db, id) {
  const found = await db.collection(COLLECTIONS.FEEDBACKS)
    .where({ _id: id })
    .limit(1)
    .get();
  return (found.data || [])[0] || null;
}

async function writeRepliesPatch(db, id, replies, adminId, now) {
  const mirror = replyMirrorOf(replies);
  const res = await db.collection(COLLECTIONS.FEEDBACKS).doc(id).update({
    data: {
      adminReplies: replies,
      ...mirror,
      status: FeedbackStatus.PROCESSED,
      handledAt: now,
      updatedAt: now,
    },
  });
  return res.stats ? res.stats.updated : 1;
}

/**
 * 显式追加一条管理员回复。回复线程只允许管理员写入，用户端只读。
 */
async function adminAddReply(db, userId, { id, reply } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string') return fail(ERRORS.BAD_PARAM);
  const checked = validateReplyText(reply);
  if (checked.error) return fail(checked.error);

  const doc = await feedbackById(db, id);
  if (!doc) return fail(ERRORS.FEEDBACK_NOT_FOUND);

  const replies = repliesOf(doc);
  if (replies.length >= MAX_ADMIN_REPLIES) return fail(ERRORS.REPLY_LIMIT);
  const now = new Date();
  const entry = {
    replyId: replyIdOf(now),
    content: checked.text,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    editCount: 0,
    legacy: false,
  };
  replies.push(entry);
  const updated = await writeRepliesPatch(db, id, replies, userId, now);
  return ok({
    updated,
    reply: adminRepliesOf({ adminReplies: replies }).find(item => item.replyId === entry.replyId),
    replies: adminRepliesOf({ adminReplies: replies }),
    adminReply: entry.content,
    adminReplyAt: now,
    status: FeedbackStatus.PROCESSED,
  });
}

/** 修改指定回复；任意日期都可改，保留原 createdAt 并标记编辑时间。 */
async function adminUpdateReply(db, userId, { id, replyId, reply } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string' || !replyId || typeof replyId !== 'string') {
    return fail(ERRORS.BAD_PARAM);
  }
  const checked = validateReplyText(reply);
  if (checked.error) return fail(checked.error);

  const doc = await feedbackById(db, id);
  if (!doc) return fail(ERRORS.FEEDBACK_NOT_FOUND);
  const replies = repliesOf(doc);
  const index = replies.findIndex(item => item.replyId === replyId);
  if (index < 0) return fail(ERRORS.REPLY_NOT_FOUND);

  const now = new Date();
  replies[index] = {
    ...replies[index],
    content: checked.text,
    updatedAt: now,
    updatedBy: userId,
    editCount: Math.max(0, Number(replies[index].editCount) || 0) + 1,
  };
  const updated = await writeRepliesPatch(db, id, replies, userId, now);
  const latest = latestReply(replies);
  return ok({
    updated,
    reply: adminRepliesOf({ adminReplies: replies }).find(item => item.replyId === replyId),
    replies: adminRepliesOf({ adminReplies: replies }),
    adminReply: latest ? latest.content : '',
    adminReplyAt: latest ? latest.createdAt : null,
    status: FeedbackStatus.PROCESSED,
  });
}

/**
 * 旧客户端兼容入口：有回复时修改最新一条，没有回复时创建第一条。
 * 新客户端使用 adminAddReply / adminUpdateReply 显式区分追加与修改。
 */
async function adminReply(db, userId, { id, reply } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string') return fail(ERRORS.BAD_PARAM);
  const checked = validateReplyText(reply);
  if (checked.error) return fail(checked.error);

  const doc = await feedbackById(db, id);
  if (!doc) return fail(ERRORS.FEEDBACK_NOT_FOUND);
  const replies = repliesOf(doc);
  const latest = latestReply(replies);
  if (!latest) return adminAddReply(db, userId, { id, reply: checked.text });

  const now = new Date();
  const index = replies.findIndex(item => item.replyId === latest.replyId);
  replies[index] = {
    ...replies[index],
    content: checked.text,
    updatedAt: now,
    updatedBy: userId,
    editCount: Math.max(0, Number(replies[index].editCount) || 0) + 1,
  };
  const updated = await writeRepliesPatch(db, id, replies, userId, now);
  return ok({
    updated,
    reply: adminRepliesOf({ adminReplies: replies }).find(item => item.replyId === latest.replyId),
    replies: adminRepliesOf({ adminReplies: replies }),
    adminReply: checked.text,
    adminReplyAt: latest.createdAt,
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
  adminAddReply,
  adminUpdateReply,
  adminReply,
  adminUpdateStatus,
  repliesOf,
  rewardViewOf,
};
