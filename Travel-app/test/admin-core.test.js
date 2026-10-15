/**
 * admin 云函数核心单元测试：密码/token、脱敏、统计口径、每日汇总和首次登录。
 * 运行：node test/admin-core.test.js
 */
const { createDb } = require('./mock-db');
const auth = require('../cloudfunctions/admin/lib/auth');
const privacy = require('../cloudfunctions/admin/lib/privacy');
const analytics = require('../cloudfunctions/admin/lib/analytics');
const admin = require('../cloudfunctions/admin/lib/admin');
const { COLLECTIONS, EVENT_TYPES, METRIC_TYPES } = require('../cloudfunctions/admin/lib/schema');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

(async () => {
  console.log('--- 1. 密码哈希与 token ---');
  const pwd = auth.hashPassword('correct horse battery staple');
  eq(auth.verifyPassword('correct horse battery staple', pwd.salt, pwd.hash), true, '正确密码通过');
  eq(auth.verifyPassword('wrong', pwd.salt, pwd.hash), false, '错误密码拒绝');
  const token = auth.createToken({ _id: 'a1', username: 'admin', role: 'SUPER_ADMIN', tokenVersion: 0 }, 'secret', 1000);
  eq(Boolean(auth.verifyToken(token, 'secret', 2000)), true, '合法 token 可验签');
  eq(auth.verifyToken(token, 'bad', 2000), null, '错误签名拒绝');
  eq(auth.verifyToken(token, 'secret', auth.SESSION_TTL_MS + 2000), null, '过期 token 拒绝');

  console.log('\n--- 2. 定时任务调用边界 ---');
  eq(admin.isTimerInvocation({}, { TRIGGER_SRC: 'timer' }), true, 'TRIGGER_SRC=timer 允许内部汇总');
  eq(admin.isTimerInvocation({ Type: 'Timer' }, {}), true, 'Timer 事件允许内部汇总');
  eq(admin.isTimerInvocation({ action: 'internal.rollupDaily' }, {}), false, '普通客户端请求不能触发内部汇总');

  console.log('\n--- 3. 敏感字段脱敏 ---');
  eq(privacy.maskId('oZ6IFxvYK1mKzBaehMcOPIl_CgN0'), 'oZ6I****CgN0', 'OpenID 保留首尾');
  eq(privacy.maskPhone('13800138000'), '138****8000', '手机号保留首尾');
  eq(privacy.maskNickname('用户abcdef'), '用**f', '昵称脱敏');

  console.log('\n--- 4. 事件统计口径 ---');
  const startDate = '2026-10-01';
  const endDate = '2026-10-07';
  const rows = [
    { eventKey: 't1:created', eventType: EVENT_TYPES.TASK_CREATED, eventAt: new Date('2026-10-01T10:00:00+08:00'), taskId: 't1', userId: 'u1', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00') },
    { eventKey: 't2:created', eventType: EVENT_TYPES.TASK_CREATED, eventAt: new Date('2026-10-02T10:00:00+08:00'), taskId: 't2', userId: 'u2', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00') },
    { eventKey: 't1:send:5', eventType: EVENT_TYPES.SEND_SUCCEEDED, eventAt: new Date('2026-10-03T19:55:00+08:00'), taskId: 't1', userId: 'u1', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00'), offset: 5 },
    { eventKey: 't1:trigger', eventType: EVENT_TYPES.TASK_TRIGGERED, eventAt: new Date('2026-10-03T19:55:00+08:00'), taskId: 't1', userId: 'u1', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00') },
    { eventKey: 't2:missed', eventType: EVENT_TYPES.TASK_MISSED, eventAt: new Date('2026-10-03T20:00:00+08:00'), taskId: 't2', userId: 'u2', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00') },
    { eventKey: 't2:send:5', eventType: EVENT_TYPES.SEND_FAILED, eventAt: new Date('2026-10-03T19:55:00+08:00'), taskId: 't2', userId: 'u2', spotId: 'gugong', releaseAt: new Date('2026-10-03T20:00:00+08:00'), offset: 5 },
  ];
  const summary = analytics.summarizeEvents(rows, { startDate, endDate });
  eq(summary.taskCreatedCount, 2, '创建任务数');
  eq(summary.distinctCreatedUserCount, 2, '创建用户去重数');
  eq(summary.dueTaskCount, 2, '到期任务数');
  eq(summary.triggeredTaskCount, 1, '已处理任务数');
  eq(summary.missedTaskCount, 1, '未送达任务数');
  eq(summary.sendSuccessCount, 1, '发送成功数');
  eq(summary.sendFailureCount, 1, '发送失败数');
  eq(summary.dueHandlingRate, 50, '到期处理率');
  eq(summary.sendSuccessRate, 50, '发送成功率');

  const docs = analytics.buildDailyStatDocs(rows, '2026-10-03');
  const due = docs.find(d => d.metricType === METRIC_TYPES.DUE && d.spotId === 'gugong');
  eq(due.counts.dueTaskCount, 2, '每日汇总到期数');
  eq(due.counts.triggeredTaskCount, 1, '每日汇总已处理数');
  eq(due.counts.missedTaskCount, 1, '每日汇总未送达数');

  console.log('\n--- 5. 首次管理员登录与会话 ---');
  const db = createDb();
  const env = {
    ADMIN_BOOTSTRAP_USERNAME: 'admin',
    ADMIN_BOOTSTRAP_PASSWORD_HASH: pwd.hash,
    ADMIN_BOOTSTRAP_PASSWORD_SALT: pwd.salt,
    ADMIN_SESSION_SECRET: 'test-secret',
  };
  const login = await admin.login(db, { username: 'admin', password: 'correct horse battery staple' }, env, Date.now());
  eq(login.success, true, 'bootstrap 登录成功');
  eq(db._size(COLLECTIONS.ADMINS), 1, '首次登录创建 admins 文档');
  const session = await admin.authenticate(db, login.token, env, Date.now());
  eq(session.ok, true, '返回 token 可认证');
  eq(session.admin.username, 'admin', '认证结果包含管理员');

  console.log('\n--- 6. 每日汇总幂等 ---');
  const rollupDb = createDb();
  await rollupDb.collection(COLLECTIONS.REMINDER_EVENTS).add({
    data: {
      eventKey: 'task-rollup:TASK_CREATED',
      eventType: EVENT_TYPES.TASK_CREATED,
      eventAt: new Date('2026-10-06T10:00:00+08:00'),
      taskId: 'task-rollup',
      userId: 'user-rollup',
      spotId: 'gugong',
      releaseAt: new Date('2026-10-08T20:00:00+08:00'),
      expireAt: new Date('2027-04-04T10:00:00+08:00'),
    },
  });
  await admin.rollupDaily(rollupDb, { days: 1 }, new Date('2026-10-06T12:00:00+08:00'));
  const firstSize = rollupDb._size(COLLECTIONS.DAILY_STATS);
  await admin.rollupDaily(rollupDb, { days: 1 }, new Date('2026-10-06T12:00:00+08:00'));
  eq(rollupDb._size(COLLECTIONS.DAILY_STATS), firstSize, '重复汇总不新增重复文档');
  const created = rollupDb._dump(COLLECTIONS.DAILY_STATS).find(d => d.metricType === METRIC_TYPES.CREATED);
  eq(created.counts.taskCreatedCount, 1, '汇总记录创建任务数');

  console.log('\n--- 7. 普通详情不泄露原始敏感字段 ---');
  const privacyDb = createDb();
  await privacyDb.collection(COLLECTIONS.USERS).add({
    data: { _id: 'user-doc-1', openId: 'openid_secret_001', nickname: '张三丰', phone: '13800138000', createdAt: new Date() },
  });
  await privacyDb.collection(COLLECTIONS.TRIP_ITEMS).add({
    data: { _id: 'item-1', userId: 'openid_secret_001', spotId: 'gugong', visitDate: '2026-10-08' },
  });
  await privacyDb.collection(COLLECTIONS.REMINDER_TASKS).add({
    data: { _id: 'task-1', userId: 'openid_secret_001', itemId: 'item-1', spotId: 'gugong', backendStatus: 'WAITING', releaseAt: new Date(), offsets: [5] },
  });
  const detail = await admin.userDetail(privacyDb, { id: 'user-doc-1' });
  eq(detail.user.openId, undefined, '用户详情不返回 openId');
  eq(detail.user.phone, undefined, '用户详情不返回手机号');
  eq(detail.tasks[0].userId, undefined, '用户详情任务不返回 userId');
  const taskDetail = await admin.taskDetail(privacyDb, { id: 'task-1' });
  eq(taskDetail.task.userId, undefined, '任务详情不返回 userId');
  eq(taskDetail.item.userId, undefined, '任务详情行程项不返回 userId');

  if (fail) {
    console.error(`\n${fail} 个断言失败`);
    process.exit(1);
  }
  console.log('\nadmin-core.test.js 全部通过');
})();
