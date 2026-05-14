const app = getApp();

Page({
  data: {
    spots: [],
    loading: true,
  },

  onLoad() {
    this.fetchSpots();
  },

  onPullDownRefresh() {
    this.fetchSpots().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async fetchSpots() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'spots',
        data: { action: 'list' },
      });
      if (result.success) {
        this.setData({ spots: result.data, loading: false });
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('获取景点列表失败', err);
      this.setData({ loading: false });
    }
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  async toggleFavorite(e) {
    const { id } = e.currentTarget.dataset;
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'spots',
        data: { action: 'toggleFavorite', spotId: id },
      });
      if (result.success) {
        this.fetchSpots();
      }
    } catch (err) {
      console.error('收藏操作失败', err);
    }
  },
});
