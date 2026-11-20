/** 内部维护任务：只允许定时触发，且必须保留过期事件清理。 */
const assert = require('assert');
const Module = require('module');
const { createDb } = require('./mock-db');

const CURRENT_DB = createDb();
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
    };
  }
  return origLoad.apply(this, arguments);
};
const maintenance = require('../cloudfunctions/admin/index.js');
Module._load = origLoad;

async function main() {
  const deniedExternal = await maintenance.main({ action: 'admin.overview' });
  assert.strictEqual(deniedExternal.success, false);
  assert.strictEqual(deniedExternal.errorCode, 1099, '旧 Web 管理接口必须已移除');

  const deniedNonTimer = await maintenance.main({ action: 'internal.rollupDaily' });
  assert.strictEqual(deniedNonTimer.success, false);
  assert.strictEqual(deniedNonTimer.errorCode, 1040, '普通调用不得触发内部汇总');

  CURRENT_DB._seed('reminder_events', [{
    _id: 'expired_event',
    eventKey: 'expired_event:OLD',
    eventType: 'TASK_CREATED',
    eventAt: new Date('2026-01-01T00:00:00+08:00'),
    expireAt: new Date('2026-06-01T00:00:00+08:00'),
  }]);
  const timerResult = await maintenance.main({ Type: 'Timer' });
  assert.strictEqual(timerResult.success, true, '定时维护任务必须成功');
  assert.strictEqual(CURRENT_DB._size('reminder_events'), 0, '过期事件必须被清理');

  console.log('admin-maintenance.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
