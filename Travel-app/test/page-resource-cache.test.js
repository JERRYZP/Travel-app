const assert = require('assert');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const origLoad = Module._load;
let pageDef = null;
global.Page = def => { pageDef = def; };
const appState = { globalData: { statusBarHeight: 20, navBarHeight: 44, membershipDataVersion: 0 } };
global.getApp = () => appState;
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  getAppAuthorizeSetting() {
    return { notificationAuthorized: 'authorized', notificationEnabled: true };
  },
  getSetting() {
    return Promise.resolve({});
  },
};

let cartBootstrapCalls = 0;
let userBootstrapCalls = 0;
const cartApi = {
  reminder: {
    cart: {
      bootstrap() {
        cartBootstrapCalls += 1;
        return Promise.resolve({
          success: true,
          summary: { count: 1, reminderCount: 1 },
          membership: { taskLimit: 5, taskUsed: 1, taskRemaining: 4 },
          packages: [],
          sales: { purchaseEnabled: true },
          subscription: {
            success: true,
            quota: 1,
            availableQuota: 1,
            pendingMessageCount: 0,
            level: 'ready',
            shortfall: 0,
          },
        });
      },
      list() { return Promise.resolve({ summary: { count: 0, reminderCount: 0 } }); },
    },
  },
  toastError() {},
};
const userApi = {
  reminder: {
    user: {
      bootstrap() {
        userBootstrapCalls += 1;
        return Promise.resolve({
          success: true,
          user: { nickname: '缓存用户', membership: {} },
          membership: {},
          sales: { purchaseEnabled: true },
          subscription: { level: 'ready', quota: 1, shortfall: 0 },
        });
      },
      profile() { return Promise.reject(new Error('unexpected legacy path')); },
    },
  },
  payment: { afterSales: { adminStatus: () => Promise.resolve({ isAdmin: false }) } },
  feedback: { adminStatus: () => Promise.resolve({ isAdmin: false }) },
  toastError() {},
};

const notifyStub = {
  getSystemNotifyOk: () => true,
  getReminderHealth: () => Promise.reject(new Error('cached subscription should be used')),
  requestSubscribeBurst: () => Promise.reject(new Error('not used')),
  getSubscribeQuota: () => Promise.reject(new Error('not used')),
};
const membershipCache = require('../miniprogram/utils/membership-cache.js');

function loadPage(rel, apiStub) {
  pageDef = null;
  Module._load = function (request) {
    if (request === '../../utils/api.js') return apiStub;
    if (request === '../../utils/notify.js') return notifyStub;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  Module._load = origLoad;
  return pageDef;
}

function instantiate(def) {
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return page;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const setup = instantiate(loadPage('miniprogram/pages/setup/setup.js', cartApi));
  setup.onShow();
  await wait(10);
  setup.onShow();
  await wait(10);
  assert.strictEqual(cartBootstrapCalls, 1, '设置页五分钟内重入不重复请求 bootstrap');
  membershipCache.markDirty();
  setup.onShow();
  await wait(10);
  assert.strictEqual(cartBootstrapCalls, 2, '会员状态写后版本变化时设置页绕过 5 分钟缓存');

  process.env.TZ = 'Asia/Shanghai';
  const profile = instantiate(loadPage('miniprogram/pages/profile/profile.js', userApi));
  profile.onShow();
  await wait(10);
  profile.onShow();
  await wait(10);
  assert.strictEqual(userBootstrapCalls, 1, '个人页五分钟内重入不重复请求 bootstrap');
  membershipCache.markDirty();
  profile.onShow();
  await wait(10);
  assert.strictEqual(userBootstrapCalls, 2, '会员状态写后版本变化时个人页绕过 5 分钟缓存');

  console.log('page-resource-cache.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
