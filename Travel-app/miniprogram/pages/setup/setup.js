const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tripId: '',
    channels: {
      officialAccount: true,
      sms: false,
    },
    offsets: [5],
    checkedOffset5: true,
    checkedOffset2: false,
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

  /* 提前量单选：5 分钟 / 2 分钟二选一（一次性订阅消息按条授权，一条任务只发一条提醒） */
  onToggleOffset(e) {
    const val = Number(e.currentTarget.dataset.val);
    this.setData({
      offsets: [val],
      checkedOffset5: val === 5,
      checkedOffset2: val === 2,
    });
  },

  onSubmit() {
    const { channels, offsets, tripId } = this.data;
    const channelList = [];
    if (channels.officialAccount) channelList.push('OFFICIAL_ACCOUNT');
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

    /* 前置授权没做齐 → 当前页弹窗就地引导，不跳个人中心；授权完成后继续提交 */
    notify.getNotifyStatus().then(status => {
      if (status.systemOk && status.subscribeOk) {
        /* 两项授权都在，仍要攒配额：一次性订阅每授权一次只能发一条，
           勾过「总是允许」的用户此处静默通过不弹窗 */
        notify.requestSubscribe().then(() => {
          this.submitTask({ tripId, channelList, offsets });
        });
        return;
      }
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({
        title: '开启通知',
        content: status.doneCount === 0
          ? '需要开启「微信通知权限」和「订阅消息授权」，提醒才能送达。现在开启？'
          : '还有一项通知权限未开启，提醒可能收不到。现在补上？',
        confirmText: '去开启',
        cancelText: '暂不',
        success: res => {
          if (res.confirm) {
            this.setData({ submitting: true });
            wx.showLoading({ title: '正在开启...' });
            this.localAuthThenSubmit({ tripId, channelList, offsets }, status);
          } else {
            this.submitTask({ tripId, channelList, offsets });
          }
        },
      });
    });
  },

  /* 就地授权：订阅消息（页内弹框，每次提交都请求以攒配额）+ 系统通知权限（跳系统设置），然后继续提交 */
  localAuthThenSubmit(payload, status) {
    const steps = [notify.requestSubscribe()];
    if (!status.systemOk) steps.push(Promise.resolve(notify.openSystemNotifySetting()));
    Promise.all(steps).then(() => this.submitTask(payload));
  },

  submitTask({ tripId, channelList, offsets }) {
    wx.showLoading({ title: '正在提交...' });
    api.reminder.task.submit({ tripId, channels: channelList, offsets }).then(res => {
      wx.hideLoading();
      this.setData({ submitting: false });
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
      /* 标记提交成功，首页 onShow 据此切回「提醒任务」Tab */
      app.globalData.reminderSubmitted = true;
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
