const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const feedbackEntryCache = require('../../utils/feedback-entry-cache.js');
const membershipCache = require('../../utils/membership-cache.js');

const ERROR_TYPE_LABELS = {
  RELEASE_TIME: '放票时间',
  RELEASE_RULE: '放票规则',
  OPEN_TIME: '开放时间',
  TICKET_PRICE: '票价',
  ADDRESS: '地址',
  CLOSED_DAYS: '闭馆日',
  OTHER: '其他',
};

/**
 * 用户视角的状态词。管理端的「已忽略」对用户是「已关闭」——
 * 内部枚举不变（OPEN / PROCESSED / IGNORED），只换展示文案。
 */
const STATUS_META = {
  OPEN: { label: '处理中', cls: 'open' },
  PROCESSED: { label: '已处理', cls: 'processed' },
  IGNORED: { label: '已关闭', cls: 'ignored' },
};

const REWARD_META = {
  NONE: { label: '', cls: 'none' },
  GRANTED: { label: '已赠 30 天会员', cls: 'granted' },
  REVOKED: { label: '会员奖励已撤回', cls: 'revoked' },
};

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
    })).filter(reply => reply.id && reply.content);
  }
  const content = String(item.adminReply || '');
  if (!content) return [];
  return [{
    id: 'legacy',
    content,
    time: item.adminReplyAt ? util.monthDayTime(item.adminReplyAt) : '',
    edited: false,
  }];
}

function rewardNoticeOf(item = {}) {
  const reward = item.reward || {};
  const status = reward.status === 'GRANTED' || reward.status === 'REVOKED' ? reward.status : 'NONE';
  if (status === 'NONE') return null;
  const expiresText = formatBeijingDate(reward.memberExpiresAt);
  return {
    key: `${item.feedbackId}_${new Date(reward.updatedAt || 0).getTime()}_${status}`,
    feedbackId: item.feedbackId,
    status,
    cls: status === 'GRANTED' ? 'granted' : 'revoked',
    title: status === 'GRANTED'
      ? (reward.backfill ? '旧反馈补发奖励已到账' : '反馈奖励已到账')
      : '反馈奖励已撤回',
    detail: status === 'GRANTED'
      ? `已为你增加 30 天会员${expiresText ? `，有效期至 ${expiresText}` : ''}。`
      : '该反馈对应的会员奖励已撤回，会员状态已按服务端结果更新。',
    content: String(item.content || ''),
    typeLabel: item.type === 'correction' ? '信息纠错' : (item.category === 'bug' ? 'Bug' : '建议'),
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    failed: false,
    items: [],
    rewardNotices: [],
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
    this.load();
  },

  load() {
    this.setData({ loading: true, failed: false });
    return api.feedback.list().then(res => {
      const items = (res.items || []).map(item => this.decorate(item));
      const rewardNotices = (res.rewardNotices || []).map(rewardNoticeOf).filter(Boolean);
      this.applyRewardNotices(rewardNotices);
      this.setData({ loading: false, items, rewardNotices });
      if (!res.asOf) return null;
      // 只推进到本次列表查询的快照点，查询开始后新到的处理仍保持未读。
      return api.feedback.markSeen({ through: res.asOf }).then(() => {
        feedbackEntryCache.markUserRead();
      }).catch(() => null);
    }).catch(err => {
      console.error('[my-feedback] 加载失败：', err);
      this.setData({ loading: false, failed: true, items: [], rewardNotices: [] });
      return null;
    });
  },

  applyRewardNotices(notices) {
    const seen = this._rewardNoticeKeys || new Set();
    const fresh = notices.filter(item => !seen.has(item.key));
    notices.forEach(item => seen.add(item.key));
    this._rewardNoticeKeys = seen;
    if (fresh.length > 0) membershipCache.markDirty();
  },

  decorate(item) {
    const isCorrection = item.type === 'correction';
    const typeKey = isCorrection ? 'correction' : (item.category || 'suggestion');
    const status = STATUS_META[item.status] || STATUS_META.OPEN;
    const replies = displayRepliesOf(item);
    const hasReply = replies.length > 0;
    const reward = item.reward || {};
    const rewardStatus = REWARD_META[reward.status] ? reward.status : 'NONE';
    const rewardMeta = REWARD_META[rewardStatus];
    return {
      id: item._id,
      isCorrection,
      typeKey,
      typeLabel: isCorrection ? '纠错' : (item.category === 'bug' ? 'Bug' : '建议'),
      spotName: item.spotName || '',
      errorTypeLabel: ERROR_TYPE_LABELS[item.errorType] || item.errorType || '',
      content: item.content || '',
      time: util.monthDayTime(item.createdAt),
      // 有回复时状态直接显示「已回复」，比「已处理」对用户更有信息量
      statusCls: hasReply ? 'processed' : status.cls,
      statusLabel: hasReply ? '已回复' : status.label,
      hasReply,
      replies,
      reward: {
        status: rewardStatus,
        label: rewardMeta.label,
        cls: rewardMeta.cls,
        backfill: reward.backfill === true,
        expiresText: formatBeijingDate(reward.memberExpiresAt),
      },
    };
  },

  onRetry() {
    this.load();
  },

  onPullDownRefresh() {
    return this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onBack() {
    wx.navigateBack();
  },
});
