const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
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
