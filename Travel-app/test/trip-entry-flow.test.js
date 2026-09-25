/**
 * 两条补录动线的页面级回归：
 * - 景点聚合页：日历读已有/历史行程，仅加行程不再误报提醒成功；
 * - 首页「约其他日」：成功后有明确反馈，并区分真实提醒与仅记录行程。
 *
 * 运行：node test/trip-entry-flow.test.js
 */
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const calls = { add: [], commit: [], remove: [], toasts: [], loading: [] };
let accessResult = { action: 'ready' };
const app = {
  globalData: {
    statusBarHeight: 47,
    navBarHeight: 44,
    envVersion: 'develop',
    previewNewUser: false,
    currentTripId: null,
  },
};

const bootstrap = {
  trips: [{
    _id: 'trip-1',
    items: [
      { itemId: 'i1', spotId: 'gugong', visitDate: '2026-10-01' },
      { itemId: 'i2', spotId: 'guobo', visitDate: '2026-10-02' },
    ],
  }],
  history: [{
    _id: 'trip-0',
    items: [{ itemId: 'i0', spotId: 'gugong', visitDate: '2026-09-20' }],
  }],
};

const apiStub = {
  reminder: {
    home: { bootstrap: () => Promise.resolve(JSON.parse(JSON.stringify(bootstrap))) },
    cart: {
      add(data) {
        calls.add.push(data);
        return Promise.resolve({ success: true, cartId: 'cart-new' });
      },
      commit(data) {
        calls.commit.push(data);
        const disabled = data && data.disableReminders === true;
        return Promise.resolve({
          success: true,
          createdItems: 1,
          createdTasks: disabled ? 0 : 1,
          noReminder: disabled ? 1 : 0,
          disableReminders: disabled,
          tripId: 'trip-1',
        });
      },
      remove(cartId) {
        calls.remove.push(cartId);
        return Promise.resolve({ success: true });
      },
    },
  },
};

const notifyStub = {
  getReminderQuotaNeeded: () => Promise.resolve(1),
  confirmReminderAccess: () => Promise.resolve(accessResult),
  consumeFirstReminderSuccessTip: () => false,
  openSystemNotifySetting: () => {},
};

global.getApp = () => app;
global.getCurrentPages = () => [{ route: 'pages/home/home' }];
global.wx = {
  showLoading: o => calls.loading.push('show:' + (o && o.title)),
  hideLoading: () => calls.loading.push('hide'),
  showToast: o => calls.toasts.push(o && o.title),
  navigateTo: () => {},
  navigateBack: () => {},
  pageScrollTo: () => {},
};

const origLoad = Module._load;
function loadPage(rel) {
  let def = null;
  global.Page = o => { def = o; };
  Module._load = function (request, parent) {
    if (request === '../../utils/api.js' || request === './api.js') return apiStub;
    if (request === '../../utils/notify.js' || request === './notify.js') return notifyStub;
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
  console.log('=== 1. 景点页日历读取已有与历史行程 ===');
  const hub = instantiate(loadPage('miniprogram/pages/spot-hub/spot-hub.js'));
  hub.openDateSheet('gugong', '故宫博物院', '加入行程', false);
  await wait(20);
  eq(hub.data.showDateSheet, true, '日历成功打开');
  eq(hub.data.dateTripDates.join(','), '2026-10-01,2026-10-02,2026-09-20', '日历带全部已有/历史行程日期');
  eq(hub.data.dateBookedDates.join(','), '2026-10-01,2026-09-20', '当前景点已有日期置灰');

  console.log('\n=== 2. 景点页仅加行程，不得提示提醒成功 ===');
  calls.add = []; calls.commit = []; calls.toasts = [];
  hub.data.dateAction = { spotId: 'gugong', remindOn: false };
  hub.onDateConfirm({ detail: { visitDate: '2026-10-03' } });
  await wait(20);
  eq(calls.add[0].remindOn, false, '加入时明确不提醒');
  eq(calls.commit[0].cartId, 'cart-new', '只提交本次新增的清单项');
  eq(calls.commit[0].channels, undefined, '仅加行程不传提醒通道');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程，未设置提醒', '成功文案与实际动作一致');
  eq(calls.toasts.includes('提醒已开启'), false, '不再误报提醒已开启');

  console.log('\n=== 3. 景点页设置提醒，区分 ready / trip-only ===');
  calls.add = []; calls.commit = []; calls.toasts = [];
  accessResult = { action: 'ready' };
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  hub.onDateConfirm({ detail: { visitDate: '2026-10-04' } });
  await wait(20);
  eq(calls.commit[0].channels[0], 'OFFICIAL_ACCOUNT', '授权足额时创建提醒任务');
  eq(calls.commit[0].cartId, 'cart-new', '提醒补录同样只提交本次项');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见', '提醒成功文案明确');

  calls.add = []; calls.commit = []; calls.toasts = [];
  accessResult = { action: 'trip-only' };
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  hub.onDateConfirm({ detail: { visitDate: '2026-10-05' } });
  await wait(20);
  eq(calls.commit[0].disableReminders, true, '授权降级时仅落行程');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程，未设置提醒', '降级后不谎报提醒');

  console.log('\n=== 4. 首页“约其他日”成功反馈 ===');
  const home = instantiate(loadPage('miniprogram/pages/home/home.js'));
  home.data.sheetSpotId = 'gugong';
  home.data.sheetSpotName = '故宫博物院';
  home.data.trips = JSON.parse(JSON.stringify(bootstrap.trips));
  home.data.history = JSON.parse(JSON.stringify(bootstrap.history));
  calls.add = []; calls.commit = []; calls.toasts = []; calls.loading = [];
  accessResult = { action: 'ready' };
  home.onRecoverConfirm({ detail: { visitDate: '2026-10-06' } });
  await wait(30);
  eq(calls.loading[0], 'show:正在添加...', '提交期间有加载反馈');
  eq(calls.loading[calls.loading.length - 1], 'hide', '完成后收起加载');
  eq(calls.toasts[calls.toasts.length - 1], '已加入 10月6日行程，提醒已设置', '约其他日成功反馈含日期和提醒结果');

  console.log('\n=== 5. 首页“约其他日”降级仅加行程 ===');
  calls.add = []; calls.commit = []; calls.toasts = [];
  accessResult = { action: 'trip-only' };
  home.onRecoverConfirm({ detail: { visitDate: '2026-10-07' } });
  await wait(30);
  eq(calls.commit[0].disableReminders, true, '降级提交不建提醒');
  eq(calls.commit[0].cartId, 'cart-new', '首页挽回只提交本次新增项');
  eq(calls.toasts[calls.toasts.length - 1], '已加入 10月7日行程，未设置提醒', '反馈明确未设置提醒');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { Module._load = origLoad; console.error('测试异常:', err); process.exit(1); });
