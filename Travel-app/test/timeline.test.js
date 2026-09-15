/**
 * 时间线交叉积测试（TIMELINE-RULE-001/003/005 改版后）
 * 用真实 data/*.json 验证。运行：node test/timeline.test.js
 */
const TL = require('../cloudfunctions/reminder/lib/timeline.js');
const time = require('../cloudfunctions/reminder/lib/time.js');
const { EventSelectStatus, ReleaseStatus } = require('../cloudfunctions/reminder/lib/schema.js');

const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;
const rm = {}; rules.forEach(r => { rm[r.spotId] = r; });
const sm = {}; spots.forEach(s => { sm[s.spotId] = s; });

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const trip = { startDate: '2026-05-31', endDate: '2026-06-04' }; // 5天，6/1 是周一

console.log('--- 交叉积总数 ---');
// 本文件直接对需预约景点做纯函数断言；B 层免预约加入链路由 trip-items.test.js 覆盖。
const reserveSpots = spots.filter(s => s.reservationRequired !== false);
const all = reserveSpots.flatMap(s => TL.buildEvents(s, rm[s.spotId], trip));
// 规则形态计数（改数据时从这里看出影响面，避免总数断言变成黑盒）
const whitelist = rules.filter(r => (r.openDays || []).length > 0);
console.log(`   周一闭馆规则 ${rules.filter(r => (r.closedDays || []).includes('monday')).length} 条；周末白名单规则 ${whitelist.length} 条`);
eq(
  rules.filter(r => (r.closedDays || []).includes('monday')).length,
  15,
  '15 个规则 closedDays 含 monday（北大已改为 openDays 白名单，不在其中）'
);
eq(
  whitelist.map(r => r.spotId).sort().join(','),
  'peking-university',
  '仅北大用 openDays 白名单（清华只有周一闭馆，2026-09-11 用户核实）'
);
eq(all.length, 71, '总事件 = 3 个全年开放×5 + 12 个周一闭馆×4 + 考古馆(周一+周二)×3 + 天文馆(仅周二)×4 + 北大(仅周末，5/31~6/4 只命中周日)×1 − 环球影城(无放票时刻不生成) = 71');

console.log('\n--- 故宫：周一闭馆，5 天里 4 条 ---');
const gg = TL.buildEvents(sm.gugong, rm.gugong, trip);
eq(gg.length, 4, '故宫 4 条');
eq(gg.map(e => e.visitDate).join(','), '2026-05-31,2026-06-02,2026-06-03,2026-06-04', '跳过 6/1');
eq(gg.map(e => e.releaseDateStr).join(','), '2026-05-24,2026-05-26,2026-05-27,2026-05-28', '各自提前 7 天');
eq(gg.every(e => time.formatHourMinute(e.releaseAt) === '20:00'), true, '全部 20:00 放票');

console.log('\n--- 清华：唯一限制是周一闭馆（2026-09-11 用户核实，非周末白名单）---');
const th = TL.buildEvents(sm.tsinghua, rm.tsinghua, trip);
eq(th.length, 4, '清华 4 条（5/31~6/4 只跳过周一）');
eq(th.map(e => e.visitDate).join(','), '2026-05-31,2026-06-02,2026-06-03,2026-06-04', '跳过 6/1 周一');
eq(th.every(e => time.dayNameOf(e.visitDate) !== 'monday'), true, '无事件落在周一');
eq(time.formatHourMinute(th[0].releaseAt), '08:00', '08:00 放票');
eq(th[0].releaseDateStr, '2026-05-24', '5/31 票提前 7 天');
eq(time.isOpenOn(rm.tsinghua, 'wednesday'), true, '清华周三可约（工作日不禁约）');

console.log('\n--- openDays 白名单优先于 closedDays（北大：closedDays 也含 monday，被接管）---');
eq(TL.buildEvents(sm['peking-university'], rm['peking-university'], trip).length, 1, '北大 1 条（仅周末）');
// 同时命中时以白名单为准，不能叠加出空集
eq(whitelist.every(r => (r.openDays || []).length > 0), true, '白名单规则均已带 openDays');
eq(time.isOpenOn({ closedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], openDays: ['saturday', 'sunday'] }, 'saturday'), true, '黑名单+白名单不叠加，白名单胜出');
eq(time.isOpenOn(rm.tsinghua, 'monday'), false, '清华周一闭馆');
eq(time.isOpenOn(rm.gugong, 'monday'), false, '故宫周一闭馆（纯黑名单仍生效）');
eq(time.isOpenOn(rm.gugong, 'tuesday'), true, '故宫周二可约');
eq(time.isOpenOn({}, 'monday'), true, '无规则字段 → 全年开放');
eq(time.isOpenOn(rm['renmin-dahuitang'], 'monday'), false, '人民大会堂周一闭馆（2026-09-11 校正）');
eq(time.isOpenOn(rm['renmin-dahuitang'], 'tuesday'), true, '人民大会堂周二可约');

console.log('\n--- 出发日视图：6/1 只剩部分景点（周一闭馆 + 白名单景点剔除）---');
const byDep = TL.groupByDeparture(all);
eq(byDep.length, 5, '5 个日期 Tab');
eq(byDep.map(g => g.count).join(','), '18,4,15,17,17', '各 Tab 事件数（6/1 周一仅剩 4 个全年开放景点；6/2 周二考古馆闭馆）');
eq(byDep[1].key, '2026-06-01', '第 2 个 Tab 是 6/1');
eq(byDep[1].label, '6月1日 (周一)', 'Tab 标签');
console.log('   6/1 可约:', byDep[1].events.map(e => e.spotName).join('、'));
eq(byDep[1].events.every(e => time.isOpenOn(rm[e.spotId], 'monday')), true, '6/1 无不可约景点（闭馆日与周末白名单都按 isOpenOn 判定）');
eq(byDep[0].events.every((e, i, a) => i === 0 || a[i - 1].releaseAt <= e.releaseAt), true, '组内 releaseAt 升序');

console.log('\n--- 景点视图：故宫 Tab 显示 4 天 ---');
const bySpot = TL.groupBySpot(all);
eq(bySpot.length, 18, '18 个生成事件的需预约景点 Tab（孔庙转免预约、环球影城/无放票时刻不生成事件）');
const ggTab = bySpot.find(g => g.key === 'gugong');
eq(ggTab.count, 4, '故宫 Tab 4 条');
eq(ggTab.label, '故宫博物院', 'Tab 标签用景点名');
console.log('   故宫各日放票:', ggTab.events.map(e => `${e.releaseDateStr} ${e.releaseTimeStr}`).join(' | '));

console.log('\n--- 每个 Tab 独立 scrollIndex（UI-006）---');
eq(typeof byDep[0].scrollIndex, 'number', '出发日 Tab 有 scrollIndex');
eq(typeof ggTab.scrollIndex, 'number', '景点 Tab 有 scrollIndex');

console.log('\n--- 全闭馆景点不生成事件（TIMELINE-RULE-005）---');
const monOnly = { startDate: '2026-06-01', endDate: '2026-06-01' };
eq(TL.buildEvents(sm.gugong, rm.gugong, monOnly).length, 0, '仅周一行程 → 故宫 0 条');
eq(TL.buildEvents(sm.badaling, rm.badaling, monOnly).length, 1, '八达岭 1 条');

console.log('\n--- 按钮态（TIMELINE-RULE-004 / STATE-003）---');
const future = { releaseAt: new Date(Date.now() + 86400000) };
const past = { releaseAt: new Date(Date.now() - 86400000) };
eq(TL.resolveStatus(future, {}), EventSelectStatus.SELECTABLE, '未放票 → SELECTABLE');
eq(TL.resolveStatus(future, { inCart: true }), EventSelectStatus.IN_CART, '在清单 → IN_CART');
eq(TL.resolveStatus(future, { task: { backendStatus: 'WAITING' } }), EventSelectStatus.WAITING, '已提交 → WAITING');
eq(TL.resolveStatus(past, {}), EventSelectStatus.BOOKABLE, '已放票 → BOOKABLE');
eq(TL.resolveStatus(past, { releaseStatus: ReleaseStatus.FULL }), EventSelectStatus.FULL, '约满 → FULL');
eq(TL.buttonOf(EventSelectStatus.FULL).enabled, false, '已约满置灰');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
