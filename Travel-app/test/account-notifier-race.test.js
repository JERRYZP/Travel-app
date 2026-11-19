/** 注销竞态：notifier 已预取任务，但任务随后被注销删除，实际发送前必须跳过。 */
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
      getWXContext() { return { OPENID: 'notifier' }; },
      callFunction() { return Promise.resolve({ result: { success: true } }); },
    };
  }
  return origLoad.apply(this, arguments);
};
const notifier = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

async function main() {
  const now = Date.now();
  const task = {
    _id: 'task_deleted_during_send',
    userId: 'openid_deleted',
    tripId: 'trip_deleted',
    itemId: 'item_deleted',
    spotId: 'gugong',
    templateId: 'tpl_new',
    channels: ['OFFICIAL_ACCOUNT'],
    offsets: [5],
    sentOffsets: [],
    backendStatus: 'WAITING',
    releaseAt: new Date(now + 5.5 * 60 * 1000),
    visitDate: '2026-12-01',
  };
  CURRENT_DB._seed('reminder_tasks', [task]);
  await CURRENT_DB.collection('reminder_tasks').doc(task._id).remove();

  const out = await notifier._internal.scanAndSend([{ ...task }], now);
  assert.strictEqual(out.due, 1);
  assert.strictEqual(out.sent, 0);
  assert.ok(out.skipped >= 1, '已删除任务必须计入 skipped');
  assert.strictEqual(CURRENT_DB._size('reminder_tasks'), 0, 'notifier 不得复活已删除任务');
  console.log('account-notifier-race.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
