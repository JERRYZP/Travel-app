const app = getApp();
const api = require('../../utils/api.js');

const STATUS_TONE = {
  PENDING: 'pending',
  PAID: 'paid',
  CLOSED: 'closed',
  REFUNDED: 'refunded',
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadFailed: false,
    items: [],
    count: 0,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
  },

  onShow() {
    this.loadOrders();
  },

  loadOrders() {
    this.setData({ loading: true, loadFailed: false });
    return api.reminder.membership.orders().then(res => {
      const items = (res.items || []).map(item => ({
        ...item,
        _statusTone: STATUS_TONE[item.status] || 'closed',
      }));
      this.setData({
        loading: false,
        items,
        count: Number(res.count) || items.length,
      });
    }).catch(err => {
      this.setData({ loading: false, loadFailed: true, items: [] });
      api.toastError(err);
    });
  },

  onRetry() {
    this.loadOrders();
  },

  onCopyOrderNo(e) {
    const orderNo = e.currentTarget.dataset.no;
    if (!orderNo) return;
    wx.setClipboardData({
      data: String(orderNo),
      success: () => wx.showToast({ title: '订单号已复制', icon: 'none' }),
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
