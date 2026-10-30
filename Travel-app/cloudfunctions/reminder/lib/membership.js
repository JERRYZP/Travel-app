/**
 * 会员与提醒名额规则（2026-10-27）
 *
 * 这里是小程序端唯一可以消费的提醒名额口径：
 * - 免费用户最多保留 5 个未来待发送提醒任务；
 * - 3 元会员有效 30 天，会员期内任务上限变为 10 个；
 * - 会员每加购 1 个 3 元名额包，记录 5 个提醒名额，会员期内生效；
 * - 会员到期后，已购名额记录不删除但不生效，已有提醒任务继续发送。
 *
 * “已用提醒名额”只统计仍会发送的 WAITING 新增任务。迁移前历史任务进入
 * 独立保护池，不挤占免费/会员/加购名额；已触发、未送达和已关闭任务不占新名额。
 */

const {
  COLLECTIONS, ERRORS, MemberLevel, OrderStatus, ReminderBackendStatus, ok, fail,
} = require('./schema');
const time = require('./time');

const FREE_TASK_SLOTS = 5;
const MEMBER_TASK_SLOTS = 10;
const TASK_PACK_SIZE = 5;
const TASK_PACK_PRICE_FEN = 300;
const MEMBER_PRICE_FEN = 300;
const MEMBER_DURATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_QUOTA_POOL = Object.freeze({
  PROTECTED: 'PROTECTED',
  ENTITLEMENT: 'ENTITLEMENT',
});
const ENFORCEMENT_OFF = 'off';
const ENFORCEMENT_TEST = 'test';
const ENFORCEMENT_ALL = 'all';
const DEFAULT_ENFORCEMENT_MODE = ENFORCEMENT_TEST;
const DEFAULT_TEST_OPENIDS = Object.freeze([
  'oZ6IFxvYK1mKzBaehMcOPIl_CgN0',
  'oZ6IFxi1K98ihzn5DH6KP5Jx9_bs',
]);
const ORDER_STATUS_LABEL = {
  PENDING: '待支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUNDED: '已退款',
};
const ORDER_REFUND_STATUS_LABEL = {
  NONE: '',
  REQUESTED: '售后处理中',
  UNDER_REVIEW: '退款审核中',
  PROCESSING: '退款处理中',
  REFUNDED: '已退款',
  REJECTED: '退款未通过',
  FAILED: '退款异常',
};
const SAME_PACKAGE_PENDING_REUSE_MS = 15 * 60 * 1000;
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

const PACKAGES = Object.freeze([
  {
    id: 'member',
    type: 'MEMBER',
    title: '会员 30 天',
    priceFen: MEMBER_PRICE_FEN,
    priceText: '¥3',
    taskSlots: MEMBER_TASK_SLOTS,
    addedSlots: MEMBER_TASK_SLOTS - FREE_TASK_SLOTS,
    memberDays: MEMBER_DURATION_DAYS,
    description: '30 天内最多 10 个提醒名额',
    badge: '推荐',
  },
  {
    id: 'task_pack_5',
    type: 'TASK_PACK',
    title: '5 个提醒名额',
    priceFen: TASK_PACK_PRICE_FEN,
    priceText: '¥3',
    taskSlots: TASK_PACK_SIZE,
    addedSlots: TASK_PACK_SIZE,
    memberDays: 0,
    description: '名额永久记录，会员有效期内生效',
    badge: '',
  },
]);

function packageOf(packageId) {
  return PACKAGES.find(item => item.id === packageId) || null;
}

/**
 * 会员限制灰度：
 * - off：完全保持旧版免费行为；
 * - test：只限制 MEMBERSHIP_TEST_OPENIDS（缺省为内部测试账号）；
 * - all：全部用户启用会员提醒名额限制。
 *
 * 未配置时默认 test；配置值非法时回退为 off，避免拼写错误把未发布功能扩散到全量用户。
 */
function enforcementModeOf() {
  const raw = String(process.env.MEMBERSHIP_ENFORCEMENT_MODE || DEFAULT_ENFORCEMENT_MODE)
    .trim()
    .toLowerCase();
  if ([ENFORCEMENT_OFF, ENFORCEMENT_TEST, ENFORCEMENT_ALL].includes(raw)) return raw;
  return ENFORCEMENT_OFF;
}

function testOpenIdsOf() {
  const raw = String(process.env.MEMBERSHIP_TEST_OPENIDS || '').trim();
  const values = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_TEST_OPENIDS;
  return new Set(values);
}

function shouldEnforceFor(userId) {
  const mode = enforcementModeOf();
  if (mode === ENFORCEMENT_ALL) return true;
  if (mode === ENFORCEMENT_OFF) return false;
  return testOpenIdsOf().has(userId);
}

function activeTaskOf(task, nowTs) {
  if (!task || task.backendStatus !== ReminderBackendStatus.WAITING) return false;
  const releaseMs = new Date(task.releaseAt).getTime();
  return Number.isFinite(releaseMs) && releaseMs > new Date(nowTs).getTime();
}

function countActiveTasks(tasks, nowTs = time.now()) {
  return (tasks || []).filter(task => activeTaskOf(task, nowTs)).length;
}

/**
 * 历史保护池与免费/会员/加购池彼此独立。
 * 新任务是否受会员限制，以创建时该用户是否已进入 test/all 灰度为准：
 * - off，或 test 模式下不在白名单：任务进入历史保护池，不计新增额度；
 * - test 白名单 / all：任务进入新增池，占用免费、会员或加购名额。
 * 旧任务没有 quotaPool 字段，一律按历史保护池兼容，避免审核等待期误收费。
 */
function quotaPoolOfTask(task = {}) {
  if (task.quotaPool === TASK_QUOTA_POOL.PROTECTED) return TASK_QUOTA_POOL.PROTECTED;
  if (task.quotaPool === TASK_QUOTA_POOL.ENTITLEMENT) return TASK_QUOTA_POOL.ENTITLEMENT;
  return TASK_QUOTA_POOL.PROTECTED;
}

/** 新建提醒时确定池别；只有真正进入会员限制的用户才占新增池。 */
function newTaskQuotaPoolOf(userId) {
  return shouldEnforceFor(userId)
    ? TASK_QUOTA_POOL.ENTITLEMENT
    : TASK_QUOTA_POOL.PROTECTED;
}

/**
 * 改提醒配置会删除并重建任务。旧任务的池别必须显式继承，
 * 否则历史保护任务会因新的 createdAt 被误算成会员新增任务。
 */
function quotaPoolOfExistingTask(task) {
  if (!task) return TASK_QUOTA_POOL.ENTITLEMENT;
  if (task.quotaPool === TASK_QUOTA_POOL.PROTECTED
    || task.quotaPool === TASK_QUOTA_POOL.ENTITLEMENT) return task.quotaPool;
  return quotaPoolOfTask(task);
}

function expiryMsOf(user = {}) {
  return new Date(user.memberExpiresAt || 0).getTime();
}

function isMemberAt(user, nowTs = time.now()) {
  const expiryMs = expiryMsOf(user);
  return Number.isFinite(expiryMs) && expiryMs > new Date(nowTs).getTime();
}

function memberExpiryText(expiresAt) {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const p = time.beijingParts(new Date(ms));
  return `${p.year}年${p.month}月${p.day}日`;
}

function orderTimeText(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const p = time.beijingParts(new Date(ms));
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${p.year}年${p.month}月${p.day}日 ${hh}:${mm}`;
}

function amountTextOf(amountFen) {
  const fen = Math.max(0, Number(amountFen) || 0);
  return `¥${(fen / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function refundEligibilityOf(order = {}, user = {}, nowTs = time.now()) {
  const paidMs = new Date(order.paidAt || 0).getTime();
  const nowMs = new Date(nowTs).getTime();
  const lastCreatedMs = new Date(user.lastReminderCreatedAt || 0).getTime();
  const hoursSincePaid = paidMs > 0 && nowMs >= paidMs
    ? Math.floor((nowMs - paidMs) / (60 * 60 * 1000))
    : null;
  const refundStatus = order.refundStatus || (order.status === OrderStatus.REFUNDED
    ? 'REFUNDED' : 'NONE');
  const inProgress = ['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'].includes(refundStatus);
  const alreadyRefunded = refundStatus === 'REFUNDED' || order.status === OrderStatus.REFUNDED;
  return {
    withinWindow: paidMs > 0 && nowMs - paidMs <= REFUND_WINDOW_MS,
    usedAfterPurchase: paidMs > 0 && lastCreatedMs > paidMs,
    alreadyRefunded,
    refundInProgress: inProgress,
    hoursSincePaid,
    eligible: order.status === OrderStatus.PAID
      && paidMs > 0
      && nowMs - paidMs <= REFUND_WINDOW_MS
      && !(lastCreatedMs > paidMs)
      && !alreadyRefunded
      && !inProgress,
  };
}

function orderDisplayTitleOf(order = {}) {
  if (order.productType === 'TASK_PACK') {
    const slots = Math.max(0, Number(order.addedSlots) || TASK_PACK_SIZE);
    return `${slots} 个提醒名额`;
  }
  if (order.productType === 'MEMBER') return '会员 30 天';
  return order.title || '会员服务';
}

function orderActionsOf(order = {}, eligibility = {}, nowTs = time.now()) {
  const refundStatus = order.refundStatus || (order.status === OrderStatus.REFUNDED
    ? 'REFUNDED' : 'NONE');
  const pendingExpired = order.status === OrderStatus.PENDING && isExpiredOrder(order, nowTs);
  const canAfterSales = order.status === OrderStatus.PAID
    && ['NONE', 'REQUESTED', 'UNDER_REVIEW', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED'].includes(refundStatus);
  const canSync = order.status === OrderStatus.PAID
    && ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus);
  const actionFlags = {
    canPay: order.status === OrderStatus.PENDING && !pendingExpired,
    canCancel: order.status === OrderStatus.PENDING && !pendingExpired,
    canSync,
    canAfterSales,
    canRebuy: order.status === OrderStatus.CLOSED || pendingExpired,
    afterSalesLabel: ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus) ? '未到账/申请售后' : '查看售后进度',
  };
  const actions = [];
  if (actionFlags.canPay) actions.push({ key: 'PAY', label: '继续支付' });
  if (actionFlags.canCancel) actions.push({ key: 'CANCEL', label: '取消订单' });
  if (actionFlags.canSync) actions.push({ key: 'SYNC', label: '同步支付结果' });
  if (actionFlags.canAfterSales) {
    actions.push({
      key: 'AFTER_SALES',
      label: ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus) ? '未到账/申请售后' : '查看售后进度',
    });
  }
  if (actionFlags.canRebuy) actions.push({ key: 'REBUY', label: '重新购买' });
  return { actions, actionFlags, canRequestRefund: eligibility.eligible === true };
}

function isExpiredOrder(order = {}, nowTs = time.now()) {
  const expiresAt = new Date(order.expiresAt || 0).getTime();
  if (expiresAt) return expiresAt <= new Date(nowTs).getTime();
  const created = new Date(order.createdAt || 0).getTime();
  return !!created && created + SAME_PACKAGE_PENDING_REUSE_MS <= new Date(nowTs).getTime();
}

function orderViewOf(order = {}, user = {}, nowTs = time.now()) {
  const refundStatus = order.refundStatus || (order.status === OrderStatus.REFUNDED
    ? 'REFUNDED' : 'NONE');
  const eligibility = refundEligibilityOf(order, user, nowTs);
  const actionState = orderActionsOf(order, eligibility, nowTs);
  return {
    _id: order._id,
    outTradeNo: order.outTradeNo || '',
    packageId: order.packageId || '',
    productType: order.productType || '',
    title: orderDisplayTitleOf(order),
    amountFen: Math.max(0, Number(order.amountFen) || 0),
    amountText: amountTextOf(order.amountFen),
    addedSlots: Math.max(0, Number(order.addedSlots) || 0),
    memberDays: Math.max(0, Number(order.memberDays) || 0),
    status: order.status || OrderStatus.PENDING,
    statusLabel: ORDER_STATUS_LABEL[order.status] || '处理中',
    refundStatus,
    refundStatusLabel: ORDER_REFUND_STATUS_LABEL[refundStatus] || '',
    refundAmountFen: Math.max(0, Number(order.refundedAmountFen) || 0),
    refundedAtText: orderTimeText(order.refundedAt),
    grantStatus: order.grantStatus || (order.status === OrderStatus.PAID ? 'GRANTED' : 'NONE'),
    entitlementStatus: order.refundStatus === 'REFUNDED' || order.grantStatus === 'REVERTED'
      ? 'REFUNDED'
      : (order.status === OrderStatus.PAID
        ? (order.grantStatus === 'FAILED' ? 'PAID_GRANT_FAILED' : 'PAID_GRANTED')
        : (order.status === OrderStatus.CLOSED ? 'CLOSED' : 'PENDING')),
    entitlementGrant: order.entitlementGrant ? {
      beforeExpiresAt: order.entitlementGrant.beforeExpiresAt || null,
      afterExpiresAt: order.entitlementGrant.afterExpiresAt || null,
      memberDaysAddedMs: Math.max(0, Number(order.entitlementGrant.memberDaysAddedMs) || 0),
      taskPackDelta: Math.max(0, Number(order.entitlementGrant.taskPackDelta) || 0),
      appliedAt: order.entitlementGrant.appliedAt || null,
      revertedAt: order.entitlementGrant.revertedAt || null,
    } : null,
    canRequestRefund: actionState.canRequestRefund,
    isExpired: order.status === OrderStatus.PENDING && isExpiredOrder(order, nowTs),
    refundEligibility: eligibility,
    actions: actionState.actions,
    actionFlags: actionState.actionFlags,
    createdAt: order.createdAt || null,
    createdAtText: orderTimeText(order.createdAt),
    expiresAt: order.expiresAt || null,
    paidAt: order.paidAt || null,
    paidAtText: orderTimeText(order.paidAt),
  };
}

/** 用户资料容错：会员是否生效只看 memberExpiresAt。 */
function normalizeUser(user = {}, nowTs = time.now()) {
  const isMember = isMemberAt(user, nowTs);
  const purchasedPackCount = Math.max(0, parseInt(user.taskPackCount, 10) || 0);
  const taskPackCount = isMember ? purchasedPackCount : 0;
  const memberExpiresAt = user.memberExpiresAt || null;
  const memberExpiresMs = expiryMsOf(user);
  const nowMs = new Date(nowTs).getTime();
  const protectedTaskQuota = Math.max(
    FREE_TASK_SLOTS,
    parseInt(user.protectedTaskQuota, 10) || FREE_TASK_SLOTS
  );
  const entitlementTaskLimit = FREE_TASK_SLOTS
    + (isMember ? MEMBER_TASK_SLOTS - FREE_TASK_SLOTS : 0)
    + taskPackCount * TASK_PACK_SIZE;
  return {
    member: isMember,
    memberLevel: isMember ? MemberLevel.MEMBER : MemberLevel.NORMAL,
    memberExpiresAt,
    memberExpiresAtText: memberExpiryText(memberExpiresAt),
    memberDaysRemaining: isMember
      ? Math.max(1, Math.ceil((memberExpiresMs - nowMs) / DAY_MS))
      : 0,
    taskLimit: entitlementTaskLimit,
    entitlementTaskLimit,
    protectedTaskQuota,
    taskPackCount,
    ownedTaskPackCount: purchasedPackCount,
    memberDurationDays: MEMBER_DURATION_DAYS,
    freeTaskSlots: FREE_TASK_SLOTS,
    memberTaskSlots: MEMBER_TASK_SLOTS,
    taskPackSize: TASK_PACK_SIZE,
  };
}

function snapshotFromTasks(user, tasks, nowTs = time.now()) {
  const base = normalizeUser(user, nowTs);
  const activeTasks = (tasks || []).filter(task => activeTaskOf(task, nowTs));
  const protectedTaskUsed = activeTasks
    .filter(task => quotaPoolOfTask(task) === TASK_QUOTA_POOL.PROTECTED)
    .length;
  const taskUsed = activeTasks.length - protectedTaskUsed;
  return {
    ...base,
    taskUsed,
    protectedTaskUsed,
    entitlementTaskUsed: taskUsed,
    protectedTaskQuota: Math.max(base.protectedTaskQuota, protectedTaskUsed),
    taskRemaining: Math.max(0, base.taskLimit - taskUsed),
  };
}

function packageViews(snapshot) {
  return PACKAGES.map(item => {
    const isMemberPackage = item.type === 'MEMBER';
    const available = isMemberPackage ? true : snapshot.member;
    return {
      ...item,
      available,
      actionText: isMemberPackage
        ? (snapshot.member ? '续费 30 天 ¥3' : '开通会员 ¥3')
        : (snapshot.member ? '加购 5 个名额 ¥3' : '先开通会员'),
    };
  });
}

async function status(db, userId, nowTs = time.now()) {
  const [userRes, taskRes, latestTaskRes] = await Promise.all([
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({
        userId,
        backendStatus: ReminderBackendStatus.WAITING,
        releaseAt: db.command.gt(nowTs),
      })
      .get(),
    // 退款“是否使用过”的证据必须覆盖历史任务，不能只看未来 WAITING。
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  ]);

  const user = (userRes.data || [])[0] || {};
  const activeTasks = taskRes.data || [];
  const activeCount = countActiveTasks(activeTasks, nowTs);
  const latestTask = (latestTaskRes.data || [])[0] || null;
  const inferredLastCreated = Math.max(
    new Date(latestTask && latestTask.createdAt || 0).getTime() || 0,
    activeTasks.reduce((latest, task) => {
      const ms = new Date(task.createdAt || 0).getTime();
      return Number.isFinite(ms) && ms > latest ? ms : latest;
    }, 0)
  );
  const migrationPatch = {};
  if (user.protectedTaskQuota == null && user._id) {
    migrationPatch.protectedTaskQuota = Math.max(FREE_TASK_SLOTS, activeCount);
  }
  if (!user.protectionMigratedAt && user._id) {
    migrationPatch.protectionMigratedAt = nowTs;
  }
  if (user.lastReminderCreatedAt == null && inferredLastCreated && user._id) {
    migrationPatch.lastReminderCreatedAt = new Date(inferredLastCreated);
  }
  if (Object.keys(migrationPatch).length > 0) {
    await db.collection(COLLECTIONS.USERS).doc(user._id).update({ data: migrationPatch });
    Object.assign(user, migrationPatch);
  }
  const snapshot = snapshotFromTasks(user, activeTasks, nowTs);
  return ok({
    membership: snapshot,
    packages: packageViews(snapshot),
  });
}

/**
 * 创建任务前校验容量。返回 null 表示允许；否则返回统一失败结构。
 * 所有会新建提醒任务的入口都必须调用本函数。
 */
async function capacityError(db, userId, neededTasks, nowTs = time.now()) {
  const needed = Math.max(0, Number(neededTasks) || 0);
  if (needed === 0) return null;
  if (!shouldEnforceFor(userId)) return null;

  const res = await status(db, userId, nowTs);
  const membership = res.membership;
  if (needed <= membership.taskRemaining) return null;

  return fail(ERRORS.TASK_LIMIT_EXCEEDED, {
    membership,
    taskLimit: {
      limit: membership.taskLimit,
      used: membership.taskUsed,
      remaining: membership.taskRemaining,
      requested: needed,
      shortfall: Math.max(0, needed - membership.taskRemaining),
    },
    packages: res.packages,
  });
}

function makeOutTradeNo(nowTs = time.now()) {
  const stamp = nowTs.getTime().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `T${stamp}${random}`.slice(0, 32);
}

async function createOrder(db, userId, { packageId } = {}) {
  const pkg = packageOf(packageId);
  if (!pkg) return fail(ERRORS.BAD_PARAM);

  const current = await status(db, userId);
  const membership = current.membership;
  if (pkg.type === 'TASK_PACK' && !membership.member) return fail(ERRORS.MEMBERSHIP_REQUIRED);

  const nowTs = time.now();
  const recentRes = await db.collection(COLLECTIONS.ORDERS)
    .where({ userId, packageId: pkg.id, status: OrderStatus.PENDING })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  const pendingOrders = recentRes.data || [];
  const expiredPending = pendingOrders.filter(order => isExpiredOrder(order, nowTs));
  const stalePending = pendingOrders
    .filter(order => isExpiredOrder(order, nowTs) || order.amountFen !== pkg.priceFen)
    .map(order => ({
      order,
      closeReason: isExpiredOrder(order, nowTs) ? 'EXPIRED_LOCAL' : 'PRICE_CHANGED',
    }));
  await Promise.all(stalePending.map(({ order, closeReason }) =>
    // 只允许关闭仍为 PENDING 的订单；若支付回调已并发置为 PAID，不能覆盖支付结果。
    db.collection(COLLECTIONS.ORDERS).where({
      _id: order._id,
      status: OrderStatus.PENDING,
    }).update({
      data: {
        status: OrderStatus.CLOSED,
        closedAt: nowTs,
        closeReason,
        updatedAt: nowTs,
      },
    })
  ));
  const reusable = pendingOrders.find(order =>
    !isExpiredOrder(order, nowTs)
    && order.amountFen === pkg.priceFen
  );
  if (reusable) {
    return ok({
      orderId: reusable._id,
      outTradeNo: reusable.outTradeNo,
      amountFen: reusable.amountFen,
      packageId: reusable.packageId,
      title: reusable.title,
      reused: true,
    });
  }

  const outTradeNo = makeOutTradeNo(nowTs);
  const order = {
    userId,
    outTradeNo,
    packageId: pkg.id,
    productType: pkg.type,
    title: pkg.title,
    body: `智序准点游-${pkg.title}`,
    amountFen: pkg.priceFen,
    addedSlots: pkg.addedSlots,
    memberDays: pkg.memberDays,
    memberFloorDays: pkg.type === 'TASK_PACK' ? MEMBER_DURATION_DAYS : 0,
    status: OrderStatus.PENDING,
    refundStatus: 'NONE',
    grantStatus: 'NONE',
    createdAt: nowTs,
    expiresAt: new Date(nowTs.getTime() + SAME_PACKAGE_PENDING_REUSE_MS),
    paidAt: null,
  };
  const added = await db.collection(COLLECTIONS.ORDERS).add({ data: order });
  return ok({
    orderId: added._id,
    outTradeNo,
    amountFen: pkg.priceFen,
    packageId: pkg.id,
    title: pkg.title,
  });
}

/** 当前用户的会员 / 提醒名额订单，最多 50 条，按创建时间倒序。 */
/** 在真正新建提醒任务后写入，作为“支付后是否已使用新增权益”的唯一事实。 */
async function markReminderCreated(db, userId, nowTs = time.now()) {
  if (!userId) return;
  try {
    await db.collection(COLLECTIONS.USERS).where({ openId: userId }).update({
      data: { lastReminderCreatedAt: nowTs },
    });
  } catch (err) {
    // 提醒任务已提交，不能用一次证据时间回填失败把用户操作判成整体失败。
    // 支付售后侧还会从 reminder_tasks.createdAt 复核，避免漏掉真实使用记录。
    console.error('[membership] lastReminderCreatedAt update failed', {
      userId,
      message: err.message,
    });
  }
}

async function listOrders(db, userId) {
  const [orderRes, userRes, latestTaskRes] = await Promise.all([
    db.collection(COLLECTIONS.ORDERS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  ]);
  const storedUser = (userRes.data || [])[0] || {};
  const latestTask = (latestTaskRes.data || [])[0] || null;
  const latestCreatedMs = Math.max(
    new Date(storedUser.lastReminderCreatedAt || 0).getTime() || 0,
    new Date(latestTask && latestTask.createdAt || 0).getTime() || 0
  );
  const user = {
    ...storedUser,
    lastReminderCreatedAt: latestCreatedMs ? new Date(latestCreatedMs) : null,
  };
  const nowTs = time.now();
  const items = (orderRes.data || []).map(order => orderViewOf(order, user, nowTs));
  return ok({
    items,
    count: items.length,
  });
}

/** 当前用户单笔订单；详情页不能靠客户端从最近 50 条里自行查找。 */
async function orderDetail(db, userId, orderId) {
  if (!orderId) return fail(ERRORS.ORDER_NOT_FOUND);
  const [orderRes, userRes, latestTaskRes] = await Promise.all([
    db.collection(COLLECTIONS.ORDERS).where({ _id: orderId, userId }).get(),
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  ]);
  const order = (orderRes.data || [])[0];
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const storedUser = (userRes.data || [])[0] || {};
  const latestTask = (latestTaskRes.data || [])[0] || null;
  const latestCreatedMs = Math.max(
    new Date(storedUser.lastReminderCreatedAt || 0).getTime() || 0,
    new Date(latestTask && latestTask.createdAt || 0).getTime() || 0
  );
  const user = {
    ...storedUser,
    lastReminderCreatedAt: latestCreatedMs ? new Date(latestCreatedMs) : null,
  };
  return ok({ item: orderViewOf(order, user, time.now()) });
}

module.exports = {
  FREE_TASK_SLOTS,
  MEMBER_TASK_SLOTS,
  TASK_PACK_SIZE,
  MEMBER_PRICE_FEN,
  TASK_PACK_PRICE_FEN,
  MEMBER_DURATION_DAYS,
  TASK_QUOTA_POOL,
  PACKAGES,
  packageOf,
  enforcementModeOf,
  shouldEnforceFor,
  DEFAULT_TEST_OPENIDS,
  isMemberAt,
  normalizeUser,
  countActiveTasks,
  quotaPoolOfTask,
  newTaskQuotaPoolOf,
  quotaPoolOfExistingTask,
  snapshotFromTasks,
  packageViews,
  status,
  capacityError,
  createOrder,
  listOrders,
  orderDetail,
  markReminderCreated,
  orderViewOf,
  refundEligibilityOf,
  orderDisplayTitleOf,
  orderActionsOf,
  isExpiredOrder,
  SAME_PACKAGE_PENDING_REUSE_MS,
  REFUND_WINDOW_MS,
};
