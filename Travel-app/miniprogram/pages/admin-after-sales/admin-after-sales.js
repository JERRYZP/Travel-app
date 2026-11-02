const app = getApp();
const api = require('../../utils/api.js');

const MIGRATION_CURSOR_KEY = 'admin_protection_migration_cursor_v1';
const MIGRATION_BATCH_DELAY_MS = 300;
const QUALITY_CACHE_KEY = 'admin_reminder_quality_snapshot_v1';
const QUALITY_RETRY_MS = 2 * 60 * 1000;
// 上线前迁移已经完成；保留服务端能力和本地实现，仅关闭正式工作台入口。
const MIGRATION_ENTRY_ENABLED = false;
const TAB_ORDERS = 'orders';
const TAB_AFTER_SALES = 'afterSales';
const ENFORCEMENT_OPTIONS = [
  { mode: 'off', label: '关闭' },
  { mode: 'test', label: '测试' },
  { mode: 'all', label: '全量' },
];
const ORDER_TIME_RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' },
  { key: 'all', label: '全部' },
];
const QUALITY_STATUS = {
  HEALTHY: { label: '正常', tone: 'healthy' },
  ALERT: { label: '异常', tone: 'alert' },
  EMPTY: { label: '无数据', tone: 'empty' },
};

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function enforcementPickerOf(current) {
  const activeMode = current && current.mode;
  const index = ENFORCEMENT_OPTIONS.findIndex(item => item.mode === activeMode);
  return {
    labels: ENFORCEMENT_OPTIONS.map(item => item.label),
    index: index >= 0 ? index : 0,
  };
}

function enforcementViewOf(res) {
  const current = res && res.membershipEnforcement;
  if (current) {
    const sourceLabel = current.source === 'DB'
      ? '后台配置'
      : (current.readError || current.source === 'INVALID' ? '配置异常' : '环境变量兜底');
    return {
      ...current,
      sourceLabel,
      unavailable: current.unavailable === true,
    };
  }
  if (!res || res.isAdmin !== true) return null;
  return {
    mode: '',
    modeLabel: '待部署',
    shortDescription: '服务端尚未更新，暂不可切换',
    source: 'UNAVAILABLE',
    sourceLabel: '待部署',
    readError: false,
    unavailable: true,
  };
}

function qualityRateText(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const text = number.toFixed(2).replace(/\.?0+$/, '');
  return `${text}%`;
}

function qualityPlaceholder(kind) {
  const failed = kind === 'failed';
  const pending = kind === 'pending';
  return {
    statusLabel: failed ? '不可用' : (pending ? '待部署' : '统计中'),
    statusTone: failed ? 'failed' : (pending ? 'pending' : 'loading'),
    rateText: '—',
    sampleText: failed ? '质量数据读取失败' : (pending ? '服务端尚未更新' : '等待更新'),
    baselineText: '—',
    issueText: failed ? '质量数据读取失败' : (pending ? '部署后自动显示' : ''),
    showRetry: failed,
  };
}

function reminderQualityViewOf(payload) {
  const current = (payload && payload.currentWindow) || {};
  const status = current.status || 'EMPTY';
  const statusView = QUALITY_STATUS[status] || QUALITY_STATUS.EMPTY;
  const baseline = payload && payload.baseline5d ? payload.baseline5d : {};
  let issueText = '';
  if (status === 'EMPTY') {
    issueText = '当前时段无提醒';
  }
  return {
    statusLabel: statusView.label,
    statusTone: statusView.tone,
    rateText: qualityRateText(current.onTimeRate),
    sampleText: current.updatedLabel ? `截至 ${current.updatedLabel}` : '等待更新',
    baselineText: qualityRateText(baseline.onTimeRate),
    issueText,
    showRetry: false,
  };
}

function readQualityCache() {
  try {
    const cached = wx.getStorageSync(QUALITY_CACHE_KEY);
    if (!cached || !cached.quality || !cached.quality.currentWindow) return null;
    if (!Number.isFinite(Date.parse(cached.quality.currentWindow.nextUpdateAt))) return null;
    return cached;
  } catch (err) {
    return null;
  }
}

function writeQualityCache(quality) {
  if (!quality || !quality.currentWindow) return;
  try {
    wx.setStorageSync(QUALITY_CACHE_KEY, {
      quality,
      savedAt: Date.now(),
    });
  } catch (err) {}
}

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'SUBMITTED', label: '待审核' },
  { key: 'AUTO_CHECKING', label: '自动核验' },
  { key: 'UNDER_REVIEW', label: '审核中' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'REFUND_FAILED', label: '异常' },
  { key: 'CANCELLED', label: '已取消' },
  { key: 'REFUNDED', label: '已完成' },
  { key: 'REJECTED', label: '已驳回' },
];

const ORDER_FILTERS = [
  { key: '', label: '全部' },
  { key: 'PENDING', label: '待支付' },
  { key: 'PAID', label: '已支付' },
  { key: 'CLOSED', label: '已关闭' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    activeTab: TAB_ORDERS,
    filterStickyTop: 64,
    orderTimeRangeLabels: ORDER_TIME_RANGES.map(item => item.label),
    orderTimeRangeIndex: 1,
    activeOrderTimeRange: '30d',
    orderTimeRangeLabel: '近 30 天',
    orderStats: null,
    orderStatsLoading: false,
    orderStatsFailed: false,
    orderStatsPendingBackend: false,
    reminderQuality: qualityPlaceholder('loading'),
    filters: ORDER_FILTERS,
    activeFilter: '',
    keywordInput: '',
    activeKeyword: '',
    searchPlaceholder: '订单号 / OpenID / 昵称',
    emptyTitle: '还没有会员订单',
    emptyDesc: '可按订单号、完整 OpenID 或昵称搜索。',
    loading: true,
    loadFailed: false,
    loadingMore: false,
    page: 1,
    hasMore: false,
    forbidden: false,
    items: [],
    detail: null,
    orderDetail: null,
    decisionNote: '',
    acting: false,
    actionMessage: '',
    migrationCursor: null,
    migrationHasMore: false,
    migrationEntryEnabled: MIGRATION_ENTRY_ENABLED,
    migrationCompleted: false,
    pendingCount: 0,
    fundingBlockedCount: 0,
    migrationMessage: '',
    migrating: false,
    migrationAutoRunning: false,
    migrationTotalScanned: 0,
    migrationTotalUpdated: 0,
    membershipSales: null,
    salesReason: '',
    salesSaving: false,
    showSalesConfirm: false,
    membershipEnforcement: null,
    enforcementPickerLabels: ENFORCEMENT_OPTIONS.map(item => item.label),
    enforcementPickerIndex: 0,
    enforcementSaving: false,
    entitlementMigrationCompleted: false,
  },

  onLoad() {
    const g = app.globalData;
    let migrationCursor = null;
    try { migrationCursor = wx.getStorageSync(MIGRATION_CURSOR_KEY) || null; } catch (e) {}
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      filterStickyTop: Math.floor(
        (Number(g.statusBarHeight) || 20) + (Number(g.navBarHeight) || 44)
      ),
      migrationCursor,
      migrationHasMore: !!migrationCursor,
      migrationMessage: migrationCursor ? '检测到上次未完成的迁移，可继续自动迁移。' : '',
    });
    if (MIGRATION_ENTRY_ENABLED) this.loadMigrationStatus();
  },

  onShow() {
    this.loadStatus();
    this.loadList();
  },

  onHide() {
    this.clearReminderQualityTimer();
  },

  onUnload() {
    this._migrationStopRequested = true;
    this.clearReminderQualityTimer();
  },

  loadMigrationStatus() {
    return api.payment.afterSales.adminStatus().then(res => {
      this.applyStatus(res);
      if (res && res.isAdmin) this.loadReminderQuality();
      if (res && res.isAdmin && this.data.activeTab === TAB_ORDERS) {
        this.loadOrderStats();
      }
      return res;
    }).catch(() => {
      this.setData({ reminderQuality: qualityPlaceholder('failed') });
    });
  },

  loadStatus() {
    return this.loadMigrationStatus();
  },

  loadOrderStats() {
    if (this.data.activeTab !== TAB_ORDERS) return Promise.resolve(false);
    if (this.data.orderStatsLoading) return Promise.resolve(false);
    this.setData({
      orderStatsLoading: true,
      orderStatsFailed: false,
      orderStatsPendingBackend: false,
    });
    return api.payment.adminOrders.stats().then(res => {
      this.setData({
        orderStats: (res && res.stats) || null,
        orderStatsLoading: false,
        orderStatsFailed: false,
        orderStatsPendingBackend: false,
      });
      return true;
    }).catch(err => {
      const pendingBackend = !!(err && err.errorCode === 1099);
      this.setData({
        orderStats: null,
        orderStatsLoading: false,
        orderStatsFailed: !pendingBackend,
        orderStatsPendingBackend: pendingBackend,
      });
      return false;
    });
  },

  loadReminderQuality(options = {}) {
    if (this._qualityLoading) return Promise.resolve(false);
    const force = options.force === true;
    let cached = this._qualitySnapshot;
    if (!cached) {
      const stored = readQualityCache();
      cached = stored ? stored.quality : null;
    }
    if (cached) {
      this._qualitySnapshot = cached;
      this.setData({ reminderQuality: reminderQualityViewOf(cached) });
      const nextUpdateAt = Date.parse(cached.currentWindow
        && cached.currentWindow.nextUpdateAt);
      if (!force && Number.isFinite(nextUpdateAt) && Date.now() < nextUpdateAt) {
        this.scheduleReminderQualityRefresh(cached);
        return Promise.resolve(true);
      }
    }
    this._qualityLoading = true;
    if (!this._qualitySnapshot) {
      this.setData({ reminderQuality: qualityPlaceholder('loading') });
    }
    return api.payment.adminReminderQuality.stats().then(res => {
      const quality = res && res.quality;
      if (!quality) {
        this.scheduleReminderQualityRetry();
        return false;
      }
      this._qualitySnapshot = quality;
      writeQualityCache(quality);
      this.setData({ reminderQuality: reminderQualityViewOf(quality) });
      if (res && res.pending) this.scheduleReminderQualityRetry();
      else this.scheduleReminderQualityRefresh(quality);
      return true;
    }).catch(err => {
      this.clearReminderQualityTimer();
      if (this._qualitySnapshot) {
        this.setData({ reminderQuality: reminderQualityViewOf(this._qualitySnapshot) });
        this.scheduleReminderQualityRetry();
      } else {
        const pendingBackend = !!(err && err.errorCode === 1099);
        this.setData({
          reminderQuality: qualityPlaceholder(pendingBackend ? 'pending' : 'failed'),
        });
      }
      return false;
    }).then(result => {
      this._qualityLoading = false;
      return result;
    });
  },

  scheduleReminderQualityRefresh(quality) {
    this.clearReminderQualityTimer();
    const nextUpdateAt = Date.parse(quality && quality.currentWindow
      && quality.currentWindow.nextUpdateAt);
    if (!Number.isFinite(nextUpdateAt)) return;
    const delay = Math.max(1000, nextUpdateAt - Date.now() + 500);
    this._qualityRefreshTimer = setTimeout(() => {
      this._qualityRefreshTimer = null;
      if (!this.data.forbidden) this.loadReminderQuality({ force: true });
    }, delay);
    if (this._qualityRefreshTimer && this._qualityRefreshTimer.unref) {
      this._qualityRefreshTimer.unref();
    }
  },

  scheduleReminderQualityRetry() {
    this.clearReminderQualityTimer();
    this._qualityRefreshTimer = setTimeout(() => {
      this._qualityRefreshTimer = null;
      if (!this.data.forbidden) this.loadReminderQuality({ force: true });
    }, QUALITY_RETRY_MS);
    if (this._qualityRefreshTimer && this._qualityRefreshTimer.unref) {
      this._qualityRefreshTimer.unref();
    }
  },

  clearReminderQualityTimer() {
    if (!this._qualityRefreshTimer) return;
    clearTimeout(this._qualityRefreshTimer);
    this._qualityRefreshTimer = null;
  },

  onRetryReminderQuality() {
    return this.loadReminderQuality({ force: true });
  },

  applyStatus(res) {
    const membershipEnforcement = enforcementViewOf(res);
    const migrationCompleted = !!(res && res.migrationCompleted);
    const entitlementMigrationCompleted = !!(res && res.entitlementMigrationCompleted);
    const enforcementPicker = enforcementPickerOf(membershipEnforcement);
    this.setData({
      migrationCompleted,
      entitlementMigrationCompleted,
      pendingCount: Math.max(0, Number(res && res.pendingCount) || 0),
      fundingBlockedCount: Math.max(0, Number(res && res.fundingBlockedCount) || 0),
      membershipSales: (res && res.membershipSales) || null,
      membershipEnforcement,
      enforcementPickerLabels: enforcementPicker.labels,
      enforcementPickerIndex: enforcementPicker.index,
    });
  },

  onSalesReasonInput(e) {
    this.setData({ salesReason: e.detail.value });
  },

  onToggleMembershipSales() {
    if (this.data.salesSaving || !this.data.membershipSales) return;
    if (this.data.membershipSales.purchaseEnabled === false) {
      wx.showModal({
        title: '恢复会员购买',
        content: '恢复后用户可重新创建订单并发起支付。已有订单、权益、退款和售后不受影响。',
        success: res => {
          if (res.confirm) this.setMembershipSalesState('OPEN', '恢复会员购买');
        },
      });
      return;
    }
    this.setData({
      showSalesConfirm: true,
      salesReason: '',
    });
  },

  onCloseSalesConfirm() {
    if (this.data.salesSaving) return;
    this.setData({ showSalesConfirm: false });
  },

  onConfirmMembershipSalesPause() {
    if (this.data.salesSaving) return;
    const reason = String(this.data.salesReason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写暂停原因', icon: 'none' });
      return;
    }
    this.setMembershipSalesState('PAUSED', reason);
  },

  setMembershipSalesState(state, reason) {
    if (this.data.salesSaving) return Promise.resolve(false);
    this.setData({ salesSaving: true });
    return api.payment.afterSales.adminSetMembershipSales({ state, reason })
      .then(result => {
        this.setData({
          salesSaving: false,
          salesReason: '',
          showSalesConfirm: false,
          membershipSales: (result && result.membershipSales) || this.data.membershipSales,
        });
        wx.showToast({
          title: state === 'PAUSED' ? '会员购买已暂停' : '会员购买已恢复',
          icon: 'none',
        });
        return true;
      })
      .catch(err => {
        this.setData({ salesSaving: false });
        api.toastError(err);
        return false;
      });
  },

  onEnforcementModeChange(e) {
    if (this.data.enforcementSaving || !this.data.membershipEnforcement) return;
    if (this.data.membershipEnforcement.unavailable) {
      wx.showToast({ title: '服务端尚未更新，暂不可切换', icon: 'none' });
      return;
    }
    const selectedIndex = Number(e && e.detail && e.detail.value);
    const currentPicker = enforcementPickerOf(this.data.membershipEnforcement);
    this.setData({ enforcementPickerIndex: currentPicker.index });
    const option = ENFORCEMENT_OPTIONS[selectedIndex];
    if (!option || this.data.membershipEnforcement.mode === option.mode) return;
    const mode = option.mode;
    if (mode === 'all'
      && (!this.data.migrationCompleted || !this.data.entitlementMigrationCompleted)) {
      wx.showToast({ title: '上线前迁移未完成，暂不能切全量', icon: 'none' });
      return;
    }
    const currentLabel = this.data.membershipEnforcement.modeLabel || '环境变量';
    const impact = mode === 'all'
      ? '所有用户之后新建的提醒都会占用 5 / 15 个名额。'
      : (mode === 'test'
        ? '只有测试 OpenID 之后新建的提醒占用名额。'
        : '所有用户之后新建的提醒都进入历史保护池。');
    wx.showModal({
      title: `切换为${option.label}`,
      content: `从“${currentLabel}”切换。${impact}已有提醒保持原池别，不会重新计数。`,
      confirmText: '确认切换',
      confirmColor: '#8A5A12',
      success: res => {
        if (res.confirm) this.setMembershipEnforcement(mode);
      },
    });
  },

  setMembershipEnforcement(mode) {
    if (this.data.enforcementSaving) return Promise.resolve(false);
    this.setData({ enforcementSaving: true });
    return api.payment.afterSales.adminSetMembershipEnforcement({ mode })
      .then(result => {
        const membershipEnforcement = result && result.membershipEnforcement;
        const nextMembershipEnforcement = membershipEnforcement || this.data.membershipEnforcement;
        const enforcementPicker = enforcementPickerOf(nextMembershipEnforcement);
        this.setData({
          enforcementSaving: false,
          membershipEnforcement: nextMembershipEnforcement,
          enforcementPickerLabels: enforcementPicker.labels,
          enforcementPickerIndex: enforcementPicker.index,
        });
        wx.showToast({
          title: `会员限制已切为${membershipEnforcement ? membershipEnforcement.modeLabel : '新模式'}`,
          icon: 'none',
        });
        return true;
      })
      .catch(err => {
        this.setData({ enforcementSaving: false });
        api.toastError(err);
        return false;
      });
  },

  onShowFundingBlocked() {
    if (this.data.activeTab === TAB_AFTER_SALES && this.data.activeFilter === 'REFUND_FAILED') {
      return this.loadList();
    }
    this.setData({
      activeTab: TAB_AFTER_SALES,
      filters: FILTERS,
      activeFilter: 'REFUND_FAILED',
      keywordInput: '',
      activeKeyword: '',
      searchPlaceholder: '售后单号 / 订单号 / OpenID / 昵称',
      emptyTitle: '当前筛选没有售后单',
      emptyDesc: '客服目标是在 24 小时内完成审核。',
      items: [],
      detail: null,
      orderDetail: null,
      actionMessage: '',
    });
    return this.loadList();
  },

  loadList(options = {}) {
    const append = options.append === true;
    const page = append ? Number(this.data.page || 1) + 1 : 1;
    const requestSeq = Number(this._listRequestSeq || 0) + 1;
    this._listRequestSeq = requestSeq;
    this.setData(append
      ? { loadingMore: true }
      : { loading: true, loadFailed: false, loadingMore: false, forbidden: false });
    const params = {
      status: this.data.activeFilter,
      keyword: this.data.activeKeyword,
      page,
      pageSize: 20,
    };
    if (this.data.activeTab === TAB_ORDERS) {
      params.timeRange = this.data.activeOrderTimeRange;
    }
    const request = this.data.activeTab === TAB_ORDERS
      ? api.payment.adminOrders.list(params)
      : api.payment.afterSales.adminList(params);
    return request.then(res => {
      if (requestSeq !== this._listRequestSeq) return;
      const nextItems = (res.items || []).map(item => ({
        ...item,
        _statusTone: this.data.activeTab === TAB_ORDERS
          ? String(item.status || '').toLowerCase()
          : String(item.status || ''),
      }));
      this.setData({
        loading: false,
        loadFailed: false,
        loadingMore: false,
        page,
        hasMore: !!res.hasMore,
        items: append ? this.data.items.concat(nextItems) : nextItems,
      });
    }).catch(err => {
      if (requestSeq !== this._listRequestSeq) return;
      this.setData({
        loading: false,
        loadingMore: false,
        loadFailed: !append && !(err && err.errorCode === 1040),
        forbidden: !!(err && err.errorCode === 1040),
      });
      if (!err || err.errorCode !== 1040) api.toastError(err);
    });
  },

  onLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.loadList({ append: true });
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab === TAB_AFTER_SALES ? TAB_AFTER_SALES : TAB_ORDERS;
    if (tab === this.data.activeTab) return;
    this._listRequestSeq = Number(this._listRequestSeq || 0) + 1;
    const orders = tab === TAB_ORDERS;
    this.setData({
      activeTab: tab,
      filters: orders ? ORDER_FILTERS : FILTERS,
      activeFilter: '',
      keywordInput: '',
      activeKeyword: '',
      searchPlaceholder: orders
        ? '订单号 / OpenID / 昵称'
        : '售后单号 / 订单号 / OpenID / 昵称',
      emptyTitle: orders ? '还没有会员订单' : '当前筛选没有售后单',
      emptyDesc: orders
        ? '可按订单号、完整 OpenID 或昵称搜索。'
        : '客服目标是在 24 小时内完成审核。',
      items: [],
      detail: null,
      orderDetail: null,
      actionMessage: '',
    });
    this.loadList();
    if (orders) this.loadOrderStats();
  },

  onOrderTimeRangeChange(e) {
    const index = Math.max(0, Math.min(
      ORDER_TIME_RANGES.length - 1,
      Number(e && e.detail && e.detail.value) || 0
    ));
    const selected = ORDER_TIME_RANGES[index];
    if (!selected || selected.key === this.data.activeOrderTimeRange) return;
    this.setData({
      orderTimeRangeIndex: index,
      activeOrderTimeRange: selected.key,
      orderTimeRangeLabel: selected.label,
      page: 1,
      items: [],
      detail: null,
      orderDetail: null,
      actionMessage: '',
    });
    this.loadList();
  },

  onSearchInput(e) {
    this.setData({ keywordInput: e.detail.value });
  },

  onSearchConfirm() {
    this.setData({ activeKeyword: String(this.data.keywordInput || '').trim() });
    this.loadList();
  },

  onClearSearch() {
    if (!this.data.keywordInput && !this.data.activeKeyword) return;
    this.setData({ keywordInput: '', activeKeyword: '' });
    this.loadList();
  },

  onMigrateProtection() {
    if (this.data.migrating || this.data.migrationAutoRunning) return;
    wx.showModal({
      title: '迁移老用户保护额度',
      content: '每批最多处理 50 位用户，回填 max(5, 当前未来 WAITING 提醒数) 和最近提醒时间。不会删除或改写提醒，可重复执行。',
      success: res => {
        if (!res.confirm) return;
        this.setData({
          migrating: true,
          migrationAutoRunning: false,
          migrationTotalScanned: 0,
          migrationTotalUpdated: 0,
          migrationMessage: '正在迁移本批用户...',
        });
        this.runMigrationBatch().catch(err => this.finishMigrationError(err));
      },
    });
  },

  onMigrateAllProtection() {
    if (this.data.migrationAutoRunning) {
      this._migrationStopRequested = true;
      this.setData({ migrationMessage: '正在停止，本批完成后会保存进度...' });
      return;
    }
    if (this.data.migrating) return;
    wx.showModal({
      title: '自动迁移全部用户',
      content: '将从当前进度开始，每批处理 50 人，自动继续到全部完成。进度保存在本机，可中途停止，不会删除或改写提醒。',
      success: res => {
        if (res.confirm) this.startMigrationAll();
      },
    });
  },

  runMigrationBatch() {
    this.setData({ migrating: true });
    return api.payment.afterSales.adminMigrateProtection(this.data.migrationCursor).then(result => {
      const scanned = Math.max(0, Number(result.scanned) || 0);
      const updated = Math.max(0, Number(result.updated) || 0);
      const totalScanned = this.data.migrationTotalScanned + scanned;
      const totalUpdated = this.data.migrationTotalUpdated + updated;
      const hasMore = !!result.hasMore;
      const migrationCursor = hasMore
        ? (result.nextCursor || this.data.migrationCursor || null)
        : null;
      this.setData({
        migrating: this.data.migrationAutoRunning,
        migrationCursor,
        migrationHasMore: hasMore,
        migrationCompleted: !hasMore,
        migrationTotalScanned: totalScanned,
        migrationTotalUpdated: totalUpdated,
        migrationMessage: `本次已扫描 ${totalScanned} 人，更新 ${totalUpdated} 人${hasMore ? '；继续下一批' : '；迁移已完成'}`,
      });
      if (!hasMore) wx.showToast({ title: '迁移已完成', icon: 'success' });
      if (migrationCursor) {
        try { wx.setStorageSync(MIGRATION_CURSOR_KEY, migrationCursor); } catch (e) {}
      } else {
        try { wx.removeStorageSync(MIGRATION_CURSOR_KEY); } catch (e) {}
      }
      return { ...result, totalScanned, totalUpdated };
    });
  },

  startMigrationAll() {
    if (this.data.migrating) return Promise.resolve();
    this._migrationStopRequested = false;
    this.setData({
      migrating: true,
      migrationAutoRunning: true,
      migrationTotalScanned: 0,
      migrationTotalUpdated: 0,
      migrationMessage: '正在自动迁移，请保持页面打开...',
    });
    const delayMs = this._migrationBatchDelayMs == null
      ? MIGRATION_BATCH_DELAY_MS
      : this._migrationBatchDelayMs;
    const step = () => {
      if (this._migrationStopRequested) {
        this.setData({
          migrating: false,
          migrationAutoRunning: false,
          migrationMessage: '已停止自动迁移；下次会从当前进度继续。',
        });
        return Promise.resolve();
      }
      return this.runMigrationBatch().then(result => {
        if (!result.hasMore) {
          this.setData({ migrating: false, migrationAutoRunning: false });
          return;
        }
        return wait(delayMs).then(step);
      });
    };
    return step().catch(err => this.finishMigrationError(err));
  },

  finishMigrationError(err) {
    this.setData({
      migrating: false,
      migrationAutoRunning: false,
      migrationMessage: (err && err.error) || '迁移失败，请稍后重试。',
    });
  },

  onRetryGrant() {
    if (this.data.acting || !this.data.detail) return;
    const caseId = this.data.detail.case._id;
    this.setData({ acting: true, actionMessage: '正在补发本单权益...' });
    api.payment.afterSales.adminRetryGrant(caseId).then(result => {
      this.setData({
        acting: false,
        actionMessage: result.entitlementStatus === 'PAID_GRANTED'
          ? '本单权益已补发到账。'
          : '补发未完成，订单仍保留在异常队列。',
      });
      return this.refreshDetail();
    }).catch(err => {
      this.setData({ acting: false, actionMessage: (err && err.error) || '补发失败，可稍后重试。' });
    });
  },

  onFilterTap(e) {
    const key = e.currentTarget.dataset.key || '';
    if (key === this.data.activeFilter) return;
    this.setData({
      activeFilter: key,
      detail: null,
      orderDetail: null,
      actionMessage: '',
      page: 1,
    });
    this.loadList();
  },

  onCaseTap(e) {
    const caseId = e.currentTarget.dataset.id;
    if (!caseId || this.data.acting) return;
    this.openCaseDetail(caseId);
  },

  openCaseDetail(caseId) {
    if (!caseId || this.data.acting) return Promise.resolve(false);
    this.setData({ actionMessage: '', orderDetail: null });
    return api.payment.afterSales.adminDetail(caseId).then(res => {
      this.setData({ detail: res, decisionNote: '' });
      return true;
    }).catch(err => {
      api.toastError(err);
      return false;
    });
  },

  onOrderTap(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    this.openOrderDetail(orderId);
  },

  openOrderDetail(orderId) {
    if (!orderId) return Promise.resolve(false);
    this.setData({ detail: null });
    return api.payment.adminOrders.detail(orderId).then(res => {
      this.setData({ orderDetail: res });
      return true;
    }).catch(err => {
      api.toastError(err);
      return false;
    });
  },

  onCloseOrderDetail() {
    this.setData({ orderDetail: null });
  },

  onOrderCaseTap(e) {
    const caseId = e.currentTarget.dataset.id;
    if (!caseId) return;
    this.setData({ orderDetail: null });
    this.openCaseDetail(caseId);
  },

  onOpenRelatedOrder() {
    const orderId = this.data.detail
      && this.data.detail.order
      && this.data.detail.order.orderId;
    if (!orderId) return;
    this.openOrderDetail(orderId);
  },

  onCopyText(e) {
    const value = String(e.currentTarget.dataset.value || '');
    if (!value) return;
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    });
  },

  refreshDetail() {
    const caseId = this.data.detail && this.data.detail.case && this.data.detail.case._id;
    if (!caseId) return Promise.resolve();
    return api.payment.afterSales.adminDetail(caseId).then(res => {
      this.setData({ detail: res });
      return Promise.all([this.loadList(), this.loadStatus()]);
    });
  },

  onApprove() {
    if (this.data.acting || !this.data.detail) return;
    const retrying = this.data.detail.case && this.data.detail.case.status === 'REFUND_FAILED';
    wx.showModal({
      title: retrying ? '重新发起退款' : '同意全额退款',
      content: retrying
        ? '请先确认商户基本账户已有足够退款资金。本次会沿用原退款单号重试，成功后只回收本订单新增权益。'
        : '将按订单原金额发起一次全额退款。退款成功后只回收本订单新增权益，不删除用户已有提醒。',
      success: res => {
        if (!res.confirm) return;
        const caseId = this.data.detail.case._id;
        this.setData({ acting: true, actionMessage: '正在发起退款...' });
        api.payment.afterSales.adminApproveRefund(caseId).then(result => {
          this.setData({
            acting: false,
            actionMessage: result.refundStatus === 'REFUNDED'
              ? '退款已完成，权益已回收。'
              : '退款已发起，等待微信支付结果。',
          });
          return this.refreshDetail();
        }).catch(err => {
          this.setData({ acting: false, actionMessage: (err && err.error) || '退款发起失败，可重试。' });
          return this.refreshDetail();
        });
      },
    });
  },

  onReject() {
    if (this.data.acting || !this.data.detail) return;
    const note = String(this.data.decisionNote || '').trim();
    if (!note) {
      wx.showToast({ title: '请填写用户可见的驳回原因', icon: 'none' });
      return;
    }
    const caseId = this.data.detail.case._id;
    this.setData({ acting: true, actionMessage: '正在驳回...' });
    api.payment.afterSales.adminReject({ caseId, decisionNote: note }).then(() => {
      this.setData({ acting: false, actionMessage: '已驳回，原因会展示给用户。', decisionNote: '' });
      return this.refreshDetail();
    }).catch(err => {
      this.setData({ acting: false, actionMessage: (err && err.error) || '驳回失败。' });
    });
  },

  onSyncPayment() {
    if (this.data.acting || !this.data.detail) return;
    const caseId = this.data.detail.case._id;
    this.setData({ acting: true, actionMessage: '正在同步支付结果...' });
    api.payment.afterSales.adminSyncPayment(caseId).then(result => {
      this.setData({
        acting: false,
        actionMessage: result.entitlementStatus === 'PAID_GRANTED'
          ? '支付与权益已确认，可按证据决定是否退款。'
          : '支付结果未到账或权益仍异常，请继续核验。',
      });
      return this.refreshDetail();
    }).catch(err => {
      this.setData({ acting: false, actionMessage: (err && err.error) || '同步失败。' });
    });
  },

  onSyncRefund() {
    if (this.data.acting || !this.data.detail) return;
    const caseId = this.data.detail.case._id;
    this.setData({ acting: true, actionMessage: '正在同步退款结果...' });
    api.payment.afterSales.adminSyncRefund(caseId).then(result => {
      this.setData({ acting: false, actionMessage: `退款状态：${result.refundStatus || '处理中'}` });
      return this.refreshDetail();
    }).catch(err => {
      this.setData({ acting: false, actionMessage: (err && err.error) || '同步失败。' });
    });
  },

  onDecisionInput(e) { this.setData({ decisionNote: e.detail.value }); },

  noop() {},

  onCloseDetail() { this.setData({ detail: null, decisionNote: '', actionMessage: '' }); },

  onBack() { wx.navigateBack(); },
});
