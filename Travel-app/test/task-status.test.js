/**
 * task.list 过期收敛测试（REMINDER-RULE-004 读取时兜底）
 *
 * 背景：notifier 的 sweepMissed 依赖「每分钟定时触发 + backendStatus+releaseAt 复合索引 +
 * WX_APPSECRET 环境变量」三者同时正常。任一处出问题，任务就永久卡在 WAITING：
 * 前端「已过期」列表里显示「待提醒」、且没有任何失败提示（2026-09-14 线上现象）。
 * 这里验证读取路径上的兜底补判能把状态收敛成「未送达」，并且不误伤未来/已提醒任务。
 *
 * 运行：node test/task-status.test.js
 */
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, ReminderBackendStatus, ChannelType,
} = require('../cloudfunctions/reminder/lib/schema');
const task = require('../cloudfunctions/reminder/lib/task');
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_status_001';
const DAY_MS = 86400000;
const HOUR_MS = 3600 * 1000;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

function freshDb() {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, [
    { spotId: 'badaling', name: '八达岭长城', difficultyScore: 1, reservationRequired: true },
    { spotId: 'gugong', name: '故宫博物院', difficultyScore: 5, reservationRequired: true },
  ]);
  return db;
}

function mkTask(db, spotId, releaseAt, extra = {}) {
  return db.collection(COLLECTIONS.REMINDER_TASKS).add({
    data: {
      userId: USER,
      tripId: 'TRIP1',
      spotId,
      visitDate: time.addDays(time.todayStr(), 10),
      releaseAt,
      offsets: [5, 2],
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      backendStatus: ReminderBackendStatus.WAITING,
      sentOffsets: [],
      createdAt: time.now(),
      ...extra,
    },
  });
}

const flatten = (res) => (res.groups || []).reduce((acc, g) => acc.concat(g.items), []);
const findSpot = (db, spotId) =>
  db._dump(COLLECTIONS.REMINDER_TASKS).find(t => t.spotId === spotId);

(async () => {
  const nowTs = Date.now();
  const past = new Date(nowTs - 6 * HOUR_MS);   // 6 小时前已过放票时刻
  const future = new Date(nowTs + 6 * HOUR_MS); // 6 小时后

  /* ===== 1. 已过放票时刻仍是 WAITING → 收敛为「未送达」 ===== */
  console.log('=== 1. 已过期未触发的 WAITING 任务（八达岭 00:00 场景）===');
  let db = freshDb();
  await mkTask(db, 'badaling', past);
  await mkTask(db, 'gugong', future);

  let res = await task.list(db, USER, { filter: 'active' });
  eq(res.counts.active, 1, '进行中只剩未来那条');
  eq(res.counts.expired, 1, '已过期 1 条（原 WAITING 被收敛）');

  res = await task.list(db, USER, { filter: 'expired' });
  const overdue = flatten(res)[0];
  eq(overdue.statusLabel, '未送达', '不再显示「待提醒」（STATE-002）');
  eq(overdue.backendStatus, ReminderBackendStatus.MISSED, 'backendStatus 收敛为 MISSED');
  eq(overdue.expired, true, 'expired=true');
  eq(overdue.missedReason, '超过放票时间点未触发成功', '无发送记录时用兜底文案');
  eq(overdue.countdown, null, '过期任务不再渲染倒计时');

  const storedOverdue = findSpot(db, 'badaling');
  eq(storedOverdue.backendStatus, ReminderBackendStatus.MISSED, '状态已落库（不是只改返回值）');
  eq(Math.round((new Date(storedOverdue.cleanAt).getTime() - nowTs) / DAY_MS), 14,
    'cleanAt = 补判时刻 + 14 天（REMINDER-RULE-006）');

  /* ===== 2. 优先透传 notifier 记下的真实失败原因 ===== */
  console.log('\n=== 2. missedReason 优先用 lastSendError ===');
  db = freshDb();
  await mkTask(db, 'badaling', past, { lastSendError: 'WX_APPID/WX_APPSECRET 未配置，订阅消息通道不可用' });
  res = await task.list(db, USER, { filter: 'expired' });
  eq(flatten(res)[0].missedReason, 'WX_APPID/WX_APPSECRET 未配置，订阅消息通道不可用',
    '真实原因不被笼统文案盖掉');

  /* ===== 3. 不误伤未来任务与已提醒任务 ===== */
  console.log('\n=== 3. 未来 WAITING / 已 TRIGGERED 不受影响 ===');
  db = freshDb();
  await mkTask(db, 'gugong', future);
  await mkTask(db, 'badaling', past, {
    backendStatus: ReminderBackendStatus.TRIGGERED,
    triggeredAt: new Date(nowTs - 6 * HOUR_MS),
    sentOffsets: [5, 2],
  });

  res = await task.list(db, USER, { filter: 'active' });
  eq(flatten(res)[0].statusLabel, '待提醒', '未来任务仍为「待提醒」');
  eq(flatten(res)[0].backendStatus, ReminderBackendStatus.WAITING, '未来任务状态不变');

  res = await task.list(db, USER, { filter: 'expired' });
  eq(flatten(res)[0].statusLabel, '已提醒', 'TRIGGERED 不会被误判为「未送达」');
  eq(flatten(res)[0].backendStatus, ReminderBackendStatus.TRIGGERED, 'TRIGGERED 状态不变');
  eq(findSpot(db, 'badaling').backendStatus, ReminderBackendStatus.TRIGGERED, '落库值未被改写');

  /* ===== 4. 幂等：重复读取不会反复改写 ===== */
  console.log('\n=== 4. 幂等 ===');
  db = freshDb();
  await mkTask(db, 'badaling', past);
  await task.list(db, USER, {});
  const firstCleanAt = new Date(findSpot(db, 'badaling').cleanAt).getTime();
  await task.list(db, USER, {});
  const secondCleanAt = new Date(findSpot(db, 'badaling').cleanAt).getTime();
  eq(secondCleanAt === firstCleanAt, true, '二次读取 cleanAt 不变（已 MISSED 不再补判）');

  /* ===== 5. 纯函数 effectiveStatusOf ===== */
  console.log('\n=== 5. effectiveStatusOf 边界 ===');
  const at = new Date(nowTs);
  eq(task.effectiveStatusOf(ReminderBackendStatus.WAITING, at, at), ReminderBackendStatus.MISSED,
    'releaseAt 恰好等于 now → 已过期（<= 判定）');
  eq(task.effectiveStatusOf(ReminderBackendStatus.WAITING, new Date(nowTs + 1), at),
    ReminderBackendStatus.WAITING, 'releaseAt 晚 1ms → 仍 WAITING');
  eq(task.effectiveStatusOf(ReminderBackendStatus.TRIGGERED, past, at), ReminderBackendStatus.TRIGGERED,
    'TRIGGERED 不受时间影响');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
