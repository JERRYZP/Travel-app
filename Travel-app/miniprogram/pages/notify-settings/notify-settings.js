const app = getApp();
const notify = require('../../utils/notify.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    systemOk: false,
    subscribeOk: false,
    templateReady: false,
    templateId: '',
    templateName: '放票提醒',
    templateDesc: '放票前通知你',
    subscribeQuota: 0,
    quotaLabel: '未生效',
    loading: true,
  },

  onLoad() {
    const g = app.globalData;
    const template = notify.SUBSCRIBE_TEMPLATES[0] || {};
    /* 续收请求进行中标记（不参与渲染，只用于防连点，故不放进 data） */
    this.renewing = false;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      templateReady: !!template.templateId,
      templateId: template.templateId || '',
      templateName: template.name || '放票提醒',
      templateDesc: template.description || '放票前通知你',
    });
  },

  onShow() {
    this.refresh();
  },

  /* 从系统设置 / 授权框返回时刷新状态 */
  refresh() {
    Promise.all([
      notify.getNotifyStatus(this.data.templateId),
      notify.getSubscribeQuota(this.data.templateId),
    ]).then(([s, q]) => {
      const hasQuota = q.quota > 0;
      this.setData({
        systemOk: s.systemOk,
        subscribeOk: s.subscribeOk || hasQuota,
        subscribeQuota: q.quota,
        quotaLabel: hasQuota ? `可提醒 ${q.quota} 次` : (s.subscribeOk ? '已允许，待续收' : '未生效'),
        loading: false,
      });
    });
  },

  onOpenSystem() {
    notify.openSystemNotifySetting();
  },

  onRequestSubscribe() {
    if (!this.data.templateReady) {
      wx.showToast({ title: '推送通道准备中，请稍后再试', icon: 'none' });
      return;
    }
    /* 防连点：微信每次调用都会弹一次授权窗，狂点会连环弹窗（弹窗未关闭前的点击不算有效手势） */
    if (this.renewing) return;
    this.renewing = true;
    /* 兜底解锁：微信回调异常缺失时，不至于把按钮永久锁死 */
    const unlock = setTimeout(() => { this.renewing = false; }, 10000);
    notify.requestSubscribeBurst(1, this.data.templateId).then(res => {
      clearTimeout(unlock);
      this.renewing = false;
      this.refresh();
      if (res.ok) {
        /* silent = 用户勾过「总是保持以上选择」，微信这次没弹窗直接记账 */
        wx.showToast({ title: res.silent ? '已续收 1 次（未弹窗）' : '已续收 1 次', icon: 'none' });
      } else if (res.reason === 'master-switch-off' || res.reason === 'subscription-disabled') {
        /* 总开关关闭或模板保持拒绝：弹不出有效授权框，引导去设置页开启 */
        notify.guideOpenSubscribeSetting(res.reason);
      } else if (res.reason === 'banned') {
        wx.showToast({ title: '该模板已被微信限制，暂无法续收', icon: 'none' });
      } else if (res.reason === 'template-filtered') {
        wx.showToast({ title: '模板未通过微信校验，请稍后再试', icon: 'none' });
      } else if (res.reason === 'rejected') {
        /* 用户在授权窗里点了取消：只做轻提示，不再追加弹窗（刚被拒就弹设置引导太打扰） */
        wx.showToast({ title: '已取消，本次未增加额度', icon: 'none' });
      } else {
        wx.showToast({ title: '未完成授权，提醒可能收不到', icon: 'none' });
      }
    });
  },

  onOpenSubscribeSetting() {
    wx.openSetting({});
  },

  onBack() {
    wx.navigateBack();
  },
});
