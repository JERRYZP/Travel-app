const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    badge: 0,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
  },

  onShow() {
    this.loadUser();
    this.loadBadge();
  },

  loadUser() {
    api.reminder.user.profile().then(res => {
      this.setData({ user: res.user });
    }).catch(() => {
      this.setData({
        user: {
          nickname: '游客',
          avatarUrl: '',
          memberLevel: 'NORMAL',
          points: 0,
        },
      });
    });
  },

  loadBadge() {
    api.reminder.task.badge().then(res => {
      this.setData({ badge: res.badge || 0 });
    }).catch(() => {});
  },

  onNotifySettings() {
    wx.openSetting({
      success: res => {
        if (res.authSetting['scope.subscribeMessage']) {
          wx.showToast({ title: '通知已开启', icon: 'none' });
        }
      },
    });
  },

  onGuide() {
    wx.showToast({ title: '攻略即将上线', icon: 'none' });
  },

  onFeedback() {
    wx.showToast({ title: '感谢反馈', icon: 'none' });
  },

  onReportError() {
    wx.showModal({
      title: '信息纠错',
      content: '发现景点信息有误？请描述问题，我们会尽快核实。',
      editable: true,
      placeholderText: '请输入问题描述',
      success: res => {
        if (res.confirm) {
          wx.showToast({ title: '感谢反馈，我们会尽快核实', icon: 'none' });
        }
      },
    });
  },
});
