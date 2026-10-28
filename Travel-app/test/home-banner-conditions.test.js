/**
 * 首页两个顶部横幅的集成回归：
 * - 临近放票（1 小时内）必须下发 stickyBanner；
 * - 授权真实不足（0 次、1 条待发送）必须下发 reminderQuotaWarning。
 *
 * 用 in-memory mock DB 走 `reminder.main({ action: 'home.bootstrap' })`，
 * 钉住「纯函数正确，但聚合出口漏字段/条件被误挡」这一类问题。
 *
 * 运行：node test/home-banner-conditions.test.js
 */
const Module = require('module');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_banner_001';
const TEMPLATE = '_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA';
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
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

(async () => {
  /* 放票时刻取「当前 + 30 分钟」并落到分钟整点；行程放在次日，
     规则 advanceDays=1，于是 deriveReleaseAt 正好回到这个时刻。 */
  const releaseAt = new Date(Date.now() + 30 * 60000);
  const releaseDate = time.toDateStr(releaseAt);
  const parts = time.beijingParts(releaseAt);
  const releaseTime = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const derivedReleaseAt = time.parseBeijing(releaseDate, releaseTime);
  const visitDate = time.addDays(releaseDate, 1);

  await CURRENT_DB.collection('spots').add({
    data: { spotId: 'gugong', name: '故宫博物院', reservationRequired: true, difficultyScore: 5 },
  });
  await CURRENT_DB.collection('release_rules').add({
    data: { spotId: 'gugong', releaseTime, advanceDays: 1, closedDays: [] },
  });
  await CURRENT_DB.collection('users').add({
    data: {
      openId: USER,
      subscribeQuota: 0,
      subscribeQuotas: { [TEMPLATE]: 0 },
      subscribeTemplateId: TEMPLATE,
    },
  });
  await CURRENT_DB.collection('trips').add({
    data: {
      _id: 'trip_banner', userId: USER, city: '北京',
      startDate: visitDate, endDate: visitDate, name: '横幅测试行程', spotIds: ['gugong'],
    },
  });
  await CURRENT_DB.collection('trip_items').add({
    data: {
      _id: 'item_banner', userId: USER, tripId: 'trip_banner', spotId: 'gugong',
      visitDate, remindOn: true,
    },
  });
  await CURRENT_DB.collection('reminder_tasks').add({
    data: {
      _id: 'task_banner', userId: USER, itemId: 'item_banner', tripId: 'trip_banner',
      spotId: 'gugong', visitDate, releaseAt: derivedReleaseAt,
      offsets: [5], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING',
      sentOffsets: [], templateId: TEMPLATE,
    },
  });

  const res = await reminder.main({ action: 'home.bootstrap' });

  console.log('=== 1. 1 小时内放票 ===');
  eq(res.success, true, 'bootstrap 成功');
  eq(Boolean(res.stickyBanner), true, '临近放票下发 stickyBanner');
  eq(res.stickyBanner && res.stickyBanner.itemId, 'item_banner', '横幅指向对应行程项');
  eq(/开抢故宫博物院/.test((res.stickyBanner && res.stickyBanner.text) || ''), true, '横幅文案含景点');

  console.log('=== 2. 授权真实不足 ===');
  eq(Boolean(res.reminderQuotaWarning), true, '0 次授权 + 1 条待发送时下发额度预警');
  eq(res.reminderQuotaWarning && res.reminderQuotaWarning.level, 'exhausted', '额度预警为 exhausted');
  eq(res.reminderQuotaWarning && res.reminderQuotaWarning.pendingMessageCount, 1, '待发送消息数为 1');

  if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
  console.log('\nhome-banner-conditions.test.js 全部通过');
})();
