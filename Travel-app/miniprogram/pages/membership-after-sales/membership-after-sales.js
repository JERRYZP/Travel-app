const app = getApp();
const api = require('../../utils/api.js');
const membershipPay = require('../../utils/membership-pay.js');

const TYPE_LABEL = {
  RIGHTS_NOT_RECEIVED: '权益未到账',
  DUPLICATE_CHARGE: '重复支付',
  UNUSED_REFUND: '未使用退款',
  ENTITLEMENT_MISMATCH: '权益内容不符',
  OTHER: '其他问题',
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    orderId: '',
    loading: true,
    loadFailed: false,
    order: null,
    existingCase: null,
    previousCase: null,
    reasonOptions: [],
    selectedType: '',
    description: '',
    submitting: false,
    cancelling: false,
    resultMessage: '',
    resultTone: '',
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      orderId: (options && options.orderId) || '',
    });
    this._afterSalesRequestId = '';
  },

  onShow() { this.load(); },

  load() {
    this.setData({ loading: true, loadFailed: false });
    return Promise.all([
      api.reminder.membership.orderDetail(this.data.orderId),
      api.payment.afterSales.list(),
    ]).then(([detailRes, caseRes]) => {
      const order = detailRes.item;
      if (!order) throw { error: '订单不存在', errorCode: 1024 };
      const orderCases = (caseRes.items || []).filter(item => item.orderId === order._id);
      const existingCase = orderCases.find(item =>
        item.orderId === order._id
        && ['SUBMITTED', 'AUTO_CHECKING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'REFUND_FAILED', 'REFUNDED'].includes(item.status)
      ) || null;
      const previousCase = existingCase
        ? null
        : (orderCases.find(item => item.status === 'REJECTED' && item.decisionNote) || null);
      const options = [];
      if (order.status === 'PENDING' || order.grantStatus === 'FAILED' || order.entitlementStatus === 'PAID_GRANT_FAILED') {
        options.push({ type: 'RIGHTS_NOT_RECEIVED', label: TYPE_LABEL.RIGHTS_NOT_RECEIVED, desc: '系统会先查单并尝试补发权益。' });
      }
      if (order.status === 'PAID') {
        if (order.canRequestRefund) {
          options.push({ type: 'UNUSED_REFUND', label: TYPE_LABEL.UNUSED_REFUND, desc: '支付后未新增任何提醒，且仍在 24 小时内。' });
        }
        options.push({ type: 'DUPLICATE_CHARGE', label: TYPE_LABEL.DUPLICATE_CHARGE, desc: '同商品 1 分钟内重复购买，系统会核验。' });
        options.push({ type: 'ENTITLEMENT_MISMATCH', label: TYPE_LABEL.ENTITLEMENT_MISMATCH, desc: '实际权益与购买页说明不一致。' });
        options.push({ type: 'OTHER', label: TYPE_LABEL.OTHER, desc: '订单异常、权益不符或其他售后问题。' });
      }
      const selectedType = options.some(item => item.type === this.data.selectedType)
        ? this.data.selectedType : ((options[0] && options[0].type) || '');
      this.setData({
        loading: false,
        order,
        existingCase,
        previousCase,
        reasonOptions: options,
        selectedType,
      });
    }).catch(err => {
      this.setData({ loading: false, loadFailed: true });
      api.toastError(err);
    });
  },

  onRetry() { this.load(); },

  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    if (this.data.existingCase) return;
    this._afterSalesRequestId = '';
    this.setData({ selectedType: type, resultMessage: '', resultTone: '' });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onSubmit() {
    if (this.data.submitting || this.data.cancelling || this.data.existingCase) return;
    const type = this.data.selectedType;
    if (!type) return;
    if (type === 'OTHER' && !String(this.data.description || '').trim()) {
      wx.showToast({ title: '请补充问题说明', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, resultMessage: '' });
    const requestId = this._afterSalesRequestId || membershipPay.newRequestId();
    this._afterSalesRequestId = requestId;
    api.payment.afterSales.submit({
      orderId: this.data.orderId,
      type,
      requestId,
      reasonCode: type,
      description: String(this.data.description || '').trim(),
    }).then(result => {
      this._afterSalesRequestId = '';
      this.setData({
        submitting: false,
        resultTone: 'success',
        resultMessage: result.resolved
          ? '权益已补发到账，无需再提交售后。'
          : (result.autoRefund
            ? '系统已核验为重复支付，正在自动原路退款。'
            : '售后申请预计 24 小时内处理；超时仍未更新结果，请联系客服。'),
      });
      return this.load();
    }).catch(err => {
      this.setData({
        submitting: false,
        resultTone: 'error',
        resultMessage: (err && err.error) || '提交失败，请稍后重试。',
      });
    });
  },

  onCancelAfterSales() {
    const existingCase = this.data.existingCase;
    if (this.data.cancelling || !existingCase || !existingCase.canCancel) return;
    const isRefundFailed = existingCase.status === 'REFUND_FAILED';
    wx.showModal({
      title: '取消售后申请',
      content: isRefundFailed
        ? '系统会先确认支付渠道没有退款记录。取消后将停止本次异常处理，不会发起退款；如仍有问题，可稍后重新申请。'
        : '取消后将停止本次售后处理，不会发起退款；如仍有问题，可稍后重新申请。',
      confirmText: '确认取消',
      confirmColor: '#A7462B',
      success: res => {
        if (!res.confirm) return;
        this.setData({ cancelling: true, resultMessage: '', resultTone: '' });
        api.payment.afterSales.cancel(existingCase._id).then(() => {
          this.setData({
            cancelling: false,
            resultMessage: '售后申请已取消。',
            resultTone: 'success',
          });
          return this.load();
        }).catch(err => {
          this.setData({
            cancelling: false,
            resultMessage: (err && err.error) || '取消失败，请稍后重试。',
            resultTone: 'error',
          });
        });
      },
    });
  },

  onOrderDetail() {
    wx.redirectTo({ url: `/pages/membership-order-detail/membership-order-detail?orderId=${this.data.orderId}` });
  },

  onBack() { wx.navigateBack(); },
});
