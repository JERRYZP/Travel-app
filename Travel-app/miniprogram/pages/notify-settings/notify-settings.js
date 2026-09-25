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
    quotaTone: 'off',
    pendingMessageCount: 0,
    replenishNeeded: 0,
    healthSummary: '',
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
    return notify.getReminderHealth(this.data.templateId).then(h => {
      const hasQuota = h.quota > 0;
      let quotaLabel = hasQuota ? '已授权' : (h.subscribeOk ? '已允许，待续收' : '未生效');
      let quotaTone = hasQuota ? 'ok' : 'off';
      if (h.quotaLevel === 'exhausted') { quotaLabel = '已用完'; quotaTone = 'off'; }
      else if (h.quotaLevel === 'short') { quotaLabel = '还差' + h.shortfall + '次'; quotaTone = 'off'; }
      else if (h.quotaLevel === 'low') { quotaLabel = '即将用完'; quotaTone = 'warn'; }

      let healthSummary = '当前没有待发送提醒，有新的提醒时会校验授权额度。';
      if (h.pendingMessageCount > 0) {
        if (h.quotaLevel === 'ready') {
          healthSummary = `未来还有 ${h.pendingMessageCount} 条提醒待发送，当前已授权 ${h.quota} 次，额度充足。`;
        } else {
          const target = h.pendingMessageCount + 1;
          healthSummary = `未来还有 ${h.pendingMessageCount} 条提醒待发送，当前已授权 ${h.quota} 次；建议补到 ${target} 次。`;
        }
      } else if (hasQuota) {
        healthSummary = `当前已授权 ${h.quota} 次；有新的放票提醒时会再次校验额度。`;
      }

      this.setData({
        systemOk: h.systemOk,
        subscribeOk: h.subscribeOk || hasQuota,
        subscribeQuota: h.quota,
        pendingMessageCount: h.pendingMessageCount,
        replenishNeeded: h.replenishNeeded,
        healthSummary,
        quotaLabel,
        quotaTone,
        loading: false,
      });
    });
  },

  onOpenSystem() {
    notify.openSystemNotifySetting();
  },

  onRequestSubscribe() {
    this.replenishSubscribe(1, 'single');
  },

  onReplenish() {
    /* 一次性补齐 N 次暂不对外开放；下一期接付费能力时恢复入口即可。 */
    this.replenishSubscribe(this.data.replenishNeeded, 'bulk');
  },

  replenishSubscribe(times, mode) {
    if (!this.data.templateReady) {
      wx.showToast({ title: '推送通道准备中，请稍后再试', icon: 'none' });
      return;
    }
    const want = Math.max(1, Number(times) || 1);
    /* 防连点：微信每次调用都会弹一次授权窗，狂点会连环弹窗（弹窗未关闭前的点击不算有效手势） */
    if (this.renewing) return;
    this.renewing = true;
    /* 兜底解锁：微信回调异常缺失时，不至于把按钮永久锁死 */
    const unlock = setTimeout(() => { this.renewing = false; }, 10000);
    notify.requestSubscribeBurst(want, this.data.templateId).then(res => {
      clearTimeout(unlock);
      this.renewing = false;
      this.refresh();
      if (res.ok) {
        let title = res.silent ? `已续收 ${res.added} 次（未弹窗）` : `已续收 ${res.added} 次`;
        if (res.shortfall > 0) title = `已续收 ${res.added} 次，还差 ${res.shortfall} 次`;
        else if (mode === 'bulk') title = res.silent ? `已补齐 ${res.added} 次（未弹窗）` : `已续收 ${res.added} 次`;
        wx.showToast({ title, icon: 'none' });
        /* 没勾过 → 这次是真弹了窗。趁用户刚有体感，提示一次「勾了以后就不用再点」，
           让后续「一次提交 N 条静默补满」能真的零弹窗（一辈子只提示一次） */
        if (!res.silent) notify.hintKeepAlwaysChoice(this.data.templateId);
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
