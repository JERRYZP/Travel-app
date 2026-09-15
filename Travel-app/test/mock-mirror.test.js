/**
 * mock 后端镜像测试：确认 miniprogram/utils/mock.js 的行程合并/时间线
 * 与云端 cloudfunctions/reminder/lib/* 的 A 方案口径一致。
 *
 * 为什么要单独测：mock 是小程序端独立的一份实现（无法 require 云函数），
 * 历史上一旦与云端漂移，就会出现「mock 下正常、真机不对」的排查黑洞。
 * 运行：node test/mock-mirror.test.js
 */
const mock = require('../miniprogram/utils/mock.js');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const segOf = (t, id) => (t.spots || []).find(s => s.spotId === id) || {};

const call = (name, data) => mock.mockCall(name, data);

(async () => {
  /* ============ 1. 行程创建与合并（TRIP-RULE-002，2026-09-14 恢复）============ */
  console.log('=== 1. mock 行程合并（镜像 lib/trip.js）===');
  const t1 = await call('trip.create', { startDate: '2026-09-23', endDate: '2026-09-24', spotIds: ['gugong'] });
  eq(t1.merged, false, '首个行程不合并');
  eq(t1.trip.name, '北京 9.23-9.24', '系统命名（TRIP-RULE-003）');

  const t2 = await call('trip.create', { startDate: '2026-09-25', endDate: '2026-09-26', spotIds: ['guobo'] });
  eq(t2.merged, true, '相接两段自动合并');
  eq(t2.tripId, t1.tripId, '复用既有行程 ID');
  eq(t2.trip.name, '北京 9.23-9.26', '按并集重新命名');
  eq(t2.trip.spotIds.join(','), 'gugong,guobo', 'spotIds = 景点并集');
  eq(segOf(t2.trip, 'gugong').endDate, '2026-09-24', '故宫段不延伸到第 2 段');
  eq(segOf(t2.trip, 'guobo').startDate, '2026-09-25', '国博段不回填到第 1 段');

  /* 加一条清单，避免 trip.list 的孤儿清理把行程收走 */
  await call('cart.add', { tripId: t2.tripId, spotId: 'gugong', visitDate: '2026-09-23', releaseAt: '2026-09-16T20:00:00+08:00' });
  const list1 = await call('trip.list', {});
  eq(list1.trips.length, 1, '合并后只剩 1 个行程');
  eq(list1.trips[0].spots.length, 2, 'trip.list 兜底补出 spots 段');

  /* ============ 2. 合并后时间线不膨胀 ============ */
  console.log('\n=== 2. mock 时间线按景点自己的段生成（镜像 lib/timeline.js）===');
  const tl = await call('timeline.generate', { tripId: t2.tripId });
  const gugongDates = tl.events.filter(e => e.spotId === 'gugong').map(e => e.visitDate).join(',');
  const guoboDates = tl.events.filter(e => e.spotId === 'guobo').map(e => e.visitDate).join(',');
  eq(gugongDates, '2026-09-23,2026-09-24', '故宫事件只在自己段内');
  eq(guoboDates, '2026-09-25,2026-09-26', '国博事件只在自己段内');
  eq(tl.events.length, 4, '总事件数 = 2 + 2（不是整段 × 全部景点的 8）');
  eq(tl.trip.spots.length, 2, '时间线返回 trip.spots 段');

  /* ============ 3. 不相接 → 新建独立行程 ============ */
  console.log('\n=== 3. 不相接新建（TRIP-RULE-002）===');
  const t3 = await call('trip.create', { startDate: '2026-10-01', endDate: '2026-10-03', spotIds: ['tiantan'] });
  eq(t3.merged, false, '不相接行程不合并');
  eq(t3.tripId !== t1.tripId, true, '新建独立行程（新任务分组 Tab）');
  eq(segOf(t3.trip, 'tiantan').startDate, '2026-10-01', '新行程景点段 = 本次输入范围');
  const tlFree = await call('timeline.generate', { tripId: t3.tripId });
  const free = tlFree.events.filter(e => e.spotId === 'tiantan');
  eq(free.length, 3, '免预约景点按日期生成候选项');
  eq(free.every(e => e.releaseAt === null && e.button.text === '加入行程'), true, '免预约候选项无 releaseAt，按钮为「加入行程」');

  await call('cart.add', { tripId: t3.tripId, spotId: 'tiantan', visitDate: '2026-10-01', releaseAt: null, remindOn: false });
  const cartFree = await call('cart.list', { tripId: t3.tripId });
  eq(cartFree.summary.reminderCount, 0, '免预约项不产生提醒数');
  const committedFree = await call('cart.commit', { tripId: t3.tripId });
  eq(committedFree.createdItems, 1, '免预约项提交后创建行程项');
  eq(committedFree.createdTasks, 0, '免预约项不创建任务');
  const tlFreeCommitted = await call('timeline.generate', { tripId: t3.tripId });
  eq(tlFreeCommitted.events.find(e => e.visitDate === '2026-10-01').status, 'COMMITTED', '提交后免预约项显示已加入行程');
  const t3b = await call('trip.create', { startDate: '2026-10-04', endDate: '2026-10-05', spotIds: ['guobo'] });
  eq(t3b.merged, true, '免预约行程项所在行程仍可继续合并');
  eq(t3b.tripId, t3.tripId, '合并后复用存续行程');
  const tlAfterMerge = await call('timeline.generate', { tripId: t3.tripId });
  eq(tlAfterMerge.events.find(e => e.visitDate === '2026-10-01').status, 'COMMITTED', '合并后行程项状态保留');

  const list2 = await call('trip.list', {});
  eq(list2.trips.length, 2, '现在有 2 个行程');
  eq(list2.showGroupTabs, true, '≥2 行程显示分组 Tab（TRIP-RULE-006）');

  /* ============ 4. adjustTripId：景点段替换 ============ */
  console.log('\n=== 4. adjustTripId 替换语义 ===');
  const t4 = await call('trip.create', {
    startDate: '2026-09-23', endDate: '2026-09-24',
    spotIds: ['badaling'], adjustTripId: t1.tripId,
  });
  eq(t4.tripId, t1.tripId, 'adjust 命中 → 复用该行程（不新建）');
  eq(t4.trip.spotIds.join(','), 'badaling', '调整行程时景点段被替换（非并集）');
  const list3 = await call('trip.list', {});
  eq(list3.trips.length, 2, '调整不新增行程');

  /* ============ 5. 老数据回退（只有 spotIds，没有 spots）============ */
  console.log('\n=== 5. 老数据按行程整段回退（normalizeSpots）===');
  const t5 = await call('trip.create', { startDate: '2026-11-01', endDate: '2026-11-02', spotIds: ['tiantan'] });
  const tl5 = await call('timeline.generate', { tripId: t5.tripId });
  eq(tl5.events.every(e => e.visitDate >= '2026-11-01' && e.visitDate <= '2026-11-02'), true, '段内事件落在行程范围内');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
