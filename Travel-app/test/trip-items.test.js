/**
 * 行程项 P1 专项测试（2026-09-16）
 *
 * 覆盖：
 * - 免预约景点进入时间线并按日期加入；
 * - 购物车保存 remindOn；
 * - 弱提醒默认不勾；
 * - 提交时所有项落 trip_items，仅提醒项生成任务；
 * - 任务挂 itemId。
 *
 * 运行：node test/trip-items.test.js
 */
const { createDb } = require('./mock-db');
const {
  COLLECTIONS,
  ChannelType,
  EventSelectStatus,
} = require('../cloudfunctions/reminder/lib/schema');
const trip = require('../cloudfunctions/reminder/lib/trip');
const timeline = require('../cloudfunctions/reminder/lib/timeline');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');

const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;
const time = require('../cloudfunctions/reminder/lib/time');

const USER = 'openid_trip_items_p1';
let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

function freshDb() {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spotsSeed);
  db._seed(COLLECTIONS.RELEASE_RULES, rulesSeed);
  return db;
}

(async () => {
  console.log('=== 1. 免预约景点进入时间线并可提交为行程项 ===');
  let db = freshDb();
  const start = time.addDays(time.todayStr(), 30);
  const end = time.addDays(start, 2);
  const t = await trip.create(db, USER, {
    startDate: start,
    endDate: end,
    spotIds: ['tiantan'],
  });

  let tl = await timeline.generate(db, USER, t.tripId);
  const freeEvents = tl.events.filter(e => e.spotId === 'tiantan');
  eq(freeEvents.length, 3, '免预约景点按日期生成 3 个候选项');
  eq(freeEvents.every(e => e.releaseAt === null), true, '免预约候选项没有 releaseAt');
  eq(freeEvents.every(e => e.reservationRequired === false), true, '免预约标记正确');
  eq(freeEvents.every(e => e.button.text === '加入行程'), true, '按钮文案为「加入行程」');
  eq(freeEvents.every(e => e.status === EventSelectStatus.SELECTABLE), true, '初始状态可选');

  const freeDate = freeEvents[1].visitDate;
  const added = await cart.add(db, USER, {
    tripId: t.tripId,
    spotId: 'tiantan',
    visitDate: freeDate,
    releaseAt: null,
    remindOn: false,
  });
  eq(added.success, true, '免预约项加入购物车成功');
  const list = await cart.list(db, USER, t.tripId);
  eq(list.summary.count, 1, '购物车共 1 项');
  eq(list.summary.reminderCount, 0, '免预约项不产生提醒数');
  eq(list.groups.length, 1, '按出行日形成一个分组');
  eq(list.groups[0].key, freeDate, '分组 key 是出行日');
  eq(list.groups[0].label, time.formatMonthDayWeek(freeDate).replace(' (', ' · ').replace(')', ''),
    '分组标题显示出行日');
  eq(list.groups[0].dayLabel, '【第1天】', '分组带首页同款出行日序号');

  const committed = await task.submit(db, USER, { tripId: t.tripId });
  eq(committed.success, true, '无提醒购物车直接提交成功');
  eq(committed.createdItems, 1, '创建 1 个行程项');
  eq(committed.createdTasks, 0, '免预约项不创建任务');
  eq(committed.addedTripItemCount, 1, '返回本次加入行程项数');
  eq(committed.addedReminderCount, 0, '返回本次加入提醒数');
  eq(db._size(COLLECTIONS.REMINDER_CART), 0, '购物车已清空');
  const freeItem = db._dump(COLLECTIONS.TRIP_ITEMS)[0];
  eq(freeItem.spotId, 'tiantan', '行程项景点正确');
  eq(freeItem.visitDate, freeDate, '行程项日期正确');
  eq(freeItem.remindOn, false, '行程项不设提醒');
  eq(freeItem.result, null, '行程项初始结果为空');
  eq(freeItem.backupGroupId, `${t.tripId}:tiantan`, '备选组 ID 正确');

  tl = await timeline.generate(db, USER, t.tripId);
  const committedEvent = tl.events.find(e => e.visitDate === freeDate);
  eq(committedEvent.status, EventSelectStatus.COMMITTED, '提交后时间线显示已加入行程');
  eq(committedEvent.button.text, '已加行程', '已加行程按钮不可再点');

  const adjacent = await trip.create(db, USER, {
    startDate: time.addDays(end, 1),
    endDate: time.addDays(end, 2),
    spotIds: ['gugong'],
  });
  eq(adjacent.merged, true, '相邻行程继续合并');
  const movedFreeItem = db._dump(COLLECTIONS.TRIP_ITEMS).find(i => i._id === freeItem._id);
  eq(movedFreeItem.tripId, t.tripId, '合并后行程项改挂存续行程');
  eq(movedFreeItem.backupGroupId, `${t.tripId}:tiantan`, '合并后备选组 ID 同步更新');
  const removed = await trip.remove(db, USER, t.tripId);
  eq(removed.success, true, '删除行程成功');
  eq(removed.removedItems, 1, '删除行程连带清理行程项');

  console.log('\n=== 2. 弱提醒默认关闭，强提醒默认开启 ===');
  db = freshDb();
  const start2 = time.addDays(time.todayStr(), 30);
  const end2 = time.addDays(start2, 1);
  const t2 = await trip.create(db, USER, {
    startDate: start2,
    endDate: end2,
    spotIds: ['gugong', 'badaling'],
  });
  tl = await timeline.generate(db, USER, t2.tripId);
  const strong = tl.events.find(e => e.spotId === 'gugong');
  const weak = tl.events.find(e => e.spotId === 'badaling');
  eq(strong.remindOnDefault, true, '强提醒默认勾选');
  eq(weak.remindOnDefault, false, '弱提醒默认不勾');

  await cart.add(db, USER, {
    tripId: t2.tripId, spotId: strong.spotId, visitDate: strong.visitDate,
    releaseAt: strong.releaseAt, remindOn: strong.remindOnDefault,
  });
  const weakAdded = await cart.add(db, USER, {
    tripId: t2.tripId, spotId: weak.spotId, visitDate: weak.visitDate,
    releaseAt: weak.releaseAt, remindOn: weak.remindOnDefault,
  });
  await cart.updateRemindOn(db, USER, weakAdded.cartId, true);
  let mixedCart = await cart.list(db, USER, t2.tripId);
  eq(mixedCart.summary.reminderCount, 2, '弱提醒可在购物车手动改勾');
  await cart.updateRemindOn(db, USER, weakAdded.cartId, false);
  mixedCart = await cart.list(db, USER, t2.tripId);
  eq(mixedCart.summary.count, 2, '混合购物车共 2 项');
  eq(mixedCart.summary.reminderCount, 1, '仅强提醒计入将设提醒');

  const mixedCommit = await task.submit(db, USER, {
    tripId: t2.tripId,
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: [5],
  });
  eq(mixedCommit.success, true, '混合购物车提交成功');
  eq(mixedCommit.createdItems, 2, '创建 2 个行程项');
  eq(mixedCommit.createdTasks, 1, '仅强提醒创建 1 条任务');
  eq(mixedCommit.addedTripItemCount, 2, '返回加入行程 2 项');
  eq(mixedCommit.addedReminderCount, 1, '返回加入提醒 1 项');
  const tasks = db._dump(COLLECTIONS.REMINDER_TASKS);
  eq(tasks.length, 1, '数据库中仅 1 条任务');
  eq(Boolean(tasks[0].itemId), true, '提醒任务已挂 itemId');
  const items = db._dump(COLLECTIONS.TRIP_ITEMS);
  const taskItem = items.find(i => i._id === tasks[0].itemId);
  eq(taskItem.spotId, 'gugong', '任务关联到正确行程项');
  eq(items.find(i => i.spotId === 'badaling').remindOn, false, '弱提醒行程项未设提醒');

  console.log('\n=== 3. disableReminders：仅加行程，不创建提醒 ===');
  db = freshDb();
  const freeVisit = time.addDays(time.todayStr(), 30);
  const disabledAdded = await cart.add(db, USER, {
    spotId: 'gugong',
    visitDate: freeVisit,
    remindOn: true,
  });
  eq(disabledAdded.success, true, '暂存清单加入一条提醒项');
  const disabledCommit = await task.submit(db, USER, { disableReminders: true });
  eq(disabledCommit.success, true, '未传 channels/offsets 也能降级提交');
  eq(disabledCommit.disableReminders, true, '响应标记 disableReminders');
  eq(disabledCommit.createdItems, 1, '仍创建行程项');
  eq(disabledCommit.createdTasks, 0, '不创建提醒任务');
  eq(disabledCommit.addedTripItemCount, 1, '仅加行程仍返回加入行程 1 项');
  eq(disabledCommit.addedReminderCount, 0, '仅加行程返回加入提醒 0 项');
  eq(disabledCommit.noReminder, 1, '全部项计为不提醒');
  eq(db._size(COLLECTIONS.REMINDER_TASKS), 0, '任务集合为空');
  eq(db._dump(COLLECTIONS.TRIP_ITEMS)[0].remindOn, false, '行程项提醒开关为 false');

  db = freshDb();
  const realTrip = await trip.create(db, USER, {
    startDate: freeVisit,
    endDate: freeVisit,
    spotIds: ['gugong'],
  });
  await cart.add(db, USER, {
    tripId: realTrip.tripId,
    spotId: 'gugong',
    visitDate: freeVisit,
    remindOn: true,
  });
  const rejectedDisable = await task.submit(db, USER, {
    tripId: realTrip.tripId,
    disableReminders: true,
  });
  eq(rejectedDisable.success, false, '真实 tripId 不允许批量关闭提醒');
  eq(rejectedDisable.errorCode, 1010, '返回参数错误');

  console.log('\n=== 4. 指定 cartId：补录只提交一条，不消费其他草稿 ===');
  db = freshDb();
  const firstVisit = time.addDays(time.todayStr(), 30);
  const secondVisit = time.addDays(time.todayStr(), 31);
  const first = await cart.add(db, USER, {
    spotId: 'gugong', visitDate: firstVisit, remindOn: false,
  });
  await cart.add(db, USER, {
    spotId: 'guobo', visitDate: secondVisit, remindOn: false,
  });
  const scopedCommit = await task.submit(db, USER, {
    cartId: first.cartId,
    disableReminders: true,
  });
  eq(scopedCommit.success, true, '指定 cartId 提交成功');
  eq(scopedCommit.createdItems, 1, '只创建一个行程项');
  eq(db._dump(COLLECTIONS.TRIP_ITEMS)[0].spotId, 'gugong', '创建的是指定项');
  eq(db._size(COLLECTIONS.TRIP_ITEMS), 1, '其他草稿没有落库');
  eq(db._size(COLLECTIONS.REMINDER_CART), 1, '其他草稿仍保留在暂存清单');
  eq(db._dump(COLLECTIONS.REMINDER_CART)[0].spotId, 'guobo', '保留的是未指定项');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
