/**
 * 门票进度口径（8.2 / STATE-004）
 *
 * 分母是**去重后的预约需求组**（backupGroupId），不是提醒条数、也不是行程项条数。
 * 这个口径错了会很难看：故宫 10月2日 + 10月3日 两条备选会被算成 0/2，
 * 用户抢到一天仍看到「没做完」，进度就变成噪音。
 * 运行：node test/trip-progress.test.js
 */
const item = require('../cloudfunctions/reminder/lib/item');
const tripItem = require('../cloudfunctions/reminder/lib/trip-item');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const eqObj = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);

const mk = (spotId, visitDate, over = {}) => Object.assign({
  tripId: 'T1',
  spotId,
  visitDate,
  backupGroupId: tripItem.backupGroupIdOf('T1', spotId),
  reservationRequired: true,
  result: null,
}, over);

console.log('=== 1. 同一景点多备选日期只算一个需求 ===');
eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02'),
  mk('gugong', '2026-10-03'),
]), { done: 0, total: 1, noReservationCount: 0 }, '故宫两个备选日 = 1 个需求组');

eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02', { result: 'SUCCESS' }),
  mk('gugong', '2026-10-03'),
]), { done: 1, total: 1, noReservationCount: 0 }, '任意一个备选日抢到 = 该需求计入搞定数');

eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02', { result: 'FAILED' }),
  mk('gugong', '2026-10-03', { result: 'SUCCESS' }),
]), { done: 1, total: 1, noReservationCount: 0 }, '标记失败的那天不阻断另一天成功');

console.log('=== 2. 免预约项不进分母，单独计数 ===');
eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02'),
  mk('tiantan', '2026-10-03', { reservationRequired: false }),
]), { done: 0, total: 1, noReservationCount: 1 }, '免预约项另起一行统计');

eqObj(item.backupGroupProgress([
  mk('tiantan', '2026-10-03', { reservationRequired: false }),
  mk('beihai', '2026-10-04', { reservationRequired: false }),
]), { done: 0, total: 0, noReservationCount: 2 }, '全是免预约 → 分母为 0，不应显示 0/0 的假进度');

console.log('=== 3. 未设提醒但需预约的景点仍进分母 ===');
// 否则进度会伪装成已完成：用户没设提醒，但那张票他照样得自己去抢
eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02', { remindOn: false }),
]), { done: 0, total: 1, noReservationCount: 0 }, '未设提醒 ≠ 不用管');

console.log('=== 4. 多景点跨行程 ===');
eqObj(item.backupGroupProgress([
  mk('gugong', '2026-10-02', { tripId: 'T1', backupGroupId: 'T1:gugong' }),
  mk('gugong', '2026-10-09', { tripId: 'T2', backupGroupId: 'T2:gugong', result: 'SUCCESS' }),
]), { done: 1, total: 2, noReservationCount: 0 }, '不同行程的同一景点是两个需求组');

eqObj(item.backupGroupProgress([]), { done: 0, total: 0, noReservationCount: 0 }, '空行程项');
eqObj(item.backupGroupProgress(null), { done: 0, total: 0, noReservationCount: 0 }, 'null 输入不炸');

console.log('=== 5. 缺 backupGroupId 的老数据按 tripId:spotId 回退 ===');
eqObj(item.backupGroupProgress([
  { tripId: 'T1', spotId: 'gugong', visitDate: '2026-10-02', reservationRequired: true, result: null },
  { tripId: 'T1', spotId: 'gugong', visitDate: '2026-10-03', reservationRequired: true, result: null },
]), { done: 0, total: 1, noReservationCount: 0 }, '缺字段时仍能正确归组');

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
