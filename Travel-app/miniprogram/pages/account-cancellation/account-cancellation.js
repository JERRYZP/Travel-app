const app = getApp();
const api = require('../../utils/api.js');

function blockerViewOf(item = {}) {
  const titles = {
    PAYMENT_PENDING: '待支付订单',
    PAYMENT_RECONCILING: '支付结果核验',
    ENTITLEMENT_UNRESOLVED: '会员权益待处理',
    AFTER_SALES_ACTIVE: '售后处理中',
  };
  return {
    code: item.code || '',
    count: Math.max(0, Number(item.count) || 0),
    title: titles[item.code] || item.title || '待处理事项',
    message: item.message || '请先处理后再试。',
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadFailed: false,
    canErase: false,
    blockers: [],
    summary: {},
    acknowledged: false,
    erasing: false,
    success: false,
  },

  onLoad() {
    const g = app.globalData || {};
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      navBarHeight: g.navBarHeight || 44,
    });
    this.loadPreflight();
  },

  onShow() {
    if (this._shownOnce) this.loadPreflight();
    this._shownOnce = true;
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/profile-edit/profile-edit' }) });
  },

  loadPreflight() {
    if (this.data.erasing || this.data.success) return Promise.resolve(null);
    const seq = (this._preflightSeq || 0) + 1;
    this._preflightSeq = seq;
    this.setData({ loading: true, loadFailed: false });
    return api.account.preflight().then(res => {
      if (seq !== this._preflightSeq) return null;
      this.setData({
        loading: false,
        loadFailed: false,
        canErase: res.canErase === true,
        blockers: (res.blockers || []).map(blockerViewOf),
        summary: res.summary || {},
        acknowledged: false,
      });
      return res;
    }).catch(() => {
      if (seq !== this._preflightSeq) return null;
      this.setData({ loading: false, loadFailed: true, canErase: false });
      return null;
    });
  },

  onRetry() {
    this.loadPreflight();
  },

  onOpenOrders() {
    wx.navigateTo({ url: '/pages/membership-orders/membership-orders' });
  },

  onAcknowledgeChange(e) {
    const values = (e && e.detail && e.detail.value) || [];
    this.setData({ acknowledged: values.indexOf('acknowledged') >= 0 });
  },

  onErase() {
    if (this.data.loading || this.data.loadFailed || this.data.erasing) return;
    if (!this.data.canErase || !this.data.acknowledged) return;
    wx.showModal({
      title: '确认注销账户',
      content: '确认注销当前账户？此操作不可恢复，会员和提醒权益将立即失效。',
      confirmText: '确认注销',
      confirmColor: '#B44332',
      cancelText: '暂不注销',
      success: res => {
        if (res.confirm) this.submitErase();
      },
    });
  },

  submitErase() {
    if (this.data.erasing) return;
    this.setData({ erasing: true });
    api.account.erase().then(() => {
      try { wx.clearStorageSync(); } catch (e) {}
      const g = app.globalData || {};
      g.userInfo = null;
      g.openid = null;
      g.currentTripId = null;
      g.pendingShareEntry = null;
      g.homeDataVersion = (Number(g.homeDataVersion) || 0) + 1;
      g.membershipDataVersion = (Number(g.membershipDataVersion) || 0) + 1;
      this.setData({ erasing: false, success: true });
    }).catch(err => {
      this.setData({ erasing: false });
      if (err && err.errorCode === 1047) {
        this.setData({
          canErase: false,
          blockers: (err.blockers || []).map(blockerViewOf),
          summary: err.summary || this.data.summary,
          acknowledged: false,
        });
        wx.showToast({ title: '请先处理有未结事项', icon: 'none' });
        return;
      }
      api.toastError(err);
    });
  },

  onFinish() {
    wx.reLaunch({ url: '/pages/home/home' });
  },
});
