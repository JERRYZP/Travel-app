/**
 * 行程项接口（API-契约 8.4）
 *
 * 覆盖 markResult / undoResult / updateReminder / remove / removeVisitDate
 * 的边界与连带结果。全部走 DB 层（mock-db 内存云数据库桩）。
 *
 * 运行：node test/trip-item-actions.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, PENDING_CART_TRIP_ID } = require('../cloudfunctions/reminder/lib/schema');
const trip = require('../cloudfunctions/reminder/lib/trip');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');
const actions = require('../cloudfunctions/reminder/lib/trip-item-actions');
const tripItem = require('../cloudfunctions/reminder/lib/trip-item');
const item = require('../cloudfunctions/reminder/lib/item');
const time = require('../cloudfunctions/reminder/lib/time');

const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;
const USER = 'openid_item_actions';
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

/** 造一条行程项（直接落库，绕开提交链路，让用例只测被测函数） */
async function seedItem(db, { tripId, spotId, visitDate, remindOn = false, result = null }) {
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS).add({
    data: tripItem.makeItemData({ userId: USER, tripId, spotId, visitDate, remindOn }),
  });
  if (result) {
    await db.collection(COLLECTIONS.TRIP_ITEMS).doc(res._id).update({
      data: { result, resultAt: time.now() },
    });
  }
  return res._id;
}

async function seedTrip(db, id, spotIds, startDate, endDate) {
  await db.collection(COLLECTIONS.TRIPS).add({
    data: {
      _id: id, userId: USER, city: '北京', startDate, endDate,
      name: '北京测试', spotIds, spots: spotIds.map(s => ({ spotId: s, startDate, endDate })),
      status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
    },
  });
}

// 取一个确定已开票的日期：故宫 advanceDays=7，放票已过去的出行日一定是「昨天 + 7」
const TODAY = time.todayStr();
const PAST_VISIT = time.addDays(TODAY, 1);   // releaseAt = TODAY - 6 → 早已开票且超 24h
const FUTURE_VISIT = time.addDays(TODAY, 30); // releaseAt = TODAY + 23 → 还没开票

(async () => {
  console.log('=== 1. markResult：开票前不问结果 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    const res = await actions.markResult(db, USER, { itemId: id, result: 'SUCCESS' });
    eq(res.success, false, '还没到放票时间 → 拒绝标记');
    eq(res.errorCode, 1014, '错误码 1014（当前行程项不可标记结果）');
    const raw = db._dump(COLLECTIONS.TRIP_ITEMS).find(i => i._id === id);
    eq(raw.result, null, '拒绝时不写库');
  }

  console.log('=== 2. markResult：不可反复修改 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT, result: 'SUCCESS' });
    const res = await actions.markResult(db, USER, { itemId: id, result: 'FAILED' });
    eq(res.success, false, '已标记过 → 不允许改成别的结果');
    eq(res.errorCode, 1014, '错误码 1014');
    const raw = db._dump(COLLECTIONS.TRIP_ITEMS).find(i => i._id === id);
    eq(raw.result, 'SUCCESS', '原结果未被覆盖');
  }

  console.log('=== 3. markResult：非法 result 与不存在的 itemId ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    eq((await actions.markResult(db, USER, { itemId: id, result: 'MAYBE' })).errorCode, 1014, '非法 result 值 → 1014');
    eq((await actions.markResult(db, USER, { itemId: 'nope', result: 'SUCCESS' })).errorCode, 1013, '行程项不存在 → 1013');
  }

  console.log('=== 4. markResult 返回 backupPrompt（备选收束） ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const b = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: time.addDays(PAST_VISIT, 1) });
    const res = await actions.markResult(db, USER, { itemId: a, result: 'SUCCESS' });
    eq(res.success, true, '标记成功');
    eq(res.item.ticketState, 'SUCCESS', '返回更新后的 item');
    eq(Boolean(res.backupPrompt), true, '同备选组还有未处理日期 → 返回内联提示');
    eq(res.backupPrompt.pending.length, 1, '提示里列出 1 条备选');
    eq(res.backupPrompt.pending[0].itemId, b, '指出是哪条备选');
    eq(res.backupPrompt.text.indexOf('已确认') === 0, true, '文案由服务端给，前端不自己拼');
  }

  console.log('=== 5. 永不静默自动删除备选 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const b = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: time.addDays(PAST_VISIT, 1) });
    await actions.markResult(db, USER, { itemId: a, result: 'SUCCESS' });
    const left = db._dump(COLLECTIONS.TRIP_ITEMS).map(i => i._id);
    eq(left.indexOf(b) >= 0, true, '标记成功后备选仍在——不操作即保留');
  }

  console.log('=== 6. 没有备选时 backupPrompt 为 null ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const res = await actions.markResult(db, USER, { itemId: a, result: 'SUCCESS' });
    eq(res.backupPrompt, null, '单日行程项不追问备选');
  }

  console.log('=== 7. 标记「没抢到」不给 backupPrompt（该给的是挽回） ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: time.addDays(PAST_VISIT, 1) });
    const res = await actions.markResult(db, USER, { itemId: a, result: 'FAILED' });
    eq(res.backupPrompt, null, '失败时刻给的是挽回建议，不是收束提示');
  }

  console.log('=== 8. undoResult：窗口内可撤销 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const marked = await actions.markResult(db, USER, { itemId: id, result: 'SUCCESS' });
    const res = await actions.undoResult(db, USER, { itemId: id, expectedResultAt: marked.item.resultAt });
    eq(res.success, true, '4 秒内可撤销');
    eq(res.item.result, null, '结果复位为 null');
    // 「回到时间态」= 不再是人工结果，而是按释放时间重新推出来的态。
    // 具体是 PENDING/BOOKABLE/UNMARKED 取决于 fixture 的放票时刻，不该写死。
    eq(['PENDING', 'BOOKABLE', 'UNMARKED'].indexOf(res.item.ticketState) >= 0, true,
      '撤销后回到按时间推导的展示态');
    eq(res.item.undoUntil, null, '撤销后不再有可撤销窗口');
  }

  console.log('=== 9. undoResult：窗口外拒绝 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT, result: 'SUCCESS' });
    // 手动把 resultAt 推到窗口之外
    await db.collection(COLLECTIONS.TRIP_ITEMS).doc(id).update({
      data: { resultAt: new Date(time.now().getTime() - 60000) },
    });
    const raw = db._dump(COLLECTIONS.TRIP_ITEMS).find(i => i._id === id);
    const res = await actions.undoResult(db, USER, { itemId: id, expectedResultAt: raw.resultAt });
    eq(res.success, false, '超过窗口 → 拒绝');
    eq(res.errorCode, 1015, '错误码 1015（撤销时间已过）');
  }

  console.log('=== 10. undoResult：expectedResultAt 不匹配则拒绝 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT, result: 'SUCCESS' });
    const res = await actions.undoResult(db, USER, { itemId: id, expectedResultAt: new Date(0) });
    eq(res.success, false, '不是那一次标记 → 拒绝，不撤销别的东西');
  }

  console.log('=== 11. undoResult：未记录结果的不可撤销 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const res = await actions.undoResult(db, USER, { itemId: id });
    eq(res.success, false, '没标记过就没有可撤销的东西');
  }

  console.log('=== 12. updateReminder：免预约项拒绝开启提醒 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['tiantan'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'tiantan', visitDate: FUTURE_VISIT });
    const res = await actions.updateReminder(db, USER, {
      itemId: id, remindOn: true, channels: ['OFFICIAL_ACCOUNT'], offsets: [5],
    });
    eq(res.success, false, '免预约项没有提醒可言');
    eq(res.errorCode, 1010, '错误码 1010（参数不合法）');
  }

  console.log('=== 13. updateReminder：取消提醒删掉未触发任务，但不退还额度 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT, remindOn: true });
    await db.collection(COLLECTIONS.REMINDER_TASKS).add({
      data: {
        userId: USER, itemId: id, tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT,
        releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        offsets: [5], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING',
        sentOffsets: [], createdAt: time.now(),
      },
    });
    const res = await actions.updateReminder(db, USER, { itemId: id, remindOn: false });
    eq(res.success, true, '取消提醒成功');
    eq(res.item.remindOn, false, '行程项保留，退化为仅加入行程');
    eq(db._dump(COLLECTIONS.REMINDER_TASKS).length, 0, '未触发任务被删除');
    eq(res.quotaRefunded, false, '微信侧额度已消耗，不退还');
  }

  console.log('=== 14. updateReminder：已触发的任务保留为历史，且不抹掉「未送达」信号 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    /* ⚠️ 2026-09-23 起「放票已过」的项整体不再受理提醒开关（用例 14.1），
       所以这里必须造一条真实终态：visitDate 还没到（开关仍有效），
       但任务被 notifier 判成了 MISSED —— 这正是「提醒没送到、票还没过期」那一档。 */
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT, remindOn: true });
    await db.collection(COLLECTIONS.REMINDER_TASKS).add({
      data: {
        userId: USER, itemId: id, tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT,
        releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        offsets: [5], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'MISSED',
        missedReason: 'errCode=43101 配额不足', sentOffsets: [], createdAt: time.now(),
      },
    });
    const res = await actions.updateReminder(db, USER, { itemId: id, remindOn: false });
    eq(db._dump(COLLECTIONS.REMINDER_TASKS).length, 1, '已触发的任务保留为历史记录');
    /* ⚠️ 反向锁：取消提醒**不得**把这条还没送达的项洗成「未设提醒」。
       原实现无条件落 remindOn=false，chip 从「未送达」变成「未设提醒」，
       失败信号当场消失、任务却还在库里（决策文档 §五 禁止的静默失败）。 */
    eq(res.item.remindOn, true, '留有终态任务时不落 remindOn=false（保住未送达信号）');
    eq(res.item.reminder.state, 'MISSED', 'chip 仍是「未送达」，不被开关覆盖');
    eq(res.missedKept, true, '回传 missedKept，前端据此说明「记录保留」');

    const db2 = freshDb();
    await seedTrip(db2, 'T2', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id2 = await seedItem(db2, { tripId: 'T2', spotId: 'gugong', visitDate: FUTURE_VISIT, remindOn: true });
    await db2.collection(COLLECTIONS.REMINDER_TASKS).add({
      data: {
        userId: USER, itemId: id2, tripId: 'T2', spotId: 'gugong', visitDate: FUTURE_VISIT,
        releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        offsets: [5], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING',
        sentOffsets: [], createdAt: time.now(),
      },
    });
    const res2 = await actions.updateReminder(db2, USER, { itemId: id2, remindOn: false });
    eq(db2._dump(COLLECTIONS.REMINDER_TASKS).length, 0, '仅 WAITING 时照常删除');
    eq(res2.item.remindOn, false, '没有终态记录 → 正常退化为「未设提醒」');
    eq(res2.missedKept, false, '没有未送达记录 → 不给「记录保留」提示');
  }

  console.log('=== 14.1 updateReminder：放票时刻已过 → 开启与取消都拒绝 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    /* PAST_VISIT 的 releaseAt 早已过去 —— 用户此刻点「开启提醒」只会得到一条
       一生出来就是 MISSED 的任务：刚点完就看到「未送达」，因果正好反了
       （2026-09-23 实测：对「已约到」的八达岭设提醒 → 立刻未送达）。 */
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const on = await actions.updateReminder(db, USER, {
      itemId: id, remindOn: true, channels: ['OFFICIAL_ACCOUNT'], offsets: [5],
    });
    eq(on.success, false, '放票已过 → 拒绝开启提醒');
    eq(on.errorCode, 1017, '错误码 1017（提醒窗口已关闭）');
    eq(db._dump(COLLECTIONS.REMINDER_TASKS).length, 0, '拒绝时不留下任何任务');

    const off = await actions.updateReminder(db, USER, { itemId: id, remindOn: false });
    eq(off.success, false, '放票已过 → 取消提醒同样无意义，一并拒绝');
    eq(off.errorCode, 1017, '取消走同一个闸门');
  }

  console.log('=== 14.2 canSetReminder：与 ticketState 不等价的那个窗口 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    /* 造一条「放票刚过去、仍在 24h 窗口内」的项 —— 故宫 advanceDays=7、放票 20:00，
       所以取**最近一次已经过去的 20:00**（距现在必然 < 24h），其 +7 天就是出行日。
       ⚠️ 不能用 PAST_VISIT：那条的 releaseAt 早了 6 天，票务态是「待确认」不是「可抢票」——
       本用例要的正是「可抢票且提醒窗口已关」这一档。 */
    const pad2 = n => String(n).padStart(2, '0');
    const iso2 = x => x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
    const bjNow = new Date(Date.now() + 8 * 3600000);
    let last2000 = Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate(), 20, 0) - 8 * 3600000;
    if (last2000 > Date.now()) last2000 -= 86400000;      // 今天 20:00 还没到 → 取昨天
    const visitBookable = iso2(new Date(last2000 + 7 * 86400000));

    /* 清单先加、放票后才提交：releaseAt 已过，但票务态是「可抢票」而非「待抢票」。
       按 `ticketState === 'PENDING'` 写条件会漏掉这一档 —— 存量里真有这种项
       （submit 曾照建任务，模板现在就踩在这一档上）。 */
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: visitBookable });
    const spot = spotsSeed.find(s => s.spotId === 'gugong');
    const rule = rulesSeed.find(r => r.spotId === 'gugong');
    const fetchItem = async (iid) => (await db.collection(COLLECTIONS.TRIP_ITEMS).doc(iid).get()).data[0];
    const decorated = item.decorateItem({
      item: await fetchItem(id), spot, rule, task: null, nowTs: time.now(),
    });
    eq(decorated.ticketState, 'BOOKABLE', '放票已过 → 票务态是可抢票');
    eq(decorated.canSetReminder, false, '可抢票态也没有提醒入口（与 PENDING 不等价）');

    const id2 = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    const d2 = item.decorateItem({ item: await fetchItem(id2), spot, rule, task: null, nowTs: time.now() });
    eq(d2.ticketState, 'PENDING', '未到放票 → 待抢票');
    eq(d2.canSetReminder, true, '待抢票态有提醒入口');

    const free = await seedItem(db, { tripId: 'T1', spotId: 'tiantan', visitDate: FUTURE_VISIT });
    const dF = item.decorateItem({
      item: await fetchItem(free), spot: spotsSeed.find(s => s.spotId === 'tiantan'), rule: null, task: null, nowTs: time.now(),
    });
    eq(dF.canSetReminder, false, '免预约项没有提醒可言');
  }

  console.log('=== 15. remove：删单条连带任务；行程清空则行程消失 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT, remindOn: true });
    await db.collection(COLLECTIONS.REMINDER_TASKS).add({
      data: {
        userId: USER, itemId: id, tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT,
        releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        offsets: [5], channels: ['OFFICIAL_ACCOUNT'], backendStatus: 'WAITING',
        sentOffsets: [], createdAt: time.now(),
      },
    });
    const res = await actions.remove(db, USER, { itemId: id });
    eq(res.success, true, '删除成功');
    eq(res.removedTasks, 1, '连带删除提醒任务');
    eq(res.tripRemoved, true, '行程项清零 → 行程随之消失');
    eq(db._dump(COLLECTIONS.TRIPS).length, 0, '行程已删除');
  }

  console.log('=== 16. remove：还有别的行程项时行程保留 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    const res = await actions.remove(db, USER, { itemId: a });
    eq(res.tripRemoved, false, '还有行程项 → 行程保留');
    eq(db._dump(COLLECTIONS.TRIPS).length, 1, '行程仍在');
  }

  console.log('=== 17. remove：只有免预约项、没设提醒的行程不会被误删 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['tiantan'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'tiantan', visitDate: PAST_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'tiantan', visitDate: FUTURE_VISIT });
    // 删掉其中一条后，行程下已无任务但仍有行程项
    await actions.remove(db, USER, { itemId: a });
    eq(db._dump(COLLECTIONS.TRIPS).length, 1, '行程判空只看行程项，不看提醒任务');
  }

  console.log('=== 18. removeVisitDate：删某一天的全部行程项 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong', 'guobo'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const firstId = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'guobo', visitDate: PAST_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    /* 即使前端只带到一个 itemId，也必须以“当天整组”为基线删掉全部。 */
    const res = await actions.removeVisitDate(db, USER, {
      tripId: 'T1', visitDate: PAST_VISIT, itemIds: [firstId],
    });
    eq(res.success, true, '删除成功');
    eq(res.removedItems, 2, '该日期下 2 条一起删');
    eq(res.tripRemoved, false, '另一天还有行程项 → 行程保留');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).length, 1, '只剩另一天的 1 条');
  }

  console.log('=== 19. removeVisitDate：删完最后一天 → 行程消失 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    const res = await actions.removeVisitDate(db, USER, { tripId: 'T1', visitDate: PAST_VISIT });
    eq(res.tripRemoved, true, '行程项清零 → 行程随之消失');
    eq(db._dump(COLLECTIONS.TRIPS).length, 0, '行程已删除');
  }

  console.log('=== 20. remove：删掉最后一笔行程项时清理失去归属的暂存清单 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    await db.collection(COLLECTIONS.REMINDER_CART).add({
      data: {
        userId: USER, tripId: PENDING_CART_TRIP_ID, spotId: 'guobo',
        visitDate: FUTURE_VISIT, releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        remindOn: true,
      },
    });

    const res = await actions.remove(db, USER, { itemId: id });
    eq(res.tripRemoved, true, '最后一笔行程项删除 → 行程消失');
    eq(db._size(COLLECTIONS.REMINDER_CART), 0, '暂存清单随账号行程清空一起清理');
  }

  console.log('=== 21. remove：账号仍有行程项时保留暂存清单 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const a = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: FUTURE_VISIT });
    await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: time.addDays(FUTURE_VISIT, 1) });
    await db.collection(COLLECTIONS.REMINDER_CART).add({
      data: {
        userId: USER, tripId: PENDING_CART_TRIP_ID, spotId: 'guobo',
        visitDate: FUTURE_VISIT, releaseAt: time.parseBeijing(time.addDays(FUTURE_VISIT, -7), '20:00'),
        remindOn: true,
      },
    });

    await actions.remove(db, USER, { itemId: a });
    eq(db._size(COLLECTIONS.REMINDER_CART), 1, '账号仍有行程项时，不应误删暂存草稿');
  }

  console.log('=== 22. 越权：别人的行程项操作不到 ===');
  {
    const db = freshDb();
    await seedTrip(db, 'T1', ['gugong'], time.addDays(TODAY, -1), time.addDays(TODAY, 40));
    const id = await seedItem(db, { tripId: 'T1', spotId: 'gugong', visitDate: PAST_VISIT });
    eq((await actions.markResult(db, 'other_user', { itemId: id, result: 'SUCCESS' })).errorCode, 1013,
      'markResult 查不到别人的行程项');
    eq((await actions.remove(db, 'other_user', { itemId: id })).errorCode, 1013,
      'remove 查不到别人的行程项');
    eq((await actions.undoResult(db, 'other_user', { itemId: id })).errorCode, 1013,
      'undoResult 查不到别人的行程项');
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
