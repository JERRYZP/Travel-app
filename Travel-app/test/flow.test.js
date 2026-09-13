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

  const t1 = await trip.create(db, USER, {
    startDate: '2026-05-31', endDate: '2026-06-04', spotIds: ['gugong', 'badaling'],
  });
  eq(t1.success, true, '创建行程成功');
  eq(t1.merged, false, '首个行程不合并');
  eq(t1.trip.name, '北京 5.31-6.4', '系统命名');

  // 相接行程 → 不再自动合并（2026-08-31 取消 TRIP-RULE-002 自动合并），严格按本次输入新建独立行程
  const t2 = await trip.create(db, USER, {
    startDate: '2026-06-05', endDate: '2026-06-08', spotIds: ['guobo'],
  });
  eq(t2.success, true, '创建行程成功');
  eq(t2.merged, false, '相接行程不合并');
  eq(t2.tripId !== t1.tripId, true, '新建独立行程（不合并到既有行程）');
  eq(`${t2.trip.startDate}~${t2.trip.endDate}`, '2026-06-05~2026-06-08', '日期严格按本次输入');
  eq(t2.trip.spotIds.join(','), 'guobo', '景点严格按本次输入');
  eq(db._size(COLLECTIONS.TRIPS), 2, '现在有 2 个行程');

  // 不相接 → 新建
  const t3 = await trip.create(db, USER, {
    startDate: '2026-07-01', endDate: '2026-07-03', spotIds: ['tiantan'],
  });
  eq(t3.merged, false, '不相接行程新建');
  eq(db._size(COLLECTIONS.TRIPS), 3, '现在有 3 个行程');

  // 给三个行程各加一条清单，避免被 trip.list 的空行程清理（TRIP-RULE-004）误删
  for (const tid of [t1.tripId, t2.tripId, t3.tripId]) {
    await db.collection(COLLECTIONS.REMINDER_CART).add({
      data: { userId: USER, tripId: tid, spotId: 'gugong', visitDate: '2026-06-01', releaseAt: new Date('2026-06-01T10:00:00+08:00') },
    });
  }
  eq(db._size(COLLECTIONS.REMINDER_CART), 3, '三个行程各 1 条清单');

  const listed = await trip.list(db, USER);
  eq(listed.showGroupTabs, true, '≥2 行程显示分组 Tab（TRIP-RULE-006）');

  /* ============ 2. 时间线生成 ============ */
  console.log('\n=== 2. 时间线生成（交叉积）===');
  db = freshDb();
  const tr = await trip.create(db, USER, {
    startDate: RANGE.startDate, endDate: RANGE.endDate,
    spotIds: ['gugong', 'tsinghua'], // 故宫周一闭馆(4条) + 清华周一闭馆(4条) = 8
  });
  const tl = await timeline.generate(db, USER, tr.tripId);
  eq(tl.success, true, '生成成功');
  eq(tl.events.length, 8, '故宫4 + 清华4 = 8 条（清华唯一限制是周一闭馆）');
  eq(tl.byDeparture.length, 4, '4 个出发日 Tab（周一无事件）');
  eq(tl.byDeparture.some(g => g.key === RANGE.monday), false, '周一无事件（两馆周一都闭馆）');
  eq(tl.bySpot.length, 2, '2 个景点 Tab');
  eq(tl.bySpot.find(g => g.key === 'tsinghua').count, 4, '清华 Tab 4 条（仅周一被跳过）');
  eq(tl.closedSpots.length, 0, '无全闭馆景点');
  // 两者都是黑名单（周一闭馆），被跳过的日子都说「闭馆」
  eq(tl.closedDaySkips.length, 2, '故宫与清华各有一条「已为你跳过」提示');
  eq(tl.closedDaySkips.every(s => s.note.includes('闭馆')), true, '均用「闭馆」措辞（无白名单景点）');
  eq(tl.events.every(e => e.status === EventSelectStatus.SELECTABLE), true, '未来行程初始态全部可选');

  // B 层免预约景点不进时间线（reservationRequired=false，2026 政策取消预约）
  const trB = await trip.create(db, USER, {
    startDate: time.addDays(RANGE.startDate, 14), endDate: time.addDays(RANGE.endDate, 14),
    spotIds: ['gugong', 'shoubo'],
  });
  const tlB = await timeline.generate(db, USER, trB.tripId);
  eq(tlB.success, true, '含 B 层景点的行程生成成功');
  eq(tlB.events.length, 4, 'shoubo(免预约) 被排除，只剩故宫 4 条');
  eq(tlB.bySpot.length, 1, '仅 1 个景点 Tab');
  eq(tlB.closedSpots.length, 0, '免预约景点不计入「闭馆」');
  await trip.removeIfEmpty(db, USER, trB.tripId); // 清理测试行程，避免影响后续级联断言

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
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5, 2],
  });
  eq(sub.success, true, '提交成功');
  eq(sub.created, beforeCart, '清单项全部转为任务');
  eq(db._size(COLLECTIONS.REMINDER_CART), 0, '清单已清空（CART-RULE-003）');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), beforeCart, '任务数 = 原清单数');
  eq(sub.tasks[0].offsets.join(','), '5,2', 'offsets 降序存储（5 先于 2 触发）');
  eq(sub.tasks[0].backendStatus, ReminderBackendStatus.WAITING, '初始 WAITING');
  eq(sub.needsOaAuth, true, '需引导关注公众号');

  // 校验失败分支
  const bad = await task.submit(db, USER, { tripId: tr.tripId, channels: [], offsets: [5] });
  eq(bad.success, false, '无通道提交被拒');
  const bad2 = await task.submit(db, USER, { tripId: tr.tripId, channels: [ChannelType.OFFICIAL_ACCOUNT], offsets: [10] });
  eq(bad2.success, false, '非法提前量被拒');
  const empty = await task.submit(db, USER, { tripId: tr.tripId, channels: [ChannelType.OFFICIAL_ACCOUNT], offsets: [5] });
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
  eq(/^开抢\d+月\d+日（周.）门票$/.test(firstItem.grabLabel), true, `文案格式: ${firstItem.grabLabel}`);

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

  // STATE-002：MISSED 显示「未送达」而不是「已提醒」
  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t0._id).update({
    data: { backendStatus: ReminderBackendStatus.MISSED, missedReason: 'errCode=43101' },
  });
  const tksMissed = await task.list(db, USER, { tripId: tr.tripId, filter: 'expired' });
  const missedItem = tksMissed.groups
    .reduce((acc, g) => acc.concat(g.items), [])
    .find(i => i.backendStatus === ReminderBackendStatus.MISSED);
  eq(missedItem.statusLabel, '未送达', 'MISSED 显示「未送达」而非「已提醒」（STATE-002）');
  eq(missedItem.missedReason, 'errCode=43101', 'missedReason 透传供前端解释');

  // 删光 → 行程自动删除
  await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId: USER }).remove();
  const removed = await trip.removeIfEmpty(db, USER, tr.tripId);
  eq(removed, true, '任务清单皆空 → 行程自动删除');
  eq(db._size(COLLECTIONS.TRIPS), 0, '行程已删');

  const tksEmpty = await task.list(db, USER, {});
  eq(tksEmpty.homeMode, 1, '无任务 → 首页形态1');

  /* ============ 8. 清空任务（task.clear 按 tab 清空 + TRIP-RULE-004 级联）============ */
  console.log('\n=== 8. 清空任务（按 tab 清空 + 级联删行程）===');
  db = freshDb();
  const cTripA = await trip.create(db, USER, { startDate: RANGE.startDate, endDate: RANGE.endDate, spotIds: ['gugong'] });
  const cTripB = await trip.create(db, USER, { startDate: time.addDays(RANGE.startDate, 20), endDate: time.addDays(RANGE.endDate, 20), spotIds: ['tiantan'] });
  const nowTs = new Date();
  const pastDay = new Date(nowTs.getTime() - 2 * 86400000);
  const futureDay = new Date(nowTs.getTime() + 2 * 86400000);
  const mkTask = (tripId, spotId, releaseAt) => db.collection(COLLECTIONS.REMINDER_TASKS).add({
    data: { userId: USER, tripId, spotId, visitDate: time.todayStr(), releaseAt, offsets: [5, 2], channels: [ChannelType.OFFICIAL_ACCOUNT], backendStatus: ReminderBackendStatus.WAITING },
  });
  await mkTask(cTripA.tripId, 'gugong', futureDay);   // A 进行中
  await mkTask(cTripA.tripId, 'gugong', pastDay);     // A 已过期
  await mkTask(cTripB.tripId, 'tiantan', pastDay);    // B 已过期

  // 模拟 index.js 分发：task.clear 后对 affectedTripIds 执行级联
  const clearAll = async (params) => {
    const r = await task.clear(db, USER, params);
    for (const tid of (r.affectedTripIds || [])) await trip.removeIfEmpty(db, USER, tid);
    return r;
  };

  const ca = await clearAll({ filter: 'active' });
  eq(ca.cleared, 1, '清空「进行中」只删 1 条');
  let li = await task.list(db, USER, {});
  eq(li.counts.active, 0, '进行中已空');
  eq(li.counts.expired, 2, '已过期仍 2 条');
  eq(db._size(COLLECTIONS.TRIPS), 2, 'A 尚有已过期任务 → 行程保留');

  const cb = await clearAll({ filter: 'expired', tripId: cTripA.tripId });
  eq(cb.cleared, 1, '限定行程+「已过期」只清 A 的 1 条');
  li = await task.list(db, USER, {});
  eq(li.counts.expired, 1, '剩 B 的 1 条已过期');
  eq(db._size(COLLECTIONS.TRIPS), 1, 'A 任务清空 → 行程级联删除');

  const cc = await clearAll({});
  eq(cc.cleared, 1, '不传范围全清');
  li = await task.list(db, USER, {});
  eq(li.homeMode, 1, '全清后回到形态1');
  eq(db._size(COLLECTIONS.TRIPS), 0, 'B 行程级联删除');

  /* ============ 9. 孤儿行程读取时清理（trip.list 兜底 TRIP-RULE-004）============ */
  console.log('\n=== 9. 孤儿行程读取时清理 ===');
  db = freshDb();
  // 生成了时间线但从未提交 → 0 任务 0 清单的孤儿行程
  const orphan = await trip.create(db, USER, { startDate: RANGE.startDate, endDate: RANGE.endDate, spotIds: ['gugong'] });
  // 有清单的行程（构建中）应保留
  const withCart = await trip.create(db, USER, { startDate: time.addDays(RANGE.startDate, 20), endDate: time.addDays(RANGE.endDate, 20), spotIds: ['tiantan'] });
  await db.collection(COLLECTIONS.REMINDER_CART).add({
    data: { userId: USER, tripId: withCart.tripId, spotId: 'tiantan', visitDate: time.addDays(RANGE.startDate, 20), releaseAt: new Date('2026-08-01T10:00:00+08:00') },
  });
  const pre = db._size(COLLECTIONS.TRIPS);
  eq(pre, 2, '创建后 2 个行程（孤儿 + 有清单）');
  const after = await trip.list(db, USER);
  eq(after.trips.length, 1, '孤儿行程读取时被删除，只剩有清单的');
  eq(after.trips[0]._id, withCart.tripId, '保留的是有清单的行程');
  eq(after.showGroupTabs, false, '只剩 1 个行程 → 不显示分组 Tab');
  eq(db._size(COLLECTIONS.TRIPS), 1, '孤儿行程已从库中删除');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
