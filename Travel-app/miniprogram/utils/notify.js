const api = require('./api.js');

/**
 * 提醒授权状态工具 —— profile 状态文案 / 提醒设置内页 / 设置提醒页就地授权 共用
 *
 * 两个前置授权项（缺一收不到提醒）：
 *   ① 微信系统通知权限  wx.getAppAuthorizeSetting().notificationAuthorized / notificationEnabled
 *   ② 小程序订阅消息授权  wx.getSetting().authSetting['scope.subscribeMessage']
 */

// 订阅消息模板注册表：与 cloudfunctions/notifier 的兜底常量保持一致。
// 目前业务只用「预约开始提醒」一个模板，但底层按 templateId 记账，后续加模板不需要改协议。
const SUBSCRIBE_TEMPLATES = Object.freeze([
  {
    key: 'spot-release',
    name: '预约开始提醒',
    description: '预约开启前通知你，提醒你及时去官方渠道预约',
    templateId: '_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA',
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
 *         / 'account-failed' 微信已允许但云端额度落账失败 / 'request-failed' 其他失败
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
          /* 授权成功 → 等云端 +1 落账后再返回。否则调用方马上 subscribe.get
             会读到旧余额，用户明明刚授权却看到“还差 1 次”，被迫再点一遍。 */
          api.reminder.subscribe.add(tpl)
            .then(() => resolve({ ok: true, value }))
            .catch(error => {
              console.error('[subscribe] subscribe.add failed', { templateId: tpl, error });
              resolve({ ok: false, reason: 'account-failed', value, error });
            });
          return;
        }
        const reason = reasonOfValue(value);
        console.warn('[subscribe] requestSubscribeMessage non-accept', { templateId: tpl, value, reason });
        resolve({ ok: false, reason, value });
      },
      fail: err => {
        console.error('[subscribe] requestSubscribeMessage fail', {
          templateId: tpl,
          errCode: err && err.errCode,
          errMsg: err && (err.errMsg || err.message),
        });
        // 20004 = 用户关闭了订阅消息总开关（微信设置-订阅消息），弹不出授权框，需引导去设置页开启
        if (err && err.errCode === 20004) {
          resolve({ ok: false, reason: 'master-switch-off', errCode: err.errCode, errMsg: err.errMsg });
        } else {
          resolve({ ok: false, reason: 'request-failed', errCode: err && err.errCode, errMsg: err && err.errMsg });
        }
      },
    });
  });
}

/**
 * 申请一次订阅授权。
 *
 * ⚠️ 微信一次性订阅的原子约束：一次 `wx.requestSubscribeMessage` 调用只增加
 * 同一模板 1 条额度；用户要 N 条就必须产生 N 次独立授权动作。函数名
 * `requestSubscribeBurst` 是历史兼容名，`times` 只用于计算剩余缺口，不再连发。
 *
 * 「总是保持以上选择」的作用仅是下次调用不弹窗，不会让一次点击批量增加额度；
 * 把多次调用塞在同一个异步链里，第二次已脱离用户手势上下文，真机会被微信拒绝。
 *
 * @param {number} times 本次目标次数，用于计算 shortfall
 * @param {string} [templateId]
 * @returns Promise<{ ok, added, called, silent, shortfall, reason? }>
 *   added = 本次实际拿到的额度条数（0 或 1）；shortfall = 相对目标还差几条
 */
function requestSubscribeBurst(times, templateId) {
  const tpl = templateIdOf(templateId);
  const want = Math.max(1, Number(times) || 1);
  return new Promise(resolve => {
    wx.getSetting({
      withSubscriptions: true,
      success: res => {
        const remembered = rememberedSubscribeValue(res, tpl);
        if (remembered === 'reject' || remembered === 'ban') {
          resolve({
            ok: false,
            added: 0,
            called: false,
            silent: false,
            remembered: false,
            shortfall: want,
            reason: 'subscription-disabled',
          });
          return;
        }
        const silentlyAllowed = hasRememberedSubscribe(res, tpl);
        requestSubscribe(tpl).then(r => resolve({
          ok: r.ok,
          added: r.ok ? 1 : 0,
          called: true,
          silent: silentlyAllowed,
          remembered: silentlyAllowed,
          shortfall: Math.max(0, want - (r.ok ? 1 : 0)),
          reason: r.ok ? undefined : r.reason,
          errCode: r.errCode,
          errMsg: r.errMsg,
        }));
      },
      fail: () => requestSubscribe(tpl).then(r => resolve({
        ok: r.ok,
        added: r.ok ? 1 : 0,
        called: true,
        silent: false,
        remembered: false,
        shortfall: Math.max(0, want - (r.ok ? 1 : 0)),
        reason: r.ok ? undefined : r.reason,
        errCode: r.errCode,
        errMsg: r.errMsg,
      })),
    });
  });
}

/**
 * 提交前确保本次提交所需的订阅额度。
 *
 * ⚠️ 需求量的正确算法 = 「将设提醒的清单项数 × 提前量个数」：
 *   - 任务数 = 清单里「需预约且勾了提醒」的项数（`reminder/lib/task.js` 的 submit 只给这些项建任务）
 *   - 每条任务按 offsets 逐个发消息（`notifier` 的 collectDue），所以提前量几个就要几条额度
 *   ⚠️ 历史 bug（2026-09-16 修正）：调用方曾传 `offsets.length`（只算了提前量），
 *   清单里 6 个景点时也只补 1 条，导致第 2 条起全部 43101「未送达」。
 *
 * 只在「剩余额度不足本次需求」时申请一次：
 *  - 剩余额度足够 → 既不弹也不调用
 *  - 不足 → 一次用户动作最多增加 1 条，剩余缺口由 shortfall 回报给调用方
 * @param {number} needed 本次提交需要的订阅消息条数
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
      remembered: !!b.remembered,
      added: b.added,
      shortfall: b.shortfall,
    }));
  });
}

/**
 * 本次提交需要多少条订阅额度 = 当前清单将设提醒项数 × 每条任务的提前量个数。
 * 清单查询失败时按“至少一条任务”处理，避免静默跳过授权。
 */
function getReminderQuotaNeeded(perTask) {
  const taskCount = Math.max(1, Number(perTask) || 1);
  return api.reminder.cart.list()
    .then(res => {
      const count = (res && res.summary && res.summary.reminderCount) || 0;
      return count * taskCount;
    })
    .catch(() => taskCount);
}

/** 订阅授权不足时让用户明确选择：补授权、仅加行程或取消。 */
function showReminderAccessSheet(alertText, firstLabel) {
  return new Promise(resolve => {
    if (!wx.showActionSheet) {
      resolve({ choice: 'cancelled', reason: 'action-sheet-unavailable' });
      return;
    }
    wx.showActionSheet({
      alertText,
      itemList: [firstLabel, '仅加行程·不提醒', '取消'],
      success: res => {
        const idx = Number(res && res.tapIndex);
        resolve({
          choice: idx === 0 ? 'first' : (idx === 1 ? 'trip-only' : 'cancelled'),
        });
      },
      fail: () => resolve({ choice: 'cancelled' }),
    });
  });
}

/**
 * 用户明确选择“补授权并继续”后，才发起微信一次性订阅授权。
 * 这里不能再自动触发：轻量入口经过 cart.add / 查额度等多段异步后，
 * 直接 requestSubscribeMessage 既容易失去用户手势上下文，也让用户不知道为何弹窗。
 */
function completeSubscribeShortfall(shortfall, tpl, needed) {
  return requestSubscribeBurst(shortfall, tpl).then(r => {
    if (r.shortfall <= 0) {
      return { action: 'ready', needed, shortfall: 0, added: r.added, reason: r.reason };
    }
    if (r.reason === 'master-switch-off' || r.reason === 'subscription-disabled') {
      return {
        action: 'settings',
        settingsKind: 'subscribe',
        needed,
        shortfall: r.shortfall,
        added: r.added,
        reason: r.reason,
      };
    }
    return {
      action: 'cancelled',
      needed,
      shortfall: r.shortfall,
      added: r.added,
      reason: r.reason || 'quota-shortfall',
    };
  });
}

/**
 * 设置提醒前的统一闸门。返回结果由页面决定如何提交，不在工具层直接创建行程。
 *
 * 订阅额度不足时先说明“本次为什么需要授权”，等用户点“补授权并继续”
 * 再调用微信授权接口；成功后把 ready 交回原动线继续提交。
 *
 * @returns Promise<{
 *   action: 'ready'|'trip-only'|'settings'|'cancelled',
 *   settingsKind?: 'system'|'subscribe',
 *   needed: number, shortfall: number, reason?: string
 * }>
 */
function confirmReminderAccess(needed, templateId) {
  const tpl = templateIdOf(templateId);
  const want = Math.max(0, Number(needed) || 0);
  if (want <= 0) {
    return Promise.resolve({ action: 'ready', needed: 0, shortfall: 0 });
  }

  if (!getSystemNotifyOk()) {
    return showReminderAccessSheet(
      '微信通知权限未开启，提醒可能收不到。',
      '去开启微信通知'
    ).then(choice => {
      if (choice.choice === 'first') {
        return { action: 'settings', settingsKind: 'system', needed: want, shortfall: 0, reason: 'system-notify-off' };
      }
      if (choice.choice === 'trip-only') {
        return { action: 'trip-only', needed: want, shortfall: want, reason: 'system-notify-off' };
      }
      return { action: 'cancelled', needed: want, shortfall: want, reason: choice.reason || 'cancelled' };
    });
  }

  return getSubscribeQuota(tpl).then(q => {
    const quota = q.ok ? q.quota : 0;
    const shortfall = Math.max(0, want - quota);
    if (shortfall <= 0) {
      return { action: 'ready', needed: want, shortfall: 0 };
    }

    return showReminderAccessSheet(
      `本次设置提醒需要 ${want} 次微信授权，当前还差 ${shortfall} 次。补齐后会继续完成刚才的提醒。`,
      '补授权并继续'
    ).then(choice => {
      if (choice.choice === 'first') {
        return completeSubscribeShortfall(shortfall, tpl, want);
      }
      if (choice.choice === 'trip-only') {
        return { action: 'trip-only', needed: want, shortfall, reason: 'quota-shortfall' };
      }
      return { action: 'cancelled', needed: want, shortfall, reason: choice.reason || 'cancelled' };
    });
  });
}

/**
 * 查询某个模板的本地记账「已授权次数」（用于提醒设置页展示）。
 * ⚠️ 这是本地推测值、不是微信侧真实余额（微信不提供余额查询接口），
 * 页面文案必须写「已授权 N 次」而非「可提醒 N 次」——后者等于承诺必然送达。
 */
function getSubscribeQuota(templateId) {
  const tpl = templateIdOf(templateId);
  return api.reminder.subscribe.get(tpl)
    .then(r => ({
      ok: true,
      quota: (r && r.quota) || 0,
      totalQuota: (r && r.totalQuota) || 0,
      quotas: (r && r.quotas) || {},
      templateId: tpl,
      pendingMessageCount: (r && r.pendingMessageCount) || 0,
      nearestRemindAt: (r && r.nearestRemindAt) || null,
      level: (r && r.level) || 'idle',
      shortfall: (r && r.shortfall) || 0,
      replenishNeeded: (r && r.replenishNeeded) || 0,
    }))
    .catch(() => ({
      ok: false,
      quota: 0,
      totalQuota: 0,
      quotas: {},
      templateId: tpl,
      pendingMessageCount: 0,
      nearestRemindAt: null,
      level: 'unknown',
      shortfall: 0,
      replenishNeeded: 0,
    }));
}

/**
 * 统一提醒健康状态：权限 + 本地授权台账 + 未来待发送量。
 * profile / 设置页 / 首页不要各自拼状态，避免三套口径。
 */
function getReminderHealth(templateId) {
  const tpl = templateIdOf(templateId);
  return Promise.all([getNotifyStatus(tpl), getSubscribeQuota(tpl)]).then(([permission, quota]) => ({
    systemOk: permission.systemOk,
    subscribeOk: permission.subscribeOk,
    permissionState: permission.state,
    quotaOk: quota.ok,
    quota: quota.quota,
    totalQuota: quota.totalQuota,
    quotas: quota.quotas,
    templateId: tpl,
    pendingMessageCount: quota.pendingMessageCount,
    nearestRemindAt: quota.nearestRemindAt,
    quotaLevel: quota.level,
    shortfall: quota.shortfall,
    replenishNeeded: quota.replenishNeeded,
  }));
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

/**
 * 轻量提醒入口遇到 settings 分支时统一处理：
 * - 微信通知权限问题：打开系统通知设置；
 * - 订阅消息总开关/模板保持拒绝：只打开设置引导，不去“提醒设置”页绕一圈。
 */
function openReminderAccessSettings(access) {
  if (!access || access.action !== 'settings') return false;
  if (access.settingsKind === 'system') {
    openSystemNotifySetting();
    return true;
  }
  if (access.settingsKind === 'subscribe') {
    guideOpenSubscribeSetting(access.reason);
    return true;
  }
  wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  return true;
}

/**
 * 「总是保持以上选择」引导（2026-09-16）
 *
 * 微信规则：没勾过这个选项时，**每次**调用 `wx.requestSubscribeMessage` 都会弹一次窗，
 * 小程序端无法绕过；勾过之后调用静默记账，且**静默调用每次照样 +1 条额度**（已真机验证）。
 * 所以「一次提交 N 条提醒全程零弹窗」的前提，就是用户先勾这么一次。
 *
 * 本函数在用户**完成一次弹窗授权但没勾选**（`silent === false`）时提示一次，
 * 用本地 storage 标记保证**一辈子只提示一次**（一次性成本换永久安静），不重复打扰。
 *
 * ⚠️ 勾选状态绑在 (微信账号, 小程序, templateId) 上、永久有效，只能去微信设置页手动改；
 * 换 templateId 会重置，所以标记也按 templateId 分开记。
 */
const KEEP_HINT_KEY_PREFIX = 'subscribeKeepHintShown:';
const FIRST_REMINDER_TIP_KEY = 'firstReminderGuestInfoTipShownV1';

function hintKeepAlwaysChoice(templateId) {
  const tpl = templateIdOf(templateId);
  const key = KEEP_HINT_KEY_PREFIX + tpl;
  try {
    if (wx.getStorageSync(key)) return;
    /* 先落标记再弹窗：宁可极端情况下漏提示一次，也不要重复打扰 */
    wx.setStorageSync(key, 1);
  } catch (e) {
    /* storage 不可用时不冒险重复弹窗，直接放弃本次提示 */
    return;
  }
  wx.showModal({
    title: '以后可以不用每次都点',
    content: '下次微信弹出的确认窗里，勾选「总是保持以上选择，不再询问」再点允许，之后续收就不会再弹窗了。',
    confirmText: '知道了',
    showCancel: false,
  });
}

/** 首次成功创建提醒时返回 true；之后不再重复提示游客信息。 */
function consumeFirstReminderSuccessTip() {
  try {
    if (wx.getStorageSync(FIRST_REMINDER_TIP_KEY)) return false;
    wx.setStorageSync(FIRST_REMINDER_TIP_KEY, 1);
    return true;
  } catch (e) {
    return false;
  }
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
  getReminderQuotaNeeded,
  confirmReminderAccess,
  openReminderAccessSettings,
  getSubscribeQuota,
  getReminderHealth,
  guideOpenSubscribeSetting,
  hintKeepAlwaysChoice,
  consumeFirstReminderSuccessTip,
  KEEP_HINT_KEY_PREFIX,
  FIRST_REMINDER_TIP_KEY,
};
