const api = require('./api.js');

/**
 * 通知授权状态工具 —— profile 三态文案 / 通知设置内页 / 设置提醒页就地授权 共用
 *
 * 两个前置授权项（缺一收不到提醒）：
 *   ① 微信系统通知权限  wx.getAppAuthorizeSetting().notificationAuthorized / notificationEnabled
 *   ② 小程序订阅消息授权  wx.getSetting().authSetting['scope.subscribeMessage']
 */

// 订阅消息模板 ID：微信公众平台申请后回填（与 cloudfunctions/notifier 的 SUBSCRIBE_TEMPLATE_ID 对齐）。
// 为空时推送通道不可用，授权按钮置灰「通道准备中」，避免用户授权了个寂寞。
const SUBSCRIBE_TEMPLATE_ID = 'w5e9AIVe2oDidseGOX74CG2Z1-r0ikQTpUQAELcM1nk';

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
function getNotifyStatus() {
  const systemOk = getSystemNotifyOk();
  return new Promise(resolve => {
    wx.getSetting({
      success: res => {
        const subscribeOk = !!(res.authSetting && res.authSetting['scope.subscribeMessage']);
        resolve(buildStatus(systemOk, subscribeOk));
      },
      fail: () => resolve(buildStatus(systemOk, false)),
    });
  });
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
 */
function requestSubscribe() {
  return new Promise(resolve => {
    if (!SUBSCRIBE_TEMPLATE_ID) {
      resolve({ ok: false, reason: 'template-not-ready' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: res => {
        const ok = res[SUBSCRIBE_TEMPLATE_ID] === 'accept';
        if (ok) {
          // 授权成功 → 云端 +1 一次性订阅额度（best-effort，不影响提交流程）
          api.reminder.subscribe.add(SUBSCRIBE_TEMPLATE_ID).catch(() => {});
        }
        resolve({ ok });
      },
      fail: () => resolve({ ok: false, reason: 'request-failed' }),
    });
  });
}

/** 查询剩余一次性订阅额度（用于通知设置页展示） */
function getSubscribeQuota() {
  return api.reminder.subscribe.get(SUBSCRIBE_TEMPLATE_ID)
    .then(r => ({ ok: true, quota: (r && r.quota) || 0 }))
    .catch(() => ({ ok: false, quota: 0 }));
}

module.exports = {
  SUBSCRIBE_TEMPLATE_ID,
  getNotifyStatus,
  openSystemNotifySetting,
  requestSubscribe,
  getSubscribeQuota,
};
