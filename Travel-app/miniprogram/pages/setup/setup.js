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

    const doSubmit = () => this.submitTask({ tripId, channelList, offsets });

    /* ① 系统通知权限（推送能否送达的前提）未开 → 引导去系统设置 */
    if (!notify.getSystemNotifyOk()) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({
        title: '开启通知',
        content: '微信通知权限未开启，提醒可能收不到。现在去系统设置开启？',
        confirmText: '去开启',
        cancelText: '暂不',
        success: res => {
          if (res.confirm) {
            this.setData({ submitting: true });
            wx.showLoading({ title: '正在开启...' });
            notify.openSystemNotifySetting();
          }
          doSubmit();
        },
      });
      return;
    }

    /* ② 订阅额度按需授权：本次需要「将设提醒的清单项数 × 提前量个数」条额度。
       额度足够 → 不弹；不足且勾过「总是保持以上选择」→ 微信静默连发补齐；
       不足且没勾 → 微信每次调用必弹窗，故最多弹 1 次，缺口由 shortfall 提示用户；
       20004（订阅消息总开关关闭）→ 引导去设置页 */
    this.loadNeededQuota().then(needed => {
      if (needed <= 0) {
        doSubmit();
        return;
      }
      notify.ensureSubscribe(needed).then(r => {
        if (r.reason === 'master-switch-off' || r.reason === 'subscription-disabled') {
          notify.guideOpenSubscribeSetting(r.reason);
        }
        if (r.shortfall > 0) {
          /* 额度没补满 → 提交前说清楚，避免「提交成功却收不到提醒」 */
          wx.hideLoading();
          /* ⚠️ 必须复位 submitting：否则从通知设置页返回后提交按钮一直是 disabled 态点不动 */
          this.setData({ submitting: false });
          wx.showModal({
            title: '提醒额度不足',
            content: `本次要设 ${needed} 条提醒，当前只拿到 ${needed - r.shortfall} 条授权，可能有 ${r.shortfall} 条收不到。建议先去通知设置补齐。`,
            confirmText: '去补额度',
            cancelText: '直接提交',
            success: m => {
              if (m.confirm) {
                wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
              } else {
                /* 直接提交：submitTask 内部会自己 showLoading */
                this.setData({ submitting: true });
                doSubmit();
              }
            },
          });
          return;
        }
        doSubmit();
      });
    });
  },

  /**
   * 本次提交需要的订阅额度 = 「将设提醒的清单项数 × 提前量个数」。
   * - 任务数 = 清单里「需预约且勾了提醒」的项数（云端 submit 只给这些项建任务）
   * - 每条任务按 offsets 逐个发消息（notifier 的 collectDue），所以提前量几个就要几条额度
   * ⚠️ 不要退回成只算 offsets.length —— 清单里 6 个景点时只补 1 条，第 2 条起全部 43101「未送达」（2026-09-16 踩过）。
   * 清单查询失败时降级为只算提前量（额度不足由 43101 自愈与提交流程兜底，不阻断提交）。
   */
  loadNeededQuota() {
    const { tripId, offsets } = this.data;
    const perTask = Math.max(1, offsets.length);
    return api.reminder.cart.list(tripId)
      .then(res => {
        const count = (res && res.summary && res.summary.reminderCount) || 0;
        return count * perTask;
      })
      .catch(() => perTask);
  },

  submitTask({ tripId, channelList, offsets }) {
    wx.showLoading({ title: '正在提交...' });
    api.reminder.cart.commit({ tripId, channels: channelList, offsets }).then(res => {
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
      const toast = res.createdTasks > 0
        ? (res.noReminder > 0 ? '已加入行程，提醒也设置好了' : '提醒已设置，放票前见')
        : '已加入行程';
      wx.showToast({ title: toast, icon: 'none' });
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
