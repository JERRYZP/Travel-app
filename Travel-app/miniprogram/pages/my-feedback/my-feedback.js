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

const STATUS_META = {
  OPEN: { label: '待处理', cls: 'open' },
  PROCESSED: { label: '已处理', cls: 'processed' },
  IGNORED: { label: '已忽略', cls: 'ignored' },
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
    return {
      id: item._id,
      isCorrection,
      typeKey,
      typeLabel: isCorrection ? '纠错' : (item.category === 'bug' ? 'Bug' : '建议'),
      spotName: item.spotName || '',
      errorTypeLabel: ERROR_TYPE_LABELS[item.errorType] || item.errorType || '',
      content: item.content || '',
      time: util.monthDayTime(item.createdAt),
      statusCls: status.cls,
      statusLabel: status.label,
    };
  },

  onRetry() {
    this.load();
  },

  onBack() {
    wx.navigateBack();
  },
});
