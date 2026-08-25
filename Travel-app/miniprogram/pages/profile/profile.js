const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');

const NOTIFY_HINT_MAP = { none: '未开启', partial: '部分开启', all: '已开启' };

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    notifyHint: '未开启',
    notifyState: 'none',
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
  },

  onShow() {
    this.loadUser();
    this.loadNotifyHint();
  },

  /* 无感登录：profile 首次调用即自动建号（自动昵称+默认头像），页面常驻登录态 */
  loadUser() {
    api.reminder.user.profile().then(res => {
      this.setData({ user: res.user || {} });
    }).catch(() => {
      this.setData({
        user: { nickname: '', avatarUrl: '', memberLevel: 'NORMAL', points: 0 },
      });
    });
  },

  /* 通知设置三态：全没设 / 设了一个 / 全设（onShow 刷新，从内页返回即时更新） */
  loadNotifyHint() {
    notify.getNotifyStatus().then(s => {
      this.setData({ notifyHint: NOTIFY_HINT_MAP[s.state], notifyState: s.state });
    }).catch(() => {});
  },

  /* 点头像/昵称 -> 编辑资料页（头像/昵称/手机号） */
  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  onNotifySettings() {
    wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  },

  onGuide() {
    wx.showToast({ title: '攻略即将上线', icon: 'none' });
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onReportError() {
    wx.navigateTo({ url: '/pages/spot-correction/spot-correction' });
  },

  /** 隐藏入口：长按用户信息卡进入反馈管理页（权限由 feedback 云函数 openid 白名单把关） */
  onAdminEntry() {
    wx.navigateTo({ url: '/pages/admin-feedback/admin-feedback' });
  },
});
