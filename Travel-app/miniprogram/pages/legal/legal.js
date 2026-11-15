const app = getApp();
const agreements = require('../../legal/agreements.js');

function normalizeType(value) {
  return value === 'terms' ? 'terms' : 'privacy';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    type: 'privacy',
    navTitle: '隐私政策',
    documentTitle: '',
    blocks: [],
  },

  onLoad(options) {
    const g = app.globalData || {};
    const shared = {
      statusBarHeight: g.statusBarHeight || 20,
      navBarHeight: g.navBarHeight || 44,
    };
    if (options && options.type === 'index') {
      this.setData({ ...shared, type: 'index', navTitle: '用户协议' });
      return;
    }
    const type = normalizeType(options && options.type);
    const doc = agreements[type] || agreements.privacy;
    this.setData({
      ...shared,
      type,
      navTitle: type === 'terms' ? '用户服务协议' : '隐私政策',
      documentTitle: doc.title,
      blocks: doc.blocks,
    });
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/profile/profile' }),
    });
  },

  onAgreementType(e) {
    const type = e.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy';
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
  },

  onOpenWechatPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请在微信小程序资料页查看', icon: 'none' });
      return;
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时无法打开，请稍后重试', icon: 'none' }),
    });
  },
});
