const app = getApp();
const notify = require('../../utils/notify.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    systemOk: false,
    subscribeOk: false,
    templateReady: false,
    loading: true,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      templateReady: !!notify.SUBSCRIBE_TEMPLATE_ID,
    });
  },

  onShow() {
    this.refresh();
  },

  /* 从系统设置 / 授权框返回时刷新状态 */
  refresh() {
    notify.getNotifyStatus().then(s => {
      this.setData({ systemOk: s.systemOk, subscribeOk: s.subscribeOk, loading: false });
    });
  },

  onOpenSystem() {
    notify.openSystemNotifySetting();
  },

  onRequestSubscribe() {
    if (!this.data.templateReady) {
      wx.showToast({ title: '推送通道准备中，请稍后再试', icon: 'none' });
      return;
    }
    notify.requestSubscribe().then(res => {
      this.refresh();
      if (res.ok) {
        wx.showToast({ title: '已授权', icon: 'none' });
      } else {
        wx.showToast({ title: '未完成授权，提醒可能收不到', icon: 'none' });
      }
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
