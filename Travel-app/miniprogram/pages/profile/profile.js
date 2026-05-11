const app = getApp();

Page({
  data: {
    userInfo: null,
    subscriptions: [],
    favorites: [],
    loading: true,
  },

  onLoad() {
    this.setData({ userInfo: app.globalData.userInfo });
    this.fetchProfileData();
  },

  async fetchProfileData() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'spots',
        data: { action: 'profile' },
      });
      this.setData({
        subscriptions: result.subscriptions || [],
        favorites: result.favorites || [],
        loading: false,
      });
    } catch (err) {
      console.error('获取个人数据失败', err);
      this.setData({ loading: false });
    }
  },

  onGetUserInfo(e) {
    const { userInfo } = e.detail;
    if (userInfo) {
      this.setData({ userInfo });
      app.globalData.userInfo = userInfo;
    }
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  async cancelSubscription(e) {
    const { id } = e.currentTarget.dataset;
    try {
      await wx.cloud.callFunction({
        name: 'notifier',
        data: { action: 'cancel', subscriptionId: id },
      });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.fetchProfileData();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },
});
