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
    templateName: '预约开始提醒',
    templateDesc: '预约开启前通知你',
    subscribeQuota: 0,
    availableQuota: 0,
    reservedQuota: 0,
    quotaLabel: '未生效',
    quotaTone: 'off',
    pendingMessageCount: 0,
    replenishNeeded: 0,
    healthSummary: '',
    authFeedback: '',
    authFeedbackTone: '',
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
      templateName: template.name || '预约开始提醒',
      templateDesc: template.description || '预约开启前通知你',
    });
  },

  onShow() {
    /* 与 PAGE-008 同一口径：授权结果要留在页面上，直到下一次用户动作覆盖。
       从微信设置页返回也会触发 onShow，这里清空会让拒绝/未同步结果只剩 Toast。 */
    this.refresh();
  },

  /* 从系统设置 / 授权框返回时刷新状态 */
  refresh() {
    return notify.getReminderHealth(this.data.templateId).then(h => {
      const ledgerQuota = Math.max(0, Number(h.quota) || 0);
      const availableQuota = Number.isFinite(h.availableQuota) ? h.availableQuota : ledgerQuota;
      const reservedQuota = Math.max(0, ledgerQuota - availableQuota);
      const hasQuota = ledgerQuota > 0;
      let quotaLabel = hasQuota ? '已授权' : (h.subscribeOk ? '已允许，待续收' : '未生效');
      let quotaTone = hasQuota ? 'ok' : 'off';
      if (h.quotaLevel === 'exhausted') { quotaLabel = '已用完'; quotaTone = 'off'; }
      else if (h.quotaLevel === 'short') { quotaLabel = '还差' + h.shortfall + '次'; quotaTone = 'off'; }
      else if (h.quotaLevel === 'low') { quotaLabel = '即将用完'; quotaTone = 'warn'; }

      let healthSummary = '当前没有待发送提醒，有新的提醒时会校验授权额度。';
      if (h.pendingMessageCount > 0) {
        if (h.quotaLevel === 'ready') {
          healthSummary = `未来还有 ${h.pendingMessageCount} 条提醒待发送；当前已授权 ${ledgerQuota} 次，其中 ${reservedQuota} 次已被占用，可用 ${availableQuota} 次。`;
        } else {
          const target = h.pendingMessageCount + 1;
          healthSummary = `未来还有 ${h.pendingMessageCount} 条提醒待发送；当前已授权 ${ledgerQuota} 次，其中 ${reservedQuota} 次已被占用，可用 ${availableQuota} 次；建议补到 ${target} 次。`;
        }
      } else if (hasQuota) {
        healthSummary = `当前已授权 ${ledgerQuota} 次，可用 ${availableQuota} 次；有新的放票提醒时会再次校验额度。`;
      }

      this.setData({
        systemOk: h.systemOk,
        subscribeOk: h.subscribeOk || hasQuota,
        subscribeQuota: ledgerQuota,
        availableQuota,
        reservedQuota,
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
    const beforeLedger = Math.max(0, Number(this.data.subscribeQuota) || 0);
    const beforeAvailable = Math.max(0, Number(this.data.availableQuota) || 0);
    notify.requestSubscribeBurst(want, this.data.templateId).then(res => {
      clearTimeout(unlock);
      return this.refresh().then(() => {
        this.renewing = false;
        const ledgerGain = Math.max(0, (Number(this.data.subscribeQuota) || 0) - beforeLedger);
        const availableGain = Math.max(0, (Number(this.data.availableQuota) || 0) - beforeAvailable);
        const left = Math.max(0, Number(this.data.replenishNeeded) || 0);
        if (res.ok && ledgerGain > 0 && availableGain > 0) {
          let title = `已续收 ${res.added} 次`;
          if (left > 0) title = `已续收 ${res.added} 次，还差 ${left} 次`;
          else if (mode === 'bulk') title = `已续收 ${res.added} 次`;
          this.setData({
            authFeedback: left > 0 ? `已续收 ${res.added} 次，当前可用 ${this.data.availableQuota} 次，还差 ${left} 次。` : `授权已续收，当前可用 ${this.data.availableQuota} 次。`,
            authFeedbackTone: 'ok',
          });
          wx.showToast({ title, icon: 'none' });
          /* 没勾过 → 这次是真弹了窗。趁用户刚有体感，提示一次「勾了以后就不用再点」，
             让后续「一次提交 N 条静默补满」能真的零弹窗（一辈子只提示一次） */
          if (!res.silent && !res.remembered) notify.hintKeepAlwaysChoice(this.data.templateId);
          return;
        }
        if (res.ok && ledgerGain > 0) {
          const reserved = Math.max(0, Number(this.data.reservedQuota) || 0);
          const feedback = reserved > 0
            ? `已续收 ${res.added} 次，但已被 ${reserved} 条待发送提醒占用，当前可用 ${this.data.availableQuota} 次。`
            : '授权已到账，但暂未转化为可用额度，请稍后重试。';
          this.setData({ authFeedback: feedback, authFeedbackTone: 'warn' });
          wx.showToast({
            title: reserved > 0 ? '已续收，但被待发送提醒占用' : '额度暂未同步，请稍后重试',
            icon: 'none',
          });
          return;
        }
        if (res.ok) {
          this.setData({ authFeedback: '授权已提交，额度暂未同步，请稍后重试。', authFeedbackTone: 'warn' });
          wx.showToast({ title: '额度暂未同步，请稍后重试', icon: 'none' });
          return;
        }
        let feedback = '未完成授权，请重试。';
        if (res.reason === 'master-switch-off' || res.reason === 'subscription-disabled') {
          feedback = '订阅授权未开启，请到微信授权设置中改为允许后再试。';
          notify.guideOpenSubscribeSetting(res.reason);
        } else if (res.reason === 'banned') {
          feedback = '该模板已被微信限制，暂时无法续收。';
          wx.showToast({ title: '该模板已被微信限制，暂无法续收', icon: 'none' });
        } else if (res.reason === 'template-filtered') {
          feedback = '模板未通过微信校验，请稍后再试。';
          wx.showToast({ title: '模板未通过微信校验，请稍后再试', icon: 'none' });
        } else if (res.reason === 'rejected') {
          feedback = '本次未授权，额度没有增加。';
          wx.showToast({ title: '已取消，本次未增加额度', icon: 'none' });
        } else {
          wx.showToast({ title: '未完成授权，提醒可能收不到', icon: 'none' });
        }
        this.setData({ authFeedback: feedback, authFeedbackTone: 'warn' });
      });
    }).catch(() => {
      clearTimeout(unlock);
      this.renewing = false;
      this.setData({ authFeedback: '授权未完成，请重试。', authFeedbackTone: 'warn' });
      wx.showToast({ title: '授权未完成，请重试', icon: 'none' });
    });
  },

  onOpenSubscribeSetting() {
    wx.openSetting({});
  },

  onBack() {
    wx.navigateBack();
  },
});
