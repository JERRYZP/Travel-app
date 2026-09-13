const app = getApp();
const api = require('../../utils/api.js');

const MAX_CONTENT = 500;

/* 纠错类型：key 与 cloudfunctions/feedback/lib/schema.js 的 CORRECTION_ERROR_TYPES 对齐 */
const ERROR_TYPES = [
  { key: 'RELEASE_TIME', label: '放票时间' },
  { key: 'RELEASE_RULE', label: '放票规则' },
  { key: 'OPEN_TIME', label: '开放时间' },
  { key: 'TICKET_PRICE', label: '票价' },
  { key: 'ADDRESS', label: '地址' },
  { key: 'CLOSED_DAYS', label: '闭馆日' },
  { key: 'OTHER', label: '其他' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    errorTypes: ERROR_TYPES,
    keyword: '',
    results: [],
    searched: false,
    selected: null,
    errorType: '',
    content: '',
    contact: '',
    submitting: false,
    maxContent: MAX_CONTENT,
  },

  onLoad(options) {
    const g = app.globalData;
    const patch = { statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight };
    // 从规则详情「我要纠错」进入时预选该景点（有 name 直接用，否则拉详情）
    if (options && options.spotId) {
      if (options.spotName) {
        patch.selected = {
          spotId: options.spotId,
          name: decodeURIComponent(options.spotName),
          district: options.district ? decodeURIComponent(options.district) : '',
        };
      } else {
        api.spots.detail(options.spotId).then(res => {
          this.setData({ selected: { spotId: res.data.spotId, name: res.data.name, district: res.data.district || '' } });
        }).catch(() => {});
      }
    }
    this.setData(patch);
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], searched: true });
      return;
    }
    api.spots.search(kw).then(res => {
      this.setData({ results: res.data || [], searched: true });
    }).catch(err => api.toastError(err));
  },

  onSelectSpot(e) {
    const id = e.currentTarget.dataset.id;
    const spot = (this.data.results || []).find(s => s.spotId === id);
    if (!spot) return;
    this.setData({ selected: { spotId: spot.spotId, name: spot.name, district: spot.district } });
  },

  onClearSpot() {
    this.setData({ selected: null });
  },

  onSelectType(e) {
    this.setData({ errorType: e.currentTarget.dataset.key });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  onSubmit() {
    const { selected, errorType, content, contact } = this.data;
    if (!selected) {
      wx.showToast({ title: '请先选择景点', icon: 'none' });
      return;
    }
    if (!errorType) {
      wx.showToast({ title: '请选择纠错类型', icon: 'none' });
      return;
    }
    if (!content.trim()) {
      wx.showToast({ title: '请填写问题描述', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交...' });
    api.feedback.submit({
      type: 'correction',
      spotId: selected.spotId,
      spotName: selected.name,
      errorType,
      content: content.trim(),
      contact: contact.trim(),
    }).then(() => {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '感谢反馈，我们会尽快核实', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      api.toastError(err);
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
