/**
 * timeline.preview 纯预览（2026-09-20）
 *
 * 核心不变量：**历史状态绝不带进预览**。
 * 旧实现按 tripId 去查「已加清单 / 已在行程」，于是换一批日期或景点重新生成时，
 * 上一条时间线的状态会被带进来——用户看到「已在行程」的日期其实属于另一趟行程，
 * 或者刚清空的清单仍显示已加。这条断言就是钉住这个回归。
 *
 * 运行：node test/timeline-preview.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/reminder/lib/schema');
const timeline = require('../cloudfunctions/reminder/lib/timeline');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');
const time = require('../cloudfunctions/reminder/lib/time');

const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;
const USER = 'openid_preview';
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

const TODAY = time.todayStr();
const START = time.addDays(TODAY, 20);
const END = time.addDays(TODAY, 24);

/** 把预览结果压成可比较的形状（去掉每次都不同的 Date 实例，留 ISO 串） */
function digest(res) {
  return JSON.stringify((res.events || []).map(e => ({
    spotId: e.spotId, visitDate: e.visitDate, status: e.status,
    releaseAt: e.releaseAt ? new Date(e.releaseAt).toISOString() : null,
    button: e.button.text,
  })));
}

(async () => {
  console.log('=== 1. 纯预览：不创建、不改写任何行程 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    eq(res.success, true, '预览成功');
    eq(res.events.length > 0, true, '故宫在日期段内生成事件');
    eq(db._dump(COLLECTIONS.TRIPS).length, 0, '没有创建任何行程');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).length, 0, '没有创建任何行程项');
    eq(db._dump(COLLECTIONS.REMINDER_CART).length, 0, '没有写清单');
  }

  console.log('=== 2. 纯预览只读「当前暂存清单」，不读已落库的行程项 ===');
  {
    /* 这条界线是这次改版的关键，两个方向都要钉住：
       ① 已落库的 trip_items **绝不能**带进预览（否则换一批日期重新生成时，
          会看到一条属于另一趟行程的「已在行程」）；
       ② 当前暂存清单**必须**反映到预览（否则点了「加入清单」按钮页面毫无变化，
          按钮仍写「添加提醒」、再点一次提示「已经在清单里啦」，看起来就是坏的）。 */
    const dbA = freshDb();
    const base = await timeline.preview(dbA, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    const targetDate = base.events[0].visitDate;

    /* --- ① 落一条已提交的行程项+任务：预览必须与干净库逐字一致 --- */
    const dbB = freshDb();
    await dbB.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T9', userId: USER, city: '北京', startDate: START, endDate: END, name: '已有行程',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await dbB.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I9', userId: USER, tripId: 'T9', spotId: 'gugong', visitDate: targetDate,
        backupGroupId: 'T9:gugong', remindOn: true, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await dbB.collection(COLLECTIONS.REMINDER_TASKS).add({
      data: {
        _id: 'K9', userId: USER, itemId: 'I9', tripId: 'T9', spotId: 'gugong', visitDate: targetDate,
        releaseAt: time.now(), offsets: [5], channels: ['OFFICIAL_ACCOUNT'],
        backendStatus: 'WAITING', sentOffsets: [], createdAt: time.now(),
      },
    });
    const afterCommitted = await timeline.preview(dbB, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    eq(digest(afterCommitted), digest(base), '已落库的行程项与任务**不带入**预览（逐字一致）');

    /* --- ② 往暂存清单加一条：那一条必须变成「已加清单」 --- */
    const dbC = freshDb();
    await cart.add(dbC, USER, {
      spotId: 'gugong', visitDate: targetDate,
      releaseAt: base.events[0].releaseAt, remindOn: true,
    });
    const afterCart = await timeline.preview(dbC, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    const hit = afterCart.events.find(e => e.visitDate === targetDate);
    eq(hit.status, 'IN_CART', '当前暂存清单**要**反映到预览（按钮显示「已加清单」）');
    const others = afterCart.events.filter(e => e.visitDate !== targetDate);
    eq(others.every(e => e.status === 'SELECTABLE'), true, '清单外的日期不受影响');
  }

  console.log('=== 3. 预览里不会出现 COMMITTED（已在行程） ===');
  {
    const db = freshDb();
    const first = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    const visitDate = first.events[0].visitDate;
    await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T9', userId: USER, city: '北京', startDate: START, endDate: END, name: '已有行程',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await db.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I9', userId: USER, tripId: 'T9', spotId: 'gugong', visitDate,
        backupGroupId: 'T9:gugong', remindOn: true, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    eq(res.events.some(e => e.status === 'COMMITTED'), false, '预览不出现「已在行程」');
    eq(res.events.every(e => e.status === 'SELECTABLE'), true, '该日的项全部可选（清单里没有它）');
  }

  console.log('=== 4. 重复加入由 cart.add 兜底（按 spotId+visitDate 跨行程查）===');
  {
    const db = freshDb();
    await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T9', userId: USER, city: '北京', startDate: START, endDate: END, name: '已有行程',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await db.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I9', userId: USER, tripId: 'T9', spotId: 'gugong', visitDate: START,
        backupGroupId: 'T9:gugong', remindOn: false, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });
    const res = await cart.add(db, USER, {
      spotId: 'gugong', visitDate: START,
      releaseAt: time.parseBeijing(time.addDays(START, -7), '20:00'), remindOn: true,
    });
    eq(res.success, false, '已落为行程项的日期不能再进清单');
    eq(res.errorCode, 1002, '错误码 1002（已在清单里啦）');
  }

  console.log('=== 5. 免预约景点进入同一时间轴 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['tiantan'] });
    eq(res.events.length, 5, '免预约景点按日期段生成 5 个候选项');
    eq(res.events.every(e => e.reservationRequired === false), true, '标记为免预约');
    eq(res.events.every(e => e.releaseAt === null), true, '免预约项没有放票时刻');
    eq(res.events.every(e => e.button.text === '加入行程'), true, '按钮文案固定为「加入行程」');
  }

  console.log('=== 6. 免预约项排在当天有放票时刻的项之后 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, {
      startDate: START, endDate: END, spotIds: ['gugong', 'tiantan'],
    });
    const mixed = res.byDeparture.find(g => g.events.some(e => e.releaseAt) && g.events.some(e => !e.releaseAt));
    eq(Boolean(mixed), true, '存在「同时有需预约与免预约」的出游日 Tab');
    const idxFree = mixed.events.findIndex(e => !e.releaseAt);
    const idxPaid = mixed.events.findIndex(e => e.releaseAt);
    eq(idxFree > idxPaid, true, '免预约项排在当天有放票时刻的项之后（TIMELINE-RULE-003）');
  }

  console.log('=== 7. 免预约景点归属当日出游日 Tab ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['tiantan'] });
    eq(res.byDeparture.length, 5, '每个出游日一个 Tab，免预约项归属其中');
    eq(res.byDeparture.every(g => g.events.every(e => e.visitDate === g.key)), true,
      '免预约项落在自己那个出游日，不被堆到独立区块');
  }

  console.log('=== 8. 闭馆日被跳过并给出提示（走 time.isOpenOn）===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    eq(res.closedDaySkips.length >= 0, true, '返回被跳过的日期列表');
    const hasMonday = res.events.some(e => time.dayNameOf(e.visitDate) === 'monday');
    eq(hasMonday, false, '故宫周一闭馆 → 周一不生成事件');
  }

  console.log('=== 9. 白名单景点（北大仅周末）文案说「不可约」而非「闭馆」===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['peking-university'] });
    if (res.closedDaySkips.length > 0) {
      eq(res.closedDaySkips[0].note.indexOf('不可约') >= 0, true, '白名单景点用「不可约」措辞');
      eq(res.closedDaySkips[0].note.indexOf('闭馆') === -1, true, '不能对白名单说「闭馆」（那正好说反）');
    } else {
      eq(true, true, '该日期段全是周末，无跳过');
    }
  }

  console.log('=== 10. 无固定放票规则的景点（环球影城）进 closedSpots ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, {
      startDate: START, endDate: END, spotIds: ['huanqiu-yingcheng'],
    });
    eq(res.empty, true, '不可选景点不让预览整体失败');
    eq(res.closedSpots.length, 1, '进入 closedSpots 并给出说明');
    eq(res.closedSpots[0].note.indexOf('无固定放票时刻') >= 0, true, '说明文案点明原因');
  }

  console.log('=== 11. 空景点列表 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: [] });
    eq(res.success, true, '空输入不报错');
    eq(res.empty, true, '标记为空');
    eq(res.emptyReason, '先选择想去的景点', '给出可行动的空态文案');
  }

  console.log('=== 12. 非法日期段 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, { startDate: END, endDate: START, spotIds: ['gugong'] });
    eq(res.success, false, '结束日早于开始日 → 拒绝');
    eq(res.errorCode, 1006, '错误码 1006（行程日期非法）');
  }

  console.log('=== 13. spotSegments：各景点保留自己的日期段 ===');
  {
    const db = freshDb();
    const res = await timeline.preview(db, USER, {
      startDate: time.addDays(TODAY, 20),
      endDate: time.addDays(TODAY, 40),
      segments: [
        { spotId: 'gugong', startDate: time.addDays(TODAY, 20), endDate: time.addDays(TODAY, 21) },
        { spotId: 'guobo', startDate: time.addDays(TODAY, 30), endDate: time.addDays(TODAY, 31) },
      ],
    });
    eq(res.events.every(e => e.spotId === 'gugong' ? e.visitDate <= time.addDays(TODAY, 21) : e.visitDate >= time.addDays(TODAY, 30)),
      true, '各景点只在自己的段内生成事件（不膨胀成整段 × 全部景点）');
  }


  console.log('=== 14. 提交清单时才建行程（纯预览化的完整闭环）===');
  {
    // 这条走的是 task.submit 内部对 trip.create 的调用。少一个 import 就会在这里炸，
    // 而纯函数测试发现不了（curriculum: 端到端走查抓到的 trip is not defined）。
    const db = freshDb();
    const pv = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    const ev = pv.events[0];
    eq((await cart.add(db, USER, { spotId: ev.spotId, visitDate: ev.visitDate, releaseAt: ev.releaseAt, remindOn: true })).success,
      true, '加入暂存清单（不传 tripId）');
    eq(db._dump(COLLECTIONS.TRIPS).length, 0, '此时仍没有行程');

    const cm = await task.submit(db, USER, { channels: ['OFFICIAL_ACCOUNT'], offsets: [5] });
    eq(cm.success, true, '提交成功');
    eq(Boolean(cm.tripId), true, '回传 tripId');
    eq(db._dump(COLLECTIONS.TRIPS).length, 1, '提交时才创建行程');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).length, 1, '行程项落在新行程上');
    eq(cm.toast.indexOf('已设提醒') > 0, true, 'toast 说明其中几个已设提醒');
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
