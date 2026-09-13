/**
 * home.bootstrap 集成测试：用 mock-db 跑 reminder/index.js 的 main('home.bootstrap')
 *
 * reminder/index.js 顶层 require('wx-server-sdk') 且 const db = cloud.database()，
 * 因此须先建好 CURRENT_DB 再 require。这里用 Module._load 注入 stub，
 * callFunction 模拟 spots.list。运行：node test/home-bootstrap.test.js
 */
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_boot_001';
const TODAY = time.todayStr();
// 行程与任务均用「今天 + N 天」的偏移量，避免写死日期在时间流逝后被 task.list 判为过期而分组归零（时间炸弹）
const START = time.addDays(TODAY, 1);
const END = time.addDays(TODAY, 3);
const VISIT = time.addDays(TODAY, 2);
const RELEASE_AT = new Date(time.addDays(TODAY, 1) + 'T20:00:00+08:00'); // 明天 20:00，恒 > now
const CURRENT_DB = createDb(); // 必须在 require reminder 前创建（模块顶层 const db = cloud.database()）

const SPOT_CARDS = [{
  spotId: 'gugong', name: '故宫博物院', reservationRequired: true,
  difficultyScore: 5, popularityScore: 10,
  difficultyLabel: { key: 'EXTREME', text: '极难约', color: 'red' },
  remindable: true, releaseTime: '20:00',
}];

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
      getWXContext() { return { OPENID: USER }; },
      callFunction({ name }) {
        if (name !== 'spots') return Promise.reject(new Error('unexpected fn ' + name));
        return Promise.resolve({ result: { success: true, data: SPOT_CARDS } });
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const reminder = require('../cloudfunctions/reminder/index.js');
Module._load = origLoad;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const COLLECTIONS = {
  TRIPS: 'trips',
  REMINDER_TASKS: 'reminder_tasks',
  SPOTS: 'spots',
  RELEASE_RULES: 'release_rules',
  REMINDER_CART: 'reminder_cart',
};

(async () => {
  /* ===== 场景 1：新用户（无行程/无任务） → homeMode=1 + hotSpots ===== */
  let res = await reminder.main({ action: 'home.bootstrap', filter: 'active' });
  eq(res.success, true, 'bootstrap success');
  eq(res.homeMode, 1, '新用户 homeMode=1');
  eq(JSON.stringify(res.groups), '[]', '无任务 groups 空');
  eq(res.trips.length, 0, '无行程 trips 空');
  eq(res.hotSpots.length, 1, 'hotSpots 来自 spots 云函数');
  eq(res.hotSpots[0].name, '故宫博物院', 'hotSpots 内容正确');
  eq(res.tripTasks, null, '无选中行程 tripTasks=null');

  /* ===== 场景 2：已有行程+任务 → homeMode=2，且支持选中行程分组 ===== */
  await CURRENT_DB.collection(COLLECTIONS.SPOTS).add({ data: { spotId: 'gugong', name: '故宫博物院', difficultyScore: 5, reservationRequired: true, popularityScore: 10 } });
  await CURRENT_DB.collection(COLLECTIONS.RELEASE_RULES).add({ data: { spotId: 'gugong', releaseTime: '20:00', advanceDays: 7, closedDays: ['monday'] } });
  await CURRENT_DB.collection(COLLECTIONS.TRIPS).add({ data: { _id: 'TRIP1', userId: USER, city: '北京', startDate: START, endDate: END, name: '北京测试行程', spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now() } });
  await CURRENT_DB.collection(COLLECTIONS.REMINDER_TASKS).add({ data: { _id: 'TASK1', userId: USER, tripId: 'TRIP1', spotId: 'gugong', visitDate: VISIT, releaseAt: RELEASE_AT, offsets: [5, 2], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING', sentOffsets: [], createdAt: time.now() } });

  res = await reminder.main({ action: 'home.bootstrap', filter: 'active', activeTripTab: 'TRIP1' });
  eq(res.homeMode, 2, '有任务 homeMode=2');
  eq(res.trips.length, 1, 'trips 1 条');
  eq(res.tripTasks && res.tripTasks.success, true, '选中行程 tripTasks success');
  eq(res.tripTasks.groups.length, 1, '选中行程分组 1 组');

  /* 不带 activeTripTab：详情整体分组 */
  res = await reminder.main({ action: 'home.bootstrap', filter: 'active' });
  eq(res.groups.length, 1, '全量分组 1 组');
  eq(res.tripTasks, null, '不带 activeTripTab 则 tripTasks=null');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
