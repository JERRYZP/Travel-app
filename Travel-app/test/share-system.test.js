/**
 * P0 + 最小 P1 分享体系回归。
 * 运行：node test/share-system.test.js
 */
const path = require('path');
const fs = require('fs');
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
  spotId: 'gugong', name: '故宫博物院', shortName: '故宫', reservationRequired: true, remindable: true,
  advanceDays: 7, releaseTime: '20:00', earliestDate: '2026-10-02',
  popularityScore: 5, closedDays: ['monday'], openDays: [],
};
const spotB = {
  spotId: 'guobo', name: '中国国家博物馆', shortName: '国博', reservationRequired: true, remindable: true,
  advanceDays: 7, releaseTime: '17:00', earliestDate: '2026-10-02',
  popularityScore: 5, closedDays: ['monday'], openDays: [],
};
const spotClosed = {
  spotId: 'closed', name: '今日闭馆', shortName: '今日闭馆', reservationRequired: true, remindable: true,
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
eq(scenes.getScene('today').navTitle, '北京今日放票', 'today 场景导航标题含地域词');
eq(scenes.getScene('national-day-2026').navTitle, '北京国庆抢票清单', '国庆场景导航标题含地域词');

console.log('\n=== 2.5 分享标题三分支（P1-3） ===');
const spotTiantan = {
  spotId: 'tiantan', name: '天坛公园', shortName: '天坛',
  reservationRequired: false, remindable: false, advanceDays: 7, releaseTime: '21:00',
};
const spotHuanqiu = {
  spotId: 'huanqiu-yingcheng', name: '北京环球影城', shortName: '环球影城',
  reservationRequired: true, remindable: false, advanceDays: 7,
};
const spotNoShortName = {
  spotId: 'junbo', name: '中国人民革命军事博物馆',
  reservationRequired: true, remindable: true, advanceDays: 7, releaseTime: ['08:00', '17:00', '20:00'],
};
eq(shareEntry.buildSpotSharePayload(spotTiantan).title, '天坛需要预约吗', '免预约景点分享标题');
eq(shareEntry.buildSpotSharePayload(spotHuanqiu).title, '环球影城门票预约与购票规则', '无固定放票时刻分享标题');
eq(shareEntry.buildSpotSharePayload(spotA).title, '故宫提前7天，20:00放票，先设提醒', '可提醒分享标题用短名');
eq(shareEntry.buildSpotSharePayload(spotNoShortName).title, '中国人民革命军事博物馆提前7天，08:00、17:00、20:00放票，先设提醒', '无短名回退全名');
eq(shareEntry.buildSpotSharePayload(null, 'gugong').title, '景点放票信息，先设提醒', '无景点数据兜底标题不变');

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
/* 页面接口测试只关心“今日场景有 2 条”，不要把周一闭馆夹具带进来；
   否则测试会在周一自然失效。闭馆过滤本身已在上面的纯函数测试覆盖。 */
const todayCards = [
  Object.assign({}, spotA, { closedDays: [] }),
  Object.assign({}, spotB, { closedDays: [] }),
];
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
  spotHub.onSpotPopupLoaded({ detail: { spot: spotA } });
  eq(pageCalls.titles[pageCalls.titles.length - 1], '故宫·门票预约·放票时间', '详情动态标题用短名且≤20字');
  const spotShare = spotHub.onShareAppMessage();
  eq(spotShare.path, '/pages/spot-hub/spot-hub?spotId=gugong&source=share', '景点分享路径');
  eq(spotShare.title, '故宫提前7天，20:00放票，先设提醒', '景点分享标题用短名');
  eq(spotShare.imageUrl, '/images/share/spot-hub.jpg', '景点详情分享封面');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram', spotShare.imageUrl)), true, '景点详情分享封面文件存在');
  eq(spotHub.onShareTimeline, undefined, '景点页不开放朋友圈单页');
  spotHub.onSpotPopupClose();
  const spotListShare = spotHub.onShareAppMessage();
  eq(spotListShare.title, '北京景点信息，一处查全，预约直达', '景点 Tab 分享标题');
  eq(spotListShare.imageUrl, '/images/share/spot-hub.jpg', '景点 Tab 分享封面');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram', spotListShare.imageUrl)), true, '景点 Tab 分享封面文件存在');

  const homePage = instantiate(loadPage('miniprogram/pages/home/home.js'));
  homePage.openSpotPopup('gugong');
  homePage.onSpotPopupLoaded({ detail: { spot: spotA } });
  const homeSpotShare = homePage.onShareAppMessage({ from: 'button' });
  eq(homeSpotShare.path, '/pages/spot-hub/spot-hub?spotId=gugong&source=share', '首页详情浮窗分享景点深链');
  eq(homeSpotShare.title, '故宫提前7天，20:00放票，先设提醒', '首页详情浮窗分享标题用短名');
  homePage.onSpotPopupClose();
  const homeShare = homePage.onShareAppMessage({ from: 'menu' });
  eq(homeShare.path,
    '/pages/share-scene/share-scene?sceneId=today&source=home_share', '首页菜单仍分享今日场景');
  eq(homeShare.title, '北京热门景点今日放票，一张表看完', '首页分享标题');
  eq(homeShare.imageUrl, '/images/share/home-today.jpg', '首页分享封面');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram', homeShare.imageUrl)), true, '首页分享封面文件存在');

  const scenePage = instantiate(loadPage('miniprogram/pages/share-scene/share-scene.js'));
  scenePage.onLoad({ sceneId: 'today', source: 'share' });
  await wait(10);
  eq(scenePage.data.sceneId, 'today', '场景页识别 today');
  eq(scenePage.data.rows.length, 2, '今日场景渲染两条');
  eq(pageCalls.titles[pageCalls.titles.length - 1], '北京今日放票', '场景页导航标题生效');
  const sceneShare = scenePage.onShareAppMessage();
  const timelineShare = scenePage.onShareTimeline();
  eq(sceneShare.path, '/pages/share-scene/share-scene?sceneId=today&source=share', '场景页会话分享路径');
  eq(timelineShare.query, 'sceneId=today&source=timeline', '场景页朋友圈 query');
  eq(/今天北京有2个热门景点放票/.test(timelineShare.title), true, '场景分享标题动态含数量');

  console.log('\n=== 5. 模板契约 ===');
  const popupWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxml'), 'utf8');
  const popupWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxss'), 'utf8');
  const hubWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.wxml'), 'utf8');
  const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.js'), 'utf8');
  const sceneJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/share-scene/share-scene.js'), 'utf8');
  eq(/open-type="share"/.test(popupWxml), true, '详情浮窗有可见转发按钮');
  eq(/<text>转发<\/text>/.test(popupWxml), false, '分享按钮不显示文字');
  eq(/\.popup-share-btn\s*\{[^}]*width:\s*68rpx[^}]*height:\s*68rpx[^}]*border-radius:\s*50%/.test(popupWxss), true,
    '分享按钮为放大的圆形图标按钮');
  eq(/landingMode/.test(popupWxml), true, '详情浮窗有首屏落地摘要');
  eq(/show-share="\{\{true\}\}"/.test(homeWxml), true, '首页详情浮窗开放分享按钮');
  eq(/bindtap="onCityTap"/.test(hubWxml), true, '景点页城市入口可点击');
  eq(/onCityTap\(\)[\s\S]*更多城市敬请期待/.test(hubJs), true, '城市入口提示更多城市敬请期待');
  eq(/onShareAppMessage/.test(hubJs), true, 'spot-hub 有会话分享处理');
  eq(/onShareTimeline/.test(hubJs), false, 'spot-hub 不开放朋友圈单页');
  eq(/onShareTimeline/.test(sceneJs), true, '场景页开放朋友圈单页');
  const spotsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spots/spots.json'), 'utf8'));
  const hubJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.json'), 'utf8'));
  eq(spotsJson.navigationBarTitleText, '北京景点门票预约·放票时间', 'spots 列表页静态标题');
  eq(hubJson.navigationBarTitleText, '北京景点预约·放票时间表', 'spot-hub 兜底静态标题保留');

  if (fail) {
    console.log(`\n${fail} FAILED`);
    process.exit(1);
  }
  console.log('\nALL PASS');
})();
