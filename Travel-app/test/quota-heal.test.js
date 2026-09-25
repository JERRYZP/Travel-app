/**
 * 台账自愈专项测试（2026-09-16，方案 2）
 *
 * 被测规则：任务已判 MISSED、且本地台账仍记有额度 → 把额度清零（「本地记着有额度、
 * 实际却发不出去」= 台账在骗人）。但**必须带 lastSendError 前置条件**，否则会误伤：
 *   ① 从未尝试发送（lastSendError 为空）= 定时器没建/索引缺失/云函数没部署 = 链路故障，
 *      微信侧额度依然有效，清零等于白丢用户已授权的额度；
 *   ② 失败原因是本地配置/网络（WX_APPSECRET 未配、access_token 取不到、超时），与额度无关。
 *
 * 落点三处（reminder / notifier / mock），本测试分别覆盖：
 *   - 判定规则在 reminder 与 notifier 两侧对同一组输入结果一致；
 *   - reminder 的 sweepOverdue 在 mock-db 上的真实写库行为（清零 / 保留 / 幂等）；
 *   - mock.js 镜像的「保额度」分支（不能误清）。
 *
 * 运行：node test/quota-heal.test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/reminder/lib/schema');
const quota = require('../cloudfunctions/reminder/lib/quota');
const task = require('../cloudfunctions/reminder/lib/task');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* notifier 顶层 require('wx-server-sdk')，本地无该依赖，注入最小 stub */
const origLoad = Module._load;
const sdkStub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'cloud1-test',
  database() { return { command: {} }; },
  getWXContext() { return { OPENID: 'openid_test' }; },
  callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
};
Module._load = function (request) {
  if (request === 'wx-server-sdk') return sdkStub;
  return origLoad.apply(this, arguments);
};
const { _internal } = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

const TPL = quota.DEFAULT_SUBSCRIBE_TEMPLATE_ID;
const USER = 'openid_quota_heal';
const PAST = new Date(Date.now() - 3600 * 1000);
const FUTURE = new Date(Date.now() + 3600 * 1000);

/** 造一个「已过放票时刻仍是 WAITING」的任务 */
function overdueTask(id, lastSendError) {
  const t = {
    _id: id, userId: USER, spotId: 'gugong', visitDate: '2026-10-01',
    releaseAt: PAST, offsets: [5], channels: ['OFFICIAL_ACCOUNT'],
    backendStatus: 'WAITING', sentOffsets: [],
  };
  if (lastSendError !== undefined) t.lastSendError = lastSendError;
  return t;
}

/** 造一个已过期的 WAITING 任务 + 台账 5 次，跑一次 task.list（会触发 sweepOverdue） */
async function runSweep(taskDoc) {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, require('../data/spots.json').spots);
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_1', openId: USER,
    subscribeQuota: 5, subscribeQuotas: { [TPL]: 5 },
  }]);
  db._seed(COLLECTIONS.REMINDER_TASKS, [taskDoc]);
  await task.list(db, USER, {});
  const user = db._dump(COLLECTIONS.USERS)[0];
  const saved = db._dump(COLLECTIONS.REMINDER_TASKS).find(t => t._id === taskDoc._id);
  return { db, user, saved, quota: quota.subscribeQuotaOf(user, TPL) };
}

/* ============================================================
 * 1. 判定规则：reminder 与 notifier 两侧对同一组输入必须一致
 * ============================================================ */
function ruleParity() {
  console.log('=== 1. shouldHealQuota 判定（reminder 侧 vs notifier 侧）===');
  const cases = [
    [undefined, false, '无 lastSendError（从未尝试发送 = 链路故障）'],
    ['', false, '空字符串'],
    ['   ', false, '纯空白'],
    ['WX_APPID/WX_APPSECRET 未配置，订阅消息通道不可用', false, '本地配置缺失'],
    ['TEMPLATE_ID 未配置（附录 D 第 3 条待回填）', false, '模板未配置'],
    ['access_token 获取失败', false, 'token 链路问题'],
    ['请求超时', false, '传输超时'],
    ['network error timeout', false, '英文超时（大小写不敏感）'],
    ['empty response', false, '微信返回空包'],
    ['errCode=47003 参数错误', true, '微信侧拒绝（非额度问题也不留假额度）'],
    ['errCode=40037 template_id 不属于该 AppID', true, '模板归属错误'],
    ['errCode=43101 用户未订阅', true, '额度耗尽'],
  ];
  for (const [input, want, label] of cases) {
    const a = quota.shouldHealQuota(input);
    const b = _internal.shouldHealQuota(input);
    eq(a, want, `reminder: ${label}`);
    eq(b, want, `notifier: ${label}`);
    if (a !== b) { fail += 1; console.log('FAIL 两侧判定不一致:', label); }
  }
}

/* ============================================================
 * 2. reminder 侧 sweepOverdue 的真实写库行为
 * ============================================================ */
async function reminderSweep() {
  console.log('\n=== 2. reminder 侧 sweepOverdue（读时兜底 + 台账自愈）===');

  // 2.1 确实发过且失败原因非本地问题 → 清零
  let r = await runSweep(overdueTask('t_heal', 'errCode=47003 参数错误'));
  eq(r.quota, 0, '台账 5 → 0（已过期未送达，台账在骗人）');
  eq(r.user.subscribeAutoZeroCount, 1, '累计自愈次数 +1');
  eq(/台账自愈清零/.test(r.user.subscribeLastError || ''), true, '记录自愈原因（可排障）');
  eq(r.saved.backendStatus, 'MISSED', '任务仍被补判为 MISSED');
  eq(r.saved.missedReason, 'errCode=47003 参数错误', 'missedReason 保留真实失败原因');

  // 2.2 从未尝试发送（无 lastSendError）→ 不清零（链路故障，额度其实还在）
  r = await runSweep(overdueTask('t_link'));
  eq(r.quota, 5, '额度保留 5（从未尝试发送 = 链路故障，不能白丢）');
  eq(r.user.subscribeAutoZeroCount, undefined, '未记录自愈次数');
  eq(r.saved.backendStatus, 'MISSED', '任务照样补判为 MISSED（状态收敛不受影响）');
  eq(r.saved.missedReason, '超过放票时间点未触发成功', '退回笼统文案');

  // 2.3 失败原因是本地配置 → 不清零
  r = await runSweep(overdueTask('t_cfg', 'WX_APPID/WX_APPSECRET 未配置，订阅消息通道不可用'));
  eq(r.quota, 5, '额度保留 5（配置问题与额度无关，修好配置照样能用）');
  eq(r.saved.backendStatus, 'MISSED', '任务照样补判为 MISSED');

  // 2.4 任务还没过期（releaseAt 未来）→ 既不改状态也不清零
  const futureTask = { ...overdueTask('t_future', 'errCode=47003 参数错误'), releaseAt: FUTURE };
  r = await runSweep(futureTask);
  eq(r.quota, 5, '额度保留 5（任务还没过期，谈不上 MISSED）');
  eq(r.saved.backendStatus, 'WAITING', '未来任务状态不动');

  // 2.5 幂等：台账已是 0 时不重复清零、不刷计数
  {
    const db = createDb();
    db._seed(COLLECTIONS.SPOTS, require('../data/spots.json').spots);
    db._seed(COLLECTIONS.USERS, [{
      _id: 'user_2', openId: USER, subscribeQuota: 0, subscribeQuotas: { [TPL]: 0 },
      subscribeAutoZeroCount: 4,
    }]);
    db._seed(COLLECTIONS.REMINDER_TASKS, [overdueTask('t_idem', 'errCode=47003 参数错误')]);
    await task.list(db, USER, {});
    await task.list(db, USER, {});
    const u = db._dump(COLLECTIONS.USERS)[0];
    eq(u.subscribeAutoZeroCount, 4, '台账已为 0 → 不重复自愈，计数不变（幂等）');
  }
}

/* ============================================================
 * 3. mock.js 镜像：不能误清额度
 * ============================================================ */
async function mockMirror() {
  console.log('\n=== 3. mock.js 镜像（保额度分支）===');
  const mock = require('../miniprogram/utils/mock.js');
  const MTPL = 'mock-mirror-template';

  await mock.mockCall('subscribe.add', { templateId: MTPL });
  await mock.mockCall('subscribe.add', { templateId: MTPL });
  await mock.mockCall('subscribe.add', { templateId: MTPL });
  let got = await mock.mockCall('subscribe.get', { templateId: MTPL });
  eq(got.quota, 3, 'mock 台账 3 次');

  /* 造一条已过期未送达的任务（mock 的 task 不带 lastSendError = 从未尝试发送）。
     ⚠️ 2026-09-23 起不能再拿「releaseAt 已过」的清单项提交来造它了 —— 那种项现在
        根本不建任务（提交即凭空生成一条失败提醒的闸门，见 lib/task.js）。
        改走**真实成因**：正常提交（放票时刻在未来）建出任务，再把那条任务的 releaseAt
        拨到过去，模拟「任务建好之后时间流逝、而 notifier 从没跑过」—— 这正是链路故障
        的原始场景，也正是本用例要覆盖的那一档。 */
  const pad = n => String(n).padStart(2, '0');
  const bj = new Date(Date.now() + 8 * 3600000);
  const visitBj = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 30));
  const visit = visitBj.getUTCFullYear() + '-' + pad(visitBj.getUTCMonth() + 1) + '-' + pad(visitBj.getUTCDate());

  await mock.mockCall('cart.add', {
    tripId: 'mock-trip-heal', spotId: 'gugong', visitDate: visit,
    releaseAt: new Date(Date.now() + 20 * 86400000), remindOn: true,
  });
  await mock.mockCall('cart.commit', {
    tripId: 'mock-trip-heal', channels: ['OFFICIAL_ACCOUNT'], offsets: [5],
  });
  const taskRows = Object.values(mock.__internals.db.tasks);
  eq(taskRows.length >= 1, true, '正常提交仍建出任务（闸门只挡放票已过的那类）');
  taskRows.forEach(t => { t.releaseAt = new Date(Date.now() - 3600 * 1000); });

  const listed = await mock.mockCall('task.list', { filter: 'expired' });
  eq(listed.counts.expired >= 1, true, 'mock 里确实有已过期任务');

  got = await mock.mockCall('subscribe.get', { templateId: MTPL });
  eq(got.quota, 3, 'mock 额度保留 3（无 lastSendError → 不误清）');
}

/* ============================================================
 * 4. 三份 LOCAL_FAILURE_HINTS 必须逐字一致
 * ============================================================ */
function hintListParity() {
  console.log('\n=== 4. 三份关键词清单一致性 ===');
  const files = {
    reminder: 'cloudfunctions/reminder/lib/quota.js',
    notifier: 'cloudfunctions/notifier/index.js',
    mock: 'miniprogram/utils/mock.js',
  };
  const parsed = {};
  for (const [key, rel] of Object.entries(files)) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const m = src.match(/const LOCAL_FAILURE_HINTS = (?:Object\.freeze\()?\[([^\]]*)\]/);
    eq(Boolean(m), true, `${key} 里能找到 LOCAL_FAILURE_HINTS`);
    if (!m) continue;
    parsed[key] = m[1]
      .replace(/\/\/[^\n]*/g, '')            // 去掉行内注释（quota.js 那份带说明）
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .sort();
  }
  const keys = Object.keys(parsed);
  for (let i = 1; i < keys.length; i += 1) {
    eq(parsed[keys[i]].join('|'), parsed[keys[0]].join('|'),
      `${keys[i]} 的关键词清单与 ${keys[0]} 一致`);
  }
  eq(parsed.reminder.includes('未配置'), true, '清单含「未配置」');
  eq(parsed.reminder.includes('timeout'), true, '清单含「timeout」');
}

(async () => {
  ruleParity();
  await reminderSweep();
  await mockMirror();
  hintListParity();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
