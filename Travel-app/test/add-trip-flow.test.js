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
const ROOT = path.join(__dirname, '..');

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

require(path.join(ROOT, 'miniprogram/pages/add-trip/add-trip.js'));
const mock = require(path.join(ROOT, 'miniprogram/utils/mock.js'));

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

  console.log('=== 3. 点事件卡按钮 → 进清单 ===');
  const ev = page.data.timelineEvents.find(e => e.status === 'SELECTABLE');
  eq(Boolean(ev), true, '存在可点的 SELECTABLE 事件');
  eq(Boolean(ev.button && ev.button.text), true, '事件带按钮文案：' + (ev.button || {}).text);
  logs.length = 0;
  page.onInlineEventAction({ currentTarget: { dataset: { event: ev } } });
  await wait(200);
  eq(logs.some(l => /已加入/.test(l)), true, '点按钮有成功反馈');
  eq(page.data.cartCount, 1, '清单条计数更新');
  eq(page.data.cartText.indexOf('已选 1 项') === 0, true, '清单条文案更新：' + page.data.cartText);

  console.log('=== 4. 一键加入待选清单 ===');
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

  console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
