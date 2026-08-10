const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tripId: '',
    channels: {
      officialAccount: true,
      calendar: true,
      sms: false,
    },
    offsets: [5, 2],
    checkedOffset5: true,
    checkedOffset2: true,
    submitting: false,
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      tripId: options.tripId || g.currentTripId || '',
    });
  },

  onToggleChannel(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'sms') return;
    const channels = Object.assign({}, this.data.channels);
    channels[key] = !channels[key];
    this.setData({ channels });
  },

  onToggleOffset(e) {
    const val = Number(e.currentTarget.dataset.val);
    const offsets = [].concat(this.data.offsets);
    const idx = offsets.indexOf(val);
    if (idx >= 0) {
      offsets.splice(idx, 1);
    } else {
      offsets.push(val);
    }
    this.setData({
      offsets,
      checkedOffset5: offsets.indexOf(5) >= 0,
      checkedOffset2: offsets.indexOf(2) >= 0,
    });
  },

  onSubmit() {
    const { channels, offsets, tripId } = this.data;
    const channelList = [];
    if (channels.officialAccount) channelList.push('OFFICIAL_ACCOUNT');
    if (channels.calendar) channelList.push('CALENDAR_ICS');
    if (channelList.length === 0) {
      wx.showToast({ title: '请至少选择一种提醒方式', icon: 'none' });
      return;
    }
    if (offsets.length === 0) {
      wx.showToast({ title: '请至少选择一个提醒时间', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交...' });
    api.reminder.task.submit({ tripId, channels: channelList, offsets }).then(res => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (res.ics && res.ics.success && res.ics.downloadUrl) {
        wx.downloadFile({
          url: res.ics.downloadUrl,
          success: dlRes => {
            wx.openDocument({ filePath: dlRes.tempFilePath, fileType: 'ics' });
          },
        });
      }
      if (res.needsOaAuth) {
        wx.showModal({
          title: '公众号提醒',
          content: '关注公众号以接收提醒消息，也可以稍后在设置中开启。',
          confirmText: '去关注',
          cancelText: '跳过',
          success: modalRes => {
            if (modalRes.confirm) {
              wx.showToast({ title: '请在设置中开启公众号提醒', icon: 'none' });
            }
          },
        });
      }
      wx.showToast({ title: '提醒已设置，放票前见', icon: 'none' });
      setTimeout(() => {
        /* 回到首页：兼容 首页→设置（内联生成）与 首页→添加提醒→设置 两种栈深 */
        const pages = getCurrentPages();
        const homeIdx = pages.findIndex(p => p.route === 'pages/home/home');
        const delta = homeIdx >= 0 ? pages.length - 1 - homeIdx : 1;
        wx.navigateBack({ delta });
      }, 1500);
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
