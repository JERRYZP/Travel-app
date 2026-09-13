const api = require('./api.js');

/**
 * 通知授权状态工具 —— profile 三态文案 / 通知设置内页 / 设置提醒页就地授权 共用
 *
 * 两个前置授权项（缺一收不到提醒）：
 *   ① 微信系统通知权限  wx.getAppAuthorizeSetting().notificationAuthorized / notificationEnabled
 *   ② 小程序订阅消息授权  wx.getSetting().authSetting['scope.subscribeMessage']
 */

// 订阅消息模板注册表：与 cloudfunctions/notifier 的兜底常量保持一致。
// 目前业务只用「放票提醒」一个模板，但底层按 templateId 记账，后续加模板不需要改协议。
const SUBSCRIBE_TEMPLATES = Object.freeze([
  {
    key: 'spot-release',
    name: '放票提醒',
    description: '放票前通知你，提醒你及时去官方渠道抢票',
    templateId: 'w5e9AIVe2oDidseGOX74CG2Z1-r0ikQTpUQAELcM1nk',
  },
]);
const PRIMARY_SUBSCRIBE_TEMPLATE = SUBSCRIBE_TEMPLATES[0];
const SUBSCRIBE_TEMPLATE_ID = PRIMARY_SUBSCRIBE_TEMPLATE.templateId;

function templateIdOf(templateId) {
  return templateId || SUBSCRIBE_TEMPLATE_ID;
}

/** ① 系统通知权限：同步 API，老基础库不可用时按未开启处理 */
function getSystemNotifyOk() {
  if (!wx.getAppAuthorizeSetting) return false;
  const s = wx.getAppAuthorizeSetting();
  // notificationAuthorized: 'authorized' | 'denied' | 'not determined'；notificationEnabled: Boolean
  return s.notificationAuthorized === 'authorized' && s.notificationEnabled !== false;
}

/**
 * 聚合状态
 * @returns Promise<{ systemOk, subscribeOk, doneCount, state: 'all'|'partial'|'none' }>
 */
function getNotifyStatus(templateId) {
  const tpl = templateIdOf(templateId);
  const systemOk = getSystemNotifyOk();
  return new Promise(resolve => {
    wx.getSetting({
      withSubscriptions: true,
      success: res => {
        // scope.subscribeMessage 在多数微信版本恒为 undefined（订阅消息不是标准 scope，
        // wx.authorize 对它无效），不能作唯一判据；用「勾过总是保持」或「剩余额度>0」兜底
        const scopeOk = !!(res.authSetting && res.authSetting['scope.subscribeMessage']);
        if (scopeOk || hasRememberedSubscribe(res, tpl)) {
          resolve(buildStatus(systemOk, true));
          return;
        }
        const remembered = rememberedSubscribeValue(res, tpl);
        if (remembered === 'reject' || remembered === 'ban') {
          resolve(buildStatus(systemOk, false));
          return;
        }
        getSubscribeQuota(tpl).then(r => {
          resolve(buildStatus(systemOk, r.ok && r.quota > 0));
        });
      },
      fail: () => resolve(buildStatus(systemOk, false)),
    });
  });
}

/** 读取模板持久订阅状态：accept/acceptWithAudio/true 才算允许，reject/ban 不能算已授权 */
function rememberedSubscribeValue(getSettingRes, templateId) {
  const tpl = templateIdOf(templateId);
  const item = getSettingRes.subscriptionsSetting && getSettingRes.subscriptionsSetting.itemSettings;
  return item && item[tpl];
}

function hasRememberedSubscribe(getSettingRes, templateId) {
  const value = rememberedSubscribeValue(getSettingRes, templateId);
  return value === 'accept' || value === 'acceptWithAudio' || value === true;
}

function buildStatus(systemOk, subscribeOk) {
  const doneCount = (systemOk ? 1 : 0) + (subscribeOk ? 1 : 0);
  return {
    systemOk,
    subscribeOk,
    doneCount,
    state: doneCount === 2 ? 'all' : (doneCount === 1 ? 'partial' : 'none'),
  };
}

/** 打开系统通知权限设置（基础库 2.20.1+ 直达系统设置，失败降级小程序设置页） */
function openSystemNotifySetting() {
  if (wx.openAppAuthorizeSetting) {
    wx.openAppAuthorizeSetting({
      fail: () => wx.openSetting({}),
    });
  } else {
    wx.openSetting({});
  }
}

/**
 * 请求订阅消息授权（必须在用户手势回调内调用）
 * @returns Promise<{ ok: Boolean, reason?: string }>
 *   reason: 'template-not-ready' 模板未配置 / 'master-switch-off' 用户关了订阅消息总开关(20004) / 'request-failed' 其他失败
 */
function requestSubscribe(templateId) {
  const tpl = templateIdOf(templateId);
  return new Promise(resolve => {
    if (!tpl) {
      resolve({ ok: false, reason: 'template-not-ready' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tpl],
      success: res => {
        const value = res[tpl];
        const ok = value === 'accept';
        if (ok) {
          // 授权成功 → 云端 +1 一次性订阅额度（best-effort，不影响提交流程）
          api.reminder.subscribe.add(tpl).catch(() => {});
        }
        resolve({ ok, reason: ok ? undefined : (value === 'reject' ? 'rejected' : 'request-failed') });
      },
      fail: err => {
        // 20004 = 用户关闭了订阅消息总开关（微信设置-订阅消息），弹不出授权框，需引导去设置页开启
        if (err && err.errCode === 20004) {
          resolve({ ok: false, reason: 'master-switch-off' });
        } else {
          resolve({ ok: false, reason: 'request-failed' });
        }
      },
    });
  });
}

/**
 * 提交前确保本次任务的订阅额度（一次性订阅：1 次授权 = 可发 1 条）。
 * 只在「剩余额度不足本次需求」时才需要真弹授权窗：
 *  - 已勾「总是保持以上选择，不再询问」→ 微信不再弹窗，按记忆静默返回（照样攒额度，零打扰）
 *  - 未勾 → 弹系统授权窗
 *  剩余额度足够 → 既不弹也不调用。
 * @param {number} needed 本次提交需要的订阅消息条数（一般 = 提前量个数）
 * @returns Promise<{ ok: Boolean, reason?: string, called: Boolean, remembered: Boolean }>
 */
function ensureSubscribe(needed, templateId) {
  const tpl = templateIdOf(templateId);
  const enough = q => q >= needed;
  /* 额度不足：调用授权（未勾「总是保持」时微信会弹窗；勾过则静默返回） */
  const call = remembered => requestSubscribe(tpl).then(r => ({
    ok: r.ok,
    reason: r.reason,
    called: true,
    remembered,
  }));

  return new Promise(resolve => {
    wx.getSetting({
      withSubscriptions: true,
      success: res => {
        // 「总是保持」保持的是上一次选择，不能把 reject 当成可继续下发。
        const remembered = rememberedSubscribeValue(res, tpl);
        if (remembered === 'reject' || remembered === 'ban') {
          resolve({ ok: false, reason: 'subscription-disabled', called: false, remembered: true });
          return;
        }
        // 上一次选择为允许：调用不弹窗，尝试补充一次本期额度。
        if (hasRememberedSubscribe(res, tpl)) {
          call(true).then(resolve);
          return;
        }
        getSubscribeQuota(tpl).then(r => {
          if (r.ok && enough(r.quota)) {
            resolve({ ok: true, called: false, remembered: false });
          } else {
            call(false).then(resolve);
          }
        });
      },
      fail: () => {
        // getSetting 失败：退化为按额度判断
        getSubscribeQuota(tpl).then(r => {
          if (r.ok && enough(r.quota)) {
            resolve({ ok: true, called: false, remembered: false });
          } else {
            call(false).then(resolve);
          }
        });
      },
    });
  });
}

/** 查询某个模板的本地可发次数（用于通知设置页展示） */
function getSubscribeQuota(templateId) {
  const tpl = templateIdOf(templateId);
  return api.reminder.subscribe.get(tpl)
    .then(r => ({
      ok: true,
      quota: (r && r.quota) || 0,
      totalQuota: (r && r.totalQuota) || 0,
      quotas: (r && r.quotas) || {},
      templateId: tpl,
    }))
    .catch(() => ({ ok: false, quota: 0, totalQuota: 0, quotas: {}, templateId: tpl }));
}

/** 订阅消息总开关关闭/模板被拒收：引导去小程序设置页重新开启 */
function guideOpenSubscribeSetting(reason) {
  const rejected = reason === 'rejected' || reason === 'subscription-disabled';
  wx.showModal({
    title: rejected ? '订阅消息未允许' : '订阅消息已关闭',
    content: rejected
      ? '当前模板被拒收或仍保持“拒绝”选择，提醒将无法送达。现在去小程序设置里改为允许？'
      : '你在微信「设置-订阅消息」里关闭了订阅通知总开关，提醒将无法送达。现在去打开？',
    confirmText: '去设置',
    cancelText: '暂不',
    success: res => {
      if (res.confirm) wx.openSetting({});
    },
  });
}

module.exports = {
  SUBSCRIBE_TEMPLATES,
  SUBSCRIBE_TEMPLATE_ID,
  getSystemNotifyOk,
  getNotifyStatus,
  openSystemNotifySetting,
  requestSubscribe,
  ensureSubscribe,
  getSubscribeQuota,
  guideOpenSubscribeSetting,
};
