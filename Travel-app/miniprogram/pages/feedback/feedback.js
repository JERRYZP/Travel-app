const app = getApp();
const api = require('../../utils/api.js');

const MAX_CONTENT = 500;

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    category: 'suggestion',
    content: '',
    contact: '',
    submitting: false,
    maxContent: MAX_CONTENT,
  },

  onLoad() {
    const g = app.globalData;
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight });
  },

  onSelectCategory(e) {
    this.setData({ category: e.currentTarget.dataset.val });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  onSubmit() {
    const content = this.data.content.trim();
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交...' });
    api.feedback.submit({
      type: 'feedback',
      category: this.data.category,
      content,
      contact: this.data.contact.trim(),
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
