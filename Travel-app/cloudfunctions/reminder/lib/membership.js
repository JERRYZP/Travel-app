/**
 * 会员与任务位规则（2026-10-27）
 *
 * 这里是小程序端唯一可以消费的任务位口径：
 * - 免费用户最多保留 5 个未来待发送提醒任务；
 * - 2 元会员有效 30 天，会员期内任务上限变为 10 个；
 * - 会员每加购 1 个 2 元任务包，永久获得 5 个任务位，会员期内生效；
 * - 会员到期后，已购任务位不删除但不生效，已有提醒任务继续发送。
 *
 * “已用任务位”只统计仍会发送的 WAITING 任务。已触发、未送达和已关闭的
 * 任务不占新任务位，避免历史记录永久阻止用户继续使用。
 */

const {
  COLLECTIONS, ERRORS, MemberLevel, OrderStatus, ReminderBackendStatus, ok, fail,
} = require('./schema');
const time = require('./time');

const FREE_TASK_SLOTS = 5;
const MEMBER_TASK_SLOTS = 10;
const TASK_PACK_SIZE = 5;
const TASK_PACK_PRICE_FEN = 200;
const MEMBER_PRICE_FEN = 200;
const MEMBER_DURATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENFORCEMENT_OFF = 'off';
const ENFORCEMENT_TEST = 'test';
const ENFORCEMENT_ALL = 'all';
const DEFAULT_ENFORCEMENT_MODE = ENFORCEMENT_TEST;
const DEFAULT_TEST_OPENIDS = Object.freeze([
  'oZ6IFxvYK1mKzBaehMcOPIl_CgN0',
  'oZ6IFxmYI3grd17Aa2rEem2SMqNo',
]);
const ORDER_STATUS_LABEL = {
  PENDING: '待支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUNDED: '已退款',
};

const PACKAGES = Object.freeze([
  {
    id: 'member',
    type: 'MEMBER',
    title: '会员 30 天',
    priceFen: MEMBER_PRICE_FEN,
    priceText: '¥2',
    taskSlots: MEMBER_TASK_SLOTS,
    addedSlots: MEMBER_TASK_SLOTS - FREE_TASK_SLOTS,
    memberDays: MEMBER_DURATION_DAYS,
    description: '30 天内最多 10 个提醒任务位',
    badge: '推荐',
  },
  {
    id: 'task_pack_5',
    type: 'TASK_PACK',
    title: '5 个任务位',
    priceFen: TASK_PACK_PRICE_FEN,
    priceText: '¥2',
    taskSlots: TASK_PACK_SIZE,
    addedSlots: TASK_PACK_SIZE,
    memberDays: 0,
    description: '永久保留，会员有效期内生效',
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
 * - all：全部用户启用会员任务位。
 *
 * 未配置或配置值非法时回退为 off，避免误把未发布功能扩散到全部线上用户。
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

function orderViewOf(order = {}) {
  return {
    _id: order._id,
    outTradeNo: order.outTradeNo || '',
    packageId: order.packageId || '',
    productType: order.productType || '',
    title: order.title || '会员服务',
    amountFen: Math.max(0, Number(order.amountFen) || 0),
    amountText: amountTextOf(order.amountFen),
    addedSlots: Math.max(0, Number(order.addedSlots) || 0),
    memberDays: Math.max(0, Number(order.memberDays) || 0),
    status: order.status || OrderStatus.PENDING,
    statusLabel: ORDER_STATUS_LABEL[order.status] || '处理中',
    createdAt: order.createdAt || null,
    createdAtText: orderTimeText(order.createdAt),
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
  const taskLimit = FREE_TASK_SLOTS
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
    taskLimit,
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
  const taskUsed = countActiveTasks(tasks, nowTs);
  return {
    ...base,
    taskUsed,
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
        ? (snapshot.member ? '续费 30 天 ¥2' : '开通会员 ¥2')
        : (snapshot.member ? '购买 5 个任务位 ¥2' : '先开通会员'),
    };
  });
}

async function status(db, userId, nowTs = time.now()) {
  const [userRes, taskRes] = await Promise.all([
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({
        userId,
        backendStatus: ReminderBackendStatus.WAITING,
        releaseAt: db.command.gt(nowTs),
      })
      .get(),
  ]);

  const user = (userRes.data || [])[0] || {};
  const snapshot = snapshotFromTasks(user, taskRes.data || [], nowTs);
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
    createdAt: nowTs,
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

/** 当前用户的会员 / 任务位订单，最多 50 条，按创建时间倒序。 */
async function listOrders(db, userId) {
  const res = await db.collection(COLLECTIONS.ORDERS)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  const items = (res.data || []).map(orderViewOf);
  return ok({
    items,
    count: items.length,
  });
}

module.exports = {
  FREE_TASK_SLOTS,
  MEMBER_TASK_SLOTS,
  TASK_PACK_SIZE,
  MEMBER_PRICE_FEN,
  TASK_PACK_PRICE_FEN,
  MEMBER_DURATION_DAYS,
  PACKAGES,
  packageOf,
  enforcementModeOf,
  shouldEnforceFor,
  DEFAULT_TEST_OPENIDS,
  isMemberAt,
  normalizeUser,
  countActiveTasks,
  snapshotFromTasks,
  packageViews,
  status,
  capacityError,
  createOrder,
  listOrders,
  orderViewOf,
};
