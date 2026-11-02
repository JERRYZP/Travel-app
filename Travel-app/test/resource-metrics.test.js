const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDb } = require('./mock-db');
const { createResourceMonitor } = require('../cloudfunctions/reminder/lib/resource-metrics.js');

async function run() {
  const files = [
    '../cloudfunctions/reminder/lib/resource-metrics.js',
    '../cloudfunctions/spots/lib/resource-metrics.js',
    '../cloudfunctions/payment/lib/resource-metrics.js',
    '../cloudfunctions/notifier/lib/resource-metrics.js',
  ].map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
  assert.strictEqual(new Set(files).size, 1, '独立部署单元的资源计量副本必须一致');

  const db = createDb();
  db._seed('demo', [{ _id: 'a' }, { _id: 'b' }]);
  const monitor = createResourceMonitor('test', db);
  const result = await monitor.run('demo.read', db, async () => {
    const rows = await monitor.db.collection('demo').where({}).get();
    await monitor.db.collection('demo').doc('a').update({ data: { touched: true } });
    monitor.childCall();
    return { success: true, count: rows.data.length };
  });
  const snapshot = monitor.snapshot();
  assert.strictEqual(result.count, 2);
  assert.strictEqual(snapshot.service, 'test');
  assert.strictEqual(snapshot.action, 'demo.read');
  assert.strictEqual(snapshot.dbReadQueries, 1);
  assert.strictEqual(snapshot.returnedDocuments, 2);
  assert.strictEqual(snapshot.dbWriteQueries, 1);
  assert.strictEqual(snapshot.childFunctionCalls, 1);
  assert.strictEqual(snapshot.resultCode, 0);
  console.log('resource-metrics.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
