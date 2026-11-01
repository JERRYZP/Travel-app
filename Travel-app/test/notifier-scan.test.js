/**
 * notifier 巡检查询合并 + cleanup 小时门禁测试（2026-10-13 调用量优化）
 *
 * 钉住三件事：
 *   ① 空转的一分钟只发 **1 次**数据库读（原来是 3 次：待发 / 过期 / 清理各一次）；
 *   ② 「待发段 + 过期段」合并成一次查询后，due 集合与过去两段分开查的结果逐一相同；
 *   ③ cleanup 只在整点那一分钟跑，其余分钟不跑。
 *
 * notifier/index.js 顶层 require('wx-server-sdk')，这里用 Module._load 注入桩，
 * 桩里的 database() 返回包了计数的内存库（test/mock-db.js）。
 * 运行：node test/notifier-scan.test.js
 */
const Module = require('module');
const { createDb } = require('./mock-db.js');

const origLoad = Module._load;

/* ===== 给 mock-db 的每次读操作计数（get / count）===== */
let reads = 0;
const raw = createDb();

const looksLikeQuery = (r) => r && typeof r === 'object'
  && typeof r.get === 'function' && typeof r.orderBy === 'function';

function wrapQuery(q) {
  return new Proxy(q, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return (...args) => {
        if (prop === 'get' || prop === 'count') reads += 1;
        const r = v.apply(target, args);
        return looksLikeQuery(r) ? wrapQuery(r) : r;
      };
    },
  });
}

function wrapCollection(api) {
  return new Proxy(api, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      // doc / add 不是「读」，原样透传
      if (prop === 'doc' || prop === 'add') return (...a) => v.apply(target, a);
      return (...args) => {
        if (prop === 'get' || prop === 'count') reads += 1;
        const r = v.apply(target, args);
        return looksLikeQuery(r) ? wrapQuery(r) : r;
      };
    },
  });
}

const db = {
  command: raw.command,
  collection: (name) => wrapCollection(raw.collection(name)),
};

const stub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'cloud1-test',
  database() { return db; },
  getWXContext() { return { OPENID: 'openid_test' }; },
  callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
};
Module._load = function (request) {
  if (request === 'wx-server-sdk') return stub;
  return origLoad.apply(this, arguments);
};
const { _internal, main } = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const min = 60 * 1000;
/* 两个时刻都取 UTC 整点/半点，这样 `new Date(t).getMinutes()` 在任何整小时时区下
   都得同一个分钟数 —— 测试机的 TZ 不影响结果。 */
const NOW_1030 = Date.parse('2026-10-13T10:30:00+08:00'); // UTC 02:30 → 非整点
const NOW_1000 = Date.parse('2026-10-13T10:00:00+08:00'); // UTC 02:00 → 整点

/* ⚠️ 基准时刻必须和**真实** Date.now() 对得上：`runTick(nowTs)` 注入的 nowTs 只决定
   「查询窗口 + cleanup 门禁」，而 `scanAndSend` 里 markResult 仍按真实发送时刻落库
   （这是对的 —— 它记的是「什么时候真的发了」，不是「这一轮从什么时候开始」）。
   所以凡是会走到发送路径的用例，基准都要取真实时间，否则 markResult 会把未来的任务
   当成「已过放票时刻」直接判 MISSED。 */
const taskAt = (base, id, releaseOffsetMin, extra = {}) => ({
  _id: id,
  userId: 'u1',
  tripId: 'p1',
  spotId: 'gugong',
  templateId: 'tpl_new',
  channels: ['OFFICIAL_ACCOUNT'],
  offsets: [5, 2],
  sentOffsets: [],
  backendStatus: 'WAITING',
  releaseAt: new Date(base + releaseOffsetMin * min),
  visitDate: '2026-10-20',
  ...extra,
});
const task = (id, releaseOffsetMin, extra) => taskAt(NOW_1030, id, releaseOffsetMin, extra);

function seed(tasks) {
  raw._reset();
  reads = 0;
  raw._seed('reminder_tasks', tasks);
}

(async () => {
  /* ===== ① 空转分钟只发 1 次读 ===== */
  console.log('--- ① 空转分钟 ---');
  seed([]);
  let out = await _internal.runTick(NOW_1030);
  eq(reads, 1, '空转分钟（非整点）只发 1 次数据库读');
  eq(out.cleaned, null, '非整点不跑 cleanup');
  eq(out.send.due, 0, '无到期任务');

  /* ===== ③ 整点那一分钟多跑一次 cleanup ===== */
  console.log('--- ③ 整点 cleanup ---');
  seed([]);
  out = await _internal.runTick(NOW_1000);
  eq(reads, 2, '整点分钟：1 次巡检查询 + 1 次 cleanup 查询');
  eq(Boolean(out.cleaned), true, '整点跑 cleanup');
  eq(out.cleaned.tasksRemoved, 0, '无垃圾可清');

  /* ===== ② 合并查询：过期段与待发段混在一起，due 集合不变 ===== */
  console.log('--- ② 合并查询等价性 ---');
  const LIVE = Date.now(); // 走发送路径，基准必须是真实时间（见 taskAt 上的注释）
  seed([
    taskAt(LIVE, 'up_5', 5.5),   // 5 分钟档命中，2 分钟档未到窗口
    taskAt(LIVE, 'over_1', -1),  // 已过放票时刻 → 应判 MISSED
    taskAt(LIVE, 'far_30', 30),  // 远在窗口外 → 不该被捞进来
  ]);
  out = await _internal.runTick(LIVE);

  eq(out.send.due, 1, 'due 只含 up_5 的 5 分钟档');
  eq(out.missed.marked, 1, 'over_1 被判 MISSED');

  const dumped = raw._dump('reminder_tasks');
  const byId = (id) => dumped.find(d => d._id === id);
  eq(byId('over_1').backendStatus, 'MISSED', '过期任务落库为 MISSED');
  eq(byId('far_30').backendStatus, 'WAITING', '窗口外任务不受影响');
  eq(byId('up_5').backendStatus, 'WAITING', '待发任务没被过期段连坐');
  /* 它走的是**发送路径**（失败原因是订阅通道未配置），不是被 sweepMissed 当成过期任务 ——
     这是「合并成一次查询」没有把两段的处理对象搞混的关键证据。 */
  eq(
    String(byId('up_5').lastSendError).includes('未配置'),
    true,
    '待发任务走的是发送路径（lastSendError 落在发送链路上）'
  );

  /* 与「旧的两段分开查」对照：合并后 collectDue 的输入只多了过期段，
     而过期段的 releaseAt <= now，collectDue 的 `nowTs < releaseAt` 一定为假 ——
     所以 due 集合必然与只喂待发段时相同。这里直接用纯函数再钉一次。 */
  const mixed = [
    task('a', 5.5), task('b', -1), task('c', 30), task('d', 2.5),
  ];
  const { overdue, upcoming } = _internal.splitWaiting(mixed, NOW_1030);
  eq(overdue.map(t => t._id).join(','), 'b', 'splitWaiting 正确切出过期段');
  eq(upcoming.map(t => t._id).join(','), 'a,c,d', 'splitWaiting 正确切出待发段');
  eq(
    JSON.stringify(_internal.collectDue(mixed, NOW_1030)),
    JSON.stringify(_internal.collectDue(upcoming, NOW_1030)),
    'due 集合与只喂待发段时逐一相同'
  );

  /* ===== 命中扫描上限要留日志（合并后两段共用一个上限） ===== */
  console.log('--- 扫描上限告警 ---');
  seed([task('x1', 1), task('x2', 2), task('x3', 3), task('x4', 4)]);
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  const rows = await _internal.fetchTasksPaged(
    { backendStatus: 'WAITING', releaseAt: raw.command.lte(new Date(NOW_1030 + 60 * min)) },
    { pageSize: 2, maxRows: 4 }
  );
  console.warn = origWarn;
  eq(rows.length, 4, '取到 4 条');
  eq(warns.some(w => w.includes('scan-truncated')), true, '命中上限时打 scan-truncated');

  /* ===== 定时触发器仍然按 tick 走（手动脉冲用真实时间，只验证不抛错） ===== */
  console.log('--- exports.main 兜底 ---');
  seed([]);
  const res = await main({});
  eq(res.success, true, 'main({}) 默认走 tick 且不报错');

  if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
  console.log('\nnotifier-scan.test.js 全部通过');
})();
