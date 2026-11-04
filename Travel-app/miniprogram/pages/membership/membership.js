const app = getApp();
const api = require('../../utils/api.js');
const membershipPay = require('../../utils/membership-pay.js');
const orderRefresh = require('../../utils/order-refresh.js');

function usagePercentOf(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function formatBeijingDate(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function isIosDevice() {
  try {
    const info = typeof wx !== 'undefined' && wx.getDeviceInfo
      ? wx.getDeviceInfo()
      : (typeof wx !== 'undefined' && wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
    return String((info && info.platform) || '').toLowerCase() === 'ios';
  } catch (err) {
    return false;
  }
}

/**
 * 支付能力不足时的排查指引。
 *
 * 弹窗、页面说明和失败状态卡共用这一份文案——同样的内容写三遍是漂移的起点。
 * 微信版本不写死具体数字：用户看到「8.0.68」也无从对照，给「最新版本」是
 * 他能直接执行的唯一动作。iOS 15 和 Apple ID 地区是稳定硬条件，照写；
 * 付款方式只在 Apple 明确提示不可用时给出自查路径，不把它当作通用解法。
 */
function payUnsupportedTipOf(isIos) {
  return isIos
    ? '请确认 iPhone 系统为 iOS 15 及以上，并将微信更新到最新版本后重试。若 Apple 付款提示付款方式不可用，请在 iPhone“设置 > 你的姓名 > 付款与配送”中添加或更新付款方式，中国大陆可使用微信支付。'
    : '请将微信更新到最新版本后重试。';
}

/**
 * 当前支付环境的一句话描述，如「当前环境 微信 8.0.47 / iOS 16.6。」。
 *
 * 微信版本和系统版本都读得到；Apple ID 地区读不到——iOS 支付失败不可能全部
 * 自动归因。显示出来是为了让用户能对照自查，也让客服不必再问一遍版本号。
 *
 * 只用于展示，不用于拦截：版本门槛（iOS 15 / 微信 8.0.68）来自项目 runbook，
 * 没有和微信官方原文复核过，拿没核实的阈值拦真实用户，可能把本来能付款的人
 * 挡在外面。拦截只用「API 存不存在」这条确定事实。
 */
function payEnvTextOf() {
  try {
    if (typeof wx === 'undefined') return '';
    // 老基础库没有 getAppBaseInfo / getDeviceInfo，统一退回 getSystemInfoSync。
    // 惰性求值：两个新 API 都在时不碰老接口。
    const legacyOf = () => (typeof wx.getSystemInfoSync === 'function'
      ? wx.getSystemInfoSync()
      : {});
    const appBase = typeof wx.getAppBaseInfo === 'function'
      ? wx.getAppBaseInfo()
      : legacyOf();
    const device = typeof wx.getDeviceInfo === 'function'
      ? wx.getDeviceInfo()
      : legacyOf();
    const parts = [];
    const wechatVersion = String((appBase && appBase.version) || '').trim();
    const systemVersion = String((device && device.system) || '').trim();
    if (wechatVersion) parts.push(`微信 ${wechatVersion}`);
    if (systemVersion) parts.push(systemVersion);
    return parts.length ? `当前环境 ${parts.join(' / ')}。` : '';
  } catch (err) {
    // 读不到版本不能连累支付失败提示本身。
    return '';
  }
}

function expectedExpiryOf(pkg, membership, now = Date.now()) {
  const currentMs = new Date((membership && membership.memberExpiresAt) || 0).getTime();
  const validCurrent = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
  const memberDays = Math.max(0, Number(pkg && pkg.memberDays) || 0);
  return new Date(Math.max(
    memberDays ? validCurrent + memberDays * 86400000 : 0,
    Number.isFinite(currentMs) ? currentMs : 0
  ));
}

function defaultPackageIdOf(membership, available) {
  if (membership && membership.member === true) return '';
  const packages = available || [];
  const preferred = packages.find(item => item && item.type === 'MEMBER')
    || packages[0];
  return preferred ? preferred.id : '';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadFailed: false,
    purchasing: false,
    isIosDevice: false,
    payCapability: { supported: true, reason: '' },
    payUnsupportedTip: '',
    membership: null,
    sales: null,
    packages: [],
    visiblePackages: [],
    selectedPackageId: '',
    selectedPackage: null,
    payButtonText: '',
    usagePercent: 0,
    memberStateText: '免费版',
    expiryText: '',
    paymentState: null,
    autoRefreshHint: '',
    showPayConfirm: false,
    confirmTitle: '',
    confirmAmount: '',
    confirmEffect: '',
    confirmExpiry: '',
    confirmPayButtonText: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const requestedPackageId = String((options && options.packageId) || '');
    this._preferredPackageId = requestedPackageId;
    const ios = isIosDevice();
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      isIosDevice: ios,
      payCapability: membershipPay.virtualPayCapability(),
      payUnsupportedTip: payUnsupportedTipOf(ios),
    });
  },

  onShow() {
    this._pageVisible = true;
    const preferredId = this.data.selectedPackageId || this._preferredPackageId || undefined;
    this.loadStatus(preferredId, { silent: !!this.data.membership });
    this.restorePendingPayment();
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
    return this.loadStatus(this.data.selectedPackageId, { silent: true }).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  restorePendingPayment() {
    if (this.data.purchasing || this._restoringPayment) return Promise.resolve();
    const saved = membershipPay.pendingOrder();
    if (!saved || !saved.orderId) return Promise.resolve();
    this._restoringPayment = true;
    this.setPaymentState(
      'PENDING',
      '正在确认支付结果',
      '请勿重复支付；系统会自动查单并在到账后更新权益。',
      saved.orderId
    );
    return api.payment.query({ orderId: saved.orderId }).then(result => {
      this._restoringPayment = false;
      const restored = membershipPay.paidResultOf(result, saved.orderId);
      if (!restored || restored.status === 'PENDING') {
        this.setPaymentState(
          'PENDING',
          '正在确认支付结果',
          '本次订单仍在确认中，系统会继续自动补偿。',
          saved.orderId
        );
        this._beginAutoRefresh();
        return;
      }
      if (restored.status === 'PAID_GRANT_UNKNOWN') {
        this.setPaymentState(
          'PENDING',
          '支付已确认，权益待核验',
          '请勿重复支付；系统正在核验权益发放状态，本页会自动刷新。',
          saved.orderId
        );
        this._beginAutoRefresh();
        return;
      }
      membershipPay.clearPendingOrder(saved.orderId);
      if (restored.status === 'PAID_GRANTED') {
        this.setPaymentState(
          'PAID_GRANTED',
          '权益已到账',
          '支付结果已由服务端确认，会员与提醒名额已更新。',
          saved.orderId
        );
        return this.loadStatus();
      }
      if (restored.status === 'PAID_GRANT_FAILED') {
        this.setPaymentState(
          'PAID_GRANT_FAILED',
          '支付已完成，权益发放异常',
          '请勿重复支付，请打开订单详情同步或联系售后处理。',
          saved.orderId
        );
        return;
      }
      this.setPaymentState(
        restored.status === 'REFUNDED' ? 'REFUNDED' : 'CLOSED',
        restored.status === 'REFUNDED' ? '订单已退款' : '订单已关闭',
        restored.status === 'REFUNDED' ? '本单权益已按快照回收。' : '本次未完成支付，可以重新下单。',
        saved.orderId
      );
    }).catch(() => {
      this._restoringPayment = false;
      this.setPaymentState(
        'PENDING',
        '暂时无法确认支付结果',
        '权益不会丢失；后台会自动补偿，也可打开订单详情手动同步。',
        saved.orderId
      );
      this._beginAutoRefresh();
    });
  },

  loadStatus(preferredId, options) {
    const silent = !!(options && options.silent);
    if (!silent) this.setData({ loading: true, loadFailed: false });
    return Promise.all([
      api.reminder.membership.status(),
      api.reminder.membership.orders().catch(() => null),
    ]).then(([res, orderRes]) => {
      const membership = res.membership || {};
      const sales = res.sales || { state: 'OPEN', purchaseEnabled: true, message: '' };
      const packages = (res.packages || []).map(item => ({ ...item }));
      const memberPackage = packages.find(item => item && item.type === 'MEMBER') || null;
      const membershipView = {
        ...membership,
        memberPackagePriceText: (memberPackage && memberPackage.priceText) || '',
      };
      const visible = packages.filter(item => item.type === 'MEMBER');
      const available = visible.filter(item => item.available);
      let selectedId = preferredId;
      if (!selectedId || !available.some(item => item.id === selectedId)) {
        selectedId = this.defaultPackageIdOf(membership, available);
      }
      const selectedPackage = visible.find(item => item.id === selectedId) || null;
      const used = Number(membership.taskUsed) || 0;
      const limit = Number(membership.taskLimit) || 0;
      const unlimited = membership.taskLimitUnlimited === true;
      const freeSlots = Math.max(0, Number(membership.freeTaskSlots) || 0);
      this.setData({
        loading: false,
        loadFailed: false,
        membership: membershipView,
        sales,
        packages: this.markPackages(packages, selectedId),
        visiblePackages: this.markPackages(visible, selectedId),
        selectedPackageId: selectedId,
        selectedPackage,
        payButtonText: this.payButtonOf(selectedPackage, membership),
        usagePercent: unlimited ? 100 : usagePercentOf(used, limit),
        memberStateText: membership.member ? '会员生效中' : '免费版',
        expiryText: membership.member
          ? `有效期至 ${membership.memberExpiresAtText}`
          : `因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额`,
      });
      if (orderRes) {
        const orders = orderRes.items || [];
        this.syncPaymentStateFromOrders(orders);
        this.applyOrderRefresh(orders);
      } else if (this._autoRefreshActive) {
        this._scheduleAutoRefresh();
      }
    }).catch(err => {
      if (silent) {
        if (this._autoRefreshActive) this._scheduleAutoRefresh();
        return;
      }
      this.setData({ loading: false, loadFailed: true });
      api.toastError(err);
    });
  },

  syncPaymentStateFromOrders(orders) {
    const current = this.data.paymentState;
    if (!current || !current.orderId) return;
    const order = (orders || []).find(item => item._id === current.orderId);
    if (!order || order.status === 'PENDING') return;
    if (order.refundStatus === 'REFUNDED' || order.grantStatus === 'REVERTED') {
      membershipPay.clearPendingOrder(order._id);
      this.setPaymentState(
        'REFUNDED',
        '订单已退款',
        order.grantStatus === 'REVERTED'
          ? '退款已完成，本单新增权益已按快照回收。'
          : '退款已到账，本单新增权益正在自动回收。',
        order._id
      );
      return;
    }
    if (order.grantStatus === 'GRANTED' || order.entitlementStatus === 'PAID_GRANTED') {
      membershipPay.clearPendingOrder(order._id);
      this.setPaymentState(
        'PAID_GRANTED',
        '权益已到账',
        '支付结果已由服务端确认，会员与提醒名额已更新。',
        order._id
      );
      return;
    }
    if (order.grantStatus === 'FAILED' || order.entitlementStatus === 'PAID_GRANT_FAILED') {
      this.setPaymentState(
        'PAID_GRANT_FAILED',
        '支付已完成，权益发放异常',
        '请勿重复支付；系统正在自动补发，也可打开订单查看售后进度。',
        order._id
      );
      return;
    }
    if (order.entitlementStatus === 'PAID_GRANT_UNKNOWN'
      || (order.status === 'PAID' && order.grantStatus === 'UNKNOWN')) {
      this.setPaymentState(
        'PENDING',
        '支付已确认，权益待核验',
        '请勿重复支付；系统正在核验权益发放状态，本页会自动刷新。',
        order._id
      );
      return;
    }
    if (order.status === 'CLOSED') {
      this.setPaymentState('CLOSED', '订单已关闭', '本次未完成支付，可以重新下单。', order._id);
    }
  },

  applyOrderRefresh(orders) {
    if (!orderRefresh.hasTransientOrder(orders)) {
      this.stopAutoRefresh();
      return;
    }
    this.setData({ autoRefreshHint: orderRefresh.refreshHintOf(orders) });
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
      this.loadStatus(this.data.selectedPackageId, { silent: true });
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
    this.loadStatus(this.data.selectedPackageId);
  },

  markPackages(packages, selectedId) {
    return (packages || []).map(item => ({
      ...item,
      _selected: item.id === selectedId,
      _available: item.available === true,
    }));
  },

  defaultPackageIdOf,

  payButtonOf(pkg, membership) {
    const current = membership || this.data.membership || {};
    if (current.member === true) {
      const days = Math.max(0, Number(current.memberDurationDays)
        || Number(pkg && pkg.memberDays) || 30);
      return `续费${days}天会员`;
    }
    if (!pkg) return '请先选择会员套餐';
    if (pkg.type === 'MEMBER') {
      const days = Math.max(0, Number(pkg.memberDays) || 0);
      return `支付 ${pkg.priceText}，开通 ${days} 天会员并继续`;
    }
    return '暂无可购买项';
  },

  onPackageTap(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.visiblePackages.find(item => item.id === id);
    if (!pkg) return;
    if (!pkg._available) {
      wx.showToast({ title: pkg.actionText, icon: 'none' });
      return;
    }
    const selectedId = this.data.selectedPackageId === id ? '' : id;
    const selectedPackage = selectedId
      ? (this.data.packages.find(item => item.id === selectedId) || pkg)
      : null;
    this.setData({
      selectedPackageId: selectedId,
      selectedPackage,
      packages: this.markPackages(this.data.packages, selectedId),
      visiblePackages: this.markPackages(this.data.visiblePackages, selectedId),
      payButtonText: this.payButtonOf(selectedPackage, this.data.membership),
    });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/membership-orders/membership-orders' });
  },

  /**
   * 能力不足时不进入下单流程，直接说明原因。
   *
   * 走完整下单再失败，用户看到的只是一个订单和一句「支付未完成」，
   * 既不知道设备不支持，也不知道该改什么。
   */
  showPayUnsupported() {
    wx.showModal({
      title: '当前设备无法完成购买',
      content: this.data.payUnsupportedTip,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onPay() {
    if (this.data.purchasing || !this.data.selectedPackage) return;
    if (this.data.sales && this.data.sales.purchaseEnabled === false) {
      wx.showToast({ title: this.data.sales.message || '会员购买暂停中', icon: 'none' });
      return;
    }
    if (!this.data.payCapability.supported) {
      this.showPayUnsupported();
      return;
    }
    const pkg = this.data.selectedPackage;
    const expiry = expectedExpiryOf(pkg, this.data.membership);
    this.setData({
      showPayConfirm: true,
      confirmTitle: `${Number(pkg.memberDays) || 0} 天会员`,
      confirmAmount: pkg.priceText,
      confirmEffect: '支付成功后立即生效，会员有效期内不限提醒名额',
      confirmExpiry: `会员有效期至 ${formatBeijingDate(expiry)}`,
      confirmPayButtonText: `支付 ${pkg.priceText}`,
    });
  },

  onClosePayConfirm() {
    if (this.data.purchasing) return;
    this.setData({ showPayConfirm: false });
  },

  setPaymentState(status, title, description, orderId) {
    /* 会员状态卡已经展示到期日和名额，成功态不再重复一张“权益已到账”卡片。
       只有支付中、失败、关闭等仍需用户处理的状态保留持久反馈。 */
    this.setData({
      paymentState: status === 'PAID_GRANTED'
        ? null
        : { status, title, description, orderId: orderId || '' },
    });
  },

  onConfirmPay() {
    if (this.data.purchasing || !this.data.selectedPackage) return;
    const pkg = this.data.selectedPackage;
    this.setData({ purchasing: true, showPayConfirm: false });
    this.setPaymentState('PENDING', '正在准备支付', '请确认商品、金额和生效时间。');
    wx.showLoading({ title: '正在准备支付...' });
    membershipPay.purchase(pkg.id).then(result => {
      wx.hideLoading();
      this.setData({ purchasing: false });
      if (result.status === 'PAID_GRANTED') {
        this.setPaymentState(
          'PAID_GRANTED',
          '权益已到账',
          result.memberExpiresAt
            ? `会员有效期至 ${formatBeijingDate(result.memberExpiresAt)}，本次提醒名额已更新。`
            : '会员与提醒名额已更新。',
          result.orderId
        );
        return this.loadStatus();
      }
      if (result.status === 'PAID_GRANT_FAILED') {
        this.setPaymentState(
          'PAID_GRANT_FAILED',
          '支付已完成，权益发放异常',
          '系统已记录该订单，请勿重复支付。请查看订单并联系售后处理。',
          result.orderId
        );
        return;
      }
      if (result.status === 'PAID_GRANT_UNKNOWN') {
        this.setPaymentState(
          'PENDING',
          '支付已确认，权益待核验',
          '请勿重复支付。系统会继续核验权益发放状态并自动刷新。',
          result.orderId
        );
        this._beginAutoRefresh();
        return;
      }
      if (result.status === 'REFUNDED') {
        this.setPaymentState('REFUNDED', '订单已退款', '本单权益已按订单快照回收。', result.orderId);
        return this.loadStatus();
      }
      if (result.status === 'CLOSED') {
        this.setPaymentState('CLOSED', '订单已关闭', '本次未扣款，可以重新下单。', result.orderId);
        return;
      }
      this.setPaymentState(
        'PENDING',
        '正在确认支付结果',
        '请勿重复支付。系统会自动查单并在到账后更新权益。',
        result.orderId
      );
      this._beginAutoRefresh();
    }).catch(err => {
      wx.hideLoading();
      this.setData({ purchasing: false });
      if (err && err.cancelled) {
        this.setPaymentState(
          'CANCELLED',
          '支付未完成',
          '本次清单和提醒设置已保留；未扣款时不会发放权益。',
          err.orderId
        );
        return;
      }
      if (err && err.errorCode === 1032) {
        this.setPaymentState(
          'FAILED',
          '支付未完成',
          err.error || '会员购买暂停中，请稍后再试。',
          err && err.orderId
        );
        return;
      }
      // 拉起不了支付窗口是设备侧问题，必须把排查路径写出来。
      // 让用户对着「支付未完成」反复重试，等于什么也没告诉他。
      this.setPaymentState(
        'FAILED',
        err && err.unsupported ? '当前设备无法完成购买' : '支付窗口没能打开',
        `${payEnvTextOf()}${this.data.payUnsupportedTip}本次尚未发放权益；如微信已扣款，请打开订单详情同步支付结果。`,
        err && err.orderId
      );
    });
  },

  onPaymentOrder() {
    const orderId = this.data.paymentState && this.data.paymentState.orderId;
    if (!orderId) return this.onOrders();
    wx.navigateTo({ url: `/pages/membership-order-detail/membership-order-detail?orderId=${orderId}` });
  },

  onBack() {
    wx.navigateBack();
  },
});

module.exports = { payEnvTextOf };
