/**
 * 提醒授权额度健康度。
 * 运行：node test/reminder-health.test.js
 */
const path = require('path');
const task = require(path.join(__dirname, '..', 'cloudfunctions/reminder/lib/task.js'));

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const NOW = new Date('2026-09-26T04:00:00.000Z'); // 北京时间 12:00
const hoursLater = h => new Date(NOW.getTime() + h * 3600000);
const taskAt = (releaseAt, offsets = [5, 2], sentOffsets = []) => ({
  _id: 'T1',
  backendStatus: 'WAITING',
  releaseAt,
  offsets,
  sentOffsets,
});

console.log('=== 1. 五档额度健康度（保留 1 次安全缓冲）===');
const pendingTwo = [taskAt(hoursLater(24), [5, 2])];
eq(task.reminderHealthOf(pendingTwo, 0, NOW).level, 'exhausted', '0 次授权、2 条待发送 → 已用完');
eq(task.reminderHealthOf(pendingTwo, 0, NOW).replenishNeeded, 3, '补到待发送数 + 1');
eq(task.reminderHealthOf(pendingTwo, 1, NOW).level, 'short', '授权少于待发送 → 不足');
eq(task.reminderHealthOf(pendingTwo, 1, NOW).shortfall, 1, '缺口 = 待发送 - 已授权');
eq(task.reminderHealthOf(pendingTwo, 2, NOW).level, 'low', '刚好够但无缓冲 → 即将用完');
eq(task.reminderHealthOf(pendingTwo, 2, NOW).replenishNeeded, 1, '缓冲缺口为 1');
eq(task.reminderHealthOf(pendingTwo, 3, NOW).level, 'ready', '待发送 + 1 缓冲 → 充足');
eq(task.reminderHealthOf([], 0, NOW).level, 'idle', '没有待发送提醒 → idle');

console.log('\n=== 2. 只计算未发送 offset，且排除过期任务 ===');
const partiallySent = task.reminderHealthOf([taskAt(hoursLater(24), [5, 2], [5])], 1, NOW);
eq(partiallySent.pendingMessageCount, 1, '已发送 offset 不重复占额度');
eq(partiallySent.nearestRemindAt.getTime(), hoursLater(24).getTime() - 2 * 60000, '最近提醒时间按 offset 计算');
const expired = task.reminderHealthOf([taskAt(hoursLater(-1), [5, 2])], 0, NOW);
eq(expired.pendingMessageCount, 0, '过期 WAITING 不进入额度需求');

console.log('\n=== 3. 首页只提示 48 小时内的真实缺口 ===');
const soonWarning = task.buildReminderQuotaWarning(
  task.reminderHealthOf([taskAt(hoursLater(24), [5])], 0, NOW),
  NOW
);
eq(soonWarning && soonWarning.level, 'exhausted', '24 小时内 → 显示预警');
eq(/未来提醒可能收不到/.test(soonWarning.text), true, '耗尽文案明确可能收不到');
const farWarning = task.buildReminderQuotaWarning(
  task.reminderHealthOf([taskAt(hoursLater(72), [5])], 0, NOW),
  NOW
);
eq(farWarning, null, '72 小时后 → 首页不提前告警');
const lowWarning = task.buildReminderQuotaWarning(
  task.reminderHealthOf([taskAt(hoursLater(12), [5])], 1, NOW),
  NOW
);
eq(lowWarning.level, 'low', '刚好够但无缓冲 → low');
eq(/建议续收 1 次/.test(lowWarning.text), true, 'low 文案给出明确动作');

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
