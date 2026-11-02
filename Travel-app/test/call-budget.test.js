/**
 * 关键热路径调用预算。
 */

const assert = require('assert');
const { createDb } = require('./mock-db');
const { createResourceMonitor } = require('../cloudfunctions/reminder/lib/resource-metrics.js');
const cart = require('../cloudfunctions/reminder/lib/cart.js');
const time = require('../cloudfunctions/reminder/lib/time.js');
const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;

async function batchBudget() {
  const db = createDb();
  db._seed('spots', spots);
  db._seed('release_rules', rules);
  const monitor = createResourceMonitor('budget', db);
  const visitDate = time.addDays(time.todayStr(), 30);
  const events = ['gugong', 'guobo', 'tiantan', 'shoubo', 'badaling'].map(spotId => ({
    spotId,
    visitDate,
    remindOnDefault: true,
    status: 'SELECTABLE',
  }));
  let snapshot = null;
  const result = await monitor.run('cart.addAll', db, async () => {
    const value = await cart.addBatch(
      monitor.db,
      'budget-user',
      null,
      events,
      'departure',
      visitDate
    );
    snapshot = monitor.snapshot();
    return value;
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.added, 5);
  assert.strictEqual(snapshot.dbReadQueries, 4,
    '批量加入的读次数必须固定，不能随项目数线性增长');
  assert.strictEqual(snapshot.childFunctionCalls, 0);
  assert.strictEqual(result.cartSummary.count, 5);
}

async function main() {
  await batchBudget();
  console.log('call-budget.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
