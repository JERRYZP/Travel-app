/**
 * 会员与提醒名额规则（2026-10-27）
 *
 * 这里是小程序端唯一可以消费的提醒名额口径：
 * - 免费用户最多保留 5 个未来待发送提醒任务；
 * - 现有 unlimited-v3 契约继续保留；
 * - two-tier-v5 白名单使用 3 元 / 10 个额度与 4.9 元 / 不限额度两档；
 * - 3 元档超额只允许补 1.9 元升级为不限额度；
 * - 提醒加量包已停售，历史订单和退款快照继续兼容；
 * - 会员到期后回到免费 5 个提醒名额，已有提醒任务继续发送。
 *
 * “已用提醒名额”只统计仍会发送的 WAITING 新增任务。迁移前历史任务进入
 * 独立保护池，不挤占免费/会员名额；已触发、未送达和已关闭任务不占新名额。
 */

const crypto = require('crypto');
const {
  COLLECTIONS, ERRORS, MemberLevel, OrderStatus, ReminderBackendStatus, ok, fail,
} = require('./schema');
const time = require('./time');
const userDomain = require('./user');
const quotaLock = require('./quota-lock');
const membershipSales = require('./membership-sales');
const membershipEnforcement = require('./membership-enforcement');
const membershipPricing = require('./membership-pricing');
const upgradeNotice = require('./membership-upgrade-notice');
const membershipCredit = require('./membership-credit');

const FREE_TASK_SLOTS = 5;
const MEMBER_TASK_SLOTS = 10;
const MEMBER_PRICE_FEN = 600;
const TWO_TIER_MEMBER_PRICE_FEN = 300;
const TWO_TIER_UNLIMITED_PRICE_FEN = 490;
const TWO_TIER_UPGRADE_PRICE_FEN = 190;
const LEGACY_MEMBER_PRICE_FEN = 300;
const LEGACY_MEMBER_TASK_SLOTS = 15;
const LEGACY_CURRENT_TASK_PACK_SIZE = 10;
const MEMBER_DURATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UPGRADE_MIN_REMAINING_MS = 15 * 60 * 1000;
const UPGRADE_WARNING_WINDOW_MS = 5 * DAY_MS;
const SAME_EXPIRY_TOLERANCE_MS = 1000;
const LEGACY_TASK_PACK_SIZE = 5;
const MEMBERSHIP_CAPABILITY_UNLIMITED_V3 = 'unlimited-v3';
const MEMBERSHIP_CAPABILITY_TWO_TIER_V5 = 'two-tier-v5';
/* 仅用于旧客户端兼容：旧版本仍读取有限数字并据此做前端预检。 */
const LEGACY_CLIENT_UNLIMITED_TASK_LIMIT = 10000;
const ORDER_GRANT_SCHEMA_VERSION = 2;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const PlanVersion = Object.freeze({
  LEGACY: 'legacy-v2',
  UNLIMITED: 'unlimited-v3',
  TWO_TIER: 'two-tier-v5',
});
const MemberTier = Object.freeze({
  LEGACY_UNLIMITED: 'LEGACY_UNLIMITED',
  QUOTA_10: 'QUOTA_10',
  UNLIMITED: 'UNLIMITED',
});
const PaymentChannel = Object.freeze({
  APPLE: 'APPLE',
  WECHAT_VIRTUAL: 'WECHAT_VIRTUAL',
  WECHAT_PAY: 'WECHAT_PAY',
});
const APPLE_VIRTUAL_ORDER_TYPES = Object.freeze([7, 8]);
const TASK_QUOTA_POOL = Object.freeze({
  PROTECTED: 'PROTECTED',
  ENTITLEMENT: 'ENTITLEMENT',
});
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
    priceText: '¥6',
    taskSlots: 0,
    addedSlots: 0,
    unlimitedReminders: true,
    memberDays: MEMBER_DURATION_DAYS,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: '会员有效期内不限提醒名额',
    badge: '推荐',
    specVersion: 'member-unlimited-30d-v4',
  },
]);

const TWO_TIER_PACKAGES = Object.freeze([
  {
    id: 'member_quota_10',
    type: 'MEMBER',
    membershipTier: MemberTier.QUOTA_10,
    title: '10 个提醒名额 · 30 天',
    priceFen: TWO_TIER_MEMBER_PRICE_FEN,
    priceText: '¥3',
    taskSlots: MEMBER_TASK_SLOTS,
    addedSlots: MEMBER_TASK_SLOTS - FREE_TASK_SLOTS,
    unlimited: false,
    upgrade: false,
    memberDays: MEMBER_DURATION_DAYS,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: `30 天内最多 ${MEMBER_TASK_SLOTS} 个提醒名额`,
    badge: '',
    specVersion: 'member-quota-10-30d-v3',
  },
  {
    id: 'member_unlimited',
    type: 'MEMBER',
    membershipTier: MemberTier.UNLIMITED,
    title: '不限提醒名额 · 30 天',
    priceFen: TWO_TIER_UNLIMITED_PRICE_FEN,
    priceText: '¥4.9',
    taskSlots: null,
    addedSlots: 0,
    unlimited: true,
    upgrade: false,
    memberDays: MEMBER_DURATION_DAYS,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: '30 天内不限提醒名额',
    badge: '',
    specVersion: 'member-unlimited-30d-v5',
  },
  {
    id: 'member_unlimited_upgrade',
    type: 'MEMBER',
    membershipTier: MemberTier.UNLIMITED,
    title: '升级不限提醒名额',
    priceFen: TWO_TIER_UPGRADE_PRICE_FEN,
    priceText: '¥1.9',
    taskSlots: null,
    addedSlots: 0,
    unlimited: true,
    upgrade: true,
    memberDays: 0,
    memberFloorDays: 0,
    description: '补差价升级，仅当前会员期内生效，不延长有效期',
    badge: '',
    specVersion: 'member-unlimited-upgrade-v4',
  },
]);

const LEGACY_PACKAGES = Object.freeze([
  {
    id: 'member',
    type: 'MEMBER',
    title: '会员 30 天',
    priceFen: LEGACY_MEMBER_PRICE_FEN,
    priceText: '¥3',
    taskSlots: LEGACY_MEMBER_TASK_SLOTS,
    addedSlots: LEGACY_MEMBER_TASK_SLOTS - FREE_TASK_SLOTS,
    unlimitedReminders: false,
    memberDays: MEMBER_DURATION_DAYS,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: `30 天内最多 ${LEGACY_MEMBER_TASK_SLOTS} 个提醒名额`,
    badge: '推荐',
    specVersion: 'member-30d-v2',
  },
  {
    id: 'task_pack_5',
    type: 'TASK_PACK',
    title: `${LEGACY_CURRENT_TASK_PACK_SIZE} 个提醒名额`,
    priceFen: LEGACY_MEMBER_PRICE_FEN,
    priceText: '¥3',
    taskSlots: LEGACY_CURRENT_TASK_PACK_SIZE,
    addedSlots: LEGACY_CURRENT_TASK_PACK_SIZE,
    unlimitedReminders: false,
    memberDays: 0,
    memberFloorDays: MEMBER_DURATION_DAYS,
    description: '名额永久记录，会员有效期内生效',
    badge: '',
    specVersion: 'task-pack-10-v2',
  },
]);

function packagesForPlan(planVersion = PlanVersion.LEGACY) {
  if (planVersion === PlanVersion.TWO_TIER) return TWO_TIER_PACKAGES;
  if (planVersion === PlanVersion.UNLIMITED) return PACKAGES;
  return LEGACY_PACKAGES;
}

function packageOf(packageId, options = {}) {
  const planVersion = options.planVersion
    || (options.newPlan === true ? PlanVersion.UNLIMITED : PlanVersion.LEGACY);
  return packagesForPlan(planVersion)
    .find(item => item.id === packageId) || null;
}

/**
 * 会员限制灰度：
 * - off：完全保持旧版免费行为；
 * - test：只限制 MEMBERSHIP_TEST_OPENIDS（缺省为内部测试账号）；
 * - all：全部用户启用会员提醒名额限制。
 *
 * 运行期由 payment_config/membership_enforcement 控制；配置缺失或读取失败时
 * 回退 MEMBERSHIP_ENFORCEMENT_MODE，未配置默认 test，非法环境变量回退 off。
 */
function enforcementModeOf() {
  return membershipEnforcement.envModeOf();
}

function enforcementState(db, options = {}) {
  return membershipEnforcement.read(db, options);
}

function testOpenIdsOf() {
  const raw = String(process.env.MEMBERSHIP_TEST_OPENIDS || '').trim();
  const values = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_TEST_OPENIDS;
  return new Set(values);
}

/**
 * 会员方案灰度与额度限制解耦：
 * - 客户端必须显式声明 unlimited-v3，未声明时永远返回旧契约；
 * - MEMBERSHIP_ENFORCEMENT_MODE=test：仅 MEMBERSHIP_TEST_OPENIDS 可使用新会员方案；
 * - all：所有声明能力的客户端可使用新会员方案；
 * - off 或缺失：保持旧会员方案。
 *
 * 数据库 membership_enforcement 仍决定额度限制模式，本函数只决定返回哪套商品和权益。
 * 能力只接受固定版本标识，不接受 `newPlan=true` 之类布尔参数；它用于契约兼容路由，
 * 不是权限凭证，真实价格与权益仍由服务端规则决定。
 */
function hasMembershipCapability(source, capability) {
  const values = Array.isArray(source)
    ? source
    : (source && Array.isArray(source.membershipCapabilities)
      ? source.membershipCapabilities
      : []);
  return values.some(value => String(value) === capability);
}

function isNewPlanEnabledFor(userId, source = {}) {
  if (!hasMembershipCapability(source, MEMBERSHIP_CAPABILITY_UNLIMITED_V3)) return false;
  const mode = enforcementModeOf();
  if (mode === 'all') return true;
  if (mode === 'test' && userId) return testOpenIdsOf().has(userId);
  return false;
}

/**
 * 两档会员是独立定价契约，不受会员限制模式 all 影响。
 * membership_pricing=test 时只看测试名单；=all 时所有声明能力的新客户端开放。
 */
function isTwoTierPlanEnabledFor(userId, source = {}, pricingState = null) {
  if (!userId) return false;
  if (!hasMembershipCapability(source, MEMBERSHIP_CAPABILITY_TWO_TIER_V5)) return false;
  if (membershipPricing.isAll(pricingState)) return true;
  return testOpenIdsOf().has(userId);
}

function planVersionFor(userId, source = {}, pricingState = null) {
  if (isTwoTierPlanEnabledFor(userId, source, pricingState)) return PlanVersion.TWO_TIER;
  if (isNewPlanEnabledFor(userId, source)) return PlanVersion.UNLIMITED;
  return PlanVersion.LEGACY;
}

function shouldEnforceFor(userId) {
  return membershipEnforcement.shouldEnforceForMode(
    enforcementModeOf(),
    userId,
    testOpenIdsOf()
  );
}

function shouldEnforceForState(state, userId) {
  const mode = state && state.mode
    ? state.mode
    : enforcementModeOf();
  return membershipEnforcement.shouldEnforceForMode(mode, userId, testOpenIdsOf());
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
 * 历史保护池与免费/会员新增池彼此独立。
 * 新任务是否受会员限制，以创建时该用户是否已进入 test/all 灰度为准：
 * - off，或 test 模式下不在白名单：任务进入历史保护池，不计新增额度；
 * - test 白名单 / all：任务进入新增池，按免费或会员规则校验。
 * 旧任务没有 quotaPool 字段，一律按历史保护池兼容，避免审核等待期误收费。
 */
function quotaPoolOfTask(task = {}) {
  if (task.quotaPool === TASK_QUOTA_POOL.PROTECTED) return TASK_QUOTA_POOL.PROTECTED;
  if (task.quotaPool === TASK_QUOTA_POOL.ENTITLEMENT) return TASK_QUOTA_POOL.ENTITLEMENT;
  return TASK_QUOTA_POOL.PROTECTED;
}

/** 新建提醒时确定池别；只有真正进入会员限制的用户才占新增池。 */
function newTaskQuotaPoolOf(userId, enforcement) {
  const enforced = enforcement
    ? shouldEnforceForState(enforcement, userId)
    : shouldEnforceFor(userId);
  return enforced
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

function effectiveMemberTierOf(user = {}, nowTs = time.now()) {
  if (!isMemberAt(user, nowTs)) return '';
  const raw = String(user.memberTier || '').trim().toUpperCase();
  if (raw === MemberTier.QUOTA_10 || raw === MemberTier.UNLIMITED) return raw;
  // 两档方案上线前已经生效、没有档位字段的会员继续按不限权益保护。
  return MemberTier.LEGACY_UNLIMITED;
}

function isUnlimitedTier(tier) {
  return tier === MemberTier.LEGACY_UNLIMITED || tier === MemberTier.UNLIMITED;
}

function sameExpiryWindow(a, b) {
  const aMs = new Date(a || 0).getTime();
  const bMs = new Date(b || 0).getTime();
  return Math.abs(aMs - bMs) <= SAME_EXPIRY_TOLERANCE_MS;
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
  return `¥${(fen / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`;
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
    const slots = Math.max(0, Number(order.addedSlots) || LEGACY_TASK_PACK_SIZE);
    return `${slots} 个提醒名额`;
  }
  if (order.productType === 'MEMBER') {
    if (order.membershipTier === MemberTier.UNLIMITED) {
      return order.upgrade ? '升级不限提醒名额' : '不限提醒名额 · 30 天';
    }
    if (order.membershipTier === MemberTier.QUOTA_10) return '10 个提醒名额 · 30 天';
    return order.title || '会员 30 天';
  }
  return order.title || '会员服务';
}

function orderActionsOf(order = {}, eligibility = {}, nowTs = time.now(), sales = null) {
  const refundStatus = order.refundStatus || (order.status === OrderStatus.REFUNDED
    ? 'REFUNDED' : 'NONE');
  const pendingExpired = order.status === OrderStatus.PENDING && isExpiredOrder(order, nowTs);
  const purchaseEnabled = !sales || sales.purchaseEnabled === true;
  const creditConverted = eligibility.convertedToCredit === true
    || (order.entitlementGrant && order.entitlementGrant.creditConverted === true);
  const canAfterSales = !creditConverted && order.status === OrderStatus.PAID
    && ['NONE', 'REQUESTED', 'UNDER_REVIEW', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED'].includes(refundStatus);
  const canSync = !creditConverted && order.status === OrderStatus.PAID
    && ['NONE', 'REJECTED', 'FAILED'].includes(refundStatus);
  const actionFlags = {
    canPay: purchaseEnabled && order.status === OrderStatus.PENDING && !pendingExpired,
    canCancel: order.status === OrderStatus.PENDING && !pendingExpired,
    canSync,
    canAfterSales,
    canRebuy: purchaseEnabled && (order.status === OrderStatus.CLOSED || pendingExpired),
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

function paymentChannelOf(order = {}) {
  const provider = String(order.paymentProvider || '').toUpperCase();
  const rawOrderType = order.channelOrderType != null
    ? order.channelOrderType
    : (order.paymentResult && order.paymentResult.channelOrderType);
  const channelOrderType = Number(rawOrderType);
  if (APPLE_VIRTUAL_ORDER_TYPES.includes(channelOrderType)) {
    return PaymentChannel.APPLE;
  }
  if (provider === 'VIRTUAL_PAY' || order.virtualEnv != null || Number.isFinite(channelOrderType)) {
    return PaymentChannel.WECHAT_VIRTUAL;
  }
  return PaymentChannel.WECHAT_PAY;
}

function orderViewOf(order = {}, user = {}, nowTs = time.now(), sales = null) {
  const orderGrant = order.entitlementGrant || {};
  const refundStatus = order.refundStatus || (order.status === OrderStatus.REFUNDED
    ? 'REFUNDED' : 'NONE');
  const creditConverted = orderGrant.creditConverted === true;
  const refunded = refundStatus === 'REFUNDED'
    || order.grantStatus === 'REVERTED'
    || order.status === OrderStatus.REFUNDED;
  const entitlementStatus = creditConverted
    ? 'CREDITED'
    : refunded
    ? 'REFUNDED'
    : (order.status === OrderStatus.PAID
      ? (order.grantStatus === 'FAILED'
        ? 'PAID_GRANT_FAILED'
        : (order.grantStatus === 'GRANTED' ? 'PAID_GRANTED' : 'PAID_GRANT_UNKNOWN'))
      : (order.status === OrderStatus.CLOSED ? 'CLOSED' : 'PENDING'));
  const baseEligibility = refundEligibilityOf(order, user, nowTs);
  const eligibility = {
    ...baseEligibility,
    convertedToCredit: creditConverted,
    eligible: creditConverted ? false : baseEligibility.eligible,
  };
  const actionState = orderActionsOf(order, eligibility, nowTs, sales);
  return {
    _id: order._id,
    outTradeNo: order.outTradeNo || '',
    packageId: order.packageId || '',
    productType: order.productType || '',
    planVersion: order.planVersion || '',
    membershipTier: order.membershipTier || '',
    unlimited: order.unlimited === true,
    unlimitedReminders: order.unlimitedReminders === true
      || order.unlimited === true,
    upgrade: order.upgrade === true,
    creditConverted,
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
    paymentChannel: paymentChannelOf(order),
    grantStatus: order.grantStatus || (order.status === OrderStatus.PAID ? 'UNKNOWN' : 'NONE'),
    entitlementStatus,
    entitlementGrant: order.entitlementGrant ? {
      beforeExpiresAt: order.entitlementGrant.beforeExpiresAt || null,
      afterExpiresAt: order.entitlementGrant.afterExpiresAt || null,
      memberDaysAddedMs: Math.max(0, Number(order.entitlementGrant.memberDaysAddedMs) || 0),
      taskPackDelta: Math.max(0, Number(order.entitlementGrant.taskPackDelta) || 0),
      unlimitedReminders: orderGrant.unlimitedReminders === true
        || order.unlimitedReminders === true
        || order.unlimited === true,
      creditConverted,
      creditId: orderGrant.creditId || '',
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

function normalizeTwoTierUser(user = {}, nowTs = time.now()) {
  const isMember = isMemberAt(user, nowTs);
  const memberTier = effectiveMemberTierOf(user, nowTs);
  const unlimited = isMember && isUnlimitedTier(memberTier);
  const legacyUnlimited = isMember && memberTier === MemberTier.LEGACY_UNLIMITED;
  const purchasedPackCount = Math.max(0, parseInt(user.taskPackCount, 10) || 0);
  const purchasedPackSlots = user.taskPackSlots != null
    ? Math.max(0, parseInt(user.taskPackSlots, 10) || 0)
    : purchasedPackCount * LEGACY_TASK_PACK_SIZE;
  const taskPackCount = isMember ? purchasedPackCount : 0;
  const taskPackSlots = isMember ? purchasedPackSlots : 0;
  const memberExpiresAt = user.memberExpiresAt || null;
  const memberExpiresMs = expiryMsOf(user);
  const nowMs = new Date(nowTs).getTime();
  const memberRemainingMs = isMember ? Math.max(0, memberExpiresMs - nowMs) : 0;
  const protectedTaskQuota = Math.max(
    FREE_TASK_SLOTS,
    parseInt(user.protectedTaskQuota, 10) || FREE_TASK_SLOTS
  );
  const entitlementTaskLimit = unlimited
    ? null
    : FREE_TASK_SLOTS
      + (memberTier === MemberTier.QUOTA_10 ? MEMBER_TASK_SLOTS - FREE_TASK_SLOTS : 0)
      + taskPackSlots;
  const memberPlanId = unlimited
    ? (legacyUnlimited ? 'legacy_unlimited' : 'member_unlimited')
    : (memberTier === MemberTier.QUOTA_10 ? 'member_quota_10' : '');
  return {
    member: isMember,
    memberLevel: isMember ? MemberLevel.MEMBER : MemberLevel.NORMAL,
    memberTier,
    memberPlanId,
    memberPlanLabel: unlimited
      ? (legacyUnlimited ? '老会员不限额度' : '不限额度会员')
      : (memberTier === MemberTier.QUOTA_10 ? `${MEMBER_TASK_SLOTS} 个提醒名额` : ''),
    unlimited,
    legacyUnlimited,
    pricingVisible: !unlimited,
    upgradeAvailable: memberTier === MemberTier.QUOTA_10
      && memberRemainingMs > UPGRADE_MIN_REMAINING_MS,
    upgradeShortWindow: memberTier === MemberTier.QUOTA_10
      && memberRemainingMs > UPGRADE_MIN_REMAINING_MS
      && memberRemainingMs < UPGRADE_WARNING_WINDOW_MS,
    upgradeWindowClosed: memberTier === MemberTier.QUOTA_10
      && memberRemainingMs <= UPGRADE_MIN_REMAINING_MS,
    memberExpiresAt,
    memberExpiresAtText: memberExpiryText(memberExpiresAt),
    memberDaysRemaining: isMember
      ? Math.max(1, Math.ceil((memberExpiresMs - nowMs) / DAY_MS))
      : 0,
    memberRemainingMs,
    taskLimitUnlimited: unlimited,
    planVersion: PlanVersion.TWO_TIER,
    taskLimit: entitlementTaskLimit,
    entitlementTaskLimit,
    protectedTaskQuota,
    taskPackCount,
    taskPackSlots,
    ownedTaskPackCount: purchasedPackCount,
    ownedTaskPackSlots: purchasedPackSlots,
    memberDurationDays: MEMBER_DURATION_DAYS,
    freeTaskSlots: FREE_TASK_SLOTS,
    memberTaskSlots: MEMBER_TASK_SLOTS,
    taskPackSize: 0,
    quotaPlanPriceText: amountTextOf(TWO_TIER_MEMBER_PRICE_FEN),
    unlimitedPlanPriceText: amountTextOf(TWO_TIER_UNLIMITED_PRICE_FEN),
    upgradePlanPriceText: amountTextOf(TWO_TIER_UPGRADE_PRICE_FEN),
    upgradeCreditAvailable: false,
    upgradeCreditPending: false,
    upgradeCreditText: '',
    upgradeCreditSourceOrderId: '',
    upgradeCreditPendingOrderId: '',
  };
}

/** 用户资料容错：会员是否生效只看 memberExpiresAt。 */
function normalizeUser(user = {}, nowTs = time.now(), options = {}) {
  const planVersion = options.planVersion
    || (options.newPlan === true ? PlanVersion.UNLIMITED : PlanVersion.LEGACY);
  if (planVersion === PlanVersion.TWO_TIER) return normalizeTwoTierUser(user, nowTs);

  const isMember = isMemberAt(user, nowTs);
  const purchasedPackCount = Math.max(0, parseInt(user.taskPackCount, 10) || 0);
  const purchasedPackSlots = user.taskPackSlots != null
    ? Math.max(0, parseInt(user.taskPackSlots, 10) || 0)
    : purchasedPackCount * LEGACY_TASK_PACK_SIZE;
  const taskPackCount = isMember ? purchasedPackCount : 0;
  const taskPackSlots = isMember ? purchasedPackSlots : 0;
  const memberExpiresAt = user.memberExpiresAt || null;
  const memberExpiresMs = expiryMsOf(user);
  const nowMs = new Date(nowTs).getTime();
  const protectedTaskQuota = Math.max(
    FREE_TASK_SLOTS,
    parseInt(user.protectedTaskQuota, 10) || FREE_TASK_SLOTS
  );
  const unlimited = planVersion === PlanVersion.UNLIMITED && isMember;
  const entitlementTaskLimit = unlimited
    ? LEGACY_CLIENT_UNLIMITED_TASK_LIMIT
    : FREE_TASK_SLOTS
      + (isMember ? LEGACY_MEMBER_TASK_SLOTS - FREE_TASK_SLOTS : 0)
      + taskPackSlots;
  return {
    member: isMember,
    memberLevel: isMember ? MemberLevel.MEMBER : MemberLevel.NORMAL,
    memberTier: unlimited ? MemberTier.LEGACY_UNLIMITED : '',
    memberPlanId: unlimited ? 'legacy_unlimited' : (isMember ? 'legacy_member_15' : ''),
    memberPlanLabel: unlimited ? '现有不限额度会员' : (isMember ? '15 个提醒名额' : ''),
    unlimited,
    legacyUnlimited: unlimited,
    pricingVisible: true,
    upgradeAvailable: false,
    upgradeShortWindow: false,
    upgradeWindowClosed: false,
    memberExpiresAt,
    memberExpiresAtText: memberExpiryText(memberExpiresAt),
    memberDaysRemaining: isMember
      ? Math.max(1, Math.ceil((memberExpiresMs - nowMs) / DAY_MS))
      : 0,
    memberRemainingMs: isMember ? Math.max(0, memberExpiresMs - nowMs) : 0,
    taskLimitUnlimited: unlimited,
    planVersion,
    taskLimit: entitlementTaskLimit,
    entitlementTaskLimit,
    protectedTaskQuota,
    taskPackCount,
    taskPackSlots,
    ownedTaskPackCount: purchasedPackCount,
    ownedTaskPackSlots: purchasedPackSlots,
    memberDurationDays: MEMBER_DURATION_DAYS,
    freeTaskSlots: FREE_TASK_SLOTS,
    memberTaskSlots: unlimited ? LEGACY_CLIENT_UNLIMITED_TASK_LIMIT : LEGACY_MEMBER_TASK_SLOTS,
    taskPackSize: unlimited ? 0 : LEGACY_CURRENT_TASK_PACK_SIZE,
  };
}

function snapshotFromTasks(user, tasks, nowTs = time.now(), options = {}) {
  const base = normalizeUser(user, nowTs, options);
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
    taskRemaining: base.taskLimit == null
      ? null
      : Math.max(0, base.taskLimit - taskUsed),
  };
}

function packageViews(snapshot, sales = null, planVersion = PlanVersion.LEGACY) {
  const purchaseEnabled = !sales || sales.purchaseEnabled === true;
  if (planVersion === PlanVersion.TWO_TIER) {
    let items = TWO_TIER_PACKAGES;
    if (snapshot.upgradeCreditAvailable && !snapshot.member) {
      items = TWO_TIER_PACKAGES.filter(item => item.id === 'member_quota_10');
    } else if (snapshot.unlimited) {
      items = [];
    } else if (snapshot.memberTier === MemberTier.QUOTA_10) {
      items = TWO_TIER_PACKAGES.filter(item => item.upgrade);
    } else {
      items = TWO_TIER_PACKAGES.filter(item => !item.upgrade);
    }
    return items.map(item => {
      const upgradeTooShort = item.upgrade
        && snapshot.memberRemainingMs <= UPGRADE_MIN_REMAINING_MS;
      const creditPending = snapshot.upgradeCreditPending
        && item.id === 'member_quota_10';
      const available = purchaseEnabled && !upgradeTooShort && !creditPending;
      return {
        ...item,
        upgradeCreditApplied: snapshot.upgradeCreditAvailable
          && item.id === 'member_quota_10',
        available,
        actionText: !purchaseEnabled
          ? (sales && sales.message) || '会员购买暂停中'
          : (upgradeTooShort
            ? '会员即将到期，请到期后重新开通'
            : (creditPending
              ? '升级权益确认中，请到会员订单继续支付'
            : (item.upgrade
              ? `补 ${item.priceText} 升级不限额度`
              : (snapshot.member
                ? `续费 ${item.memberDays} 天 ${item.priceText}`
                : `开通 ${item.memberDays} 天 ${item.priceText}`)))),
      };
    });
  }
  const newPlan = planVersion === PlanVersion.UNLIMITED;
  return packagesForPlan(planVersion).map(item => {
    const isMemberPackage = item.type === 'MEMBER';
    const available = purchaseEnabled && (newPlan ? isMemberPackage : (isMemberPackage || snapshot.member));
    return {
      ...item,
      available,
      actionText: !purchaseEnabled
        ? (sales && sales.message) || '会员购买暂停中'
        : (newPlan
          ? (snapshot.member
            ? `续费 ${item.memberDays} 天 ${item.priceText}`
            : `开通会员 ${item.priceText}`)
          : (isMemberPackage
            ? (snapshot.member
              ? `续费 ${item.memberDays} 天 ${item.priceText}`
              : `开通会员 ${item.priceText}`)
            : (snapshot.member
              ? `加购 ${item.addedSlots} 个名额 ${item.priceText}`
              : '先开通会员'))),
    };
  });
}

async function status(db, userId, nowTs = time.now(), options = {}) {
  const pricingState = options.pricingState
    || await membershipPricing.read(db, { cache: options.configCache === true });
  const planVersion = planVersionFor(userId, options, pricingState);
  const enforcementPromise = options.enforcementState
    ? Promise.resolve(options.enforcementState)
    : enforcementState(db, { cache: options.configCache === true });
  const hasUser = Object.prototype.hasOwnProperty.call(options, 'user');
  const hasActiveTasks = Object.prototype.hasOwnProperty.call(options, 'activeTasks');
  const hasLatestTask = Object.prototype.hasOwnProperty.call(options, 'latestTask');
  const noticePromise = options.includeUpgradeNotice
    ? upgradeNotice.read(db, { cache: options.configCache === true })
    : Promise.resolve(null);
  const creditPromise = userId && planVersion === PlanVersion.TWO_TIER
    ? membershipCredit.read(db, userId).catch(() => null)
    : Promise.resolve(null);
  const [userRes, taskRes, latestTaskRes, sales, enforcement, noticeConfig, credit] = await Promise.all([
    hasUser
      ? Promise.resolve({ data: options.user ? [options.user] : [] })
      : db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    hasActiveTasks
      ? Promise.resolve({ data: Array.isArray(options.activeTasks) ? options.activeTasks : [] })
      : db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({
        userId,
        backendStatus: ReminderBackendStatus.WAITING,
        releaseAt: db.command.gt(nowTs),
      })
      .get(),
    // 退款“是否使用过”的证据必须覆盖历史任务，不能只看未来 WAITING。
    hasLatestTask
      ? Promise.resolve({ data: options.latestTask ? [options.latestTask] : [] })
      : db.collection(COLLECTIONS.REMINDER_TASKS)
        .where({ userId })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
    membershipSales.read(db, { cache: options.configCache === true }),
    enforcementPromise,
    noticePromise,
    creditPromise,
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
  const newPlan = planVersion === PlanVersion.UNLIMITED;
  const snapshot = snapshotFromTasks(user, activeTasks, nowTs, { planVersion });
  const creditView = membershipCredit.publicViewOf(credit, nowTs);
  snapshot.upgradeCreditAvailable = creditView.available;
  snapshot.upgradeCreditPending = creditView.pending;
  snapshot.upgradeCreditText = creditView.text;
  snapshot.upgradeCreditSourceOrderId = creditView.sourceOrderId;
  snapshot.upgradeCreditPendingOrderId = creditView.pendingOrderId;
  const salesView = membershipSales.publicView(sales);
  const upgradeNoticeView = upgradeNotice.publicViewOf(noticeConfig, nowTs, {
    newPlan,
    member: snapshot.member,
    memberSince: user.memberSince,
  });
  return ok({
    membership: snapshot,
    packages: packageViews(snapshot, salesView, planVersion),
    sales: salesView,
    enforced: shouldEnforceForState(enforcement, userId),
    ...(upgradeNoticeView ? { upgradeNotice: upgradeNoticeView } : {}),
  });
}

/**
 * 创建任务前校验容量。返回 null 表示允许；否则返回统一失败结构。
 * 所有会新建提醒任务的入口都必须调用本函数。
 */
async function capacityError(db, userId, neededTasks, nowTs = time.now(), options = {}) {
  const needed = Math.max(0, Number(neededTasks) || 0);
  if (needed === 0) return null;
  const enforcement = options.enforcementState
    || await enforcementState(db);
  if (!shouldEnforceForState(enforcement, userId)) return null;

  const res = await status(db, userId, nowTs, {
    enforcementState: enforcement,
    membershipCapabilities: options.membershipCapabilities,
  });
  const membership = res.membership;
  if (membership.taskLimitUnlimited || membership.unlimited) return null;
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
    sales: res.sales,
  });
}

function makeOutTradeNo(nowTs = time.now()) {
  const stamp = nowTs.getTime().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `T${stamp}${random}`.slice(0, 32);
}

function requestIdHashOf(userId, requestId) {
  return crypto.createHash('sha256')
    .update(`${userId}:${requestId}`, 'utf8')
    .digest('hex');
}

function orderIdOfRequest(hash) {
  return `ord_${String(hash).slice(0, 28)}`;
}

function orderSpecMatches(order, pkg, snapshot = null, creditId = '') {
  if (!order) return false;
  const twoTier = order.planVersion === PlanVersion.TWO_TIER;
  return order
    && order.productType === pkg.type
    && order.packageId === pkg.id
    && Number(order.amountFen) === pkg.priceFen
    && Number(order.addedSlots) === pkg.addedSlots
    && Number(order.memberDays) === pkg.memberDays
    && order.specVersion === pkg.specVersion
    && (!twoTier || (
      String(order.membershipTier || '') === String(pkg.membershipTier || '')
      && order.unlimited === (pkg.unlimited === true)
      && order.upgrade === (pkg.upgrade === true)
      && (!pkg.upgrade
        || sameExpiryWindow(order.upgradeExpiresAt, snapshot && snapshot.memberExpiresAt))
      && (pkg.id !== 'member_quota_10'
        || String(order.upgradeCreditId || '') === String(creditId || ''))
    ))
    && (twoTier || (order.unlimitedReminders === true) === (pkg.unlimitedReminders === true));
}

function staleOrderCloseReasonOf(order, pkg, snapshot = null) {
  return Number(order.amountFen) !== pkg.priceFen ? 'PRICE_CHANGED' : 'SPEC_CHANGED';
}

function packageAllowedFor(snapshot, pkg) {
  if (!pkg || snapshot.unlimited) return false;
  if (snapshot.memberTier === MemberTier.QUOTA_10) return pkg.upgrade === true;
  if (snapshot.memberTier === MemberTier.UNLIMITED) {
    return pkg.unlimited === true && pkg.upgrade !== true;
  }
  return pkg.upgrade !== true;
}

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function orderResponseOf(order, reused = false) {
  return ok({
    orderId: order._id,
    outTradeNo: order.outTradeNo,
    amountFen: order.amountFen,
    packageId: order.packageId,
    productType: order.productType,
    planVersion: order.planVersion || '',
    membershipTier: order.membershipTier || '',
    unlimited: order.unlimited === true,
    unlimitedReminders: order.unlimitedReminders === true
      || order.unlimited === true,
    upgrade: order.upgrade === true,
    upgradeCreditApplied: order.upgradeCreditApplied === true,
    upgradeCreditId: order.upgradeCreditId || '',
    title: order.title,
    specVersion: order.specVersion,
    addedSlots: order.addedSlots,
    memberDays: order.memberDays,
    upgradeExpiresAt: order.upgradeExpiresAt || null,
    ...(reused ? { reused: true } : {}),
  });
}

async function createOrder(db, userId, event = {}) {
  const { packageId, requestId } = event;
  const pricingState = await membershipPricing.read(db, { cache: true });
  const planVersion = planVersionFor(userId, event, pricingState);
  const pkg = packageOf(packageId, { planVersion });
  if (!pkg || !REQUEST_ID_PATTERN.test(String(requestId || ''))) return fail(ERRORS.BAD_PARAM);
  const requestHash = requestIdHashOf(userId, requestId);
  const deterministicOrderId = orderIdOfRequest(requestHash);

  return quotaLock.withQuotaLock(db, userId, async () => {
    const current = await status(db, userId, undefined, {
      membershipCapabilities: event.membershipCapabilities,
      pricingState,
    });
    const credit = current.membership.upgradeCreditAvailable
      ? await membershipCredit.read(db, userId)
      : null;
    const creditId = credit ? credit._id : '';
    if (!current.sales || current.sales.purchaseEnabled !== true) {
      return fail(ERRORS.MEMBERSHIP_SALES_PAUSED, {
        sales: current.sales,
      });
    }
    if (pkg.type === 'TASK_PACK' && !current.membership.member) return fail(ERRORS.MEMBERSHIP_REQUIRED);
    if (planVersion === PlanVersion.TWO_TIER) {
      if (creditId && pkg.id === 'member_unlimited') {
        return fail({
          code: ERRORS.BAD_PARAM.code,
          message: '已保留 ¥1.9 升级权益，请选择 3 元档自动升级',
        });
      }
      if (pkg.upgrade
        && current.membership.memberRemainingMs <= UPGRADE_MIN_REMAINING_MS) {
        return fail({
          code: ERRORS.BAD_PARAM.code,
          message: '会员即将到期，请到期后重新开通',
        });
      }
      if (!packageAllowedFor(current.membership, pkg)) {
        return fail({
          code: ERRORS.BAD_PARAM.code,
          message: current.membership.unlimited
            ? '不限额度会员有效期内无需再次购买，到期后再选择新方案'
            : '当前会员方案不支持购买该商品',
        });
      }
    }

    // 同一 requestId 的重试也可能早于用户资料首次落库，先确保支付成功后能找到同一用户。
    const user = await userDomain.ensureUser(db, userId);

    // 云数据库对不存在文档的 doc.get() 会抛错，而且真实错误码会被入口层统一
    // 包装成 1500。按 _id 查询可稳定得到空数组，避免把“首单”误判成服务异常。
    const requestOrderRes = await db.collection(COLLECTIONS.ORDERS)
      .where({ _id: deterministicOrderId })
      .limit(1)
      .get();
    const requestOrder = docDataOf(requestOrderRes);
    if (requestOrder) {
      if (requestOrder.userId !== userId || requestOrder.requestIdHash !== requestHash) {
        return fail(ERRORS.BAD_PARAM);
      }
      if (!orderSpecMatches(requestOrder, pkg, current.membership, creditId)) {
        return fail({ code: ERRORS.BAD_PARAM.code, message: '同一支付请求不能变更商品规格' });
      }
      return orderResponseOf(requestOrder, true);
    }

    const nowTs = time.now();
    const recentRes = await db.collection(COLLECTIONS.ORDERS)
      .where({ userId, packageId: pkg.id, status: OrderStatus.PENDING })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const pendingOrders = recentRes.data || [];
    const stalePending = pendingOrders
      .filter(order => isExpiredOrder(order, nowTs)
        || !orderSpecMatches(order, pkg, current.membership, creditId))
      .map(order => ({
        order,
        closeReason: isExpiredOrder(order, nowTs)
          ? 'EXPIRED_LOCAL'
          : staleOrderCloseReasonOf(order, pkg, current.membership),
      }));
    await Promise.all(stalePending.map(async ({ order, closeReason }) => {
      await db.collection(COLLECTIONS.ORDERS).where({
        _id: order._id,
        status: OrderStatus.PENDING,
      }).update({
        data: {
          status: OrderStatus.CLOSED,
          closedAt: nowTs,
          closeReason,
          updatedAt: nowTs,
        },
      });
      if (order.upgradeCreditId) {
        await membershipCredit.release(db, userId, order._id, nowTs);
      }
    }));
    const reusable = pendingOrders.find(order =>
      !isExpiredOrder(order, nowTs)
      && orderSpecMatches(order, pkg, current.membership, creditId)
    );
    if (reusable) return orderResponseOf(reusable, true);

    const outTradeNo = `T${requestHash.slice(0, 31)}`;
    const order = {
      userId,
      userDocumentId: user._id,
      requestIdHash: requestHash,
      outTradeNo,
      packageId: pkg.id,
      productType: pkg.type,
      specVersion: pkg.specVersion,
      planVersion,
      membershipTier: pkg.membershipTier || '',
      unlimited: pkg.unlimited === true,
      upgrade: pkg.upgrade === true,
      upgradeCreditApplied: !!creditId && pkg.id === 'member_quota_10',
      upgradeCreditId: pkg.id === 'member_quota_10' ? creditId : '',
      title: pkg.title,
      body: `智序准点游-${pkg.title}`,
      amountFen: pkg.priceFen,
      addedSlots: pkg.addedSlots,
      unlimitedReminders: pkg.unlimitedReminders === true,
      memberDays: pkg.memberDays,
      memberFloorDays: pkg.memberFloorDays || 0,
      upgradeExpiresAt: pkg.upgrade ? current.membership.memberExpiresAt : null,
      status: OrderStatus.PENDING,
      refundStatus: 'NONE',
      grantStatus: 'NONE',
      grantSchemaVersion: ORDER_GRANT_SCHEMA_VERSION,
      createdAt: nowTs,
      expiresAt: new Date(nowTs.getTime() + SAME_PACKAGE_PENDING_REUSE_MS),
      paidAt: null,
    };
    await db.collection(COLLECTIONS.ORDERS).doc(deterministicOrderId).set({ data: order });
    if (creditId) {
      const reserved = await membershipCredit.reserve(
        db,
        userId,
        deterministicOrderId,
        order.expiresAt,
        nowTs
      );
      if (!reserved) {
        await db.collection(COLLECTIONS.ORDERS).where({
          _id: deterministicOrderId,
          status: OrderStatus.PENDING,
        }).update({
          data: {
            status: OrderStatus.CLOSED,
            closedAt: nowTs,
            closeReason: 'UPGRADE_CREDIT_BUSY',
            updatedAt: nowTs,
          },
        });
        return fail({
          code: ERRORS.BAD_PARAM.code,
          message: '升级权益正在其他订单中确认，请到会员订单继续支付',
        });
      }
    }
    return orderResponseOf({ _id: deterministicOrderId, ...order });
  });
}

/** 当前用户的会员 / 提醒名额订单，最多 50 条，按创建时间倒序。 */
/** 在真正新建提醒任务后写入，作为“支付后是否已使用新增权益”的唯一事实。 */
async function markReminderCreated(
  db,
  userId,
  nowTs = time.now(),
  { transaction = null, user = null, strict = false } = {}
) {
  if (!userId) return;
  try {
    if (transaction && user && user._id) {
      await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({
        data: { lastReminderCreatedAt: nowTs },
      });
      return;
    }
    await db.collection(COLLECTIONS.USERS).where({ openId: userId }).update({
      data: { lastReminderCreatedAt: nowTs },
    });
  } catch (err) {
    if (strict) throw err;
    // 提醒任务已提交，不能用一次证据时间回填失败把用户操作判成整体失败。
    // 支付售后侧还会从 reminder_tasks.createdAt 复核，避免漏掉真实使用记录。
    console.error('[membership] lastReminderCreatedAt update failed', {
      userId,
      message: err.message,
    });
  }
}

async function listOrders(db, userId) {
  const [orderRes, userRes, latestTaskRes, sales] = await Promise.all([
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
    membershipSales.read(db),
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
  const salesView = membershipSales.publicView(sales);
  const items = (orderRes.data || []).map(order => orderViewOf(order, user, nowTs, salesView));
  return ok({
    items,
    count: items.length,
    sales: salesView,
  });
}

/** 当前用户单笔订单；详情页不能靠客户端从最近 50 条里自行查找。 */
async function orderDetail(db, userId, orderId) {
  if (!orderId) return fail(ERRORS.ORDER_NOT_FOUND);
  const [orderRes, userRes, latestTaskRes, sales] = await Promise.all([
    db.collection(COLLECTIONS.ORDERS).where({ _id: orderId, userId }).get(),
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
    membershipSales.read(db),
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
  const salesView = membershipSales.publicView(sales);
  return ok({
    item: orderViewOf(order, user, time.now(), salesView),
    sales: salesView,
  });
}

module.exports = {
  FREE_TASK_SLOTS,
  MEMBER_TASK_SLOTS,
  LEGACY_TASK_PACK_SIZE,
  MEMBERSHIP_CAPABILITY_UNLIMITED_V3,
  MEMBERSHIP_CAPABILITY_TWO_TIER_V5,
  LEGACY_CLIENT_UNLIMITED_TASK_LIMIT,
  ORDER_GRANT_SCHEMA_VERSION,
  PlanVersion,
  MemberTier,
  MEMBER_PRICE_FEN,
  TWO_TIER_MEMBER_PRICE_FEN,
  TWO_TIER_UNLIMITED_PRICE_FEN,
  TWO_TIER_UPGRADE_PRICE_FEN,
  LEGACY_MEMBER_PRICE_FEN,
  LEGACY_MEMBER_TASK_SLOTS,
  LEGACY_CURRENT_TASK_PACK_SIZE,
  MEMBER_DURATION_DAYS,
  TASK_QUOTA_POOL,
  PACKAGES,
  LEGACY_PACKAGES,
  TWO_TIER_PACKAGES,
  packageOf,
  packagesForPlan,
  hasMembershipCapability,
  isNewPlanEnabledFor,
  isTwoTierPlanEnabledFor,
  planVersionFor,
  membershipPricing,
  enforcementModeOf,
  enforcementState,
  shouldEnforceFor,
  shouldEnforceForState,
  DEFAULT_TEST_OPENIDS,
  isMemberAt,
  effectiveMemberTierOf,
  isUnlimitedTier,
  normalizeUser,
  normalizeTwoTierUser,
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
  requestIdHashOf,
  orderSpecMatches,
  packageAllowedFor,
  withQuotaLock: quotaLock.withQuotaLock,
  SAME_PACKAGE_PENDING_REUSE_MS,
  REFUND_WINDOW_MS,
};
