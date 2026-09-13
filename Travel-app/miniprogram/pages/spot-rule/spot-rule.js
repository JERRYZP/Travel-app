const app = getApp();
const api = require('../../utils/api.js');
const verify = require('../../utils/verify.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    spotId: '',
    spot: null,
    loading: true,
    showQr: false,
    qrSpot: null,
    tipsExpanded: false,
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      spotId: options.spotId || '',
    });
    this.loadDetail();
  },

  loadDetail() {
    this.setData({ loading: true });
    api.spots.detail(this.data.spotId).then(res => {
      this.setData({ spot: this.decorate(res.data), loading: false });
    }).catch(() => {
      /* 只展示真实云环境结果：失败即提示，不回退 mock */
      this.setData({ loading: false });
      wx.showToast({ title: '景点详情加载失败，请检查云端', icon: 'none' });
    });
  },

  decorate(s) {
    let status = { key: 'reserve', text: '需提前预约' };
    if (!s.reservationRequired) status = { key: 'free', text: '当前免预约' };
    else if (!s.remindable) status = { key: 'onsite', text: '随买随用' };
    const releaseList = Array.isArray(s.releaseTime) ? s.releaseTime : (s.releaseTime ? [s.releaseTime] : []);
    return Object.assign({}, s, {
      status,
      ruleText: this.ruleTextOf(s),
      verifiedLabel: verify.verifiedLabel(s.lastCheckedDate),
      verified: verify.isVerified(s.lastCheckedDate),
      sourceText: verify.SOURCE_TEXT,
      releaseList,
    });
  },

  ruleTextOf(s) {
    if (s.remindable && !s.weak) {
      return `提前${s.advanceDays}天 · ${Array.isArray(s.releaseTime) ? s.releaseTime.join('、') : s.releaseTime}放票`;
    }
    return s.cardDesc || (s.reservationRequired ? '需预约' : '现场购票');
  },

  onBack() {
    wx.navigateBack();
  },

  onEntryTap(e) {
    const entry = e.currentTarget.dataset.entry;
    if (entry.type === 'MINIPROGRAM' && entry.appid) {
      wx.navigateToMiniProgram({
        appId: entry.appid,
        path: entry.path || '',
        fail: () => {
          const fallback = entry.url || entry.path || '';
          if (fallback) {
            wx.setClipboardData({ data: fallback });
            wx.showToast({ title: '跳转失败，已复制官网链接', icon: 'none' });
          }
        },
      });
    } else if (entry.type === 'WEB' && entry.url) {
      wx.navigateTo({
        url: '/pages/webview/webview?url=' + encodeURIComponent(entry.url) + '&title=' + encodeURIComponent(entry.label || '景区官网'),
        fail: () => {
          wx.setClipboardData({ data: entry.url });
          wx.showToast({ title: '打开失败，已复制链接', icon: 'none' });
        },
      });
    } else if (entry.type === 'OFFICIAL_ACCOUNT') {
      if (entry.qrCode) {
        this.setData({ showQr: true, qrSpot: { name: entry.value || '公众号', qrCode: entry.qrCode } });
      } else {
        wx.showToast({ title: '请关注公众号「' + entry.value + '」', icon: 'none' });
      }
    }
  },

  onCopyEntry(e) {
    const entry = e.currentTarget.dataset.entry;
    if (entry && entry.url) {
      wx.setClipboardData({ data: entry.url });
      wx.showToast({ title: '官网链接已复制', icon: 'none' });
    }
  },

  closeQr() {
    this.setData({ showQr: false, qrSpot: null });
  },

  /* 我要纠错：带景点信息跳转到信息纠错页，自动预选该景点 */
  onCorrect() {
    const spot = this.data.spot;
    if (!spot) return;
    wx.navigateTo({
      url: '/pages/spot-correction/spot-correction?spotId=' + spot.spotId
        + '&spotName=' + encodeURIComponent(spot.name)
        + '&district=' + encodeURIComponent(spot.district || ''),
    });
  },

  toggleTips() {
    this.setData({ tipsExpanded: !this.data.tipsExpanded });
  },

  /* 设置提醒：规则详情页的行动出口，进入现有提醒流程（首页添加提醒，预选该景点） */
  onSetReminder() {
    const spot = this.data.spot;
    if (!spot) return;
    if (!spot.reservationRequired) {
      wx.showToast({ title: '该景点无需预约，现场购票即可', icon: 'none' });
      return;
    }
    if (!spot.remindable) {
      wx.showToast({ title: '该景点无固定放票时刻，随买随用即可', icon: 'none' });
      return;
    }
    app.globalData.pendingReminderSpot = spot;
    wx.reLaunch({ url: '/pages/home/home' });
  },

  noop() {},
});
