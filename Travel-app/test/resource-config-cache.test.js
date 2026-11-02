const assert = require('assert');
const { createDb } = require('./mock-db');
const reminderSales = require('../cloudfunctions/reminder/lib/membership-sales.js');
const reminderEnforcement = require('../cloudfunctions/reminder/lib/membership-enforcement.js');
const paymentSales = require('../cloudfunctions/payment/lib/membership-sales.js');
const paymentEnforcement = require('../cloudfunctions/payment/lib/membership-enforcement.js');

function freshDb() {
  const db = createDb();
  db._seed('payment_config', [
    { _id: 'membership_sales', state: 'OPEN' },
    { _id: 'membership_enforcement', mode: 'all' },
  ]);
  return db;
}

async function run() {
  for (const rule of [reminderSales, paymentSales]) {
    const db = freshDb();
    const first = await rule.read(db, { cache: true });
    assert.strictEqual(first.purchaseEnabled, true);
    await db.collection('payment_config').doc('membership_sales').update({
      data: { state: 'PAUSED', reason: 'cache test' },
    });
    const cached = await rule.read(db, { cache: true });
    assert.strictEqual(cached.purchaseEnabled, true, '缓存窗口内不重复读配置');
    rule.invalidate(db);
    const fresh = await rule.read(db, { cache: true });
    assert.strictEqual(fresh.purchaseEnabled, false, '主动失效后立即读新值');
  }

  for (const rule of [reminderEnforcement, paymentEnforcement]) {
    const db = freshDb();
    const first = await rule.read(db, { cache: true });
    assert.strictEqual(first.mode, 'all');
    await db.collection('payment_config').doc('membership_enforcement').update({
      data: { mode: 'off' },
    });
    const cached = await rule.read(db, { cache: true });
    assert.strictEqual(cached.mode, 'all');
    rule.invalidate(db);
    const fresh = await rule.read(db, { cache: true });
    assert.strictEqual(fresh.mode, 'off');
  }

  console.log('resource-config-cache.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
