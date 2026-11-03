const app = getApp();
const api = require('../../utils/api.js');
const feedbackEntryCache = require('../../utils/feedback-entry-cache.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    feedbackUnreadCount: 0,
    feedbackUnreadText: '',
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
  },

  onShow() {
    this.loadFeedbackEntry();
  },

  loadFeedbackEntry() {
    const cached = feedbackEntryCache.read();
    if (cached) this.applyFeedbackEntry(cached.data);
    if (cached && cached.fresh) return Promise.resolve(cached.data);
    return api.feedback.entrySummary().then(res => {
      this.applyFeedbackEntry(res);
      feedbackEntryCache.write(res);
      return res;
    }).catch(() => cached ? cached.data : null);
  },

  applyFeedbackEntry(res) {
    const count = Math.max(0, Number(res && res.handledUnreadCount) || 0);
    this.setData({
      feedbackUnreadCount: count,
      feedbackUnreadText: count > 99 ? '99+' : String(count || ''),
    });
  },

  onBack() {
    wx.navigateBack();
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onReportError() {
    wx.navigateTo({ url: '/pages/spot-correction/spot-correction' });
  },

  onMyFeedback() {
    wx.navigateTo({ url: '/pages/my-feedback/my-feedback' });
  },
});
