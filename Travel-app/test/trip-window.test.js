/**
 * 行程窗口：展示边界与提醒事实解耦。
 * 运行：node test/trip-window.test.js
 */
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');
const trip = require('../cloudfunctions/reminder/lib/trip');
const tripWindow = require('../cloudfunctions/reminder/lib/trip-window');
const tripShare = require('../cloudfunctions/reminder/lib/trip-share');

const USER = 'window_owner';
const TODAY = time.todayStr();
const TRIPS = 'trips';
const ITEMS = 'trip_items';
const TASKS = 'reminder_tasks';
const USERS = 'users';
const SPOTS = 'spots';

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};

function itemData(id, tripId, visitDate, spotId = 'gugong') {
  return {
    _id: id,
    userId: USER,
    tripId,
    spotId,
    visitDate,
    backupGroupId: `${tripId}:${spotId}`,
    remindOn: true,
    result: null,
    resultAt: null,
    createdAt: time.now(),
    updatedAt: time.now(),
  };
}

function taskData(id, tripId, itemId, visitDate) {
  return {
    _id: id,
    userId: USER,
    itemId,
    tripId,
    spotId: 'gugong',
    visitDate,
    releaseAt: time.parseBeijing(visitDate, '20:00'),
    offsets: [5],
    channels: ['OFFICIAL_ACCOUNT'],
    backendStatus: 'WAITING',
    createdAt: time.now(),
  };
}

(async () => {
  const db = createDb();
  await db.collection(USERS).add({
    data: { _id: USER, openId: USER, nickname: '行程测试' },
  });
  await db.collection(SPOTS).add({
    data: {
      _id: 'spot_gugong',
      spotId: 'gugong',
      name: '故宫博物院',
      reservationRequired: true,
      difficultyScore: 5,
    },
  });

  console.log('=== 1. 老数据回退且默认不改实际范围 ===');
  const initial = await trip.create(db, USER, {
    startDate: time.addDays(TODAY, 1),
    endDate: time.addDays(TODAY, 12),
    spotIds: ['gugong'],
  });
  const tripId = initial.tripId;
  const stored = db._dump(TRIPS).find(t => t._id === tripId);
  const fallback = tripWindow.windowOf(stored);
  eq(fallback.startDate, stored.startDate, '无手动字段时开始日回退实际范围');
  eq(fallback.endDate, stored.endDate, '无手动字段时结束日回退实际范围');
  eq(fallback.explicit, false, '老数据不伪造手动标记');

  const insideDate = time.addDays(TODAY, 3);
  const outsideDate = time.addDays(TODAY, 10);
  await db.collection(ITEMS).add({ data: itemData('I_IN', tripId, insideDate) });
  await db.collection(ITEMS).add({ data: itemData('I_OUT', tripId, outsideDate) });
  await db.collection(TASKS).add({ data: taskData('T_IN', tripId, 'I_IN', insideDate) });
  await db.collection(TASKS).add({ data: taskData('T_OUT', tripId, 'I_OUT', outsideDate) });

  const beforeItems = JSON.stringify(db._dump(ITEMS));
  const beforeTasks = JSON.stringify(db._dump(TASKS));

  console.log('=== 2. 编辑窗口只改 trips ===');
  const edited = await trip.updateWindow(db, USER, tripId, {
    startDate: time.addDays(TODAY, 1),
    endDate: time.addDays(TODAY, 5),
    expectedWindowUpdatedAt: tripWindow.versionOfTrip(stored),
  });
  eq(edited.success, true, '允许缩短用户可见行程');
  eq(edited.windowStartDate, time.addDays(TODAY, 1), '返回新开始日');
  eq(edited.windowEndDate, time.addDays(TODAY, 5), '返回新结束日');
  eq(edited.windowItemCount, 1, '范围内项目数由服务端计算');
  eq(edited.outsideItemCount, 1, '范围外项目保留并计数');
  const afterTrip = db._dump(TRIPS).find(t => t._id === tripId);
  eq(afterTrip.startDate, time.addDays(TODAY, 1), '实际提醒覆盖开始日不变');
  eq(afterTrip.endDate, time.addDays(TODAY, 12), '实际提醒覆盖结束日不变');
  eq(JSON.stringify(db._dump(ITEMS)), beforeItems, '编辑窗口不改 trip_items');
  eq(JSON.stringify(db._dump(TASKS)), beforeTasks, '编辑窗口不改 reminder_tasks');

  console.log('=== 3. 并发保护 ===');
  const stale = await trip.updateWindow(db, USER, tripId, {
    startDate: time.addDays(TODAY, 1),
    endDate: time.addDays(TODAY, 4),
    expectedWindowUpdatedAt: tripWindow.versionOfTrip(stored),
  });
  eq(stale.errorCode, 1043, '旧窗口版本不能覆盖新值');

  console.log('=== 4. 分享只投影窗口内项目 ===');
  const shared = await tripShare.create(db, USER, {
    tripId,
    nowTs: time.parseBeijing(time.addDays(TODAY, 2), '12:00'),
  });
  eq(shared.success, true, '窗口内存在项目时可分享');
  eq(shared.expiresOn, time.addDays(TODAY, 12), '分享有效期按窗口结束日 +7 天');
  const opened = await tripShare.open(db, shared.token, {
    nowTs: time.parseBeijing(time.addDays(TODAY, 2), '12:00'),
  });
  eq(opened.success, true, '有效链接可打开');
  eq(opened.trip.days.length, 1, '范围外日期不进入公开投影');
  eq(opened.trip.days[0].visitDate, insideDate, '只保留窗口内日期');
  eq(opened.trip.days[0].dayNumber, 3, '第几天按窗口开始日计算');
  eq(opened.trip.startDate, time.addDays(TODAY, 1), '公开开始日使用窗口');
  eq(opened.trip.endDate, time.addDays(TODAY, 5), '公开结束日使用窗口');

  console.log('=== 5. 后续合并不覆盖手动窗口 ===');
  const merged = await trip.create(db, USER, {
    startDate: time.addDays(TODAY, 20),
    endDate: time.addDays(TODAY, 22),
    spotIds: ['gugong'],
  });
  eq(merged.tripId, tripId, '同城新增仍合并到原行程');
  const afterMerge = db._dump(TRIPS).find(t => t._id === tripId);
  eq(afterMerge.windowStartDate, time.addDays(TODAY, 1), '合并保留手动开始日');
  eq(afterMerge.windowEndDate, time.addDays(TODAY, 5), '合并保留手动结束日');
  eq(afterMerge.endDate, time.addDays(TODAY, 22), '实际覆盖范围正常扩展');
  eq(tripWindow.effectiveEndDateOf(afterMerge), time.addDays(TODAY, 22),
    '生命周期取实际范围与窗口结束日的较晚值');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : `FAIL ${fail}`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
