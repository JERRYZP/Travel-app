/**
 * DB 逻辑集成测试：用 mock-db 跑 FLOW-001 全链路
 * 运行：node test/flow.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, ChannelType, ReminderBackendStatus, EventSelectStatus } = require('../cloudfunctions/reminder/lib/schema');
const trip = require('../cloudfunctions/reminder/lib/trip');
const timeline = require('../cloudfunctions/reminder/lib/timeline');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');

const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;
const time = require('../cloudfunctions/reminder/lib/time');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const USER = 'openid_test_001';

/**
 * 测试行程必须落在未来（否则事件全为已放票态，测不到清单流程），
 * 且需包含一个周一以验证闭馆逻辑。这里从「今天+30」起找到首个周一，
 * 取 [周一-3, 周一+1] 共 5 天。
 */
function futureTripRange() {
  let cursor = time.addDays(time.todayStr(), 30);
  for (let i = 0; i < 7; i += 1) {
    if (time.dayNameOf(cursor) === 'monday') break;
    cursor = time.addDays(cursor, 1);
  }
  return { startDate: time.addDays(cursor, -3), endDate: time.addDays(cursor, 1), monday: cursor };
}

const RANGE = futureTripRange();

function freshDb() {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spotsSeed);
  db._seed(COLLECTIONS.RELEASE_RULES, rulesSeed);
  return db;
}

(async () => {
  console.log(`测试行程范围：${RANGE.startDate} ~ ${RANGE.endDate}（含周一 ${RANGE.monday}）\n`);

  /* ============ 1. 行程创建与合并 ============ */
  console.log('=== 1. 行程创建与合并（TRIP-RULE-002）===');
  let db = freshDb();

  const t1 = await trip.createOrMerge(db, USER, {
    startDate: '2026-05-31', endDate: '2026-06-04', spotIds: ['gugong', 'badaling'],
  });
  eq(t1.success, true, '创建行程成功');
  eq(t1.merged, false, '首个行程不合并');
  eq(t1.trip.name, '北京 5.31-6.4', '系统命名');

  // 相接行程 → 合并
  const t2 = await trip.createOrMerge(db, USER, {
    startDate: '2026-06-05', endDate: '2026-06-08', spotIds: ['guobo'],
  });
  eq(t2.merged, true, '相接行程触发合并');
  eq(t2.tripId, t1.tripId, '合并到既有行程');
  eq(`${t2.trip.startDate}~${t2.trip.endDate}`, '2026-05-31~2026-06-08', '日期取并集');
  eq([...t2.trip.spotIds].sort().join(','), 'badaling,gugong,guobo', '景点合并去重');
  eq(db._size(COLLECTIONS.TRIPS), 1, '数据库中仍只有 1 个行程');

  // 不相接 → 新建
  const t3 = await trip.createOrMerge(db, USER, {
    startDate: '2026-07-01', endDate: '2026-07-03', spotIds: ['tiantan'],
  });
  eq(t3.merged, false, '不相接行程新建');
  eq(db._size(COLLECTIONS.TRIPS), 2, '现在有 2 个行程');

  const listed = await trip.list(db, USER);
  eq(listed.showGroupTabs, true, '≥2 行程显示分组 Tab（TRIP-RULE-006）');

  /* ============ 2. 时间线生成 ============ */
  console.log('\n=== 2. 时间线生成（交叉积）===');
  db = freshDb();
  const tr = await trip.createOrMerge(db, USER, {
    startDate: RANGE.startDate, endDate: RANGE.endDate,
    spotIds: ['gugong', 'badaling'], // 故宫周一闭馆(4条) + 八达岭(5条) = 9
  });
  const tl = await timeline.generate(db, USER, tr.tripId);
  eq(tl.success, true, '生成成功');
  eq(tl.events.length, 9, '故宫4 + 八达岭5 = 9 条');
  eq(tl.byDeparture.length, 5, '5 个出发日 Tab');
  eq(tl.byDeparture.find(g => g.key === RANGE.monday).count, 1, '周一只有八达岭 1 条');
  eq(tl.bySpot.length, 2, '2 个景点 Tab');
  eq(tl.closedSpots.length, 0, '无全闭馆景点');
  eq(tl.events.every(e => e.status === EventSelectStatus.SELECTABLE), true, '未来行程初始态全部可选');

  /* ============ 3. 清单：加入 / 查重 / 批量限定 Tab ============ */
  console.log('\n=== 3. 提醒清单（CART-RULE）===');
  const future = tl.events.filter(e => e.status === EventSelectStatus.SELECTABLE);
  const one = future[0];
  const add1 = await cart.add(db, USER, {
    tripId: tr.tripId, spotId: one.spotId, visitDate: one.visitDate, releaseAt: one.releaseAt,
  });
  eq(add1.success, true, '加入清单成功');

  const dup = await cart.add(db, USER, {
    tripId: tr.tripId, spotId: one.spotId, visitDate: one.visitDate, releaseAt: one.releaseAt,
  });
  eq(dup.success, false, '重复加入被拒');
  eq(dup.errorCode, 1002, 'ERROR-1002 唯一约束生效');

  // 同景点不同日期 → 允许（交叉积的关键）
  const sameSpotOtherDay = future.find(e => e.spotId === one.spotId && e.visitDate !== one.visitDate);
  const add2 = await cart.add(db, USER, {
    tripId: tr.tripId, spotId: sameSpotOtherDay.spotId,
    visitDate: sameSpotOtherDay.visitDate, releaseAt: sameSpotOtherDay.releaseAt,
  });
  eq(add2.success, true, '同景点不同日期可同时加入');

  const cl = await cart.list(db, USER, tr.tripId);
  eq(cl.summary.count, 2, '清单 2 项');
  eq(cl.summary.spotCount, 1, '覆盖 1 个景点');
  eq(cl.summary.text, '已选 2 项，覆盖 1 个景点', 'CART-RULE-002 文案');

  // CART-RULE-004 批量限定 Tab
  await cart.clear(db, USER, tr.tripId);
  const tl2 = await timeline.generate(db, USER, tr.tripId);
  const dayKey = tl2.byDeparture.find(g => g.count > 1 && g.events.some(e => e.status === EventSelectStatus.SELECTABLE));
  const batch = await cart.addBatch(db, USER, tr.tripId, tl2.events, 'departure', dayKey.key);
  const expectInDay = dayKey.events.filter(e => e.status === EventSelectStatus.SELECTABLE).length;
  eq(batch.added, expectInDay, `本日全部提醒只加当天 ${expectInDay} 条`);
  eq(batch.added < tl2.events.length, true, '未加入整条时间线（不跨 Tab）');

  const noScope = await cart.addBatch(db, USER, tr.tripId, tl2.events, null, null);
  eq(noScope.success, false, '缺 scope 被拒（防误触发全量）');

  /* ============ 4. 提交：清单 → 任务（事务） ============ */
  console.log('\n=== 4. 提交（task.submit 事务）===');
  const beforeCart = db._size(COLLECTIONS.REMINDER_CART);
  eq(beforeCart > 0, true, `提交前清单有 ${beforeCart} 项`);

  const sub = await task.submit(db, USER, {
    tripId: tr.tripId,
    channels: [ChannelType.CALENDAR_ICS],
    offsets: [5, 2],
  });
  eq(sub.success, true, '提交成功');
  eq(sub.created, beforeCart, '清单项全部转为任务');
  eq(db._size(COLLECTIONS.REMINDER_CART), 0, '清单已清空（CART-RULE-003）');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), beforeCart, '任务数 = 原清单数');
  eq(sub.tasks[0].offsets.join(','), '5,2', 'offsets 降序存储（5 先于 2 触发）');
  eq(sub.tasks[0].backendStatus, ReminderBackendStatus.WAITING, '初始 WAITING');
  eq(sub.needsIcsSync, true, '需同步 ICS');

  // 校验失败分支
  const bad = await task.submit(db, USER, { tripId: tr.tripId, channels: [], offsets: [5] });
  eq(bad.success, false, '无通道提交被拒');
  const bad2 = await task.submit(db, USER, { tripId: tr.tripId, channels: [ChannelType.CALENDAR_ICS], offsets: [10] });
  eq(bad2.success, false, '非法提前量被拒');
  const empty = await task.submit(db, USER, { tripId: tr.tripId, channels: [ChannelType.CALENDAR_ICS], offsets: [5] });
  eq(empty.errorCode, 1009, '清单为空 → ERROR-1009');

  /* ============ 5. 提交后时间线状态回填 ============ */
  console.log('\n=== 5. 提交后状态回填（TIMELINE-RULE-002）===');
  const tl3 = await timeline.generate(db, USER, tr.tripId);
  const waitingCount = tl3.events.filter(e => e.status === EventSelectStatus.WAITING).length;
  eq(waitingCount, sub.created, '已提交事件显示「待提醒」');
  eq(tl3.events.filter(e => e.status === EventSelectStatus.WAITING).every(e => !e.button.enabled), true, '待提醒不可再选');

  /* ============ 6. 任务列表与角标 ============ */
  console.log('\n=== 6. 任务列表（PAGE-009）===');
  const tks = await task.list(db, USER, { tripId: tr.tripId });
  eq(tks.success, true, '列表成功');
  eq(tks.homeMode, 2, '有任务 → 首页形态2（HOME-RULE-001）');
  eq(tks.counts.active + tks.counts.expired, sub.created, '进行中+已过期 = 总任务');
  const firstItem = tks.groups[0].items[0];
  eq(firstItem.statusLabel, '待提醒', 'STATE-002 状态标签');
  eq(/^开抢 \d+月\d+日 \(周.\) 门票$/.test(firstItem.grabLabel), true, `文案格式: ${firstItem.grabLabel}`);

  /* ============ 7. 删除与级联（TRIP-RULE-004）============ */
  console.log('\n=== 7. 删除与级联 ===');
  const allTasks = db._dump(COLLECTIONS.REMINDER_TASKS);
  const rm1 = await task.remove(db, USER, allTasks[0]._id);
  eq(rm1.success, true, '删除 WAITING 任务成功');

  // 已触发任务不可删
  const t0 = db._dump(COLLECTIONS.REMINDER_TASKS)[0];
  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t0._id).update({
    data: { backendStatus: ReminderBackendStatus.TRIGGERED },
  });
  const rmBad = await task.remove(db, USER, t0._id);
  eq(rmBad.success, false, '已触发任务不可删（REMINDER-RULE-005）');

  // 删光 → 行程自动删除
  await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId: USER }).remove();
  const removed = await trip.removeIfEmpty(db, USER, tr.tripId);
  eq(removed, true, '任务清单皆空 → 行程自动删除');
  eq(db._size(COLLECTIONS.TRIPS), 0, '行程已删');

  const tksEmpty = await task.list(db, USER, {});
  eq(tksEmpty.homeMode, 1, '无任务 → 首页形态1');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
