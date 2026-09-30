const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    nickname: '',
    avatarUrl: '',
    phone: '',
    _prevAvatar: '',   // 已持久化头像（cloud:// 或本地默认图），上传失败时回退用
    saving: false,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
    api.reminder.user.profile().then(res => {
      const user = (res && res.user) || {};
      this.setData({
        nickname: user.nickname || '',
        avatarUrl: user.avatarUrl || '',
        phone: user.phone || '',
        _prevAvatar: user.avatarUrl || '',
      });
    }).catch(() => {});
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/profile/profile' }) });
  },

  /* 微信头像：open-type=chooseAvatar 返回临时文件路径，保存时统一走 resolveAvatarUrl 上传云存储 */
  onChooseWechatAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (url) this.setData({ avatarUrl: url });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onSave() {
    const nickname = (this.data.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    const phone = (this.data.phone || '').trim();
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    this.resolveAvatarUrl()
      .then(avatarUrl => api.reminder.user.updateProfile({ nickname, avatarUrl, phone }))
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => this.onBack(), 600);
      })
      .catch(err => {
        this.setData({ saving: false });
        wx.showToast({ title: (err && err.error) || '保存失败，请重试', icon: 'none' });
      });
  },

  /**
   * 头像处理：chooseAvatar 返回本地临时路径，需上传云存储换 fileID 才能持久化。
   * 已是 cloud://（复选原头像）或主包默认图（/images/）、mock/无云环境时原样返回，避免无效上传。
   */
  resolveAvatarUrl() {
    const url = (this.data.avatarUrl || '').trim();
    if (!url || /^cloud:\/\//.test(url) || url.indexOf('/images/') === 0 || !wx.cloud) {
      return Promise.resolve(url || '');
    }
    /* 上传失败时的回退：优先已有持久化头像，否则空串（前端显示占位，避免持久化临时路径导致下次裂图） */
    const prev = ((this.data._prevAvatar || '') || '').trim();
    const fallback = (/^cloud:\/\//.test(prev) || prev.indexOf('/images/') === 0) ? prev : '';
    const extMatch = url.match(/\.(jpg|jpeg|png|webp)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
    const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return new Promise(resolve => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: url,
        success: res => resolve(res.fileID),
        fail: err => {
          console.error('[profile-edit] avatar upload failed, fallback', err);
          resolve(fallback);
        },
      });
    });
  },
});
