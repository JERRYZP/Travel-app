/**
 * 景点静态快照回归：内容来自唯一数据真身，客户端热路径本地读取。
 */

const assert = require('assert');
const spotsSource = require('../data/spots.json').spots;
const rulesSource = require('../data/rules.json').rules;
const snapshot = require('../miniprogram/data/spots-snapshot.js');
const spotsStatic = require('../miniprogram/utils/spots-static.js');
const builder = require('../scripts/build-spots-snapshot.js');

const FIXED_NOW = new Date('2026-11-02T12:00:00+08:00');
const TSINGHUA_NOW = new Date('2026-11-24T14:20:00+08:00');

function run() {
  assert.strictEqual(snapshot.schemaVersion, 'spots-snapshot/v1');
  assert.strictEqual(snapshot.cards.length, spotsSource.length);
  assert.strictEqual(snapshot.cards.length, rulesSource.length);
  assert.ok(/^[a-f0-9]{20}$/.test(snapshot.contentVersion));
  assert.deepStrictEqual(
    snapshot.cards.map(card => card.spotId).sort(),
    spotsSource.map(spot => spot.spotId).sort()
  );

  const ruleMap = Object.fromEntries(rulesSource.map(rule => [rule.spotId, rule]));
  const gugongSpot = spotsSource.find(spot => spot.spotId === 'gugong');
  const gugongRule = ruleMap.gugong;
  const expected = spotsStatic._internal.hydrateDetail(
    builder.buildDetail(gugongSpot, gugongRule, FIXED_NOW),
    FIXED_NOW
  );
  const local = snapshot.cards.find(card => card.spotId === 'gugong');
  const actual = spotsStatic._internal.hydrateDetail(local, FIXED_NOW);
  assert.strictEqual(actual.releaseStatus, expected.releaseStatus);
  assert.strictEqual(actual.earliestDate, expected.earliestDate);
  assert.strictEqual(actual.closedDaysLabel, expected.closedDaysLabel);
  assert.ok(actual.entries.length > 0);

  const tsinghuaCard = snapshot.cards.find(card => card.spotId === 'tsinghua');
  const tsinghua = spotsStatic._internal.hydrateDetail(tsinghuaCard, TSINGHUA_NOW);
  assert.strictEqual(tsinghua.remindable, true, '清华仍有即时预约提醒');
  assert.strictEqual(tsinghua.earliestDate, '2026-11-29', '可预约至包含抽签窗口');
  assert.deepStrictEqual(tsinghua.releaseTime, ['08:00'], '提醒文案仍只展示即时预约');
  assert.deepStrictEqual(tsinghua.tags, ['提前1-7天放票', '每日08:00放票'], '卡片标签不展示抽签');
  assert.strictEqual(tsinghua.releaseSlots.find(slot => slot.key === 'tsinghua-lottery').statusOnly, true,
    '抽签在数据中标记为 statusOnly');

  return spotsStatic.search('故宫', FIXED_NOW).then(result => {
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data[0].spotId, 'gugong');
    return spotsStatic.batch(['gugong', 'guobo'], FIXED_NOW);
  }).then(result => {
    assert.deepStrictEqual(result.data.map(card => card.spotId), ['gugong', 'guobo']);
    console.log('spots-snapshot.test.js 全部通过');
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
