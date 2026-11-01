/**
 * notifier 状态写入 → 事件账本桥接测试。
 * 运行：node test/notifier-event-bridge.test.js
 */
const Module = require('module');
const origLoad = Module._load;

const docs = {
  reminder_tasks: [{ _id: 't1', userId: 'u1', itemId: 'i1', tripId: 'p1', spotId: 'gugong', templateId: 'tpl', channels: ['OFFICIAL_ACCOUNT'], offsets: [5], sentOffsets: [], backendStatus: 'WAITING', releaseAt: new Date(1000), visitDate: '2026-10-10' }],
  reminder_events: [],
};

function queryFor(name) {
  const rows = docs[name] || (docs[name] = []);
  return {
    where() { return this; },
    doc(id) {
      return {
        update: async ({ data }) => {
          const row = rows.find(r => r._id === id);
          Object.assign(row, data);
          return { stats: { updated: 1 } };
        },
      };
    },
    add: async ({ data }) => { rows.push(Object.assign({ _id: `${name}_${rows.length + 1}` }, data)); return { _id: rows[rows.length - 1]._id }; },
    get: async () => ({ data: rows.slice() }),
    skip() { return this; },
    limit() { return this; },
    orderBy() { return this; },
    count: async () => ({ total: rows.length }),
  };
}

const db = { command: {}, collection: queryFor };
const stub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'cloud1-test',
  database() { return db; },
  getWXContext() { return {}; },
  callFunction() { return Promise.resolve({ result: {} }); },
};
Module._load = function (request) {
  if (request === 'wx-server-sdk') return stub;
  return origLoad.apply(this, arguments);
};
const { _internal } = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

(async () => {
  const t = docs.reminder_tasks[0];
  await _internal.markResult(t, 5, { ok: false, skipped: false, errCode: 43101, reason: 'errCode=43101 quota' }, 2000, { sentOffsets: [], backendStatus: 'WAITING' });
  const types = docs.reminder_events.map(e => e.eventType);
  eq(types.includes('SEND_FAILED'), true, '失败发送写事件');
  eq(types.includes('TASK_MISSED'), true, '任务未送达写事件');
  eq(t.backendStatus, 'MISSED', '任务状态仍写为 MISSED');
  if (fail) process.exit(1);
  console.log('\nnotifier-event-bridge.test.js 全部通过');
})();
