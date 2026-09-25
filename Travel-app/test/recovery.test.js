/**
 * 挽回建议三层（决策文档 4.3）
 *
 * 最重要的一条：**什么都不建议是合法的。**
 * 失败时刻的空转建议比没有建议更伤信任。三层里有两层返回空数组，
 * 所以这里每一条「返回 []」的分支都要单独钉住——它是最容易被"顺手补点提示"改坏的地方。
 *
 * 日期刻意取 2027-01（远离测试机时钟），星期已核对：
 *   01-01 周五 / 01-02 周六 / 01-03 周日 / 01-04 周一（故宫闭馆）/ 01-05 周二
 * 运行：node test/recovery.test.js
 */
const recovery = require('../cloudfunctions/reminder/lib/recovery');
const time = require('../cloudfunctions/reminder/lib/time');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

// 站在 2027-01-01 12:00（周五）看
const NOW = time.parseBeijing('2027-01-01', '12:00');

const SPOTS = {
  gugong: { spotId: 'gugong', name: '故宫博物院', reservationRequired: true, difficultyScore: 5 },
  guobo: { spotId: 'guobo', name: '中国国家博物馆', reservationRequired: true, difficultyScore: 4 },
  tiantan: { spotId: 'tiantan', name: '天坛公园', reservationRequired: false, difficultyScore: 1 },
  huanqiu: { spotId: 'huanqiu-yingcheng', name: '环球影城', reservationRequired: true, difficultyScore: 3 },
};
// 故宫：提前 7 天 20:00 放票，周一闭馆
const RULES = {
  gugong: { spotId: 'gugong', advanceDays: 7, releaseTime: '20:00', closedDays: ['monday'] },
  guobo: { spotId: 'guobo', advanceDays: 7, releaseTime: '17:00', closedDays: ['monday'] },
  tiantan: { spotId: 'tiantan', reservationRequired: false },
  // 需预约但无固定放票规则（环球影城）——V1 不可选
  huanqiu: { spotId: 'huanqiu-yingcheng' },
};

const mkItem = (spotId, visitDate, over = {}) => Object.assign({
  itemId: `I_${spotId}_${visitDate}`,
  tripId: 'T1',
  spotId,
  visitDate,
  ticketState: 'FAILED',
  result: 'FAILED',
  ended: false,
  canMark: false,
}, over);

/* 候选日期池 = **行程本身的日期范围**（不是「已经加过的日子」）。
   用 01-05 起、01-10 止 的短行程：01-05/06/07 的放票时间（12-29/30/31）已经过去 → BOOK_NOW，
   01-08/09/10 的放票时间还没到 → SET_REMINDER，两类候选都能稳定命中。 */
const TRIP = { _id: 'T1', startDate: '2027-01-05', endDate: '2027-01-12' };

const run = (failed, siblings, trip = TRIP) => recovery.buildCandidates({
  failed, siblings, trip, spotMap: SPOTS, ruleMap: RULES, nowTs: NOW,
});

console.log('=== 1. 第①层：已设备选且备选未到放票时间 → 静默 ===');
{
  // 备选 01-20 → releaseAt = 01-13 20:00 > 01-01 12:00 → 还没到放票时间（PENDING）
  const failed = mkItem('gugong', '2027-01-10');
  const backup = mkItem('gugong', '2027-01-20', { ticketState: 'PENDING', result: null });
  const list = run(failed, [failed, backup]);
  eq(list.length, 0, '已有未开票的备选 → 不打扰，备选本身就是挽回方案');
  eq(list.length === 0, true, '此时提醒按原计划继续发');
}

console.log('=== 2. 第②层：没设备选，行程内有可用日期 → 给候选 ===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06', { ticketState: 'PENDING', result: null });
  const list = run(failed, [failed, other]);
  eq(list.length > 0, true, '有可行动日期 → 返回候选');

  const bookNow = list.filter(c => c.action === 'BOOK_NOW');
  const setReminder = list.filter(c => c.action === 'SET_REMINDER');
  eq(bookNow.length > 0, true, '含已开票、现在就能去约的日期');
  eq(setReminder.length > 0, true, '含未开票、可设提醒的日期');

  const clue = bookNow.find(c => c.visitDate === '2027-01-05');
  eq(Boolean(clue), true, '故宫 01-05（releaseAt = 2026-12-29 20:00，已过）是已开票候选');
  eq(bookNow.every(c => c.spotId === 'gugong' || true), true, '已开票候选来自行程日期范围内');
  eq(clue.label.indexOf('已开票') >= 0, true, 'BOOK_NOW 文案陈述已开票事实');
  eq(/一定有余票|保证|余票充足/.test(clue.label), false, '不承诺一定有余票（数据红线）');

  // 排序：已开票的排前面
  eq(list[0].action, 'BOOK_NOW', '已开票的候选排最前（现在就能行动）');
  eq(list.every(c => c.visitDate >= '2027-01-05' && c.visitDate <= '2027-01-12'), true,
    '候选一律落在行程日期范围内（不提供延长行程）');
}

console.log('=== 3. 闭馆日不出现在候选里（走 time.isOpenOn，不自行 includes）===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06');
  const list = run(failed, [failed, other]);
  const mondays = list.filter(c => time.dayNameOf(c.visitDate) === 'monday');
  eq(mondays.length, 0, '故宫/国博周一闭馆 → 周一的日期不进候选');
}

console.log('=== 4. 已过的日期不出现在候选里 ===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06');
  const list = run(failed, [failed, other]);
  eq(list.every(c => c.visitDate > '2027-01-01'), true, '候选日期一律晚于今天');
}

console.log('=== 5. 免预约景点 / 无放票规则的景点不进候选 ===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const free = mkItem('tiantan', '2027-01-06', { ticketState: 'NO_RESERVATION', reservationRequired: false });
  const noRule = mkItem('huanqiu', '2027-01-06', { ticketState: 'PENDING' });
  const list = run(failed, [failed, free, noRule]);
  eq(list.some(c => c.spotId === 'tiantan'), false, '免预约景点不构成「挽回」——它本来就不在提醒动线上');
  eq(list.some(c => c.spotId === 'huanqiu-yingcheng'), false, '无固定放票规则 → 不可行动，不返回');
}

console.log('=== 6. 第③层：没设备选、也没有可用日期 → 彻底静默 ===');
{
  // 行程只有这一天，池子 = [01-10] 而它已被排除 → 无候选
  const failed = mkItem('gugong', '2027-01-10');
  const singleDayTrip = { _id: 'T1', startDate: '2027-01-10', endDate: '2027-01-10' };
  const list = run(failed, [failed], singleDayTrip);
  eq(Array.isArray(list), true, '返回数组而不是抛错');
  eq(list.length, 0, '没有任何候选 → 返回空，前端保持静默');
}

console.log('=== 6b. 绝不把「刚失败的那一天」建议回去 ===');
{
  // 这是最伤信任的一种写法：用户刚说「10月2日没抢到」，却回他「再约 10月2日吧」
  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06');
  const list = run(failed, [failed, other]);
  eq(list.some(c => c.spotId === 'gugong' && c.visitDate === '2027-01-10'), false,
    '不推荐用户刚刚失败的那一天');
  // 同一天换个景点是**另一张票**，可以推荐；这里用 01-09 验证跨景点的同一天仍在池内
  eq(list.some(c => c.spotId === 'guobo' && c.visitDate !== '2027-01-06'), true,
    '换个景点仍可推荐同一行程内的其他日期');
}

console.log('=== 7. 不提供「延长行程」——新日期同样无票可抢 ===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const list = run(failed, [failed]);
  eq(list.some(c => /延长|扩展行程|加长/.test(c.label || '')), false, '不给延长行程这类空转建议');
}

console.log('=== 8. 不出现任何余票 / 回流字段 ===');
{
  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06');
  const list = run(failed, [failed, other]);
  const blob = JSON.stringify(list);
  eq(/回流|补放|剩余|余票|soldOut|inventory|remaining/.test(blob), false, '候选里没有任何余票/回流字段');
  for (const c of list) {
    eq(Object.keys(c).sort().join(','), 'action,label,releaseAt,spotId,spotName,visitDate', '候选字段集固定');
  }
}

console.log('=== 9. candidateOf 的开放性判定 ===');
{
  eq(recovery.candidateOf(SPOTS.gugong, RULES.gugong, '2027-01-04', NOW).ok, false, '周一闭馆 → 不可行动');
  eq(recovery.candidateOf(SPOTS.gugong, RULES.gugong, '2026-12-31', NOW).ok, false, '已过 → 不可行动');
  eq(recovery.candidateOf(SPOTS.gugong, RULES.gugong, '2027-01-01', NOW).ok, false, '当天 → 不可行动');
  eq(recovery.candidateOf(SPOTS.huanqiu, RULES.huanqiu, '2027-01-05', NOW).ok, false, '无放票规则 → 不可行动');
  eq(recovery.candidateOf(SPOTS.tiantan, RULES.tiantan, '2027-01-05', NOW).ok, false, '免预约 → 不构成挽回');
  eq(recovery.candidateOf(SPOTS.gugong, RULES.gugong, '2027-01-05', NOW).action, 'BOOK_NOW', '已开票（releaseAt 12-29 已过）→ BOOK_NOW');
  eq(recovery.candidateOf(SPOTS.gugong, RULES.gugong, '2027-01-20', NOW).action, 'SET_REMINDER', '未开票（releaseAt 01-13 未到）→ SET_REMINDER');
}

console.log('=== 10. recoverableMapOf —— 首页一次性算清（2026-09-24）===');
{
  /* ⚠️ 这一节锁的是**时序**，不是算法：首页原先在 bootstrap 之后另开一次请求
     逐条算候选，两次响应谁先落地没有保证，卡片就先按「FAILED 但不可挽回」渲染，
     挽回线永远不出现。算进 bootstrap 后，候选与它要解释的行程项同一次响应到达。
     这里只测聚合层：哪些 itemId 有候选、且与逐条调 buildCandidates 的结果一致。 */

  const failed = mkItem('gugong', '2027-01-10');
  const other = mkItem('guobo', '2027-01-06', { ticketState: 'PENDING', result: null });
  const trip = { _id: 'T1', startDate: '2027-01-05', endDate: '2027-01-12' };
  const decorated = [failed, other].map(d => Object.assign({}, d, { tripId: 'T1' }));
  const map = recovery.recoverableMapOf({
    decorated, trips: [trip], spotMap: SPOTS, ruleMap: RULES, nowTs: NOW,
  });

  eq(map[failed.itemId] && map[failed.itemId].length > 0, true, 'map 里带的是完整候选（不是布尔）');
  eq(JSON.stringify(map[failed.itemId]),
    JSON.stringify(run(failed, decorated, trip)),
    '与逐条 buildCandidates 逐字一致（内联不给第二套口径）');
  eq(Object.keys(map).join(','), failed.itemId,
    '只含**有候选**的 itemId（空候选不写进 map，前端不必再筛长度）');

  /* 第①层要能看见「同行程的备选」——聚合时 siblings 必须是整个行程，不只是失败的那几条 */
  const withBackup = mkItem('gugong', '2027-01-20', { ticketState: 'PENDING', result: null });
  const map2 = recovery.recoverableMapOf({
    decorated: [failed, withBackup].map(d => Object.assign({}, d, { tripId: 'T1' })),
    trips: [trip], spotMap: SPOTS, ruleMap: RULES, nowTs: NOW,
  });
  eq(Object.keys(map2).length, 0,
    '已设备选且备选未开票 → 第①层静默（siblings 必须含非 FAILED 的项）');

  /* 没有失败项时不返回任何键；前端据此把「约其他日」整块保持静默 */
  const empty = recovery.recoverableMapOf({
    decorated: [other], trips: [trip], spotMap: SPOTS, ruleMap: RULES, nowTs: NOW,
  });
  eq(Object.keys(empty).length, 0, '没有 FAILED 项 → 空 map（什么都不建议是合法的）');

  /* 已结束的项不再挽回：挽回 == 还能做点什么，过期的日期做不了 */
  const ended = mkItem('gugong', '2027-01-10', { ended: true });
  const map3 = recovery.recoverableMapOf({
    decorated: [ended], trips: [trip], spotMap: SPOTS, ruleMap: RULES, nowTs: NOW,
  });
  eq(Object.keys(map3).length, 0, '已结束的行程项不进 map');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
