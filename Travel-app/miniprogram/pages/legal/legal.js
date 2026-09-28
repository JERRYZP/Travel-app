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
    const type = normalizeType(options && options.type);
    const doc = agreements[type] || agreements.privacy;
    const g = app.globalData || {};
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      navBarHeight: g.navBarHeight || 44,
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
