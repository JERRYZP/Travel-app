/**
 * 日期提醒资格的唯一真身：用现有规则数据钉住“同一出行日，不同景点
 * 因 advanceDays 不同而得到不同提醒资格”的行为。
 */
const datePlan = require('../cloudfunctions/reminder/lib/date-plan');
const datePlanView = require('../miniprogram/utils/reminder-date-plan');
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/reminder/lib/schema');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');
const time = require('../cloudfunctions/reminder/lib/time');
const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) !== String(expected)) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

const spotOf = id => spots.find(row => row.spotId === id);
const ruleOf = id => rules.find(row => row.spotId === id);
const NOW = new Date('2026-10-31T12:00:00+08:00');

const gugong = datePlan.build({
  spot: spotOf('gugong'),
  rule: ruleOf('gugong'),
  visitDates: ['2026-11-04', '2026-11-10'],
  nowTs: NOW,
  cartDates: new Set(),
  tripDates: new Set(),
});
eq(gugong.dates[0].status, 'TRIP_ONLY', '故宫 11月4日已过放票时间');
eq(gugong.dates[0].reason, 'RELEASE_PASSED', '过期原因明确');
eq(gugong.dates[1].status, 'REMINDABLE', '故宫 11月10日仍可提醒');
eq(gugong.summary.reminder, 1, '汇总只计 1 个可提醒日期');
eq(gugong.summary.tripOnly, 1, '汇总记录 1 个仅行程日期');

const renmin = datePlan.build({
  spot: spotOf('renmin-dahuitang'),
  rule: ruleOf('renmin-dahuitang'),
  visitDates: ['2026-11-04'],
  nowTs: NOW,
  cartDates: new Set(),
  tripDates: new Set(),
});
eq(renmin.dates[0].status, 'REMINDABLE', '同一日期在提前 3 天的景点仍可提醒');

const existing = datePlan.build({
  spot: spotOf('gugong'),
  rule: ruleOf('gugong'),
  visitDates: ['2026-11-10', '2026-11-12'],
  nowTs: NOW,
  cartDates: new Set(['2026-11-10']),
  tripDates: new Set(['2026-11-12']),
});
eq(existing.dates[0].status, 'IN_CART', '已在暂存清单的日期不重复加入');
eq(existing.dates[1].status, 'IN_TRIP', '已在行程的日期不重复加入');
eq(existing.summary.existing, 2, '重复日期统一计入 existing');
eq(existing.summary.addable, 0, '重复日期不可再次写入');

const noFixed = datePlan.build({
  spot: spotOf('huanqiu-yingcheng'),
  rule: ruleOf('huanqiu-yingcheng'),
  visitDates: ['2026-11-20'],
  nowTs: NOW,
  cartDates: new Set(),
  tripDates: new Set(),
});
eq(noFixed.dates[0].status, 'TRIP_ONLY', '无固定放票时刻固定仅行程');
eq(noFixed.dates[0].reason, 'NO_FIXED_RELEASE', '无固定放票原因明确');

const mixedView = datePlanView.viewOf({
  dates: [
    { visitDate: '2026-11-04', status: 'TRIP_ONLY', reason: 'RELEASE_PASSED' },
    { visitDate: '2026-11-08', status: 'REMINDABLE', reason: '' },
    { visitDate: '2026-11-10', status: 'REMINDABLE', reason: '' },
  ],
  summary: {
    reminder: 2, tripOnly: 1, existing: 0,
    releasePassed: 1, noFixedRelease: 0, noReservation: 0,
  },
});
eq(mixedView.title, '2 天可设提醒，1 天仅加入行程', '浮层标题保留汇总');
eq(mixedView.lines[0].label, '可设提醒', '首行明确可提醒日期');
eq(mixedView.lines[0].text, '11月8日、11月10日', '首行定位具体可提醒日期');
eq(mixedView.lines[1].label, '仅加入行程', '次行明确仅行程日期');
eq(mixedView.lines[1].text, '11月4日（已过放票时间）', '次行定位具体过期日期');

(async () => {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spots);
  db._seed(COLLECTIONS.RELEASE_RULES, rules);
  const userId = 'openid_date_plan';
  const pastVisit = time.addDays(time.todayStr(), 2);
  const futureVisit = time.addDays(time.todayStr(), 30);

  const before = await cart.planDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(before.success, true, 'cart.planDates 可读取服务端资格');
  eq(before.summary.reminder, 1, '计划阶段只计未来可提醒日期');
  eq(before.summary.releasePassed, 1, '计划阶段明确标出已过放票日期');

  const added = await cart.addDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(added.added, 2, '原子批量入清单只写一次请求');
  eq(added.addedReminders, 1, '只有未来日期保留提醒');
  eq(added.addedTripOnly, 1, '已过日期明确降级为仅行程');
  eq(db._dump(COLLECTIONS.REMINDER_CART).length, 2, '两条日期均已暂存');

  const duplicate = await cart.planDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(duplicate.summary.existing, 2, '再次预检时全部识别为已存在');
  eq(duplicate.summary.addable, 0, '重复日期不会再次写入');
  const duplicateAdd = await cart.addDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(duplicateAdd.added, 0, '重复调用 addDates 不产生重复清单');

  const quickPlan = await cart.planQuickDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(quickPlan.success, true, '快捷设提醒有独立预检');
  eq(quickPlan.summary.addable, 2, '快捷预检可复用旧暂存行，不再显示重复');
  eq(quickPlan.resumeCartCount, 2, '快捷预检标记可续用的旧暂存行');

  const quickCommit = await task.submitQuick(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
    channels: ['OFFICIAL_ACCOUNT'],
    offsets: [5],
  });
  eq(quickCommit.success, true, '快捷提交直接创建行程项和提醒');
  eq(quickCommit.createdItems, 2, '快捷提交不依赖新建清单行');
  eq(quickCommit.createdTasks, 1, '仅未来日期创建提醒任务');
  eq(quickCommit.expiredReminder, 1, '过期提醒仍按既有规则明确降级');
  eq(db._size(COLLECTIONS.REMINDER_CART), 0, '旧暂存行提交时被消费，主流程清单不残留');

  const afterQuick = await cart.planQuickDates(db, userId, {
    spotId: 'gugong',
    visitDates: [pastVisit, futureVisit],
  });
  eq(afterQuick.summary.existing, 2, '已落成行程后快捷入口仍会拦截重复');
  const duplicateQuick = await task.submitQuick(db, userId, {
    spotId: 'gugong',
    visitDates: [futureVisit],
    channels: ['OFFICIAL_ACCOUNT'],
    offsets: [5],
  });
  eq(duplicateQuick.errorCode, 1002, '快捷提交服务端二次拦截已存在行程');

  const directUser = 'openid_quick_direct';
  const directPlan = await cart.planQuickDates(db, directUser, {
    spotId: 'gugong',
    visitDates: [futureVisit],
  });
  eq(directPlan.summary.addable, 1, '全新快捷日期可直接进入提交');
  const directCommit = await task.submitQuick(db, directUser, {
    spotId: 'gugong',
    visitDates: [futureVisit],
    channels: ['OFFICIAL_ACCOUNT'],
    offsets: [5],
  });
  eq(directCommit.success, true, '全新快捷日期无需暂存清单即可提交');
  eq(
    (await db.collection(COLLECTIONS.REMINDER_CART).where({ userId: directUser }).get()).data.length,
    0,
    '全新快捷提交全程不写主流程清单'
  );

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
