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
    templateId: 'V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q',
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
 * 微信授权结果里只有 accept / acceptWithAudio 算「允许」。
 * acceptWithAudio = 用户同时勾了「接收语音提醒」（iOS 上部分模板会出现），不能当成失败。
 */
function isAcceptedValue(value) {
  return value === 'accept' || value === 'acceptWithAudio';
}

/** 授权结果 → 内部 reason，便于页面给准确文案（reject / ban / filter 含义完全不同） */
function reasonOfValue(value) {
  if (isAcceptedValue(value)) return undefined;
  if (value === 'reject') return 'rejected';
  if (value === 'ban') return 'banned';
  if (value === 'filter') return 'template-filtered';
  return 'request-failed';
}

/**
 * 请求订阅消息授权（必须在用户手势回调内调用）
 * @returns Promise<{ ok: Boolean, reason?: string, value?: string }>
 *   reason: 'template-not-ready' 模板未配置 / 'master-switch-off' 用户关了订阅消息总开关(20004)
 *         / 'rejected' 用户点了取消 / 'banned' 模板被封禁 / 'template-filtered' 模板同名被后台过滤
 *         / 'request-failed' 其他失败
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
        const ok = isAcceptedValue(value);
        if (ok) {
          // 授权成功 → 云端 +1 一次性订阅额度（best-effort，不影响提交流程）
          api.reminder.subscribe.add(tpl).catch(() => {});
        }
        resolve({ ok, reason: ok ? undefined : reasonOfValue(value), value });
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

// 一次点击最多连发几次授权（只在「总是保持以上选择」已生效时才会连发，防止无上限刷额度）
const MAX_BURST = 5;
// 连发之间的间隔，给微信客户端留出处理时间
const BURST_INTERVAL = 120;

/**
 * 连发订阅授权。
 * ⚠️ 微信规则：`wx.requestSubscribeMessage` 一次调用 = 一次授权 = 1 条额度，要攒 N 条只能调 N 次。
 * 弹窗是否出现，取决于用户有没有勾过「总是保持以上选择，不再询问」：
 *  - 勾过 → 微信不再弹窗，静默按「允许」记账，连发多少次都零打扰（可安全补齐缺口）
 *  - 没勾 → **每次调用必弹一次窗**（小程序端无法绕过），因此最多只调 1 次，绝不连环弹窗骚扰用户
 * @param {number} times 目标次数（1~MAX_BURST）
 * @returns Promise<{ ok, added, called, silent, shortfall, reason? }>
 *   added = 实际拿到的额度条数；shortfall = 还差几条；silent = 本次调用是否全程没弹窗
 */
function requestSubscribeBurst(times, templateId) {
  const tpl = templateIdOf(templateId);
  const target = Math.max(1, Math.min(Number(times) || 1, MAX_BURST));
  return new Promise(resolve => {
    wx.getSetting({
      withSubscriptions: true,
      success: res => {
        // 「总是保持」保持的是上一次选择，reject/ban 不能当成可继续下发
        const remembered = rememberedSubscribeValue(res, tpl);
        if (remembered === 'reject' || remembered === 'ban') {
          resolve({ ok: false, added: 0, called: false, silent: false, shortfall: target, reason: 'subscription-disabled' });
          return;
        }
        fireBurst(target, tpl, hasRememberedSubscribe(res, tpl), resolve);
      },
      fail: () => fireBurst(target, tpl, false, resolve),
    });
  });
}

/** 串行连发：静默时发满 target 次，未勾「总是保持」时只发 1 次（弹窗躲不掉，不能连环弹） */
function fireBurst(target, tpl, silent, resolve) {
  const rounds = silent ? target : 1;
  let added = 0;
  let reason;
  const step = i => {
    requestSubscribe(tpl).then(r => {
      if (r.ok) {
        added += 1;
      } else if (!reason) {
        reason = r.reason;
      }
      if (i + 1 >= rounds) {
        resolve({
          ok: added > 0,
          added,
          called: true,
          silent,
          shortfall: Math.max(0, target - added),
          reason: added > 0 ? undefined : reason,
        });
        return;
      }
      setTimeout(() => step(i + 1), BURST_INTERVAL);
    });
  };
  step(0);
}

/**
 * 提交前确保本次任务的订阅额度（一次性订阅：1 次授权 = 可发 1 条）。
 * 只在「剩余额度不足本次需求」时才真弹授权窗：
 *  - 剩余额度足够 → 既不弹也不调用
 *  - 已勾「总是保持以上选择，不再询问」→ 微信不弹窗，按缺口静默补齐
 *  - 未勾 → 微信每次调用必弹窗，因此最多只弹 1 次，缺口由 shortfall 回报给页面提示用户去续收
 * @param {number} needed 本次提交需要的订阅消息条数（一般 = 提前量个数）
 * @returns Promise<{ ok, reason?, called, remembered, added, shortfall }>
 */
function ensureSubscribe(needed, templateId) {
  const tpl = templateIdOf(templateId);
  const want = Math.max(1, Number(needed) || 1);
  return getSubscribeQuota(tpl).then(r => {
    const quota = r.ok ? r.quota : 0;
    const gap = want - quota;
    if (gap <= 0) {
      return { ok: true, called: false, remembered: false, added: 0, shortfall: 0 };
    }
    return requestSubscribeBurst(gap, tpl).then(b => ({
      ok: b.ok,
      reason: b.reason,
      called: b.called,
      remembered: b.silent,
      added: b.added,
      shortfall: b.shortfall,
    }));
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
  requestSubscribeBurst,
  ensureSubscribe,
  getSubscribeQuota,
  guideOpenSubscribeSetting,
};
