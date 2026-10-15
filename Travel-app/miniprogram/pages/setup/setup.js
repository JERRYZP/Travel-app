const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');
const oa = require('../../utils/official-account.js');

/** 成功卡片自动返回首页的秒数；倒计时文案同步走弱化提示 */
const AUTO_BACK_SECONDS = 4;

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
    quotaNeeded: 0,
    subscribeQuota: 0,
    shortfall: 0,
    systemOk: false,
    accessReady: false,
    canSubmit: false,
    gateText: '正在检查提醒权限',
    submitting: false,
    showSampleSheet: false,
    /* 成功态：轻量卡片替代原来的 toast，卡片里只留一行公众号入口 */
    showSuccess: false,
    successTitle: '',
    oaEntryText: oa.SETUP_ENTRY,
    successCountdown: AUTO_BACK_SECONDS,
    showOaSheet: false,
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
    this.loadCartAndAccess();
  },

  loadCartAndAccess() {
    return api.reminder.cart.list().then(res => {
      const reminderCount = (res && res.summary && res.summary.reminderCount) || 0;
      const quotaNeeded = reminderCount * this.data.offsets.length;
      this.setData({ reminderCount, quotaNeeded });
      return this.refreshAccessState(quotaNeeded);
    }).catch(() => this.refreshAccessState(this.data.quotaNeeded));
  },

  refreshAccessState(needed) {
    const want = typeof needed === 'number' ? needed : this.data.quotaNeeded;
    return notify.getReminderHealth().then(health => {
      const subscribeQuota = health.quota || 0;
      const shortfall = Math.max(0, want - subscribeQuota);
      const hasChannel = this.data.channels.officialAccount === true;
      const accessReady = health.systemOk && shortfall === 0 && want > 0;
      const canSubmit = accessReady && hasChannel;
      let gateText = '';
      if (!hasChannel) gateText = '请选择微信通知提醒';
      else if (!health.systemOk) gateText = '请先开启微信通知权限';
      else if (shortfall > 0) gateText = '还差 ' + shortfall + ' 次授权，补齐后才能开启提醒';
      else if (want === 0) gateText = '当前没有需要提醒的景点';
      this.setData({
        quotaNeeded: want,
        systemOk: health.systemOk,
        subscribeQuota,
        shortfall,
        accessReady,
        canSubmit,
        gateText,
      });
    });
  },

  onToggleChannel(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'sms') return;
    const channels = Object.assign({}, this.data.channels);
    channels[key] = !channels[key];
    this.setData({ channels }, () => this.refreshAccessState(this.data.quotaNeeded));
  },

  /* 提前量单选：5 分钟 / 2 分钟二选一（一次性订阅消息按条授权，一条任务只发一条提醒） */
  onToggleOffset(e) {
    const val = Number(e.currentTarget.dataset.val);
    const quotaNeeded = this.data.reminderCount * 1;
    this.setData({
      offsets: [val],
      checkedOffset5: val === 5,
      checkedOffset2: val === 2,
      quotaNeeded,
    }, () => this.refreshAccessState(quotaNeeded));
  },

  onOpenSystem() {
    notify.openSystemNotifySetting();
  },

  /** 硬闸门：额度不足时只能由用户点击补齐，不能由提交动作自动代替。 */
  onFillQuota() {
    const shortfall = Math.max(0, this.data.shortfall || 0);
    if (shortfall <= 0) return;
    if (!this.data.systemOk) {
      this.onOpenSystem();
      return;
    }
    wx.showLoading({ title: '正在申请授权...' });
    /* 微信一次性订阅：一次点击最多完成一次授权调用，也就是最多 +1 条。
       “总是保持”只免去后续弹窗，不会让一次点击批量增加同模板额度。 */
    return notify.requestSubscribeBurst(1).then(res => {
      wx.hideLoading();
      return this.refreshAccessState(this.data.quotaNeeded).then(() => {
        if (res.ok) {
          const left = Math.max(0, this.data.shortfall || 0);
          wx.showToast({
            title: left > 0 ? ('已补齐 ' + res.added + ' 次，还差 ' + left + ' 次') : '授权已补齐',
            icon: 'none',
          });
          if (!res.silent && !res.remembered) notify.hintKeepAlwaysChoice();
          return;
        }
        if (res.reason === 'master-switch-off' || res.reason === 'subscription-disabled') {
          notify.guideOpenSubscribeSetting(res.reason);
        } else if (res.reason === 'rejected') {
          wx.showToast({ title: '已取消，本次未增加授权', icon: 'none' });
        } else if (res.reason === 'banned') {
          wx.showToast({ title: '该模板已被微信限制，暂无法补齐', icon: 'none' });
        } else {
          console.warn('[setup] fill quota failed', res);
          wx.showToast({ title: '授权未完成，请重试', icon: 'none' });
        }
      });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '授权未完成，请重试', icon: 'none' });
    });
  },

  onOpenSample() { this.setData({ showSampleSheet: true }); },
  onCloseSample() { this.setData({ showSampleSheet: false }); },

  onSubmit() {
    const { channels, offsets } = this.data;
    if (!channels.officialAccount) {
      wx.showToast({ title: '请选择微信通知提醒', icon: 'none' });
      return;
    }
    if (!this.data.systemOk) {
      wx.showToast({ title: '请先开启微信通知权限', icon: 'none' });
      this.onOpenSystem();
      return;
    }
    if (this.data.shortfall > 0) {
      wx.showToast({ title: '请先补齐 ' + this.data.shortfall + ' 次授权', icon: 'none' });
      return;
    }
    if (this.data.quotaNeeded <= 0) {
      this.submitTask({ channelList: ['OFFICIAL_ACCOUNT'], offsets });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交...' });
    this.submitTask({ channelList: ['OFFICIAL_ACCOUNT'], offsets });
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
      /* ⚠️ `needsOaAuth` 是**景点官方公众号**渠道的字段，与本页的自有公众号入口无关：
         前者尚未打通、继续由接口保留，本页不展示关注引导；后者是自己账号的攻略入口，
         只借成功态留一行，不做关注拦截。 */
      let title;
      if (disableReminders) {
        title = '已加入行程，未设置提醒';
      } else if ((res.expiredReminder || 0) > 0) {
        /* 勾了提醒、但放票时刻在提交前已经过去 —— 服务端这类项照常落行程项、
           不再建任务（见 lib/task.js）。文案由前端生成，服务端那句同义的 toast
           在 PAGE-008 这条路径上没有出口。
           ⚠️ 必须排在 createdTasks > 0 之前判断：过期项同时计入 noReminder，
              排在后面会掉进「提醒已设置」分支，等于告诉用户提醒设上了，而实际没设。 */
        title = `已加入行程 · ${res.expiredReminder} 项已过放票时间，提醒无法设置`;
      } else if (res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip()) {
        title = '提醒已设置，先备好游客信息';
      } else {
        title = res.createdTasks > 0
          ? '提醒已设置，放票前见'
          : '行程已添加，未设置提醒';
      }
      /* 成功反馈改成卡片（原来是 toast）：卡片里那一行公众号入口需要能被点到，
         toast 上放不了可点元素。默认停 4 秒，角上有主动关闭，底部给弱化的倒计时提示。
         ⚠️ 自动返回与倒计时要在用户点开二维码时一起取消（见 onSuccessOa），
            否则读二维码读到一半会被弹走。 */
      this.setData({ showSuccess: true, successTitle: title, successCountdown: AUTO_BACK_SECONDS });
      this._backTimer = setTimeout(() => this.goHome(), AUTO_BACK_SECONDS * 1000);
      this._countdownTimer = setInterval(() => {
        const left = this.data.successCountdown - 1;
        /* 归零这一拍就交给 _backTimer，别再 setData 出「0 秒后返回」 */
        if (left <= 0) {
          this.clearAutoBack();
          return;
        }
        this.setData({ successCountdown: left });
      }, 1000);
      /* 提交是唯一创建行程的时机，tripId 这一刻才有 —— 写给首页定位用。
         纯预览化后「生成时间线」不再建行程，所以不能更早写。
         ⚠️ 这里**必须无条件写**（只要拿到 tripId）。原先假设「从添加提醒进来的
            路径上 add-trip 会自己写」，但下方 navigateBack 会把 add-trip 从页面栈
            里弹掉，它拿不到这次返回值，那个假设不成立——两边都不写就没人写了。
            （当前 `currentTripId` 全项目无人读取，所以此前没暴露成用户可见问题。） */
      if (res.tripId) app.globalData.currentTripId = res.tripId;
      app.globalData.reminderSubmitted = true;
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      api.toastError(err);
    });
  },

  /** 回首页：兼容 首页→设置（内联生成）与 首页→添加提醒→设置 两种栈深 */
  goHome() {
    this.clearAutoBack();
    const pages = getCurrentPages();
    const homeIdx = pages.findIndex(p => p.route === 'pages/home/home');
    const delta = homeIdx >= 0 ? pages.length - 1 - homeIdx : 1;
    wx.navigateBack({ delta });
  },

  /** 取消自动返回与倒计时：主动关闭、打开二维码、离开页面时都要清 */
  clearAutoBack() {
    if (this._backTimer) {
      clearTimeout(this._backTimer);
      this._backTimer = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  /** 点卡片外任意处 = 立刻回首页，不等自动跳转 */
  onSuccessSkip() {
    this.goHome();
  },

  /** 成功态里的公众号入口：留入口但不拦路 —— 只在这里打开二维码 */
  onSuccessOa() {
    this.clearAutoBack();
    this.setData({ showOaSheet: true });
  },

  onCloseOaSheet() {
    this.setData({ showOaSheet: false });
    /* 看完二维码直接回首页，不用再点一次 */
    this.goHome();
  },

  onBack() {
    this.clearAutoBack();
    wx.navigateBack();
  },

  /* 成功卡片的空处理：拦掉冒泡与背景滚动 */
  noop() {},

  onUnload() {
    this.clearAutoBack();
  },
});
