/**
 * 首页读模型三态与失效重建回归。
 */

const assert = require('assert');
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_runtime_001';
const TODAY = time.todayStr();
const VISIT = time.addDays(TODAY, 2);
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
const runtime = require('../cloudfunctions/reminder/lib/user-runtime.js');
Module._load = origLoad;

async function seed() {
  CURRENT_DB._seed('users', [{
    _id: USER,
    openId: USER,
    nickname: '用户runtime',
    avatarUrl: '/images/avatars/default-1.png',
    protectedTaskQuota: 5,
    protectionMigratedAt: new Date(),
    subscribeQuota: 1,
  }]);
  CURRENT_DB._seed('spots', [{
    spotId: 'gugong',
    name: '故宫博物院',
    shortName: '故宫',
    reservationRequired: true,
    difficultyScore: 5,
    popularityScore: 5,
  }]);
  CURRENT_DB._seed('release_rules', [{
    spotId: 'gugong',
    advanceDays: 1,
    releaseTime: '20:00',
    closedDays: [],
  }]);
  CURRENT_DB._seed('trips', [{
    _id: 'TRIP_RUNTIME',
    userId: USER,
    city: '北京',
    startDate: TODAY,
    endDate: time.addDays(TODAY, 3),
    name: '北京测试行程',
    spotIds: ['gugong'],
    spots: [{ spotId: 'gugong', startDate: TODAY, endDate: time.addDays(TODAY, 3) }],
  }]);
  CURRENT_DB._seed('trip_items', [{
    _id: 'ITEM_RUNTIME',
    userId: USER,
    tripId: 'TRIP_RUNTIME',
    spotId: 'gugong',
    visitDate: VISIT,
    backupGroupId: 'TRIP_RUNTIME:gugong',
    reservationRequired: true,
    remindOn: true,
    result: null,
    resultAt: null,
  }]);
  CURRENT_DB._seed('reminder_tasks', [{
    _id: 'TASK_RUNTIME',
    userId: USER,
    itemId: 'ITEM_RUNTIME',
    tripId: 'TRIP_RUNTIME',
    spotId: 'gugong',
    visitDate: VISIT,
    releaseAt: new Date(time.addDays(VISIT, -1) + 'T20:00:00+08:00'),
    backendStatus: 'WAITING',
    offsets: [5],
    channels: ['OFFICIAL_ACCOUNT'],
    sentOffsets: [],
  }]);
  CURRENT_DB._seed('trips', [{
    _id: 'TRIP_HISTORY',
    userId: USER,
    city: '北京',
    startDate: time.addDays(TODAY, -5),
    endDate: time.addDays(TODAY, -1),
    name: '北京历史行程',
    spotIds: ['gugong'],
    spots: [{ spotId: 'gugong', startDate: time.addDays(TODAY, -5), endDate: time.addDays(TODAY, -1) }],
  }]);
  CURRENT_DB._seed('trip_items', [{
    _id: 'ITEM_HISTORY',
    userId: USER,
    tripId: 'TRIP_HISTORY',
    spotId: 'gugong',
    visitDate: time.addDays(TODAY, -3),
    backupGroupId: 'TRIP_HISTORY:gugong',
    reservationRequired: true,
    remindOn: true,
    result: 'SUCCESS',
  }]);
  CURRENT_DB._seed('reminder_tasks', [{
    _id: 'TASK_HISTORY',
    userId: USER,
    itemId: 'ITEM_HISTORY',
    tripId: 'TRIP_HISTORY',
    spotId: 'gugong',
    visitDate: time.addDays(TODAY, -3),
    releaseAt: new Date(time.addDays(TODAY, -10) + 'T20:00:00+08:00'),
    backendStatus: 'TRIGGERED',
    offsets: [5],
    channels: ['OFFICIAL_ACCOUNT'],
    sentOffsets: [5],
  }]);
}

async function main() {
  await seed();
  process.env.HOME_RUNTIME_MODE = 'off';
  let result = await reminder.main({ action: 'home.bootstrap' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.runtimeVersion, 'legacy');
  assert.strictEqual(CURRENT_DB._size('user_runtime'), 0);

  process.env.HOME_RUNTIME_MODE = 'on';
  result = await reminder.main({ action: 'home.bootstrap' });
  assert.strictEqual(result.success, true);
  assert.ok(result.runtimeVersion.startsWith('runtime:'));
  assert.strictEqual(CURRENT_DB._size('user_runtime'), 1);
  const first = CURRENT_DB._dump('user_runtime')[0];
  assert.strictEqual(first.schemaVersion, runtime.SCHEMA_VERSION);
  assert.strictEqual(first.stale, false);
  assert.strictEqual(first.sources.items.length, 1);
  assert.strictEqual(first.sources.history.length, 1);
  assert.strictEqual(first.sources.allTasks.length, 1,
    '历史事项只保留摘要，不把全部历史任务塞进派生文档');

  const warm = await reminder.main({ action: 'home.bootstrap' });
  assert.strictEqual(warm.success, true);
  assert.strictEqual(warm.trips.length, 1);
  assert.strictEqual(warm.history.length, 1);

  await reminder.main({
    action: 'user.updateNotifyPrefs',
    notifyPrefs: { officialAccount: true, sms: false, offsets: [5] },
  });
  const invalidated = CURRENT_DB._dump('user_runtime')[0];
  assert.strictEqual(invalidated.stale, true);

  result = await reminder.main({ action: 'home.bootstrap' });
  assert.strictEqual(result.success, true);
  const rebuilt = CURRENT_DB._dump('user_runtime')[0];
  assert.strictEqual(rebuilt.stale, false);
  assert.strictEqual(runtime.isUsable(rebuilt), true);
  assert.strictEqual(
    runtime.normalizedHash(runtime.comparisonShape(result)),
    runtime.normalizedHash(runtime.comparisonShape(result))
  );

  process.env.RUNTIME_BACKFILL_TOKEN = 'test-runtime-token';
  const denied = await reminder.main({ action: 'admin.runtimeBackfill', token: 'wrong' });
  assert.strictEqual(denied.success, false);
  const backfill = await reminder.main({
    action: 'admin.runtimeBackfill',
    token: 'test-runtime-token',
    limit: 20,
  });
  assert.strictEqual(backfill.success, true);
  assert.strictEqual(backfill.built, 1);
  assert.strictEqual(backfill.hasMore, false);

  process.env.HOME_RUNTIME_MODE = 'off';
  console.log('user-runtime.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
