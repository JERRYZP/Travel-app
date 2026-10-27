const app = getApp();
const api = require('../../utils/api.js');
const spotsCache = require('../../utils/spots-cache.js');
const verify = require('../../utils/verify.js');
const release = require('../../utils/release-context.js');
const scenes = require('../../utils/share-scenes.js');
const shareEntry = require('../../utils/share-entry.js');
const analytics = require('../../utils/analytics.js');
const reminderFlow = require('../../utils/reminder-flow.js');

const BEIJING_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 卡片标题后的日期行：按北京时间取，与页内所有放票推算同一时区口径。 */
function buildDateText(now) {
  const p = release.beijingParts(now || new Date());
  const weekday = BEIJING_WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${p.year}年${p.month}月${p.day}日 周${weekday}`;
}

function orderByIds(items, ids) {
  const map = {};
  (items || []).forEach(s => { map[s.spotId] = s; });
  return (ids || []).map(id => map[id]).filter(Boolean);
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTop: 64,
    canGoBack: false,
    loading: true,
    loadFailed: false,
    expired: false,
    scene: null,
    sceneId: 'today',
    rows: [],
    entryContext: null,
    subtitleOverride: '',
    showSpotPopup: false,
    popupSpotId: '',
    popupSpotMeta: null,
    showDateSheet: false,
    dateSpotName: '',
    dateTitle: '',
    dateTripDates: [],
    dateBookedDates: [],
    dateMinDate: '',
    dateAction: null,
  },

  onLoad(options) {
    const g = app.globalData;
    const statusBarHeight = g.statusBarHeight || 20;
    const navBarHeight = g.navBarHeight || 44;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navTop: statusBarHeight + navBarHeight,
      canGoBack: this.canGoBack(),
    });
    this.applyEntry(shareEntry.consumeEntry(app, options));
    this.loadScene();
  },

  onShow() {
    /* 页面栈可能在别处被改写（reLaunch/redirectTo 之后回到本页），
       每回复显时重算一次返回按钮可见性，不靠 onLoad 那一帧的结论。 */
    const canGoBack = this.canGoBack();
    if (canGoBack !== this.data.canGoBack) this.setData({ canGoBack });
    const pending = shareEntry.peekPending(app);
    if (pending && pending.sceneId && !pending.spotId) {
      shareEntry.clearPending(app);
      const nextId = scenes.getScene(pending.sceneId).id;
      const sceneChanged = nextId !== this.data.sceneId;
      this.applyEntry(pending);
      if (sceneChanged) this.loadScene();
    }
  },

  applyEntry(entry) {
    const scene = scenes.getScene((entry && entry.sceneId) || 'today');
    const context = Object.assign({}, entry || {}, {
      sceneId: scene.id,
      entryType: 'scene',
    });
    const preferred = this.data.subtitleOverride;
    this.setData({
      sceneId: scene.id,
      entryContext: context,
      scene: Object.assign({}, scene, {
        dateText: buildDateText(),
        subtitle: preferred || scene.subtitle,
      }),
    });
    wx.setNavigationBarTitle({ title: scene.navTitle });
    if (entry && entry.source) analytics.captureLanding(context, 'scene');
  },

  loadScene() {
    const scene = scenes.getScene(this.data.sceneId);
    this.setData({ scene, loading: true, loadFailed: false, expired: false, rows: [] });

    if (!scenes.isSceneActive(scene, new Date())) {
      this.setData({ loading: false, expired: true, rows: [] });
      return Promise.resolve();
    }

    const request = scene.kind === 'today'
      ? spotsCache.list(() => api.spots.list())
      : api.spots.batch(scene.spotIds);

    return request.then(res => {
      const cards = res.data || [];
      const ordered = scene.kind === 'today'
        ? cards
        : orderByIds(cards, scene.spotIds);
      const now = new Date();
      const rows = scene.kind === 'today'
        ? release.buildTodayRows(ordered, now)
        : ordered.map(s => release.buildSceneSpot(s, now));
      rows.forEach(s => {
        s._sceneVerifyText = verify.verifiedLabel(s.lastCheckedDate);
      });
      /* 副标题只讲价值，不再重复「按北京时间/库存以官方为准」——
         卡片已带核验日期，底部另有一行口径说明。 */
      const subtitleOverride = scene.kind === 'today'
        ? `${rows.length} 个热门景点，今天几点放票一目了然`
        : '';
      this.setData({
        loading: false,
        rows,
        subtitleOverride,
        scene: Object.assign({}, scene, {
          dateText: buildDateText(now),
          subtitle: subtitleOverride || scene.subtitle,
        }),
      });
    }).catch(() => {
      this.setData({ loading: false, loadFailed: true, rows: [] });
    });
  },

  onSceneSpotTap(e) {
    const spotId = e.detail && e.detail.spotId;
    if (!spotId) return;
    this.setData({ showSpotPopup: true, popupSpotId: spotId, popupSpotMeta: null });
  },

  onSpotPopupLoaded(e) {
    const spot = e && e.detail && e.detail.spot;
    if (spot) this.setData({ popupSpotMeta: spot });
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false, popupSpotId: '', popupSpotMeta: null });
  },

  onPopupSetReminder(e) {
    const d = e.detail;
    reminderFlow.openDateSheet(this, {
      spotId: d.spotId,
      spotName: d.spotName,
      title: '设置提醒',
      remindOn: true,
    });
  },

  onPopupAddTripOnly(e) {
    const d = e.detail;
    reminderFlow.openDateSheet(this, {
      spotId: d.spotId,
      spotName: d.spotName,
      title: '加入行程',
      remindOn: false,
    });
  },

  onDateConfirm(e) {
    return reminderFlow.onDateConfirm(this, e);
  },

  onDateClose() {
    reminderFlow.onDateClose(this);
  },

  /* 左上角返回：只有栈里真有上一页才显示（景点页 Banner「查看更多」进栈）。
     分享卡片直达时栈深度是 1，不出现点不动的返回；那种场景底部已有「返回主页」。 */
  canGoBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : null;
    return !!(pages && pages.length > 1);
  },

  onBack() {
    /* 按钮只在栈深 >1 时出现；真出栈失败（栈被外部改写）就直接回首页，
       不再套一层 goHome，免得失败后重试同一个必然失败的 navigateBack。 */
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) });
  },

  goToday() {
    wx.redirectTo({
      url: shareEntry.buildScenePath('today', (this.data.entryContext || {}).source || 'direct'),
    });
  },

  /* 返回主页：从分享卡片进栈时（栈里只有聊天/小程序列表）navigateBack 必然失败，
     失败后回退 reLaunch 重建首页，避免用户卡在落地页。 */
  goHome() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/home/home' }),
    });
  },

  onShareAppMessage() {
    const scene = scenes.getScene(this.data.sceneId);
    const expired = this.data.expired;
    const targetScene = expired ? scenes.getScene('today') : scene;
    const title = scenes.buildSceneTitle(targetScene, this.data.rows.length);
    analytics.trackShareIntent('scene', targetScene.id);
    return {
      title,
      path: shareEntry.buildScenePath(targetScene.id, 'share'),
      imageUrl: targetScene.imageUrl,
    };
  },

  onShareTimeline() {
    const scene = scenes.getScene(this.data.sceneId);
    const targetScene = this.data.expired ? scenes.getScene('today') : scene;
    analytics.trackShareIntent('scene', targetScene.id);
    return {
      title: scenes.buildSceneTitle(targetScene, this.data.rows.length),
      query: shareEntry.buildSceneQuery(targetScene.id, 'timeline'),
      imageUrl: targetScene.imageUrl,
    };
  },
});
