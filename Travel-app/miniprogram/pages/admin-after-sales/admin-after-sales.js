const app = getApp();
const api = require('../../utils/api.js');

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'SUBMITTED', label: '待审核' },
  { key: 'AUTO_CHECKING', label: '自动核验' },
  { key: 'UNDER_REVIEW', label: '审核中' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'REFUND_FAILED', label: '异常' },
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
    migrationMessage: '',
    migrating: false,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
  },

  onShow() { this.loadList(); },

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
    if (this.data.migrating) return;
    wx.showModal({
      title: '迁移老用户保护额度',
      content: '每批最多处理 50 位用户，回填 max(5, 当前未来 WAITING 提醒数) 和最近提醒时间。不会删除或改写提醒，可重复执行。',
      success: res => {
        if (!res.confirm) return;
        this.setData({ migrating: true, migrationMessage: '正在迁移本批用户...' });
        api.payment.afterSales.adminMigrateProtection(this.data.migrationCursor).then(result => {
          this.setData({
            migrating: false,
            migrationCursor: result.nextCursor || null,
            migrationHasMore: !!result.hasMore,
            migrationMessage: `已扫描 ${result.scanned || 0} 人，更新 ${result.updated || 0} 人${result.hasMore ? '；可继续下一批' : '；迁移批次已完成'}`,
          });
        }).catch(err => {
          this.setData({ migrating: false, migrationMessage: (err && err.error) || '迁移失败，请稍后重试。' });
        });
      },
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
      return this.loadList();
    });
  },

  onApprove() {
    if (this.data.acting || !this.data.detail) return;
    wx.showModal({
      title: '同意全额退款',
      content: '将按订单原金额发起一次全额退款。退款成功后只回收本订单新增权益，不删除用户已有提醒。',
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
