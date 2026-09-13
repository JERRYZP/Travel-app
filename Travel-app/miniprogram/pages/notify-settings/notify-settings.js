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
    notify.requestSubscribe(this.data.templateId).then(res => {
      this.refresh();
      if (res.ok) {
        wx.showToast({ title: '已增加 1 次提醒额度', icon: 'none' });
      } else if (res.reason === 'master-switch-off' || res.reason === 'rejected') {
        /* 总开关关闭或模板保持拒绝：弹不出有效授权框，引导去设置页开启 */
        notify.guideOpenSubscribeSetting(res.reason);
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
