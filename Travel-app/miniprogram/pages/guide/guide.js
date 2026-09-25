const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    openFaq: '',
    faqs: [
      {
        key: 'commit',
        q: '生成时间线后就创建行程了吗？',
        a: '还没有。生成时间线只是预览；把项目加入清单并提交后，才会创建行程和提醒。',
      },
      {
        key: 'quota',
        q: '为什么一个行程可能授权多次？',
        a: '微信订阅消息按条授权。每条提醒需要一次授权；若弹窗支持“总是保持以上选择”，勾选后可减少后续弹窗。',
      },
      {
        key: 'success',
        q: '已经约到的景点还会提醒吗？',
        a: '不会。标记为“已约到”后不再发送提醒，也不会继续占用待提醒任务。',
      },
      {
        key: 'free',
        q: '免预约景点为什么不设提醒？',
        a: '免预约项目没有固定放票时刻，只记录进行程；需要购票时请以官方渠道当日信息为准。',
      },
    ],
  },

  onLoad() {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
  },

  onBack() {
    wx.navigateBack();
  },

  onAddTrip() {
    wx.navigateTo({ url: '/pages/add-trip/add-trip' });
  },

  onNotifySettings() {
    wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  },

  onSpots() {
    wx.redirectTo({ url: '/pages/spot-hub/spot-hub' });
  },

  onCorrection() {
    wx.navigateTo({ url: '/pages/spot-correction/spot-correction' });
  },

  onToggleFaq(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ openFaq: this.data.openFaq === key ? '' : key });
  },
});
