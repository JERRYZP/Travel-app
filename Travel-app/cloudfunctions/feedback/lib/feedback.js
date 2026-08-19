/**
 * feedback 业务逻辑 —— 意见反馈 / 信息纠错 提交与查询
 *
 * 校验规则：
 *   - type ∈ { feedback, correction }
 *   - feedback：category ∈ { suggestion, bug }，content 非空
 *   - correction：spotId 必填，errorType ∈ CORRECTION_ERROR_TYPES，content 非空
 *   - contact 一律选填
 */

const {
  COLLECTIONS, FeedbackType, FeedbackStatus, FeedbackCategory, CORRECTION_ERROR_TYPES, ERRORS, ok, fail, isAdmin,
} = require('./schema');

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
    createdAt: new Date(),
  };
  const add = await db.collection(COLLECTIONS.FEEDBACKS).add({ data: doc });
  return ok({ id: add._id });
}

async function list(db, userId) {
  const res = await db.collection(COLLECTIONS.FEEDBACKS)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ items: res.data || [] });
}

/**
 * adminList -- 管理员查看全部反馈（反馈管理页）
 * params.type 可选筛选：feedback / correction，不传返回全部。
 */
async function adminList(db, userId, params = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  const where = {};
  if (params.type === FeedbackType.FEEDBACK || params.type === FeedbackType.CORRECTION) {
    where.type = params.type;
  }
  const res = await db.collection(COLLECTIONS.FEEDBACKS)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return ok({ items: res.data || [], total: (res.data || []).length });
}

/** adminUpdateStatus -- 管理员更新处理状态（OPEN / PROCESSED / IGNORED） */
async function adminUpdateStatus(db, userId, { id, status } = {}) {
  if (!isAdmin(userId)) return fail(ERRORS.FORBIDDEN);
  if (!id || typeof id !== 'string') return fail(ERRORS.BAD_PARAM);
  if (!Object.values(FeedbackStatus).includes(status)) return fail(ERRORS.BAD_PARAM);
  const res = await db.collection(COLLECTIONS.FEEDBACKS).doc(id).update({
    data: { status, updatedAt: new Date() },
  });
  return ok({ updated: res.stats ? res.stats.updated : 1 });
}

module.exports = { validateSubmit, submit, list, adminList, adminUpdateStatus };
