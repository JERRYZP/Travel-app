/**
 * 客服工作台提醒质量统计回归。
 * 运行：node test/admin-reminder-quality.test.js
 */

const Module = require('module');
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/payment/lib/schema');
const quality = require('../cloudfunctions/payment/lib/admin-reminder-quality');

const ADMIN = 'openid_reminder_quality_admin';
const USER = 'openid_reminder_quality_user';
const FIXED_NOW = new Date('2026-11-02T15:30:00+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

function at(dateKey, time) {
  return new Date(`${dateKey}T${time}+08:00`);
}

function sendSuccess(taskId, releaseAt, offset, eventAt, scheduledAt = null) {
  return {
    eventType: 'SEND_SUCCEEDED',
    taskId,
    releaseAt,
    offset,
    scheduledAt: scheduledAt || new Date(releaseAt.getTime() - offset * 60 * 1000),
    eventAt,
  };
}

function taskEvent(eventType, taskId, releaseAt, eventAt = releaseAt) {
  return { eventType, taskId, releaseAt, eventAt };
}

function loadPayment(db, openId) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith('/cloudfunctions/payment/index.js')) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: openId, SOURCE: 'wx_client' }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/payment/index.js')];
    return require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }
}

function seedQualityEvents(db) {
  const events = [];
  const tasks = [];
  const addDelivered = (taskId, dateKey, time, status = 'TRIGGERED') => {
    const releaseAt = at(dateKey, time);
    const eventAt = new Date(releaseAt.getTime() - 5 * 60 * 1000 + 60 * 1000);
    events.push(
      taskEvent('TASK_CREATED', taskId, releaseAt),
      sendSuccess(taskId, releaseAt, 5, eventAt),
      taskEvent('TASK_TRIGGERED', taskId, releaseAt, eventAt)
    );
    tasks.push({ _id: taskId, releaseAt, offsets: [5], backendStatus: status });
  };

  for (let index = 0; index < 5; index += 1) {
    const date = new Date(FIXED_NOW.getTime() - (index + 2) * DAY_MS);
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    addDelivered(`base_${index}`, dateKey, '12:00');
  }

  addDelivered('yesterday_on_time', '2026-11-01', '12:00');
  addDelivered('yesterday_late_boundary', '2026-11-01', '23:59');

  const missedAt = at('2026-11-01', '13:00');
  events.push(
    taskEvent('TASK_CREATED', 'yesterday_missed', missedAt),
    taskEvent('TASK_MISSED', 'yesterday_missed', missedAt)
  );
  tasks.push({
    _id: 'yesterday_missed',
    releaseAt: missedAt,
    offsets: [5],
    backendStatus: 'MISSED',
  });

  const canceledAt = at('2026-11-01', '14:00');
  events.push(
    taskEvent('TASK_CREATED', 'yesterday_canceled', canceledAt),
    taskEvent('TASK_CANCELED', 'yesterday_canceled', canceledAt)
  );

  const oldReleaseAt = at('2026-11-01', '18:00');
  events.push({
    eventType: 'TASK_CREATED',
    taskId: 'yesterday_superseded_old',
    itemId: 'item_superseded',
    releaseAt: oldReleaseAt,
    eventAt: at('2026-11-01', '09:00'),
  });
  const rebuiltAt = at('2026-11-01', '10:00');
  const rebuiltEventAt = new Date(oldReleaseAt.getTime() - 5 * 60 * 1000 + 60 * 1000);
  events.push(
    {
      eventType: 'TASK_REBUILT',
      taskId: 'yesterday_superseded_new',
      itemId: 'item_superseded',
      releaseAt: oldReleaseAt,
      eventAt: rebuiltAt,
    },
    sendSuccess('yesterday_superseded_new', oldReleaseAt, 5, rebuiltEventAt),
    taskEvent('TASK_TRIGGERED', 'yesterday_superseded_new', oldReleaseAt, rebuiltEventAt)
  );
  tasks.push({
    _id: 'yesterday_superseded_new',
    itemId: 'item_superseded',
    releaseAt: oldReleaseAt,
    offsets: [5],
    backendStatus: 'TRIGGERED',
  });

  addDelivered('window_on_time', '2026-11-02', '05:00');
  addDelivered('window_boundary_1259', '2026-11-02', '12:59');

  const windowLateAt = at('2026-11-02', '06:00');
  const windowLateEventAt = new Date(
    windowLateAt.getTime() - 5 * 60 * 1000 + 180 * 1000
  );
  events.push(
    taskEvent('TASK_CREATED', 'window_late', windowLateAt),
    sendSuccess('window_late', windowLateAt, 5, windowLateEventAt),
    taskEvent('TASK_TRIGGERED', 'window_late', windowLateAt, windowLateEventAt)
  );
  tasks.push({
    _id: 'window_late',
    releaseAt: windowLateAt,
    offsets: [5],
    backendStatus: 'TRIGGERED',
  });

  const windowMissedAt = at('2026-11-02', '07:00');
  events.push(
    taskEvent('TASK_CREATED', 'window_missed', windowMissedAt),
    taskEvent('TASK_MISSED', 'window_missed', windowMissedAt)
  );
  tasks.push({
    _id: 'window_missed',
    releaseAt: windowMissedAt,
    offsets: [5],
    backendStatus: 'MISSED',
  });

  db._seed(COLLECTIONS.REMINDER_EVENTS, events);
  db._seed(COLLECTIONS.REMINDER_TASKS, tasks);
}

async function run() {
  console.log('=== 1. 单任务分类 ===');
  const releaseAt = at('2026-11-01', '20:00');
  const onTimeTask = { releaseAt, offsets: [5, 2], backendStatus: 'TRIGGERED' };
  const onTimeEvents = [
    sendSuccess('t1', releaseAt, 5, new Date(releaseAt.getTime() - 4 * 60 * 1000)),
    sendSuccess('t1', releaseAt, 2, new Date(releaseAt.getTime() - 60 * 1000)),
    taskEvent('TASK_TRIGGERED', 't1', releaseAt),
  ];
  eq(quality.classifyTask(onTimeTask, onTimeEvents).outcome, 'onTime',
    '所有 offset 都在 120 秒内成功');

  const lateEvents = [
    sendSuccess('t2', releaseAt, 5, new Date(releaseAt.getTime() - 5 * 60 * 1000 + 180 * 1000)),
    taskEvent('TASK_TRIGGERED', 't2', releaseAt),
  ];
  eq(quality.classifyTask({ ...onTimeTask, offsets: [5] }, lateEvents).outcome, 'late',
    '超过 120 秒判迟到');

  eq(quality.classifyTask(
    { ...onTimeTask, backendStatus: 'MISSED' },
    [...onTimeEvents, taskEvent('TASK_MISSED', 't3', releaseAt)]
  ).outcome, 'missed', 'MISSED 压过发送成功证据');

  eq(quality.classifyTask(
    onTimeTask,
    [taskEvent('SEND_SKIPPED', 't4', releaseAt)]
  ).outcome, 'skipped', '跳过单独计数');

  eq(quality.classifyTask(
    { ...onTimeTask, backendStatus: 'WAITING' },
    [taskEvent('TASK_CREATED', 't5', releaseAt)]
  ).outcome, 'unknown', '缺终态和发送证据判数据缺失');

  eq(quality.classifyTask({
    releaseAt,
    offsets: [5, 2],
    sentOffsets: [5, 2],
    triggeredAt: new Date(releaseAt.getTime() - 60 * 1000),
    backendStatus: 'TRIGGERED',
  }, []).outcome, 'onTime', '缺发送事件时用任务 sentOffsets/triggeredAt 回退判准时');

  eq(quality.classifyTask({
    releaseAt,
    offsets: [5],
    sentOffsets: [5],
    triggeredAt: new Date(releaseAt.getTime() - 5 * 60 * 1000 + 180 * 1000),
    backendStatus: 'TRIGGERED',
  }, []).outcome, 'late', '任务回退证据同样执行 120 秒迟到阈值');

  eq(quality.classifyTask({
    releaseAt,
    offsets: [5],
    sentOffsets: [],
    triggeredAt: new Date(releaseAt.getTime() - 4 * 60 * 1000),
    backendStatus: 'TRIGGERED',
  }, []).outcome, 'unknown', '任务证据不完整时不把缺失洗成准时');

  eq(quality.classifyTask(
    null,
    [
      taskEvent('TASK_CREATED', 't6', releaseAt),
      taskEvent('TASK_CANCELED', 't6', releaseAt),
    ]
  ), null, '首次发送前取消的任务不计入分母');

  console.log('\n=== 2. 阈值与状态 ===');
  const ninetyNine = quality.summarizeRecords([
    ...Array.from({ length: 99 }, () => ({ outcome: 'onTime', delayMs: 1000 })),
    { outcome: 'late', delayMs: 180000 },
  ]);
  eq(ninetyNine.onTimeRate, 99, '准时率保留两位小数');
  eq(quality.statusOf(ninetyNine), 'HEALTHY', '准时率达到 99% 即为正常');

  const below = quality.summarizeRecords([
    ...Array.from({ length: 98 }, () => ({ outcome: 'onTime', delayMs: 1000 })),
    ...Array.from({ length: 2 }, () => ({ outcome: 'late', delayMs: 180000 })),
  ]);
  eq(quality.statusOf(below), 'ALERT', '准时率低于 99% 为异常');
  const missedButRateHealthy = quality.summarizeRecords([
    { outcome: 'missed', delayMs: null },
    ...Array.from({ length: 100 }, () => ({ outcome: 'onTime', delayMs: 1000 })),
  ]);
  eq(quality.statusOf(missedButRateHealthy), 'HEALTHY', '仅低于阈值时标红');
  eq(quality.statusOf(quality.summarizeRecords([])), 'EMPTY', '无任务为空状态');

  console.log('\n=== 3. 8 小时窗口边界 ===');
  const beforeOne = quality.qualityWindow(at('2026-11-02', '12:59'));
  eq(beforeOne.label, '昨日 13:00-21:00', '13 点前显示前一日 13-21 时段');
  eq(beforeOne.updatedLabel, '21:00', '前一日窗口在 21 点更新');
  eq(beforeOne.nextUpdateAt, at('2026-11-02', '13:00').toISOString(), '13 点前等待下一次 13 点更新');
  const atOne = quality.qualityWindow(at('2026-11-02', '13:00'));
  eq(atOne.label, '今日 05:00-13:00', '13 点切换到当日 5-13 时段');
  eq(atOne.updatedLabel, '13:00', '13 点完成更新');
  eq(atOne.nextUpdateAt, at('2026-11-02', '21:00').toISOString(), '13 点后等待 21 点更新');
  const atNine = quality.qualityWindow(at('2026-11-02', '21:00'));
  eq(atNine.label, '今日 13:00-21:00', '21 点切换到 13-21 时段');
  eq(atNine.updatedLabel, '21:00', '21 点完成更新');
  eq(atNine.nextUpdateAt, at('2026-11-03', '13:00').toISOString(), '21 点后等待次日 13 点更新');

  console.log('\n=== 4. 当前时段与前 5 日聚合 ===');
  const db = createDb();
  seedQualityEvents(db);
  const beforeSnapshot = await quality.statsForAdmin(db, FIXED_NOW);
  eq(beforeSnapshot.success, true, '首个快照生成前接口仍可响应');
  eq(beforeSnapshot.pending, true, '首个快照生成前返回 pending');
  eq(beforeSnapshot.stale, false, '没有旧快照时不标记 stale');
  eq(beforeSnapshot.quality, null, '首个快照生成前不临时扫表');
  eq(db._size(COLLECTIONS.PAYMENT_CONFIG), 0, '工作台读取不会写入快照');
  const refreshed = await quality.refreshSnapshot(db, FIXED_NOW);
  eq(refreshed.refreshed, true, '首次节点刷新生成快照');
  eq(refreshed.windowKey, quality.windowKeyOf(FIXED_NOW), '快照按统计窗口幂等');
  const refreshedAgain = await quality.refreshSnapshot(db, FIXED_NOW);
  eq(refreshedAgain.refreshed, false, '同一窗口重复触发不重算');
  const snapshotRows = db._dump(COLLECTIONS.PAYMENT_CONFIG)
    .filter(item => item._id === quality.SNAPSHOT_CONFIG_ID);
  eq(snapshotRows.length, 1, '快照写入 payment_config 的确定性文档');
  const result = await quality.statsForAdmin(db, FIXED_NOW);
  eq(result.success, true, '质量统计成功');
  eq(result.pending, false, '当前窗口快照可直接读取');
  eq(result.quality.currentWindow.label, '今日 05:00-13:00', '当前统计最近完成 8 小时窗口');
  eq(result.quality.currentWindow.updatedLabel, '13:00', '质量卡显示最近更新时间');
  eq(result.quality.currentWindow.expectedCount, 4, '当前窗口包含 5-13 点任务');
  eq(result.quality.currentWindow.onTimeCount, 2, '当前窗口准时数');
  eq(result.quality.currentWindow.lateCount, 1, '当前窗口迟到数');
  eq(result.quality.currentWindow.missedCount, 1, '当前窗口未送达数');
  eq(result.quality.currentWindow.onTimeRate, 50, '当前窗口准时率');
  eq(result.quality.currentWindow.status, 'ALERT', '当前窗口存在未送达即异常');
  eq(result.quality.baseline5d.daysWithData, 5, '前 5 日均值覆盖 5 天');
  eq(result.quality.baseline5d.expectedCount, 5, '前 5 日不包含昨日');
  eq(result.quality.baseline5d.onTimeRate, 100, '前 5 日加权准时率');
  eq(result.quality.dataTruncated, false, '未触发查询截断');
  eq(/openid|userId/i.test(JSON.stringify(result.quality)), false, '聚合响应不含敏感用户字段');

  const capacityDb = createDb();
  const capacityEvents = [];
  const baselineReleaseAt = at('2026-10-27', '12:00');
  for (let index = 0; index < 12; index += 1) {
    const releaseAt = new Date(baselineReleaseAt.getTime() + index * 60 * 1000);
    capacityEvents.push(taskEvent(`baseline_capacity_${index}`, releaseAt, releaseAt));
  }
  for (const [taskId, time] of [
    ['current_capacity_on_time_1', '05:00'],
    ['current_capacity_on_time_2', '12:00'],
  ]) {
    const releaseAt = at('2026-11-02', time);
    const eventAt = new Date(releaseAt.getTime() - 4 * 60 * 1000);
    capacityEvents.push(
      taskEvent('TASK_CREATED', taskId, releaseAt),
      sendSuccess(taskId, releaseAt, 5, eventAt),
      taskEvent('TASK_TRIGGERED', taskId, releaseAt, eventAt)
    );
  }
  capacityDb._seed(COLLECTIONS.REMINDER_EVENTS, capacityEvents);
  const capacityResult = await quality.computeQualityForAdmin(capacityDb, FIXED_NOW, {
    maxEventRows: 10,
    maxTaskRows: 10,
  });
  eq(capacityResult.currentWindow.expectedCount, 2,
    '基线查询截断时当前窗口仍独立统计');
  eq(capacityResult.currentWindow.onTimeRate, 100,
    '基线截断不把当前窗口洗成无数据');
  eq(capacityResult.dataTruncated, true, '基线截断仍如实标记');

  const upgradeDb = createDb();
  seedQualityEvents(upgradeDb);
  upgradeDb._seed(COLLECTIONS.PAYMENT_CONFIG, [{
    _id: quality.SNAPSHOT_CONFIG_ID,
    schemaVersion: 1,
    windowKey: quality.windowKeyOf(FIXED_NOW),
    quality: { currentWindow: { expectedCount: 0, status: 'EMPTY' } },
    generatedAt: FIXED_NOW,
  }]);
  const upgraded = await quality.refreshSnapshot(upgradeDb, FIXED_NOW);
  eq(upgraded.refreshed, true, '统计口径升级后同窗口旧快照失效并重算');
  eq(upgraded.quality.currentWindow.expectedCount, 4,
    '重算后当前窗口恢复真实数据');

  const readOnlyDb = createDb({
    missingCollections: [COLLECTIONS.REMINDER_EVENTS, COLLECTIONS.REMINDER_TASKS],
  });
  readOnlyDb._seed(COLLECTIONS.PAYMENT_CONFIG, [{
    _id: quality.SNAPSHOT_CONFIG_ID,
    schemaVersion: quality.SNAPSHOT_SCHEMA_VERSION,
    windowKey: quality.windowKeyOf(FIXED_NOW),
    quality: result.quality,
    generatedAt: FIXED_NOW,
  }]);
  const cachedResult = await quality.statsForAdmin(readOnlyDb, FIXED_NOW);
  eq(cachedResult.success, true, '快照读取不依赖事件/任务原始集合');
  eq(cachedResult.quality.currentWindow.onTimeRate, 50, '工作台读取已存快照');

  const staleDb = createDb({
    missingCollections: [COLLECTIONS.REMINDER_EVENTS, COLLECTIONS.REMINDER_TASKS],
  });
  staleDb._seed(COLLECTIONS.PAYMENT_CONFIG, [{
    _id: quality.SNAPSHOT_CONFIG_ID,
    schemaVersion: quality.SNAPSHOT_SCHEMA_VERSION,
    windowKey: at('2026-11-02', '05:00').toISOString(),
    quality: result.quality,
    generatedAt: FIXED_NOW,
  }]);
  const staleResult = await quality.statsForAdmin(staleDb, FIXED_NOW);
  eq(staleResult.pending, true, '当前窗口快照尚未生成时返回 pending');
  eq(staleResult.stale, true, '旧窗口快照明确标记 stale');
  eq(staleResult.expectedWindowKey, at('2026-11-02', '13:00').toISOString(),
    '响应返回当前应读取的快照窗口');
  eq(staleResult.quality.currentWindow.onTimeRate, 50, '新窗口等待期间继续返回上一份可用快照');

  console.log('\n=== 4.1 两分钟定时器在节点生成且只生成一次质量快照 ===');
  const timerDb = createDb();
  seedQualityEvents(timerDb);
  const timerPayment = loadPayment(timerDb, ADMIN);
  const timerFirst = await timerPayment._test.reconcile({
    now: () => FIXED_NOW.getTime(),
    batchSize: 10,
    totalBudgetMs: 1000,
    queueBudgetMs: 500,
  });
  eq(timerFirst.quality.refreshed, true, '现有两分钟定时器承担节点快照计算');
  const timerSecond = await timerPayment._test.reconcile({
    now: () => FIXED_NOW.getTime(),
    batchSize: 10,
    totalBudgetMs: 1000,
    queueBudgetMs: 500,
  });
  eq(timerSecond.quality.refreshed, false, '同一窗口后续定时触发只读快照并跳过');
  const nextWindowPayment = await timerPayment._test.reconcile({
    now: () => at('2026-11-02', '21:00').getTime(),
    batchSize: 10,
    totalBudgetMs: 1000,
    queueBudgetMs: 500,
  });
  eq(nextWindowPayment.quality.refreshed, true, '进入下一个统计节点时生成新窗口快照');

  console.log('\n=== 5. 管理员路由与鉴权 ===');
  const previousAdmin = process.env.AFTER_SALES_ADMIN_OPENIDS;
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;
  try {
    const adminPayment = loadPayment(db, ADMIN);
    const routed = await adminPayment.main({ action: 'adminReminderQuality.stats' });
    eq(routed.success, true, '管理员可读取质量统计');
    eq(routed.quality.currentWindow.durationHours, 8, '路由返回最近完成 8 小时窗口');

    const userPayment = loadPayment(db, USER);
    const denied = await userPayment.main({ action: 'adminReminderQuality.stats' });
    eq(denied.errorCode, 1040, '普通用户不能读取质量统计');
  } finally {
    if (previousAdmin === undefined) delete process.env.AFTER_SALES_ADMIN_OPENIDS;
    else process.env.AFTER_SALES_ADMIN_OPENIDS = previousAdmin;
  }

  if (fail) {
    console.error(`\n${fail} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll admin reminder quality tests passed.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
