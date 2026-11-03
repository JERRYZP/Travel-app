const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

/** 纠错类型 label（与 cloudfunctions/feedback/lib/schema.js 的 CORRECTION_ERROR_TYPES 对齐） */
const ERROR_TYPE_LABELS = {
  RELEASE_TIME: '放票时间',
  RELEASE_RULE: '放票规则',
  OPEN_TIME: '开放时间',
  TICKET_PRICE: '票价',
  ADDRESS: '地址',
  CLOSED_DAYS: '闭馆日',
  OTHER: '其他',
};

const STATUS_META = {
  OPEN: { label: '待处理', cls: 'open' },
  PROCESSED: { label: '已处理', cls: 'processed' },
  IGNORED: { label: '已忽略', cls: 'ignored' },
};

const PAGE_SIZE = 20;
const REPLY_MAX_LEN = 300;

/**
 * 筛选 Tab 与请求参数的唯一映射。
 * 「建议 / Bug」是 category，不是 type —— 两者同属 type=feedback。
 * 纠错的 category 恒为 null，所以只传 type 就能天然排除。
 */
const FILTERS = [
  { key: 'all', label: '全部', params: {} },
  { key: 'suggestion', label: '建议', params: { category: 'suggestion' } },
  { key: 'bug', label: 'Bug', params: { category: 'bug' } },
  { key: 'correction', label: '纠错', params: { type: 'correction' } },
];

function filterParamsOf(key) {
  const hit = FILTERS.find(item => item.key === key);
  return hit ? hit.params : FILTERS[0].params;
}

/** 翻页期间若插入新反馈，同一 id 可能重复出现在相邻两页 */
function dedupeById(list) {
  const seen = new Set();
  return list.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    filters: FILTERS.map(item => ({ key: item.key, label: item.label })),
    activeFilter: 'all',
    items: [],
    loading: true,
    loadFailed: false,
    loadingMore: false,
    forbidden: false,
    page: 1,
    hasMore: false,
    replyId: '',
    replyDraft: '',
    replyCanSend: false,
    replySaving: false,
    replyMax: REPLY_MAX_LEN,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
    this.load();
  },

  /**
   * 拉取列表。append=true 时接着下一页拼在末尾。
   * _listRequestSeq 用来丢弃过期响应：切 Tab 或重复刷新时，先发的慢请求不能覆盖后发的快请求。
   */
  load(options = {}) {
    const append = options.append === true;
    const page = append ? Number(this.data.page || 1) + 1 : 1;
    const requestSeq = Number(this._listRequestSeq || 0) + 1;
    this._listRequestSeq = requestSeq;

    this.setData(append
      ? { loadingMore: true }
      : {
        loading: true,
        loadFailed: false,
        loadingMore: false,
        forbidden: false,
        replyId: '',
        replyDraft: '',
        replyCanSend: false,
        replySaving: false,
      });

    return api.feedback.adminList({
      ...filterParamsOf(this.data.activeFilter),
      page,
      pageSize: PAGE_SIZE,
    }).then(res => {
      if (requestSeq !== this._listRequestSeq) return;
      const nextItems = (res.items || []).map(item => this.decorate(item));
      const merged = append ? this.data.items.concat(nextItems) : nextItems;
      this.setData({
        loading: false,
        loadFailed: false,
        loadingMore: false,
        page,
        hasMore: !!res.hasMore,
        items: dedupeById(merged),
      });
    }).catch(err => {
      if (requestSeq !== this._listRequestSeq) return;
      const forbidden = !!(err && err.errorCode === 1040);
      this.setData({
        loading: false,
        loadingMore: false,
        loadFailed: !append && !forbidden,
        forbidden,
        items: append ? this.data.items : [],
      });
      if (!forbidden) api.toastError(err);
    });
  },

  /** 补齐展示字段 */
  decorate(item) {
    const isCorrection = item.type === 'correction';
    const typeKey = isCorrection ? 'correction' : (item.category || 'suggestion');
    const status = STATUS_META[item.status] || STATUS_META.OPEN;
    const adminReply = String(item.adminReply || '');
    const user = item.user || {};
    return {
      id: item._id,
      type: item.type,
      isCorrection,
      typeKey,
      typeLabel: isCorrection ? '纠错' : (item.category === 'bug' ? 'Bug' : '建议'),
      spotName: item.spotName || '',
      errorTypeLabel: ERROR_TYPE_LABELS[item.errorType] || item.errorType || '',
      content: item.content || '',
      contact: item.contact || '',
      time: util.monthDayTime(item.createdAt),
      status: item.status,
      statusLabel: status.label,
      statusCls: status.cls,
      nickname: String(user.nickname || ''),
      openId: String(user.openId || item.userId || ''),
      adminReply,
      hasReply: !!adminReply,
      replyTime: item.adminReplyAt ? util.monthDayTime(item.adminReplyAt) : '',
    };
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeFilter) return;
    // 作废在途请求，并收起卡片内可能开着的回复框
    this._listRequestSeq = Number(this._listRequestSeq || 0) + 1;
    this.setData({
      activeFilter: key,
      items: [],
      page: 1,
      hasMore: false,
      replyId: '',
      replyDraft: '',
      replyCanSend: false,
      replySaving: false,
    });
    return this.load();
  },

  onLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.load({ append: true });
  },

  onRetry() {
    return this.load();
  },

  onMark(e) {
    const { id, status } = e.currentTarget.dataset;
    api.feedback.adminUpdateStatus({ id, status }).then(() => {
      const meta = STATUS_META[status] || STATUS_META.OPEN;
      this.setData({
        items: this.data.items.map(item => (
          item.id === id
            ? { ...item, status, statusLabel: meta.label, statusCls: meta.cls }
            : item
        )),
      });
    }).catch(err => api.toastError(err));
  },

  /** 打开卡片内回复框；已有回复时预填，方便修改 */
  onReplyStart(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.items.find(item => item.id === id);
    const draft = target && target.adminReply ? target.adminReply : '';
    this.setData({
      replyId: id,
      replyDraft: draft,
      replyCanSend: !!draft.trim(),
      replySaving: false,
    });
  },

  onReplyInput(e) {
    const value = e.detail.value || '';
    this.setData({ replyDraft: value, replyCanSend: !!value.trim() });
  },

  onReplyCancel() {
    this.setData({ replyId: '', replyDraft: '', replyCanSend: false, replySaving: false });
  },

  onReplySubmit() {
    if (this.data.replySaving || !this.data.replyCanSend) return;
    const id = this.data.replyId;
    if (!id) return;
    this.setData({ replySaving: true });
    api.feedback.adminReply({ id, reply: this.data.replyDraft.trim() }).then(res => {
      const meta = STATUS_META[res.status] || STATUS_META.PROCESSED;
      const adminReply = String(res.adminReply || '');
      this.setData({
        replySaving: false,
        replyId: '',
        replyDraft: '',
        replyCanSend: false,
        items: this.data.items.map(item => (
          item.id === id
            ? {
              ...item,
              adminReply,
              hasReply: !!adminReply,
              replyTime: res.adminReplyAt ? util.monthDayTime(res.adminReplyAt) : item.replyTime,
              status: res.status,
              statusLabel: meta.label,
              statusCls: meta.cls,
            }
            : item
        )),
      });
      wx.showToast({ title: '已回复', icon: 'none' });
    }).catch(err => {
      this.setData({ replySaving: false });
      api.toastError(err);
    });
  },

  onCopyText(e) {
    const value = String(e.currentTarget.dataset.value || '');
    if (!value) return;
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
