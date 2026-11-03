const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

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

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    failed: false,
    items: [],
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
    api.feedback.list().then(res => {
      const items = (res.items || []).map(item => this.decorate(item));
      this.setData({ loading: false, items });
    }).catch(err => {
      console.error('[my-feedback] 加载失败：', err);
      this.setData({ loading: false, failed: true, items: [] });
    });
  },

  decorate(item) {
    const isCorrection = item.type === 'correction';
    const typeKey = isCorrection ? 'correction' : (item.category || 'suggestion');
    const status = STATUS_META[item.status] || STATUS_META.OPEN;
    const adminReply = String(item.adminReply || '');
    const hasReply = !!adminReply;
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
      adminReply,
      hasReply,
      replyTime: item.adminReplyAt ? util.monthDayTime(item.adminReplyAt) : '',
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
