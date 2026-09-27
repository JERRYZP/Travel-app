/**
 * V0.3 主流程 UX 优化回归。
 *
 * 覆盖：
 * - 创建行程：步骤文案、日期锚点、平铺出游日；
 * - 行程清单：动态 CTA、提醒数汇总、首次提示；
 * - 想去景点：即时生效、完成并返回、清空二次确认；
 * - 设置提醒：权限拆分、授权硬闸门、用户主动补齐、主 CTA。
 *
 * 运行：node test/v03-main-flow.test.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
const ADD_WXML = read('miniprogram/pages/add-trip/add-trip.wxml');
const ADD_JS = read('miniprogram/pages/add-trip/add-trip.js');
const ADD_WXSS = read('miniprogram/pages/add-trip/add-trip.wxss');
const CART_WXML = read('miniprogram/components/cart-popup/cart-popup.wxml');
const CART_JS = read('miniprogram/components/cart-popup/cart-popup.js');
const SPOTS_WXML = read('miniprogram/pages/spots/spots.wxml');
const SPOTS_JS = read('miniprogram/pages/spots/spots.js');
const SETUP_WXML = read('miniprogram/pages/setup/setup.wxml');
const SETUP_JS = read('miniprogram/pages/setup/setup.js');

console.log('=== 1. 创建行程主流程 ===');
{
  eq(/第一步：填行程信息，生成放票时间线/.test(ADD_WXML), true, '第一步有步骤编号和说明');
  eq(/仅生成预览，提交后才创建提醒/.test(ADD_WXML), true, '明确生成只是预览');
  eq(/第二步，选择要加入行程的景点/.test(ADD_WXML), true, '第二步描述用户真实动作');
  eq(/scroll-into-view="\{\{scrollIntoView\}\}"/.test(ADD_WXML), true, '页面滚动容器接锚点');
  eq(/class="timeline-day"/.test(ADD_WXML), true, '出游日平铺渲染');
  eq(/onDateAnchorTap/.test(ADD_JS), true, '日期锚点由页面方法处理');
  eq(/scheduleTimelineSpy/.test(ADD_JS), true, '下滑时更新顶部日期选中态');
  eq(/第三步：确认行程清单/.test(ADD_WXML), true, '底部进入清单的按钮延续步骤编号');
  eq(/其中 \' \+ reminderCount \+ \' 项会提醒/.test(ADD_JS), true, '清单条区分行程项与提醒项');
}

console.log('\n=== 2. 行程清单 ===');
{
  eq(/超难约的景点默认开启提醒/.test(CART_WXML), true, '默认提醒策略可见');
  eq(/tipsExpanded/.test(CART_WXML + CART_JS), true, '温馨提示支持展开与折叠');
  eq(/cartDefaultTipsCollapsedV1/.test(CART_JS), true, '首次展开、后续折叠有持久标记');
  eq(/第四步：设置提醒方式/.test(CART_JS), true, '有提醒时 CTA 指向第四步');
  eq(/确认加入行程/.test(CART_JS), true, '无提醒时 CTA 直接确认入行程');
  eq(/cartFootText/.test(CART_WXML), true, '底部摘要按状态动态渲染');
}

console.log('\n=== 3. 想去景点即时生效 ===');
{
  eq(/完成并返回/.test(SPOTS_WXML), true, '底部按钮使用即时生效语义');
  eq(/确认选择并返回/.test(SPOTS_WXML), false, '不再使用暂存确认语义');
  eq(/onDone\(\) \{ this\.onBack\(\); \}/.test(SPOTS_JS), true, '顶部返回和底部按钮共用返回逻辑');
  eq(/已加入行程清单/.test(SPOTS_JS), true, '选择后有即时保存反馈');
  eq(/清空已选景点？/.test(SPOTS_WXML), true, '清空已选需要二次确认');
}

console.log('\n=== 4. 设置提醒权限与硬闸门 ===');
{
  eq(/微信通知权限：/.test(SETUP_WXML), true, '系统通知权限单独展示');
  eq(/放票提醒授权：/.test(SETUP_WXML), true, '订阅授权单独展示');
  eq(/开启行程放票提醒/.test(SETUP_WXML), true, '主 CTA 使用最终文案');
  eq(/加满提醒授权/.test(SETUP_WXML + SETUP_JS), false, '移除“加满”文案');
  eq(/经过二次开发|限种子用户使用/.test(SETUP_WXML + SETUP_JS), false, '移除内部实现语言');
  eq(/暂不开启提醒|仅加入行程/.test(SETUP_WXML + SETUP_JS), false, '设置提醒页不提供绕过授权的出口');
  eq(/requestSubscribeBurst\(shortfall\)/.test(SETUP_JS), true, '补齐授权必须由用户主动点击');
  eq(/confirmReminderAccess/.test(SETUP_JS), false, '提交不再调用带“仅加行程”分支的旧闸门');
  eq(/还差 \' \+ shortfall \+ \' 次授权，补齐后才能开启提醒/.test(SETUP_JS), true, '额度不足时给出明确硬提示');
  eq(/view class="submit-btn \{\{canSubmit \? '' : 'disabled'\}\}"/.test(SETUP_WXML), true, '额度不足时主按钮禁用');
  eq(/sampleShots/.test(SETUP_JS) && /查看提醒样式示例/.test(SETUP_WXML), true, '提醒样式示例直接可查看');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram/images/reminder-samples/style-1.jpg')), true, '第一张提醒样式图已进入小程序包');
}

console.log('\n=== 5. 设置提醒页面行为 ===');
const apiCalls = { commits: [] };
const toasts = [];
const apiStub = {
  reminder: {
    cart: {
      list: () => Promise.resolve({ summary: { reminderCount: 10 } }),
      commit: payload => { apiCalls.commits.push(payload); return Promise.resolve({ createdTasks: 10, tripId: 'trip-v03' }); },
    },
  },
  toastError: () => {},
};
const health = { systemOk: true, quota: 5 };
const notifyStub = {
  getReminderHealth: () => Promise.resolve(Object.assign({}, health)),
  requestSubscribeBurst: times => {
    health.quota += 1;
    return Promise.resolve({ ok: true, added: 1, silent: false, shortfall: Math.max(0, times - 1) });
  },
  hintKeepAlwaysChoice: () => {},
  openSystemNotifySetting: () => {},
  guideOpenSubscribeSetting: () => {},
  consumeFirstReminderSuccessTip: () => false,
};

global.getApp = () => ({ globalData: { statusBarHeight: 47, navBarHeight: 44 } });
global.getCurrentPages = () => [{ route: 'pages/setup/setup' }, { route: 'pages/home/home' }];
global.wx = {
  showLoading: () => {},
  hideLoading: () => {},
  showToast: o => toasts.push(o.title),
  showModal: () => {},
  navigateBack: () => {},
  previewImage: () => {},
  getWindowInfo: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
  getSystemInfoSync: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
};

const origLoad = Module._load;
function loadPage(rel) {
  let def = null;
  global.Page = o => { def = o; };
  Module._load = function (request, parent) {
    if (request === '../../utils/api.js') return apiStub;
    if (request === '../../utils/notify.js') return notifyStub;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  Module._load = origLoad;
  return def;
}

function instantiate(def) {
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

(async () => {
  const page = instantiate(loadPage('miniprogram/pages/setup/setup.js'));
  await page.refreshAccessState(10);
  eq(page.data.shortfall, 5, '额度不足时显示真实缺口');
  eq(page.data.canSubmit, false, '额度不足时主按钮不可提交');
  toasts.length = 0;
  page.onSubmit();
  eq(toasts[0].indexOf('请先补齐 5 次授权') >= 0, true, '点击禁用主按钮只提示先补齐');
  eq(apiCalls.commits.length, 0, '额度不足绝不在提交动作中偷偷自动授权');

  await page.onFillQuota();
  eq(health.quota, 6, '用户主动补齐后额度真实增加');
  eq(page.data.shortfall, 4, '页面实时刷新剩余缺口');
  eq(page.data.canSubmit, false, '仍不足时继续禁用主按钮');

  health.quota = 10;
  await page.refreshAccessState(10);
  eq(page.data.canSubmit, true, '授权满足后启用主按钮');
  page.onSubmit();
  await new Promise(r => setTimeout(r, 20));
  eq(apiCalls.commits.length, 1, '授权满足后主按钮触发提交');
  eq(apiCalls.commits[0].channels[0], 'OFFICIAL_ACCOUNT', '提交走微信通知通道');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  Module._load = origLoad;
  console.error('测试异常:', err);
  process.exit(1);
});
