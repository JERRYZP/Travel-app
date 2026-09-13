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

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
