/**
 * PAGE-018 前端分享入口、浮层与只读落地页回归。
 * 运行：node test/trip-share-ui.test.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const HOME_JS_PATH = path.join(ROOT, 'miniprogram/pages/home/home.js');
const VIEW_JS_PATH = path.join(ROOT, 'miniprogram/pages/trip-share/trip-share.js');
const VIEW_WXML_PATH = path.join(ROOT, 'miniprogram/pages/trip-share/trip-share.wxml');
const VIEW_WXSS_PATH = path.join(ROOT, 'miniprogram/pages/trip-share/trip-share.wxss');
const SHEET_WXML_PATH = path.join(ROOT, 'miniprogram/components/trip-share-sheet/trip-share-sheet.wxml');
const SUMMARY_WXML_PATH = path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.wxml');
const SUMMARY_WXSS_PATH = path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.wxss');
const HOME_WXML_PATH = path.join(ROOT, 'miniprogram/pages/home/home.wxml');
const HOME_JSON_PATH = path.join(ROOT, 'miniprogram/pages/home/home.json');
const APP_JSON_PATH = path.join(ROOT, 'miniprogram/app.json');
const WECHAT_WHITE_ICON_PATH = path.join(ROOT, 'miniprogram/images/icons/wechat-white.svg');
const tripShareCover = require('../miniprogram/utils/trip-share-cover.js');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const apiCalls = { create: [], status: [], revoke: [], open: [] };
let openError = null;
let generatedCoverPath = '/tmp/trip-share-cover.jpg';
const apiStub = {
  reminder: {
    home: { bootstrap: () => Promise.resolve({ trips: [], history: [] }) },
    tripShare: {
      create(data) {
        apiCalls.create.push(data);
        return Promise.resolve({
          success: true,
          ownerNickname: '小可爱',
          token: 'a'.repeat(64),
          expiresOn: '2026-11-12',
          reused: false,
        });
      },
      status(data) {
        apiCalls.status.push(data);
        return Promise.resolve({
          success: true,
          ownerNickname: '小可爱',
          status: 'ACTIVE',
          token: 'b'.repeat(64),
          expiresOn: '2026-11-12',
        });
      },
      revoke(data) {
        apiCalls.revoke.push(data);
        return Promise.resolve({ success: true, revoked: true });
      },
      open(token) {
        apiCalls.open.push(token);
        if (openError) return Promise.reject(openError);
        return Promise.resolve({
          success: true,
          share: { readOnly: true, expiresOn: '2026-11-12' },
          trip: {
            city: '北京',
            startDate: '2026-11-02',
            endDate: '2026-11-04',
            dayCount: 3,
            spotCount: 2,
            days: [
              {
                visitDate: '2026-11-02',
                dayNumber: 1,
                items: [{ spotId: 'gugong', spotName: '故宫博物院' }],
              },
              {
                visitDate: '2026-11-03',
                dayNumber: 2,
                items: [
                  { spotId: 'gugong', spotName: '故宫博物院' },
                  { spotId: 'guobo', spotName: '中国国家博物馆' },
                ],
              },
            ],
          },
        });
      },
    },
  },
  toastError() {},
};

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  reportEvent: () => {},
  showToast: () => {},
  showModal: options => options.success({ confirm: true, cancel: false }),
  hideShareMenu: () => { global.__hideShareCalls = (global.__hideShareCalls || 0) + 1; },
  stopPullDownRefresh: () => {},
  navigateBack: () => {},
  reLaunch: () => {},
};
global.getApp = () => ({
  globalData: {
    statusBarHeight: 44,
    navBarHeight: 44,
    envVersion: 'develop',
    serverSkewMs: 0,
  },
});
global.getCurrentPages = () => [{ route: 'pages/trip-share/trip-share' }];

function loadPage(file, api) {
  let pageDef = null;
  const origLoad = Module._load;
  global.Page = def => { pageDef = def; };
  Module._load = function (request) {
    if (request === '../../utils/api.js') return api;
    if (request === '../../utils/trip-share-cover.js') {
      return {
        FALLBACK_IMAGE: '/images/share/home-today.jpg',
        generate: () => Promise.resolve(generatedCoverPath),
      };
    }
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(file)];
  require(file);
  Module._load = origLoad;
  const page = Object.assign({}, pageDef);
  page.data = JSON.parse(JSON.stringify(pageDef.data || {}));
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (typeof cb === 'function') cb();
  };
  return page;
}

(async () => {
  console.log('=== 1. 模板与路由 ===');
  const appJson = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
  const homeJson = JSON.parse(fs.readFileSync(HOME_JSON_PATH, 'utf8'));
  const homeWxml = fs.readFileSync(HOME_WXML_PATH, 'utf8');
  const sheetWxml = fs.readFileSync(SHEET_WXML_PATH, 'utf8');
  const summaryWxml = fs.readFileSync(SUMMARY_WXML_PATH, 'utf8');
  const summaryWxss = fs.readFileSync(SUMMARY_WXSS_PATH, 'utf8');
  const viewWxml = fs.readFileSync(VIEW_WXML_PATH, 'utf8');
  const viewWxss = fs.readFileSync(VIEW_WXSS_PATH, 'utf8');
  const viewJs = fs.readFileSync(VIEW_JS_PATH, 'utf8');

  eq(appJson.pages.includes('pages/trip-share/trip-share'), true, '只读分享页已注册');
  eq(homeJson.usingComponents['trip-share-sheet'], '/components/trip-share-sheet/trip-share-sheet', '首页装载分享浮层');
  eq(/show-share-action="\{\{showTripShareAction\}\}"/.test(homeWxml), true,
    '首页把分享可见状态传给摘要卡');
  eq(/bind:share="onTripShareTap"/.test(homeWxml), true, '首页接收摘要卡的分享事件');
  eq(/class="sm-share-hit" bindtap="onShareTap"/.test(summaryWxml), true,
    '分享入口位于摘要卡标题行最右侧');
  const headStart = summaryWxml.indexOf('class="sm-head"');
  const nameAt = summaryWxml.indexOf('class="sm-name"', headStart);
  const markAt = summaryWxml.indexOf('class="sm-mark"', headStart);
  const shareAt = summaryWxml.indexOf('class="sm-share-hit"', headStart);
  eq(nameAt > headStart && markAt > nameAt && shareAt > markAt, true,
    '北京之行、装饰英文和分享入口按同一行顺序渲染');
  eq(/class="trip-share-entry"/.test(homeWxml), false,
    '摘要卡外不再有参与文档流的分享行');
  eq(/\.sm-share-hit\s*\{[^}]*margin-left:\s*auto/.test(summaryWxss), true,
    '分享入口固定在标题行最右侧');
  eq(/\.sm-share-action\s*\{[^}]*background:/.test(summaryWxss), true,
    '分享入口有独立底色以保证渐变卡上的对比度');
  eq(/\.sm-share-action\s*\{[^}]*border:\s*0/.test(summaryWxss), true,
    '分享入口使用纯底色，不显示描边');
  eq(/<svg-icon name="wechat-linear" size="15\.3px"/.test(summaryWxml), true,
    '微信图标缩到原 17px 的 90%');
  eq(/\.sm-share-action\s*\{[^}]*font-size:\s*23rpx/.test(summaryWxss), true,
    '分享文案字号上调一级');
  eq(/\.sm-mark-ch\s*\{\s*margin-left:\s*\.32em/.test(summaryWxss), true,
    '装饰英文使用收紧后的行内字距');
  eq(/<canvas type="2d" id="trip-share-cover-canvas"/.test(homeWxml), true,
    '首页提供离屏 Canvas 2D 用于生成会话封面');
  eq(/safe-top=/.test(homeWxml), false,
    '页面不再用摘要卡局部安全间距打补丁');
  eq(/open-type="share"[\s\S]*data-share-kind="trip"/.test(sheetWxml), true, '浮层用原生分享按钮并在就绪后开放');
  eq(/<svg-icon name="wechat-white" size="28rpx"/.test(sheetWxml), true,
    '分享按钮使用无底色白色微信图标，尺寸与文案接近');
  eq(fs.existsSync(WECHAT_WHITE_ICON_PATH), true, '白色微信图标资源存在');
  eq(/获得链接的人只能查看，不能编辑或复制行程/.test(sheetWxml), true, '浮层明确只读边界');
  eq(/行程结束后 7 天失效/.test(sheetWxml), true, '浮层明确失效规则');
  eq(/this\.data\.summaryTrip/.test(fs.readFileSync(HOME_JS_PATH, 'utf8')), true, '分享入口读取摘要卡当前行程');
  eq(/wx\.hideShareMenu/.test(viewJs), true, '只读页隐藏微信转发菜单');
  eq(/onShareAppMessage|onShareTimeline/.test(viewJs), false, '只读页不实现二次转发');
  eq(/ticketState|reminderState|menuId|bindtap="onSpot/.test(viewWxml), false, '只读模板不含票务、提醒、菜单或景点动作');
  eq(/class="ts-home-float" bindtap="goHome"/.test(viewWxml), true,
    '只读页提供常驻返回首页按钮');
  eq(/background:\s*linear-gradient\(160deg, #C65941 12\.9%, #B8432A 87\.46%\)/.test(viewWxss), true,
    '只读总览卡复用首页朱砂渐变');
  eq(/\.ts-hero-mark-ch\s*\{\s*margin-left:\s*\.32em/.test(viewWxss), true,
    '只读总览卡复用首页装饰英文与字距');
  eq(/\.ts-home-float\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(40px \+ env\(safe-area-inset-bottom\)\)/.test(viewWxss), true,
    '返回首页按钮悬浮在页面底部安全区上方');
  eq(/wx:for="\{\{trip\.days\}\}"/.test(viewWxml), true, '整趟全部日期直接渲染');
  eq(/word-break:\s*break-all/.test(viewWxss), true, '长景点名允许换行，不撑破容器');

  console.log('=== 2. 首页两步分享与菜单分享互不串线 ===');
  const home = loadPage(HOME_JS_PATH, apiStub);
  const trip = {
    _id: 'TRIP_CURRENT',
    city: '北京',
    startDate: '2026-11-02',
    endDate: '2026-11-04',
    itemCount: 2,
    items: [{ itemId: 'i1' }, { itemId: 'i2' }],
    shareActive: false,
  };
  home.setData({
    trips: [trip],
    history: [],
    primaryTrip: trip,
    summaryTrip: trip,
    showTripShareAction: true,
    tripShareActionLabel: '分享行程',
  });
  home.onTripShareTap();
  await wait(5);
  eq(apiCalls.create.length, 1, '打开浮层后先创建/读取令牌');
  eq(home.data.tripShareSheet.state, 'ready', '令牌就绪后浮层进入可分享态');
  eq(home.data.tripShareSheet.hasActive, false, '首次创建链接仍显示分享态');
  eq(home.data.tripShareSheet.shareReady, true, '原生分享按钮只在令牌就绪后开放');
  eq(home.data.tripShareActionLabel, '分享行程', '已有有效分享时入口文案仍为分享行程');
  eq(home._tripSharePath, `/pages/trip-share/trip-share?token=${'a'.repeat(64)}&source=share`,
    '分享路径只携带令牌和来源');

  const tripShare = home.onShareAppMessage({
    target: { dataset: { shareKind: 'trip' } },
  });
  eq(tripShare.path, home._tripSharePath, '分享回调返回当前行程路径');
  eq(tripShare.title, '小可爱分享给你的北京之行，点开看看吧',
    '会话卡片标题使用应用内昵称，不使用真实微信昵称');
  eq(tripShare.imageUrl, generatedCoverPath,
    '原生分享使用当前行程生成的界面封面');

  const coverModel = tripShareCover.buildModel(Object.assign({}, trip, {
    items: [
      {
        itemId: 'i1',
        spotId: 'gugong',
        spotName: '故宫博物院',
        visitDate: '2026-11-02',
        ticketState: 'SUCCESS',
        reminder: 'WAITING',
        result: 'SUCCESS',
      },
      {
        itemId: 'i2',
        spotId: 'guobo',
        spotName: '中国国家博物馆',
        visitDate: '2026-11-03',
      },
    ],
  }));
  eq(coverModel.first.spotName, '故宫博物院', '封面选取按日期排序的第一条公共行程');
  eq(coverModel.dayText, '3天', '封面显示整趟天数');
  eq(coverModel.spotText, '2处景点', '封面显示去重景点数');
  const coverKeys = JSON.stringify(coverModel);
  ['itemId', 'ticketState', 'reminder', 'result', 'releaseAt', '_id'].forEach(key => {
    eq(coverKeys.includes('"' + key + '"'), false, `封面模型不得携带 ${key}`);
  });
  eq(await tripShareCover.generate({}, trip), '/images/share/home-today.jpg',
    'Canvas 不可用时回退静态封面而不阻断分享');

  const menuShare = home.onShareAppMessage({ from: 'menu' });
  eq(menuShare.path, '/pages/home/home?source=home_share', '右上角菜单仍分享原公开首页');

  home.onTripShareRevoke();
  await wait(5);
  eq(apiCalls.revoke.length, 1, '停止分享走专用写接口');
  eq(home.data.showTripShareSheet, false, '停止成功后关闭浮层');
  eq(home.data.tripShareActionLabel, '分享行程', '当前行程停止后仍可重新分享');

  const endedTrip = Object.assign({}, trip, {
    _id: 'TRIP_ENDED_SHARE',
    endDate: '2026-11-01',
    shareActive: true,
  });
  home.setData({
    trips: [],
    history: [endedTrip],
    primaryTrip: null,
    summaryTrip: endedTrip,
    showTripShareAction: true,
    tripShareActionLabel: '分享行程',
  });
  home.onTripShareTap();
  await wait(5);
  eq(apiCalls.status.length, 1, '已结束行程只查询现有分享状态');
  eq(home.data.tripShareSheet.manageOnly, true, '已结束行程不能再次发起分享');
  eq(home.data.tripShareSheet.shareReady, true, '有效链接仍可停止');
  eq(home.data.tripShareSheet.hasActive, true, '管理态标题与入口一致');

  console.log('=== 3. 接收方只读页加载与失效态 ===');
  const viewer = loadPage(VIEW_JS_PATH, apiStub);
  viewer.onLoad({ token: 'c'.repeat(64), source: 'share' });
  await wait(5);
  eq(apiCalls.open.length, 1, '进入页面按令牌读取');
  eq(global.__hideShareCalls > 0, true, '基础库支持时隐藏转发菜单');
  eq(viewer.data.loading, false, '加载结束');
  eq(viewer.data.trip.days.length, 2, '全部日期分组均渲染');
  eq(viewer.data.trip.days[1].items.length, 2, '同日多个景点全部保留');
  eq(viewer.data.trip.title, '北京之行', '总览卡标题与首页摘要卡一致');
  eq(viewer.data.trip.watermark.join(''), 'BEIJING  TRIP',
    '总览卡包含首页同款装饰英文');
  eq(viewer.data.expiresText, '2026年11月12日', '失效日按中文日期展示');
  eq(typeof viewer.onShareAppMessage, 'undefined', '页面实例不提供转发回调');
  eq(typeof viewer.onShareTimeline, 'undefined', '页面实例不提供朋友圈回调');

  openError = { success: false, error: '这份行程暂时无法查看', errorCode: 1042 };
  const expired = loadPage(VIEW_JS_PATH, apiStub);
  expired.onLoad({ token: 'd'.repeat(64), source: 'share' });
  await wait(5);
  eq(expired.data.invalid, true, '停止、过期、删除统一进入不可查看态');
  eq(expired.data.loadFailed, false, '不可查看不伪装成网络失败');

  openError = { success: false, error: 'network' };
  const failed = loadPage(VIEW_JS_PATH, apiStub);
  failed.onLoad({ token: 'e'.repeat(64), source: 'share' });
  await wait(5);
  eq(failed.data.loadFailed, true, '网络失败提供重试态而不是泄露失效信息');
  eq(typeof failed.onRetry, 'function', '网络失败可重新加载');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : `FAIL ${fail}`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
