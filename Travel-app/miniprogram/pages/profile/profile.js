const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');
const oa = require('../../utils/official-account.js');
const membershipCache = require('../../utils/membership-cache.js');
const feedbackEntryCache = require('../../utils/feedback-entry-cache.js');

const PROFILE_BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const ADMIN_STATUS_CACHE_KEY = 'profileAdminStatusV2';
const ADMIN_STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MEMBERSHIP_NOTICE_DISMISSED_KEY = 'membershipUpgradeNoticeDismissedV1';

function reminderHintOf(health) {
  if (health.permissionState === 'none') return { text: '未开启', state: 'none' };
  if (health.permissionState === 'partial') return { text: '部分开启', state: 'partial' };
  if (health.quotaLevel === 'unknown') return { text: '状态待刷新', state: 'partial' };
  if (health.quotaLevel === 'exhausted') return { text: '授权已用完', state: 'exhausted' };
  if (health.quotaLevel === 'short') {
    return { text: '还差' + health.shortfall + '次授权', state: 'short' };
  }
  if (health.quotaLevel === 'low') return { text: '授权即将用完', state: 'low' };
  return { text: '已开启', state: 'all' };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    isMember: false,
    memberTagText: '普通用户',
    memberCardTitle: '会员',
    memberCardDesc: '免费版 5 个提醒名额；会员 30 天内不限提醒名额',
    memberCardAction: '开通',
    notifyHint: '未开启',
    notifyState: 'none',
    /* 公众号入口文案取自 utils/official-account.js，页面不写死名称 */
    oaRowLabel: oa.ROW_LABEL,
    oaRowHint: oa.ROW_HINT,
    showOaSheet: false,
    showAfterSalesEntry: false,
    afterSalesPendingCount: 0,
    afterSalesPendingText: '',
    afterSalesFundingBlockedCount: 0,
    afterSalesAdminHint: '退款审核与权益补偿',
    afterSalesFundingBlocked: false,
    showFeedbackAdminEntry: false,
    feedbackAdminPendingCount: 0,
    feedbackAdminPendingText: '',
    feedbackUnreadCount: 0,
    feedbackUnreadText: '',
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
  },

  onShow() {
    this.loadUser({ force: !!this.data.membershipUpgradeNotice });
    if (this.profileCacheFresh()) this.loadNotifyHint();
    this.loadAdminEntries();
    this.loadFeedbackEntry();
  },

  /* 无感登录：profile 首次调用即自动建号（自动昵称+默认头像），页面常驻登录态 */
  profileCacheFresh() {
    return !!this._profileCache
      && this._profileLoadedAt > 0
      && Date.now() - this._profileLoadedAt < PROFILE_BOOTSTRAP_TTL_MS;
  },

  loadUser(options) {
    const cacheVersion = membershipCache.version();
    const membershipChanged = !!this._profileCache
      && this._membershipDataVersion !== cacheVersion;
    const force = !!(options && options.force) || membershipChanged;
    if (!force && this.profileCacheFresh()) return Promise.resolve(this._profileCache);
    const bootstrap = typeof api.reminder.user.bootstrap === 'function'
      ? api.reminder.user.bootstrap()
      : Promise.reject(new Error('user.bootstrap unavailable'));
    return bootstrap.then(res => {
      this._profileCache = res;
      this._profileLoadedAt = Date.now();
      this._membershipDataVersion = cacheVersion;
      this.applyUser(res.user || {});
      this.applyMembershipUpgradeNotice(
        res.membershipUpgradeNotice,
        res.membership || (res.user && res.user.membership)
      );
      this.applySubscriptionHint(res.subscription);
      return res;
    }).catch(() => {
      /* 旧云函数尚未部署 user.bootstrap 时仍可正常进入个人页。 */
      return api.reminder.user.profile().then(res => {
        this._profileCache = res;
        this._profileLoadedAt = Date.now();
        this._membershipDataVersion = cacheVersion;
        this.applyUser(res.user || {});
        this.applyMembershipUpgradeNotice(
          res.membershipUpgradeNotice,
          res.user && res.user.membership
        );
        return res;
      }).then(res => {
        this.loadNotifyHint();
        return res;
      }).catch(() => {
        this.applyUser({ nickname: '', avatarUrl: '', memberLevel: 'NORMAL', points: 0 });
        this.loadNotifyHint();
        return null;
      });
    });
  },

  applySubscriptionHint(subscription) {
    if (!subscription) return;
    const systemOk = notify.getSystemNotifyOk();
    const hint = reminderHintOf({
      permissionState: systemOk ? 'all' : 'none',
      quotaLevel: subscription.level || (Number(subscription.quota) > 0 ? 'ready' : 'exhausted'),
      shortfall: subscription.shortfall || 0,
    });
    this.setData({ notifyHint: hint.text, notifyState: hint.state });
  },

  applyUser(user) {
    const current = user.membership || {};
    const expiryMatch = String(current.memberExpiresAtText || '')
      .match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    const expiryDate = expiryMatch
      ? `${expiryMatch[1]}-${String(expiryMatch[2]).padStart(2, '0')}-${String(expiryMatch[3]).padStart(2, '0')}`
      : '';
    const freeSlots = Math.max(0, Number(current.freeTaskSlots) || 0);
    const sales = user.membershipSales || {};
    const purchaseEnabled = sales.purchaseEnabled !== false;
    this.setData({
      user,
      isMember: current.member === true,
      memberTagText: current.member ? '尊贵会员' : '普通用户',
      memberCardTitle: current.member ? '尊贵会员' : '非会员',
      memberCardDesc: current.member
        ? `${expiryDate || current.memberExpiresAtText || '—'} 到期｜已开启 ${Number(current.taskUsed) || 0} 个提醒｜不限名额`
        : (purchaseEnabled
          ? `免费版可用 ${freeSlots} 个提醒名额；开通后不限提醒名额`
          : `免费版可用 ${freeSlots} 个提醒名额；会员购买暂停中`),
      memberCardAction: purchaseEnabled && current.member !== true ? '开通' : '查看',
    });
  },

  applyMembershipUpgradeNotice(notice, membership) {
    const current = membership || {};
    if (!notice || current.planVersion !== 'unlimited-v3' || current.member !== true) {
      this.setData({ membershipUpgradeNotice: null });
      return;
    }
    let dismissed = '';
    try {
      dismissed = String(wx.getStorageSync(MEMBERSHIP_NOTICE_DISMISSED_KEY) || '');
    } catch (err) {}
    if (dismissed && dismissed === String(notice.id || '')) {
      this.setData({ membershipUpgradeNotice: null });
      return;
    }
    this.setData({
      membershipUpgradeNotice: {
        id: String(notice.id || ''),
        title: '您的会员权益已升级',
        body: '您的会员有效期不变，提醒名额已升级为不限',
      },
    });
  },

  onDismissMembershipUpgradeNotice() {
    const notice = this.data.membershipUpgradeNotice;
    if (notice && notice.id) {
      try {
        wx.setStorageSync(MEMBERSHIP_NOTICE_DISMISSED_KEY, notice.id);
      } catch (err) {}
    }
    this.setData({ membershipUpgradeNotice: null });
  },

  /* 提醒设置状态：权限三态 + 授权额度健康度（onShow 刷新，从内页返回即时更新） */
  loadNotifyHint() {
    const cached = this._profileCache && this._profileCache.subscription;
    if (cached && this.profileCacheFresh()) {
      this.applySubscriptionHint(cached);
      return Promise.resolve();
    }
    notify.getReminderHealth().then(health => {
      const hint = reminderHintOf(health);
      this.setData({ notifyHint: hint.text, notifyState: hint.state });
    }).catch(() => {});
  },

  /* 点头像/昵称 -> 编辑资料页（头像/昵称/手机号） */
  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  onNotifySettings() {
    wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  },

  onMembership() {
    wx.navigateTo({ url: '/pages/membership/membership' });
  },

  loadAdminEntries() {
    try {
      const cached = wx.getStorageSync(ADMIN_STATUS_CACHE_KEY);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < ADMIN_STATUS_TTL_MS) {
        this.applyAfterSalesAdminStatus(cached.payment);
        return Promise.resolve(cached.payment || null);
      }
    } catch (e) {}
    return api.payment.afterSales.adminStatus().catch(() => null).then(paymentStatus => {
      this.applyAfterSalesAdminStatus(paymentStatus);
      try {
        wx.setStorageSync(ADMIN_STATUS_CACHE_KEY, {
          savedAt: Date.now(),
          payment: paymentStatus,
        });
      } catch (e) {}
      return paymentStatus;
    });
  },

  /**
   * 反馈入口统计只用 5 分钟存储缓存。
   * 统计允许稍晚到，避免每次 onShow 都读用户和 feedbacks 两张表。
   */
  loadFeedbackEntry() {
    const cached = feedbackEntryCache.read();
    if (cached) this.applyFeedbackEntry(cached.data);
    if (cached && cached.fresh) return Promise.resolve(cached.data);

    return api.feedback.entrySummary().then(res => {
      this.applyFeedbackEntry(res);
      feedbackEntryCache.write(res);
      return res;
    }).catch(() => cached ? cached.data : null);
  },

  applyFeedbackEntry(res) {
    const isAdmin = !!(res && res.isAdmin);
    const unreadCount = Math.max(0, Number(res && res.handledUnreadCount) || 0);
    const pendingCount = isAdmin
      ? Math.max(0, Number(res && res.adminPendingCount) || 0)
      : 0;
    this.setData({
      showFeedbackAdminEntry: isAdmin,
      feedbackAdminPendingCount: pendingCount,
      feedbackAdminPendingText: pendingCount > 99 ? '99+' : String(pendingCount || ''),
      feedbackUnreadCount: unreadCount,
      feedbackUnreadText: unreadCount > 99 ? '99+' : String(unreadCount || ''),
    });
  },

  applyAfterSalesAdminStatus(res) {
    const isAdmin = !!(res && res.isAdmin);
    const count = isAdmin ? Math.max(0, Number(res.pendingCount) || 0) : 0;
    const fundingBlockedCount = isAdmin
      ? Math.max(0, Number(res.fundingBlockedCount) || 0)
      : 0;
    const fundingBlocked = fundingBlockedCount > 0;
    this.setData({
      showAfterSalesEntry: isAdmin,
      afterSalesPendingCount: count,
      afterSalesPendingText: count > 99 ? '99+' : String(count || ''),
      afterSalesFundingBlockedCount: fundingBlockedCount,
      afterSalesFundingBlocked: fundingBlocked,
      afterSalesAdminHint: fundingBlocked
        ? `退款资金不足 · ${fundingBlockedCount > 99 ? '99+' : fundingBlockedCount} 笔`
        : '退款审核与权益补偿',
    });
  },

  onAfterSalesAdmin() {
    wx.navigateTo({ url: '/pages/admin-after-sales/admin-after-sales' });
  },

  onGuide() {
    wx.navigateTo({ url: '/pages/guide/guide' });
  },

  /* 关注公众号：只在用户主动点击时打开二维码弹层，不在 onShow 自动弹 */
  onFollowOa() {
    this.setData({ showOaSheet: true });
  },

  onCloseOaSheet() {
    this.setData({ showOaSheet: false });
  },

  onHelpFeedback() {
    wx.navigateTo({ url: '/pages/help-feedback/help-feedback' });
  },

  onFeedbackAdmin() {
    if (!this.data.showFeedbackAdminEntry) return;
    wx.navigateTo({ url: '/pages/admin-feedback/admin-feedback' });
  },

  onLegal(e) {
    const type = e.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy';
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
  },

});
