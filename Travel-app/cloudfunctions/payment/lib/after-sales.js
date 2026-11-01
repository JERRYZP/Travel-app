/**
 * 会员支付售后与退款领域逻辑。
 *
 * 用户只能提交售后单；审核、退款和权益回收都必须走服务端。
 */

const crypto = require('crypto');
const {
  COLLECTIONS, ERRORS, OrderStatus, RefundStatus, GrantStatus, CaseType, CaseStatus, ok, fail,
} = require('./schema');
const {
  REFUND_WINDOW_MS, DUPLICATE_WINDOW_MS, dateMs, isLiveEntitlement,
} = require('./order');

// 售后权限只能由部署环境显式配置。未配置时关闭工作台，避免代码里的测试
// OpenID 被误带到生产环境。
const DEFAULT_ADMIN_OPENIDS = Object.freeze([]);

const CASE_TYPE_LABEL = {
  RIGHTS_NOT_RECEIVED: '权益未到账',
  DUPLICATE_CHARGE: '重复支付',
  UNUSED_REFUND: '未使用退款',
  ENTITLEMENT_MISMATCH: '权益不符',
  OTHER: '其他问题',
};

const CASE_STATUS_LABEL = {
  SUBMITTED: '已提交',
  AUTO_CHECKING: '自动核验中',
  UNDER_REVIEW: '客服审核中',
  APPROVED: '已同意退款',
  PROCESSING: '退款处理中',
  REFUNDED: '已退款',
  REJECTED: '已驳回',
  REFUND_FAILED: '退款异常',
  CANCELLED: '用户已取消',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

const ACTIVE_CASE_STATUSES = new Set([
  CaseStatus.SUBMITTED,
  CaseStatus.AUTO_CHECKING,
  CaseStatus.UNDER_REVIEW,
  CaseStatus.APPROVED,
  CaseStatus.PROCESSING,
  CaseStatus.REFUND_FAILED,
]);
const USER_CANCELLABLE_CASE_STATUSES = new Set([
  CaseStatus.SUBMITTED,
  CaseStatus.AUTO_CHECKING,
  CaseStatus.UNDER_REVIEW,
  CaseStatus.APPROVED,
  CaseStatus.REFUND_FAILED,
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

function adminOpenIdsOf(env = process.env) {
  const raw = String(env.AFTER_SALES_ADMIN_OPENIDS || '').trim();
  const values = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_ADMIN_OPENIDS;
  return new Set(values);
}

function isAfterSalesAdmin(userId, env = process.env) {
  return !!userId && adminOpenIdsOf(env).has(userId);
}

function outRefundNoOf(order) {
  return `RF${String((order && order.outTradeNo) || '')}`.slice(0, 64);
}

function paymentChannelOf(order = {}) {
  const rawOrderType = order.channelOrderType != null
    ? order.channelOrderType
    : (order.paymentResult && order.paymentResult.channelOrderType);
  const channelOrderType = Number(rawOrderType);
  if (channelOrderType === 7 || channelOrderType === 8) return 'APPLE';
  if (String(order.paymentProvider || '').toUpperCase() === 'VIRTUAL_PAY'
    || order.virtualEnv != null
    || Number.isFinite(channelOrderType)) {
    return 'WECHAT_VIRTUAL';
  }
  return 'WECHAT_PAY';
}

function platformRefundCaseIdOf(outRefundNo) {
  const digest = crypto.createHash('sha256')
    .update(String(outRefundNo || ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `prf_${digest}`;
}

function makeCaseNo(now = new Date()) {
  const stamp = new Date(now).getTime().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AS${stamp}${random}`.slice(0, 32);
}

function requestHashOf(userId, orderId, requestId) {
  return crypto.createHash('sha256')
    .update(`${userId}:${orderId}:${requestId}`, 'utf8')
    .digest('hex');
}

function caseIdOfRequest(hash) {
  return `asc_${String(hash || '').slice(0, 28)}`;
}

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function isDocumentNotFoundError(err) {
  const message = String((err && (err.errMsg || err.message)) || err || '');
  return /document\.get:fail document with _id .* does not exist/i.test(message);
}

async function documentDataOrNull(documentRef) {
  try {
    return docDataOf(await documentRef.get());
  } catch (err) {
    if (isDocumentNotFoundError(err)) return null;
    throw err;
  }
}

function requestIdOf(event = {}) {
  const raw = String(event.requestId || '').trim();
  return REQUEST_ID_PATTERN.test(raw) ? raw : '';
}

function systemRequestIdOf(kind, resourceId) {
  return crypto.createHash('sha256')
    .update(`system:${String(kind || '')}:${String(resourceId || '')}`, 'utf8')
    .digest('hex');
}

function isTerminalCaseStatus(status) {
  return !!status && !ACTIVE_CASE_STATUSES.has(status);
}

function timeText(value) {
  const ms = dateMs(value);
  if (!ms) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}-${iso.slice(5, 7)}-${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function refundEligibilityOf(order = {}, user = {}, now = new Date()) {
  const paidMs = dateMs(order.paidAt);
  const nowMs = new Date(now).getTime();
  const lastCreatedMs = dateMs(user.lastReminderCreatedAt || 0);
  const hoursSincePaid = paidMs ? Math.floor((nowMs - paidMs) / (60 * 60 * 1000)) : null;
  const withinWindow = paidMs > 0 && nowMs - paidMs <= REFUND_WINDOW_MS;
  const usedAfterPurchase = paidMs > 0 && lastCreatedMs > paidMs;
  const alreadyRefunded = order.refundStatus === RefundStatus.REFUNDED
    || order.status === OrderStatus.REFUNDED;
  const refundInProgress = [
    RefundStatus.REQUESTED,
    RefundStatus.UNDER_REVIEW,
    RefundStatus.PROCESSING,
  ].includes(order.refundStatus);
  return {
    withinWindow,
    usedAfterPurchase,
    alreadyRefunded,
    refundInProgress,
    hoursSincePaid,
    eligibleForReview: order.status === OrderStatus.PAID
      && withinWindow
      && !usedAfterPurchase
      && !alreadyRefunded
      && !refundInProgress,
  };
}

function caseViewOf(item = {}) {
  const status = item.status || CaseStatus.SUBMITTED;
  const refundStatus = item.refundStatus || RefundStatus.NONE;
  const evidence = item.evidence || {};
  const systemGenerated = item.systemGenerated === true || evidence.systemGenerated === true;
  const typeLabel = item.reasonCode === 'PLATFORM_REFUND_NOTIFY'
    ? '平台退款'
    : (CASE_TYPE_LABEL[item.type] || '其他问题');
  const priority = item.priority || (
    [CaseType.RIGHTS_NOT_RECEIVED, CaseType.DUPLICATE_CHARGE].includes(item.type) ? 'HIGH' : 'NORMAL'
  );
  return {
    _id: item._id,
    caseNo: item.caseNo || '',
    orderId: item.orderId || '',
    outTradeNo: item.outTradeNo || '',
    title: item.title || '会员提醒名额',
    amountFen: Number(item.amountFen) || 0,
    amountText: `¥${((Number(item.amountFen) || 0) / 100).toFixed(2).replace(/\.00$/, '')}`,
    type: item.type || CaseType.OTHER,
    typeLabel,
    systemGenerated,
    priority,
    priorityLabel: priority === 'HIGH' ? '高优先级' : '普通',
    reasonCode: item.reasonCode || '',
    description: item.description || '',
    status,
    statusLabel: CASE_STATUS_LABEL[status] || '处理中',
    canCancel: USER_CANCELLABLE_CASE_STATUSES.has(status),
    refundStatus,
    refundStatusLabel: CASE_STATUS_LABEL[status] || '处理中',
    failureReason: String(item.failureReason || ''),
    failureCode: String(item.failureCode || ''),
    fundingBlocked: item.fundingBlocked === true,
    fundingBlockedAt: item.fundingBlockedAt || null,
    fundingBlockedAtText: timeText(item.fundingBlockedAt),
    decisionNote: item.decisionNote || '',
    outRefundNo: item.outRefundNo || '',
    refundAmountFen: Number(item.refundAmountFen) || 0,
    refundAmountText: `¥${((Number(item.refundAmountFen) || Number(item.amountFen) || 0) / 100).toFixed(2).replace(/\.00$/, '')}`,
    evidence,
    createdAt: item.createdAt || null,
    createdAtText: timeText(item.createdAt),
    reviewedAt: item.reviewedAt || null,
    reviewedAtText: timeText(item.reviewedAt),
    refundedAt: item.refundedAt || null,
    refundedAtText: timeText(item.refundedAt),
    cancelledAt: item.cancelledAt || null,
    cancelledAtText: timeText(item.cancelledAt),
    cancelledBy: item.cancelledBy || '',
    cancellationReason: item.cancellationReason || '',
  };
}

async function findOrderForUser(db, userId, orderId) {
  if (!orderId) return null;
  const res = await db.collection(COLLECTIONS.ORDERS).where({ _id: orderId, userId }).get();
  return (res.data || [])[0] || null;
}

async function findUser(db, userId) {
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  return (res.data || [])[0] || null;
}

/**
 * 退款资格不能只信 users.lastReminderCreatedAt 的一次回填：
 * 任务已创建但用户记录回填失败时，仍要从提醒任务本身拿到真实使用时间。
 */
async function refundEvidenceUser(db, userId, knownUser = null) {
  const [user, latestTaskRes] = await Promise.all([
    knownUser ? Promise.resolve(knownUser) : findUser(db, userId),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  ]);
  if (!user) return null;
  const latestTask = (latestTaskRes.data || [])[0] || null;
  const latestMs = Math.max(
    dateMs(user.lastReminderCreatedAt || 0),
    dateMs(latestTask && latestTask.createdAt)
  );
  return {
    ...user,
    lastReminderCreatedAt: latestMs ? new Date(latestMs) : null,
  };
}

async function casesForOrder(db, userId, orderId) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ userId, orderId })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  return res.data || [];
}

async function existingActiveCase(db, userId, orderId) {
  const order = await findOrderForUser(db, userId, orderId);
  if (order && order.activeAfterSalesCaseId) {
    const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ _id: order.activeAfterSalesCaseId, userId, orderId }).get();
    const bound = (res.data || [])[0];
    if (bound && ACTIVE_CASE_STATUSES.has(bound.status)) return bound;
  }
  return (await casesForOrder(db, userId, orderId))
    .find(item => ACTIVE_CASE_STATUSES.has(item.status)) || null;
}

async function hasAnyCaseForOrder(db, userId, orderId) {
  return !!(await casesForOrder(db, userId, orderId)).length;
}

function duplicateTargetOf(orders = []) {
  const paid = orders
    .filter(item => item && item._id
      && isLiveEntitlement(item)
      && dateMs(item.paidAt || item.createdAt))
    .sort((a, b) => dateMs(b.paidAt || b.createdAt) - dateMs(a.paidAt || a.createdAt));
  for (const candidate of paid) {
    const candidateMs = dateMs(candidate.paidAt || candidate.createdAt);
    const other = paid.find(item => item._id !== candidate._id
      && Math.abs(candidateMs - dateMs(item.paidAt || item.createdAt)) <= DUPLICATE_WINDOW_MS);
    if (other) {
      return {
        duplicate: true,
        targetOrderId: candidate._id,
        targetOutTradeNo: candidate.outTradeNo || '',
        otherOrderId: other._id,
        otherOutTradeNo: other.outTradeNo || '',
        olderOrderId: other._id,
        olderOutTradeNo: other.outTradeNo || '',
        windowMinutes: Math.floor(DUPLICATE_WINDOW_MS / 60000),
      };
    }
  }
  return { duplicate: false, windowMinutes: Math.floor(DUPLICATE_WINDOW_MS / 60000) };
}

async function duplicateEvidence(db, order) {
  if (!order || !order.userId || !order.packageId) return { duplicate: false };
  const res = await db.collection(COLLECTIONS.ORDERS)
    .where({ userId: order.userId, packageId: order.packageId, status: OrderStatus.PAID })
    .get();
  const target = duplicateTargetOf((res.data || []).filter(isLiveEntitlement));
  return target.targetOrderId === order._id
    ? target
    : { ...target, duplicate: false, currentOrderIsNewest: false };
}

/**
 * 支付成功后按“同用户 + 同商品 + 10 分钟内两笔已支付”找出需要核验的最新订单。
 * 即使回调先到的是较早订单，后一次回调也能把整组中的较新订单送入自动退款队列。
 */
async function duplicateChargeTarget(db, seedOrder) {
  if (!seedOrder || !seedOrder.userId || !seedOrder.packageId) return { duplicate: false };
  const res = await db.collection(COLLECTIONS.ORDERS)
    .where({ userId: seedOrder.userId, packageId: seedOrder.packageId, status: OrderStatus.PAID })
    .get();
  return duplicateTargetOf((res.data || []).filter(isLiveEntitlement));
}

async function createCaseRecord(db, userId, event = {}, evidence = {}) {
  const type = event.type;
  if (!Object.values(CaseType).includes(type)) return fail(ERRORS.BAD_PARAM);
  const requestId = requestIdOf(event);
  if (!requestId) return fail(ERRORS.BAD_PARAM);
  const order = await findOrderForUser(db, userId, event.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (type !== CaseType.RIGHTS_NOT_RECEIVED && order.status !== OrderStatus.PAID) {
    return fail({
      code: ERRORS.REFUND_NOT_ELIGIBLE.code,
      message: '订单尚未确认支付，请先同步支付结果或提交权益未到账申请',
    });
  }
  const requestHash = requestHashOf(userId, order._id, requestId);
  const caseId = caseIdOfRequest(requestHash);
  const existingRequest = await documentDataOrNull(
    db.collection(COLLECTIONS.AFTER_SALES_CASES).doc(caseId)
  );
  if (existingRequest) {
    if (existingRequest.userId !== userId
      || existingRequest.orderId !== order._id
      || existingRequest.type !== type) {
      return fail(ERRORS.BAD_PARAM);
    }
    return ok({ case: caseViewOf(existingRequest), idempotent: true });
  }
  const active = await existingActiveCase(db, userId, order._id);
  if (active && active._id !== caseId) return fail(ERRORS.AFTER_SALES_EXISTS);

  const user = await refundEvidenceUser(db, userId);
  if (!user) return fail(ERRORS.UNAUTHORIZED);
  const eligibility = refundEligibilityOf(order, user);
  if (type === CaseType.UNUSED_REFUND && !eligibility.eligibleForReview) {
    return fail({
      code: ERRORS.REFUND_NOT_ELIGIBLE.code,
      message: eligibility.usedAfterPurchase
        ? '支付后已新增提醒，当前不符合未使用退款条件'
        : '已超过 24 小时或订单当前不可退款',
    }, { eligibility });
  }

  const nowTs = new Date();
  const status = [CaseType.RIGHTS_NOT_RECEIVED, CaseType.DUPLICATE_CHARGE].includes(type)
    ? CaseStatus.AUTO_CHECKING
    : CaseStatus.UNDER_REVIEW;
  const doc = {
    _id: caseId,
    caseNo: makeCaseNo(nowTs),
    userId,
    orderId: order._id,
    outTradeNo: order.outTradeNo,
    title: order.title || '会员提醒名额',
    amountFen: Number(order.amountFen) || 0,
    productType: order.productType || '',
    packageId: order.packageId || '',
    requestIdHash: requestHash,
    type,
    priority: String(evidence.priority || (
      [CaseType.RIGHTS_NOT_RECEIVED, CaseType.DUPLICATE_CHARGE].includes(type) ? 'HIGH' : 'NORMAL'
    )).slice(0, 20),
    reasonCode: String(event.reasonCode || type).slice(0, 50),
    description: String(event.description || '').trim().slice(0, 1000),
    status,
    refundStatus: RefundStatus.NONE,
    outRefundNo: '',
    decisionNote: '',
    reviewerOpenId: '',
    evidence: {
      ...evidence,
      eligibility,
    },
    createdAt: nowTs,
    updatedAt: nowTs,
  };
  const refundStatus = type === CaseType.UNUSED_REFUND
    ? RefundStatus.UNDER_REVIEW
    : (type === CaseType.DUPLICATE_CHARGE ? RefundStatus.REQUESTED : null);
  let outcome = null;
  await db.runTransaction(async transaction => {
    const sameRequest = await documentDataOrNull(
      transaction.collection(COLLECTIONS.AFTER_SALES_CASES).doc(caseId)
    );
    if (sameRequest) {
      if (sameRequest.userId !== userId
        || sameRequest.orderId !== order._id
        || sameRequest.type !== type) {
        outcome = fail(ERRORS.BAD_PARAM);
        return;
      }
      outcome = ok({ case: caseViewOf(sameRequest), idempotent: true });
      return;
    }

    const currentOrder = docDataOf(await transaction.collection(COLLECTIONS.ORDERS)
      .doc(order._id).get());
    if (!currentOrder || currentOrder.userId !== userId) {
      outcome = fail(ERRORS.ORDER_NOT_FOUND);
      return;
    }
    if (currentOrder.refundStatus === RefundStatus.REFUNDED
      || currentOrder.status === OrderStatus.REFUNDED
      || currentOrder.grantStatus === 'REVERTED') {
      outcome = fail(ERRORS.AFTER_SALES_EXISTS);
      return;
    }
    if (type !== CaseType.RIGHTS_NOT_RECEIVED && currentOrder.status !== OrderStatus.PAID) {
      outcome = fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: '订单当前不可申请退款',
      });
      return;
    }
    if (currentOrder.activeAfterSalesCaseId) {
      const bound = await documentDataOrNull(
        transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
          .doc(currentOrder.activeAfterSalesCaseId)
      );
      if (bound && ACTIVE_CASE_STATUSES.has(bound.status)) {
        outcome = fail(ERRORS.AFTER_SALES_EXISTS);
        return;
      }
    }

    // _id 由 doc(id) 指定，不能再作为文档内容传给 set。
    const { _id: caseDocumentId, ...caseData } = doc;
    await transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
      .doc(caseDocumentId)
      .set({ data: caseData });
    const orderPatch = {
      activeAfterSalesCaseId: caseId,
      updatedAt: nowTs,
    };
    if (refundStatus && ![
      RefundStatus.REFUNDED,
      RefundStatus.PROCESSING,
      RefundStatus.UNDER_REVIEW,
    ].includes(currentOrder.refundStatus)) {
      orderPatch.refundStatus = refundStatus;
    }
    await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({ data: orderPatch });
    outcome = ok({ case: caseViewOf(doc) });
  }, 3);
  return outcome || fail({ code: 1500, message: '售后申请提交失败' });
}

/**
 * Apple 退款由用户在 App Store 发起，系统可能先收到最终退款结果而没有用户售后单。
 * 使用退款单号派生稳定 _id，重复或在途推送都落到同一条记录。
 */
async function createPlatformRefundCase(db, order = {}, outRefundNo = '', details = {}) {
  if (!order._id || !order.userId || !outRefundNo) {
    throw new Error('平台退款售后记录缺少订单或退款单号');
  }
  const nowTs = new Date();
  const alreadyRefunded = order.refundStatus === RefundStatus.REFUNDED
    || order.status === OrderStatus.REFUNDED;
  const existingRes = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ outRefundNo })
    .get();
  const existing = (existingRes.data || [])[0];
  if (existing) {
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        ...(!alreadyRefunded ? { refundStatus: RefundStatus.PROCESSING } : {}),
        ...(ACTIVE_CASE_STATUSES.has(existing.status)
          ? { activeAfterSalesCaseId: existing._id }
          : {}),
        outRefundNo,
        updatedAt: nowTs,
      },
    });
    return existing;
  }

  const requestedChannel = String(details.paymentChannel || '').toUpperCase();
  const paymentChannel = ['APPLE', 'WECHAT_VIRTUAL', 'WECHAT_PAY'].includes(requestedChannel)
    ? requestedChannel
    : paymentChannelOf(order);
  const doc = {
    _id: platformRefundCaseIdOf(outRefundNo),
    caseNo: makeCaseNo(nowTs),
    userId: order.userId,
    orderId: order._id,
    outTradeNo: order.outTradeNo || '',
    title: order.title || '会员提醒名额',
    amountFen: Number(order.amountFen) || 0,
    productType: order.productType || '',
    packageId: order.packageId || '',
    requestIdHash: '',
    type: CaseType.OTHER,
    priority: 'HIGH',
    reasonCode: 'PLATFORM_REFUND_NOTIFY',
    description: '平台退款结果已确认，系统自动补建售后记录。',
    status: CaseStatus.PROCESSING,
    refundStatus: RefundStatus.PROCESSING,
    outRefundNo,
    decisionNote: '',
    reviewerOpenId: '',
    systemGenerated: true,
    evidence: {
      ...details,
      systemGenerated: true,
      paymentProvider: String(order.paymentProvider || ''),
      paymentChannel,
    },
    createdAt: nowTs,
    updatedAt: nowTs,
  };
  let result = doc;
  await db.runTransaction(async transaction => {
    const currentOrder = docDataOf(await transaction.collection(COLLECTIONS.ORDERS)
      .doc(order._id).get());
    if (!currentOrder) throw new Error('平台退款订单不存在');
    const same = await documentDataOrNull(
      transaction.collection(COLLECTIONS.AFTER_SALES_CASES).doc(doc._id)
    );
    if (same) {
      result = same;
      if (ACTIVE_CASE_STATUSES.has(same.status)) {
        await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
          data: { activeAfterSalesCaseId: same._id, outRefundNo, updatedAt: nowTs },
        });
      }
      return;
    }
    if (currentOrder.activeAfterSalesCaseId) {
      const bound = await documentDataOrNull(
        transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
          .doc(currentOrder.activeAfterSalesCaseId)
      );
      if (bound && ACTIVE_CASE_STATUSES.has(bound.status)) {
        result = bound;
        await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
          data: { outRefundNo, updatedAt: nowTs },
        });
        return;
      }
    }
    const { _id: platformCaseId, ...platformCaseData } = doc;
    await transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
      .doc(platformCaseId)
      .set({ data: platformCaseData });
    await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        ...(!alreadyRefunded ? { refundStatus: RefundStatus.PROCESSING } : {}),
        activeAfterSalesCaseId: doc._id,
        outRefundNo,
        updatedAt: nowTs,
      },
    });
  }, 3);
  return result;
}

async function listUserCases(db, userId) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ items: (res.data || []).map(caseViewOf) });
}

async function getCaseForUser(db, userId, caseId) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ _id: caseId, userId })
    .get();
  const item = (res.data || [])[0];
  if (!item) return fail(ERRORS.CASE_NOT_FOUND);
  return ok({ item: caseViewOf(item) });
}

async function userCaseHistory(db, userId, orderId, limit = 20) {
  if (!userId) return { items: [], stats: {} };
  const activeValues = [...ACTIVE_CASE_STATUSES];
  const [latestRes, totalRes, refundedRes, rejectedRes, cancelledRes, activeRes, sameOrderRes] = await Promise.all([
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get(),
    db.collection(COLLECTIONS.AFTER_SALES_CASES).where({ userId }).count(),
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ userId, status: CaseStatus.REFUNDED })
      .count(),
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ userId, status: CaseStatus.REJECTED })
      .count(),
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ userId, status: CaseStatus.CANCELLED })
      .count(),
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({ userId, status: db.command.in(activeValues) })
      .count(),
    orderId
      ? db.collection(COLLECTIONS.AFTER_SALES_CASES).where({ userId, orderId }).count()
      : Promise.resolve({ total: 0 }),
  ]);
  return {
    items: (latestRes.data || []).map(caseViewOf),
    stats: {
      total: Number(totalRes.total) || 0,
      refunded: Number(refundedRes.total) || 0,
      rejected: Number(rejectedRes.total) || 0,
      cancelled: Number(cancelledRes.total) || 0,
      active: Number(activeRes.total) || 0,
      sameOrder: Number(sameOrderRes.total) || 0,
    },
  };
}

async function listCasesForAdmin(db, status = '') {
  let query = db.collection(COLLECTIONS.AFTER_SALES_CASES);
  if (status && Object.values(CaseStatus).includes(status)) {
    query = query.where({ status });
  }
  const res = await query.orderBy('createdAt', 'desc').limit(100).get();
  return ok({
    items: (res.data || []).map(caseViewOf),
    count: (res.data || []).length,
  });
}

async function countActiveCases(db) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ status: db.command.in([...ACTIVE_CASE_STATUSES]) })
    .count();
  return Number(res.total) || 0;
}

async function countFundingBlockedCases(db) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ status: CaseStatus.REFUND_FAILED, fundingBlocked: true })
    .count();
  return Number(res.total) || 0;
}

async function getCaseById(db, caseId) {
  if (!caseId) return null;
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES).where({ _id: caseId }).get();
  return (res.data || [])[0] || null;
}

async function updateCase(db, caseId, patch = {}) {
  const nowTs = new Date();
  await db.collection(COLLECTIONS.AFTER_SALES_CASES).doc(caseId).update({
    data: { ...patch, updatedAt: nowTs },
  });
  const fresh = await getCaseById(db, caseId);
  if (fresh && fresh.orderId && isTerminalCaseStatus(fresh.status)) {
    await db.collection(COLLECTIONS.ORDERS).where({
      _id: fresh.orderId,
      activeAfterSalesCaseId: caseId,
    }).update({
      data: { activeAfterSalesCaseId: '', updatedAt: nowTs },
    });
  }
  return fresh;
}

async function cancelCaseForUser(db, userId, caseId, options = {}) {
  const expectedStatus = String(options.expectedStatus || '');
  let outcome = null;
  await db.runTransaction(async transaction => {
    const current = docDataOf(await transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
      .doc(caseId).get());
    if (!current || current.userId !== userId) {
      outcome = fail(ERRORS.CASE_NOT_FOUND);
      return;
    }
    if (current.status === CaseStatus.CANCELLED) {
      outcome = ok({ case: caseViewOf(current), idempotent: true });
      return;
    }
    if (!USER_CANCELLABLE_CASE_STATUSES.has(current.status)) {
      outcome = fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: current.status === CaseStatus.PROCESSING
          ? '退款已发起，当前不能取消售后'
          : '当前售后状态不能取消',
      });
      return;
    }
    if (expectedStatus && current.status !== expectedStatus) {
      outcome = fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: '售后状态已更新，请刷新后重试',
      });
      return;
    }

    const order = docDataOf(await transaction.collection(COLLECTIONS.ORDERS)
      .doc(current.orderId).get());
    if (!order || order.userId !== userId) {
      outcome = fail(ERRORS.ORDER_NOT_FOUND);
      return;
    }
    if (order.status === OrderStatus.REFUNDED
      || order.refundStatus === RefundStatus.REFUNDED
      || order.refundStatus === RefundStatus.PROCESSING
      || order.grantStatus === GrantStatus.REVERTED) {
      outcome = fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: '退款已处理或正在处理，当前不能取消售后',
      });
      return;
    }

    const nowTs = new Date();
    const casePatch = {
      status: CaseStatus.CANCELLED,
      refundStatus: RefundStatus.NONE,
      statusBeforeCancellation: current.status,
      refundStatusBeforeCancellation: current.refundStatus || RefundStatus.NONE,
      cancelledAt: nowTs,
      cancelledBy: 'USER',
      cancellationReason: '用户主动取消',
      fundingBlocked: false,
      fundingBlockedAt: null,
      updatedAt: nowTs,
    };
    await transaction.collection(COLLECTIONS.AFTER_SALES_CASES).doc(caseId).update({
      data: casePatch,
    });
    const orderPatch = { updatedAt: nowTs };
    if (order.activeAfterSalesCaseId === caseId) orderPatch.activeAfterSalesCaseId = '';
    if (![RefundStatus.REFUNDED, RefundStatus.PROCESSING].includes(order.refundStatus)) {
      orderPatch.refundStatus = RefundStatus.NONE;
    }
    await transaction.collection(COLLECTIONS.ORDERS).doc(current.orderId).update({
      data: orderPatch,
    });
    outcome = ok({ case: caseViewOf({ ...current, ...casePatch }) });
  }, 3);
  return outcome || fail({ code: ERRORS.SERVER_ERROR.code, message: '取消售后失败，请稍后重试' });
}

async function logAdminAction(db, adminId, action, caseItem, details = {}) {
  await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: adminId,
      action,
      caseId: caseItem && caseItem._id ? caseItem._id : '',
      orderId: caseItem && caseItem.orderId ? caseItem.orderId : '',
      details,
      createdAt: new Date(),
    },
  });
}

async function markRefundProcessing(db, caseItem, outRefundNo, refundStatus = 'PROCESSING') {
  let marked = false;
  await db.runTransaction(async transaction => {
    const current = docDataOf(await transaction.collection(COLLECTIONS.AFTER_SALES_CASES)
      .doc(caseItem._id).get());
    if (!current || ![CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW, CaseStatus.REFUND_FAILED]
      .includes(current.status)) {
      return;
    }
    const order = docDataOf(await transaction.collection(COLLECTIONS.ORDERS)
      .doc(current.orderId).get());
    if (!order || order.status !== OrderStatus.PAID
      || order.refundStatus === RefundStatus.REFUNDED
      || order.grantStatus === GrantStatus.REVERTED) {
      return;
    }
    const nowTs = new Date();
    await transaction.collection(COLLECTIONS.AFTER_SALES_CASES).doc(current._id).update({
      data: {
        status: CaseStatus.PROCESSING,
        refundStatus: RefundStatus.PROCESSING,
        outRefundNo,
        approvedAt: current.approvedAt || nowTs,
        refundRequestStatus: refundStatus,
        failureReason: '',
        failureCode: '',
        fundingBlocked: false,
        fundingBlockedAt: null,
        updatedAt: nowTs,
      },
    });
    await transaction.collection(COLLECTIONS.ORDERS).doc(current.orderId).update({
      data: {
        refundStatus: RefundStatus.PROCESSING,
        outRefundNo,
        activeAfterSalesCaseId: current._id,
        updatedAt: nowTs,
      },
    });
    marked = true;
  }, 3);
  return marked;
}

module.exports = {
  DEFAULT_ADMIN_OPENIDS,
  CASE_TYPE_LABEL,
  CASE_STATUS_LABEL,
  ACTIVE_CASE_STATUSES,
  USER_CANCELLABLE_CASE_STATUSES,
  adminOpenIdsOf,
  isAfterSalesAdmin,
  outRefundNoOf,
  paymentChannelOf,
  systemRequestIdOf,
  platformRefundCaseIdOf,
  makeCaseNo,
  timeText,
  refundEligibilityOf,
  caseViewOf,
  findOrderForUser,
  findUser,
  refundEvidenceUser,
  casesForOrder,
  existingActiveCase,
  hasAnyCaseForOrder,
  duplicateEvidence,
  duplicateChargeTarget,
  createCaseRecord,
  createPlatformRefundCase,
  listUserCases,
  getCaseForUser,
  listCasesForAdmin,
  countActiveCases,
  countFundingBlockedCases,
  userCaseHistory,
  getCaseById,
  updateCase,
  cancelCaseForUser,
  logAdminAction,
  markRefundProcessing,
};
