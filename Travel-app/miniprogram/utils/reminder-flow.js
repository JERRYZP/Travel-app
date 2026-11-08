/**
 * 景区详情 / 分享场景共用的提醒提交流程。
 *
 * 页面只需在 data 中维护 dateAction、日历字段和 entryContext；
 * 本模块统一处理景点快捷设提醒的日期预检、授权、一次性提交与首次分享动作上报。
 * 快捷入口不写主流程 reminder_cart；旧版遗留的同景点日期暂存行由服务端提交时消费。
 */

const api = require('./api.js');
const notify = require('./notify.js');
const tripCalendar = require('./trip-calendar.js');
const analytics = require('./analytics.js');
const membershipEntry = require('./membership-entry.js');
const membershipPay = require('./membership-pay.js');
const reminderDatePlan = require('./reminder-date-plan.js');

function visitDatesOf(detail) {
  const source = Array.isArray(detail && detail.visitDates)
    ? detail.visitDates
    : [(detail && detail.visitDate)];
  return [...new Set(source.filter(Boolean).map(String))].sort();
}

function removeCartItems(cartIds) {
  return Promise.all((cartIds || []).map(cartId =>
    api.reminder.cart.remove(cartId).catch(() => {})
  ));
}

function commitQuickWithContext(payload, dateCount, taskCount) {
  return api.reminder.cart.quickCommit(payload).catch(err => {
    if (err && typeof err === 'object') {
      err._taskLimitCartIds = [];
      err._taskLimitResume = {
        operation: 'quickCommit',
        payload: Object.assign({}, payload),
        dateCount,
        taskCount,
      };
    }
    throw err;
  });
}

function resumeOperation(resume) {
  if (!resume || !resume.payload) return Promise.resolve(null);
  return resume.operation === 'quickCommit'
    ? api.reminder.cart.quickCommit(resume.payload)
    : api.reminder.cart.commit(resume.payload);
}

function successTitleOf(result, dateCount) {
  const multiPrefix = dateCount > 1 ? `已加入 ${dateCount} 个日期` : '已加入行程';
  if (result.expired) {
    return dateCount > 1
      ? `${multiPrefix} · 已过放票时间，提醒无法设置`
      : '已加入行程 · 已过放票时间，提醒无法设置';
  }
  if (result.mode === 'trip-only') {
    return dateCount > 1 ? `${multiPrefix}，未设置提醒` : '已加入行程，未设置提醒';
  }
  const createdTasks = Math.max(0, Number(result.res.createdTasks) || 0);
  const expiredReminder = Math.max(0, Number(result.res.expiredReminder) || 0);
  if (createdTasks > 0 && expiredReminder > 0) {
    return `${multiPrefix} · 已设置 ${createdTasks} 个提醒，${expiredReminder} 项已过期`;
  }
  if (expiredReminder > 0) {
    return `${multiPrefix} · ${expiredReminder} 项已过放票时间，提醒无法设置`;
  }
  if (createdTasks > 0) {
    if (dateCount > 1) return `${multiPrefix} · 已设置 ${createdTasks} 个提醒`;
    return '提醒已设置，放票前见';
  }
  return dateCount > 1 ? `${multiPrefix}，未设置提醒` : '已加入行程，未设置提醒';
}

function finishDateFlow(page, result) {
  page._dateSubmitting = false;
  wx.hideLoading();
  if (result && result.reopenDateSheet) {
    page.setData({ showDateSheet: true });
    return false;
  }
  page.setData({ dateAction: null, dateMultiple: false });
  if (!result || !result.res) return false;
  if (typeof page.onReminderFlowFinished === 'function') {
    try {
      page.onReminderFlowFinished(result);
    } catch (err) {
      console.error('[reminder-flow] finish hook failed', err && err.message);
    }
  }

  analytics.trackFirstAction(page.data.entryContext, result.mode);
  let title = successTitleOf(result, result.dateCount);
  if (result.dateCount === 1
    && result.mode === 'reminder'
    && (result.res.createdTasks || 0) > 0
    && notify.consumeFirstReminderSuccessTip()) {
    title = '提醒已设置，先备好游客信息';
  }
  wx.showToast({ title, icon: 'none', duration: 2000 });
  return true;
}

function reminderAuthViewOf(needed, quota) {
  const want = Math.max(0, Number(needed) || 0);
  const ledgerQuota = Math.max(0, Number(quota && quota.quota) || 0);
  const availableQuota = Math.max(0, Number(quota && quota.availableQuota) || 0);
  const reservedQuota = Math.max(0, ledgerQuota - availableQuota);
  const shortfall = Math.max(0, want - availableQuota);
  const systemOk = notify.getSystemNotifyOk();
  const templateReady = !!notify.SUBSCRIBE_TEMPLATE_ID;
  const authReady = systemOk && shortfall <= 0;
  let summary = systemOk
    ? `本次设置提醒需要 ${want} 次授权，当前可用 ${availableQuota} 次。`
    : '开启微信通知后，还需要按提醒条数完成订阅授权。';
  if (reservedQuota > 0) {
    summary += ` 已授权额度中有 ${reservedQuota} 次被待发送提醒占用。`;
  }
  return {
    needed: want,
    ledgerQuota,
    availableQuota,
    reservedQuota,
    shortfall,
    systemOk,
    templateReady,
    quotaOk: !!(quota && quota.ok),
    authReady,
    title: systemOk ? '微信授权次数不足' : '微信通知权限未开启',
    summary,
    statusText: !systemOk ? '未开启' : (authReady ? '授权次数已满足' : `还差 ${shortfall} 次`),
    quotaLine: `本次 ${want} 条提醒 · 当前可用 ${availableQuota} 次`,
    primaryText: systemOk ? '点击补授权次数' : '去开启微信通知',
    ruleText: systemOk
      ? '每次点击最多增加 1 次授权，补足后请点击底部按钮继续。'
      : '开启后返回本页，授权状态会自动刷新。',
  };
}

function resolveReminderAuth(page, result) {
  if (!page) return false;
  const resolve = page._reminderAuthResolve;
  page._reminderAuthResolve = null;
  page._reminderAuthForceSheet = false;
  page._reminderAuthNeeded = 0;
  page.setData({
    showReminderAuth: false,
    reminderAuth: null,
    membershipLimit: null,
    reminderCheckoutReady: false,
    reminderAuthBusy: false,
    reminderAuthFeedback: '',
    datePlan: null,
    reminderContinueText: '开启行程放票提醒',
    taskLimitPayConfirm: null,
    taskLimitPayButtonText: '',
    taskLimitPaying: false,
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: '',
  });
  if (resolve) resolve(result);
  return true;
}

function membershipLimitOfStatus(status, needed) {
  const membership = status && status.membership;
  if (!status || status.enforced !== true || !membership) return null;
  if (membership.taskLimitUnlimited === true || membership.unlimited === true) return null;
  const remaining = Math.max(0, Number(membership.taskRemaining) || 0);
  const requested = Math.max(0, Number(needed) || 0);
  if (requested <= remaining) return null;
  return membershipEntry.viewOf({
    errorCode: 1026,
    membership,
    taskLimit: {
      limit: membership.taskLimit,
      used: membership.taskUsed,
      remaining,
      requested,
      shortfall: requested - remaining,
    },
    packages: status.packages || [],
    sales: status.sales || null,
  });
}

function refreshReminderAuth(page, options) {
  const needed = Math.max(0, Number(page && page._reminderAuthNeeded) || 0);
  if (!needed) return Promise.resolve(null);
  return Promise.all([
    notify.getSubscribeQuota(),
    api.reminder.membership.status().catch(() => null),
  ]).then(([quota, status]) => {
    const auth = reminderAuthViewOf(needed, quota);
    const membershipLimit = membershipLimitOfStatus(status, needed);
    const checkoutReady = auth.authReady && !membershipLimit;
    if (!page._reminderAuthResolve && !page.data.showReminderAuth) return auth;
    page.setData({
      reminderAuth: auth,
      membershipLimit,
      reminderCheckoutReady: checkoutReady,
      taskLimitPayDisabled: !!(membershipLimit && membershipLimit.purchaseEnabled === false),
      reminderAuthFeedback: auth.quotaOk ? '' : '授权状态读取失败，请稍后重试。',
    });
    if (page._reminderAuthResolve && checkoutReady) {
      if (options && options.completeWhenReady && !page._reminderAuthForceSheet) {
        page.setData({ reminderAuthFeedback: '检查通过，正在继续设置提醒...' });
        resolveReminderAuth(page, {
          action: 'ready',
          needed,
          shortfall: 0,
          availableQuota: auth.availableQuota,
        });
      } else {
        page.setData({ reminderAuthFeedback: '检查通过，请点击“开启行程放票提醒”。' });
      }
    } else if (!page._reminderAuthResolve && checkoutReady) {
      page.setData({ reminderAuthFeedback: '检查通过，请点击“开启行程放票提醒”。' });
    }
    return { auth, membershipLimit };
  });
}

function openReminderAuth(page, needed, options) {
  const want = Math.max(0, Number(needed) || 0);
  if (want <= 0) {
    return Promise.resolve({ action: 'ready', needed: 0, shortfall: 0 });
  }
  const opts = options || {};
  page._reminderAuthNeeded = want;
  page._reminderAuthForceSheet = opts.forceSheet === true;
  page.setData({
    reminderAuthFeedback: '',
    datePlan: opts.datePlan || null,
    reminderContinueText: opts.continueText || '开启行程放票提醒',
  });
  wx.showLoading({ title: '正在检查授权...' });
  return new Promise(resolve => {
    page._reminderAuthResolve = resolve;
    refreshReminderAuth(page, { completeWhenReady: !page._reminderAuthForceSheet }).then(() => {
      wx.hideLoading();
      if (!page._reminderAuthResolve) return;
      page.setData({
        showReminderAuth: true,
        reminderAuthBusy: false,
      });
    }).catch(() => {
      wx.hideLoading();
      if (!page._reminderAuthResolve) return;
      page.setData({
        showReminderAuth: true,
        reminderAuthBusy: false,
        reminderAuth: reminderAuthViewOf(want, {
          ok: false, quota: 0, availableQuota: 0,
        }),
        reminderAuthFeedback: '授权状态读取失败，请稍后重试。',
      });
    });
  });
}

function requestReminderAuthOnce(page) {
  if (!page || page.data.reminderAuthBusy) return Promise.resolve(false);
  const auth = page.data.reminderAuth;
  if (!auth) return Promise.resolve(false);
  if (!auth.systemOk) {
    notify.openSystemNotifySetting();
    page.setData({ reminderAuthFeedback: '开启微信通知后返回本页，状态会自动刷新。' });
    return Promise.resolve(true);
  }
  if (!auth.templateReady) {
    page.setData({ reminderAuthFeedback: '推送通道准备中，请稍后再试。' });
    return Promise.resolve(false);
  }

  page.setData({ reminderAuthBusy: true, reminderAuthFeedback: '' });
  return notify.requestSubscribeBurst(1).then(res => {
    return refreshReminderAuth(page).then(state => {
      const next = state && state.auth ? state.auth : page.data.reminderAuth;
      const membershipLimit = state && state.membershipLimit;
      if (next.authReady && !membershipLimit) {
        if (page._taskLimitPaidReady && (page._taskLimitResume || page._reminderAuthResolve)) {
          page.setData({
            reminderAuthBusy: false,
            reminderAuthFeedback: '授权次数已满足，正在设置提醒...',
          });
          return resumeTaskLimitAfterPayment(page).then(() => true);
        }
        page.setData({
          reminderAuth: next,
          membershipLimit,
          reminderCheckoutReady: true,
          taskLimitPayDisabled: !!(membershipLimit && membershipLimit.purchaseEnabled === false),
          reminderAuthBusy: false,
          reminderAuthFeedback: '授权次数已满足，请点击“开启行程放票提醒”。',
        });
        return true;
      }

      let feedback = '未完成授权，请重试。';
      if (res.reason === 'master-switch-off' || res.reason === 'subscription-disabled') {
        feedback = '微信订阅授权未开启，请点击下方“微信授权设置”改为允许后再试。';
      } else if (res.reason === 'banned') {
        feedback = '该提醒模板已被微信限制，暂时无法继续授权。';
      } else if (res.reason === 'template-filtered') {
        feedback = '提醒模板未通过微信校验，暂时无法继续授权。';
      } else if (res.reason === 'rejected') {
        feedback = '本次未授权，可用次数没有增加。';
      } else if (res.ok && next.availableQuota > auth.availableQuota) {
        feedback = `已补 1 次，当前可用 ${next.availableQuota} 次，还差 ${next.shortfall} 次。`;
      } else if (res.ok && next.ledgerQuota > auth.ledgerQuota) {
        feedback = '已补 1 次，但授权仍被待发送提醒占用。';
      } else if (res.ok) {
        feedback = '授权已提交，但可用次数暂未同步，请稍后重试。';
      } else if (res.reason === 'account-failed') {
        feedback = '微信已允许，但授权未记账，请稍后重试。';
      }
      if (next.authReady && membershipLimit) {
        feedback = '授权次数已满足，请先处理下方的提醒名额。';
      }
      page.setData({
        reminderAuth: next,
        membershipLimit,
        reminderCheckoutReady: next.authReady && !membershipLimit,
        taskLimitPayDisabled: !!(membershipLimit && membershipLimit.purchaseEnabled === false),
        reminderAuthBusy: false,
        reminderAuthFeedback: feedback,
      });
      return true;
    });
  }).catch(() => {
    page.setData({
      reminderAuthBusy: false,
      reminderAuthFeedback: '授权未完成，请重试。',
    });
    return false;
  });
}

function openReminderAuthSettings(page) {
  if (!page || page.data.reminderAuthBusy) return false;
  page.setData({ reminderAuthFeedback: '请在微信设置中允许订阅消息，返回后会自动刷新。' });
  wx.openSetting({});
  return true;
}

function openDatePlanReview(page, planView) {
  if (!page || !planView) return Promise.resolve({ action: 'cancelled' });
  page.setData({
    showReminderAuth: true,
    reminderAuth: null,
    membershipLimit: null,
    datePlan: planView,
    reminderContinueText: planView.continueText,
    reminderCheckoutReady: true,
    reminderAuthBusy: false,
    reminderAuthFeedback: '',
  });
  return new Promise(resolve => {
    page._datePlanResolve = resolve;
  }).then(action => {
    page._datePlanResolve = null;
    return action;
  });
}

function closeDatePlanReview(page, action) {
  const resolve = page && page._datePlanResolve;
  if (!resolve) return false;
  page._datePlanResolve = null;
  page._reminderAuthResolve = null;
  page._reminderAuthNeeded = 0;
  page._reminderAuthForceSheet = false;
  page._dateSubmitting = false;
  page.setData({
    showReminderAuth: false,
    reminderAuth: null,
    membershipLimit: null,
    datePlan: null,
    reminderContinueText: '开启行程放票提醒',
    reminderCheckoutReady: false,
    reminderAuthBusy: false,
    reminderAuthFeedback: '',
  });
  resolve(action);
  return true;
}

function closeReminderCheckout(page) {
  if (!page) return Promise.resolve(false);
  if (page._datePlanResolve) {
    closeDatePlanReview(page, { action: 'cancelled', reason: 'user-cancelled' });
    return Promise.resolve(true);
  }
  if (page._reminderAuthResolve) {
    return Promise.resolve(resolveReminderAuth(page, {
      action: 'cancelled',
      needed: page._reminderAuthNeeded,
      shortfall: page.data.reminderAuth && page.data.reminderAuth.shortfall,
      reason: 'user-cancelled',
    }));
  }
  return closeTaskLimit(page);
}

function continueReminderCheckout(page) {
  if (page && page._datePlanResolve) {
    const plan = page.data.datePlan || {};
    const action = plan.primaryAction || 'cancelled';
    if (action === 'trip-only') {
      closeDatePlanReview(page, { action: 'trip-only' });
      return Promise.resolve(true);
    }
    if (action === 'reselect') {
      closeDatePlanReview(page, { action: 'reselect' });
      return Promise.resolve(true);
    }
  }
  if (!page || !page.data.reminderCheckoutReady) return Promise.resolve(false);
  if (page._reminderAuthResolve) {
    return Promise.resolve(resolveReminderAuth(page, {
      action: 'ready',
      needed: page._reminderAuthNeeded,
      shortfall: 0,
      availableQuota: page.data.reminderAuth && page.data.reminderAuth.availableQuota,
    }));
  }
  if (page._taskLimitResume) {
    return page._taskLimitPaidReady
      ? resumeTaskLimitAfterPayment(page)
      : retryReminderCommitAfterAuth(page);
  }
  return Promise.resolve(false);
}

function tripOnlyReminderCheckout(page) {
  if (!page) return Promise.resolve(false);
  if (page._datePlanResolve) {
    closeDatePlanReview(page, { action: 'trip-only' });
    return Promise.resolve(true);
  }
  if (page._reminderAuthResolve) {
    return Promise.resolve(resolveReminderAuth(page, {
      action: 'trip-only',
      needed: page._reminderAuthNeeded,
      shortfall: page.data.reminderAuth && page.data.reminderAuth.shortfall,
      reason: 'quota-shortfall',
    }));
  }
  const resume = page._taskLimitResume;
  if (!resume || !resume.payload) return Promise.resolve(false);
  if (page.data.taskLimitPaying) return Promise.resolve(false);
  page.setData({ taskLimitPaying: true, taskLimitPayFeedback: '正在改为仅加行程...' });
  wx.showLoading({ title: '正在加入行程...' });
  return resumeOperation({
    ...resume,
    payload: Object.assign({}, resume.payload, { disableReminders: true }),
  }).then(res => {
    wx.hideLoading();
    page._taskLimitCartIds = [];
    page._taskLimitResume = null;
    page._taskLimitPayMode = 'purchase';
    page.setData({
      showReminderAuth: false,
      reminderAuth: null,
      membershipLimit: null,
      reminderCheckoutReady: false,
      taskLimitPaying: false,
      taskLimitPayConfirm: null,
      taskLimitPayButtonText: '',
      taskLimitPayDisabled: false,
      taskLimitPayFeedback: '',
    });
    return finishDateFlow(page, {
      res,
      mode: 'trip-only',
      dateCount: resume.dateCount,
    });
  }).catch(err => {
    wx.hideLoading();
    page.setData({
      taskLimitPaying: false,
      reminderAuthFeedback: err && err.error ? err.error : '改为仅加行程失败，请重试。',
    });
    return false;
  });
}

function reselectReminderDates(page) {
  if (!page) return Promise.resolve(false);
  if (page._datePlanResolve) {
    closeDatePlanReview(page, { action: 'reselect' });
    return Promise.resolve(true);
  }
  if (page._reminderAuthResolve) {
    return Promise.resolve(resolveReminderAuth(page, { action: 'reselect' }));
  }
  return Promise.resolve(false);
}

function showReminderCheckoutWithLimit(page, limit, needed) {
  if (!page || !limit) return Promise.resolve(false);
  const want = Math.max(1, Number(needed) || Number(limit.requested) || 1);
  page._reminderAuthNeeded = want;
  page._taskLimitCartIds = (page._taskLimitCartIds || []).slice();
  page.setData({ reminderAuthFeedback: '' });
  return notify.getSubscribeQuota().then(quota => {
    const auth = reminderAuthViewOf(want, quota);
    page.setData({
      showReminderAuth: true,
      reminderAuth: auth,
      membershipLimit: limit,
      reminderCheckoutReady: auth.authReady && !limit,
      taskLimitPayDisabled: limit.purchaseEnabled === false,
      reminderAuthBusy: false,
      reminderAuthFeedback: auth.authReady ? '' : '请先补齐上方授权次数。',
    });
    return true;
  });
}

function openDateSheet(page, opts) {
  if (!page || !opts || page._openingDateSheet) return Promise.resolve(false);
  page._openingDateSheet = true;
  page.setData({ showSpotPopup: false });
  wx.showLoading({ title: '加载行程...' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const open = calendar => {
    wx.hideLoading();
    page._openingDateSheet = false;
    const dates = calendar || { tripDates: [], bookedDates: [] };
    page.setData({
      showDateSheet: true,
      dateSpotName: opts.spotName,
      dateTitle: opts.title,
      dateTripDates: dates.tripDates,
      dateBookedDates: dates.bookedDates,
      dateMinDate: today.getFullYear() + '-' + mm + '-' + dd,
      dateAction: { spotId: opts.spotId, remindOn: !!opts.remindOn },
      dateMultiple: !!opts.multiple,
    });
  };

  return api.reminder.home.bootstrap({})
    .then(res => open(tripCalendar.fromHomeBootstrap(res, opts.spotId)))
    .catch(() => {
      open(null);
      wx.showToast({ title: '已有行程加载失败，仍可继续选择', icon: 'none' });
    })
    .then(() => true);
}

function onDateConfirm(page, e) {
  const visitDates = visitDatesOf(e && e.detail);
  const action = page && page.data && page.data.dateAction;
  if (!visitDates.length || !action || page._dateSubmitting) return Promise.resolve(false);

  page._dateSubmitting = true;
  page.setData({ showDateSheet: false });
  wx.showLoading({ title: action.remindOn ? '正在设置...' : '正在添加...' });

  const commitDates = (dates, disableReminders, expired) => {
    const payload = {
      spotId: action.spotId,
      visitDates: dates,
      disableReminders: !!disableReminders,
    };
    if (!disableReminders) {
      payload.channels = ['OFFICIAL_ACCOUNT'];
      payload.offsets = [5];
    }
    return api.reminder.cart.quickCommit(payload).then(res => ({
      res,
      mode: disableReminders ? 'trip-only' : 'reminder',
      expired: !!expired,
      dateCount: dates.length,
    }));
  };
  const reviewPlan = plan => reminderDatePlan.viewOf(plan);
  const eligibleDatesOf = plan => (plan.dates || [])
    .filter(row => row.status === 'REMINDABLE' || row.status === 'TRIP_ONLY')
    .map(row => row.visitDate);
  const chooseDetachedPlan = planView => openDatePlanReview(page, planView).then(choice => {
    if (choice.action === 'trip-only') return { action: 'trip-only' };
    if (choice.action === 'reselect') return { action: 'reselect' };
    return { action: 'cancelled' };
  });
  const runReminderFlow = (plan, commitVisitDates) => {
    const initialPlanView = reviewPlan(plan);
    if (commitVisitDates.length === 0) {
      return chooseDetachedPlan(initialPlanView).then(choice => {
        if (choice.action === 'reselect') return { res: null, mode: '', reopenDateSheet: true };
        return { res: null, mode: '' };
      });
    }

    const planView = reviewPlan(plan);
    if (plan.summary.reminder === 0) {
      return chooseDetachedPlan(planView).then(choice => {
        if (choice.action === 'trip-only') {
          return commitDates(commitVisitDates, true, plan.summary.releasePassed > 0);
        }
        if (choice.action === 'reselect') {
          return { res: null, mode: '', reopenDateSheet: true };
        }
        return { res: null, mode: '' };
      });
    }

    const reminderTaskCount = Math.max(
      0,
      Number(plan.summary.reminderTaskCount) || Number(plan.summary.reminder) || 0
    );
    return openReminderAuth(page, reminderTaskCount, {
      forceSheet: !!planView,
      datePlan: planView,
      continueText: planView ? planView.continueText : '开启行程放票提醒',
    }).then(access => {
      if (access.action === 'ready') {
        return commitQuickWithContext({
          spotId: action.spotId,
          visitDates: commitVisitDates,
          channels: ['OFFICIAL_ACCOUNT'],
          offsets: [5],
        }, commitVisitDates.length, reminderTaskCount).then(res => ({
          res,
          mode: 'reminder',
          dateCount: commitVisitDates.length,
        }));
      }
      if (access.action === 'trip-only') {
        return commitDates(commitVisitDates, true, plan.summary.releasePassed > 0);
      }
      if (access.action === 'reselect') {
        return { res: null, mode: '', reopenDateSheet: true };
      }
      if (access.action === 'completed') return { res: null, alreadyFinished: true };
      if (access.action === 'settings') notify.openReminderAccessSettings(access);
      else if (access.action === 'cancelled') notify.showReminderAccessCancelled(access);
      return { res: null, mode: '' };
    });
  };

  const task = api.reminder.cart.planQuickDates({
    spotId: action.spotId,
    visitDates,
  }).then(plan => {
    const commitVisitDates = eligibleDatesOf(plan);
    if (!action.remindOn) {
      if (commitVisitDates.length === 0) {
        const existingOnly = reviewPlan(plan);
        return chooseDetachedPlan(existingOnly).then(choice => (
          choice.action === 'reselect'
            ? { res: null, mode: '', reopenDateSheet: true }
            : { res: null, mode: '' }
        ));
      }
      return commitDates(commitVisitDates, true, false);
    }
    return runReminderFlow(plan, commitVisitDates);
  });

  return task.then(result => {
    return finishDateFlow(page, result);
  }).catch(err => {
    page._dateSubmitting = false;
    page.setData({ dateAction: null, dateMultiple: false });
    wx.hideLoading();
    if (err && err.errorCode === 1008) {
      return showSubscriptionCommitError(page, err);
    }
    const limit = membershipEntry.viewOf(err);
    if (limit) {
      page._taskLimitCartIds = (err && err._taskLimitCartIds) || [];
      page._taskLimitResume = (err && err._taskLimitResume) || null;
      page._taskLimitPendingOrderId = '';
      page._taskLimitPayMode = 'purchase';
      page._taskLimitPaidReady = false;
      const needed = page._taskLimitResume
        && (page._taskLimitResume.taskCount || page._taskLimitResume.dateCount);
      page.setData({
        taskLimitPayConfirm: null,
        taskLimitPayButtonText: '',
        taskLimitPaying: false,
        taskLimitPayDisabled: limit.purchaseEnabled === false,
        taskLimitPayFeedback: '',
      });
      return showReminderCheckoutWithLimit(page, limit, needed).then(() => false);
    }
    api.toastError(err);
    return false;
  });
}

function closeTaskLimit(page) {
  if (!page || page._taskLimitClosing) return Promise.resolve(false);
  if (page.data && page.data.taskLimitPaying) return Promise.resolve(false);
  if (page._taskLimitPaidReady) {
    wx.showToast({ title: '权益已到账，请先继续设置提醒', icon: 'none' });
    return Promise.resolve(false);
  }
  page._taskLimitClosing = true;
  const cartIds = (page._taskLimitCartIds || []).slice();
  page._taskLimitCartIds = [];
  page._taskLimitResume = null;
  page._taskLimitPendingOrderId = '';
  page._taskLimitPayMode = 'purchase';
  page.setData({
    showReminderAuth: false,
    membershipLimit: null,
    reminderAuth: null,
    datePlan: null,
    reminderContinueText: '开启行程放票提醒',
    reminderCheckoutReady: false,
    taskLimitPayConfirm: null,
    taskLimitPayButtonText: '',
    taskLimitPaying: false,
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: '',
  });
  return removeCartItems(cartIds).then(() => {
    page._taskLimitClosing = false;
    return true;
  });
}

function selectedTaskLimitOf(limit, packageId) {
  if (!limit || !packageId) return limit;
  const option = (limit.options || []).find(item =>
    item && item.packageId === packageId);
  if (!option) return limit;
  return {
    ...limit,
    ...option,
    packageId: option.packageId,
    packageType: 'MEMBER',
    packageTitle: option.title,
  };
}

function openTaskLimitPayment(page, e) {
  if (!page || page._taskLimitClosing || (page.data && page.data.taskLimitPaying)) return false;
  const limit = page.data && page.data.membershipLimit;
  if (!limit) return false;
  const packageId = String((e && e.detail && e.detail.packageId) || '');
  const selectedLimit = selectedTaskLimitOf(limit, packageId);
  if (selectedLimit && selectedLimit.disabled) {
    wx.showToast({ title: selectedLimit.disabledReason || '当前方案暂不可购买', icon: 'none' });
    return false;
  }
  if (limit.purchaseEnabled === false) {
    page.setData({
      taskLimitPayFeedback: limit.salesMessage || '会员购买暂停中，请稍后再试。',
      taskLimitPayButtonText: '会员购买暂停中',
      taskLimitPayDisabled: true,
    });
    wx.showToast({ title: limit.salesMessage || '会员购买暂停中', icon: 'none' });
    return false;
  }
  if (selectedLimit.upgradeWindowClosed === true) {
    wx.showToast({ title: '会员即将到期，请到期后重新开通', icon: 'none' });
    return false;
  }
  membershipEntry.showUpgradeWindowWarning(selectedLimit, () => {
    const confirm = membershipEntry.payConfirmOf(selectedLimit);
    if (!confirm) {
      wx.showToast({ title: '套餐信息加载失败，请稍后重试', icon: 'none' });
      return;
    }
    const mode = page._taskLimitPayMode;
    const buttonText = mode === 'resume'
      ? '继续设置提醒'
      : (mode === 'status' ? '继续确认支付结果' : (mode === 'blocked' ? '暂不可继续' : `支付 ${confirm.amount}`));
    page.setData({
      taskLimitPayConfirm: confirm,
      taskLimitPayButtonText: buttonText,
      taskLimitPayDisabled: mode === 'blocked',
      taskLimitPayFeedback: '',
    });
    page._taskLimitSelectedLimit = selectedLimit;
  });
  return true;
}

function showSubscriptionCommitError(page, err) {
  const subscription = (err && err.subscription) || {};
  const required = Math.max(
    1,
    Number(subscription.required) || Number(page && page._reminderAuthNeeded) || 1
  );
  page._reminderAuthNeeded = required;
  page._reminderAuthForceSheet = false;
  page._taskLimitCartIds = (err && err._taskLimitCartIds) || [];
  page._taskLimitResume = (err && err._taskLimitResume) || null;
  page.setData({
    showReminderAuth: true,
    reminderAuth: reminderAuthViewOf(required, {
      ok: true,
      quota: subscription.quota,
      availableQuota: subscription.availableQuota,
    }),
    membershipLimit: null,
    datePlan: null,
    reminderContinueText: '开启行程放票提醒',
    reminderCheckoutReady: false,
    reminderAuthBusy: false,
    reminderAuthFeedback: `提交前授权额度发生变化，还差 ${Math.max(0, Number(subscription.shortfall) || 0)} 次，请补齐后重试。`,
    taskLimitPayConfirm: null,
    taskLimitPayButtonText: '',
    taskLimitPaying: false,
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: '',
  });
  return refreshReminderAuth(page).then(state => {
    const next = state && state.auth;
    if (next && !next.authReady) {
      page.setData({
        reminderAuthFeedback: `提交前授权额度发生变化，还需补 ${next.shortfall} 次，请补齐后重试。`,
      });
    } else if (state && state.membershipLimit) {
      page.setData({ reminderAuthFeedback: '授权已满足，请先处理下方提醒名额。' });
    } else {
      page.setData({ reminderAuthFeedback: '授权状态已刷新，请点击“开启行程放票提醒”重试。' });
    }
    return false;
  });
}

function closeTaskLimitPayment(page) {
  if (!page || page._taskLimitClosing || (page.data && page.data.taskLimitPaying)) return false;
  page.setData({
    taskLimitPayConfirm: null,
    taskLimitPayButtonText: '',
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: '',
  });
  page._taskLimitSelectedLimit = null;
  return true;
}

function resumeReminderCommit(page, options) {
  const afterPayment = !!(options && options.afterPayment);
  const resume = page && page._taskLimitResume;
  const preflightResume = !!page._reminderAuthResolve;
  if ((!resume || !resume.payload) && !preflightResume) {
    page.setData({
      taskLimitPaying: false,
      taskLimitPayFeedback: afterPayment
        ? '权益已到账，但缺少本次提醒日期，请重新选择。'
        : '',
      taskLimitPayButtonText: '',
    });
    return Promise.resolve(false);
  }
  page._taskLimitPaidReady = afterPayment;
  page._taskLimitPayMode = afterPayment ? 'resume' : 'purchase';
  page.setData({
    taskLimitPaying: true,
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: afterPayment ? '权益已到账，正在设置提醒...' : '',
    taskLimitPayButtonText: afterPayment ? '正在设置提醒...' : '',
  });
  wx.showLoading({ title: '正在设置提醒...' });
  return refreshReminderAuth(page).then(state => {
    const auth = state && state.auth;
    const nextLimit = state && state.membershipLimit;
    if (!auth || !auth.authReady) {
      wx.hideLoading();
      page._taskLimitPaidReady = afterPayment;
      page._taskLimitPayMode = afterPayment ? 'resume' : 'purchase';
      page.setData({
        showReminderAuth: true,
        reminderAuth: auth || page.data.reminderAuth,
        membershipLimit: nextLimit,
        reminderCheckoutReady: false,
        taskLimitPayConfirm: null,
        taskLimitPayButtonText: '',
        taskLimitPaying: false,
        taskLimitPayDisabled: !!(nextLimit && nextLimit.purchaseEnabled === false),
        taskLimitPayFeedback: '',
        reminderAuthFeedback: afterPayment
          ? `权益已到账，还需补 ${Math.max(0, Number(auth && auth.shortfall) || 0)} 次授权。`
          : `授权额度已变化，还需补 ${Math.max(0, Number(auth && auth.shortfall) || 0)} 次授权。`,
      });
      return false;
    }
    if (nextLimit) {
      wx.hideLoading();
      page._taskLimitPaidReady = false;
      page._taskLimitPayMode = 'purchase';
      page.setData({
        showReminderAuth: true,
        reminderAuth: auth,
        membershipLimit: nextLimit,
        reminderCheckoutReady: false,
        taskLimitPayConfirm: null,
        taskLimitPayButtonText: '',
        taskLimitPaying: false,
        taskLimitPayDisabled: nextLimit.purchaseEnabled === false,
        taskLimitPayFeedback: '',
        reminderAuthFeedback: '权益已到账，但提醒名额仍然不足，请继续处理下方名额。',
      });
      return false;
    }
    if (preflightResume) {
      wx.hideLoading();
      page._taskLimitPaidReady = false;
      page._taskLimitPayMode = 'purchase';
      resolveReminderAuth(page, {
        action: 'ready',
        needed: auth.needed,
        shortfall: 0,
        availableQuota: auth.availableQuota,
      });
      return true;
    }
    return resumeOperation(resume).then(res => {
      wx.hideLoading();
      const hadOpenCheckout = !!page._reminderAuthResolve;
      page._taskLimitCartIds = [];
      page._taskLimitResume = null;
      page._taskLimitPendingOrderId = '';
      page._taskLimitPayMode = 'purchase';
      page._taskLimitPaidReady = false;
      if (hadOpenCheckout) {
        resolveReminderAuth(page, {
          action: 'completed',
          needed: resume.dateCount,
          shortfall: 0,
        });
      } else {
        page.setData({
          showReminderAuth: false,
          membershipLimit: null,
          reminderAuth: null,
          reminderCheckoutReady: false,
          taskLimitPayConfirm: null,
          taskLimitPayButtonText: '',
          taskLimitPaying: false,
          taskLimitPayDisabled: false,
          taskLimitPayFeedback: '',
        });
      }
      return finishDateFlow(page, {
        res,
        mode: 'reminder',
        dateCount: resume.dateCount,
      });
    });
  }).catch(err => {
    wx.hideLoading();
    const commitLimit = membershipEntry.viewOf(err);
    if (commitLimit) {
      page._taskLimitPaidReady = false;
      page._taskLimitPayMode = 'purchase';
      page.setData({
        showReminderAuth: true,
        membershipLimit: commitLimit,
        reminderCheckoutReady: false,
        taskLimitPayConfirm: null,
        taskLimitPayButtonText: '',
        taskLimitPaying: false,
        taskLimitPayDisabled: commitLimit.purchaseEnabled === false,
        taskLimitPayFeedback: '',
      });
      wx.showToast({ title: '权益已到账，但提醒名额仍然不足', icon: 'none' });
      return false;
    }
    page._taskLimitPaidReady = afterPayment;
    page._taskLimitPayMode = afterPayment ? 'resume' : 'purchase';
    page.setData({
      taskLimitPaying: false,
      taskLimitPayDisabled: false,
      taskLimitPayFeedback: afterPayment ? '权益已到账，但提醒设置失败，请点击继续重试。' : '',
      taskLimitPayButtonText: afterPayment ? '重新设置提醒' : '',
      reminderAuthFeedback: '提醒设置失败，请重新点击继续。',
    });
    return false;
  });
}

function resumeTaskLimitAfterPayment(page) {
  return resumeReminderCommit(page, { afterPayment: true });
}

function retryReminderCommitAfterAuth(page) {
  return resumeReminderCommit(page, { afterPayment: false });
}

function confirmTaskLimitPayment(page) {
  if (!page || page._taskLimitClosing || (page.data && page.data.taskLimitPaying)) return Promise.resolve(false);
  const limit = page.data && page.data.membershipLimit;
  if (!limit) return Promise.resolve(false);
  if (limit.purchaseEnabled === false) {
    page.setData({
      taskLimitPayFeedback: limit.salesMessage || '会员购买暂停中，请稍后再试。',
      taskLimitPayButtonText: '会员购买暂停中',
      taskLimitPayDisabled: true,
    });
    return Promise.resolve(false);
  }
  if (page._taskLimitPayMode === 'blocked') {
    wx.showToast({ title: '请稍后到订单详情处理权益', icon: 'none' });
    return Promise.resolve(false);
  }
  if (page._taskLimitPayMode === 'resume') return resumeTaskLimitAfterPayment(page);

  const waitingOrderId = page._taskLimitPayMode === 'status' && page._taskLimitPendingOrderId;
  const selectedCandidate = page._taskLimitSelectedLimit;
  const selectedLimit = selectedCandidate
    && (limit.options || []).some(item => item.packageId === selectedCandidate.packageId)
    ? selectedCandidate
    : limit;
  page.setData({ taskLimitPaying: true, taskLimitPayDisabled: false, taskLimitPayFeedback: '' });
  wx.showLoading({ title: waitingOrderId ? '正在确认支付...' : '正在准备支付...' });
  const payment = waitingOrderId
    ? membershipPay.waitForPaid(waitingOrderId)
    : membershipPay.purchase(selectedLimit.packageId);
  return payment.then(result => {
    wx.hideLoading();
    if (result.status === 'PAID_GRANTED') {
      membershipPay.clearPendingOrder(result.orderId);
      page._taskLimitPendingOrderId = '';
      page._taskLimitPayMode = 'resume';
      return resumeTaskLimitAfterPayment(page);
    }
    page.setData({ taskLimitPaying: false });
    if (result.status === 'PENDING') {
      page._taskLimitPendingOrderId = result.orderId || waitingOrderId || '';
      page._taskLimitPayMode = 'status';
      page.setData({
        taskLimitPayFeedback: '支付结果确认中，本次日期已保留，请勿重复支付。',
        taskLimitPayButtonText: '继续确认支付结果',
        taskLimitPayDisabled: false,
      });
      return false;
    }
    if (result.status === 'PAID_GRANT_FAILED') {
      page._taskLimitPayMode = 'blocked';
      page.setData({
        taskLimitPayFeedback: '支付已完成，但权益发放异常，请稍后到订单详情处理。',
        taskLimitPayButtonText: '暂不可继续',
        taskLimitPayDisabled: true,
      });
      return false;
    }
    if (result.status === 'PAID_GRANT_UNKNOWN') {
      page._taskLimitPendingOrderId = result.orderId || waitingOrderId || '';
      page._taskLimitPayMode = 'status';
      page.setData({
        taskLimitPayFeedback: '支付已确认，权益待核验；本次日期已保留，请勿重复支付。',
        taskLimitPayButtonText: '继续确认支付结果',
        taskLimitPayDisabled: false,
      });
      return false;
    }
    page._taskLimitPendingOrderId = '';
    page._taskLimitPayMode = 'purchase';
    page.setData({
      taskLimitPayFeedback: result.status === 'REFUNDED' ? '订单已退款，本次未设置提醒。' : '订单已关闭，本次未扣款。',
      taskLimitPayButtonText: `重新支付 ${limit.priceText}`,
      taskLimitPayDisabled: false,
    });
    return false;
  }).catch(err => {
    wx.hideLoading();
    page._taskLimitPendingOrderId = '';
    page._taskLimitPayMode = 'purchase';
    page.setData({
      taskLimitPaying: false,
      taskLimitPayDisabled: false,
      taskLimitPayFeedback: err && err.cancelled
        ? '支付未完成，本次日期仍保留。'
        : (err && err.errorCode === 1032
          ? (err.error || '会员购买暂停中，请稍后再试。')
          : '支付未完成，尚未发放权益；如已扣款请稍后到订单详情确认。'),
      taskLimitPayButtonText: err && err.errorCode === 1032
        ? '会员购买暂停中'
        : `重新支付 ${limit.priceText}`,
      taskLimitPayDisabled: !!(err && err.errorCode === 1032),
    });
    return false;
  });
}

function openTaskLimitBenefitsPage(page) {
  if (!page || page._taskLimitClosing) return Promise.resolve(false);
  const limit = page.data && page.data.membershipLimit;
  if (!limit) return Promise.resolve(false);
  const cleanup = closeReminderCheckout(page);
  membershipEntry.openPage(limit);
  return cleanup;
}

function onDateClose(page) {
  if (!page) return;
  page.setData({ showDateSheet: false, dateAction: null, dateMultiple: false });
}

module.exports = {
  openDateSheet,
  onDateConfirm,
  onDateClose,
  openReminderAuth,
  refreshReminderAuth,
  requestReminderAuthOnce,
  openReminderAuthSettings,
  resolveReminderAuth,
  closeReminderCheckout,
  continueReminderCheckout,
  reselectReminderDates,
  tripOnlyReminderCheckout,
  showReminderCheckoutWithLimit,
  closeTaskLimit,
  openTaskLimitPayment,
  selectedTaskLimitOf,
  closeTaskLimitPayment,
  confirmTaskLimitPayment,
  openTaskLimitBenefitsPage,
};
