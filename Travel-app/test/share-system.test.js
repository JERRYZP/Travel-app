/**
 * P0 + 最小 P1 分享体系回归。
 * 运行：node test/share-system.test.js
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

const shareEntry = require(path.join(ROOT, 'miniprogram/utils/share-entry.js'));
const release = require(path.join(ROOT, 'miniprogram/utils/release-context.js'));
const scenes = require(path.join(ROOT, 'miniprogram/utils/share-scenes.js'));

console.log('=== 1. 分享入口无身份参数 ===');
const parsed = shareEntry.parseEntryOptions({ query: {
  source: 'share',
  spotId: 'gugong',
  sceneId: 'today',
  nickname: 'should-not-be-used',
} });
eq(parsed.source, 'share', '解析 source');
eq(parsed.spotId, 'gugong', '解析 spotId');
eq(parsed.sceneId, 'today', '解析 sceneId');
eq(Object.prototype.hasOwnProperty.call(parsed, 'nickname'), false, '不保留昵称字段');
eq(shareEntry.buildSpotHubPath('gugong', 'share'), '/pages/spot-hub/spot-hub?spotId=gugong&source=share', '景点深链格式');
eq(shareEntry.buildScenePath('today', 'share'), '/pages/share-scene/share-scene?sceneId=today&source=share', '场景链接格式');
eq(shareEntry.buildSceneQuery('national-day-2026', 'timeline'), 'sceneId=national-day-2026&source=timeline', '朋友圈 query 格式');

console.log('\n=== 2. 北京时间场景计算 ===');
const now = new Date('2026-09-25T10:00:00Z'); // 北京时间 18:00
const spotA = {
  spotId: 'gugong', name: '故宫博物院', remindable: true,
  advanceDays: 7, releaseTime: '20:00', earliestDate: '2026-10-02',
  popularityScore: 5, closedDays: ['monday'], openDays: [],
};
const spotB = {
  spotId: 'guobo', name: '中国国家博物馆', remindable: true,
  advanceDays: 7, releaseTime: '17:00', earliestDate: '2026-10-02',
  popularityScore: 5, closedDays: ['monday'], openDays: [],
};
const spotClosed = {
  spotId: 'closed', name: '今日闭馆', remindable: true,
  advanceDays: 7, releaseTime: '09:00', earliestDate: '2026-10-02',
  popularityScore: 5, closedDays: ['friday'], openDays: [],
};
const todayRows = release.buildTodayRows([spotB, spotA, spotClosed], now);
eq(todayRows.length, 2, '闭馆景点排除');
eq(todayRows[0].spotId, 'gugong', '未到放票时刻排前');
eq(todayRows[1].spotId, 'guobo', '已放票景点排后');
eq(todayRows[0]._sceneStatus, '今日 20:00 放票', '今日状态文案');
eq(todayRows[1]._sceneEarliestText, '按规则推算，最早可约 10月2日', '最早可约口径');
eq(scenes.getScene('unknown').id, 'today', '未知场景回退今日');
eq(scenes.isSceneActive(scenes.getScene('national-day-2026'), new Date('2026-10-09T04:00:00Z')), false, '国庆页过期');
eq(scenes.buildSceneTitle(scenes.getScene('today'), 3), '今天北京有3个热门景点放票，时间都在这里', '今日分享标题含数量');

console.log('\n=== 3. 埋点只记公开字段并去重首个动作 ===');
const storage = {};
const events = [];
global.wx = {
  reportEvent(event, data) { events.push({ event, data }); },
  getStorageSync(key) { return storage[key] === undefined ? '' : storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
};
const analytics = require(path.join(ROOT, 'miniprogram/utils/analytics.js'));
const entry = { source: 'share', spotId: 'gugong', entryType: 'spot' };
analytics.captureLanding(entry, 'spot', Date.parse('2026-09-25T10:00:00Z'));
analytics.captureLanding(entry, 'spot', Date.parse('2026-09-26T10:00:00Z'));
analytics.trackFirstAction(entry, 'reminder');
analytics.trackFirstAction(entry, 'reminder');
const revisit = events.filter(e => e.event === 'share_revisit');
const firstActions = events.filter(e => e.event === 'share_first_action');
eq(revisit.length, 1, '跨日回访上报一次');
eq(typeof revisit[0].data.day_offset, 'number', 'day_offset 保持数字类型');
eq(firstActions.length, 1, '首次价值动作去重');
eq(Object.keys(firstActions[0].data).sort().join(','), 'entry_id,entry_type,source,share_action_type'.split(',').sort().join(','), '埋点只含公开字段');

console.log('\n=== 4. 页面分享接口 ===');
const app = {
  globalData: {
    statusBarHeight: 47, navBarHeight: 44, pendingShareEntry: null,
    envVersion: 'develop', previewNewUser: false, currentTripId: null,
  },
};
const pageCalls = { add: [], commit: [], toasts: [], loading: [], titles: [] };
const todayCards = [spotA, spotB];
const apiStub = {
  spots: {
    list: () => Promise.resolve({ data: todayCards }),
    batch: () => Promise.resolve({ data: todayCards }),
    detail: () => Promise.resolve({ data: Object.assign({}, spotA, {
      reservationRequired: true, difficultyLabel: { key: 'EXTREME', text: '极难约' },
      entries: [], lastCheckedDate: '2026-09-25', releaseTime: ['20:00'],
    }) }),
  },
  reminder: {
    home: { bootstrap: () => Promise.resolve({ trips: [], history: [] }) },
    cart: {
      add(data) { pageCalls.add.push(data); return Promise.resolve({ cartId: 'cart-1' }); },
      commit(data) {
        pageCalls.commit.push(data);
        return Promise.resolve({ createdItems: 1, createdTasks: 1, tripId: 'trip-1' });
      },
      remove() { return Promise.resolve({}); },
    },
  },
  toastError(err) { pageCalls.toasts.push(err && err.error); },
};
const notifyStub = {
  confirmReminderAccess: () => Promise.resolve({ action: 'ready' }),
  consumeFirstReminderSuccessTip: () => false,
  openSystemNotifySetting: () => {},
};

global.getApp = () => app;
global.getCurrentPages = () => [{ route: 'pages/share-scene/share-scene' }];
global.wx = Object.assign(global.wx || {}, {
  showLoading(o) { pageCalls.loading.push(o && o.title); },
  hideLoading() {},
  showToast(o) { pageCalls.toasts.push(o && o.title); },
  navigateTo() {},
  navigateBack() {},
  switchTab() {},
  redirectTo() {},
  setNavigationBarTitle(o) { pageCalls.titles.push(o.title); },
});

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
  page.data = JSON.parse(JSON.stringify(def.data || {}));
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

(async () => {
  const spotHub = instantiate(loadPage('miniprogram/pages/spot-hub/spot-hub.js'));
  spotHub.onLoad({ spotId: 'gugong', source: 'share' });
  await wait(10);
  eq(spotHub.data.showSpotPopup, true, 'spot-hub 深链拉起详情');
  eq(spotHub.data.popupSpotId, 'gugong', 'spot-hub spotId 正确');
  spotHub.onSpotPopupLoaded({ detail: { spot: Object.assign({}, spotA, { reservationRequired: true }) } });
  const spotShare = spotHub.onShareAppMessage();
  eq(spotShare.path, '/pages/spot-hub/spot-hub?spotId=gugong&source=share', '景点分享路径');
  eq(/故宫博物院/.test(spotShare.title), true, '景点分享标题含名称');
  eq(spotHub.onShareTimeline, undefined, '景点页不开放朋友圈单页');

  const scenePage = instantiate(loadPage('miniprogram/pages/share-scene/share-scene.js'));
  scenePage.onLoad({ sceneId: 'today', source: 'share' });
  await wait(10);
  eq(scenePage.data.sceneId, 'today', '场景页识别 today');
  eq(scenePage.data.rows.length, 2, '今日场景渲染两条');
  const sceneShare = scenePage.onShareAppMessage();
  const timelineShare = scenePage.onShareTimeline();
  eq(sceneShare.path, '/pages/share-scene/share-scene?sceneId=today&source=share', '场景页会话分享路径');
  eq(timelineShare.query, 'sceneId=today&source=timeline', '场景页朋友圈 query');
  eq(/今天北京有2个热门景点放票/.test(timelineShare.title), true, '场景分享标题动态含数量');

  console.log('\n=== 5. 模板契约 ===');
  const fs = require('fs');
  const popupWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxml'), 'utf8');
  const popupWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxss'), 'utf8');
  const hubWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.wxml'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.js'), 'utf8');
  const sceneJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/share-scene/share-scene.js'), 'utf8');
  eq(/open-type="share"/.test(popupWxml), true, '详情浮窗有可见转发按钮');
  eq(/<text>转发<\/text>/.test(popupWxml), false, '分享按钮不显示文字');
  eq(/\.popup-share-btn\s*\{[^}]*width:\s*68rpx[^}]*height:\s*68rpx[^}]*border-radius:\s*50%/.test(popupWxss), true,
    '分享按钮为放大的圆形图标按钮');
  eq(/landingMode/.test(popupWxml), true, '详情浮窗有首屏落地摘要');
  eq(/bindtap="onCityTap"/.test(hubWxml), true, '景点页城市入口可点击');
  eq(/onCityTap\(\)[\s\S]*更多城市敬请期待/.test(hubJs), true, '城市入口提示更多城市敬请期待');
  eq(/onShareAppMessage/.test(hubJs), true, 'spot-hub 有会话分享处理');
  eq(/onShareTimeline/.test(hubJs), false, 'spot-hub 不开放朋友圈单页');
  eq(/onShareTimeline/.test(sceneJs), true, '场景页开放朋友圈单页');

  if (fail) {
    console.log(`\n${fail} FAILED`);
    process.exit(1);
  }
  console.log('\nALL PASS');
})();
