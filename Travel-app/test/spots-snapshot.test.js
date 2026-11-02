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
