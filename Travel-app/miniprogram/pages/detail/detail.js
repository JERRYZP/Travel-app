Page({
  data: {
    spot: null,
    loading: true,
    targetDate: '',
    channels: {
      wxMsg: true,
      calendar: true,
    },
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.fetchSpotDetail(id);
    }
  },

  async fetchSpotDetail(spotId) {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'spots',
        data: { action: 'detail', spotId },
      });
      this.setData({ spot: result.data, loading: false });
    } catch (err) {
      console.error('获取景点详情失败', err);
      this.setData({ loading: false });
    }
  },

  onDateSelect(e) {
    this.setData({ targetDate: e.detail });
  },

  onChannelChange(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ [`channels.${key}`]: e.detail });
  },

  async saveReminder() {
    const { spot, targetDate, channels } = this.data;
    if (!targetDate) {
      wx.showToast({ title: '请选择出行日期', icon: 'none' });
      return;
    }

    try {
      await wx.cloud.callFunction({
        name: 'notifier',
        data: {
          action: 'subscribe',
          spotId: spot.spotId,
          targetDate,
          channels,
        },
      });
      wx.showToast({ title: '提醒设置成功', icon: 'success' });
    } catch (err) {
      console.error('设置提醒失败', err);
      wx.showToast({ title: '设置失败，请重试', icon: 'none' });
    }
  },

  jumpToOfficial() {
    const { spot } = this.data;
    if (!spot) return;

    if (spot.officialAppid) {
      wx.navigateToMiniProgram({
        appId: spot.officialAppid,
        path: spot.officialPath || '',
        fail: () => {
          wx.showToast({ title: '跳转失败，请复制链接', icon: 'none' });
        },
      });
    } else if (spot.officialWebUrl) {
      wx.setClipboardData({
        data: spot.officialWebUrl,
        success: () => {
          wx.showToast({ title: '链接已复制', icon: 'success' });
        },
      });
    }
  },
});
