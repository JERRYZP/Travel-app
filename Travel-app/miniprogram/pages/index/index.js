const app = getApp();

Page({
  data: {
    spots: [],
    loading: true,
    activeCategory: 'all',
    activeDifficulty: 'all',
    searchKeyword: '',
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
      this.setData({ spots: result.data || [], loading: false });
    } catch (err) {
      console.error('获取景点列表失败', err);
      this.setData({ loading: false });
    }
  },

  onSearchChange(e) {
    this.setData({ searchKeyword: e.detail });
  },

  onCategoryChange(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.key });
  },

  onDifficultyChange(e) {
    this.setData({ activeDifficulty: e.currentTarget.dataset.key });
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  toggleFavorite(e) {
    const { id } = e.currentTarget.dataset;
    // TODO: 调用云函数更新收藏状态
  },
});
