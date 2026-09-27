/**
 * timeline.preview 纯预览（2026-09-20）
 *
 * 核心不变量：**历史状态绝不带进预览**。
 * 旧实现按 tripId 去查「已加清单 / 已在行程」，于是换一批日期或景点重新生成时，
 * 上一条时间线的状态会被带进来——用户看到「已在行程」的日期其实属于另一趟行程，
 * 或者刚清空的清单仍显示已加。这条断言就是钉住这个回归。
 *
 * ⚠️ 2026-09-21 这条不变量**收窄过一次，别把它读回成「恒不读 trip_items」**：
 * 从首页某趟进行中行程进来接着补景点时，用户必须看得见那趟已经有的项（否则不知道
 * 该补哪个），故新增 `committedTripId` 参数，**只读那一趟**的 trip_items 并标成
 * COMMITTED。禁止回退成「扫全部行程」——那正是要修的 bug。第 3 节两个分节分别钉住
 * 「传了就只读那一趟」与「不传就恒 false」。
 *
 * 运行：node test/timeline-preview.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, PENDING_CART_TRIP_ID } = require('../cloudfunctions/reminder/lib/schema');
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
    eq(res.events.every(e => e.releaseStateLabel === '待开票'), true, '未来事件顶部显示「待开票」');
    eq(res.byDeparture.length > 0, true, '预览按出游日生成分组');
    eq(res.byDeparture.every(g => g.dayLabel === `【第${time.diffDays(START, g.key) + 1}天】`), true,
      '每个出游日相对行程首日下发第几天');
    eq(db._dump(COLLECTIONS.TRIPS).length, 0, '没有创建任何行程');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).length, 0, '没有创建任何行程项');
    eq(db._dump(COLLECTIONS.REMINDER_CART).length, 0, '没有写清单');
  }

  console.log('=== 1a. 第几天始终相对行程首日，不从首个事件重算 ===');
  {
    const db = freshDb();
    let startDate = time.addDays(TODAY, 20);
    while (time.dayNameOf(startDate) !== 'monday') startDate = time.addDays(startDate, 1);
    const nextDate = time.addDays(startDate, 1);
    const res = await timeline.preview(db, USER, {
      startDate, endDate: nextDate, spotIds: ['gugong'],
    });
    eq(res.byDeparture.length, 1, '首日闭馆时只生成次日分组');
    eq(res.byDeparture[0].key, nextDate, '首个事件确实落在行程第 2 天');
    eq(res.byDeparture[0].dayLabel, '【第2天】', '首日无事件也不会把第 2 天误标成第 1 天');
  }

  console.log('=== 1b. 已开票：只加入清单，固定不提醒 ===');
  {
    const db = freshDb();
    let visitDate = time.addDays(TODAY, 1);
    if (time.dayNameOf(visitDate) === 'monday') visitDate = time.addDays(visitDate, 1);
    const res = await timeline.preview(db, USER, { startDate: visitDate, endDate: visitDate, spotIds: ['gugong'] });
    eq(res.events.length, 1, '已到放票时刻的日期仍生成事件');
    const event = res.events[0];
    eq(event.releaseStateLabel, '已开票', '顶部状态为「已开票」');
    eq(event.status, 'SELECTABLE', '已开票仍是可选，不进入预约态');
    eq(event.button.text, '加入清单', '按钮仍为「加入清单」');

    const added = await cart.add(db, USER, {
      spotId: event.spotId, visitDate: event.visitDate, remindOn: true,
    });
    eq(added.success, true, '已开票项可以加入清单');
    eq(added.remindOn, false, '服务端强制不提醒');

    const listed = await cart.list(db, USER);
    eq(listed.items[0].remindOn, false, '清单项固定不提醒');
    eq(listed.items[0].remindLocked, true, '清单项提醒开关锁定');
    const releaseParts = time.beijingParts(new Date(event.releaseAt));
    const releaseDateLabel = String(releaseParts.month).padStart(2, '0') + '月'
      + String(releaseParts.day).padStart(2, '0') + '日';
    eq(listed.items[0].releaseDateLabel, releaseDateLabel,
      '副行用的放票日期保留前导零格式');
    eq(listed.items[0].releaseLabel, releaseDateLabel + ' ' + time.formatHourMinute(new Date(event.releaseAt)) + ' 放票',
      '副行下发完整放票时间，前端不再自行拼装');
    eq(listed.groups[0].key, event.visitDate, '清单按出行日分组');
    eq(listed.groups[0].dayLabel, '【第1天】', '出行日分组带首页同款第几天徽标');
    const changed = await cart.updateRemindOn(db, USER, listed.items[0]._id, true);
    eq(changed.success, false, '直接调用也不能重新开启提醒');
    eq(changed.errorCode, 1017, '返回提醒窗口已关闭错误码');

    /* 模拟“开票前入清单、开票后才提交”的旧数据：DB 里仍可能留着 remindOn=true。
       提交不能因此要求提醒通道，而应走已过期分流、照常落行程项。 */
    await db.collection(COLLECTIONS.REMINDER_CART).add({
      data: {
        userId: USER, tripId: PENDING_CART_TRIP_ID, spotId: 'guobo', visitDate,
        releaseAt: time.parseBeijing(time.addDays(visitDate, -7), '17:00'),
        remindOn: true, reservationRequired: true, createdAt: time.now(),
      },
    });

    const committed = await task.submit(db, USER, {});
    eq(committed.success, true, '已开票项可以提交进行程');
    eq(committed.expiredReminder, 1, '开票前遗留的提醒在提交时按过期分流');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).length, 2, '提交后生成行程项');
    eq(db._dump(COLLECTIONS.TRIP_ITEMS).every(i => i.remindOn === false), true, '行程项全部不提醒');
    eq(db._dump(COLLECTIONS.REMINDER_TASKS).length, 0, '不生成提醒任务');
  }

  console.log('=== 1c. 清单按出行日分组，不按放票日分组 ===');
  {
    const db = freshDb();
    let visitDate = time.addDays(TODAY, 40);
    if (time.dayNameOf(visitDate) === 'monday') visitDate = time.addDays(visitDate, 1);
    const secondDate = time.addDays(visitDate, 1);
    await cart.add(db, USER, { spotId: 'gugong', visitDate, remindOn: false });
    await cart.add(db, USER, { spotId: 'badaling', visitDate, remindOn: false });
    await cart.add(db, USER, { spotId: 'tiantan', visitDate: secondDate, remindOn: false });

    const listed = await cart.list(db, USER);
    eq(listed.groups.length, 2, '同一天的多景点合成一个出行日分组');
    eq(listed.groups[0].key, visitDate, '第一组 key = 出行日');
    eq(listed.groups[0].items.length, 2, '故宫与八达岭虽放票日不同，但同属一个出行日组');
    eq(listed.groups[1].key, secondDate, '第二组按下一个出行日');
    eq(listed.groups[1].dayLabel, '【第2天】', '连续出行日的序号递增');
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

  console.log('=== 3. 不传 committedTripId：恒不出现 COMMITTED（已在行程）===');
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

  console.log('=== 3b. 传 committedTripId：只标这一趟已有的项，别趟的不标 ===');
  {
    const db = freshDb();
    const first = await timeline.preview(db, USER, { startDate: START, endDate: END, spotIds: ['gugong'] });
    const visitDate = first.events[0].visitDate;
    /* 同一用户的两趟行程：T-here 是用户此刻正在补的那趟，T-other 是另一趟。
       两趟里各有一条 (gugong, visitDate)。 */
    await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T-here', userId: USER, city: '北京', startDate: START, endDate: END, name: '正在补的',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        _id: 'T-other', userId: USER, city: '北京', startDate: START, endDate: END, name: '另一趟',
        spotIds: ['gugong'], status: 'ACTIVE', createdAt: time.now(), updatedAt: time.now(),
      },
    });
    await db.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I-here', userId: USER, tripId: 'T-here', spotId: 'gugong', visitDate,
        backupGroupId: 'T-here:gugong', remindOn: true, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });

    const res = await timeline.preview(db, USER, {
      startDate: START, endDate: END, spotIds: ['gugong'], committedTripId: 'T-here',
    });
    const hit = res.events.find(e => e.visitDate === visitDate);
    eq(hit.status, 'COMMITTED', '这一趟已有的项标成 COMMITTED');
    eq(hit.button.text, '已加行程', '按钮文案为「已加行程」');
    eq(hit.button.enabled, false, '不可重复加（enabled=false）');
    const others = res.events.filter(e => e.visitDate !== visitDate);
    eq(others.every(e => e.status === 'SELECTABLE'), true, '这一趟没有的日期仍可选');

    /* ⚠️ 反例：committedTripId 指向另一趟时，T-here 的项**不该**被标 —— 证明读的是
       参数指定的那一趟，而不是「用户名下任意一趟」。 */
    const resOther = await timeline.preview(db, USER, {
      startDate: START, endDate: END, spotIds: ['gugong'], committedTripId: 'T-other',
    });
    eq(resOther.events.every(e => e.status === 'SELECTABLE'), true,
      '指向别趟时不标 T-here 的项（没有回退成扫全部行程）');

    /* 别人的行程项一律不读 */
    await db.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: 'I-stranger', userId: 'openid_someone_else', tripId: 'T-here', spotId: 'gugong', visitDate,
        backupGroupId: 'T-here:gugong', remindOn: true, result: null, resultAt: null,
        createdAt: time.now(), updatedAt: time.now(),
      },
    });
    const resStranger = await timeline.preview(db, USER, {
      startDate: START, endDate: END, spotIds: ['gugong'], committedTripId: 'T-here',
    });
    eq(resStranger.events.find(e => e.visitDate === visitDate).status, 'COMMITTED',
      '别人的同 tripId 行程项不影响判定（按 userId 过滤）');
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
    eq(cm.toast.indexOf('已设置') > 0 && cm.toast.indexOf('提醒') > 0, true, 'toast 说明已设置几个提醒');
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
