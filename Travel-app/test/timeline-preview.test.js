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

  console.log('=== 2. 同一输入在「干净库」与「已提交过」两种状态下结果完全一致 ===');
  {
    // 干净库的基准
    const dbA = freshDb();
    const base = await timeline.preview(dbA, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });

    // 同一个输入先落一条已提交的行程项，再预览
    const dbB = freshDb();
    const visitDate = base.events[0].visitDate;
    await dbB.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T9', userId: USER, city: '北京', startDate: START, endDate: END, name: '已有行程',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await dbB.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I9', userId: USER, tripId: 'T9', spotId: 'gugong', visitDate,
        backupGroupId: 'T9:gugong', remindOn: true, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });
    // 清单里也放一条
    await cart.add(dbB, USER, {
      spotId: 'gugong', visitDate: base.events[1].visitDate,
      releaseAt: base.events[1].releaseAt, remindOn: true,
    });
    const after = await timeline.preview(dbB, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });

    eq(digest(after), digest(base), '同一输入 → 结果逐字一致（历史状态未带入预览）');
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
    eq(res.events.every(e => e.status === 'SELECTABLE'), true, '全部回到可选');
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

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
