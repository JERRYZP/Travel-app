const assert = require('assert');
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_page_bootstrap';
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

async function run() {
  CURRENT_DB._seed('users', [{
    _id: USER,
    openId: USER,
    nickname: '用户bootstrap',
    avatarUrl: '/images/avatars/default-1.png',
    protectedTaskQuota: 5,
    protectionMigratedAt: new Date(),
    subscribeQuota: 2,
    subscribeQuotas: { 'mock-template': 2 },
  }]);
  CURRENT_DB._seed('reminder_tasks', [{
    _id: 'task_future',
    userId: USER,
    backendStatus: 'WAITING',
    releaseAt: new Date(time.addDays(time.todayStr(), 2) + 'T20:00:00+08:00'),
    createdAt: new Date(),
    offsets: [5],
    sentOffsets: [],
  }]);

  const user = await reminder.main({ action: 'user.bootstrap' });
  assert.strictEqual(user.success, true);
  assert.strictEqual(user.user._id, USER);
  assert.strictEqual(user.user.nickname, '用户bootstrap');
  assert.ok(user.membership);
  assert.ok(Array.isArray(user.packages));
  assert.ok(user.subscription);
  assert.ok(user.runtimeVersion);

  CURRENT_DB._seed('spots', [{
    spotId: 'gugong',
    name: '故宫博物院',
    reservationRequired: true,
    difficultyScore: 5,
  }]);
  CURRENT_DB._seed('release_rules', [{
    spotId: 'gugong',
    advanceDays: 1,
    releaseTime: '20:00',
  }]);
  CURRENT_DB._seed('reminder_cart', [{
    _id: 'cart_boot',
    userId: USER,
    tripId: '__pending__',
    spotId: 'gugong',
    visitDate: time.addDays(time.todayStr(), 3),
    releaseAt: new Date(time.addDays(time.todayStr(), 2) + 'T20:00:00+08:00'),
    remindOn: true,
    reservationRequired: true,
  }]);

  const cart = await reminder.main({ action: 'cart.bootstrap' });
  assert.strictEqual(cart.success, true);
  assert.strictEqual(cart.cartSummary.count, 1);
  assert.strictEqual(cart.summary.reminderCount, 1);
  assert.ok(cart.membership);
  assert.ok(cart.subscription);
  assert.ok(cart.runtimeVersion);

  console.log('page-bootstrap.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
