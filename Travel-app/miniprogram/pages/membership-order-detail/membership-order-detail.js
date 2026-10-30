const app = getApp();
const api = require('../../utils/api.js');
const membershipPay = require('../../utils/membership-pay.js');

function stateOfOrder(order, latestCase) {
  if (!order) return null;
  if (order.status === 'PAID' && order.grantStatus === 'FAILED') {
    return {
      tone: 'error',
      title: '权益发放异常',
      desc: '支付已完成但权益未成功写入，请勿重复支付。先同步支付结果；仍异常时联系售后补发。',
    };
  }
  if (order.refundStatus === 'REFUNDED') {
    return { tone: 'refunded', title: '退款已完成', desc: '本订单新增的会员时长和提醒名额已按订单快照回收，已有提醒未被删除。' };
  }
  if (['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'].includes(order.refundStatus)) {
    return { tone: 'review', title: order.refundStatusLabel || '售后处理中', desc: '客服会在 24 小时内完成审核；退款到账时间以微信支付处理结果为准。' };
  }
  if (order.refundStatus === 'REJECTED') {
    return {
      tone: 'error',
      title: '退款未通过',
      desc: (latestCase && latestCase.decisionNote)
        || order.refundStatusLabel
        || '如有疑问，请联系在线客服复核。',
    };
  }
  if (order.status === 'PENDING') {
    return order.isExpired
      ? { tone: 'closed', title: '订单已过期', desc: '本次未确认到扣款，可重新购买。' }
      : { tone: 'pending', title: '等待支付', desc: '请在 15 分钟内完成支付；重新进入时未过期订单会继续复用。' };
  }
  if (order.status === 'CLOSED') {
    return { tone: 'closed', title: '订单已关闭', desc: '本次订单未完成，可以重新购买。' };
  }
  return { tone: 'success', title: '权益已到账', desc: '支付结果已由服务端确认，权益已写入。' };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    orderId: '',
    loading: true,
    loadFailed: false,
    order: null,
    latestCase: null,
    state: null,
    memberExpiresAtText: '',
    acting: false,
    actionMessage: '',
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      orderId: (options && options.orderId) || '',
    });
  },

  onShow() {
    this.loadOrder();
  },

  loadOrder() {
    if (!this.data.orderId) {
      this.setData({ loading: false, loadFailed: true });
      return Promise.resolve();
    }
    this.setData({ loading: true, loadFailed: false });
    return Promise.all([
      api.reminder.membership.orderDetail(this.data.orderId),
      api.reminder.membership.status(),
      api.payment.afterSales.list(),
    ]).then(([orderRes, statusRes, caseRes]) => {
      const order = orderRes.item || null;
      if (!order) throw { error: '订单不存在', errorCode: 1024 };
      const latestCase = (caseRes.items || []).find(item => item.orderId === order._id) || null;
      this.setData({
        loading: false,
        order,
        latestCase,
        state: stateOfOrder(order, latestCase),
        memberExpiresAtText: (statusRes.membership && statusRes.membership.memberExpiresAtText) || '',
      });
    }).catch(err => {
      this.setData({ loading: false, loadFailed: true });
      api.toastError(err);
    });
  },

  onRetry() { this.loadOrder(); },

  setActionMessage(message) { this.setData({ actionMessage: message || '' }); },

  onPay() {
    if (this.data.acting || !this.data.order) return;
    this.setData({ acting: true });
    this.setActionMessage('正在确认支付结果，请勿重复支付。');
    wx.showLoading({ title: '正在准备支付...' });
    membershipPay.payExistingOrder(this.data.order._id).then(result => {
      wx.hideLoading();
      this.setData({ acting: false });
      if (result.status === 'PAID_GRANTED') {
        this.setActionMessage('权益已到账，正在刷新订单。');
        return this.loadOrder();
      }
      if (result.status === 'PAID_GRANT_FAILED') {
        this.setActionMessage('支付已完成但权益发放异常，请勿重复支付。');
        return this.loadOrder();
      }
      if (result.status === 'PENDING') {
        this.setActionMessage('正在确认支付结果；系统会自动补偿，请稍后刷新。');
        return;
      }
      this.setActionMessage(result.message || '订单已关闭，可以重新购买。');
      return this.loadOrder();
    }).catch(err => {
      wx.hideLoading();
      this.setData({ acting: false });
      this.setActionMessage(err && err.cancelled
        ? '支付未完成，订单仍会保留到过期。'
        : '暂时无法确认支付结果，权益不会丢失，请稍后同步。');
    });
  },

  onSync() {
    if (this.data.acting || !this.data.order) return;
    this.setData({ acting: true });
    this.setActionMessage('正在向微信支付同步结果...');
    api.payment.query({ orderId: this.data.order._id }).then(result => {
      this.setData({ acting: false });
      const message = result.entitlementStatus === 'PAID_GRANTED'
        ? '支付与权益状态已同步。'
        : (result.entitlementStatus === 'PAID_GRANT_FAILED'
          ? '支付已完成，权益发放仍异常，请联系售后补发。'
          : '微信暂未确认支付成功，系统会继续自动补偿。');
      this.setActionMessage(message);
      return this.loadOrder();
    }).catch(() => {
      this.setData({ acting: false });
      this.setActionMessage('暂时无法确认，权益不会丢失；后台会继续自动补偿。');
    });
  },

  onCancel() {
    if (this.data.acting || !this.data.order) return;
    wx.showModal({
      title: '取消订单',
      content: '取消后本次支付单将关闭。若已扣款，系统会先查单确认，不会直接丢弃权益。',
      success: res => {
        if (!res.confirm) return;
        this.setData({ acting: true });
        api.payment.cancel({ orderId: this.data.order._id }).then(() => {
          this.setData({ acting: false });
          this.setActionMessage('订单已取消。');
          return this.loadOrder();
        }).catch(err => {
          this.setData({ acting: false });
          this.setActionMessage('取消失败，可能已支付；请先同步支付结果。');
          api.toastError(err);
        });
      },
    });
  },

  onAfterSales() {
    if (!this.data.order) return;
    wx.navigateTo({ url: `/pages/membership-after-sales/membership-after-sales?orderId=${this.data.order._id}` });
  },

  onRebuy() {
    if (this.data.acting || !this.data.order) return;
    this.setData({ acting: true });
    this.setActionMessage('正在创建新订单...');
    membershipPay.purchase(this.data.order.packageId).then(result => {
      this.setData({ acting: false, orderId: result.orderId || this.data.orderId });
      this.setActionMessage(result.status === 'PAID_GRANTED'
        ? '新订单权益已到账。'
        : '新订单正在确认支付结果，请勿重复支付。');
      return this.loadOrder();
    }).catch(err => {
      this.setData({ acting: false });
      this.setActionMessage(err && err.cancelled ? '支付未完成。' : '暂时无法完成新订单，请稍后重试。');
    });
  },

  onCopy() {
    if (!this.data.order) return;
    wx.setClipboardData({
      data: String(this.data.order.outTradeNo || ''),
      success: () => wx.showToast({ title: '订单号已复制', icon: 'none' }),
    });
  },

  onBack() { wx.navigateBack(); },
});
