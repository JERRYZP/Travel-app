/** admin.seed dryRun / spotIds 定向导入回归。 */
const Module = require('module');
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/reminder/lib/schema');

let db = createDb();
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return db; },
      getWXContext() { return { OPENID: '' }; },
      callFunction() { return Promise.reject(new Error('unexpected callFunction')); },
    };
  }
  return origLoad.apply(this, arguments);
};
const reminder = require('../cloudfunctions/reminder/index.js');
Module._load = origLoad;

const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;
let fail = 0;
const eq = (a, b, message) => {
  if (String(a) === String(b)) {
    console.log('ok  ', message, '=', a);
  } else {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  }
};

(async () => {
  console.log('=== 1. 空库 dryRun 只报告差异，不写库 ===');
  let res = await reminder.main({ action: 'admin.seed', dryRun: true, spotIds: ['tsinghua'] });
  eq(res.success, true, 'dryRun 成功');
  eq(res.dryRun, true, '返回 dryRun 标记');
  eq(res.report.spots.inserted, 0, 'dryRun 不累计写入');
  eq(res.differences.some(x => x.collection === COLLECTIONS.SPOTS && x.spotId === 'tsinghua' && x.missing), true,
    '景点缺失进入差异');
  eq(res.differences.some(x => x.collection === COLLECTIONS.RELEASE_RULES && x.spotId === 'tsinghua' && x.missing), true,
    '规则缺失进入差异');
  eq(db._dump(COLLECTIONS.SPOTS).length, 0, 'dryRun 后景点表仍为空');
  eq(db._dump(COLLECTIONS.RELEASE_RULES).length, 0, 'dryRun 后规则表仍为空');

  console.log('\n=== 2. spotIds 定向真实导入 ===');
  res = await reminder.main({ action: 'admin.seed', spotIds: ['tsinghua'] });
  eq(res.success, true, '定向 seed 成功');
  eq(db._dump(COLLECTIONS.SPOTS).length, 1, '只写目标景点');
  eq(db._dump(COLLECTIONS.RELEASE_RULES).length, 1, '只写目标规则');
  eq(db._dump(COLLECTIONS.RELEASE_RULES)[0].spotId, 'tsinghua', '目标规则正确');

  console.log('\n=== 3. dryRun 返回目标 backup 且不改无关数据 ===');
  const tsinghuaRule = db._dump(COLLECTIONS.RELEASE_RULES)[0];
  await db.collection(COLLECTIONS.RELEASE_RULES).doc(tsinghuaRule._id).update({
    data: { releaseSlots: rules.find(r => r.spotId === 'tsinghua').releaseSlots.filter(s => s.statusOnly !== true) },
  });
  await db.collection(COLLECTIONS.RELEASE_RULES).add({
    data: { spotId: 'gugong', releaseSlots: [], bookingTips: 'sentinel', advanceDays: 7, releaseTime: '20:00' },
  });
  res = await reminder.main({ action: 'admin.seed', dryRun: true, spotIds: ['tsinghua'] });
  eq(res.backup.spots.length, 1, 'backup 只含目标景点');
  eq(res.backup.rules.length, 1, 'backup 只含目标规则');
  eq(res.differences.every(x => x.spotId === 'tsinghua'), true, '差异只含目标景点');
  eq(res.differences.some(x => x.collection === COLLECTIONS.RELEASE_RULES
    && x.changedKeys.includes('releaseSlots')), true, 'statusOnly 差异逐字段可见');
  eq(db._dump(COLLECTIONS.RELEASE_RULES).find(r => r.spotId === 'tsinghua').releaseSlots.length, 1,
    'dryRun 不改目标规则');

  console.log('\n=== 4. 定向真实导入只更新目标，保留无关漂移 ===');
  res = await reminder.main({ action: 'admin.seed', spotIds: ['tsinghua'] });
  eq(res.success, true, '定向更新成功');
  eq(db._dump(COLLECTIONS.RELEASE_RULES).find(r => r.spotId === 'tsinghua').releaseSlots.length, 2,
    '目标规则写入双时段');
  eq(db._dump(COLLECTIONS.RELEASE_RULES).find(r => r.spotId === 'gugong').bookingTips, 'sentinel',
    '无关规则保持原值');

  if (fail) process.exit(1);
  console.log('\nAll admin.seed tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
