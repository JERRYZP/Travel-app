/**
 * mock 后端镜像测试：确认 miniprogram/utils/mock.js 的行程合并/时间线
 * 与云端 cloudfunctions/reminder/lib/* 的 A 方案口径一致。
 *
 * 为什么要单独测：mock 是小程序端独立的一份实现（无法 require 云函数），
 * 历史上一旦与云端漂移，就会出现「mock 下正常、真机不对」的排查黑洞。
 * 运行：node test/mock-mirror.test.js
 */
/* ⚠️ mock 的 db 是模块级单例，require 一次就在所有小节之间共享状态。
   下面需要从干净库开始的用例（提交闭环）用 freshMock() 重新 require。 */
function freshMock() {
  delete require.cache[require.resolve('../miniprogram/utils/mock.js')];
  return require('../miniprogram/utils/mock.js');
}
const mock = require('../miniprogram/utils/mock.js');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const segOf = (t, id) => (t.spots || []).find(s => s.spotId === id) || {};

const call = (name, data) => mock.mockCall(name, data);
/* mockCall 与云函数同约定：success=false 一律 reject（页面只写 catch → toastError）。
   要断言错误码就得接住它。 */
const errOf = (p) => Promise.resolve(p).then(() => null, e => e);

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


  /* ============ 6. 清单暂存区 + 提交时才建行程（2026-09-20 纯预览化）============ */
  console.log('\n=== 6. 清单是提交前的暂存区（镜像 cart / task.submit）===');
  {
    const m = freshMock();
    const c = (n, d) => m.mockCall(n, d);
    const START = '2026-12-10';
    const END = '2026-12-12';

    const pv = await c('timeline.preview', { startDate: START, endDate: END, spotIds: ['gugong', 'tiantan'] });
    eq(pv.success, true, '预览成功');
    eq((await c('trip.list', {})).trips.length, 0, '纯预览不创建行程');

    const req = pv.events.find(e => e.reservationRequired !== false);
    const free = pv.events.find(e => e.reservationRequired === false);
    await c('cart.add', { spotId: req.spotId, visitDate: req.visitDate, releaseAt: req.releaseAt, remindOn: true });
    await c('cart.add', { spotId: free.spotId, visitDate: free.visitDate, releaseAt: null, remindOn: false });
    const cl = await c('cart.list', {});
    eq(cl.summary.count, 2, '清单暂存 2 项');
    eq(cl.summary.reminderCount, 1, '其中 1 个将设提醒');
    eq((await c('trip.list', {})).trips.length, 0, '加入清单仍不创建行程（暂存区语义）');

    const cm = await c('cart.commit', { channels: ['OFFICIAL_ACCOUNT'], offsets: [5] });
    eq(cm.createdItems, 2, '提交创建 2 个行程项');
    eq(cm.createdTasks, 1, '仅提醒项建任务');
    eq(Boolean(cm.tripId), true, '回传 tripId（契约 8.5）');
    eq((await c('trip.list', {})).trips.length, 1, '提交时才创建行程');
    eq((await c('cart.list', {})).summary.count, 0, '提交后清单清空（提交即消费）');

    const bs = await c('home.bootstrap', {});
    eq(bs.trips.length, 1, '首页 1 个进行中行程');
    eq(bs.trips[0].items.length, 2, '带回 2 条行程项');
    eq(bs.trips[0].progress.total, 1, '进度分母 = 预约需求组（免预约不计）');
    eq(bs.trips[0].progress.noReservationCount, 1, '另有 1 处随到随玩');
  }

  /* ============ 7. 六个展示态 + 进度口径（镜像 lib/item.js）============ */
  console.log('\n=== 7. 行程项状态推导与进度（镜像 lib/item.js）===');
  {
    const m = freshMock();
    const c = (n, d) => m.mockCall(n, d);
    const t = await c('trip.create', { startDate: '2026-12-10', endDate: '2026-12-12', spotIds: ['tiantan'] });
    await c('cart.add', { spotId: 'tiantan', visitDate: '2026-12-10', releaseAt: null, remindOn: false });
    await c('cart.commit', {});
    const bs = await c('home.bootstrap', {});
    const it = bs.trips[0].items[0];
    eq(it.ticketState, 'NO_RESERVATION', '免预约优先于一切');
    eq(it.ticketStateLabel, '免预约', '文案固定');
    eq(it.bookingEntryEnabled, false, '免预约项没有预约入口');
    eq(it.reminder.state, 'NOT_SET', '没设提醒 → NOT_SET');
    eq(it.reminder.stateLabel, '未设提醒', '提醒文案');
  }

  /* ============ 8. 行程项接口（镜像 lib/trip-item-actions.js）============ */
  console.log('\n=== 8. tripItem.* 镜像 ===');
  {
    const m = freshMock();
    const c = (n, d) => m.mockCall(n, d);
    /* 造一条「放票刚过去、仍在 24h 窗口内」的行程项：故宫 advanceDays=7。
       ⚠️ 不能写「今天+7」——那等于 releaseAt = 今天 20:00，在 20:00 之前跑其实是未来。 */
    const pad = n => String(n).padStart(2, '0');
    const iso = x => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    const nowB = new Date(Date.now() + 8 * 3600000);
    let relToday = Date.UTC(nowB.getUTCFullYear(), nowB.getUTCMonth(), nowB.getUTCDate(), 20, 0) - 8 * 3600000;
    if (relToday > Date.now()) relToday -= 86400000;    // 今天 20:00 未到 → 取昨天
    const visit = iso(new Date(relToday + 7 * 86400000)); // visitDate − 7 天 = 那个 20:00
    const trip = await c('trip.create', { startDate: visit, endDate: visit, spotIds: ['gugong'] });
    await c('cart.add', { spotId: 'gugong', visitDate: visit, releaseAt: new Date(relToday), remindOn: true });
    await c('cart.commit', { channels: ['OFFICIAL_ACCOUNT'], offsets: [5] });

    let bs = await c('home.bootstrap', {});
    let it = bs.trips[0].items[0];
    eq(it.ticketState, 'BOOKABLE', '刚开票且在 24h 内 → 可抢');
    eq(it.canMark, true, '可标记结果');

    const mk = await c('tripItem.markResult', { itemId: it.itemId, result: 'SUCCESS' });
    eq(mk.item.ticketState, 'SUCCESS', '标记「抢到了」');
    eq(mk.backupPrompt, null, '无备选 → 不追问');
    eq(mk.item.undoUntil !== null, true, '给出撤销截止时刻');
    /* 票务态已是 SUCCESS，提醒送达态独立按自己的通道算：
       这条的 releaseAt 已过且任务仍是 WAITING → 收敛为 MISSED。
       两者并存正是「分字段、分 UI」的意思——提醒没送到 ≠ 用户没抢到。 */
    eq(mk.item.reminder.state, 'MISSED', '提醒送达态独立于票务结果（分字段）');
    eq(mk.item.ticketState, 'SUCCESS', '票务结果不受提醒失败影响');

    bs = await c('home.bootstrap', {});
    eq(bs.trips[0].progress.done, 1, '进度计入搞定数');

    eq((await errOf(c('tripItem.markResult', { itemId: it.itemId, result: 'FAILED' }))).errorCode, 1014, '不可反复修改');

    const un = await c('tripItem.undoResult', { itemId: it.itemId, expectedResultAt: mk.item.resultAt });
    eq(un.success, true, '4 秒内可撤销');
    eq(un.item.result, null, '结果复位');

    const rc = await c('tripItem.recoveryCandidates', { itemId: it.itemId });
    eq(Array.isArray(rc.candidates), true, '挽回建议返回数组');
    eq(JSON.stringify(rc.candidates).indexOf('余票') === -1, true, '不出现余票字段（数据红线）');

    /* 免预约项拒绝开启提醒 */
    const t2 = await c('trip.create', { startDate: '2026-12-20', endDate: '2026-12-20', spotIds: ['tiantan'] });
    await c('cart.add', { spotId: 'tiantan', visitDate: '2026-12-20', releaseAt: null, remindOn: false });
    await c('cart.commit', {});
    let bs2 = await c('home.bootstrap', {});
    const freeItem = bs2.trips.find(x => x._id === t2.tripId).items[0];
    eq((await errOf(c('tripItem.updateReminder', { itemId: freeItem.itemId, remindOn: true }))).errorCode, 1010,
      '免预约项拒绝开启提醒');

    /* 删除动线：删完最后一条 → 行程消失 */
    const rm = await c('tripItem.remove', { itemId: freeItem.itemId });
    eq(rm.tripRemoved, true, '行程项清零 → 行程随之消失');
    eq((await c('trip.list', {})).trips.length, 1, '另一趟行程不受影响');
  }

  /* ============ 9. 首页 V2 形状（镜像 homeBootstrap）============ */
  console.log('\n=== 9. home.bootstrap V2 形状 ===');
  {
    const m = freshMock();
    const c = (n, d) => m.mockCall(n, d);
    const bs = await c('home.bootstrap', {});
    eq(bs.success, true, '空用户也成功');
    eq(bs.homeMode, 1, '无行程项 → 创建引导');
    eq(bs.primaryTripId, '', '无主行程');
    eq(bs.stickyBanner, null, '无横幅');
    eq(bs.scrollTargetId, null, '无自动定位目标');
    eq(JSON.stringify(bs.trips), '[]', 'trips 为空数组');
    eq(JSON.stringify(bs.history), '[]', 'history 为空数组');
    eq(Boolean(bs.serverNow), true, '返回 serverNow');
  }


  /* ============ 10. 云端与 mock 对同一组输入必须给出同一结果 ============ */
  console.log('\n=== 10. 状态推导交叉断言（云端 lib/item.js vs mock）===');
  {
    const cloudItem = require('../cloudfunctions/reminder/lib/item');
    const cloudTime = require('../cloudfunctions/reminder/lib/time');
    const HOUR = 3600 * 1000;
    /* 用固定时刻，令「既不在过去也不在未来」这类边界走到确定的同一边 */
    const NOW = cloudTime.parseBeijing('2026-10-01', '12:00');

    const CASES = [
      { name: '免预约', item: null, reservationRequired: false, releaseAt: null },
      { name: '免预约但用户标记过', item: { result: 'SUCCESS' }, reservationRequired: false, releaseAt: null },
      { name: '放票前', item: null, reservationRequired: true, releaseAt: new Date(NOW.getTime() + HOUR) },
      { name: '恰好到点', item: null, reservationRequired: true, releaseAt: new Date(NOW.getTime()) },
      { name: '刚开票 1 小时', item: null, reservationRequired: true, releaseAt: new Date(NOW.getTime() - HOUR) },
      { name: '恰好 24 小时', item: null, reservationRequired: true, releaseAt: new Date(NOW.getTime() - 24 * HOUR) },
      { name: '超过 24 小时', item: null, reservationRequired: true, releaseAt: new Date(NOW.getTime() - 25 * HOUR) },
      { name: '已成（尚未到点）', item: { result: 'SUCCESS' }, reservationRequired: true, releaseAt: new Date(NOW.getTime() + 10 * HOUR) },
      { name: '未成（已过 24h）', item: { result: 'FAILED' }, reservationRequired: true, releaseAt: new Date(NOW.getTime() - 100 * HOUR) },
      { name: '无放票规则', item: null, reservationRequired: true, releaseAt: null },
    ];

    const m2 = freshMock();
    CASES.forEach(c => {
      const cloud = cloudItem.ticketStateOf({
        item: c.item, reservationRequired: c.reservationRequired,
        releaseAt: c.releaseAt, nowTs: NOW,
      });
      const mock = m2.__internals.ticketStateOf(c.item, c.reservationRequired, c.releaseAt, NOW);
      eq(mock, cloud, `票务态一致：${c.name}`);
      eq(m2.__internals.TICKET_LABEL[mock], cloudItem.ticketStateLabelOf(cloud), `文案一致：${c.name}`);
    });

    /* 进度口径 */
    const items = [
      { tripId: 'T', spotId: 'gugong', backupGroupId: 'T:gugong', reservationRequired: true, result: 'FAILED' },
      { tripId: 'T', spotId: 'gugong', backupGroupId: 'T:gugong', reservationRequired: true, result: 'SUCCESS' },
      { tripId: 'T', spotId: 'guobo', backupGroupId: 'T:guobo', reservationRequired: true, result: null },
      { tripId: 'T', spotId: 'tiantan', backupGroupId: 'T:tiantan', reservationRequired: false, result: null },
    ];
    eq(JSON.stringify(m2.__internals.backupGroupProgress(items)),
      JSON.stringify(cloudItem.backupGroupProgress(items)), '进度口径一致（备选去重 / 免预约不计）');

    /* 撤销窗口常量 */
    const schema = require('../cloudfunctions/reminder/lib/schema');
    eq(m2.__internals.RESULT_UNDO_SECONDS, schema.V1.RESULT_UNDO_SECONDS, '撤销窗口常量一致');
    eq(m2.__internals.UNMARKED_AFTER_HOURS, schema.V1.UNMARKED_AFTER_HOURS, '未标记窗口常量一致');
    eq(m2.__internals.PENDING_CART_TRIP_ID, schema.PENDING_CART_TRIP_ID, '暂存清单占位 tripId 一致');
  }


  /* ============ 11. 数据一致性：mock 内嵌的 SPOTS/RULES 与实际数据文件 ============ */
  console.log('\n=== 11. mock 内嵌数据 vs data/ 真身 ===');
  {
    const m = freshMock();
    const spotsSeed = require('../data/spots.json').spots;
    const rulesSeed = require('../data/rules.json').rules;
    const SPOT_FIELDS = ['name', 'reservationRequired', 'difficultyScore', 'popularityScore'];
    const RULE_FIELDS = ['advanceDays', 'releaseTime', 'closedDays', 'openDays', 'closedDaysNote', 'specialNotice', 'specialNoticeUntil'];

    const spotMap = {};
    m.SPOTS.forEach(x => { spotMap[x.spotId] = x; });
    const ruleMap = {};
    m.__internals.mockRules().forEach(x => { ruleMap[x.spotId] = x; });

    const drift = [];
    spotsSeed.forEach(x => {
      const y = spotMap[x.spotId];
      if (!y) { drift.push('mock 缺景点 ' + x.spotId); return; }
      SPOT_FIELDS.forEach(f => {
        if (JSON.stringify(y[f] || null) !== JSON.stringify(x[f] || null)) {
          drift.push(`${x.spotId}.${f}: mock=${JSON.stringify(y[f])} data=${JSON.stringify(x[f])}`);
        }
      });
    });
    rulesSeed.forEach(x => {
      const y = ruleMap[x.spotId];
      if (!y) { drift.push('mock 缺规则 ' + x.spotId); return; }
      RULE_FIELDS.forEach(f => {
        if (JSON.stringify(y[f] || null) !== JSON.stringify(x[f] || null)) {
          drift.push(`${x.spotId}.${f}: mock=${JSON.stringify(y[f])} data=${JSON.stringify(x[f])}`);
        }
      });
    });

    eq(drift.length, 0, 'mock 内嵌 SPOTS/RULES 与 data/ 真身无漂移');
    if (drift.length) drift.slice(0, 8).forEach(x => console.log('     漂移:', x));
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
