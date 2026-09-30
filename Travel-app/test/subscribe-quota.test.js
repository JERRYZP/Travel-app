/**
 * 订阅消息额度专项测试（2026-09-16）
 *
 * 钉住一条业务公式，防止再次退化：
 *
 *     本次提交所需额度 = 「将设提醒的清单项数」× 「提前量个数」
 *
 * 由来（三处代码共同决定，缺一不可）：
 *   - `reminder/lib/cart.js` 的 summarize → summary.reminderCount = 勾了提醒的项数
 *   - `reminder/lib/task.js` 的 submit   → 每个「需预约且勾提醒」的项建 1 条任务
 *   - `notifier/index.js` 的 collectDue → 每条任务对每个 offset 各发 1 条消息
 *
 * ⚠️ 历史 bug（2026-09-16 修正）：`pages/setup` 曾只传 `offsets.length`，
 *    清单里 6 个景点时也只补 1 条额度，导致第 2 条起全部 43101「未送达」，
 *    用户看到「剩余次数还有」但提醒实际收不到。故此处双向钉死：
 *    云端「真实消耗条数」与前端「补齐条数」必须一致。
 *
 * 运行：node test/subscribe-quota.test.js
 */
const Module = require('module');
const path = require('path');

const { createDb } = require('./mock-db');
const { COLLECTIONS, ChannelType } = require('../cloudfunctions/reminder/lib/schema');
const trip = require('../cloudfunctions/reminder/lib/trip');
const cart = require('../cloudfunctions/reminder/lib/cart');
const task = require('../cloudfunctions/reminder/lib/task');
const time = require('../cloudfunctions/reminder/lib/time');

const spotsSeed = require('../data/spots.json').spots;
const rulesSeed = require('../data/rules.json').rules;

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* ============================================================
 * 模块加载桩：notifier 需要 wx-server-sdk，notify.js 需要 ./api.js
 * ============================================================ */
const apiStub = {
  quota: 0,
  health: {},
  quotaFails: false,
  addCalls: 0,
  addGate: null,
  reminder: {
    subscribe: {
      add() {
        apiStub.addCalls += 1;
        const complete = () => {
          apiStub.quota += 1;
          return { success: true };
        };
        return apiStub.addGate ? apiStub.addGate.then(complete) : Promise.resolve(complete());
      },
      get() {
        if (apiStub.quotaFails) return Promise.reject({ success: false });
        return Promise.resolve(Object.assign({
          success: true,
          quota: apiStub.quota,
          totalQuota: apiStub.quota,
        }, apiStub.health));
      },
    },
  },
};

const wxState = {
  setting: { authSetting: {}, subscriptionsSetting: { mainSwitch: true, itemSettings: {} } },
  getSettingFails: false,
  subscribeCalls: 0,
  subscribeValue: 'accept',   // 可为字符串或 (tpl) => value
  subscribeFail: null,
  storage: {},                // 本地 storage 桩（hintKeepAlwaysChoice 用）
  storageFails: false,
  modalCalls: [],
  rememberAfterAccept: false,
  rememberAfterGetSettingCalls: 0,
  getSettingCalls: 0,
};
global.wx = {
  getSetting({ success, fail }) {
    wxState.getSettingCalls += 1;
    if (wxState.getSettingFails) { if (fail) fail({}); return; }
    if (wxState.rememberAfterGetSettingCalls
        && wxState.getSettingCalls >= wxState.rememberAfterGetSettingCalls) {
      wxState.setting.subscriptionsSetting.itemSettings[TPL] = 'accept';
    }
    if (success) success(JSON.parse(JSON.stringify(wxState.setting)));
  },
  requestSubscribeMessage({ tmplIds, success, fail }) {
    wxState.subscribeCalls += 1;
    if (wxState.subscribeFail) { if (fail) fail(wxState.subscribeFail); return; }
    const tpl = tmplIds[0];
    const value = typeof wxState.subscribeValue === 'function'
      ? wxState.subscribeValue(tpl) : wxState.subscribeValue;
    if (success) success({ [tpl]: value });
    if (wxState.rememberAfterAccept && value === 'accept') {
      wxState.setting.subscriptionsSetting.itemSettings[tpl] = 'accept';
    }
  },
  getAppAuthorizeSetting() {
    return { notificationAuthorized: 'authorized', notificationEnabled: true };
  },
  getStorageSync(key) {
    if (wxState.storageFails) throw new Error('storage unavailable');
    return wxState.storage[key];
  },
  setStorageSync(key, value) {
    if (wxState.storageFails) throw new Error('storage unavailable');
    wxState.storage[key] = value;
  },
  showModal(opts) { wxState.modalCalls.push(opts || {}); },
  openSetting() {},
};

const origLoad = Module._load;
const sdkStub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'cloud1-test',
  database() { return { command: {} }; },
  getWXContext() { return { OPENID: 'openid_test' }; },
  callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
};
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return sdkStub;
  // notify.js 内的 require('./api.js') → 用桩替换，避免触发 mock.js / wx.cloud
  if (request === './api.js' && parent && parent.filename.endsWith(`${path.sep}utils${path.sep}notify.js`)) {
    return apiStub;
  }
  return origLoad.apply(this, arguments);
};
const notify = require('../miniprogram/utils/notify.js');
const { _internal } = require('../cloudfunctions/notifier/index.js');
Module._load = origLoad;

const TPL = notify.SUBSCRIBE_TEMPLATE_ID;

/** 连发之间有 120ms 间隔，测试里把 setTimeout 变成立即执行（否则 50 连发要跑 6 秒） */
async function withInstantTimers(fn) {
  const real = global.setTimeout;
  global.setTimeout = (cb) => { cb(); return 0; };
  try { return await fn(); } finally { global.setTimeout = real; }
}

function resetWx({
  remembered,
  value = 'accept',
  getSettingFails = false,
  subscribeFail = null,
  rememberAfterAccept = false,
  rememberAfterGetSettingCalls = 0,
} = {}) {
  wxState.getSettingFails = getSettingFails;
  wxState.subscribeCalls = 0;
  wxState.subscribeValue = value;
  wxState.subscribeFail = subscribeFail;
  wxState.rememberAfterAccept = rememberAfterAccept;
  wxState.rememberAfterGetSettingCalls = rememberAfterGetSettingCalls;
  wxState.getSettingCalls = 0;
  wxState.setting = {
    authSetting: {},
    subscriptionsSetting: {
      mainSwitch: true,
      itemSettings: remembered ? { [TPL]: remembered } : {},
    },
  };
}

function resetApi({ quota = 0, quotaFails = false } = {}) {
  apiStub.quota = quota;
  apiStub.quotaFails = quotaFails;
  apiStub.addCalls = 0;
  apiStub.addGate = null;
}

/* ============================================================
 * 1. 云端真实消耗条数（公式的右半边）
 * ============================================================ */
async function cloudConsumption() {
  console.log('=== 1. 云端真实消耗：任务数 = 勾提醒项数，消息数 = 任务数 × 提前量数 ===');

  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spotsSeed);
  db._seed(COLLECTIONS.RELEASE_RULES, rulesSeed);

  const USER = 'openid_subscribe_quota';
  const start = time.addDays(time.todayStr(), 30);
  const t = await trip.create(db, USER, {
    startDate: start,
    endDate: time.addDays(start, 3),
    spotIds: ['gugong', 'guobo', 'badaling', 'tiantan'],
  });

  /* 本节只关心「额度 = 项数 × 提前量数」这条公式，夹具需要的是
     「两档提醒时刻都落在 collectDue 的扫描窗内」这个时间条件。

     ⚠️ 放票时刻**直接拨任务的钟**，别再从 `cart.add` 传 releaseAt 想影响它：
     任务的 releaseAt 由 `visitDate − advanceDays` 推导（`lib/item.deriveReleaseAt`，
     与行程项、时间线同一真身），`cart.add` 收到的 releaseAt 已被忽略（2026-09-24）。
     拨钟既不影响被测公式，也不依赖任何真实规则值。 */
  const releaseAt = new Date(Date.now() + 2.5 * 60 * 1000);
  const visitDate = time.addDays(start, 1);
  const addOpts = { tripId: t.tripId, visitDate };

  // 需预约 + 勾提醒 × 2
  await cart.add(db, USER, { ...addOpts, spotId: 'gugong', remindOn: true });
  await cart.add(db, USER, { ...addOpts, spotId: 'guobo', remindOn: true });
  // 需预约但未勾提醒 × 1（不该产生任务）
  await cart.add(db, USER, { ...addOpts, spotId: 'badaling', remindOn: false });
  // 免预约 × 1（不该产生任务）
  await cart.add(db, USER, { tripId: t.tripId, visitDate, releaseAt: null, spotId: 'tiantan', remindOn: false });

  const listed = await cart.list(db, USER, t.tripId);
  eq(listed.summary.count, 4, '清单共 4 项');
  eq(listed.summary.reminderCount, 2, '将设提醒 = 2 项（免预约项与未勾项不计）');

  const OFFSETS = [5, 2];
  const committed = await task.submit(db, USER, {
    tripId: t.tripId,
    channels: [ChannelType.OFFICIAL_ACCOUNT],
    offsets: OFFSETS,
  });
  eq(committed.success, true, '提交成功');
  eq(committed.createdTasks, listed.summary.reminderCount, '任务数 = 将设提醒项数（不是 offsets 条数）');

  const tasks = db._dump(COLLECTIONS.REMINDER_TASKS);
  eq(tasks.length, 2, '库中 2 条任务');
  await Promise.all(tasks.map(x =>
    db.collection(COLLECTIONS.REMINDER_TASKS).doc(x._id).update({ data: { releaseAt } })));
  const due = _internal.collectDue(db._dump(COLLECTIONS.REMINDER_TASKS), Date.now());
  eq(due.length, listed.summary.reminderCount * OFFSETS.length, '待发消息数 = 项数 × 提前量数 = 2 × 2 = 4');
  eq(new Set(due.map(d => d.task._id)).size, 2, '每条任务各发 2 条（5 分钟档 + 2 分钟档）');

  console.log('   → 结论：本次提交必须备足', listed.summary.reminderCount * OFFSETS.length, '条订阅额度');
}

/* ============================================================
 * 2. 前端按缺口补齐（公式的左半边）
 * ============================================================ */
async function frontendGapFill() {
  console.log('\n=== 2. requestSubscribe：一次用户动作只申请 1 条额度 ===');

  // 已勾「总是保持」→ 本次静默，但仍然只增加 1 条额度
  resetWx({ remembered: 'accept' });
  resetApi();
  let r = await withInstantTimers(() => notify.requestSubscribeBurst(3));
  eq(wxState.subscribeCalls, 1, '已勾「总是保持」也只调用 1 次');
  eq(r.added, 1, '本次只拿到 1 条额度');
  eq(r.silent, true, '本次静默，无确认弹窗');
  eq(r.remembered, true, '已记住允许');
  eq(r.shortfall, 2, '剩余 2 条必须由后续用户动作补齐');
  eq(r.ok, true, '本次授权成功');

  // 未勾 → 只调 1 次，绝不连环弹窗
  resetWx({ remembered: null });
  resetApi();
  r = await withInstantTimers(() => notify.requestSubscribeBurst(3));
  eq(wxState.subscribeCalls, 1, '未勾「总是保持」→ 只弹 1 次');
  eq(r.added, 1, '只拿到 1 条额度');
  eq(r.silent, false, '本次是弹窗路径');
  eq(r.remembered, false, '未勾选总是保持时不冒充已记住');
  eq(r.shortfall, 2, '缺口如实上报 2 条');

  // 云端入账必须先完成，调用方随后的 subscribe.get 才不会读到旧余额
  resetWx({ remembered: null });
  resetApi();
  let releaseAdd;
  apiStub.addGate = new Promise(resolve => { releaseAdd = resolve; });
  let burstDone = false;
  const pendingBurst = withInstantTimers(() => notify.requestSubscribeBurst(1))
    .then(value => { burstDone = true; return value; });
  await Promise.resolve();
  eq(burstDone, false, '云端额度落账前不提前返回成功');
  releaseAdd();
  r = await pendingBurst;
  eq(r.ok, true, '额度落账完成后返回成功');
  eq(apiStub.quota, 1, '云端真实余额已增加');

  // 云端落账失败不能谎报补齐成功
  resetWx({ remembered: null });
  resetApi();
  apiStub.addGate = Promise.reject(new Error('ledger unavailable'));
  r = await withInstantTimers(() => notify.requestSubscribeBurst(1));
  eq(r.ok, false, '云端入账失败时不标记补齐成功');
  eq(r.added, 0, '入账失败不计入新增额度');
  eq(r.reason, 'account-failed', '向上游返回明确入账失败原因');

  // 记住的是「拒绝」→ 一次都不该调
  resetWx({ remembered: 'reject' });
  resetApi();
  r = await withInstantTimers(() => notify.requestSubscribeBurst(3));
  eq(wxState.subscribeCalls, 0, '记住「拒绝」→ 不发起调用');
  eq(r.called, false, '未发起调用');
  eq(r.reason, 'subscription-disabled', '原因是订阅被拒收');
  eq(r.shortfall, 3, '缺口 = 全部需求');

  // acceptWithAudio（同时勾了语音提醒）也算允许，不能当失败
  resetWx({ remembered: 'accept' });
  resetApi();
  r = await withInstantTimers(() => notify.requestSubscribeBurst(1, TPL));
  eq(wxState.subscribeValue, 'accept', '默认返回 accept');
  resetWx({ remembered: 'accept', value: 'acceptWithAudio' });
  resetApi();
  r = await withInstantTimers(() => notify.requestSubscribeBurst(1, TPL));
  eq(r.ok, true, 'acceptWithAudio 计为授权成功');
  eq(r.added, 1, 'acceptWithAudio 计入额度');
  eq(apiStub.addCalls, 1, 'acceptWithAudio 也上报云端 +1');

  // 20004：订阅消息总开关关闭
  resetWx({ remembered: 'accept', subscribeFail: { errCode: 20004 } });
  resetApi();
  r = await withInstantTimers(() => notify.requestSubscribeBurst(1, TPL));
  eq(r.reason, 'master-switch-off', '20004 → 总开关关闭，需引导去设置页');

  console.log('\n=== 3. ensureSubscribe：额度够就不调用，不够才按缺口补 ===');

  // 额度足够 → 既不弹也不调用
  resetWx({ remembered: null });
  resetApi({ quota: 6 });
  r = await notify.ensureSubscribe(6);
  eq(r.called, false, '额度足够 → 不发起调用');
  eq(wxState.subscribeCalls, 0, '一次都没弹');
  eq(r.shortfall, 0, '无缺口');

  // 额度为 0 + 已勾「总是保持」→ 本次静默 +1，剩余缺口如实返回
  resetWx({ remembered: 'accept' });
  resetApi({ quota: 0 });
  r = await withInstantTimers(() => notify.ensureSubscribe(6));
  eq(wxState.subscribeCalls, 1, '缺口 6 仍只申请 1 条');
  eq(r.added, 1, '本次增加 1 条');
  eq(r.shortfall, 5, '剩余 5 条留给后续用户动作');
  eq(r.remembered, true, '静默路径');

  // 额度只剩 2 → 本次仍只申请 1 条
  resetWx({ remembered: 'accept' });
  resetApi({ quota: 2 });
  r = await withInstantTimers(() => notify.ensureSubscribe(6));
  eq(wxState.subscribeCalls, 1, '一次用户动作只申请 1 条');
  eq(r.added, 1, '新增 1 条');
  eq(r.shortfall, 3, '剩余缺口为 3 条');

  // 额度为 0 + 未勾 → 只弹 1 次，缺口上报给页面
  resetWx({ remembered: null });
  resetApi({ quota: 0 });
  r = await withInstantTimers(() => notify.ensureSubscribe(6));
  eq(wxState.subscribeCalls, 1, '未勾「总是保持」→ 只弹 1 次');
  eq(r.added, 1, '只补到 1 条');
  eq(r.shortfall, 5, '缺口 5 条上报页面提示用户');

  // 台账查询失败 → 按 0 处理，仍尝试补齐（不能因为查询失败就跳过授权）
  resetWx({ remembered: 'accept' });
  resetApi({ quotaFails: true });
  r = await withInstantTimers(() => notify.ensureSubscribe(2));
  eq(wxState.subscribeCalls, 1, '台账查询失败 → 仍只申请 1 条');
  eq(r.shortfall, 1, '剩余缺口如实返回');

  // getSetting 失败 → 按「未勾」处理，仍只弹 1 次
  resetWx({ remembered: null, getSettingFails: true });
  resetApi({ quota: 0 });
  r = await withInstantTimers(() => notify.ensureSubscribe(3));
  eq(wxState.subscribeCalls, 1, 'getSetting 失败 → 退化为只弹 1 次');
  eq(r.shortfall, 2, '缺口如实上报');

  /* 统一健康状态：权限 + 额度 + 未来待发送量只在一个函数里汇总。 */
  apiStub.quota = 1;
  apiStub.health = {
    pendingMessageCount: 2,
    level: 'short',
    shortfall: 1,
    replenishNeeded: 2,
  };
  resetWx({ remembered: 'accept' });
  const health = await notify.getReminderHealth(TPL);
  eq(health.permissionState, 'all', '权限两项齐全');
  eq(health.quotaLevel, 'short', '保留服务端额度等级');
  eq(health.pendingMessageCount, 2, '返回未来待发送数');
  eq(health.replenishNeeded, 2, '返回建议补齐目标次数（仍需逐次授权）');
  apiStub.health = {};
}

/* ============================================================
 * 4. 前后端口径一致性（跨端 pin）
 * ============================================================ */
function crossCheck() {
  console.log('\n=== 4. 口径一致性 ===');
  const setupSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'pages', 'setup', 'setup.js'), 'utf8');
  const notifySrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'utils', 'notify.js'), 'utf8');
  eq(/reminderCount \* this\.data\.offsets\.length/.test(setupSrc), true, 'setup 按清单提醒数与提前量数算需求量');
  eq(/count \* taskCount/.test(notifySrc), true, '需求量 = 项数 × 提前量数');
  eq(/requestSubscribeBurst\(1\)/.test(setupSrc), true,
    'setup 每次用户点击只申请 1 条授权');

  const mockSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'utils', 'mock.js'), 'utf8');
  eq(/reminderCount/.test(mockSrc), true, 'mock.js 镜像返回 summary.reminderCount');

  /* 方案 3：文案是「已授权」不是「可提醒」——「可提醒 N 次」是对送达的承诺，
     而本地台账只是推测值，写「可提醒」会在发不出去时让用户以为已覆盖。
     标签只写状态（已授权），次数放说明行；说明行必须用客户语言，不出现「本地记账」
     这类技术/产品侧词汇（2026-09-16 用户反馈：客户完全不懂这些概念） */
  const settingsSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'pages', 'notify-settings', 'notify-settings.js'), 'utf8');
  eq(/notify\.getReminderHealth/.test(settingsSrc), true, '设置页读取统一提醒健康状态');
  eq(/onReplenish\(\)/.test(settingsSrc), true, '历史批量入口保留但不再一次补多');
  eq(/可提醒 \$\{q\.quota\}|quotaLabel: hasQuota \? `可提醒/.test(settingsSrc), false, '标签不再出现「可提醒 N 次」');
  eq(/hintKeepAlwaysChoice/.test(settingsSrc), true, '续收成功后接上「总是保持」引导');
  eq(/未弹窗/.test(settingsSrc), false, '成功提示不暴露「未弹窗」等实现细节');

  const profileSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'pages', 'profile', 'profile.js'), 'utf8');
  const profileWxml = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'pages', 'profile', 'profile.wxml'), 'utf8');
  eq(/notification|notificationAuthorized/.test(profileSrc), false, '我的页不自行重推系统通知状态');
  eq(/getReminderHealth/.test(profileSrc), true, '我的页使用统一提醒健康状态');
  eq(/setting-row-label">提醒设置/.test(profileWxml), true, '我的页入口更名为「提醒设置」');

  const settingsWxml = require('fs').readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'pages', 'notify-settings', 'notify-settings.wxml'), 'utf8');
  eq(/navbar-title">提醒设置/.test(settingsWxml), true, '设置页标题为「提醒设置」');
  eq(/auth-health-summary/.test(settingsWxml), true, '设置页展示动态授权摘要');
  eq(/一键补齐/.test(settingsWxml), false, '不展示一次授权 N 次的批量入口');
  eq(/bindtap="onRequestSubscribe"[\s\S]*补授权次数\+1/.test(settingsWxml), true, '按钮文案为「补授权次数+1」');
  eq(/bindtap="onOpenSubscribeSetting"[\s\S]*微信授权设置/.test(settingsWxml), true, '保留「微信授权设置」');
  eq(/auth-icon-green"><svg-icon name="chat-bubble"/.test(settingsWxml), true,
    '微信通知权限使用绿色微信气泡图标');
  eq(/auth-icon-warm"><svg-icon name="bell-fill4"/.test(settingsWxml), true,
    '放票提醒使用暖色新铃铛图标');
  eq(/本地记账|微信侧余额不可查/.test(settingsWxml), false, '不再出现「本地记账 / 微信侧余额不可查」等技术侧词汇');
  eq(/总是保持以上选择/.test(settingsWxml), true, 'tips 里给出勾选引导');
}

/* ============================================================
 * 5. 「总是保持以上选择」引导（方案 1：一次性成本换永久安静）
 * ============================================================ */
function keepChoiceHint() {
  console.log('\n=== 5. hintKeepAlwaysChoice：一辈子只提示一次 ===');
  const key = notify.KEEP_HINT_KEY_PREFIX + TPL;

  wxState.storage = {};
  wxState.storageFails = false;
  wxState.modalCalls = [];

  // 第一次（用户刚经历真弹窗）→ 提示一次并落标记
  notify.hintKeepAlwaysChoice(TPL);
  eq(wxState.modalCalls.length, 1, '首次提示一次');
  eq(wxState.storage[key], 1, '落本地标记（按 templateId 分开记）');
  eq(/总是保持以上选择/.test(wxState.modalCalls[0].content || ''), true, '文案点明要勾的选项');
  eq(wxState.modalCalls[0].showCancel, false, '只给「知道了」，不给取消（无需决策）');

  // 第二次 → 不再打扰
  notify.hintKeepAlwaysChoice(TPL);
  eq(wxState.modalCalls.length, 1, '第二次不再提示');

  // 换模板 → 标记独立，仍会提示（勾选状态本身也绑 templateId）
  const other = 'another-template-id';
  notify.hintKeepAlwaysChoice(other);
  eq(wxState.modalCalls.length, 2, '换模板后重新提示（标记按 templateId 隔离）');
  eq(wxState.storage[notify.KEEP_HINT_KEY_PREFIX + other], 1, '新模板独立落标记');

  // storage 不可用 → 不弹、不崩（宁可漏提示一次，也不冒重复打扰的风险）
  wxState.storage = {};
  wxState.storageFails = true;
  wxState.modalCalls = [];
  let threw = false;
  try { notify.hintKeepAlwaysChoice(TPL); } catch (e) { threw = true; }
  eq(threw, false, 'storage 抛错时不向外抛');
  eq(wxState.modalCalls.length, 0, 'storage 不可用时不弹窗');
}

(async () => {
  await cloudConsumption();
  await frontendGapFill();
  crossCheck();
  keepChoiceHint();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
