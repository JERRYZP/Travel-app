const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    channels: {
      officialAccount: true,
      sms: false,
    },
    offsets: [5],
    checkedOffset5: true,
    checkedOffset2: false,
    reminderCount: 0,
    submitting: false,
  },

  onLoad() {
    const g = app.globalData;
    /* 2026-09-20 纯预览化后不再有 tripId 可传：清单是「提交前的暂存区」，
       行程要到 cart.commit 那一刻才创建/合并。这里只管提前量与通道。 */
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
  },

  onShow() {
    api.reminder.cart.list().then(res => {
      const count = (res && res.summary && res.summary.reminderCount) || 0;
      this.setData({ reminderCount: count });
    }).catch(() => {});
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
    const { channels, offsets } = this.data;
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

    const doSubmit = options => this.submitTask(Object.assign({ channelList, offsets }, options || {}));
    const finish = access => {
      wx.hideLoading();
      if (access.action === 'ready') {
        doSubmit();
        return;
      }
      if (access.action === 'trip-only') {
        doSubmit({ disableReminders: true });
        return;
      }
      this.setData({ submitting: false });
      if (access.action !== 'settings') return;
      if (access.settingsKind === 'system') notify.openSystemNotifySetting();
      else wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
    };

    notify.getReminderQuotaNeeded(offsets.length)
      .then(needed => notify.confirmReminderAccess(needed).then(access => ({ needed, access })))
      .then(({ needed, access }) => {
        if (needed > 0) this.setData({ reminderCount: needed });
        finish(access);
      })
      .catch(err => {
        wx.hideLoading();
        this.setData({ submitting: false });
        api.toastError(err);
      });
  },

  submitTask({ channelList, offsets, disableReminders }) {
    wx.showLoading({ title: '正在提交...' });
    /* 提交 = 唯一创建行程的时机；返回的 tripId 供首页定位新行程 */
    const payload = disableReminders
      ? { disableReminders: true }
      : { channels: channelList, offsets };
    api.reminder.cart.commit(payload).then(res => {
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
      let toast;
      if (disableReminders) {
        toast = '已加入行程，未设置提醒';
      } else if (res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip()) {
        toast = '提醒已设置，先备好游客信息';
      } else {
        toast = res.createdTasks > 0
          ? (res.noReminder > 0 ? '行程已添加，提醒已设置' : '提醒已设置，放票前见')
          : '行程已添加，未设置提醒';
      }
      wx.showToast({ title: toast, icon: 'none', duration: 2000 });
      /* 提交是唯一创建行程的时机，tripId 这一刻才有 —— 写给首页定位用。
         纯预览化后「生成时间线」不再建行程，所以不能更早写。
         ⚠️ 只在**没有别的页在等它**时才写：从「添加提醒」带行程进来的路径上，
         add-trip 拿到返回值后会自己写（那是回首页的那一页，它更清楚该定位到哪趟），
         这里抢写会让首页定位到别处。条件①之外的分支都是「首页直达设置」的旧路径。 */
      const fromAddTrip = getCurrentPages().some(p => p.route === 'pages/add-trip/add-trip');
      if (res.tripId && !fromAddTrip) app.globalData.currentTripId = res.tripId;
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
