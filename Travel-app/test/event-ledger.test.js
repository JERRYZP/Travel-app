/**
 * 事件账本集成测试：任务创建/删除写事件，写入失败不影响主流程。
 * 运行：node test/event-ledger.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, ReminderBackendStatus, ChannelType } = require('../cloudfunctions/reminder/lib/schema');
const task = require('../cloudfunctions/reminder/lib/task');
const events = require('../cloudfunctions/reminder/lib/events');
const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

(async () => {
  console.log('--- 1. 事件字段确定性 ---');
  const taskRow = {
    _id: 't1', userId: 'u1', itemId: 'i1', tripId: 'p1', spotId: 'gugong',
    templateId: 'tpl', channels: ['OFFICIAL_ACCOUNT'], releaseAt: new Date('2026-10-08T20:00:00+08:00'),
    visitDate: '2026-10-10',
  };
  const created = events.taskEvent(events.EVENT_TYPES.TASK_CREATED, taskRow, new Date('2026-10-01T10:00:00+08:00'));
  eq(created.eventKey, 't1:TASK_CREATED', '任务事件 key 固定');
  eq(created.expireAt instanceof Date, true, '事件带过期时间');
  const failed = events.sendEvent(taskRow, 5, { ok: false, skipped: false, errCode: 43101, reason: 'errCode=43101 quota' }, new Date('2026-10-08T19:55:00+08:00'));
  eq(failed.eventType, 'SEND_FAILED', '失败发送事件');
  eq(failed.errorCode, 43101, '失败事件保留 errCode');
  eq(failed.scheduledAt.toISOString(), new Date('2026-10-08T19:55:00+08:00').toISOString(), '发送事件记录计划时刻');

  console.log('\n--- 2. task.submit 写 TASK_CREATED，删除写 TASK_CANCELED ---');
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spotsSeed);
  db._seed(COLLECTIONS.RELEASE_RULES, rulesSeed);
  const releaseAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.collection(COLLECTIONS.REMINDER_CART).add({
    data: {
      userId: 'u1', tripId: '__pending__', spotId: 'gugong', visitDate: '2026-12-01',
      releaseAt, reservationRequired: true, remindOn: true,
    },
  });
  const submitted = await task.submit(db, 'u1', {
    channels: [ChannelType.OFFICIAL_ACCOUNT], offsets: [5, 2],
  });
  eq(submitted.success, true, '提交任务成功');
  const eventRows = db._dump('reminder_events');
  eq(eventRows.filter(e => e.eventType === 'TASK_CREATED').length, 1, '创建任务写一条事件');
  const createdTask = db._dump(COLLECTIONS.REMINDER_TASKS)[0];
  const removed = await task.remove(db, 'u1', createdTask._id);
  eq(removed.success, true, '删除等待任务成功');
  eq(db._dump('reminder_events').filter(e => e.eventType === 'TASK_CANCELED').length, 1, '删除任务写取消事件');

  console.log('\n--- 3. 事件写入失败不抛出 ---');
  const badDb = { collection() { throw new Error('collection unavailable'); } };
  const result = await events.recordEvent(badDb, created);
  eq(result, false, '写入失败返回 false');

  if (fail) {
    console.error(`\n${fail} 个断言失败`);
    process.exit(1);
  }
  console.log('\nevent-ledger.test.js 全部通过');
})();
