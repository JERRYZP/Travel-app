/**
 * `trip.list` 的并行化等价性测试（2026-09-30）。
 *
 * 背景：首页真机冷启动约 5 秒。`trip.list` 里原来有两个 `for` 循环、每个循环内各一个
 * `await`，于是**每趟行程 = 2 次串行 DB 往返**，N 趟就是 2N 次，而它挂在 bootstrap
 * 的 `Promise.all` 里 —— 整组耗时由这条线性链决定。状态墙用户的慢主要来自这里。
 *
 * 优化做了两件事，两件都会改变查询形状，所以必须钉住**行为等价**：
 *   ① `nextReminderAt` 的 N 次查询改成并发（结果顺序不能错位）；
 *   ② `removeIfEmpty` 的 3N 次 count 改成调用方预取后的内存判定
 *      （判定结果必须与逐趟 count 完全一致，否则会误删或漏删行程）。
 *
 * 本文件用同一份数据跑两条路径，逐字段比对。
 *
 * 运行：node test/trip-list-parallel.test.js
 */
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return require.resolve('./stubs/wx-server-sdk.js');
  return origResolve.call(this, request, ...rest);
};

const { createDb } = require('./mock-db');
const CURRENT_DB = createDb();

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
      getWXContext() { return { OPENID: 'user-1' }; },
      callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
    };
  }
  return origLoad.apply(this, arguments);
};
const trip = require('../cloudfunctions/reminder/lib/trip');
const { COLLECTIONS } = require('../cloudfunctions/reminder/lib/schema');
Module._load = origLoad;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const USER = 'user-1';

/* 三种形态的行程：有任务 / 只有行程项 / 全空（应被级联删除）。
   最后一种正是 removeIfEmpty 的存在理由，也是改动最容易弄坏的地方。 */
const TRIPS = [
  { _id: 'T_HAS_TASK', userId: USER, city: '北京', startDate: '2026-10-01', endDate: '2026-10-03', name: '有任务' },
  { _id: 'T_HAS_ITEM', userId: USER, city: '北京', startDate: '2026-10-05', endDate: '2026-10-06', name: '只有行程项' },
  { _id: 'T_EMPTY', userId: USER, city: '上海', startDate: '2026-11-01', endDate: '2026-11-02', name: '空行程' },
];
const TASKS = [
  /* T_HAS_TASK 的两个 WAITING 任务，releaseAt 故意乱序写入：
     并发化后如果结果顺序错位，nextReminderAt 会取到较晚的那个。 */
  { _id: 'K1', userId: USER, tripId: 'T_HAS_TASK', backendStatus: 'WAITING', releaseAt: '2026-09-30T12:00:00.000Z' },
  { _id: 'K2', userId: USER, tripId: 'T_HAS_TASK', backendStatus: 'WAITING', releaseAt: '2026-09-29T12:00:00.000Z' },
  /* T_HAS_ITEM 没有任务，但有行程项 → 不该被删 */
];
const ITEMS = [
  { _id: 'I1', userId: USER, tripId: 'T_HAS_ITEM', spotId: 'gugong', visitDate: '2026-10-05' },
];

const seed = async () => {
  CURRENT_DB.reset && CURRENT_DB.reset();
  for (const t of TRIPS) await CURRENT_DB.collection(COLLECTIONS.TRIPS).add({ data: t });
  for (const k of TASKS) await CURRENT_DB.collection(COLLECTIONS.REMINDER_TASKS).add({ data: k });
  for (const i of ITEMS) await CURRENT_DB.collection(COLLECTIONS.TRIP_ITEMS).add({ data: i });
};

/** 只比较结果里跟行为有关的部分，忽略时间戳等噪点。 */
const shapeOf = res => JSON.stringify((res.trips || []).map(t => ({
  _id: t._id,
  nextReminderAt: t.nextReminderAt === undefined ? null : t.nextReminderAt,
  spots: t.spots,
  sortedKey: [t.startDate, t.endDate, t._id],
})).sort((a, b) => String(a._id).localeCompare(String(b._id))));

/* 级联删除是破坏性的，两条路径必须各跑一次干净的种子数据。 */
(async () => {
  console.log('=== 1. 并发取 nextReminderAt：结果与串行一致 ===');
  await seed();
  const concurrent = await trip.list(CURRENT_DB, USER, {
    items: ITEMS, tasks: TASKS, carts: [],
  });
  /* ⚠️ 先断言两条行程都还在，再取字段 —— 否则实现出错时这里会抛
     「cannot read property of undefined」，把一条清晰的失败变成看不懂的崩溃。 */
  const ids = (concurrent.trips || []).map(x => x._id).join(',');
  eq(ids.indexOf('T_HAS_TASK') >= 0, true, '有任务的行程应当保留');
  const t = (concurrent.trips || []).find(x => x._id === 'T_HAS_TASK') || {};
  eq(t.nextReminderAt, '2026-09-29T12:00:00.000Z',
    '取的是最早的那个 WAITING 任务（并发化没有让结果错位）');
  eq((concurrent.trips || []).some(x => x._id === 'T_EMPTY'), false,
    '全空的行程被级联删除');
  eq((concurrent.trips || []).some(x => x._id === 'T_HAS_ITEM'), true,
    '只有行程项、没有任务的行程被保留（不能只看任务判定）');

  console.log('=== 2. prefetched 内存判定 == 逐趟 count 判定 ===');
  await seed();
  const withPrefetch = shapeOf(await trip.list(CURRENT_DB, USER, {
    items: ITEMS, tasks: TASKS, carts: [],
  }));

  await seed();
  const withoutPrefetch = shapeOf(await trip.list(CURRENT_DB, USER));

  eq(withPrefetch, withoutPrefetch, '两条路径的结果逐字段相同（含 nextReminderAt 与删除结果）');

  console.log('=== 3. 清单非空时保留行程（prefetched 的第三张表）===');
  await seed();
  /* 给 T_EMPTY 加一条清单草稿：它就不是空行程了，不该被删 */
  await CURRENT_DB.collection(COLLECTIONS.REMINDER_CART).add({
    data: { _id: 'C1', userId: USER, tripId: 'T_EMPTY', spotId: 'gugong' },
  });
  const carts = await CURRENT_DB.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId: USER }).get().then(r => r.data || []);
  const withCart = await trip.list(CURRENT_DB, USER, { items: ITEMS, tasks: TASKS, carts });
  eq((withCart.trips || []).some(x => x._id === 'T_EMPTY'), true,
    '有清单草稿的行程被保留（carts 参与了内存判定）');

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
