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

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'suggestion', label: '建议' },
  { key: 'bug', label: 'Bug' },
  { key: 'correction', label: '纠错' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    filters: FILTERS,
    activeFilter: 'all',
    items: [],
    loading: true,
    forbidden: false,
  },

  /** 原始列表（adminList 返回，前端筛选用） */
  rawItems: [],

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
    this.load();
  },

  load() {
    this.setData({ loading: true, forbidden: false });
    api.feedback.adminList().then((res) => {
      if (!res || !res.success) {
        // 1040 = 非管理员白名单
        this.setData({ loading: false, forbidden: true, items: [] });
        return;
      }
      this.rawItems = (res.items || []).map(item => this.decorate(item));
      this.setData({ loading: false, items: this.filterItems(this.data.activeFilter) });
    }).catch(() => {
      this.setData({ loading: false, forbidden: true, items: [] });
    });
  },

  /** 补齐展示字段 */
  decorate(item) {
    const isCorrection = item.type === 'correction';
    const typeKey = isCorrection ? 'correction' : (item.category || 'suggestion');
    const status = STATUS_META[item.status] || STATUS_META.OPEN;
    const d = new Date(item.createdAt);
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
      time: `${util.pad(d.getMonth() + 1)}-${util.pad(d.getDate())} ${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`,
      status: item.status,
      statusLabel: status.label,
      statusCls: status.cls,
    };
  },

  /** 按筛选 key 过滤（all / suggestion / bug / correction） */
  filterItems(key) {
    if (key === 'all') return this.rawItems;
    return this.rawItems.filter(i => i.typeKey === key);
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeFilter: key, items: this.filterItems(key) });
  },

  onMark(e) {
    const { id, status } = e.currentTarget.dataset;
    api.feedback.adminUpdateStatus({ id, status }).then((res) => {
      if (!res || !res.success) {
        api.toastError(res);
        return;
      }
      const target = this.rawItems.find(i => i.id === id);
      if (target) {
        const meta = STATUS_META[status] || STATUS_META.OPEN;
        target.status = status;
        target.statusLabel = meta.label;
        target.statusCls = meta.cls;
        this.setData({ items: this.filterItems(this.data.activeFilter) });
      }
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
