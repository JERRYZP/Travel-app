/**
 * 六状态推导边界（ENUM-007 / STATE-004）
 *
 * 纯函数测试：状态推导是首页的全部语义所在，且 §8.1 规定了**计算顺序**，
 * 顺序错了语义就反了（例如「放票前」判在「人工结果」之前，
 * 已标记「抢到了」的项会在某个时刻被翻回「待抢」）。
 * 运行：node test/trip-item-state.test.js
 */
const item = require('../cloudfunctions/reminder/lib/item');
const time = require('../cloudfunctions/reminder/lib/time');
const { TicketState, V1 } = require('../cloudfunctions/reminder/lib/schema');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const NOW = time.parseBeijing('2026-10-01', '12:00');
const HOUR = 3600 * 1000;
const releaseBefore = (h) => new Date(NOW.getTime() - h * HOUR);
const releaseAfter = (h) => new Date(NOW.getTime() + h * HOUR);

const stateOf = (p) => item.ticketStateOf({ nowTs: NOW, ...p });

console.log('=== 1. 免预约优先于一切 ===');
// 免预约项即使有 result 也是 NO_RESERVATION——它本来就没有票务结果这回事
eq(stateOf({ item: { result: 'SUCCESS' }, reservationRequired: false, releaseAt: null }),
  TicketState.NO_RESERVATION, '免预约项即使用户标记过，仍是免预约态');
eq(stateOf({ item: null, reservationRequired: false, releaseAt: releaseBefore(100) }),
  TicketState.NO_RESERVATION, '免预约项不受放票时间影响');

console.log('=== 2. 放票前 → 待抢 ===');
eq(stateOf({ item: null, reservationRequired: true, releaseAt: releaseAfter(1) }),
  TicketState.PENDING, '还没到放票时间 → 待抢');
eq(stateOf({ item: null, reservationRequired: true, releaseAt: NOW }),
  TicketState.BOOKABLE, '恰好到点 → 可抢（passedMs = 0）');

console.log('=== 3. 放票后 24 小时内 → 可抢；之后 → 待确认 ===');
eq(stateOf({ item: null, reservationRequired: true, releaseAt: releaseBefore(1) }),
  TicketState.BOOKABLE, '刚开票 1 小时 → 可抢');
eq(stateOf({ item: null, reservationRequired: true, releaseAt: releaseBefore(V1.UNMARKED_AFTER_HOURS) }),
  TicketState.BOOKABLE, '恰好 24 小时 → 仍在可抢窗口（闭区间）');
eq(stateOf({ item: null, reservationRequired: true, releaseAt: releaseBefore(V1.UNMARKED_AFTER_HOURS + 1) }),
  TicketState.UNMARKED, '超过 24 小时 → UNMARKED（展示为待确认）');
/* ⚠️ 2026-09-22 六个展示态**整体换词**（按设计稿）：待抢→待抢票、可抢→可抢票、
   已成→已约到、未成→未抢到、开过票了→未标记；2026-09-28 UNMARKED 展示为「待确认」。
   换的是**文案不是语义**——UNMARKED 仍然是中性态，不代表「未抢到」。 */
eq(item.ticketStateLabelOf(TicketState.UNMARKED), '待确认', 'UNMARKED 文案是中性态，不叫「未抢到」');

console.log('=== 4. 人工结果覆盖时间态（这是计算顺序的关键） ===');
eq(stateOf({ item: { result: 'SUCCESS' }, reservationRequired: true, releaseAt: releaseAfter(10) }),
  TicketState.SUCCESS, '已标记「抢到了」不因尚未到放票时间而翻回待抢');
eq(stateOf({ item: { result: 'SUCCESS' }, reservationRequired: true, releaseAt: releaseBefore(100) }),
  TicketState.SUCCESS, '已标记「抢到了」不因超过 24 小时而变成待确认');
eq(stateOf({ item: { result: 'FAILED' }, reservationRequired: true, releaseAt: releaseBefore(100) }),
  TicketState.FAILED, '已标记「没抢到」稳定保持');
eq(item.ticketStateLabelOf(TicketState.SUCCESS), '已约到', 'SUCCESS 文案');
eq(item.ticketStateLabelOf(TicketState.FAILED), '未抢到', 'FAILED 文案');
/* 兜底值最容易漏改，而它的症状正是「文案改了一半」——补上，别只靠肉眼 */
eq(item.ticketStateLabelOf('WHATEVER'), '待抢票', '未知态兜底也是新文案');

console.log('=== 5. 无放票时刻的需预约景点 ===');
// 环球影城这类「需预约但无固定放票规则」：不算免预约，但也没有可抢的时刻
eq(stateOf({ item: null, reservationRequired: true, releaseAt: null }),
  TicketState.PENDING, '无放票规则 → 待抢（还没有可抢的时间点）');
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.PENDING, reservationRequired: true, visitDate: '2099-01-01', nowTs: NOW }),
  true, '无放票规则但仍需预约 → 预约入口照常可点');

console.log('=== 6. 预约入口不因进入待确认或标记失败而消失 ===');
// 决策文档 3.2：入口一消失，用户会以为「没救了」
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.UNMARKED, reservationRequired: true, visitDate: '2099-01-01', nowTs: NOW }),
  true, '待确认态仍保留官方预约入口');
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.FAILED, reservationRequired: true, visitDate: '2099-01-01', nowTs: NOW }),
  true, '标记「没抢到」后预约入口不消失');
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.SUCCESS, reservationRequired: true, visitDate: '2099-01-01', nowTs: NOW }),
  true, '已成也保留查看/复制官方入口');
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.NO_RESERVATION, reservationRequired: false, visitDate: '2099-01-01', nowTs: NOW }),
  false, '免预约项没有预约入口');
eq(item.bookingEntryEnabledOf({ ticketState: TicketState.BOOKABLE, reservationRequired: true, visitDate: '2026-09-30', nowTs: NOW }),
  false, '出行日已过 → 入口关闭');

console.log('=== 7. canMarkResult：开票前不问结果 ===');
eq(item.canMarkResult({ item: null, reservationRequired: true, releaseAt: releaseBefore(1), visitDate: '2026-10-05', nowTs: NOW }),
  true, '已开票且未标记 → 可标记');
eq(item.canMarkResult({ item: null, reservationRequired: true, releaseAt: releaseAfter(1), visitDate: '2026-10-05', nowTs: NOW }),
  false, '开票前不给标记入口');
eq(item.canMarkResult({ item: { result: 'SUCCESS' }, reservationRequired: true, releaseAt: releaseBefore(1), visitDate: '2026-10-05', nowTs: NOW }),
  false, '已标记过不可重复标记');
eq(item.canMarkResult({ item: null, reservationRequired: false, releaseAt: null, visitDate: '2026-10-05', nowTs: NOW }),
  false, '免预约项没有票务结果可言');
eq(item.canMarkResult({ item: null, reservationRequired: true, releaseAt: releaseBefore(1), visitDate: '2026-09-30', nowTs: NOW }),
  false, '出行日已过 → 结束标记入口');

console.log('=== 8. 提醒送达态与票务态分离 ===');
const missTask = { backendStatus: 'WAITING', releaseAt: releaseBefore(1), lastSendError: 'errCode=43101', channels: ['OFFICIAL_ACCOUNT'], offsets: [5] };
const r = item.reminderStateOf(missTask, { remindOn: true, nowTs: NOW });
eq(r.state, 'MISSED', '过期仍是 WAITING → 读取时收敛为未送达');
eq(r.reason, 'errCode=43101', '优先用真实失败原因，不用笼统文案');
eq(item.reminderStateOf(missTask, { remindOn: false, nowTs: NOW }).state, 'NOT_SET', '没设提醒 → NOT_SET');
eq(item.reminderStateOf(null, { remindOn: true, nowTs: NOW }).state, 'NOT_SET', '设了提醒但任务不存在 → NOT_SET');
eq(item.reminderStateOf({ backendStatus: 'TRIGGERED', releaseAt: releaseBefore(1) }, { remindOn: true, nowTs: NOW }).state,
  'TRIGGERED', '已送达');
eq(item.reminderStateOf({ backendStatus: 'WAITING', releaseAt: releaseAfter(1) }, { remindOn: true, nowTs: NOW }).state,
  'WAITING', '未到点 → 待提醒');

console.log('=== 9. 撤销窗口 ===');
eq(V1.RESULT_UNDO_SECONDS, 4, '撤销窗口 4 秒');
const markedAt = new Date(NOW.getTime() - 3000);
eq(item.undoUntilOf({ resultAt: markedAt }).getTime() - markedAt.getTime(), 4000, 'undoUntil = resultAt + 4s');
eq(item.undoUntilOf({ resultAt: null }), null, '未记录结果 → 无撤销截止时刻');

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
