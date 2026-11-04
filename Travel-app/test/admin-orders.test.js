/**
 * 客服工作台：会员订单查询、用户信息补全和售后搜索。
 *
 * 运行：node test/admin-orders.test.js
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, OrderStatus, GrantStatus, RefundStatus, CaseStatus,
} = require('../cloudfunctions/payment/lib/schema');
const adminOrders = require('../cloudfunctions/payment/lib/admin-orders');
const afterSales = require('../cloudfunctions/payment/lib/after-sales');

const USER_A = 'openid_customer_a_123456789012345';
const USER_B = 'openid_customer_b_123456789012345';
const ROOT = path.resolve(__dirname, '..');
const ADMIN = 'openid_customer_service_admin';
const FIXED_NOW = Date.parse('2026-11-02T07:30:00.000Z');

function loadPayment(db, openId) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: openId, SOURCE: 'wx_client' }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/payment/index.js')];
    return require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }
}

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

function seed(db) {
  const now = FIXED_NOW;
  db._seed(COLLECTIONS.USERS, [
    {
      _id: 'user_a',
      openId: USER_A,
      nickname: '张三',
      memberExpiresAt: new Date(now + 20 * 86400000),
      taskPackCount: 1,
      taskPackSlots: 10,
    },
    {
      _id: 'user_b',
      openId: USER_B,
      nickname: '李四',
      memberExpiresAt: null,
      taskPackCount: 0,
      taskPackSlots: 0,
    },
  ]);
  db._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'ord_alpha_001',
      userId: USER_A,
      outTradeNo: 'TALPHA001',
      productType: 'MEMBER',
      packageId: 'member',
      title: '会员 30 天',
      amountFen: 300,
      addedSlots: 10,
      memberDays: 30,
      status: OrderStatus.PAID,
      refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.GRANTED,
      paymentProvider: 'VIRTUAL_PAY',
      transactionId: 'wx_alpha_tx',
      paymentResult: { tradeState: 'SUCCESS', amountFen: 300 },
      entitlementGrant: {
        memberDaysAddedMs: 30 * 86400000,
        taskPackCountAdded: 0,
        taskPackSlotsAdded: 0,
      },
      createdAt: new Date(now - 1000),
      paidAt: new Date(now - 500),
    },
    {
      _id: 'ord_beta_002',
      userId: USER_B,
      outTradeNo: 'TBETA002',
      productType: 'MEMBER',
      packageId: 'member',
      title: '会员 30 天',
      amountFen: 300,
      status: OrderStatus.PENDING,
      refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.NONE,
      createdAt: new Date(now - 2000),
    },
    {
      _id: 'ord_gamma_003',
      userId: USER_A,
      outTradeNo: 'TGAMMA003',
      productType: 'TASK_PACK',
      packageId: 'task_pack_5',
      title: '10 个提醒名额',
      amountFen: 300,
      addedSlots: 10,
      status: OrderStatus.CLOSED,
      refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.NONE,
      createdAt: new Date(now - 3000),
    },
  ]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [
    {
      _id: 'asc_case_001',
      caseNo: 'ASTESTCASE001',
      userId: USER_A,
      orderId: 'ord_alpha_001',
      outTradeNo: 'TALPHA001',
      type: 'UNUSED_REFUND',
      title: '会员 30 天',
      amountFen: 300,
      status: CaseStatus.UNDER_REVIEW,
      refundStatus: RefundStatus.UNDER_REVIEW,
      createdAt: new Date(now - 400),
    },
    {
      _id: 'asc_case_002',
      caseNo: 'ASTESTCASE002',
      userId: USER_B,
      orderId: 'ord_beta_002',
      outTradeNo: 'TBETA002',
      type: 'OTHER',
      title: '会员 30 天',
      amountFen: 300,
      status: CaseStatus.SUBMITTED,
      refundStatus: RefundStatus.NONE,
      createdAt: new Date(now - 2100),
    },
  ]);
}

function listForAdmin(db, params) {
  return adminOrders.listOrdersForAdmin(db, params, new Date(FIXED_NOW));
}

async function run() {
  const db = createDb();
  seed(db);

  console.log('=== 1. 会员订单列表与用户信息 ===');
  const firstPage = await listForAdmin(db, { page: 1, pageSize: 2 });
  eq(firstPage.success, true, '管理员订单列表成功');
  eq(firstPage.total, 3, '返回订单总数');
  eq(firstPage.items.length, 2, '分页返回 2 条');
  eq(firstPage.hasMore, true, '还有下一页');
  eq(firstPage.items[0].user.nickname, '张三', '订单关联当前昵称');
  eq(firstPage.items[0].user.openId, USER_A, '订单返回完整 OpenID');
  eq(firstPage.items[0].paymentChannelLabel, '微信虚拟支付', '订单展示支付渠道');
  eq(firstPage.items[0].cases.latestStatusLabel, '客服审核中', '订单展示关联售后状态');

  console.log('\n=== 1z. 订单时间范围 ===');
  const rangeDb = createDb();
  rangeDb._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'range_today',
      userId: USER_A,
      outTradeNo: 'TRANGETODAY',
      amountFen: 100,
      status: OrderStatus.PAID,
      createdAt: new Date(FIXED_NOW - 60 * 60 * 1000),
    },
    {
      _id: 'range_10d',
      userId: USER_A,
      outTradeNo: 'TRANGE10D',
      amountFen: 100,
      status: OrderStatus.PAID,
      createdAt: new Date(FIXED_NOW - 10 * 86400000),
    },
    {
      _id: 'range_60d',
      userId: USER_A,
      outTradeNo: 'TRANGE60D',
      amountFen: 100,
      status: OrderStatus.PAID,
      createdAt: new Date(FIXED_NOW - 60 * 86400000),
    },
    {
      _id: 'range_120d',
      userId: USER_A,
      outTradeNo: 'TRANGE120D',
      amountFen: 100,
      status: OrderStatus.PAID,
      createdAt: new Date(FIXED_NOW - 120 * 86400000),
    },
  ]);
  const recent7 = await listForAdmin(rangeDb, { timeRange: '7d' });
  const recent30 = await listForAdmin(rangeDb, { timeRange: '30d' });
  const defaultRange = await listForAdmin(rangeDb, {});
  const recent90 = await listForAdmin(rangeDb, { timeRange: '90d' });
  const allRange = await listForAdmin(rangeDb, { timeRange: 'all' });
  eq(recent7.total, 1, '近 7 天只返回窗口内订单');
  eq(recent30.total, 2, '近 30 天返回窗口内订单');
  eq(defaultRange.timeRange, '30d', '未传时间范围时默认近 30 天');
  eq(defaultRange.total, 2, '默认时间范围生效');
  eq(recent90.total, 3, '近 90 天返回窗口内订单');
  eq(allRange.total, 4, '全部范围返回全部历史');
  const oldExact = await listForAdmin(rangeDb, {
    keyword: 'TRANGE60D',
    timeRange: '30d',
  });
  const oldExactAll = await listForAdmin(rangeDb, {
    keyword: 'TRANGE60D',
    timeRange: 'all',
  });
  eq(oldExact.total, 0, '精确搜索同样受时间范围限制');
  eq(oldExactAll.total, 1, '切到全部后可查历史订单');

  console.log('\n=== 1a. 当日订单统计（北京时间） ===');
  const dayRange = adminOrders.beijingDayRange(new Date('2026-11-01T16:00:00.000Z'));
  eq(dayRange.dateKey, '2026-11-02', '北京时间零点归属第二天');
  eq(dayRange.start.toISOString(), '2026-11-01T16:00:00.000Z', '北京时间当日从 UTC 16 点开始');
  const stats = await adminOrders.dailyStatsForAdmin(db, new Date(FIXED_NOW));
  eq(stats.stats.totalOrders, 3, '统计当日全部订单');
  eq(stats.stats.paidOrders, 1, '统计当日已支付订单');
  eq(stats.stats.paidAmountFen, 300, '汇总当日已支付金额');
  eq(stats.stats.paidAmountText, '¥3', '金额按展示格式返回');
  eq(stats.stats.refundedOrders, 0, '无退款时已退款订单数为 0');
  eq(stats.stats.refundedAmountFen, 0, '无退款时净赚等于支付金额');
  eq(stats.stats.netAmountText, '¥3', '无退款时返回净赚金额');

  const netDb = createDb();
  netDb._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'net_paid',
      amountFen: 500,
      status: OrderStatus.PAID,
      createdAt: new Date(FIXED_NOW),
      paidAt: new Date(FIXED_NOW),
    },
    {
      _id: 'net_refund_snapshot',
      amountFen: 300,
      status: OrderStatus.PAID,
      refundStatus: RefundStatus.REFUNDED,
      refundedAmountFen: 300,
      createdAt: new Date(FIXED_NOW),
      paidAt: new Date(FIXED_NOW),
    },
    {
      _id: 'net_refund_legacy',
      amountFen: 200,
      status: OrderStatus.REFUNDED,
      createdAt: new Date(FIXED_NOW),
      paidAt: new Date(FIXED_NOW),
    },
    {
      _id: 'net_pending',
      amountFen: 300,
      status: OrderStatus.PENDING,
      createdAt: new Date(FIXED_NOW),
    },
  ]);
  const netStats = await adminOrders.dailyStatsForAdmin(netDb, new Date(FIXED_NOW));
  eq(netStats.stats.totalOrders, 4, '净赚统计覆盖当日全部订单');
  eq(netStats.stats.paidAmountFen, 1000, '净赚统计先汇总已支付金额');
  eq(netStats.stats.refundedOrders, 2, '统计当日已完成退款的订单数量');
  eq(netStats.stats.refundedAmountFen, 500, '退款按快照扣减，缺失快照按订单金额扣减');
  eq(netStats.stats.netAmountFen, 500, '当日净赚等于支付金额减退款金额');
  eq(netStats.stats.netAmountText, '¥5', '净赚金额按展示格式返回');

  console.log('\n=== 2. 订单状态筛选与搜索 ===');
  const paid = await listForAdmin(db, { status: 'PAID', page: 1, pageSize: 20 });
  eq(paid.total, 1, '按已支付筛选');
  eq(paid.items[0].orderId, 'ord_alpha_001', '筛选命中目标订单');
  const nickname = await listForAdmin(db, { keyword: '张', page: 1, pageSize: 20 });
  eq(nickname.total, 2, '昵称部分匹配返回该用户全部订单');
  const nicknamePaid = await listForAdmin(db, {
    keyword: '张',
    status: 'PAID',
    page: 1,
    pageSize: 20,
  });
  eq(nicknamePaid.total, 1, '昵称搜索可与订单状态组合');
  const openId = await listForAdmin(db, {
    keyword: USER_B,
    page: 1,
    pageSize: 20,
  });
  eq(openId.total, 1, '完整 OpenID 精确查询');
  eq(openId.items[0].orderId, 'ord_beta_002', 'OpenID 命中目标订单');
  const tradeNo = await listForAdmin(db, {
    keyword: 'TALPHA001',
    page: 1,
    pageSize: 20,
  });
  eq(tradeNo.items[0].orderId, 'ord_alpha_001', '商户订单号精确查询');
  const orderId = await listForAdmin(db, {
    keyword: 'ord_gamma_003',
    page: 1,
    pageSize: 20,
  });
  eq(orderId.items[0].outTradeNo, 'TGAMMA003', '订单 ID 精确查询');
  const caseNo = await listForAdmin(db, {
    keyword: 'astestcase001',
    page: 1,
    pageSize: 20,
  });
  eq(caseNo.items[0].orderId, 'ord_alpha_001', '售后单号忽略大小写反查订单');

  console.log('\n=== 3. 订单详情 ===');
  const detail = await adminOrders.getOrderForAdmin(db, 'ord_alpha_001');
  eq(detail.success, true, '订单详情读取成功');
  eq(detail.order.user.nickname, '张三', '详情包含用户昵称');
  eq(detail.order.transactionId, 'wx_alpha_tx', '详情包含微信交易号');
  eq(detail.order.relatedCases.length, 1, '详情包含本单售后记录');
  eq(detail.order.entitlementGrant.memberDaysAddedMs, 30 * 86400000, '详情包含权益快照');
  const unlimitedView = adminOrders.orderViewOf({
    _id: 'ord_unlimited',
    userId: USER_A,
    outTradeNo: 'TUNLIMITED',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 800,
    unlimitedReminders: true,
    memberDays: 30,
    status: OrderStatus.PENDING,
  }, {}, []);
  eq(unlimitedView.unlimitedReminders, true, '后台订单快照明确标记不限提醒权益');
  const missing = await adminOrders.getOrderForAdmin(db, 'ord_missing');
  eq(missing.errorCode, 1024, '不存在的订单返回 1024');

  console.log('\n=== 4. 售后列表用户信息与搜索 ===');
  const cases = await afterSales.listCasesForAdmin(db, { page: 1, pageSize: 20 });
  eq(cases.success, true, '售后列表读取成功');
  eq(cases.items[0].user.nickname, '张三', '售后列表展示昵称');
  eq(cases.items[0].user.openId, USER_A, '售后列表展示 OpenID');
  const caseByName = await afterSales.listCasesForAdmin(db, {
    keyword: '李',
    page: 1,
    pageSize: 20,
  });
  eq(caseByName.total, 1, '售后列表支持昵称搜索');
  eq(caseByName.items[0].user.openId, USER_B, '昵称搜索命中正确用户');
  const caseByNo = await afterSales.listCasesForAdmin(db, {
    keyword: 'ASTESTCASE002',
    page: 1,
    pageSize: 20,
  });
  eq(caseByNo.items[0]._id, 'asc_case_002', '售后单号精确查询');
  const noResult = await afterSales.listCasesForAdmin(db, {
    keyword: '不存在用户',
    page: 1,
    pageSize: 20,
  });
  eq(noResult.items.length, 0, '无匹配结果返回空列表');

  console.log('\n=== 5. 客服工作台页面结构 ===');
  const wxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.js'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxss'),
    'utf8'
  );
  eq(wxml.includes('客服工作台'), true, '页面标题升级为客服工作台');
  eq(wxml.indexOf('sales-card') < wxml.indexOf('workspace-tabs'), true, '会员售卖开关位于页签上方');
  eq(wxml.includes("activeTab === 'orders'"), true, '页面提供会员订单页签');
  eq(wxml.includes('onSearchConfirm'), true, '客服工作台提供搜索');
  eq(wxml.includes('item.user.openId'), true, '订单与售后卡展示 OpenID');
  eq(js.includes('api.payment.adminOrders.list'), true, '页面接入管理员订单列表接口');
  eq(wxml.includes('onToggleMembershipSales'), true, '客服工作台提供会员购买开关');
  eq(wxml.includes('class="sales-input"'), false, '默认卡片不显示暂停原因输入框');
  eq(wxml.includes('sales-confirm-sheet'), true, '暂停原因在二次确认弹层中输入');
  eq(wxml.includes('onConfirmMembershipSalesPause'), true, '暂停操作需要二次确认');
  eq(wxml.includes('membershipSales.readError'), true, '配置读取失败在管理端显式告警');
  eq(wxml.includes('order-stats'), true, '会员订单页展示当日数据统计');
  eq(wxml.includes('refundedOrdersText'), true, '第四项展示服务端返回的已退款数量');
  eq(wxml.includes('当日净赚'), true, '统计区展示当日净赚');
  eq(wxml.includes('netAmountText'), true, '页面使用净赚金额而非原支付金额');
  eq(js.includes('api.payment.adminOrders.stats'), true, '页面接入订单统计接口');
  eq(js.includes("const DEFAULT_AFTER_SALES_FILTER = 'UNDER_REVIEW'"), true, '售后工单默认筛选为审核中');
  eq(js.includes("activeFilter: orders ? '' : DEFAULT_AFTER_SALES_FILTER"), true, '切换售后工单时应用默认筛选');
  eq(js.includes("key: 'SUBMITTED'"), false, '移除不会持久化产生的待审核筛选');
  eq(js.includes("key: 'CANCELLED'") || js.includes("key: 'REFUNDED'") || js.includes("key: 'REJECTED'"), false, '终态售后不占用顶部处理筛选');
  eq(wxml.includes('onOrderTimeRangeChange'), true, '订单时间范围使用下拉筛选');
  eq(wxml.includes('order-time-picker'), true, '时间范围下拉不占用筛选横向宽度');
  eq(wxml.includes('filter-sticky'), true, '搜索与筛选区域接入吸顶容器');
  eq(wxss.includes('position: sticky'), true, '搜索与筛选区域使用 sticky 吸顶');
  eq(wxss.includes('top: {{filterStickyTop}}px') || wxml.includes('top: {{filterStickyTop}}px'), true, '吸顶偏移使用运行时导航栏高度');
  eq(wxml.includes("item.cases.latestStatus === 'UNDER_REVIEW' ? 'reviewing' : ''"), true, '客服审核中状态使用独立标签样式');
  eq(/\.meta-tag\.case\.reviewing\s*\{[^}]*color:\s*#A7462B/.test(wxss), true, '客服审核中状态文字标红');
  eq(wxml.includes("item.status === 'UNDER_REVIEW' ? 'reviewing' : ''"), true, '售后工单卡客服审核中状态使用独立样式');
  eq(/\.case-status\.reviewing\s*\{[^}]*color:\s*#A7462B/.test(wxss), true, '售后工单卡客服审核中文字标红');

  console.log('\n=== 6. 云函数路由、鉴权与审计 ===');
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;
  const adminPayment = loadPayment(db, ADMIN);
  const routedList = await adminPayment.main({
    action: 'adminOrders.list',
    keyword: '张',
    page: 1,
    pageSize: 20,
    timeRange: 'all',
  });
  eq(routedList.success, true, '管理员可调用订单列表路由');
  eq(routedList.items[0].user.openId, USER_A, '路由返回完整用户信息');
  const routedStats = await adminPayment.main({ action: 'adminOrders.stats' });
  eq(routedStats.success, true, '管理员可调用订单统计路由');
  eq(routedStats.stats.totalOrders >= 0, true, '订单统计返回数值');
  const routedDetail = await adminPayment.main({
    action: 'adminOrders.detail',
    orderId: 'ord_alpha_001',
  });
  eq(routedDetail.success, true, '管理员可调用订单详情路由');
  const userPayment = loadPayment(db, USER_A);
  const denied = await userPayment.main({
    action: 'adminOrders.list',
    page: 1,
    pageSize: 20,
  });
  eq(denied.errorCode, 1040, '普通用户不能查询管理员订单列表');
  const deniedStats = await userPayment.main({ action: 'adminOrders.stats' });
  eq(deniedStats.errorCode, 1040, '普通用户不能查询订单统计');
  const audits = db._dump(COLLECTIONS.ADMIN_AUDIT_LOGS);
  eq(audits.some(item => item.action === 'SEARCH_ADMIN_ORDERS'), true, '订单搜索写入审计');
  eq(audits.some(item => item.action === 'VIEW_ADMIN_ORDER_DETAIL'), true, '订单详情写入审计');
  eq(
    audits.some(item => item.action === 'VIEW_ADMIN_ORDER_DETAIL'
      && item.details
      && item.details.hasTransactionId === true),
    true,
    '订单详情审计只记录交易号是否存在'
  );

  if (fail > 0) {
    console.error(`\n${fail} admin orders assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll admin orders tests passed.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
