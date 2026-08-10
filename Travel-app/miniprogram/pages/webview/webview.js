Page({
  data: {
    url: '',
  },

  onLoad(options) {
    const url = decodeURIComponent(options.url || '');
    const title = options.title ? decodeURIComponent(options.title) : '景区官网';
    this.setData({ url });
    wx.setNavigationBarTitle({ title });
  },
});
