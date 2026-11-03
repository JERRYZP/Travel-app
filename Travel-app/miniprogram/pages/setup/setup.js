const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');
const oa = require('../../utils/official-account.js');
const membershipEntry = require('../../utils/membership-entry.js');
const membershipPay = require('../../utils/membership-pay.js');
const membershipCache = require('../../utils/membership-cache.js');
const orderRefresh = require('../../utils/order-refresh.js');

/** 成功卡片自动返回首页的秒数；倒计时文案同步走弱化提示 */
const AUTO_BACK_SECONDS = 4;
const CART_BOOTSTRAP_TTL_MS = 5 * 60 * 1000;

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    channels: {
      officialAccount: true,
      sms: false,
    },
    offsets: [5],
    checkedOffset5: true,
    checkedOffset2: false,
    reminderCount: 0,
    quotaNeeded: 0,
    subscribeQuota: 0,
    ledgerQuota: 0,
    reservedQuota: 0,
    shortfall: 0,
    membership: null,
    subscriptionStatus: null,
    membershipSales: null,
    packages: [],
    showMembershipGate: false,
    membershipGateTitle: '',
    membershipGateDesc: '',
    membershipGateNote: '',
    membershipActionText: '',
    membershipGateActionDisabled: false,
    membershipQuotaLimit: 0,
    membershipQuotaUsed: 0,
    membershipQuotaRemaining: 0,
    membershipQuotaRequested: 0,
    membershipQuotaGap: 0,
    upgradePackageId: '',
    paymentState: null,
    showUpgradeConfirm: false,
    upgradeConfirmTitle: '',
    upgradeConfirmDesc: '',
    upgradeConfirmAmount: '',
    upgradeConfirmExpiry: '',
    systemOk: false,
    accessReady: false,
    canSubmit: false,
    gateText: '正在检查提醒权限',
    authFeedback: '',
    authFeedbackTone: '',
    templateId: '',
    submitting: false,
    showSampleSheet: false,
    /* 成功态：轻量卡片替代原来的 toast，卡片里只留一行公众号入口 */
    showSuccess: false,
    successTitle: '',
    oaEntryText: oa.SETUP_ENTRY,
    successCountdown: AUTO_BACK_SECONDS,
    showOaSheet: false,
  },

  onLoad() {
    const g = app.globalData;
    /* 2026-09-20 纯预览化后不再有 tripId 可传：清单是「提交前的暂存区」，
       行程要到 cart.commit 那一刻才创建/合并。这里只管提前量与通道。 */
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      templateId: (notify.SUBSCRIBE_TEMPLATES[0] || {}).templateId || '',
    });
  },

  onShow() {
    this._pageVisible = true;
    /* 授权反馈必须留到下一次用户动作再覆盖。WeChat 授权窗/设置页返回时
       也可能触发 onShow；在这里清空会让“拒绝授权”只剩一个转瞬即逝的 Toast，
       页面数字又恰好没变化，用户会以为点击没生效。 */
    this.loadCartAndAccess().then(() => this.restorePendingPayment());
  },

  onHide() {
    this._pageVisible = false;
    this.stopPaymentAutoRefresh(false);
  },

  loadCartAndAccess(options) {
    const cacheVersion = membershipCache.version();
    const membershipChanged = !!this.data.membership
      && this._membershipDataVersion !== cacheVersion;
    const force = !!(options && options.force) || membershipChanged;
    if (!force && this.data.membership && this._cartLoadedAt > 0
      && Date.now() - this._cartLoadedAt < CART_BOOTSTRAP_TTL_MS) {
      return this.refreshAccessState(this.data.quotaNeeded);
    }
    const bootstrap = typeof api.reminder.cart.bootstrap === 'function'
      ? api.reminder.cart.bootstrap().catch(() => api.reminder.cart.list(null, { includeMembership: true }))
      : api.reminder.cart.list(null, { includeMembership: true });
    return bootstrap.then(res => {
      const reminderCount = (res && res.summary && res.summary.reminderCount) || 0;
      const quotaNeeded = reminderCount * this.data.offsets.length;
      const packages = (res && Array.isArray(res.packages) ? res.packages : []).map(item => ({ ...item }));
      const membershipSales = (res && res.sales) || null;
      const gate = this.membershipGateOf(
        reminderCount,
        res && res.membership,
        packages,
        membershipSales
      );
      this.setData({
        reminderCount,
        quotaNeeded,
        membership: (res && res.membership) || null,
        subscriptionStatus: (res && res.subscription) || null,
        membershipSales,
        packages,
        ...gate,
      });
      this._cartLoadedAt = Date.now();
      this._membershipDataVersion = cacheVersion;
      return this.refreshAccessState(quotaNeeded);
    }).catch(() => this.refreshAccessState(this.data.quotaNeeded));
  },

  membershipGateOf(reminderCount, current, availablePackages, sales) {
    const requested = Math.max(0, Math.floor(Number(reminderCount) || 0));
    const taskLimit = Math.max(0, Math.floor(Number(current && current.taskLimit) || 0));
    const taskUsed = Math.max(0, Math.floor(Number(current && current.taskUsed) || 0));
    const rawRemaining = current && Number(current.taskRemaining);
    const taskRemaining = Number.isFinite(rawRemaining)
      ? Math.max(0, Math.floor(rawRemaining))
      : Math.max(0, taskLimit - taskUsed);
    const quotaFields = {
      membershipQuotaLimit: taskLimit,
      membershipQuotaUsed: taskUsed,
      membershipQuotaRemaining: taskRemaining,
      membershipQuotaRequested: requested,
      membershipQuotaGap: Math.max(0, requested - taskRemaining),
    };

    if (!current || requested <= taskRemaining) {
      return {
        showMembershipGate: false,
        membershipGateTitle: '',
        membershipGateDesc: '',
        membershipGateNote: '',
        membershipActionText: '',
        membershipGateActionDisabled: false,
        ...quotaFields,
        upgradePackageId: '',
      };
    }

    const gap = quotaFields.membershipQuotaGap;
    const packages = Array.isArray(availablePackages) ? availablePackages : [];
    const freeSlots = Math.max(0, Number(current.freeTaskSlots) || 0);
    const memberSlots = Math.max(freeSlots, Number(current.memberTaskSlots) || 0);
    const taskPackSize = Math.max(0, Number(current.taskPackSize) || 0);
    const memberDays = Math.max(0, Number(current.memberDurationDays) || 0);
    const purchaseEnabled = !sales || sales.purchaseEnabled !== false;
    const salesMessage = (sales && sales.message) || '会员购买暂停中，请稍后再试。';
    const preferredType = current.member ? 'TASK_PACK' : 'MEMBER';
    const pkg = purchaseEnabled
      ? packages.find(item =>
        item && item.type === preferredType && item.available !== false) || null
      : null;
    const priceText = (pkg && pkg.priceText) || '';
    const displayPackSize = taskPackSize || Number(pkg && pkg.addedSlots) || 0;
    const displayMemberDays = memberDays || Number(pkg && pkg.memberDays) || 0;
    if (current.member) {
      return {
        showMembershipGate: true,
        membershipGateTitle: `还差 ${gap} 个提醒名额`,
        membershipGateDesc: purchaseEnabled
          ? (displayPackSize
            ? `加购 ${displayPackSize} 个提醒名额；名额永久记录，会员有效期内生效。`
            : '可在会员有效期内加购提醒名额。')
          : salesMessage,
        membershipGateNote: purchaseEnabled
          ? `会员到期：${current.memberExpiresAtText || '—'}`
          : `会员到期：${current.memberExpiresAtText || '—'}；已有权益不受影响`,
        membershipActionText: purchaseEnabled
          ? (pkg
            ? `支付 ${priceText}，加购 ${displayPackSize} 个名额并继续`
            : '暂无可购买的名额包')
          : '会员购买暂停中',
        membershipGateActionDisabled: !purchaseEnabled,
        ...quotaFields,
        upgradePackageId: pkg ? pkg.id : '',
      };
    }

    return {
      showMembershipGate: true,
      membershipGateTitle: `还差 ${gap} 个提醒名额`,
      membershipGateDesc: purchaseEnabled
        ? `因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额；开通会员后上限提升至 ${memberSlots} 个${displayMemberDays ? `，有效期 ${displayMemberDays} 天` : ''}。`
        : salesMessage,
      membershipGateNote: purchaseEnabled
        ? (pkg ? `${priceText} / ${displayMemberDays} 天，不自动续费` : '会员商品暂不可购买')
        : '已有会员权益、订单和售后不受影响',
      membershipActionText: purchaseEnabled
        ? (pkg
          ? `支付 ${priceText}，开通 ${displayMemberDays} 天会员并继续`
          : '暂无可购买的会员商品')
        : '会员购买暂停中',
      membershipGateActionDisabled: !purchaseEnabled,
      ...quotaFields,
      upgradePackageId: pkg ? pkg.id : '',
    };
  },

  refreshAccessState(needed, options) {
    const want = typeof needed === 'number' ? needed : this.data.quotaNeeded;
    const applyHealth = health => {
      /* 已排队的提醒还没发送，但它们会消耗微信一次性订阅次数；这里必须用
         「台账剩余 - 待发送消息数」的可用额度，否则会把同一笔授权重复承诺给新提醒。
         老版本测试桩/旧接口没有 availableQuota 时回退到 quota，保持兼容。 */
      const ledgerQuota = Math.max(0, Number(health.quota) || 0);
      const subscribeQuota = Number.isFinite(health.availableQuota)
        ? health.availableQuota : (health.quota || 0);
      const reservedQuota = Math.max(0, ledgerQuota - subscribeQuota);
      const shortfall = Math.max(0, want - subscribeQuota);
      const hasChannel = this.data.channels.officialAccount === true;
      const membershipBlocked = this.data.showMembershipGate === true;
      const accessReady = health.systemOk && shortfall === 0 && want > 0;
      const canSubmit = accessReady && hasChannel && !membershipBlocked;
      let gateText = '';
      if (!hasChannel) gateText = '请选择微信通知提醒';
      else if (!health.systemOk) gateText = '请先开启微信通知权限';
      else if (shortfall > 0) {
        gateText = '当前可用 ' + subscribeQuota + ' 次，还差 ' + shortfall + ' 次授权，补齐后才能开启提醒';
      } else if (membershipBlocked) {
        gateText = '提醒名额不足，请先开通会员或加购名额';
      } else if (want === 0) gateText = '当前没有需要提醒的景点';
      this.setData({
        quotaNeeded: want,
        systemOk: health.systemOk,
        subscribeQuota,
        ledgerQuota,
        reservedQuota,
        shortfall,
        accessReady,
        canSubmit,
        gateText,
      });
    };
    const cached = this.data.subscriptionStatus;
    if (cached && cached.success !== false && !(options && options.force)) {
      return Promise.resolve(applyHealth({
        ...cached,
        systemOk: notify.getSystemNotifyOk(),
      }));
    }
    return notify.getReminderHealth(this.data.templateId).then(applyHealth);
  },

  onToggleChannel(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'sms') return;
    const channels = Object.assign({}, this.data.channels);
    channels[key] = !channels[key];
    this.setData({ channels }, () => this.refreshAccessState(this.data.quotaNeeded));
  },

  /* 提前量单选：5 分钟 / 2 分钟二选一（一次性订阅消息按条授权，一条任务只发一条提醒） */
  onToggleOffset(e) {
    const val = Number(e.currentTarget.dataset.val);
    const quotaNeeded = this.data.reminderCount * 1;
    this.setData({
      offsets: [val],
      checkedOffset5: val === 5,
      checkedOffset2: val === 2,
      quotaNeeded,
    }, () => this.refreshAccessState(quotaNeeded));
  },

  onOpenSystem() {
    notify.openSystemNotifySetting();
  },

  /** 硬闸门：额度不足时只能由用户点击补齐，不能由提交动作自动代替。 */
  onFillQuota() {
    const shortfall = Math.max(0, this.data.shortfall || 0);
    if (shortfall <= 0) return;
    if (!this.data.systemOk) {
      this.onOpenSystem();
      return;
    }
    if (this._fillingQuota) return;
    this._fillingQuota = true;
    const releaseFill = () => { this._fillingQuota = false; };
    wx.showLoading({ title: '正在申请授权...' });
    const beforeAvailable = Math.max(0, Number(this.data.subscribeQuota) || 0);
    const beforeLedger = Math.max(0, Number(this.data.ledgerQuota) || 0);
    /* 微信一次性订阅：一次点击最多完成一次授权调用，也就是最多 +1 条。
       “总是保持”只免去后续弹窗，不会让一次点击批量增加同模板额度。 */
    return notify.requestSubscribeBurst(1, this.data.templateId).then(res => {
      wx.hideLoading();
      this.setData({ subscriptionStatus: null });
      return this.refreshAccessState(this.data.quotaNeeded, { force: true }).then(() => {
        const available = Math.max(0, Number(this.data.subscribeQuota) || 0);
        const ledgerGain = Math.max(0, (Number(this.data.ledgerQuota) || 0) - beforeLedger);
        const availableGain = Math.max(0, available - beforeAvailable);
        const left = Math.max(0, this.data.shortfall || 0);

        if (res.ok && ledgerGain > 0 && availableGain > 0) {
          const feedback = left > 0
            ? '已新增 ' + availableGain + ' 次授权，当前可用 ' + available + ' 次，还差 ' + left + ' 次。'
            : '授权已补齐，当前可用 ' + available + ' 次。';
          this.setData({ authFeedback: feedback, authFeedbackTone: 'ok' });
          wx.showToast({
            title: left > 0 ? ('当前可用 ' + available + ' 次，还差 ' + left + ' 次') : '授权已补齐',
            icon: 'none',
          });
          if (!res.silent && !res.remembered) notify.hintKeepAlwaysChoice();
          return;
        }

        /* 授权确实到账，但新增额度被已排队的提醒占用：台账 +1，可用额度不变。
           这是「界面没变化」最容易让人误以为失败的真实场景，必须把占用说清楚。 */
        if (res.ok && ledgerGain > 0) {
          const reserved = Math.max(0, Number(this.data.reservedQuota) || 0);
          const feedback = reserved > 0
            ? '已新增 ' + ledgerGain + ' 次授权，但已被 ' + reserved
              + ' 条待发送提醒占用；当前可用仍为 ' + available + ' 次' + (left > 0 ? '，还差 ' + left + ' 次。' : '。')
            : '授权已到账，但暂未转化为可用额度，请稍后重试。';
          this.setData({ authFeedback: feedback, authFeedbackTone: 'warn' });
          wx.showToast({
            title: reserved > 0 ? '授权已增加，但已被待发送提醒占用' : '额度暂未同步，请稍后重试',
            icon: 'none',
          });
          return;
        }

        /* 微信侧已允许，但云端额度没读到增量：不谎报“已补齐”，提示稍后重试。 */
        if (res.ok) {
          const feedback = '授权已提交，但额度暂未同步，请稍后再试。';
          this.setData({ authFeedback: feedback, authFeedbackTone: 'warn' });
          wx.showToast({ title: '额度暂未同步，请稍后重试', icon: 'none' });
          return;
        }

        let feedback = '';
        if (res.reason === 'master-switch-off' || res.reason === 'subscription-disabled') {
          feedback = '订阅授权仍未开启，请到微信授权设置中改为允许后再试。';
          notify.guideOpenSubscribeSetting(res.reason);
        } else if (res.reason === 'rejected') {
          feedback = '本次未授权，当前可用 ' + available + ' 次'
            + (left > 0 ? '，还差 ' + left + ' 次。' : '。');
          wx.showToast({ title: '已取消，本次未增加授权', icon: 'none' });
        } else if (res.reason === 'banned') {
          feedback = '该模板已被微信限制，暂时无法补齐授权。';
          wx.showToast({ title: '该模板已被微信限制，暂无法补齐', icon: 'none' });
        } else if (res.reason === 'template-filtered') {
          feedback = '模板未通过微信校验，请稍后再试。';
          wx.showToast({ title: '模板未通过微信校验，请稍后再试', icon: 'none' });
        } else {
          feedback = '授权未完成，请重试。';
          console.warn('[setup] fill quota failed', res);
          wx.showToast({ title: '授权未完成，请重试', icon: 'none' });
        }
        this.setData({ authFeedback: feedback, authFeedbackTone: 'warn' });
      });
    }).then(result => {
      releaseFill();
      return result;
    }).catch(() => {
      releaseFill();
      wx.hideLoading();
      this.setData({ authFeedback: '授权未完成，请重试。', authFeedbackTone: 'warn' });
      wx.showToast({ title: '授权未完成，请重试', icon: 'none' });
    });
  },

  onOpenSample() { this.setData({ showSampleSheet: true }); },
  onCloseSample() { this.setData({ showSampleSheet: false }); },

  restorePendingPayment() {
    if (this._upgrading || this._restoringPayment) return Promise.resolve();
    const saved = membershipPay.pendingOrder();
    if (!saved || !saved.orderId) return Promise.resolve();
    this.setPaymentState(
      'PENDING',
      '正在确认支付结果',
      '请勿重复支付；系统会自动查单并在到账后更新权益。',
      saved.orderId
    );
    return this.queryPendingPayment(saved, true);
  },

  queryPendingPayment(saved, initial = false) {
    if (!saved || !saved.orderId || !this._pageVisible) return Promise.resolve();
    if (!initial) this._restoringPayment = true;
    return api.payment.query({ orderId: saved.orderId }).then(result => {
      this._restoringPayment = false;
      const restored = membershipPay.paidResultOf(result, saved.orderId);
      if (!restored || restored.status === 'PENDING') {
        this.setPaymentState(
          'PENDING',
          '正在确认支付结果',
          '本次清单和提醒设置已保留，系统会继续自动补偿。',
          saved.orderId
        );
        this._beginPaymentAutoRefresh();
        return;
      }
      if (restored.status === 'PAID_GRANT_UNKNOWN') {
        this.setPaymentState(
          'PENDING',
          '支付已确认，权益待核验',
          '请勿重复支付；系统正在核验权益发放状态，本页会自动刷新。',
          saved.orderId
        );
        this._beginPaymentAutoRefresh();
        return;
      }
      this.stopPaymentAutoRefresh();
      membershipPay.clearPendingOrder(saved.orderId);
      if (restored.status === 'PAID_GRANTED') {
        /* 权益到账会改变会员名额；必须绕过页面 5 分钟 bootstrap 缓存，
           否则这里仍会拿支付前的免费额度重算闸门。 */
        return this.loadCartAndAccess({ force: true }).then(() => {
          this.setPaymentState(
            'PAID_GRANTED',
            '权益已到账',
            '支付结果已由服务端确认，请确认提醒时间后继续开启提醒。',
            saved.orderId
          );
        });
      }
      if (restored.status === 'PAID_GRANT_FAILED') {
        this.setPaymentState(
          'PAID_GRANT_FAILED',
          '支付已完成，权益发放异常',
          '请勿重复支付；请到订单详情同步或联系售后处理。',
          saved.orderId
        );
        return;
      }
      this.setPaymentState(
        restored.status === 'REFUNDED' ? 'REFUNDED' : 'CLOSED',
        restored.status === 'REFUNDED' ? '订单已退款' : '订单已关闭',
        restored.status === 'REFUNDED'
          ? '本单权益已按订单快照回收，已有提醒不会被删除。'
          : '本次未完成支付，可以重新发起。',
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
      this._beginPaymentAutoRefresh();
    });
  },

  _beginPaymentAutoRefresh() {
    if (!this._pageVisible || !membershipPay.pendingOrder()) return;
    if (!this._paymentRefreshActive) {
      this._paymentRefreshActive = true;
      this._paymentRefreshAttempts = 0;
    }
    this._schedulePaymentAutoRefresh();
  },

  _schedulePaymentAutoRefresh() {
    if (!this._pageVisible || !this._paymentRefreshActive || this._paymentRefreshTimer) return;
    if (this._paymentRefreshAttempts >= orderRefresh.REFRESH_MAX_ATTEMPTS) {
      this.stopPaymentAutoRefresh(false);
      const id = membershipPay.pendingOrder();
      if (id && id.orderId) {
        this.setPaymentState(
          'PENDING',
          '支付结果仍待确认',
          orderRefresh.REFRESH_EXHAUSTED_HINT,
          id.orderId
        );
      }
      return;
    }
    this._paymentRefreshTimer = setTimeout(() => {
      this._paymentRefreshTimer = null;
      this._paymentRefreshAttempts += 1;
      const saved = membershipPay.pendingOrder();
      if (!saved) return this.stopPaymentAutoRefresh();
      return this.queryPendingPayment(saved, false);
    }, orderRefresh.REFRESH_INTERVAL_MS);
  },

  stopPaymentAutoRefresh() {
    if (this._paymentRefreshTimer) clearTimeout(this._paymentRefreshTimer);
    this._paymentRefreshTimer = null;
    this._paymentRefreshActive = false;
    this._paymentRefreshAttempts = 0;
  },

  onMembership() {
    const current = this.data.membership || {};
    const requested = Math.max(0, Number(this.data.reminderCount) || 0);
    const remaining = Math.max(0, Number(current.taskRemaining) || 0);
    const preferredType = current.member ? 'TASK_PACK' : 'MEMBER';
    const preferredPackage = (this.data.packages || []).find(item =>
      item && item.type === preferredType) || null;
    const packageId = this.data.upgradePackageId || (preferredPackage && preferredPackage.id) || '';
    const query = [
      'reason=task_limit',
      `packageId=${encodeURIComponent(packageId)}`,
      `used=${encodeURIComponent(Number(current.taskUsed) || 0)}`,
      `limit=${encodeURIComponent(Number(current.taskLimit) || 0)}`,
      `requested=${encodeURIComponent(requested)}`,
      `shortfall=${encodeURIComponent(Math.max(0, requested - remaining))}`,
    ].join('&');
    wx.navigateTo({ url: `/pages/membership/membership?${query}` });
  },

  onUpgradeAndContinue() {
    if (this._upgrading || this.data.submitting) return;
    if (this.data.membershipSales && this.data.membershipSales.purchaseEnabled === false) {
      wx.showToast({ title: '会员购买暂停中，请稍后再试', icon: 'none' });
      return;
    }
    const packageId = this.data.upgradePackageId;
    if (!packageId) return;
    const pkg = (this.data.packages || []).find(item => item && item.id === packageId);
    if (!pkg) return;
    const isMember = pkg.type === 'MEMBER';
    const currentExpiry = new Date(this.data.membership && this.data.membership.memberExpiresAt || 0).getTime();
    const validCurrent = Number.isFinite(currentExpiry) && currentExpiry > Date.now()
      ? currentExpiry
      : Date.now();
    const memberDays = Math.max(0, Number(pkg.memberDays) || 0);
    const memberFloorDays = Math.max(0, Number(pkg.memberFloorDays) || 0);
    const expiry = new Date(Math.max(
      memberDays ? validCurrent + memberDays * 86400000 : 0,
      memberFloorDays ? Date.now() + memberFloorDays * 86400000 : 0,
      Number.isFinite(currentExpiry) ? currentExpiry : 0
    ));
    const p = new Date(expiry.getTime() + 8 * 60 * 60 * 1000);
    const current = this.data.membership || {};
    const memberSlots = Math.max(0, Number(current.memberTaskSlots) || 0);
    const taskPackSize = Math.max(0, Number(pkg.addedSlots) || Number(current.taskPackSize) || 0);
    this.setData({
      showUpgradeConfirm: true,
      upgradeConfirmTitle: isMember
        ? `${Number(pkg.memberDays) || 0} 天会员`
        : `${taskPackSize} 个提醒名额`,
      upgradeConfirmAmount: pkg.priceText || '',
      upgradeConfirmDesc: isMember
        ? `支付成功后立即生效，提醒名额提升到 ${memberSlots} 个，并继续完成本次提醒。`
        : `支付成功后立即记录 ${taskPackSize} 个名额，并继续完成本次提醒。`,
      upgradeConfirmExpiry: `会员有效期至 ${p.getUTCFullYear()}年${p.getUTCMonth() + 1}月${p.getUTCDate()}日`,
    });
  },

  onCloseUpgradeConfirm() {
    if (this._upgrading) return;
    this.setData({ showUpgradeConfirm: false });
  },

  setPaymentState(status, title, description, orderId) {
    this.setData({
      paymentState: { status, title, description, orderId: orderId || '' },
    });
  },

  onPaymentOrder() {
    const orderId = this.data.paymentState && this.data.paymentState.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/membership-order-detail/membership-order-detail?orderId=${orderId}` });
  },

  onConfirmUpgrade() {
    if (this._upgrading || this.data.submitting) return;
    const packageId = this.data.upgradePackageId;
    if (!packageId) return;
    this._upgrading = true;
    this.setData({ showUpgradeConfirm: false });
    this.setPaymentState('PENDING', '正在确认支付结果', '请勿重复支付，系统会自动查单并更新权益。');
    wx.showLoading({ title: '正在准备支付...' });
    membershipPay.purchase(packageId).then(result => {
      wx.hideLoading();
      this._upgrading = false;
      if (result.status === 'PAID_GRANTED') {
        this.setPaymentState('PAID_GRANTED', '权益已到账', '正在继续完成本次提醒。', result.orderId);
        /* 支付成功后会员额度已在服务端生效，不能沿用支付前的页面缓存。 */
        return this.loadCartAndAccess({ force: true }).then(() => {
          setTimeout(() => {
            if (this.data.showMembershipGate) {
              this.setPaymentState('PAID_GRANTED', '权益已到账', '当前清单仍需增加名额，请再选择一次。', result.orderId);
              return;
            }
            this.onSubmit();
          }, 80);
        });
      }
      if (result.status === 'PAID_GRANT_FAILED') {
        this.setPaymentState('PAID_GRANT_FAILED', '支付已完成，权益发放异常', '请勿重复支付；请到订单详情同步或联系售后处理。', result.orderId);
        return;
      }
      if (result.status === 'PAID_GRANT_UNKNOWN') {
        this.setPaymentState('PENDING', '支付已确认，权益待核验', '请勿重复支付；系统正在核验权益发放状态，本页会自动刷新。', result.orderId);
        return this.restorePendingPayment();
      }
      if (result.status === 'PENDING') {
        this.setPaymentState('PENDING', '正在确认支付结果', '本次清单和提醒设置已保留，请勿重复支付。', result.orderId);
        return this.restorePendingPayment();
      }
      this.setPaymentState('CLOSED', '订单已关闭', '本次未扣款，可以重新发起支付。', result.orderId);
    }).catch(err => {
      wx.hideLoading();
      this._upgrading = false;
      const saved = membershipPay.pendingOrder();
      const orderId = (err && err.orderId) || (saved && saved.orderId) || '';
      if (err && err.cancelled) {
        this.setPaymentState('CANCELLED', '支付未完成', '本次清单和提醒设置已保留，未扣款时不会发放权益。', orderId);
        return;
      }
      this.setPaymentState('FAILED', '支付未完成', '尚未发放权益；如微信已扣款，请到订单详情同步支付结果。', orderId);
    });
  },

  onSubmit() {
    const { channels, offsets } = this.data;
    if (this.data.showMembershipGate) {
      wx.showToast({ title: '请先开通会员或加购提醒名额', icon: 'none' });
      return;
    }
    if (!channels.officialAccount) {
      wx.showToast({ title: '请选择微信通知提醒', icon: 'none' });
      return;
    }
    if (!this.data.systemOk) {
      wx.showToast({ title: '请先开启微信通知权限', icon: 'none' });
      this.onOpenSystem();
      return;
    }
    if (this.data.shortfall > 0) {
      wx.showToast({ title: '请先补齐 ' + this.data.shortfall + ' 次授权', icon: 'none' });
      return;
    }
    if (this.data.quotaNeeded <= 0) {
      this.submitTask({ channelList: ['OFFICIAL_ACCOUNT'], offsets });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交...' });
    this.submitTask({ channelList: ['OFFICIAL_ACCOUNT'], offsets });
  },

  submitTask({ channelList, offsets, disableReminders }) {
    wx.showLoading({ title: '正在提交...' });
    /* 提交 = 唯一创建行程的时机；返回的 tripId 供首页定位新行程 */
    const payload = disableReminders
      ? { disableReminders: true }
      : { channels: channelList, offsets };
    api.reminder.cart.commit(payload).then(res => {
      wx.hideLoading();
      this.setData({ submitting: false });
      /* ⚠️ `needsOaAuth` 是**景点官方公众号**渠道的字段，与本页的自有公众号入口无关：
         前者尚未打通、继续由接口保留，本页不展示关注引导；后者是自己账号的攻略入口，
         只借成功态留一行，不做关注拦截。 */
      let title;
      if (disableReminders) {
        title = '已加入行程，未设置提醒';
      } else if ((res.createdTasks || 0) > 0 && (res.expiredReminder || 0) > 0) {
        title = `已加入行程 · 已设置 ${res.createdTasks} 个提醒，${res.expiredReminder} 项已过期`;
      } else if ((res.expiredReminder || 0) > 0) {
        /* 勾了提醒、但放票时刻在提交前已经过去 —— 服务端这类项照常落行程项、
           不再建任务（见 lib/task.js）。文案由前端生成，服务端那句同义的 toast
           在 PAGE-008 这条路径上没有出口。
           ⚠️ 必须排在 createdTasks > 0 之前判断：过期项同时计入 noReminder，
              排在后面会掉进「提醒已设置」分支，等于告诉用户提醒设上了，而实际没设。 */
        title = `已加入行程 · ${res.expiredReminder} 项已过放票时间，提醒无法设置`;
      } else if (res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip()) {
        title = '提醒已设置，先备好游客信息';
      } else {
        title = res.createdTasks > 0
          ? '提醒已设置，放票前见'
          : '行程已添加，未设置提醒';
      }
      /* 成功反馈改成卡片（原来是 toast）：卡片里那一行公众号入口需要能被点到，
         toast 上放不了可点元素。默认停 4 秒，角上有主动关闭，底部给弱化的倒计时提示。
         ⚠️ 自动返回与倒计时要在用户点开二维码时一起取消（见 onSuccessOa），
            否则读二维码读到一半会被弹走。 */
      this.setData({ showSuccess: true, successTitle: title, successCountdown: AUTO_BACK_SECONDS });
      this._backTimer = setTimeout(() => this.goHome(), AUTO_BACK_SECONDS * 1000);
      this._countdownTimer = setInterval(() => {
        const left = this.data.successCountdown - 1;
        /* 归零这一拍就交给 _backTimer，别再 setData 出「0 秒后返回」 */
        if (left <= 0) {
          this.clearAutoBack();
          return;
        }
        this.setData({ successCountdown: left });
      }, 1000);
      /* 提交是唯一创建行程的时机，tripId 这一刻才有 —— 写给首页定位用。
         纯预览化后「生成时间线」不再建行程，所以不能更早写。
         ⚠️ 这里**必须无条件写**（只要拿到 tripId）。原先假设「从添加提醒进来的
            路径上 add-trip 会自己写」，但下方 navigateBack 会把 add-trip 从页面栈
            里弹掉，它拿不到这次返回值，那个假设不成立——两边都不写就没人写了。
            （当前 `currentTripId` 全项目无人读取，所以此前没暴露成用户可见问题。） */
      if (res.tripId) app.globalData.currentTripId = res.tripId;
      app.globalData.reminderSubmitted = true;
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (err && err.errorCode === 1008) {
        const s = err.subscription || {};
        return this.refreshAccessState(this.data.quotaNeeded).then(() => {
          const left = Math.max(0, Number(s.shortfall) || this.data.shortfall || 0);
          this.setData({
            authFeedback: `提交前授权额度发生变化，当前还差 ${left} 次授权，请补齐后重试。`,
            authFeedbackTone: 'warn',
          });
          wx.showToast({ title: '授权额度已变化，请补齐后重试', icon: 'none' });
        });
      }
      const limit = membershipEntry.viewOf(err);
      if (limit) {
        return this.loadCartAndAccess().then(() => {
          wx.showToast({ title: '提醒名额已变化，请确认后继续', icon: 'none' });
        });
      }
      api.toastError(err);
    });
  },

  /** 回首页：兼容 首页→设置（内联生成）与 首页→添加提醒→设置 两种栈深 */
  goHome() {
    this.clearAutoBack();
    const pages = getCurrentPages();
    const homeIdx = pages.findIndex(p => p.route === 'pages/home/home');
    const delta = homeIdx >= 0 ? pages.length - 1 - homeIdx : 1;
    wx.navigateBack({ delta });
  },

  /** 取消自动返回与倒计时：主动关闭、打开二维码、离开页面时都要清 */
  clearAutoBack() {
    if (this._backTimer) {
      clearTimeout(this._backTimer);
      this._backTimer = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  /** 点卡片外任意处 = 立刻回首页，不等自动跳转 */
  onSuccessSkip() {
    this.goHome();
  },

  /** 成功态里的公众号入口：留入口但不拦路 —— 只在这里打开二维码 */
  onSuccessOa() {
    this.clearAutoBack();
    this.setData({ showOaSheet: true });
  },

  onCloseOaSheet() {
    this.setData({ showOaSheet: false });
    /* 看完二维码直接回首页，不用再点一次 */
    this.goHome();
  },

  onBack() {
    this.clearAutoBack();
    wx.navigateBack();
  },

  /* 成功卡片的空处理：拦掉冒泡与背景滚动 */
  noop() {},

  onUnload() {
    this._pageVisible = false;
    this.stopPaymentAutoRefresh();
    this.clearAutoBack();
  },
});
