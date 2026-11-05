/**
 * home.bootstrap 的窗口投影：范围外项目仍下发，摘要进度只算范围内。
 * 运行：node test/trip-window-home.test.js
 */
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'window_home_user';
const TODAY = time.todayStr();
const CURRENT_DB = createDb();

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
      getWXContext() { return { OPENID: USER }; },
      callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
    };
  }
  return origLoad.apply(this, arguments);
};
const reminder = require('../cloudfunctions/reminder/index.js');
Module._load = origLoad;

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

(async () => {
  await CURRENT_DB.collection('users').add({
    data: { _id: USER, openId: USER },
  });
  await CURRENT_DB.collection('spots').add({
    data: {
      _id: 'spot_gugong',
      spotId: 'gugong',
      name: '故宫博物院',
      reservationRequired: true,
      difficultyScore: 5,
    },
  });
  await CURRENT_DB.collection('release_rules').add({
    data: { spotId: 'gugong', advanceDays: 1, releaseTime: '20:00', closedDays: [] },
  });
  await CURRENT_DB.collection('trips').add({
    data: {
      _id: 'TRIP_WINDOW',
      userId: USER,
      city: '北京',
      startDate: time.addDays(TODAY, -2),
      endDate: time.addDays(TODAY, 10),
      windowStartDate: TODAY,
      windowEndDate: time.addDays(TODAY, 3),
      windowUpdatedAt: time.now(),
      name: '北京窗口测试',
      spotIds: ['gugong'],
      status: 'ACTIVE',
      createdAt: time.now(),
      updatedAt: time.now(),
    },
  });
  const rows = [
    ['I_BEFORE', time.addDays(TODAY, -1)],
    ['I_INSIDE', time.addDays(TODAY, 1)],
    ['I_AFTER', time.addDays(TODAY, 8)],
  ];
  for (const [id, visitDate] of rows) {
    await CURRENT_DB.collection('trip_items').add({
      data: {
        _id: id,
        userId: USER,
        tripId: 'TRIP_WINDOW',
        spotId: 'gugong',
        visitDate,
        backupGroupId: `TRIP_WINDOW:gugong:${id}`,
        remindOn: false,
        result: null,
        resultAt: null,
        createdAt: time.now(),
        updatedAt: time.now(),
      },
    });
  }

  const res = await reminder.main({ action: 'home.bootstrap' });
  eq(res.success, true, 'bootstrap 成功');
  const trip = (res.trips || []).find(t => t._id === 'TRIP_WINDOW');
  eq(Boolean(trip), true, '窗口行程仍在主墙');
  eq(trip.windowStartDate, TODAY, '下发窗口开始日');
  eq(trip.windowEndDate, time.addDays(TODAY, 3), '下发窗口结束日');
  eq(trip.windowItemCount, 1, '范围内项目数');
  eq(trip.outsideItemCount, 2, '范围外项目数');
  eq(trip.windowProgress.total, 1, '摘要进度只统计窗口内项目');
  eq(trip.progress.total, 3, '兼容字段仍统计全部项目');
  eq(trip.items.find(i => i.itemId === 'I_BEFORE').windowPosition, 'BEFORE',
    '范围前项目有服务端位置');
  eq(trip.items.find(i => i.itemId === 'I_INSIDE').windowPosition, 'INSIDE',
    '范围内项目有服务端位置');
  eq(trip.items.find(i => i.itemId === 'I_AFTER').windowPosition, 'AFTER',
    '范围后项目有服务端位置');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : `FAIL ${fail}`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
