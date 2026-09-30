/**
 * 「新增提醒」页全链路（真正驱动 Page 方法）
 *
 * 为什么要单独测页面：其余 17 套测的都是 lib 层纯函数，**没有一套走过页面方法**。
 * 而「点按钮没反应」「清单不刷新」这类问题恰恰只会在页面这一层出现——
 * 数据、方法、绑定三者任一处的疏漏都表现为同一个症状。
 *
 * 这里用最小 wx / Page 桩把 add-trip 的 Page 对象实例化，像用户一样调用它的方法。
 * 运行：node test/add-trip-flow.test.js
 */
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const util = require(path.join(ROOT, 'miniprogram/utils/util.js'));

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* ---- 最小 wx / Page 桩 ---- */
const logs = [];
let pageDef = null;
global.Page = o => { pageDef = o; };
global.Component = () => {};
global.wx = {
  showToast: o => logs.push('toast:' + o.title),
  showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, navigateTo: () => {}, navigateBack: () => {},
  getWindowInfo: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
  getSystemInfoSync: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }), exec: () => {} }) }),
  pageScrollTo: () => {},
};
global.getApp = () => ({ globalData: { statusBarHeight: 47, navBarHeight: 44 } });
global.getCurrentPages = () => [{}];

/**
 * ⚠️ 这套测的是**页面方法**，必须走 mock 后端。
 *
 * 它原先直接用 `require('mock.js')`，于是**受仓库里 `USE_MOCK` 这个开关影响**：
 * 那是「联调真机 / 回退 mock」的环境开关（当前 false = 走真实云函数），
 * 云函数在单测里根本不存在 —— 把开关改回 false 这套就挂了。
 * **测试不该依赖一个与它无关的全局配置。**
 *
 * 做法沿用本项目既有的 `Module._load` 打桩（见 home-bootstrap.test.js）：
 * 把 utils/api.js 的 require 指向一份源码里 USE_MOCK 已被打开的 mock，
 * 这样直接覆盖仓库里的开关，且测的仍是那一份真实实现。
 */
const MOCK_PATH = path.join(ROOT, 'miniprogram/utils/mock.js');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const fromDir = parent && parent.filename ? path.dirname(parent.filename) : ROOT;
  if (path.resolve(fromDir, request) === MOCK_PATH) {
    if (!Module._forcedMock) {
      const src = require('fs').readFileSync(MOCK_PATH, 'utf8')
        .replace(/^const USE_MOCK = (?:true|false);/m, 'const USE_MOCK = true;');
      const m = new Module(MOCK_PATH, parent);
      m.filename = MOCK_PATH;
      m.paths = Module._nodeModulePaths(path.dirname(MOCK_PATH));
      m._compile(src, MOCK_PATH);
      Module._forcedMock = m.exports;
    }
    return Module._forcedMock;
  }
  return origLoad.apply(this, arguments);
};

require(path.join(ROOT, 'miniprogram/pages/add-trip/add-trip.js'));
const addTripPageDef = pageDef;
let spotsPageDef = null;
global.Page = o => { spotsPageDef = o; };
require(path.join(ROOT, 'miniprogram/pages/spots/spots.js'));
const mock = Module._forcedMock;
Module._load = origLoad;
if (!mock || !mock.USE_MOCK) throw new Error('测试前置失败：mock 没有被强制打开');
if (!addTripPageDef || !spotsPageDef) throw new Error('测试前置失败：页面定义未捕获');

function instantiate(def) {
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  p.triggerEvent = () => {};
  return p;
}

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = new Date();
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const page = instantiate(pageDef);
  page.onLoad({});
  await wait(50);

  console.log('=== 1. 填表：日期 + 景点（用页面自己加载的热门卡）===');
  const START = iso(new Date(TODAY.getTime() + 20 * 86400000));
  const END = iso(new Date(TODAY.getTime() + 24 * 86400000));
  page.onCalendarConfirm({ detail: { start: START, end: END } });
  eq(page.data.dayCount, 5, '日期段共 5 天');

  const cards = page.data.hotSpots.map(c => Object.assign({}, c));
  eq(cards.length > 0, true, '热门景点已加载');
  cards.forEach(c => page.onSpotSelectToggle({ currentTarget: { dataset: { id: c.spotId, spot: c } } }));
  eq(page.data.selectedSpotIds.length, cards.length, '全部选上');

  console.log('=== 2. 生成（纯预览，不建行程）===');
  logs.length = 0;
  page.onGenerateTimeline();
  await wait(200);
  eq(page.data.showTimeline, true, '时间线已展示');
  eq(page.data.timelineEvents.length > 0, true, '有事件');
  eq((await mock.mockCall('reminder', { action: 'trip.list' })).trips.length, 0, '⚠️ 纯预览不创建任何行程');

  const freeRail = page.decorateEvents([{
    spotId: 'tiantan',
    visitDate: '2026-10-05',
    visitDateLabel: '10月5日 (周一)',
    reservationRequired: false,
  }])[0];
  eq(freeRail.railDateLabel, '10月5日', '免预约项左轴日期不再重复显示周几');
  eq(freeRail.visitDateLabel, '10月5日 (周一)', '卡片内出行日仍保留周几');

  console.log('=== 3. 点事件卡按钮 → 进清单 ===');
  const ev = page.data.timelineEvents.find(e => e.status === 'SELECTABLE');
  eq(Boolean(ev), true, '存在可点的 SELECTABLE 事件');
  eq(Boolean(ev.button && ev.button.text), true, '事件带按钮文案：' + (ev.button || {}).text);
  logs.length = 0;
  page.onInlineEventAction({ currentTarget: { dataset: { event: ev } } });
  await wait(200);
  eq(logs.some(l => /已加清单|已加入行程/.test(l)), true, '点按钮有成功反馈');
  eq(page.data.cartCount, 1, '清单条计数更新');
  eq(Number.isInteger(page.data.cartReminderCount), true, '清单条提醒数更新为可渲染数字');

  console.log('=== 4. 一键加入清单 ===');
  page.onInlineAddAll();
  await wait(200);
  const afterBatch = page.data.cartCount;
  eq(afterBatch > 1, true, '批量加入生效，清单共 ' + afterBatch + ' 项');

  console.log('=== 5. 清单数据完整（BottomSheet 要渲染的字段）===');
  const cart = await mock.mockCall('reminder', { action: 'cart.list' });
  eq(cart.summary.count, afterBatch, 'cart.list 与页面计数一致');
  eq(cart.groups.length > 0, true, '有分组');
  const rows = cart.groups.reduce((a, g) => a.concat(g.items), []);
  eq(rows.length, afterBatch, '行数 = 清单项数');
  const needFields = ['_id', 'spotId', 'spotName', 'reservationRequired', 'remindOn', 'releaseTimeLabel'];
  const missing = needFields.filter(f => rows[0][f] === undefined);
  eq(missing.length, 0, '首行字段齐全' + (missing.length ? '（缺 ' + missing.join(',') + '）' : ''));

  console.log('=== 6. 时间线状态回写（加完清单按钮该变「已加清单」）===');
  // reloadPreview 是异步的，等它跑完
  await wait(200);
  const now = page.data.timelineEvents.filter(e => e.status === 'IN_CART').length;
  eq(now > 0, true, '有 ' + now + ' 条事件已变为 IN_CART');

  console.log('=== 7. 提交（此刻才建行程）===');
  const cm = await mock.mockCall('reminder', {
    action: 'cart.commit',
    channels: ['OFFICIAL_ACCOUNT'], offsets: [5],
  });
  eq(cm.success, true, '提交成功');
  eq(Boolean(cm.tripId), true, '回传 tripId');
  eq((await mock.mockCall('reminder', { action: 'cart.list' })).summary.count, 0, '提交后清单清空');
  eq((await mock.mockCall('reminder', { action: 'trip.list' })).trips.length, 1, '此时才创建行程');

  console.log('=== 8. 从首页带行程进来：预填表单 + 已在行程的项禁选 ===');
  {
    /* 构造用户从首页某趟进行中行程点「+ 新增提醒」进来的样子。
       这趟行程已经有一条 9/x 的故宫行程项。 */
    const preview = await mock.mockCall('reminder', {
      action: 'timeline.preview', startDate: START, endDate: END, spotIds: ['gugong'],
    });
    eq(preview.success, true, '构造用的预览成功');
    const visitDate = preview.events[0].visitDate;
    const TRIP2 = 'mock-trip-entry';
    mock.__internals.db.trips[TRIP2] = {
      _id: TRIP2, userId: 'mock-user', city: '北京', startDate: START, endDate: END,
      name: '北京 ' + START.slice(5) + '-' + END.slice(5), status: 'ACTIVE',
      spots: [{ spotId: 'gugong', startDate: START, endDate: END }],
      spotIds: ['gugong'], createdAt: new Date(), updatedAt: new Date(),
    };
    mock.__internals.db.items['mock-item-entry'] = {
      _id: 'mock-item-entry', userId: 'mock-user', tripId: TRIP2,
      spotId: 'gugong', visitDate,
      backupGroupId: TRIP2 + ':gugong', remindOn: true, result: null, resultAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    const page2 = instantiate(pageDef);
    page2.onLoad({
      tripId: TRIP2, startDate: START, endDate: END, spotIds: 'gugong',
    });
    await wait(200);
    eq(page2.data.entryTripId, TRIP2, '记下了从哪趟行程进来');
    eq(page2.data.startDate, START, '日期段已预填（用户不用重输）');
    eq(page2.data.endDate, END, '结束日已预填');
    eq(page2.data.dateRangeText.length > 0, true, '日期段文案已算好：' + page2.data.dateRangeText);
    eq(page2.data.dayCount, 5, '天数已算好');
    eq(page2.data.selectedSpotIds.join(','), 'gugong', '景点 id 已预填');
    eq(page2.data.selectedSpots.length, 1, '景点标签已取到名字（走 spots.batch）');
    eq(page2.data.selectedSpots[0].name,
      ((await mock.mockCall('spots', { action: 'batch', spotIds: ['gugong'] })).data[0] || {}).name,
      '标签名与 spots.batch 一致');

    /* 不点「生成」也能直接用——按钮只要求日期 + 景点，两者都预填好了 */
    logs.length = 0;
    page2.onGenerateTimeline();
    await wait(200);
    eq(page2.data.showTimeline, true, '预填后可直接生成，无需重输');
    const committed = page2.data.timelineEvents.filter(e => e.status === 'COMMITTED');
    eq(committed.length > 0, true, '这一趟已有的项标成「已加行程」');
    eq(committed.every(e => e.button.enabled === false), true, '已在行程的项不可重复加');
    eq(committed.every(e => e.button.text === '已加行程'), true, '按钮文案为「已加行程」');

    /* ⚠️ 点了已禁用的项，不能给出「已加入」这种假成功反馈 */
    logs.length = 0;
    page2.onInlineEventAction({ currentTarget: { dataset: { event: committed[0] } } });
    await wait(200);
    eq(logs.some(l => /已加清单|已加入行程/.test(l)), false,
      '已在行程的项不弹成功反馈');

    /* 一键加入清单：已禁用的项进不了 selectable，不能回一个「已加入 0 项」的
       信息量为零的 toast，要说清它们已经在清单/行程里了。 */
    logs.length = 0;
    page2.onInlineAddAll();
    await wait(300);
    const batchLog = logs.find(l => /已加|已在|没有可加入/.test(l)) || '';
    eq(/已加入 0/.test(batchLog), false, '不出现「已加入 0 项」：' + batchLog);
    eq(/已在清单或行程里/.test(batchLog), true, '空批量时解释「已在清单或行程里」');

    /* 不带 tripId 进来（空态首页）→ 与旧口径完全一致 */
    const page3 = instantiate(pageDef);
    /* 模拟页面实例在复用前还留着上一趟表单与时间线。onLoad 必须先把它们清空，
       否则新用户首页再次进入时会看到已经删除行程的日期。 */
    page3.data.startDate = START;
    page3.data.endDate = END;
    page3.data.dateRangeText = '旧行程日期';
    page3.data.dayCount = 5;
    page3.data.selectedSpotIds = ['gugong'];
    page3.data.selectedSpots = [{ spotId: 'gugong', name: '故宫博物院' }];
    page3.data.showTimeline = true;
    page3.data.timelineEvents = [{ spotId: 'gugong' }];
    page3.onLoad({});
    await wait(200);
    eq(page3.data.entryTripId, '', '没带行程时 entryTripId 为空');
    eq(page3.data.startDate, '', '没带行程时日期不预填');
    eq(page3.data.selectedSpotIds.length, 0, '没带行程时景点不预填');
    eq(page3.data.showTimeline, false, '没带行程时旧时间线不残留');
    eq(page3.data.timelineEvents.length, 0, '没带行程时旧时间线事件不残留');
  }

  console.log('=== 9. 热门网格的选卡范围（2026-09-24 用户口径）===');
  {
    /* 网格 = S 级（需预约 && 难度≥4）**加** `EXTRA_HOT_IDS` 里点名保留的景点。
       ⚠️ 锁的是「纪念堂进网格、但**不改它的难度分**」这一条：
       它 2026-09-15 由用户确认从 4 分降到 3 分（原依据「固定补放」已证伪），
       要它回网格只能放宽卡片的选卡范围，不能回改 difficultyScore——
       改分会连带改掉景点 Tab / spots 列表 / spot-popup / 运营 skill 四处。 */
    const src = require('fs').readFileSync(
      path.join(ROOT, 'miniprogram/pages/add-trip/add-trip.js'), 'utf8');
    eq(/EXTRA_HOT_IDS = \['maozhuxi-jiniantang'\]/.test(src), true,
      '纪念堂在补充名单里');

    const cards = page.data.hotSpots;
    const byId = {};
    cards.forEach(c => { byId[c.spotId] = c; });
    eq(cards.length, 4, '热门网格 4 张（3 极难约 + 1 较难约）');
    eq(Boolean(byId['maozhuxi-jiniantang']), true, '纪念堂出现在网格里');
    eq(byId['maozhuxi-jiniantang'].difficultyLabel.text, '较难约',
      '⚠️ 卡片照实显示「较难约」——放宽的是选卡范围，不是难度分');
    eq(byId['gugong'].difficultyLabel.text, '极难约', 'S 级仍是极难约');
    /* 补充项排在末尾：服务端已按 popularityScore 降序（SORT-RULE-001），
       网格顺序不该因为补了一个景点就整体重排。 */
    eq(cards[cards.length - 1].spotId, 'maozhuxi-jiniantang', '补充景点排在末尾，S 级顺序不动');
    eq(cards.slice(0, 3).every(c => c.difficultyLabel.text === '极难约'), true,
      '前三张仍是 3 个极难约');
    /* 数据不动：口径真身里的分数仍是 3 */
    const spot = mock.SPOTS.find(s => s.spotId === 'maozhuxi-jiniantang');
    eq(spot.difficultyScore, 3, '⚠️ data 里的难度分仍为 3（只放宽卡片范围，不改难度）');
  }

  console.log('=== 10. 已选景点去重与按 spotId 删除（顺序漂移回归）===');
  {
    const spotsPage = instantiate(spotsPageDef);
    spotsPage.onLoad({ spotIds: 'guobo,guobo,gugong' });
    await wait(200);
    eq(spotsPage.data.selectedSpotIds.join(','), 'guobo,gugong', '重复 ID 只保留一份');
    eq(spotsPage.data.selectedSpots.map(s => s.spotId).join(','), 'guobo,gugong',
      '已选卡片按传入 ID 顺序展示，不跟数据库顺序漂移');

    spotsPage.onRemoveSelected({ currentTarget: { dataset: { id: 'guobo' } } });
    eq(spotsPage.data.selectedSpotIds.join(','), 'gugong', '删除按 spotId 命中，不受数组下标影响');
    eq(spotsPage.data.selectedSpots.map(s => s.spotId).join(','), 'gugong', '对应卡片同步删除');

    spotsPage.onSpotToggle({ currentTarget: { dataset: {
      id: 'guobo',
      spot: { spotId: 'guobo', name: '中国国家博物馆', remindable: true },
    } } });
    eq(spotsPage.data.selectedSpotIds.join(','), 'gugong,guobo', '重新加入只追加一个 ID');
    eq(spotsPage.data.selectedSpots.map(s => s.spotId).join(','), 'gugong,guobo',
      '重新加入不会生成重复卡片');

    const addTripPage = instantiate(pageDef);
    addTripPage.onLoad({ spotIds: 'guobo,gugong' });
    await wait(200);
    eq(addTripPage.data.selectedSpots.map(s => s.spotId).join(','), 'guobo,gugong',
      '新增提醒页预填也按传入 ID 顺序归一');
    addTripPage.onSpotSelectToggle({ currentTarget: { dataset: {
      id: 'guobo',
      spot: addTripPage.data.selectedSpots.find(s => s.spotId === 'guobo'),
    } } });
    eq(addTripPage.data.selectedSpotIds.join(','), 'gugong', '新增提醒页取消选择同样按 spotId 删除');
    eq(addTripPage.data.selectedSpots.map(s => s.spotId).join(','), 'gugong',
      '新增提醒页不会误删另一张景点卡');

    /* PAGE-003 返回时，添加提醒页的热门网格也要同步 selected 布尔值。
       只回写 selectedSpotIds 时，用户会看到表单已选但网格按钮仍显示「选择」。 */
    const originalGetCurrentPages = global.getCurrentPages;
    const returnTarget = instantiate(pageDef);
    returnTarget.onLoad({});
    await wait(200);
    returnTarget.data.hotSpots = util.markSpotsSelected(returnTarget.data.hotSpots, []);
    spotsPage.data.selectedSpotIds = ['gugong'];
    spotsPage.data.selectedSpots = [{ spotId: 'gugong', name: '故宫博物院' }];
    global.getCurrentPages = () => [returnTarget, spotsPage];
    spotsPage.onBack();
    global.getCurrentPages = originalGetCurrentPages;
    eq(returnTarget.data.selectedSpotIds.join(','), 'gugong', '返回后已选 ID 带回上一页');
    eq((returnTarget.data.hotSpots.find(s => s.spotId === 'gugong') || {}).selected, true,
      '返回后热门网格同步已选状态');
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
