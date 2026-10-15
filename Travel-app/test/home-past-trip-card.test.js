/**
 * 「所有行程都结束之后，首页仍显示最近一段行程的摘要卡」（2026-10-15 用户口径）。
 *
 * 起因：行程全部结束（`trips` 为空、`history` 有内容）时，首页只剩一条
 * 「过往行程 (N)」折叠条 + 悬浮按钮，一屏空白。用户口径是：这张卡**不该退场**，
 * 继续展示**最后一个行程**，原来放倒计时的那行小字显示「已结束」。
 *
 * 这个文件钉住四件事：
 *   ① 页面侧的回退只看服务端给的数组序（`history[0]`），不自己重判「哪趟结束了」；
 *   ② 摘要卡与「新增提醒预填」两件事**分开**：`summaryTrip` 只给卡，
 *      `primaryTrip` 仍是「还能继续加提醒的那一趟」，`onAddTrip` 只认后者
 *      ——混用会拿一个过去的时间范围去预填 PAGE-005（提交即 1016）；
 *   ③ 这一档文案是行程级的「已结束」——与行程项卡那套同名同词，但仍是**两条**
 *      计算路径，不要把两个函数合并（见 `util.js` 的注释）；
 *   ④ 本轮**不碰云函数**：`primaryTripId` 的语义（最近未结束行程）不变，
 *      退化只发生在页面渲染层，避免有人以为云端已经改过而重复改一遍。
 *
 * 运行：node test/home-past-trip-card.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOME_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
const HOME_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
const CARD_JS = fs.readFileSync(
  path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.js'), 'utf8');
const CLOUD_INDEX = fs.readFileSync(path.join(ROOT, 'cloudfunctions/reminder/index.js'), 'utf8');
const util = require(path.join(ROOT, 'miniprogram/utils/util.js'));

/** 剥掉注释再断言（注释里会解释这条规则本身）。 */
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const HOME_CODE = codeOf(HOME_JS);

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* ===== 一份「云端真的会返回」的全结束返回体 =====
   history 按 startDate 降序、不带 items（契约如此，见 home-bootstrap.test.js）。 */
const PAST_TRIP_LATEST = {
  _id: 'TRIP-OLD-2', city: '北京', startDate: '2026-09-28', endDate: '2026-09-30',
  name: '北京之行', progress: { done: 2, total: 3, noReservationCount: 1 },
  itemCount: 3, spotIds: ['gugong', 'guobo'],
};
const PAST_TRIP_OLDER = {
  _id: 'TRIP-OLD-1', city: '北京', startDate: '2026-09-01', endDate: '2026-09-02',
  name: '北京之行', progress: { done: 1, total: 1, noReservationCount: 0 },
  itemCount: 1, spotIds: ['tiantan'],
};
const ACTIVE_TRIP = {
  _id: 'TRIP-NOW', city: '北京', startDate: '2026-10-20', endDate: '2026-10-22',
  name: '北京之行', progress: { done: 0, total: 2, noReservationCount: 0 },
  itemCount: 2, spotIds: ['gugong'], items: [],
};

function bootstrapWith(trips, history) {
  return {
    serverNow: Date.UTC(2026, 9, 15, 2, 0), // 北京 10/15 10:00
    primaryTripId: trips.length ? trips[0]._id : '',
    scrollTargetId: null,
    trips,
    history,
    stickyBanner: null,
    releasePills: [],
    reminderQuotaWarning: null,
    recoverableIds: [],
    homeMode: trips.length || history.length ? 2 : 1,
    hotSpots: [],
  };
}

/** 真跑一遍首页：stub 掉 wx / getApp / Page，拿到页面实例。 */
function loadPage(res) {
  const HOME = path.join(ROOT, 'miniprogram/pages/home/home.js');
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reportEvent: () => {},
    showToast: () => {},
    cloud: { callFunction: o => { setTimeout(() => o.success({ result: res }), 0); } },
  };
  global.getApp = () => ({
    globalData: { statusBarHeight: 44, navBarHeight: 44, envVersion: '', serverSkewMs: 0 },
  });
  let pageDef = null;
  global.Page = def => { pageDef = def; };
  delete require.cache[require.resolve(HOME)];
  require(HOME);

  const page = Object.assign({}, pageDef);
  page.data = JSON.parse(JSON.stringify(pageDef.data));
  page.setData = (patch, cb) => {
    Object.assign(page.data, patch);
    if (typeof cb === 'function') cb();
  };
  return page;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== 1. 全结束：摘要卡拿到最近的一段过往行程，primaryTrip 保持为空 ===');
  {
    const page = loadPage(bootstrapWith([], [PAST_TRIP_LATEST, PAST_TRIP_OLDER]));
    page.loadHome();
    await wait(30);

    eq(page.data.trips.length, 0, '没有未结束行程 → 主墙为空');
    eq(page.data.history.length, 2, '两段过往行程仍在 history 里（折叠区不变）');
    eq(page.data.primaryTrip, null, 'primaryTrip 为 null：没有能继续加提醒的行程');
    eq(page.data.summaryTrip && page.data.summaryTrip._id, 'TRIP-OLD-2',
      '摘要卡退化为最近的一段过往行程（history[0]，服务端按 startDate 降序）');
    eq(page.data.isBlank, false, '有历史行程 → 不是空态（不出创建引导）');
    /* 卡片要的是 city / 日期段 / progress，历史行程都带；items 不下发也不影响。 */
    eq(page.data.summaryTrip.items, undefined, '历史行程不带 items，摘要卡照样能渲染');
  }

  console.log('=== 2. 有未结束行程时行为不变（退化只发生在全结束时） ===');
  {
    const page = loadPage(bootstrapWith([ACTIVE_TRIP], [PAST_TRIP_LATEST]));
    page.loadHome();
    await wait(30);
    eq(page.data.summaryTrip && page.data.summaryTrip._id, 'TRIP-NOW',
      '有进行中行程 → 摘要卡仍给最近未结束的那趟');
    eq(page.data.primaryTrip && page.data.primaryTrip._id, 'TRIP-NOW',
      'primaryTrip 与摘要卡一致（此时两者是同一趟）');
  }

  console.log('=== 3. 一段行程都没有：空态不进这一步 ===');
  {
    const page = loadPage(bootstrapWith([], []));
    page.loadHome();
    await wait(30);
    eq(page.data.summaryTrip, null, '无任何行程 → 摘要卡无数据（模板整块不渲染）');
    eq(page.data.isBlank, true, '仍是空态：创建引导 + 悬浮入口互斥的那条链不受影响');
  }

  console.log('=== 4. 副标题文案：「已结束」（行程级） ===');
  {
    /* 真跑组件 observer：比 grep 源码更能证明「卡上那行小字会说已结束」。
       日期一律用相对值推，免得这条断言只在某一天成立。 */
    const pad = n => String(n).padStart(2, '0');
    const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const D = n => iso(new Date(Date.now() + n * 86400000));

    const CARD = path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.js');
    let compDef = null;
    const origComponent = global.Component;
    global.Component = def => { compDef = def; };
    delete require.cache[require.resolve(CARD)];
    require(CARD);
    global.Component = origComponent;

    const pastTrip = Object.assign({}, PAST_TRIP_LATEST, { startDate: D(-5), endDate: D(-1) });
    const ctx = { data: {}, setData(patch) { Object.assign(this.data, patch); } };
    compDef.observers.trip.call(ctx, pastTrip);
    eq(ctx.data.metaLine, util.tripMetaLine(D(-5), D(-1), '已结束'),
      '已结束行程的摘要卡副标题 = 日期段 · 已结束');
    eq(/ · 已结束$/.test(ctx.data.metaLine), true, '小字末尾就是「已结束」这一档');
    eq(ctx.data.displayName, '北京之行', '行程名照旧');
    eq(ctx.data.percent, 67, '进度条按 progress 算（2/3）');

    eq(util.tripCountdownTextOf(D(-5), D(-1)), '已结束', '行程级：结束日次日 → 已结束');
    eq(util.tripCountdownTextOf(D(-3), D(0)), '进行中第4天',
      '结束日当天仍属进行中（与服务端 endDate >= today 同口径）');
    eq(util.tripCountdownTextOf(D(9), D(12)), '还有9天', '行程级未开始不变');
    eq(util.countdownTextOf(D(-3)), '已结束',
      '行程项卡那套（距出行日）不改动——两套算法仍各自独立');
    eq(/util\.tripCountdownTextOf\(trip\.startDate, trip\.endDate\)/.test(CARD_JS), true,
      '摘要卡仍走 util 的行程级倒计时（组件里不另写一套日期算法）');
  }

  console.log('=== 5. 两件事不许混：摘要卡归卡，预填归 primaryTrip ===');
  {
    eq(/<trip-summary-card trip="\{\{summaryTrip\}\}"/.test(HOME_WXML), true,
      '摘要卡绑 summaryTrip');
    eq(/trip="\{\{primaryTrip\}\}"/.test(HOME_WXML), false,
      '模板里不再有人绑 primaryTrip（防两处口径漂开）');
    eq(/const summaryTrip = primary \|\| history\[0\] \|\| null;/.test(HOME_CODE), true,
      '回退只看服务端数组序：trips[0] → history[0]，页面不重判结束与否');
    eq(/const t = emptyHome \? null : this\.data\.primaryTrip;/.test(HOME_CODE), true,
      'onAddTrip 预填仍只读 primaryTrip（不拿已结束行程的日期段进 PAGE-005）');
    eq(/this\.data\.summaryTrip/.test(HOME_CODE), false,
      'summaryTrip 只做渲染，任何计算/提交逻辑都不读它');
    eq(/summaryTrip: null,/.test(HOME_CODE), true, 'summaryTrip 在 data 里显式声明');
    eq((HOME_CODE.match(/summaryTrip: null,/g) || []).length, 2,
      'data 初值与开发预览分支都清成 null（预览态不许残留在卡片上）');
    /* 历史折叠区不因为摘要卡展示了其中一段就被摘掉一段：它仍是回看明细的入口。 */
    eq(/过往行程 \(\{\{history\.length\}\}\)/.test(HOME_WXML), true,
      '折叠条仍按**全部**历史行程计数（不扣掉摘要卡展示的那一段）');
    eq(/wx:for="\{\{history\}\}"[\s\S]{0,200}?trip-section trip="\{\{trip\}\}" history="\{\{true\}\}"/.test(HOME_WXML),
      true, '展开后仍平铺全部历史行程');
  }

  console.log('=== 6. 本轮不碰云端：primaryTripId 语义不变（否则会有两套口径） ===');
  {
    const CLOUD_CODE = codeOf(CLOUD_INDEX);
    eq(/const primaryTripId = activeTrips\.length \? activeTrips\[0\]\._id : '';/.test(CLOUD_CODE),
      true, '云端 primaryTripId 仍是「最近未结束行程」（本次是纯小程序端改动）');
    eq(/historyTrips\.sort\(\(a, b\) => String\(b\.startDate\)\.localeCompare\(String\(a\.startDate\)\)\);/
      .test(CLOUD_CODE), true, 'history 仍是 startDate 降序 —— 页面回退依赖的就是这个顺序');
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
