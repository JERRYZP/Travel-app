const app = getApp();
const api = require('../../utils/api.js');

const MIGRATION_CURSOR_KEY = 'admin_protection_migration_cursor_v1';
const MIGRATION_BATCH_DELAY_MS = 300;
// 上线前迁移已经完成；保留服务端能力和本地实现，仅关闭正式工作台入口。
const MIGRATION_ENTRY_ENABLED = false;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    filters: FILTERS,
    activeFilter: '',
    loading: true,
    loadFailed: false,
    forbidden: false,
    items: [],
    detail: null,
    decisionNote: '',
    acting: false,
    actionMessage: '',
    migrationCursor: null,
    migrationHasMore: false,
    migrationEntryEnabled: MIGRATION_ENTRY_ENABLED,
    migrationCompleted: false,
    fundingBlockedCount: 0,
    migrationMessage: '',
    migrating: false,
    migrationAutoRunning: false,
    migrationTotalScanned: 0,
    migrationTotalUpdated: 0,
  },

  onLoad() {
    const g = app.globalData;
    let migrationCursor = null;
    try { migrationCursor = wx.getStorageSync(MIGRATION_CURSOR_KEY) || null; } catch (e) {}
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
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

  onUnload() { this._migrationStopRequested = true; },

  loadMigrationStatus() {
    return api.payment.afterSales.adminStatus().then(res => {
      this.applyStatus(res);
    }).catch(() => {});
  },

  loadStatus() {
    return this.loadMigrationStatus();
  },

  applyStatus(res) {
    this.setData({
      migrationCompleted: !!(res && res.migrationCompleted),
      fundingBlockedCount: Math.max(0, Number(res && res.fundingBlockedCount) || 0),
    });
  },

  onShowFundingBlocked() {
    if (this.data.activeFilter === 'REFUND_FAILED') {
      return this.loadList();
    }
    this.setData({ activeFilter: 'REFUND_FAILED', detail: null, actionMessage: '' });
    return this.loadList();
  },

  loadList() {
    this.setData({ loading: true, loadFailed: false, forbidden: false });
    return api.payment.afterSales.adminList({ status: this.data.activeFilter }).then(res => {
      this.setData({ loading: false, items: res.items || [] });
    }).catch(err => {
      this.setData({
        loading: false,
        loadFailed: !(err && err.errorCode === 1040),
        forbidden: !!(err && err.errorCode === 1040),
      });
      if (!err || err.errorCode !== 1040) api.toastError(err);
    });
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
    this.setData({ activeFilter: key, detail: null, actionMessage: '' });
    this.loadList();
  },

  onCaseTap(e) {
    const caseId = e.currentTarget.dataset.id;
    if (!caseId || this.data.acting) return;
    this.setData({ actionMessage: '' });
    api.payment.afterSales.adminDetail(caseId).then(res => {
      this.setData({ detail: res, decisionNote: '' });
    }).catch(api.toastError);
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
