/**
 * notifier 纯逻辑测试：collectDue（时间窗命中/去重）+ staggerDelays（错峰分布）
 *
 * notifier/index.js 顶层 require('wx-server-sdk')，本地无该依赖，
 * 这里用 Module._load 注入最小 stub，仅用于加载模块、调用其 _internal 纯函数。
 * 运行：node test/notifier.test.js
 */
const Module = require('module');

const origLoad = Module._load;
const stub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'cloud1-test',
  database() { return { command: {} }; },
  getWXContext() { return { OPENID: 'openid_test' }; },
  callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
};
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return stub;
  return origLoad.apply(this, arguments);
};

const { _internal } = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

const SCAN_WINDOW_MS = 60 * 1000; // 与 notifier 内部一致

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const NOW = Date.parse('2026-08-30T12:00:00+08:00');
// offset 以分钟计，五分钟后放票
const min = 60 * 1000;
const task = (id, releaseOffsetMin, sentOffsets = []) => ({
  _id: id,
  spotId: 'gugong',
  releaseAt: new Date(NOW + releaseOffsetMin * min),
  offsets: [5, 2],
  sentOffsets,
  backendStatus: 'WAITING',
});

console.log('--- collectDue 时间窗 ---');
// releaseAt = now + 5.5min：5 分钟提前量 → remindAt = now+30s（应命中），2 分钟 → now+210s（不命中）
let due = _internal.collectDue([task('t1', 5.5)], NOW);
eq(due.length, 1, '5.5min 只命中 5 分钟 offset');
eq(due[0].offset, 5, '命中 offset=5');

// releaseAt = now + 6.5min：5 分钟提前量 remindAt = now+90s，超出 60s 窗口，全部不命中
due = _internal.collectDue([task('t2', 6.5)], NOW);
eq(due.length, 0, '6.5min 全部未到窗口');

// releaseAt = now + 2.5min：两档都命中（5min→now-2.5min，2min→now+0.5min），按 remindAt 排序
due = _internal.collectDue([task('t3', 2.5)], NOW);
eq(due.length, 2, '2.5min 两档都命中');
eq(due[0].offset, 5, '先发 5 分钟档（已过其提醒时刻）');
eq(due[1].offset, 2, '再发 2 分钟档');

console.log('--- collectDue 去重（已发 offset 不重发） ---');
due = _internal.collectDue([task('t4', 2.5, [5])], NOW);
eq(due.length, 1, 'sentOffsets=[5] 只留 2 分钟档');

console.log('--- staggerDelays 错峰 ---');
eq(JSON.stringify(_internal.staggerDelays(1)), '[0]', '单条无延迟');
const d5 = _internal.staggerDelays(5);
eq(d5.length, 5, '5 条错误分布');
eq(d5[4] < 30000, true, '最晚一次仍在 30s 窗口内');
eq(d5.every((v, i) => i === 0 || v >= d5[i - 1]), true, '延迟单调非递减');

console.log('--- 预约开始提醒模板数据 ---');
eq(_internal.TEMPLATE_ID, '_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA', '默认模板切换为「预约开始提醒」');
const messageData = _internal.buildSubscribeData({
  templateId: _internal.DEFAULT_TEMPLATE_ID,
  spotName: '故宫博物院',
  releaseAt: new Date('2026-10-01T20:00:00+08:00'),
  visitDate: '2026-10-08',
  offset: 5,
});
eq(messageData.thing1.value, '故宫博物院', 'thing1 预约门票显示景点名称');
eq(messageData.time2.value, '2026-10-01 20:00', 'time2 开始时间使用放票时间');
eq(messageData.thing3.value, '预约即将在5分钟后开启', 'thing3 温馨提示不需要“请注意查看”');
eq(messageData.time5.value, '2026年10月8日', 'time5 预约日期使用出行日期');
eq(_internal.templateIdOfTask({}), _internal.LEGACY_TEMPLATE_ID, '旧任务没有 templateId → 继续使用旧模板');
eq(_internal.templateIdOfTask({ templateId: _internal.DEFAULT_TEMPLATE_ID }), _internal.DEFAULT_TEMPLATE_ID,
  '新任务写入 templateId → 使用新模板');
const legacyData = _internal.buildSubscribeData({
  templateId: _internal.LEGACY_TEMPLATE_ID,
  spotName: '故宫博物院',
  releaseAt: new Date('2026-10-01T20:00:00+08:00'),
  visitDate: '2026-10-08',
  offset: 5,
});
eq(legacyData.thing4.value, '故宫博物院', '旧模板继续使用 thing4 活动名称字段');
eq(legacyData.date5.value, '2026-10-01 20:00', '旧模板继续使用 date5 时间字段');
eq(legacyData.thing7.value, '5分钟后放票，记得备好游客信息', '旧模板继续使用旧提示语');

console.log('--- spotLandingPage 订阅消息落地页 ---');
// 订阅消息只能寻址「页面路径 + ?查询串」，浮窗是页面内状态，靠 spotId 让首页自己弹。
eq(_internal.spotLandingPage('gugong'), 'pages/home/home?spotId=gugong', '带景点落首页并带 spotId');
eq(_internal.spotLandingPage(''), 'pages/home/home', '空 spotId 退回裸首页');
eq(_internal.spotLandingPage(undefined), 'pages/home/home', 'undefined 退回裸首页');
eq(_internal.spotLandingPage('a&b=c'), 'pages/home/home?spotId=a%26b%3Dc', 'spotId 做 URL 编码');

// 源码级：发送路径必须真的用上它，防止改回硬编码裸首页（同 quota-heal 的比对手法）
const notifierSrc = require('fs').readFileSync(
  require('path').join(__dirname, '../cloudfunctions/notifier/index.js'), 'utf8');
eq(notifierSrc.includes('page: spotLandingPage(task.spotId)'), true,
  'sendOne 的 page 由 spotLandingPage 产出');
eq(/const templateId = templateIdOfTask\(task\)/.test(notifierSrc), true,
  'sendOne 按任务自己的 templateId 选择模板');
eq(/consumeSubscribeQuota\(task\.userId, templateId\)/.test(notifierSrc), true,
  '发送成功按任务模板核销额度');
eq(/invalidateSubscribeQuota\(task\.userId, templateId, errCode, errMsg\)/.test(notifierSrc), true,
  '43101 按任务模板清零额度');

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
