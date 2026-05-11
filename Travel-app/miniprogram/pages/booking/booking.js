Page({
  data: {
    entries: [],
    loading: true,
  },

  onLoad() {
    this.fetchEntries();
  },

  async fetchEntries() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'spots',
        data: { action: 'entries' },
      });
      this.setData({ entries: result.data || [], loading: false });
    } catch (err) {
      console.error('获取入口列表失败', err);
      this.setData({ loading: false });
    }
  },

  jumpToMiniProgram(e) {
    const { appid, path } = e.currentTarget.dataset;
    wx.navigateToMiniProgram({
      appId: appid,
      path: path || '',
      fail: () => {
        wx.showToast({ title: '跳转失败', icon: 'none' });
      },
    });
  },

  copyUrl(e) {
    const { url } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '网址已复制', icon: 'success' });
      },
    });
  },
});
