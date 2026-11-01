const app = getApp();
const api = require('../../utils/api.js');
const orderRefresh = require('../../utils/order-refresh.js');

const STATUS_TONE = {
  PENDING: 'pending',
  PAID: 'paid',
  CLOSED: 'closed',
  REFUNDED: 'refunded',
};

const REFUND_TONE = {
  REQUESTED: 'review',
  UNDER_REVIEW: 'review',
  PROCESSING: 'processing',
  REFUNDED: 'refunded',
  REJECTED: 'rejected',
  FAILED: 'failed',
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadFailed: false,
    items: [],
    count: 0,
    autoRefreshHint: '',
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
  },

  onShow() {
    this._pageVisible = true;
    this.loadOrders({ silent: this.data.items.length > 0 });
  },

  onHide() {
    this._pageVisible = false;
    this.stopAutoRefresh(false);
  },

  onUnload() {
    this._pageVisible = false;
    this.stopAutoRefresh(false);
  },

  onPullDownRefresh() {
    return this.loadOrders({ silent: true }).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  loadOrders(options) {
    const silent = !!(options && options.silent);
    if (!silent) this.setData({ loading: true, loadFailed: false });
    return api.reminder.membership.orders().then(res => {
      const items = (res.items || []).map(item => ({
        ...item,
        _statusTone: STATUS_TONE[item.status] || 'closed',
        _refundTone: REFUND_TONE[item.refundStatus] || '',
      }));
      this.setData({ loading: false, loadFailed: false, items, count: Number(res.count) || items.length });
      this.applyOrderRefresh(items);
    }).catch(err => {
      if (silent) {
        if (this._autoRefreshActive) this._scheduleAutoRefresh();
        return;
      }
      this.setData({ loading: false, loadFailed: true, items: [] });
      api.toastError(err);
    });
  },

  applyOrderRefresh(items) {
    if (!orderRefresh.hasTransientOrder(items)) {
      this.stopAutoRefresh();
      return;
    }
    this.setData({ autoRefreshHint: orderRefresh.refreshHintOf(items) });
    this._beginAutoRefresh();
  },

  _beginAutoRefresh() {
    if (!this._pageVisible) return;
    if (!this._autoRefreshActive) {
      this._autoRefreshActive = true;
      this._autoRefreshAttempts = 0;
    }
    this._scheduleAutoRefresh();
  },

  _scheduleAutoRefresh() {
    if (!this._pageVisible || !this._autoRefreshActive || this._autoRefreshTimer) return;
    if (this._autoRefreshAttempts >= orderRefresh.REFRESH_MAX_ATTEMPTS) {
      this.stopAutoRefresh(false);
      this.setData({ autoRefreshHint: orderRefresh.REFRESH_EXHAUSTED_HINT });
      return;
    }
    this._autoRefreshTimer = setTimeout(() => {
      this._autoRefreshTimer = null;
      this._autoRefreshAttempts += 1;
      this.loadOrders({ silent: true });
    }, orderRefresh.REFRESH_INTERVAL_MS);
  },

  stopAutoRefresh(clearHint = true) {
    if (this._autoRefreshTimer) clearTimeout(this._autoRefreshTimer);
    this._autoRefreshTimer = null;
    this._autoRefreshActive = false;
    this._autoRefreshAttempts = 0;
    if (clearHint !== false && this.data.autoRefreshHint) {
      this.setData({ autoRefreshHint: '' });
    }
  },

  onRetry() {
    this.loadOrders();
  },

  onOrderDetail(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/membership-order-detail/membership-order-detail?orderId=${orderId}` });
  },

  onOpenPaymentFaq() {
    wx.navigateTo({ url: '/pages/guide/guide?focus=payment-faq' });
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
