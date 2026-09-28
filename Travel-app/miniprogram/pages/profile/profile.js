const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');

function reminderHintOf(health) {
  if (health.permissionState === 'none') return { text: '未开启', state: 'none' };
  if (health.permissionState === 'partial') return { text: '部分开启', state: 'partial' };
  if (health.quotaLevel === 'unknown') return { text: '状态待刷新', state: 'partial' };
  if (health.quotaLevel === 'exhausted') return { text: '授权已用完', state: 'exhausted' };
  if (health.quotaLevel === 'short') {
    return { text: '还差' + health.shortfall + '次授权', state: 'short' };
  }
  if (health.quotaLevel === 'low') return { text: '授权即将用完', state: 'low' };
  return { text: '已开启', state: 'all' };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    notifyHint: '未开启',
    notifyState: 'none',
    devMode: false,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      devMode: g.envVersion === 'develop',
    });
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

  /* 提醒设置状态：权限三态 + 授权额度健康度（onShow 刷新，从内页返回即时更新） */
  loadNotifyHint() {
    notify.getReminderHealth().then(health => {
      const hint = reminderHintOf(health);
      this.setData({ notifyHint: hint.text, notifyState: hint.state });
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
    wx.navigateTo({ url: '/pages/guide/guide' });
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onReportError() {
    wx.navigateTo({ url: '/pages/spot-correction/spot-correction' });
  },

  onLegal(e) {
    const type = e.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy';
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
  },

  /* 仅开发版：不删云端数据，首页临时按新用户空态渲染。 */
  onPreviewNewUser() {
    if (app.globalData.envVersion !== 'develop') return;
    app.globalData.previewNewUser = true;
    try { wx.removeStorageSync(notify.FIRST_REMINDER_TIP_KEY); } catch (e) {}
    wx.redirectTo({ url: '/pages/home/home' });
  },

  /** 隐藏入口：长按用户信息卡进入反馈管理页（权限由 feedback 云函数 openid 白名单把关） */
  onAdminEntry() {
    wx.navigateTo({ url: '/pages/admin-feedback/admin-feedback' });
  },
});
