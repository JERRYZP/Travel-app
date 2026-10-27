const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');
const oa = require('../../utils/official-account.js');

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
    /* 公众号入口文案取自 utils/official-account.js，页面不写死名称 */
    oaRowLabel: oa.ROW_LABEL,
    oaRowHint: oa.ROW_HINT,
    showOaSheet: false,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
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

  /* 关注公众号：只在用户主动点击时打开二维码弹层，不在 onShow 自动弹 */
  onFollowOa() {
    this.setData({ showOaSheet: true });
  },

  onCloseOaSheet() {
    this.setData({ showOaSheet: false });
  },

  onHelpFeedback() {
    wx.navigateTo({ url: '/pages/help-feedback/help-feedback' });
  },

  onLegal(e) {
    const type = e.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy';
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
  },

  /** 隐藏入口：长按用户信息卡时先向服务端确认管理员身份，非管理员静默不跳转。 */
  onAdminEntry() {
    if (this._adminEntryChecking) return;
    this._adminEntryChecking = true;
    api.feedback.adminStatus().then(res => {
      this._adminEntryChecking = false;
      if (res && res.isAdmin) {
        wx.navigateTo({ url: '/pages/admin-feedback/admin-feedback' });
      }
    }).catch(() => {
      /* 校验失败按无权限处理；反馈管理页自身仍会再次鉴权。 */
      this._adminEntryChecking = false;
    });
  },
});
