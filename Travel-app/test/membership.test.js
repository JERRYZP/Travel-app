/**
 * 会员提醒名额规则与服务端硬闸门。
 *
 * 运行：node test/membership.test.js
 */
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, ChannelType, MemberLevel, ReminderBackendStatus,
} = require('../cloudfunctions/reminder/lib/schema');
const membership = require('../cloudfunctions/reminder/lib/membership');
const task = require('../cloudfunctions/reminder/lib/task');
const itemActions = require('../cloudfunctions/reminder/lib/trip-item-actions');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_membership_001';
const DAY_MS = 86400000;
const TEST_OPENID_A = 'oZ6IFxvYK1mKzBaehMcOPIl_CgN0';
const TEST_OPENID_B = 'oZ6IFxmYI3grd17Aa2rEem2SMqNo';
const TEST_OPENID_ANDROID = 'oZ6IFxi1K98ihzn5DH6KP5Jx9_bs';

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

function futureDate(days = 10) {
  return time.addDays(time.todayStr(), days);
}

function seedUser(db, patch = {}) {
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_membership_001',
    openId: USER,
    memberLevel: MemberLevel.NORMAL,
    taskPackCount: 0,
    ...patch,
  }]);
}

function mkTask(id, extra = {}) {
  return {
    _id: id,
    userId: USER,
    itemId: `item_${id}`,
    tripId: 'trip_membership',
    spotId: 'gugong',
    visitDate: futureDate(10),
    releaseAt: new Date(Date.now() + DAY_MS),
    offsets: [5],
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    backendStatus: ReminderBackendStatus.WAITING,
    quotaPool: 'ENTITLEMENT',
    ...extra,
  };
}

function seedActiveTasks(db, count, quotaPool = 'ENTITLEMENT', idPrefix = 'task') {
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push(mkTask(`${idPrefix}_${i}`, { quotaPool }));
  db._seed(COLLECTIONS.REMINDER_TASKS, rows);
}

function mkCart(id) {
  return {
    _id: id,
    userId: USER,
    tripId: '__pending__',
    spotId: `spot_${id}`,
    visitDate: futureDate(20),
    releaseAt: new Date(Date.now() + 2 * DAY_MS),
    remindOn: true,
    reservationRequired: true,
  };
}

async function run() {
  console.log('=== 0. 会员限制灰度白名单 ===');
  delete process.env.MEMBERSHIP_ENFORCEMENT_MODE;
  delete process.env.MEMBERSHIP_TEST_OPENIDS;
  eq(membership.enforcementModeOf(), 'test', '默认只对测试白名单生效');
  eq(membership.shouldEnforceFor(TEST_OPENID_A), true, '测试账号 A 在白名单');
  eq(membership.shouldEnforceFor(TEST_OPENID_B), false, '移出的测试账号 B 不再受限');
  eq(membership.shouldEnforceFor(TEST_OPENID_ANDROID), true, '安卓测试账号在白名单');
  eq(membership.shouldEnforceFor(USER), false, '其他线上用户不启用提醒名额限制');
  eq(membership.newTaskQuotaPoolOf(TEST_OPENID_A), membership.TASK_QUOTA_POOL.ENTITLEMENT,
    '测试白名单新任务进入新增池');
  eq(membership.newTaskQuotaPoolOf(USER), membership.TASK_QUOTA_POOL.PROTECTED,
    'test 模式下的普通用户新任务仍进入保护池');

  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'off';
  eq(membership.shouldEnforceFor(TEST_OPENID_A), false, 'off 模式关闭所有限制');
  eq(membership.newTaskQuotaPoolOf(TEST_OPENID_A), membership.TASK_QUOTA_POOL.PROTECTED,
    'off 模式新任务不占新增池');
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  eq(membership.shouldEnforceFor(USER), true, 'all 模式对所有用户启用');
  eq(membership.newTaskQuotaPoolOf(USER), membership.TASK_QUOTA_POOL.ENTITLEMENT,
    'all 模式新任务才进入新增池');
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'test';
  process.env.MEMBERSHIP_TEST_OPENIDS = `${USER}, extra-openid`;
  eq(membership.shouldEnforceFor(USER), true, '环境变量可覆盖测试白名单');
  eq(membership.shouldEnforceFor(TEST_OPENID_A), false, '覆盖后默认白名单失效');
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'test';
  delete process.env.MEMBERSHIP_TEST_OPENIDS;
  let whitelistDb = createDb();
  seedUser(whitelistDb);
  seedActiveTasks(whitelistDb, 5);
  eq(await membership.capacityError(whitelistDb, USER, 1), null,
    '非白名单用户即使超过 5 个任务也不会被新后端拦截');

  let preCutoverDb = createDb();
  seedUser(preCutoverDb);
  preCutoverDb._seed(COLLECTIONS.REMINDER_CART, [mkCart('pre_cutover_1'), mkCart('pre_cutover_2')]);
  const preCutoverSubmit = await task.submit(preCutoverDb, USER, {
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(preCutoverSubmit.success, true, 'test 模式下普通用户仍可正常新建提醒');
  eq(preCutoverDb._dump(COLLECTIONS.REMINDER_TASKS).every(t => t.quotaPool === 'PROTECTED'), true,
    '正式切 all 前创建的任务全部进入历史保护池');

  /* 后续业务用例统一在 all 模式下验证完整闸门。 */
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  delete process.env.MEMBERSHIP_TEST_OPENIDS;
  const afterCutoverStatus = await membership.status(preCutoverDb, USER);
  eq(afterCutoverStatus.membership.taskUsed, 0, '切 all 前的 2 条任务不会追溯占用新增池');
  eq(afterCutoverStatus.membership.protectedTaskUsed, 2, '切 all 前的任务转为历史保护池占用');
  preCutoverDb._seed(COLLECTIONS.REMINDER_CART, [mkCart('post_cutover_1')]);
  const postCutoverSubmit = await task.submit(preCutoverDb, USER, {
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(postCutoverSubmit.success, true, '切 all 后可正常新建任务');
  const postCutoverTasks = preCutoverDb._dump(COLLECTIONS.REMINDER_TASKS);
  eq(postCutoverTasks.filter(t => t.quotaPool === 'PROTECTED').length, 2,
    '切 all 前任务继续保留在保护池');
  eq(postCutoverTasks.filter(t => t.quotaPool === 'ENTITLEMENT').length, 1,
    '切 all 后新任务写入新增池');

  console.log('=== 1. 免费 / 会员 / 加量包提醒名额 ===');
  let db = createDb();
  seedUser(db);
  seedActiveTasks(db, 5);
  let current = await membership.status(db, USER);
  eq(current.membership.member, false, '默认普通用户');
  eq(current.membership.taskLimit, 5, '免费上限 5');
  eq(current.membership.taskUsed, 5, '未来 WAITING 占用 5');
  eq(current.membership.taskRemaining, 0, '剩余 0');
  const memberPackage = current.packages.find(item => item.id === 'member');
  const taskPack = current.packages.find(item => item.id === 'task_pack_5');
  eq(memberPackage.priceFen, 300, '会员当前价格 300 分');
  eq(memberPackage.priceText, '¥3', '会员价格展示为 3 元');
  eq(taskPack.priceFen, 300, '提醒名额包当前价格 300 分');
  eq(taskPack.priceText, '¥3', '提醒名额包价格展示为 3 元');

  const blocked = await membership.capacityError(db, USER, 1);
  eq(blocked.success, false, '超额被拒');
  eq(blocked.errorCode, 1026, '返回提醒名额错误码');
  eq(blocked.taskLimit.shortfall, 1, '缺口 1');

  await db.collection(COLLECTIONS.USERS).where({ openId: USER }).update({
    data: {
      memberLevel: MemberLevel.MEMBER,
      taskPackCount: 1,
      memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
  current = await membership.status(db, USER);
  eq(current.membership.taskLimit, 15, '会员 10 + 1 个加量包 = 15');
  eq(await membership.capacityError(db, USER, 10), null, '15 位内允许新增 10');

  console.log('\n=== 2. 过期任务不占新提醒名额 ===');
  db = createDb();
  seedUser(db);
  seedActiveTasks(db, 5);
  db._seed(COLLECTIONS.REMINDER_TASKS, [
    mkTask('expired_task', { releaseAt: new Date(Date.now() - DAY_MS) }),
  ]);
  current = await membership.status(db, USER);
  eq(current.membership.taskUsed, 5, '过期 WAITING 不计入占用');

  console.log('\n=== 3. cart.commit 超限时不留半成品 ===');
  db = createDb();
  seedUser(db);
  seedActiveTasks(db, 5);
  const carts = [];
  for (let i = 0; i < 2; i += 1) carts.push(mkCart(`cart_${i}`));
  db._seed(COLLECTIONS.REMINDER_CART, carts);

  let submitted = await task.submit(db, USER, {
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(submitted.success, false, '免费用户新增 2 条被拒');
  eq(submitted.errorCode, 1026, '提交返回提醒名额错误码');
  eq(db._size(COLLECTIONS.REMINDER_CART), 2, '失败后清单原样保留');
  eq(db._size(COLLECTIONS.TRIPS), 0, '失败后不创建行程');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), 5, '失败后不创建任务');

  await db.collection(COLLECTIONS.USERS).where({ openId: USER }).update({
    data: {
      memberLevel: MemberLevel.MEMBER,
      memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
  submitted = await task.submit(db, USER, {
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(submitted.success, true, '开通会员后可提交');
  eq(submitted.createdTasks, 2, '新增 2 条任务');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), 7, '任务总数 = 5 + 2');

  console.log('\n=== 4. 行程项重新开启提醒也受闸门约束 ===');
  db = createDb();
  seedUser(db);
  seedActiveTasks(db, 5);
  db._seed(COLLECTIONS.SPOTS, [{
    spotId: 'gugong',
    name: '故宫博物院',
    reservationRequired: true,
    difficultyScore: 5,
  }]);
  const visitDate = futureDate(12);
  db._seed(COLLECTIONS.RELEASE_RULES, [{
    spotId: 'gugong',
    advanceDays: 7,
    releaseTime: '20:00',
    closedDays: ['monday'],
  }]);
  db._seed(COLLECTIONS.TRIP_ITEMS, [{
    _id: 'target_item',
    userId: USER,
    tripId: 'trip_target',
    spotId: 'gugong',
    visitDate,
    remindOn: false,
  }]);
  const reopened = await itemActions.updateReminder(db, USER, {
    itemId: 'target_item',
    remindOn: true,
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(reopened.success, false, '免费额度已满时无法重新开启');
  eq(reopened.errorCode, 1026, '重新开启返回 1026');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), 5, '未新增提醒任务');

  await db.collection(COLLECTIONS.USERS).where({ openId: USER }).update({
    data: {
      memberLevel: MemberLevel.MEMBER,
      memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
  const reopenedOk = await itemActions.updateReminder(db, USER, {
    itemId: 'target_item',
    remindOn: true,
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(reopenedOk.success, true, '会员可重新开启');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), 6, '会员新增 1 条任务');

  console.log('\n=== 5. 历史保护池不挤占会员新增池 ===');
  db = createDb();
  const migrationCutoff = new Date(Date.now() - DAY_MS);
  seedUser(db, {
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    protectedTaskQuota: 9,
    protectionMigratedAt: migrationCutoff,
  });
  seedActiveTasks(db, 9, 'PROTECTED', 'protected');
  current = await membership.status(db, USER);
  eq(current.membership.taskLimit, 10, '会员新增池仍为 10 个');
  eq(current.membership.taskUsed, 0, '9 条历史保护任务不占新增池');
  eq(current.membership.protectedTaskUsed, 9, '历史保护池准确记录 9 条');
  eq(current.membership.taskRemaining, 10, '开通会员后完整保留 10 个新增名额');
  eq(await membership.capacityError(db, USER, 3), null,
    '历史 9 条时仍可一次新建 3 条提醒');

  seedActiveTasks(db, 3, 'ENTITLEMENT', 'entitlement');
  current = await membership.status(db, USER);
  eq(current.membership.taskUsed, 3, '新建 3 条只占新增池');
  eq(current.membership.protectedTaskUsed, 9, '历史池保持 9 条');
  eq(current.membership.taskRemaining, 7, '会员新增池剩余 7 个');

  const legacyPool = membership.quotaPoolOfTask({
    createdAt: new Date(migrationCutoff.getTime() + 1000),
  });
  const explicitEntitlementPool = membership.quotaPoolOfTask({
    quotaPool: membership.TASK_QUOTA_POOL.ENTITLEMENT,
  });
  eq(legacyPool, membership.TASK_QUOTA_POOL.PROTECTED, '没有池别字段的旧任务兼容为保护池');
  eq(explicitEntitlementPool, membership.TASK_QUOTA_POOL.ENTITLEMENT, '显式新增池按新规则计数');

  db = createDb();
  seedUser(db, {
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    protectedTaskQuota: 1,
    protectionMigratedAt: migrationCutoff,
  });
  db._seed(COLLECTIONS.SPOTS, [{
    spotId: 'gugong', name: '故宫博物院', reservationRequired: true, difficultyScore: 5,
  }]);
  db._seed(COLLECTIONS.RELEASE_RULES, [{
    spotId: 'gugong', advanceDays: 7, releaseTime: '20:00', closedDays: ['monday'],
  }]);
  db._seed(COLLECTIONS.TRIP_ITEMS, [{
    _id: 'legacy_item', userId: USER, tripId: 'legacy_trip', spotId: 'gugong',
    visitDate: futureDate(12), remindOn: true,
  }]);
  db._seed(COLLECTIONS.REMINDER_TASKS, [mkTask('legacy_task', {
    itemId: 'legacy_item', quotaPool: 'PROTECTED', createdAt: new Date(migrationCutoff.getTime() - 1000),
  })]);
  const reconfigured = await itemActions.updateReminder(db, USER, {
    itemId: 'legacy_item', remindOn: true, channels: [ChannelType.OFFICIAL_ACCOUNT], offsets: [2],
  });
  eq(reconfigured.success, true, '历史保护任务可修改提醒配置');
  eq(db._dump(COLLECTIONS.REMINDER_TASKS)[0].quotaPool, 'PROTECTED',
    '重建后继续留在历史保护池');

  console.log('\n=== 6. 会员过期保留已购任务包，但不能直接加购 ===');
  db = createDb();
  seedUser(db, {
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: new Date(Date.now() - DAY_MS),
    taskPackCount: 1,
  });
  seedActiveTasks(db, 12, 'PROTECTED');
  current = await membership.status(db, USER);
  eq(current.membership.member, false, '已过有效期按普通用户处理');
  eq(current.membership.taskLimit, 5, '过期会员的新增池回到免费 5 个');
  eq(current.membership.taskUsed, 0, '12 条历史保护任务不占免费新增池');
  eq(current.membership.protectedTaskUsed, 12, '12 条历史任务继续固定保护');
  eq(current.membership.ownedTaskPackCount, 1, '已购任务包仍保留');
  const packOrder = await membership.createOrder(db, USER, { packageId: 'task_pack_5' });
  eq(packOrder.success, false, '非有效会员不能直接加购');
  eq(packOrder.errorCode, 1022, '返回先开通会员错误');
  const renewOrder = await membership.createOrder(db, USER, { packageId: 'member' });
  eq(renewOrder.success, true, '过期会员可续费');
  eq(renewOrder.amountFen, 300, '新会员订单按 300 分创建');
  eq(db._dump(COLLECTIONS.ORDERS)[0].memberDays, 30, '会员订单快照为 30 天');

  console.log('\n=== 7. 我的订单只返回展示字段并按时间倒序 ===');
  db = createDb();
  db._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'order_old',
      userId: USER,
      outTradeNo: 'TOLD',
      packageId: 'member',
      productType: 'MEMBER',
      title: '会员 30 天',
      amountFen: 200,
      addedSlots: 5,
      memberDays: 30,
      status: 'PAID',
      createdAt: new Date('2026-10-01T10:00:00+08:00'),
      paidAt: new Date('2026-10-01T10:01:00+08:00'),
      paymentResult: { secret: 'not for client' },
      transactionId: 'wx_private',
    },
    {
      _id: 'order_new',
      userId: USER,
      outTradeNo: 'TNEW',
      packageId: 'task_pack_5',
      productType: 'TASK_PACK',
      title: '5 个任务位', // 兼容升级前历史订单的旧文案
      amountFen: 200,
      addedSlots: 5,
      memberDays: 0,
      status: 'PENDING',
      createdAt: new Date('2026-10-02T10:00:00+08:00'),
    },
  ]);
  const orders = await membership.listOrders(db, USER);
  eq(orders.count, 2, '返回本人两笔订单');
  eq(orders.items[0]._id, 'order_new', '按创建时间倒序');
  eq(orders.items[0].statusLabel, '待支付', 'PENDING 展示待支付');
  eq(orders.items[1].amountText, '¥2', '金额格式化');
  eq(orders.items[0].title, '5 个提醒名额', '历史任务位订单统一显示为提醒名额');
  eq('paymentResult' in orders.items[0], false, '不向客户端返回支付原始结果');
  eq('transactionId' in orders.items[1], false, '不向客户端返回微信交易号');
  eq(orders.items[1].isExpired, false, '已支付订单不会因 15 分钟支付有效期被标成过期');
  eq(orders.items[1].actionFlags.canRebuy, false, '已支付订单不会出现重新购买');
  eq(Number.isFinite(orders.items[1].refundEligibility.hoursSincePaid), true,
    '订单视图返回距离支付小时数，供退款申请页展示');
  eq(orders.items[0].actionFlags.canRebuy, true, '过期未支付订单允许重新购买');
  const detail = await membership.orderDetail(db, USER, 'order_new');
  eq(detail.success, true, '本人可读取单笔订单详情');
  eq(detail.item._id, 'order_new', '单笔详情返回目标订单');
  eq('paymentResult' in detail.item, false, '单笔详情仍不返回支付原始结果');
  const otherDetail = await membership.orderDetail(db, 'openid_other', 'order_new');
  eq(otherDetail.success, false, '不能读取他人订单详情');
  eq(otherDetail.errorCode, 1024, '他人订单按不存在处理');

  console.log('\n=== 8. 过期待支付订单立即关闭并新建 ===');
  db = createDb();
  seedUser(db);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_expired',
    userId: USER,
    outTradeNo: 'TEXPIRED',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 200,
    memberDays: 30,
    status: 'PENDING',
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
    expiresAt: new Date(Date.now() - 5 * 60 * 1000),
  }]);
  const freshOrder = await membership.createOrder(db, USER, { packageId: 'member' });
  const orderRows = db._dump(COLLECTIONS.ORDERS);
  eq(freshOrder.success, true, '过期订单后仍可创建新订单');
  eq(freshOrder.amountFen, 300, '新订单按当前 3 元价格创建');
  eq(orderRows.find(item => item._id === 'order_expired').status, 'CLOSED', '旧待支付订单立即关闭');
  eq(freshOrder.orderId === 'order_expired', false, '不会复用已过期待支付订单');
  eq(orderRows.filter(item => item.status === 'PENDING').length, 1, '只保留一笔有效待支付订单');

  console.log('\n=== 9. 未过期但价格不匹配的待支付订单立即关闭 ===');
  db = createDb();
  seedUser(db);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order_old_price',
    userId: USER,
    outTradeNo: 'TOLDPRICE',
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 200,
    memberDays: 30,
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }]);
  const priceChangedOrder = await membership.createOrder(db, USER, { packageId: 'member' });
  const priceChangedRows = db._dump(COLLECTIONS.ORDERS);
  const oldPriceOrder = priceChangedRows.find(item => item._id === 'order_old_price');
  eq(priceChangedOrder.success, true, '价格变更后仍可创建新订单');
  eq(priceChangedOrder.amountFen, 300, '新订单使用当前 3 元价格');
  eq(priceChangedOrder.orderId === 'order_old_price', false, '不会复用旧价格待支付订单');
  eq(oldPriceOrder.status, 'CLOSED', '未过期的旧价格待支付订单也会关闭');
  eq(oldPriceOrder.closeReason, 'PRICE_CHANGED', '旧价格订单记录价格变更关闭原因');
  eq(priceChangedRows.filter(item => item.status === 'PENDING').length, 1,
    '旧价格订单关闭后只保留当前价格待支付订单');

  console.log('\n=== 10. 历史提醒也作为退款使用证据 ===');
  db = createDb();
  seedUser(db);
  const historicalCreatedAt = new Date(Date.now() - 60 * 60 * 1000);
  db._seed(COLLECTIONS.REMINDER_TASKS, [mkTask('task_historical', {
    backendStatus: ReminderBackendStatus.CLOSED,
    releaseAt: new Date(Date.now() - 30 * 60 * 1000),
    createdAt: historicalCreatedAt,
  })]);
  await membership.status(db, USER);
  const migratedUser = db._dump(COLLECTIONS.USERS)[0];
  eq(
    new Date(migratedUser.lastReminderCreatedAt).getTime(),
    historicalCreatedAt.getTime(),
    '最近提醒时间从历史任务回填，而不是只看未来 WAITING'
  );

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
