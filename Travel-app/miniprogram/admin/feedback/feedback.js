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
const REWARD_META = {
  NONE: { label: '未赠送', cls: 'none' },
  GRANTED: { label: '已赠 30 天', cls: 'granted' },
  REVOKED: { label: '奖励已撤回', cls: 'revoked' },
};

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

function formatBeijingDate(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function displayRepliesOf(item = {}) {
  const source = Array.isArray(item.replies) ? item.replies : [];
  if (source.length > 0) {
    return source.map(reply => ({
      id: String(reply.replyId || ''),
      content: String(reply.content || ''),
      time: util.monthDayTime(reply.createdAt),
      edited: reply.edited === true || Number(reply.editCount) > 0,
      updatedTime: reply.updatedAt ? util.monthDayTime(reply.updatedAt) : '',
    })).filter(reply => reply.id && reply.content);
  }
  const content = String(item.adminReply || '');
  if (!content) return [];
  return [{
    id: 'legacy',
    content,
    time: item.adminReplyAt ? util.monthDayTime(item.adminReplyAt) : '',
    edited: false,
    updatedTime: '',
  }];
}

function displayRewardOf(item = {}) {
  const reward = item.reward || {};
  const status = REWARD_META[reward.status] ? reward.status : 'NONE';
  const meta = REWARD_META[status];
  return {
    status,
    label: meta.label,
    cls: meta.cls,
    days: Math.max(0, Number(reward.days) || 0),
    backfill: reward.backfill === true,
    backfillable: reward.backfillable === true,
    expiresText: formatBeijingDate(reward.memberExpiresAt),
    grantedTime: reward.grantedAt ? util.monthDayTime(reward.grantedAt) : '',
    revokedTime: reward.revokedAt ? util.monthDayTime(reward.revokedAt) : '',
  };
}

function confirmModal(options) {
  return new Promise(resolve => {
    wx.showModal({
      ...options,
      success: res => resolve(!!(res && res.confirm)),
      fail: () => resolve(false),
    });
  });
}

function replyResultPatch(item, res = {}) {
  const replies = displayRepliesOf({
    ...item,
    replies: Array.isArray(res.replies) ? res.replies : item.replies,
    adminReply: res.adminReply,
    adminReplyAt: res.adminReplyAt,
  });
  const latest = replies[replies.length - 1];
  const meta = STATUS_META[res.status] || STATUS_META.PROCESSED;
  return {
    ...item,
    replies,
    hasReply: replies.length > 0,
    adminReply: latest ? latest.content : '',
    replyTime: latest ? latest.time : '',
    status: res.status || item.status,
    statusLabel: meta.label,
    statusCls: meta.cls,
  };
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
    replyMode: '',
    editingReplyId: '',
    replyDraft: '',
    replyCanSend: false,
    replySaving: false,
    replyMax: REPLY_MAX_LEN,
    canReward: false,
    rewardBusyId: '',
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
    this.loadRewardPermission();
    this.load();
  },

  loadRewardPermission() {
    return api.payment.feedbackReward.adminStatus().then(res => {
      this.setData({ canReward: !!(res && res.isAdmin) });
      return !!(res && res.isAdmin);
    }).catch(() => {
      this.setData({ canReward: false });
      return false;
    });
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
        replyMode: '',
        editingReplyId: '',
        replyDraft: '',
        replyCanSend: false,
        replySaving: false,
        rewardBusyId: '',
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
    const replies = displayRepliesOf(item);
    const adminReply = replies.length > 0 ? replies[replies.length - 1].content : '';
    const user = item.user || {};
    const member = user.member === true;
    const memberExpiresAtText = String(user.memberExpiresAtText || '');
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
      member,
      memberExpiryText: member && memberExpiresAtText ? `至 ${memberExpiresAtText}` : '',
      adminReply,
      hasReply: replies.length > 0,
      replies,
      replyTime: replies.length > 0 ? replies[replies.length - 1].time : '',
      reward: displayRewardOf(item),
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
      replyMode: '',
      editingReplyId: '',
      replyDraft: '',
      replyCanSend: false,
      replySaving: false,
      rewardBusyId: '',
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

  /** 追加回复始终使用空编辑器，避免误改历史回复。 */
  onReplyStart(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      replyId: id,
      replyMode: 'add',
      editingReplyId: '',
      replyDraft: '',
      replyCanSend: false,
      replySaving: false,
    });
  },

  /** 修改指定回复；时间永不重置，只更新正文和修改时间。 */
  onReplyEdit(e) {
    const { id, replyId } = e.currentTarget.dataset;
    const target = this.data.items.find(item => item.id === id);
    const reply = target && (target.replies || []).find(item => item.id === replyId);
    if (!reply) return;
    this.setData({
      replyId: id,
      replyMode: 'edit',
      editingReplyId: replyId,
      replyDraft: reply.content,
      replyCanSend: !!reply.content.trim(),
      replySaving: false,
    });
  },

  onReplyInput(e) {
    const value = e.detail.value || '';
    this.setData({ replyDraft: value, replyCanSend: !!value.trim() });
  },

  onReplyCancel() {
    this.setData({
      replyId: '',
      replyMode: '',
      editingReplyId: '',
      replyDraft: '',
      replyCanSend: false,
      replySaving: false,
    });
  },

  onReplySubmit() {
    if (this.data.replySaving || !this.data.replyCanSend) return;
    const id = this.data.replyId;
    if (!id) return;
    this.setData({ replySaving: true });
    const editing = this.data.replyMode === 'edit';
    const request = editing
      ? api.feedback.adminUpdateReply({
        id,
        replyId: this.data.editingReplyId,
        reply: this.data.replyDraft.trim(),
      })
      : api.feedback.adminAddReply({ id, reply: this.data.replyDraft.trim() });
    return request.then(res => {
      this.setData({
        replySaving: false,
        replyId: '',
        replyMode: '',
        editingReplyId: '',
        replyDraft: '',
        replyCanSend: false,
        items: this.data.items.map(item => (
          item.id === id ? replyResultPatch(item, res) : item
        )),
      });
      wx.showToast({ title: editing ? '回复已更新' : '已添加回复', icon: 'none' });
      return res;
    }).catch(err => {
      this.setData({ replySaving: false });
      api.toastError(err);
      return null;
    });
  },

  onGrantReward(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.canReward || this.data.rewardBusyId) return Promise.resolve(false);
    const target = this.data.items.find(item => item.id === id);
    if (!target || target.reward.status !== 'NONE') return Promise.resolve(false);
    return confirmModal({
      title: '赠送 30 天会员',
      content: `将给 ${target.nickname || target.openId || '该用户'} 增加 30 天会员，反馈会同步标记为已处理。`,
      confirmText: '继续',
    }).then(first => first && confirmModal({
      title: '再次确认',
      content: '这是人工补发权益，提交后会立即生效并写入审计日志。',
      confirmText: '确认赠送',
      confirmColor: '#8A5A12',
    })).then(confirmed => {
      if (!confirmed) return false;
      this.setData({ rewardBusyId: id });
      return api.payment.feedbackReward.adminGrant(id).then(res => {
        this.setData({
          rewardBusyId: '',
          items: this.data.items.map(item => (
            item.id === id ? { ...item, reward: displayRewardOf(res) } : item
          )),
        });
        wx.showToast({ title: '已赠送 30 天会员', icon: 'none' });
        return true;
      }).catch(err => {
        this.setData({ rewardBusyId: '' });
        api.toastError(err);
        return false;
      });
    });
  },

  onRevokeReward(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.canReward || this.data.rewardBusyId) return Promise.resolve(false);
    const target = this.data.items.find(item => item.id === id);
    if (!target || target.reward.status !== 'GRANTED') return Promise.resolve(false);
    return confirmModal({
      title: '撤回会员奖励',
      content: '将扣回该反馈对应的 30 天会员，并通知用户。仅在它仍是最后一次权益发放时可撤回。',
      confirmText: '继续',
      confirmColor: '#B23B2E',
    }).then(first => first && confirmModal({
      title: '再次确认',
      content: '撤回后该反馈不能再次赠送，操作会写入审计日志。',
      confirmText: '确认撤回',
      confirmColor: '#B23B2E',
    })).then(confirmed => {
      if (!confirmed) return false;
      this.setData({ rewardBusyId: id });
      return api.payment.feedbackReward.adminRevoke(id).then(res => {
        this.setData({
          rewardBusyId: '',
          items: this.data.items.map(item => (
            item.id === id ? { ...item, reward: displayRewardOf(res) } : item
          )),
        });
        wx.showToast({ title: '奖励已撤回', icon: 'none' });
        return true;
      }).catch(err => {
        this.setData({ rewardBusyId: '' });
        api.toastError(err);
        return false;
      });
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
