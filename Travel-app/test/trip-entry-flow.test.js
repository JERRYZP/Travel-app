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

const calls = {
  add: [], commit: [], remove: [], updates: [], toasts: [], loading: [], access: [],
  navigations: [], payments: [], authRequests: [], planDates: [], planQuickDates: [], addDates: [],
  quickCommit: [],
};
let accessResult = { action: 'ready' };
let commitOverride = null;
let commitError = null;
let addOverride = null;
let addIdQueue = [];
let updateGate = null;
let paymentResult = { status: 'PAID_GRANTED', orderId: 'order-1' };
let authSystemOk = true;
let authLedgerQuota = 10;
let authAvailableQuota = 10;
let authPendingMessageCount = 0;
let membershipEnforced = false;
let membershipStatusOverride = null;
let planDatesOverride = null;
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
      planDates(data) {
        calls.planDates.push(JSON.parse(JSON.stringify(data)));
        if (planDatesOverride) return Promise.resolve(JSON.parse(JSON.stringify(planDatesOverride)));
        const remindOn = !(addOverride && addOverride.remindOn === false);
        const dates = (data.visitDates || []).map(visitDate => ({
          visitDate,
          status: remindOn ? 'REMINDABLE' : 'TRIP_ONLY',
          reason: remindOn ? '' : 'RELEASE_PASSED',
          releaseAt: null,
          addable: true,
          reminderAllowed: remindOn,
        }));
        return Promise.resolve({
          success: true,
          spotId: data.spotId,
          spotName: '故宫博物院',
          dates,
          summary: {
            requested: dates.length,
            addable: dates.length,
            reminder: remindOn ? dates.length : 0,
            tripOnly: remindOn ? 0 : dates.length,
            existing: 0,
            releasePassed: remindOn ? 0 : dates.length,
            noFixedRelease: 0,
            noReservation: 0,
          },
        });
      },
      planQuickDates(data) {
        calls.planQuickDates.push(JSON.parse(JSON.stringify(data)));
        return apiStub.reminder.cart.planDates(data);
      },
      addDates(data) {
        calls.addDates.push(JSON.parse(JSON.stringify(data)));
        return apiStub.reminder.cart.planDates(data).then(plan =>
          Promise.all(plan.dates.filter(row => row.addable).map(row =>
            apiStub.reminder.cart.add({
              spotId: data.spotId,
              visitDate: row.visitDate,
              remindOn: row.reminderAllowed,
            }).then(res => ({
              cartId: res.cartId,
              visitDate: row.visitDate,
              remindOn: res.remindOn !== false,
              status: row.status,
              reason: row.reason,
            }))
          )).then(items => ({
            ...plan,
            items,
            addedCartIds: items.map(item => item.cartId),
            added: items.length,
            addedReminders: items.filter(item => item.remindOn).length,
            addedTripOnly: items.filter(item => !item.remindOn).length,
          }))
        );
      },
      add(data) {
        calls.add.push(data);
        const cartId = addIdQueue.length ? addIdQueue.shift() : 'cart-new';
        return Promise.resolve(Object.assign({
          success: true,
          cartId,
          remindOn: data.remindOn !== false,
        }, addOverride || {}));
      },
      commit(data) {
        calls.commit.push(data);
        return commitResult(data, false);
      },
      quickCommit(data) {
        calls.commit.push(data);
        calls.quickCommit.push(JSON.parse(JSON.stringify(data)));
        return commitResult(data, true);
      },
      remove(cartId) {
        calls.remove.push(cartId);
        return Promise.resolve({ success: true });
      },
    },
    tripItem: {
      updateReminder(data) {
        calls.updates.push(data);
        return updateGate || Promise.resolve({ success: true, missedKept: false });
      },
    },
    membership: {
      status() {
        if (membershipStatusOverride) return Promise.resolve(membershipStatusOverride);
        return Promise.resolve({
          success: true,
          enforced: membershipEnforced,
          membership: {
            member: false,
            taskLimit: 5,
            taskUsed: 0,
            taskRemaining: 5,
            freeTaskSlots: 5,
            memberTaskSlots: 10000,
            memberDurationDays: 30,
          },
          packages: [],
        });
      },
    },
  },
};

function commitResult(data, quickCommit) {
        if (commitError) {
          if (commitError.errorCode === 1008 && commitError.subscription) {
            authAvailableQuota = Number(commitError.subscription.availableQuota) || 0;
            authLedgerQuota = Number(commitError.subscription.quota) || authAvailableQuota;
          }
          return Promise.reject(commitError);
        }
        if (commitOverride) return Promise.resolve(Object.assign({}, commitOverride));
        const disabled = data && data.disableReminders === true;
        const count = quickCommit
          ? (Array.isArray(data && data.visitDates) ? data.visitDates.length : 1)
          : (Array.isArray(data && data.cartIds) ? data.cartIds.length : 1);
        return Promise.resolve({
          success: true,
          createdItems: count,
          createdTasks: disabled ? 0 : count,
          addedTripItemCount: count,
          noReminder: disabled ? count : 0,
          disableReminders: disabled,
          tripId: 'trip-1',
        });
}

const notifyStub = {
  SUBSCRIBE_TEMPLATE_ID: 'test-template',
  getSystemNotifyOk: () => authSystemOk,
  getSubscribeQuota: () => Promise.resolve({
    ok: true,
    quota: authLedgerQuota,
    availableQuota: authAvailableQuota,
    pendingMessageCount: authPendingMessageCount,
  }),
  requestSubscribeBurst: () => {
    calls.authRequests.push(true);
    authLedgerQuota += 1;
    authAvailableQuota += 1;
    return Promise.resolve({ ok: true, added: 1, silent: false, remembered: false, shortfall: 0 });
  },
  openSystemNotifySetting: () => {},
  getReminderQuotaNeeded: () => Promise.resolve(1),
  confirmReminderAccess: needed => {
    calls.access.push(Object.assign({ needed }, accessResult));
    return Promise.resolve(accessResult);
  },
  showReminderAccessCancelled: access => {
    let title = '';
    if (access && access.action === 'cancelled') {
      if (access.reason === 'rejected') title = '已取消，本次未设置提醒';
      else if (access.reason === 'user-cancelled') title = '已取消，本次未设置提醒';
      else if (access.reason === 'quota-shortfall') title = '授权还未补齐，本次未设置提醒';
      else if (access.reason === 'request-failed') title = '授权未完成，本次未设置提醒';
    }
    if (title) calls.toasts.push(title);
    return !!title;
  },
  openReminderAccessSettings: () => {},
  consumeFirstReminderSuccessTip: () => false,
};

const membershipPayStub = {
  purchase(packageId) {
    calls.payments.push({ packageId });
    return Promise.resolve(paymentResult);
  },
  waitForPaid(orderId) {
    calls.payments.push({ orderId, waiting: true });
    return Promise.resolve(paymentResult);
  },
  clearPendingOrder() {},
};

global.getApp = () => app;
global.getCurrentPages = () => [{ route: 'pages/home/home' }];
global.wx = {
  showLoading: o => calls.loading.push('show:' + (o && o.title)),
  hideLoading: () => calls.loading.push('hide'),
  showToast: o => calls.toasts.push(o && o.title),
  navigateTo: o => calls.navigations.push(o && o.url),
  navigateBack: () => {},
  pageScrollTo: () => {},
  openSetting: () => {},
};

const origLoad = Module._load;
function loadPage(rel) {
  let def = null;
  global.Page = o => { def = o; };
  Module._load = function (request, parent) {
    if (request === '../../utils/api.js' || request === './api.js') return apiStub;
    if (request === '../../utils/notify.js' || request === './notify.js') return notifyStub;
    if (request === '../../utils/membership-pay.js' || request === './membership-pay.js') return membershipPayStub;
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

function loadComponent(rel) {
  let def = null;
  const prev = global.Component;
  global.Component = o => { def = o; };
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  global.Component = prev;
  return def;
}

function instantiateComponent(def) {
  const component = Object.assign({}, def.methods || {});
  component.data = JSON.parse(JSON.stringify(def.data || {}));
  component.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  component.triggerEvent = function (name, detail) { this.events.push({ name, detail }); };
  component.events = [];
  return component;
}

(async () => {
  console.log('=== 0. 日期弹层支持多选并返回本次全部日期 ===');
  const dateSheetDef = loadComponent('miniprogram/components/date-picker-sheet/date-picker-sheet.js');
  const dateSheet = instantiateComponent(dateSheetDef);
  Object.assign(dateSheet.data, {
    minDate: '2026-11-01',
    multiple: true,
    tripDates: [],
    bookedDates: [],
  });
  dateSheet.buildMonths();
  eq(dateSheet.data.selectionSummary, '可多选日期，一次添加', '多选模式初始说明可一次添加多个日期');
  dateSheet.onDayTap({ currentTarget: { dataset: { date: '2026-11-05', disabled: false } } });
  dateSheet.onDayTap({ currentTarget: { dataset: { date: '2026-11-03', disabled: false } } });
  eq(dateSheet.data.selectedCount, 2, '多选模式累计选择 2 天');
  eq(dateSheet.data.selectionSummary, '已选 2 天 · 11月3日、11月5日', '底部摘要列出已选日期');
  dateSheet.onConfirm();
  eq(dateSheet.events[0].detail.visitDates.join(','), '2026-11-03,2026-11-05',
    '确认时返回排序后的 visitDates');

  const singleDateSheet = instantiateComponent(dateSheetDef);
  Object.assign(singleDateSheet.data, {
    minDate: '2026-11-01',
    multiple: false,
    tripDates: [],
    bookedDates: [],
  });
  singleDateSheet.buildMonths();
  singleDateSheet.onDayTap({ currentTarget: { dataset: { date: '2026-11-06', disabled: false } } });
  singleDateSheet.onConfirm();
  eq(singleDateSheet.events[0].detail.visitDate, '2026-11-06', '首页等单选入口保持原返回结构');
  eq(singleDateSheet.events[0].detail.visitDates, undefined, '单选入口不额外返回 visitDates');

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
  eq(calls.commit[0].disableReminders, true, '加入时由最终提交明确不提醒');
  eq(calls.commit[0].visitDates.join(','), '2026-10-03', '快捷入口直接提交本次日期，不写主流程清单');
  eq(calls.commit[0].channels, undefined, '仅加行程不传提醒通道');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程，未设置提醒', '成功文案与实际动作一致');
  eq(calls.toasts.includes('提醒已开启'), false, '不再误报提醒已开启');

  console.log('\n=== 3. 景点页设置提醒，区分 ready / trip-only ===');
  calls.add = []; calls.commit = []; calls.toasts = [];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  hub.onDateConfirm({ detail: { visitDate: '2026-10-04' } });
  await wait(20);
  eq(calls.commit[0].channels[0], 'OFFICIAL_ACCOUNT', '授权足额时创建提醒任务');
  eq(calls.commit[0].visitDates.join(','), '2026-10-04', '提醒补录同样只提交本次日期');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见', '提醒成功文案明确');

  calls.add = []; calls.commit = []; calls.toasts = [];
  authAvailableQuota = 0; authLedgerQuota = 0;
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  const tripOnlyFlow = hub.onDateConfirm({ detail: { visitDate: '2026-10-05' } });
  await wait(20);
  eq(hub.data.showReminderAuth, true, '授权不足时展示固定授权浮层');
  eq(hub.data.reminderAuth.primaryText, '点击补授权次数', '固定按钮与 PAGE-008 使用同一文案');
  await hub.onReminderAuthTripOnly();
  await tripOnlyFlow;
  eq(calls.commit[0].disableReminders, true, '授权降级时仅落行程');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程，未设置提醒', '降级后不谎报提醒');

  console.log('\n=== 3.1 景点页授权不足时必须中止，不得静默建提醒 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = [];
  authAvailableQuota = 0; authLedgerQuota = 0;
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  const cancelledAuthFlow = hub.onDateConfirm({ detail: { visitDate: '2026-10-06' } });
  await wait(20);
  eq(calls.add.length, 0, '快捷入口不再先写主流程清单');
  eq(calls.commit.length, 0, '授权不足时绝不提交提醒');
  await hub.onReminderAuthClose();
  await cancelledAuthFlow;
  eq(calls.remove.length, 0, '未写暂存清单，中止时无需回滚');
  eq(calls.toasts[calls.toasts.length - 1], '已取消，本次未设置提醒', '明确告知用户未设置提醒');

  console.log('\n=== 3.2 景点页勾了提醒但已过放票时间，不得谎报提醒成功 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = [];
  commitOverride = { success: true, createdItems: 1, createdTasks: 0, expiredReminder: 1, noReminder: 1 };
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  hub.onDateConfirm({ detail: { visitDate: '2026-10-08' } });
  await wait(20);
  eq(calls.commit.length, 1, '仍提交行程项');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程 · 1 项已过放票时间，提醒无法设置',
    '过期提醒必须明确告知未设置');
  commitOverride = null;

  console.log('\n=== 3.3 服务端已降级提醒（放票已过）时不得再申请授权 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.access = [];
  addOverride = { remindOn: false };
  accessResult = { action: 'cancelled', reason: 'rejected' };
  hub.data.dateAction = { spotId: 'gugong', remindOn: true };
  const downgradedFlow = hub.onDateConfirm({ detail: { visitDate: '2026-10-09' } });
  await wait(20);
  eq(calls.access.length, 0, '服务端已把提醒降级为 false 时不再弹授权');
  eq(hub.data.datePlan.title, '所选日期已过放票时间，无法设置提醒',
    '日期降级时留在同一个浮层说明原因');
  eq(hub.data.datePlan.lines[0].text, '10月9日（已过放票时间）',
    '日期降级说明定位到具体日期');
  eq(calls.commit.length, 0, '用户确认“仅加入行程”前不自动提交');
  await hub.onReminderAuthContinue();
  await downgradedFlow;
  eq(calls.commit.length, 1, '仍把这一项加入行程');
  eq(calls.commit[0].disableReminders, true, '提交时明确不建提醒');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程 · 已过放票时间，提醒无法设置',
    '明确告诉用户为什么没有提醒');
  addOverride = null;

  console.log('\n=== 3.4 景点页多日期一次提交 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.access = []; calls.authRequests = [];
  addIdQueue = ['cart-multi-1', 'cart-multi-2'];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  eq(hub.data.dateMultiple, true, '景点页启用日期多选');
  hub.onDateConfirm({ detail: { visitDates: ['2026-11-03', '2026-11-05'] } });
  await wait(30);
  eq(calls.add.length, 0, '两个日期都不写主流程清单');
  eq(calls.commit.length, 1, '多日期只发起一次提交');
  eq(calls.commit[0].visitDates.join(','), '2026-11-03,2026-11-05', '只提交本次两个日期');
  eq(calls.commit[0].cartId, undefined, '多日期不误用单条 cartId');
  eq(calls.authRequests.length, 0, '授权足够时不再打开补授权浮层');
  eq(calls.toasts[calls.toasts.length - 1], '已加入 2 个日期 · 已设置 2 个提醒',
    '多日期成功反馈写明日期数与提醒数');

  console.log('\n=== 3.5 固定授权浮层逐次补 1 次后由用户继续 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.access = []; calls.authRequests = [];
  addIdQueue = ['cart-auth-1', 'cart-auth-2'];
  authAvailableQuota = 0; authLedgerQuota = 0;
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const fixedAuthFlow = hub.onDateConfirm({ detail: { visitDates: ['2026-11-01', '2026-11-02'] } });
  await wait(30);
  eq(hub.data.showReminderAuth, true, '授权不足时只打开一个固定浮层');
  eq(hub.data.reminderAuth.needed, 2, '浮层显示本次需要 2 次授权');
  eq(hub.data.reminderAuth.shortfall, 2, '浮层显示真实缺口');
  eq(calls.access.length, 0, '不再调用系统 ActionSheet');
  await hub.onReminderAuthPrimary();
  eq(hub.data.showReminderAuth, true, '补 1 次后固定浮层保持打开');
  eq(hub.data.reminderAuth.availableQuota, 1, '固定浮层刷新当前可用 1 次');
  eq(hub.data.reminderAuth.shortfall, 1, '固定浮层刷新还差 1 次');
  await hub.onReminderAuthPrimary();
  eq(calls.authRequests.length, 2, '两次用户点击各补 1 次授权');
  eq(hub.data.showReminderAuth, true, '补足授权后浮层保持打开');
  eq(hub.data.reminderCheckoutReady, true, '补足授权后底部主按钮启用');
  eq(calls.commit.length, 0, '授权完成本身不偷偷提交提醒');
  eq(hub.data.reminderAuthFeedback, '授权次数已满足，请点击“开启行程放票提醒”。',
    '浮层明确告诉用户下一步');
  await hub.onReminderAuthContinue();
  await fixedAuthFlow;
  eq(hub.data.showReminderAuth, false, '用户点击底部按钮后关闭浮层');
  eq(calls.commit.length, 1, '用户点击底部按钮后继续原提醒提交');
  eq(calls.toasts[calls.toasts.length - 1], '已加入 2 个日期 · 已设置 2 个提醒',
    '继续后反馈提醒设置完成');

  console.log('\n=== 3.6 授权与提醒名额检查合并到同一个浮层 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.authRequests = []; calls.quickCommit = [];
  addIdQueue = ['cart-unified'];
  authAvailableQuota = 10; authLedgerQuota = 10;
  membershipEnforced = true;
  membershipStatusOverride = {
    success: true,
    enforced: true,
    membership: {
      member: true,
      taskLimitUnlimited: true,
      taskLimit: 10000,
      taskUsed: 25,
      taskRemaining: 9975,
      memberExpiresAtText: '2026年11月30日',
      taskPackSize: 0,
    },
    packages: [{
      id: 'member', type: 'MEMBER', available: true,
      priceText: '¥6', addedSlots: 0, memberDays: 30, unlimitedReminders: true,
      actionText: '续费 30 天 ¥6', description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const unifiedCheckoutFlow = hub.onDateConfirm({ detail: { visitDates: ['2026-11-22'] } });
  await unifiedCheckoutFlow;
  eq(hub.data.showReminderAuth, false, '会员超过旧 15 条上限时不再打开名额付费浮层');
  eq(hub.data.membershipLimit, null, '有效会员没有提醒名额缺口');
  eq(calls.quickCommit.length, 1, '授权满足后直接提交会员的不限提醒');
  membershipEnforced = false;
  membershipStatusOverride = null;

  console.log('\n=== 3.7 名额不足时先支付后补授权，仍然自动完成原提醒 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.authRequests = [];
  calls.payments = []; calls.navigations = [];
  addIdQueue = ['cart-paid-auth'];
  authAvailableQuota = 0; authLedgerQuota = 0;
  membershipEnforced = true;
  membershipStatusOverride = {
    success: true,
    enforced: true,
    membership: {
      member: false,
      taskLimit: 5,
      taskUsed: 5,
      taskRemaining: 0,
      freeTaskSlots: 5,
      memberTaskSlots: 10000,
      memberDurationDays: 30,
    },
    packages: [{
      id: 'member', type: 'MEMBER', available: true,
      priceText: '¥6', addedSlots: 0, memberDays: 30, unlimitedReminders: true,
      actionText: '开通会员 ¥6', description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const paidThenAuthFlow = hub.onDateConfirm({ detail: { visitDates: ['2026-11-24'] } });
  await wait(30);
  eq(hub.data.reminderAuth.authReady, false, '同一浮层同时显示授权缺口');
  eq(Boolean(hub.data.membershipLimit), true, '同一浮层同时显示名额缺口');
  eq(await hub.onReminderAuthPay(), true, '授权未补齐时也可以打开名额支付确认');
  membershipEnforced = false;
  membershipStatusOverride = null;
  paymentResult = { status: 'PAID_GRANTED', orderId: 'order-paid-auth' };
  await hub.onReminderAuthPayConfirm();
  await wait(20);
  eq(calls.payments[0].packageId, 'member', '名额主按钮直接购买当前套餐');
  eq(calls.commit.length, 0, '授权仍有缺口时不提交提醒');
  eq(hub.data.taskLimitPayConfirm, null, '支付确认层在权益到账后关闭');
  eq(hub.data.showReminderAuth, true, '继续停留在设置提醒浮层补授权');
  eq(hub.data.reminderAuthFeedback, '权益已到账，还需补 1 次授权。',
    '支付后明确说明剩余授权动作');
  await hub.onReminderAuthPrimary();
  await wait(30);
  await paidThenAuthFlow;
  eq(calls.authRequests.length, 1, '用户只补了实际缺少的 1 次授权');
  eq(calls.commit.length, 1, '权益和授权齐备后自动重提原提醒');
  eq(calls.commit[0].visitDates.join(','), '2026-11-24', '自动重提仍使用原景点日期');
  eq(hub.data.showReminderAuth, false, '完成后关闭设置提醒浮层');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见',
    '支付后不要求再次点击底部按钮，直接反馈完成');

  console.log('\n=== 3.8 部分日期失效时先明确拆分，再按实际提醒数过闸门 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = [];
  calls.authRequests = []; calls.planDates = []; calls.addDates = [];
  addIdQueue = ['cart-mixed-1', 'cart-mixed-2'];
  authAvailableQuota = 1; authLedgerQuota = 1;
  planDatesOverride = {
    success: true,
    spotId: 'gugong',
    spotName: '故宫博物院',
    dates: [
      {
        visitDate: '2026-11-04', status: 'TRIP_ONLY', reason: 'RELEASE_PASSED',
        releaseAt: null, addable: true, reminderAllowed: false,
      },
      {
        visitDate: '2026-11-10', status: 'REMINDABLE', reason: '',
        releaseAt: null, addable: true, reminderAllowed: true,
      },
    ],
    summary: {
      requested: 2, addable: 2, reminder: 1, tripOnly: 1, existing: 0,
      releasePassed: 1, noFixedRelease: 0, noReservation: 0,
    },
  };
  commitOverride = {
    success: true,
    createdItems: 2,
    createdTasks: 1,
    addedTripItemCount: 2,
    addedReminderCount: 1,
    expiredReminder: 1,
    noReminder: 1,
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const mixedDateFlow = hub.onDateConfirm({
    detail: { visitDates: ['2026-11-04', '2026-11-10'] },
  });
  await wait(30);
  eq(hub.data.showReminderAuth, true, '部分日期失效时打开统一浮层');
  eq(hub.data.datePlan.title, '1 天可设提醒，1 天仅加入行程',
    '浮层明确拆分可提醒与仅行程日期');
  eq(hub.data.datePlan.lines[0].text, '11月10日',
    '浮层明确列出哪一天可设提醒');
  eq(hub.data.datePlan.lines[1].text, '11月4日（已过放票时间）',
    '浮层明确列出哪一天只能加入行程');
  eq(hub.data.reminderAuth.needed, 1, '授权只按实际可提醒日期计算');
  eq(hub.data.reminderAuth.authReady, true, '本例授权已经满足');
  eq(hub.data.reminderCheckoutReady, true, '满足闸门后底部按钮可继续');
  eq(calls.commit.length, 0, '存在日期降级时不自动提交');
  await hub.onReminderAuthContinue();
  await mixedDateFlow;
  eq(calls.commit.length, 1, '用户确认后才提交完整日期集合');
  eq(calls.commit[0].visitDates.join(','), '2026-11-04,2026-11-10',
    '过期日期仍按用户确认加入行程');
  eq(calls.toasts[calls.toasts.length - 1],
    '已加入 2 个日期 · 已设置 1 个提醒，1 项已过期',
    '最终反馈同时说明成功提醒数和过期数');
  planDatesOverride = null;
  commitOverride = null;

  console.log('\n=== 3.8.1 部分日期失效时可返回重选且不产生暂存 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = [];
  calls.authRequests = []; calls.planDates = []; calls.addDates = [];
  addIdQueue = ['cart-reselect-1', 'cart-reselect-2'];
  authAvailableQuota = 2; authLedgerQuota = 2;
  planDatesOverride = {
    success: true,
    spotId: 'gugong',
    spotName: '故宫博物院',
    dates: [
      {
        visitDate: '2026-11-04', status: 'TRIP_ONLY', reason: 'RELEASE_PASSED',
        releaseAt: null, addable: true, reminderAllowed: false,
      },
      {
        visitDate: '2026-11-10', status: 'REMINDABLE', reason: '',
        releaseAt: null, addable: true, reminderAllowed: true,
      },
    ],
    summary: {
      requested: 2, addable: 2, reminder: 1, tripOnly: 1, existing: 0,
      releasePassed: 1, noFixedRelease: 0, noReservation: 0,
    },
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const reselectFlow = hub.onDateConfirm({
    detail: { visitDates: ['2026-11-04', '2026-11-10'] },
  });
  await wait(30);
  await hub.onReminderAuthReselect();
  await reselectFlow;
  eq(calls.commit.length, 0, '重选日期时不提交任何提醒');
  eq(calls.remove.length, 0, '快捷入口未写暂存项，重选时无需清理');
  eq(hub.data.showDateSheet, true, '重选后重新打开日期选择器');
  planDatesOverride = null;

  console.log('\n=== 3.9 提交瞬间授权失效时回到同一浮层补齐并重试 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = [];
  calls.authRequests = []; calls.planDates = []; calls.addDates = [];
  addIdQueue = ['cart-race-auth'];
  authAvailableQuota = 1; authLedgerQuota = 1;
  commitError = {
    success: false,
    errorCode: 1008,
    error: '订阅消息授权次数不足',
    templateId: 'test-template',
    subscription: {
      required: 1,
      quota: 1,
      pendingMessageCount: 1,
      availableQuota: 0,
      shortfall: 1,
      messageCount: 1,
    },
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  await hub.onDateConfirm({ detail: { visitDates: ['2026-11-18'] } });
  await wait(20);
  eq(calls.commit.length, 1, '服务端在执行任务前再次校验订阅额度');
  eq(hub.data.showReminderAuth, true, '竞态失败后仍停留在设置提醒浮层');
  eq(hub.data.reminderAuth.shortfall, 1, '浮层刷新真实剩余缺口');
  eq(hub.data.reminderCheckoutReady, false, '授权不足时不能重试提交');
  eq(calls.remove.length, 0, '快捷入口不写暂存项，补授权无需保留草稿');

  commitError = null;
  await hub.onReminderAuthPrimary();
  eq(hub.data.reminderCheckoutReady, true, '补齐授权后启用底部按钮');
  await hub.onReminderAuthContinue();
  await wait(20);
  eq(calls.commit.length, 2, '用户确认后重试原提交');
  eq(calls.commit[1].visitDates.join(','), '2026-11-18', '重试仍使用原景点日期');
  eq(hub.data.showReminderAuth, false, '重试成功后关闭浮层');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见',
    '最终由服务端成功结果给出提醒完成反馈');

  console.log('\n=== 3.2 景点页多选超额先展示原因，不直接跳会员页 ===');
  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.access = []; calls.navigations = []; calls.payments = [];
  addIdQueue = ['cart-limit-1', 'cart-limit-2', 'cart-limit-3'];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  commitError = {
    success: false,
    errorCode: 1026,
    error: '提醒名额不足，请先开通会员',
    membership: {
      member: false,
      taskLimit: 5,
      taskUsed: 4,
      taskRemaining: 1,
      freeTaskSlots: 5,
      memberTaskSlots: 10000,
      memberDurationDays: 30,
    },
    taskLimit: { limit: 5, used: 4, remaining: 1, requested: 3, shortfall: 2 },
    packages: [{
      id: 'member',
      type: 'MEMBER',
      available: true,
      title: '会员',
      priceText: '¥6',
      addedSlots: 0,
      memberDays: 30,
      unlimitedReminders: true,
      actionText: '开通会员 ¥6',
      description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  hub.onDateConfirm({ detail: { visitDates: ['2026-11-12', '2026-11-14', '2026-11-16'] } });
  await wait(30);
  eq(hub.data.showReminderAuth, true, '超额后在同一提醒检查浮层显示名额说明');
  eq(hub.data.membershipLimit.title, '还差 2 个提醒名额', '浮层标题说明真实缺口');
  eq(hub.data.membershipLimit.limit, 5, '浮层展示服务端当前额度');
  eq(hub.data.membershipLimit.used, 4, '浮层展示服务端已占额度');
  eq(hub.data.membershipLimit.remaining, 1, '浮层展示服务端剩余额度');
  eq(hub.data.membershipLimit.requested, 3, '浮层展示本次新建数');
  eq(hub.data.membershipLimit.actionText, '开通会员 ¥6', '主按钮文案直接复用服务端套餐');
  eq(hub.data.membershipLimit.payText, '支付 ¥6，开通不限额度并继续',
    '名额主按钮直接说明支付后继续完成提醒');
  eq(calls.navigations.length, 0, '关闭说明前不自动跳会员页');
  await hub.onReminderAuthPay();
  eq(hub.data.taskLimitPayConfirm.title, '30 天不限提醒名额', '主按钮在原浮层内打开支付确认');
  eq(hub.data.taskLimitPayConfirm.amount, '¥6', '支付确认展示服务端金额');
  eq(hub.data.taskLimitPayButtonText, '支付 ¥6', '支付确认按钮明确金额');
  eq(calls.navigations.length, 0, '支付确认不跳会员页');
  hub.onReminderAuthPayClose();
  eq(hub.data.taskLimitPayConfirm, null, '取消确认只关闭支付确认，不丢当前名额说明');
  eq(hub.data.showReminderAuth, true, '关闭支付确认后仍停留在统一提醒检查浮层');
  await hub.onReminderAuthClose();
  await wait(10);
  eq(hub.data.showReminderAuth, false, '用户可以关闭统一提醒检查浮层');
  eq(calls.remove.length, 0, '快捷入口未写临时清单，关闭时无需清理');

  console.log('\n=== 3.3 有效会员超过旧 15 条上限也不再购买名额 ===');
  calls.add = []; calls.commit = []; calls.remove = []; calls.navigations = []; calls.payments = []; calls.toasts = []; calls.quickCommit = [];
  addIdQueue = ['cart-limit-member'];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  paymentResult = { status: 'PAID_GRANTED', orderId: 'order-limit' };
  commitError = null;
  membershipEnforced = true;
  membershipStatusOverride = {
    success: true,
    enforced: true,
    membership: {
      member: true,
      taskLimitUnlimited: true,
      taskLimit: 10000,
      taskUsed: 20,
      taskRemaining: 9980,
      memberExpiresAtText: '2026年11月30日',
      taskPackSize: 0,
    },
    packages: [{
      id: 'member',
      type: 'MEMBER',
      available: true,
      title: '会员 30 天',
      priceText: '¥6',
      addedSlots: 0,
      memberDays: 30,
      unlimitedReminders: true,
      actionText: '续费 30 天 ¥6',
      description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const memberOverOldCap = hub.onDateConfirm({ detail: { visitDates: ['2026-11-18'] } });
  await memberOverOldCap;
  eq(hub.data.membershipLimit, null, '有效会员不出现加购或续费拦截');
  eq(calls.payments.length, 0, '超过旧 15 条上限不发起支付');
  eq(calls.quickCommit.length, 1, '会员提醒直接提交');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见',
    '不限权益直接完成提醒');
  eq(calls.navigations.length, 0, '全程不跳会员页');
  membershipEnforced = false;
  membershipStatusOverride = null;

  calls.navigations = [];
  calls.remove = [];
  calls.payments = [];
  hub.data.membershipLimit = {
    packageId: 'member',
    used: 5,
    limit: 5,
    requested: 1,
    shortfall: 1,
  };
  hub._taskLimitClosing = false;
  await hub.onReminderAuthBenefits();
  await wait(10);
  eq(calls.remove.length, 0, '快捷入口未写临时清单，权益入口无需清理');
  eq(String(calls.navigations[0] || '').includes('packageId=member'), true, '权益入口仍保留唯一会员套餐意向');
  eq(calls.payments.length, 0, '权益入口不会发起支付');
  commitError = null;

  console.log('\n=== 3.4 原地支付结果待确认后可继续查单并完成提醒 ===');
  calls.add = []; calls.commit = []; calls.remove = []; calls.navigations = []; calls.payments = []; calls.toasts = [];
  addIdQueue = ['cart-pending'];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  paymentResult = { status: 'PENDING', orderId: 'order-pending' };
  commitError = {
    success: false,
    errorCode: 1026,
    membership: { member: false, taskUsed: 5, taskLimit: 5, taskRemaining: 0 },
    taskLimit: { limit: 5, used: 5, remaining: 0, requested: 1, shortfall: 1 },
    packages: [{
      id: 'member', type: 'MEMBER', available: true,
      priceText: '¥6', addedSlots: 0, memberDays: 30, unlimitedReminders: true,
      actionText: '开通会员 ¥6', description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  hub.onDateConfirm({ detail: { visitDates: ['2026-11-20'] } });
  await wait(30);
  await hub.onReminderAuthPay();
  commitError = null;
  await hub.onReminderAuthPayConfirm();
  eq(hub.data.showReminderAuth, true, '支付结果待确认时保留统一提醒检查浮层');
  eq(hub.data.taskLimitPayButtonText, '继续确认支付结果', '待确认时提供继续查单入口');
  eq(calls.commit.length, 1, '权益未确认前不重提提醒');
  paymentResult = { status: 'PAID_GRANTED', orderId: 'order-pending' };
  await hub.onReminderAuthPayConfirm();
  await wait(20);
  eq(calls.payments[1].waiting, true, '第二次点击改为继续查询同一订单');
  eq(calls.commit.length, 2, '权益确认后继续原提醒提交');
  eq(hub.data.showReminderAuth, false, '继续确认成功后关闭统一提醒检查浮层');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见',
    '待确认订单最终完成后反馈提醒已设置');
  commitError = null;

  calls.add = []; calls.commit = []; calls.remove = []; calls.toasts = [];
  addIdQueue = ['cart-unknown'];
  accessResult = { action: 'ready' };
  authAvailableQuota = 10; authLedgerQuota = 10;
  paymentResult = { status: 'PAID_GRANT_UNKNOWN', orderId: 'order-unknown' };
  commitError = {
    success: false,
    errorCode: 1026,
    membership: { member: false, taskUsed: 5, taskLimit: 5, taskRemaining: 0 },
    taskLimit: { limit: 5, used: 5, remaining: 0, requested: 1, shortfall: 1 },
    packages: [{
      id: 'member', type: 'MEMBER', available: true,
      priceText: '¥6', addedSlots: 0, memberDays: 30, unlimitedReminders: true,
      actionText: '开通会员 ¥6', description: '会员有效期内不限提醒名额',
    }],
  };
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  hub.onDateConfirm({ detail: { visitDates: ['2026-11-21'] } });
  await wait(30);
  await hub.onReminderAuthPay();
  commitError = null;
  await hub.onReminderAuthPayConfirm();
  eq(hub.data.taskLimitPayButtonText, '继续确认支付结果', '权益未知时保留继续核验入口');
  eq(/权益待核验/.test(hub.data.taskLimitPayFeedback), true, '权益未知时明确提示正在核验');
  eq(calls.commit.length, 1, '权益未知时不会误继续提交提醒');
  commitError = null;

  calls.add = []; calls.commit = []; calls.toasts = []; calls.remove = []; calls.access = [];
  addIdQueue = ['cart-cancel-1', 'cart-cancel-2'];
  authAvailableQuota = 0; authLedgerQuota = 0;
  await hub.openDateSheet('gugong', '故宫博物院', '设置提醒', true, { multiple: true });
  const cancelMultiFlow = hub.onDateConfirm({ detail: { visitDates: ['2026-11-07', '2026-11-09'] } });
  await wait(30);
  await hub.onReminderAuthClose();
  await cancelMultiFlow;
  eq(calls.commit.length, 0, '授权取消时多日期不提交');
  eq(calls.remove.length, 0, '未写暂存清单，授权取消时无需回滚');

  console.log('\n=== 4. 首页“约其他日”复用单日期提醒流程 ===');
  const home = instantiate(loadPage('miniprogram/pages/home/home.js'));
  home.data.trips = JSON.parse(JSON.stringify(bootstrap.trips));
  home.data.history = JSON.parse(JSON.stringify(bootstrap.history));
  home.data.trips[0].items[0].spotName = '故宫博物院';
  home.data.recoveryPromptIds = ['i1'];
  let homeReloads = 0;
  home.loadHome = () => { homeReloads += 1; };
  home.onRecover({ detail: { itemId: 'i1' } });
  eq(home.data.showDateSheet, true, '首页打开单日期选择器');
  eq(home.data.dateMultiple, false, '首页约其他日仍为单选');
  eq(home.data.dateAction.spotId, 'gugong', '共享流程拿到本次景点');
  eq(home.data.dateAction.remindOn, true, '首页挽回默认设置提醒');

  calls.add = []; calls.commit = []; calls.toasts = []; calls.loading = [];
  calls.planDates = []; calls.planQuickDates = []; calls.addDates = []; calls.quickCommit = []; calls.navigations = [];
  authAvailableQuota = 1; authLedgerQuota = 1;
  membershipStatusOverride = null;
  const okFlow = home.onRecoverConfirm({ detail: { visitDate: '2026-10-06' } });
  await okFlow;
  eq(calls.loading[0], 'show:正在设置...', '提交期间有加载反馈');
  eq(calls.loading[calls.loading.length - 1], 'hide', '完成后收起加载');
  eq(calls.planDates[0].visitDates.join(','), '2026-10-06', '共享流程只提交首页选中的一个日期');
  eq(calls.quickCommit[0].visitDates.join(','), '2026-10-06', '快捷提交同样只针对一个日期');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见', '约其他日复用景点页成功反馈');
  eq(home.data.recoveryPromptIds.length, 0, '提交成功后收起即时挽回气泡');
  eq(homeReloads, 1, '共享流程完成后刷新首页聚合数据');

  console.log('\n=== 4.1 首页约其他日：授权不足留在统一浮层 ===');
  calls.commit = []; calls.toasts = []; calls.navigations = []; calls.authRequests = [];
  authAvailableQuota = 0; authLedgerQuota = 0;
  home.data.dateAction = { spotId: 'gugong', remindOn: true };
  const authFlow = home.onRecoverConfirm({ detail: { visitDate: '2026-10-07' } });
  await wait(30);
  eq(home.data.showReminderAuth, true, '授权不足时打开同一个固定提醒浮层');
  eq(home.data.reminderAuth.needed, 1, '首页只按单个日期计算 1 条提醒');
  eq(home.data.reminderAuth.shortfall, 1, '浮层显示真实授权缺口');
  eq(home.data.membershipLimit, null, '仅授权不足时不混入会员卡');
  eq(calls.navigations.length, 0, '授权不足不得直接跳会员页');

  authAvailableQuota = 1; authLedgerQuota = 1;
  await home.onReminderAuthPrimary();
  await wait(20);
  await home.onReminderAuthContinue();
  await authFlow;
  eq(calls.authRequests.length, 1, '一次点击只补一次授权');
  eq(calls.commit.length, 1, '补齐授权后继续原单日期提交');
  eq(calls.toasts[calls.toasts.length - 1], '提醒已设置，放票前见', '补齐授权后完成原提醒');

  console.log('\n=== 4.2 首页约其他日：名额不足在同一浮层支付 ===');
  calls.commit = []; calls.toasts = []; calls.navigations = []; calls.payments = [];
  authAvailableQuota = 1; authLedgerQuota = 1;
  membershipStatusOverride = {
    success: true,
    enforced: true,
    membership: {
      member: false,
      taskLimit: 5,
      taskUsed: 5,
      taskRemaining: 0,
      freeTaskSlots: 5,
      memberTaskSlots: 10000,
      memberDurationDays: 30,
    },
    packages: [{
      id: 'member', type: 'MEMBER', available: true,
      priceText: '¥6', addedSlots: 0, memberDays: 30, unlimitedReminders: true,
      actionText: '开通会员 ¥6', description: '会员有效期内不限提醒名额',
    }],
  };
  home.data.dateAction = { spotId: 'gugong', remindOn: true };
  const limitFlow = home.onRecoverConfirm({ detail: { visitDate: '2026-10-08' } });
  await wait(30);
  eq(home.data.showReminderAuth, true, '名额不足时仍停在统一提醒浮层');
  eq(home.data.membershipLimit.shortfall, 1, '浮层展示名额缺口');
  eq(calls.navigations.length, 0, '名额不足不得直接跳会员页');

  await home.onReminderAuthPay();
  eq(Boolean(home.data.taskLimitPayConfirm), true, '首页原浮层内打开支付确认');
  eq(calls.navigations.length, 0, '支付确认前不发生会员页跳转');
  paymentResult = { status: 'PAID_GRANTED', orderId: 'order-home-limit' };
  membershipStatusOverride = Object.assign({}, membershipStatusOverride, {
    membership: Object.assign({}, membershipStatusOverride.membership, {
      member: true,
      taskLimitUnlimited: true,
      taskUsed: 0,
      taskLimit: 10000,
      taskRemaining: 10000,
    }),
  });
  await home.onReminderAuthPayConfirm();
  await wait(20);
  await home.onReminderAuthContinue();
  await limitFlow;
  eq(calls.payments.length, 1, '用户主动确认后才发起支付');
  eq(calls.commit.length, 1, '权益到账后自动继续原单日期提醒');
  eq(calls.navigations.length, 0, '全程不跳会员页');
  membershipStatusOverride = null;

  console.log('\n=== 5. 首页约其他日：日期只能加行程时同一浮层说明 ===');
  calls.commit = []; calls.toasts = []; calls.remove = [];
  authAvailableQuota = 1; authLedgerQuota = 1;
  planDatesOverride = {
    success: true,
    spotId: 'gugong',
    spotName: '故宫博物院',
    dates: [{
      visitDate: '2026-10-10',
      status: 'TRIP_ONLY',
      reason: 'RELEASE_PASSED',
      releaseAt: null,
      addable: true,
      reminderAllowed: false,
    }],
    summary: {
      requested: 1, addable: 1, reminder: 0, tripOnly: 1,
      existing: 0, releasePassed: 1, noFixedRelease: 0, noReservation: 0,
    },
  };
  home.data.dateAction = { spotId: 'gugong', remindOn: true };
  const homeTripOnlyFlow = home.onRecoverConfirm({ detail: { visitDate: '2026-10-10' } });
  await wait(30);
  eq(home.data.showReminderAuth, true, '只能加入行程时先停在统一浮层');
  eq(home.data.datePlan.title, '所选日期已过放票时间，无法设置提醒', '浮层解释真实原因');
  await home.onReminderAuthContinue();
  await wait(20);
  await homeTripOnlyFlow;
  eq(calls.commit[0].disableReminders, true, '用户确认后仅加入行程');
  eq(calls.toasts[calls.toasts.length - 1], '已加入行程 · 已过放票时间，提醒无法设置',
    '明确说明提醒未设置');
  planDatesOverride = null;

  console.log('\n=== 6.2 mock 多日期提交只消费指定条目 ===');
  const mock = require('../miniprogram/utils/mock.js');
  const mockA = await mock.mockCall('cart.add', {
    spotId: 'gugong', visitDate: '2032-01-03', remindOn: false,
  });
  const mockB = await mock.mockCall('cart.add', {
    spotId: 'gugong', visitDate: '2032-01-05', remindOn: false,
  });
  await mock.mockCall('cart.add', {
    spotId: 'guobo', visitDate: '2032-01-06', remindOn: false,
  });
  const mockCommitted = await mock.mockCall('cart.commit', {
    cartIds: [mockA.cartId, mockB.cartId],
    disableReminders: true,
  });
  eq(mockCommitted.createdItems, 2, 'mock 一次提交两个指定日期');
  eq(Object.values(mock.__internals.db.carts).length, 1, 'mock 保留未选中的暂存草稿');

  console.log('\n=== 7. 首页行程项开启提醒：拒绝授权不得写接口 ===');
  home.loadHome = () => {};
  home.data.trips = [{
    _id: 'trip-1',
    items: [{ itemId: 'i-remind', spotId: 'gugong', reminder: { state: 'NOT_SET' } }],
  }];
  home.data.history = [];
  calls.updates = []; calls.toasts = [];
  accessResult = { action: 'cancelled', reason: 'rejected' };
  home.onEditReminder({ detail: { itemId: 'i-remind' } });
  await wait(20);
  eq(calls.updates.length, 0, '拒绝授权后不调用 updateReminder');
  eq(calls.toasts[calls.toasts.length - 1], '已取消，本次未设置提醒', '开启提醒被拒绝时有明确反馈');
  eq(home._reminderToggleBusy, false, '拒绝后释放防连点锁');

  console.log('\n=== 8. 首页行程项开启提醒：写接口完成前保持锁定 ===');
  let resolveUpdate;
  updateGate = new Promise(resolve => { resolveUpdate = resolve; });
  calls.updates = []; calls.toasts = [];
  accessResult = { action: 'ready' };
  home.onEditReminder({ detail: { itemId: 'i-remind' } });
  await wait(20);
  eq(calls.updates.length, 1, '授权足额后只提交一次开启');
  eq(calls.updates[0].remindOn, true, '提交方向是开启提醒');
  eq(home._reminderToggleBusy, true, '写接口完成前保持锁定，防重复点击');
  resolveUpdate({ success: true, missedKept: false });
  await wait(20);
  eq(home._reminderToggleBusy, false, '写接口完成后释放锁');
  updateGate = null;

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { Module._load = origLoad; console.error('测试异常:', err); process.exit(1); });
