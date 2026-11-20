/** 过期清理任务：只允许定时触发，旧 Web API 必须全部关闭。 */
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

  const deniedNonTimer = await maintenance.main({ action: 'internal.cleanupExpired' });
  assert.strictEqual(deniedNonTimer.success, false);
  assert.strictEqual(deniedNonTimer.errorCode, 1040, '普通调用不得触发内部清理');

  CURRENT_DB._seed('reminder_events', [{
    _id: 'expired_event',
    eventKey: 'expired_event:OLD',
    expireAt: new Date('2026-06-01T00:00:00+08:00'),
  }]);
  CURRENT_DB._seed('admin_audit_logs', [{
    _id: 'expired_audit',
    expireAt: new Date('2026-06-01T00:00:00+08:00'),
  }]);
  const timerResult = await maintenance.main({ Type: 'Timer', TriggerName: 'adminDailyCleanup' });
  assert.strictEqual(timerResult.success, true, '定时清理必须成功');
  assert.strictEqual(timerResult.removed, 2, '两个集合的过期记录都必须清理');
  assert.strictEqual(CURRENT_DB._size('reminder_events'), 0);
  assert.strictEqual(CURRENT_DB._size('admin_audit_logs'), 0);

  console.log('admin-maintenance.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
