const app = getApp();
const api = require('../../utils/api.js');
const membershipPay = require('../../utils/membership-pay.js');

function usagePercentOf(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadFailed: false,
    purchasing: false,
    membership: null,
    packages: [],
    selectedPackageId: '',
    selectedPackage: null,
    payButtonText: '',
    usagePercent: 0,
    reasonText: '',
    reasonTaskLimit: false,
    memberStateText: '普通用户',
    expiryText: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const reason = options && options.reason;
    const requested = options && options.requested;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      reasonTaskLimit: reason === 'task_limit',
      reasonText: reason === 'task_limit'
        ? `本次需要 ${requested || '更多'} 个提醒任务位`
        : '',
    });
  },

  onShow() {
    this.loadStatus();
  },

  loadStatus(preferredId) {
    this.setData({ loading: true, loadFailed: false });
    return api.reminder.membership.status().then(res => {
      const membership = res.membership || {};
      const packages = (res.packages || []).map(item => ({ ...item }));
      const available = packages.filter(item => item.available);
      let selectedId = preferredId;
      if (!selectedId || !available.some(item => item.id === selectedId)) {
        const contextual = this.data.reasonTaskLimit && membership.member
          ? available.find(item => item.id === 'task_pack_5')
          : null;
        selectedId = contextual
          ? contextual.id
          : (available.length ? available[0].id : '');
      }
      this.setData({
        loading: false,
        loadFailed: false,
        membership,
        packages: this.markPackages(packages, selectedId),
        selectedPackageId: selectedId,
        selectedPackage: packages.find(item => item.id === selectedId) || null,
        payButtonText: this.payButtonOf(packages.find(item => item.id === selectedId)),
        usagePercent: usagePercentOf(membership.taskUsed, membership.taskLimit),
        memberStateText: membership.member ? '会员生效中' : '普通用户',
        expiryText: membership.member
          ? `有效期至 ${membership.memberExpiresAtText}`
          : '开通后 30 天内有效',
      });
    }).catch(err => {
      this.setData({ loading: false, loadFailed: true });
      api.toastError(err);
    });
  },

  onRetry() {
    this.loadStatus(this.data.selectedPackageId);
  },

  markPackages(packages, selectedId) {
    return (packages || []).map(item => ({
      ...item,
      _selected: item.id === selectedId,
      _available: item.available === true,
    }));
  },

  payButtonOf(pkg) {
    if (!pkg) return '暂无可购买项';
    return pkg.type === 'MEMBER'
      ? `${pkg.actionText}`
      : `${pkg.actionText}`;
  },

  onPackageTap(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.packages.find(item => item.id === id);
    if (!pkg) return;
    if (!pkg._available) {
      wx.showToast({ title: pkg.actionText, icon: 'none' });
      return;
    }
    this.setData({
      selectedPackageId: id,
      selectedPackage: pkg,
      packages: this.markPackages(this.data.packages, id),
      payButtonText: this.payButtonOf(pkg),
    });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/membership-orders/membership-orders' });
  },

  onPay() {
    if (this.data.purchasing) return;
    const pkg = this.data.selectedPackage;
    if (!pkg) return;
    this.setData({ purchasing: true });
    wx.showLoading({ title: '正在准备支付...' });
    membershipPay.purchase(pkg.id).then(result => {
      wx.hideLoading();
      this.setData({ purchasing: false });
      if (result && result.pending) {
        wx.showToast({ title: '支付结果确认中，请稍后刷新', icon: 'none' });
        return;
      }
      wx.showToast({ title: '权益已生效', icon: 'none' });
      this.loadStatus();
    }).catch(err => {
      wx.hideLoading();
      this.setData({ purchasing: false });
      if (err && err.cancelled) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
        return;
      }
      api.toastError(err);
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
