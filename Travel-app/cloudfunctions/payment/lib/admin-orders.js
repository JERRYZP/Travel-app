/**
 * 客服工作台会员订单查询。
 *
 * 订单金额、状态和权益仍来自 orders 快照；用户昵称和 OpenID 按订单 userId
 * 关联 users。这里只提供管理员只读视图，不复制支付或权益状态机。
 */

const {
  COLLECTIONS, ERRORS, OrderStatus, RefundStatus, GrantStatus, ok, fail,
} = require('./schema');
const { grantStateOf } = require('./order');
const afterSales = require('./after-sales');
const directory = require('./admin-directory');

const MAX_SEARCH_ROWS = 100;
const ORDER_PAGE_SIZE = 100;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_ORDER_STATUSES = new Set(Object.values(OrderStatus));
const STATUS_LABEL = {
  PENDING: '待支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUNDED: '已退款',
};
const REFUND_LABEL = {
  NONE: '',
  REQUESTED: '售后处理中',
  UNDER_REVIEW: '退款审核中',
  PROCESSING: '退款处理中',
  REFUNDED: '已退款',
  REJECTED: '退款未通过',
  FAILED: '退款异常',
};
const GRANT_LABEL = {
  NONE: '未发放',
  GRANTED: '已发放',
  FAILED: '发放失败',
  REVERTED: '已回收',
};
const ENTITLEMENT_LABEL = {
  PENDING: '待支付',
  PAID_GRANTED: '权益已到账',
  PAID_GRANT_FAILED: '权益发放异常',
  PAID_GRANT_UNKNOWN: '权益待核验',
  CLOSED: '订单已关闭',
  REFUNDED: '权益已回收',
};

function amountText(value) {
  return `¥${((Number(value) || 0) / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function beijingDayRange(nowTs = new Date()) {
  const nowMs = new Date(nowTs).getTime();
  const shifted = new Date(nowMs + BEIJING_OFFSET_MS);
  const startMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - BEIJING_OFFSET_MS;
  const dateKey = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return {
    dateKey,
    start: new Date(startMs),
    end: new Date(startMs + DAY_MS),
  };
}

async function ordersCreatedInDay(db, range) {
  const rows = [];
  let offset = 0;
  while (true) {
    const res = await db.collection(COLLECTIONS.ORDERS)
      .where({
        createdAt: db.command.gte(range.start).and(db.command.lt(range.end)),
      })
      .orderBy('createdAt', 'asc')
      .skip(offset)
      .limit(ORDER_PAGE_SIZE)
      .get();
    const page = res.data || [];
    rows.push(...page);
    if (page.length < ORDER_PAGE_SIZE) break;
    offset += page.length;
  }
  return rows;
}

async function dailyStatsForAdmin(db, nowTs = new Date()) {
  const range = beijingDayRange(nowTs);
  const orders = await ordersCreatedInDay(db, range);
  const paidOrders = orders.filter(order => {
    const paidMs = new Date(order.paidAt || 0).getTime();
    return Number.isFinite(paidMs) && paidMs > 0;
  });
  const paidAmountFen = paidOrders.reduce(
    (sum, order) => sum + Math.max(0, Number(order.amountFen) || 0),
    0
  );
  return ok({
    stats: {
      dateKey: range.dateKey,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      paidAmountFen,
      paidAmountText: amountText(paidAmountFen),
    },
  });
}

function channelLabel(channel) {
  if (channel === 'APPLE') return 'Apple';
  if (channel === 'WECHAT_VIRTUAL') return '微信虚拟支付';
  return '微信支付';
}

function caseSummaryOf(cases = []) {
  const sorted = cases.slice().sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const latest = sorted[0] || null;
  return {
    count: sorted.length,
    latestCaseId: latest ? latest._id : '',
    latestCaseNo: latest ? latest.caseNo || '' : '',
    latestStatus: latest ? latest.status || '' : '',
    latestStatusLabel: latest ? afterSales.caseViewOf(latest).statusLabel : '',
  };
}

function orderViewOf(order = {}, user = {}, cases = [], options = {}) {
  const channel = afterSales.paymentChannelOf(order);
  const entitlementStatus = grantStateOf(order);
  const refundStatus = order.refundStatus || RefundStatus.NONE;
  const currentCases = caseSummaryOf(cases);
  const view = {
    orderId: order._id,
    outTradeNo: order.outTradeNo || '',
    title: order.title || (order.productType === 'TASK_PACK' ? '提醒名额包' : '会员 30 天'),
    productType: order.productType || '',
    packageId: order.packageId || '',
    amountFen: Math.max(0, Number(order.amountFen) || 0),
    amountText: amountText(order.amountFen),
    addedSlots: Math.max(0, Number(order.addedSlots) || 0),
    memberDays: Math.max(0, Number(order.memberDays) || 0),
    status: order.status || OrderStatus.PENDING,
    statusLabel: STATUS_LABEL[order.status] || '处理中',
    refundStatus,
    refundStatusLabel: REFUND_LABEL[refundStatus] || '',
    grantStatus: order.grantStatus || (order.status === OrderStatus.PAID ? 'UNKNOWN' : GrantStatus.NONE),
    grantStatusLabel: GRANT_LABEL[order.grantStatus] || (order.status === OrderStatus.PAID ? '待核验' : '未发放'),
    entitlementStatus,
    entitlementStatusLabel: ENTITLEMENT_LABEL[entitlementStatus] || '状态待核验',
    paymentChannel: channel,
    paymentChannelLabel: channelLabel(channel),
    cases: currentCases,
    user: directory.userBriefOf(user, order.userId),
    createdAt: order.createdAt || null,
    createdAtText: afterSales.timeText(order.createdAt),
    paidAt: order.paidAt || null,
    paidAtText: afterSales.timeText(order.paidAt),
    expiresAt: order.expiresAt || null,
    expiresAtText: afterSales.timeText(order.expiresAt),
  };
  if (options.detail) {
    const paymentResult = order.paymentResult || {};
    view.transactionId = order.transactionId || '';
    view.closedAtText = afterSales.timeText(order.closedAt);
    view.closeReason = order.closeReason || '';
    view.paymentState = {
      tradeState: paymentResult.tradeState || '',
      amountFen: Math.max(0, Number(paymentResult.amountFen) || 0),
      channelOrderType: paymentResult.channelOrderType == null
        ? null
        : Number(paymentResult.channelOrderType),
    };
    view.entitlementGrant = order.entitlementGrant ? {
      ...order.entitlementGrant,
      memberDaysAdded: Math.round(
        Math.max(0, Number(order.entitlementGrant.memberDaysAddedMs) || 0) / 86400000
      ),
    } : null;
    view.relatedCases = cases.map(afterSales.caseViewOf);
  }
  return view;
}

async function casesByOrderIds(db, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ orderId: db.command.in(ids) })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return (res.data || []).reduce((map, item) => {
    if (!map[item.orderId]) map[item.orderId] = [];
    map[item.orderId].push(item);
    return map;
  }, {});
}

async function orderIdsByCaseNo(db, caseNo) {
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ caseNo })
    .limit(20)
    .get();
  return [...new Set((res.data || []).map(item => item.orderId).filter(Boolean))];
}

async function searchOrders(db, keyword, status, pageInfo) {
  const kind = directory.keywordKindOf(keyword);
  let where = null;
  if (kind === 'OPENID') where = { userId: keyword };
  if (kind === 'ORDER_ID') where = { _id: keyword };
  if (kind === 'OUT_TRADE_NO') where = { outTradeNo: keyword.toUpperCase() };
  if (kind === 'CASE_NO') {
    const orderIds = await orderIdsByCaseNo(db, keyword.toUpperCase());
    if (!orderIds.length) return { rows: [], total: 0 };
    where = { _id: db.command.in(orderIds) };
  }
  if (kind === 'NICKNAME') {
    const users = await directory.usersByNickname(db, keyword);
    const ids = users.map(user => user.openId).filter(Boolean);
    if (!ids.length) return { rows: [], total: 0 };
    where = { userId: db.command.in(ids) };
  }
  const res = await db.collection(COLLECTIONS.ORDERS)
    .where(where)
    .limit(MAX_SEARCH_ROWS)
    .get();
  const rows = (res.data || [])
    .filter(order => !status || order.status === status)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  return {
    rows: rows.slice(pageInfo.skip, pageInfo.skip + pageInfo.pageSize),
    total: rows.length,
  };
}

async function listOrdersForAdmin(db, params = {}) {
  const keyword = directory.keywordOf(params.keyword);
  const status = VALID_ORDER_STATUSES.has(params.status) ? params.status : '';
  const pageInfo = directory.normalizePage(params);
  let rows = [];
  let total = 0;
  let keywordType = '';

  if (keyword) {
    keywordType = directory.keywordKindOf(keyword);
    const result = await searchOrders(db, keyword, status, pageInfo);
    rows = result.rows;
    total = result.total;
  } else {
    let query = db.collection(COLLECTIONS.ORDERS);
    if (status) query = query.where({ status });
    total = Number((await query.count()).total) || 0;
    const res = await query
      .orderBy('createdAt', 'desc')
      .skip(pageInfo.skip)
      .limit(pageInfo.pageSize)
      .get();
    rows = res.data || [];
  }

  const [userMap, caseMap] = await Promise.all([
    directory.userMapByOpenIds(db, rows.map(order => order.userId)),
    casesByOrderIds(db, rows.map(order => order._id)),
  ]);
  const items = rows.map(order =>
    orderViewOf(order, userMap[order.userId] || {}, caseMap[order._id] || []));
  return ok({
    items,
    count: items.length,
    total,
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    hasMore: pageInfo.skip + items.length < total,
    keywordType,
  });
}

async function getOrderForAdmin(db, orderId) {
  if (!orderId) return fail(ERRORS.ORDER_NOT_FOUND);
  const res = await db.collection(COLLECTIONS.ORDERS).where({ _id: orderId }).limit(1).get();
  const order = (res.data || [])[0];
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const [user, cases] = await Promise.all([
    afterSales.refundEvidenceUser(db, order.userId),
    afterSales.casesForOrder(db, order.userId, order._id),
  ]);
  return ok({
    order: orderViewOf(order, user || {}, cases, { detail: true }),
    user: directory.userBriefOf(user || {}, order.userId),
  });
}

module.exports = {
  STATUS_LABEL,
  REFUND_LABEL,
  GRANT_LABEL,
  ENTITLEMENT_LABEL,
  beijingDayRange,
  orderViewOf,
  dailyStatsForAdmin,
  listOrdersForAdmin,
  getOrderForAdmin,
};
