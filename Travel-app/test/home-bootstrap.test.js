/**
 * home.bootstrap V2 集成测试：首页行程状态墙的数据出口（API-契约 8.2）
 *
 * 用 mock-db 跑 reminder/index.js 的 main('home.bootstrap')，callFunction 模拟 spots.list。
 *
 * reminder/index.js 顶层 require('wx-server-sdk') 且 const db = cloud.database()，
 * 因此须先建好 CURRENT_DB 再 require。这里用 Module._load 注入 stub。
 * 运行：node test/home-bootstrap.test.js
 */
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_boot_001';
const TODAY = time.todayStr();
// 行程与行程项均用「今天 + N 天」的偏移量，避免写死日期在时间流逝后变成历史行程（时间炸弹）
const START = time.addDays(TODAY, 1);
const END = time.addDays(TODAY, 3);
/* ⚠️ 放票时刻由 visitDate − advanceDays 推导（lib/item.deriveReleaseAt），
   不是从任务上读的。测试数据必须让 fixture 自洽，否则测的是自相矛盾的输入。
   这里取 advanceDays=1、visitDate=明天 → releaseAt = 今天 20:00。
   它相对 now 的前后取决于跑测试的钟点，所以下面按它显式使用。 */
const ADVANCE = 1;
const VISIT = time.addDays(TODAY, 2);          // releaseAt = TODAY+1 20:00（未来 → PENDING）
const RELEASE_AT = new Date(time.addDays(TODAY, 1) + 'T20:00:00+08:00');

/**
 * 造一个「放票时刻刚过去、且仍在 24h 窗口内」的出行日。
 *
 * ⚠️ 不要用「今天+7」这类写法：故宫 advanceDays=7 时 releaseAt = 今天 20:00，
 * 而 20:00 之前跑测试它其实是**未来**（PENDING 而不是 BOOKABLE）。
 * 这个 helper 取「最近一个已经过去的 releaseTime 点」，年龄恒在 (0, 24h] 内，
 * 任意时刻跑都成立。
 */
function bookableVisitDate(advanceDays, releaseTime = '20:00') {
  const now = new Date();
  let rel = time.parseBeijing(time.toDateStr(now), releaseTime);
  if (rel.getTime() > now.getTime()) rel = new Date(rel.getTime() - 86400000);
  const visit = time.addDays(time.toDateStr(rel), advanceDays);
  return { visit, releaseAt: time.parseBeijing(time.addDays(visit, -advanceDays), releaseTime) };
}
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
  TRIP_ITEMS: 'trip_items',
};

const seedSpot = async () => {
  await CURRENT_DB.collection(COLLECTIONS.SPOTS).add({ data: { spotId: 'gugong', name: '故宫博物院', difficultyScore: 5, reservationRequired: true, popularityScore: 10 } });
  await CURRENT_DB.collection(COLLECTIONS.RELEASE_RULES).add({ data: { spotId: 'gugong', releaseTime: '20:00', advanceDays: ADVANCE, closedDays: [] } });
};

(async () => {
  /* ===== 场景 1：新用户（无行程项） → homeMode=1 走创建引导 + hotSpots ===== */
  let res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.success, true, 'bootstrap success');
  eq(res.homeMode, 1, '新用户 homeMode=1（创建引导）');
  eq(res.trips.length, 0, '无行程 trips 空');
  eq(res.history.length, 0, '无历史行程 history 空');
  eq(res.primaryTripId, '', '无行程 primaryTripId 为空');
  eq(res.stickyBanner, null, '无可抢项 stickyBanner=null');
  eq(res.scrollTargetId, null, '无可标记项 scrollTargetId=null');
  eq(res.hotSpots.length, 1, 'hotSpots 来自 spots 云函数');
  eq(res.hotSpots[0].name, '故宫博物院', 'hotSpots 内容正确');
  eq(Boolean(res.serverNow), true, '返回 serverNow 供前端算倒计时');

  /* ===== 场景 2：有进行中行程 + 行程项 + 任务 → 主墙 ===== */
  await seedSpot();
  await CURRENT_DB.collection(COLLECTIONS.TRIPS).add({
    data: { _id: 'TRIP1', userId: USER, city: '北京', startDate: START, endDate: END, name: '北京测试行程', spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now() },
  });
  await CURRENT_DB.collection(COLLECTIONS.TRIP_ITEMS).add({
    data: { _id: 'ITEM1', userId: USER, tripId: 'TRIP1', spotId: 'gugong', visitDate: VISIT, backupGroupId: 'TRIP1:gugong', remindOn: true, result: null, resultAt: null, createdAt: time.now(), updatedAt: time.now() },
  });
  await CURRENT_DB.collection(COLLECTIONS.REMINDER_TASKS).add({
    data: { _id: 'TASK1', userId: USER, itemId: 'ITEM1', tripId: 'TRIP1', spotId: 'gugong', visitDate: VISIT, releaseAt: RELEASE_AT, offsets: [5, 2], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING', sentOffsets: [], createdAt: time.now() },
  });

  res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.homeMode, 2, '有行程项 homeMode=2');
  eq(res.trips.length, 1, '进行中行程 1 条');
  eq(res.primaryTripId, 'TRIP1', 'primaryTripId = 最近进行中行程');
  eq(res.trips[0].items.length, 1, '行程带出 1 条行程项');
  eq(res.trips[0].items[0].itemId, 'ITEM1', '行程项用 itemId 作对外主键');
  eq(res.trips[0].items[0].ticketState, 'PENDING', '未到放票时间 → PENDING');
  eq(res.trips[0].items[0].ticketStateLabel, '待抢', '状态文案固定');
  eq(res.trips[0].items[0].reminder.state, 'WAITING', '提醒送达态独立字段');
  eq(res.trips[0].items[0].reminder.stateLabel, '待提醒', '提醒文案');
  eq(res.trips[0].progress.total, 1, '进度分母 = 预约需求组数');
  eq(res.trips[0].progress.done, 0, '尚未搞定');
  eq(res.trips[0].itemCount, 1, '行程项计数');

  /* ===== 场景 3：刚开票几小时 → 可抢（24h 窗口内），且过期的 WAITING 兜底收敛 =====
     V2 首页不再调 task.list，若不在这里 sweep，定时链路故障时就会静默显示「待提醒」 ===== */
  const past = bookableVisitDate(ADVANCE);
  await CURRENT_DB.collection(COLLECTIONS.TRIP_ITEMS).doc('ITEM1').update({ data: { visitDate: past.visit } });
  await CURRENT_DB.collection(COLLECTIONS.REMINDER_TASKS).doc('TASK1').update({
    data: { visitDate: past.visit, releaseAt: past.releaseAt, lastSendError: 'errCode=43101' },
  });
  res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.trips[0].items[0].reminder.state, 'MISSED', '过期未送达 → MISSED');
  eq(res.trips[0].items[0].reminder.stateLabel, '未送达', '未送达文案');
  eq(res.trips[0].items[0].reminder.reason, 'errCode=43101', '优先展示真实失败原因');
  // 票务状态与提醒送达态分离：提醒没送达 ≠ 用户没抢到
  eq(res.trips[0].items[0].ticketState, 'BOOKABLE', '票务态同期进入可抢');
  eq(res.trips[0].items[0].canMark, true, '可抢态可标记结果');
  eq(res.scrollTargetId, 'ITEM1', '自动定位到该标记的那一条');

  /* ===== 场景 4：结束的行程按 e ndDate 在读取时归入历史，不依赖定时任务 ===== */
  await CURRENT_DB.collection(COLLECTIONS.TRIPS).doc('TRIP1').update({
    data: { startDate: time.addDays(TODAY, -5), endDate: time.addDays(TODAY, -1) },
  });
  res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.trips.length, 0, '已结束行程离开主墙');
  eq(res.history.length, 1, '归入历史行程');
  eq(res.history[0].progress.total, 1, '历史行程同样带进度');
  eq(res.history[0].items, undefined, '历史行程不重复下发 items');

  /* ===== 场景 5：结束日当天仍属进行中（当天还能回看和补标） ===== */
  await CURRENT_DB.collection(COLLECTIONS.TRIPS).doc('TRIP1').update({
    data: { startDate: time.addDays(TODAY, -5), endDate: TODAY },
  });
  res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.trips.length, 1, '结束日当天仍在主墙');
  eq(res.history.length, 0, '结束日当天不进历史');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
