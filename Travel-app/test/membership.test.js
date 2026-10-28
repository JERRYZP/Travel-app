/**
 * 会员任务位规则与服务端硬闸门。
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
    ...extra,
  };
}

function seedActiveTasks(db, count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push(mkTask(`task_${i}`));
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
  eq(membership.shouldEnforceFor(TEST_OPENID_B), true, '测试账号 B 在白名单');
  eq(membership.shouldEnforceFor(USER), false, '其他线上用户不启用任务位限制');

  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'off';
  eq(membership.shouldEnforceFor(TEST_OPENID_A), false, 'off 模式关闭所有限制');
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  eq(membership.shouldEnforceFor(USER), true, 'all 模式对所有用户启用');
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

  /* 后续业务用例统一在 all 模式下验证完整闸门。 */
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  delete process.env.MEMBERSHIP_TEST_OPENIDS;

  console.log('=== 1. 免费 / 会员 / 加量包任务位 ===');
  let db = createDb();
  seedUser(db);
  seedActiveTasks(db, 5);
  let current = await membership.status(db, USER);
  eq(current.membership.member, false, '默认普通用户');
  eq(current.membership.taskLimit, 5, '免费上限 5');
  eq(current.membership.taskUsed, 5, '未来 WAITING 占用 5');
  eq(current.membership.taskRemaining, 0, '剩余 0');

  const blocked = await membership.capacityError(db, USER, 1);
  eq(blocked.success, false, '超额被拒');
  eq(blocked.errorCode, 1026, '返回任务位错误码');
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

  console.log('\n=== 2. 过期任务不占新任务位 ===');
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
  eq(submitted.errorCode, 1026, '提交返回任务位错误码');
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

  console.log('\n=== 5. 会员过期保留已购任务包，但不能直接加购 ===');
  db = createDb();
  seedUser(db, {
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: new Date(Date.now() - DAY_MS),
    taskPackCount: 1,
  });
  seedActiveTasks(db, 12);
  current = await membership.status(db, USER);
  eq(current.membership.member, false, '已过有效期按普通用户处理');
  eq(current.membership.taskLimit, 5, '过期后只保留免费 5 个任务位');
  eq(current.membership.ownedTaskPackCount, 1, '已购任务包仍保留');
  const packOrder = await membership.createOrder(db, USER, { packageId: 'task_pack_5' });
  eq(packOrder.success, false, '非有效会员不能直接加购');
  eq(packOrder.errorCode, 1022, '返回先开通会员错误');
  const renewOrder = await membership.createOrder(db, USER, { packageId: 'member' });
  eq(renewOrder.success, true, '过期会员可续费');
  eq(db._dump(COLLECTIONS.ORDERS)[0].memberDays, 30, '会员订单快照为 30 天');

  console.log('\n=== 6. 我的订单只返回展示字段并按时间倒序 ===');
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
      title: '5 个任务位',
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
  eq('paymentResult' in orders.items[0], false, '不向客户端返回支付原始结果');
  eq('transactionId' in orders.items[1], false, '不向客户端返回微信交易号');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
