const app = getApp();
const api = require('../../utils/api.js');
const membershipPay = require('../../utils/membership-pay.js');
const orderRefresh = require('../../utils/order-refresh.js');

function entitlementReverted(order) {
  return order.grantStatus === 'REVERTED'
    || !!(order.entitlementGrant && order.entitlementGrant.revertedAt);
}

function isAppleOrder(order) {
  return !!order && order.paymentChannel === 'APPLE';
}

function refundChannelName(order) {
  return isAppleOrder(order) ? 'Apple' : '微信支付';
}

function afterSalesActionLabelOf(order) {
  if (!order) return '';
  if (isAppleOrder(order)) {
    return '如何申请APP退款';
  }
  return (order.actionFlags && order.actionFlags.afterSalesLabel) || '未到账/申请售后';
}

function stateOfOrder(order, latestCase) {
  if (!order) return null;
  if (order.refundStatus === 'REFUNDED') {
    if (order.grantStatus === 'GRANTED' && !entitlementReverted(order)) {
      return {
        tone: 'review',
        title: '退款已到账，权益正在回收',
        desc: `${refundChannelName(order)}退款已完成；系统正在按本单快照回收会员时长和提醒名额，页面会自动更新，已有提醒不会被删除。`,
      };
    }
    return {
      tone: 'refunded',
      title: '退款已完成',
      desc: '本订单新增的会员时长和提醒名额已按订单快照回收，已有提醒未被删除。',
    };
  }
  if (['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'].includes(order.refundStatus)) {
    const processing = order.refundStatus === 'PROCESSING';
    return {
      tone: 'review',
      title: order.refundStatusLabel || (processing || isAppleOrder(order) ? '退款处理中' : '售后处理中'),
      desc: processing
        ? `${refundChannelName(order)}正在处理退款，页面会自动更新到账结果；权益回收完成后再显示最终状态。`
        : '客服会在 24 小时内完成审核；页面会自动更新审核结果。',
    };
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
  if (order.refundStatus === 'FAILED') {
    return {
      tone: 'error',
      title: '退款暂时失败',
      desc: isAppleOrder(order)
        ? '本次退款未完成，当前权益仍有效。请以 Apple 最终处理结果为准，不要重复申请。'
        : '本次退款未完成，当前权益仍有效。请打开售后进度联系客服重试，不要重复申请。',
    };
  }
  if (order.status === 'PAID'
    && (order.grantStatus === 'GRANTED' || order.entitlementStatus === 'PAID_GRANTED')
    && !entitlementReverted(order)) {
    return {
      tone: 'success',
      title: '支付已完成，权益已到账',
      desc: '本订单对应的会员时长和提醒名额已经生效。',
    };
  }
  if (order.status === 'PAID' && order.grantStatus === 'FAILED') {
    return {
      tone: 'error',
      title: '权益发放异常',
      desc: isAppleOrder(order)
        ? '支付已完成但权益未成功写入，请勿重复支付。系统会自动补发，页面将更新结果。'
        : '支付已完成但权益未成功写入，请勿重复支付。系统会自动补发，页面将更新结果；仍异常时联系售后处理。',
    };
  }
  if (order.status === 'PAID'
    && (order.grantStatus === 'UNKNOWN' || order.entitlementStatus === 'PAID_GRANT_UNKNOWN')) {
    return {
      tone: 'review',
      title: '支付已确认，权益待核验',
      desc: '支付结果已经确认，但权益发放状态尚不明确。系统会自动核验，请勿重复支付或重复下单。',
    };
  }
  if (order.status === 'PENDING') {
    return order.isExpired
      ? { tone: 'closed', title: '订单已过期', desc: '本次未确认到扣款，可重新购买。' }
      : { tone: 'pending', title: '等待支付', desc: '请在 15 分钟内完成支付；支付后页面会自动确认服务端结果。' };
  }
  if (order.status === 'CLOSED') {
    return { tone: 'closed', title: '订单已关闭', desc: '本次订单未完成，可以重新购买。' };
  }
  return { tone: 'review', title: '状态待核验', desc: '请稍后重新进入订单页确认最终状态。' };
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
    afterSalesActionLabel: '',
    memberExpiresAtText: '',
    acting: false,
    actionMessage: '',
    autoRefreshHint: '',
    showIosRefundGuide: false,
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
    this._pageVisible = true;
    this.loadOrder({ silent: !!this.data.order });
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
    return this.loadOrder({ silent: true }).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  loadOrder(options) {
    const silent = !!(options && options.silent);
    if (!this.data.orderId) {
      this.setData({ loading: false, loadFailed: true });
      return Promise.resolve();
    }
    if (!silent) this.setData({ loading: true, loadFailed: false });
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
        loadFailed: false,
        order,
        latestCase,
        state: stateOfOrder(order, latestCase),
        afterSalesActionLabel: afterSalesActionLabelOf(order),
        memberExpiresAtText: (statusRes.membership && statusRes.membership.memberExpiresAtText) || '',
      });
      this.applyOrderRefresh(order);
    }).catch(err => {
      if (silent) {
        if (this._autoRefreshActive) this._scheduleAutoRefresh();
        return;
      }
      this.setData({ loading: false, loadFailed: true });
      api.toastError(err);
    });
  },

  applyOrderRefresh(order) {
    if (!orderRefresh.isTransientOrder(order)) {
      this.stopAutoRefresh();
      return;
    }
    this.setData({ autoRefreshHint: orderRefresh.refreshHintOf([order]) });
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
      this.loadOrder({ silent: true });
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
        this.setActionMessage('正在确认支付结果；系统会自动补偿，页面将自动更新。');
        this._beginAutoRefresh();
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
          ? (isAppleOrder(this.data.order)
            ? '支付已完成，权益发放仍异常，系统会继续自动补偿。'
            : '支付已完成，权益发放仍异常，请联系售后补发。')
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
    if (isAppleOrder(this.data.order)) {
      this.setData({ showIosRefundGuide: true });
      return;
    }
    this.onOpenAfterSales();
  },

  onOpenAfterSales() {
    if (!this.data.order) return;
    this.setData({ showIosRefundGuide: false });
    wx.navigateTo({ url: `/pages/membership-after-sales/membership-after-sales?orderId=${this.data.order._id}` });
  },

  onCloseIosRefundGuide() {
    this.setData({ showIosRefundGuide: false });
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

  noop() {},

  onBack() { wx.navigateBack(); },
});

module.exports = { stateOfOrder };
