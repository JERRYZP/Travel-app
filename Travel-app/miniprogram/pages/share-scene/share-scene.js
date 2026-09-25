const app = getApp();
const api = require('../../utils/api.js');
const verify = require('../../utils/verify.js');
const release = require('../../utils/release-context.js');
const scenes = require('../../utils/share-scenes.js');
const shareEntry = require('../../utils/share-entry.js');
const analytics = require('../../utils/analytics.js');
const reminderFlow = require('../../utils/reminder-flow.js');

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
    loading: true,
    loadFailed: false,
    expired: false,
    scene: null,
    sceneId: 'today',
    rows: [],
    entryContext: null,
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
    });
    this.applyEntry(shareEntry.consumeEntry(app, options));
    this.loadScene();
  },

  onShow() {
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
    this.setData({ sceneId: scene.id, entryContext: context });
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
      ? api.spots.list()
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
      this.setData({ loading: false, rows });
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

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/home' });
  },

  goToday() {
    wx.redirectTo({
      url: shareEntry.buildScenePath('today', (this.data.entryContext || {}).source || 'direct'),
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
