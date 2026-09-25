/**
 * 景区详情 / 分享场景共用的提醒提交流程。
 *
 * 页面只需在 data 中维护 dateAction、日历字段和 entryContext；
 * 本模块统一处理 cart.add、授权、commit、回滚与首次分享动作上报。
 */

const api = require('./api.js');
const notify = require('./notify.js');
const tripCalendar = require('./trip-calendar.js');
const analytics = require('./analytics.js');

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
  const { visitDate } = (e && e.detail) || {};
  const action = page && page.data && page.data.dateAction;
  if (!visitDate || !action || page._dateSubmitting) return Promise.resolve(false);

  page._dateSubmitting = true;
  page.setData({ showDateSheet: false });
  wx.showLoading({ title: action.remindOn ? '正在设置...' : '正在添加...' });

  const rollbackAdded = cartId => {
    if (!cartId) return;
    api.reminder.cart.remove(cartId).catch(() => {});
  };

  return api.reminder.cart.add({
    spotId: action.spotId,
    visitDate,
    remindOn: action.remindOn,
  }).then(added => {
    const cartId = added && added.cartId;
    if (!action.remindOn) {
      return api.reminder.cart.commit({ cartId }).then(res => ({ res, mode: 'trip-only' }));
    }
    return notify.confirmReminderAccess(1).then(access => {
      if (access.action === 'ready') {
        return api.reminder.cart.commit({ cartId, channels: ['OFFICIAL_ACCOUNT'], offsets: [5] })
          .then(res => ({ res, mode: 'reminder' }));
      }
      if (access.action === 'trip-only') {
        return api.reminder.cart.commit({ cartId, disableReminders: true })
          .then(res => ({ res, mode: 'trip-only' }));
      }
      rollbackAdded(cartId);
      if (access.action === 'settings') {
        if (access.settingsKind === 'system') notify.openSystemNotifySetting();
        else wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
      }
      return { res: null, mode: '' };
    });
  }).then(result => {
    page._dateSubmitting = false;
    page.setData({ dateAction: null });
    wx.hideLoading();
    if (!result || !result.res) return false;

    analytics.trackFirstAction(page.data.entryContext, result.mode);
    let title = result.mode === 'trip-only' ? '已加入行程，未设置提醒' : '提醒已设置，放票前见';
    if (result.mode === 'reminder' && result.res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip()) {
      title = '提醒已设置，先备好游客信息';
    }
    wx.showToast({ title, icon: 'none', duration: 2000 });
    return true;
  }).catch(err => {
    page._dateSubmitting = false;
    page.setData({ dateAction: null });
    wx.hideLoading();
    api.toastError(err);
    return false;
  });
}

function onDateClose(page) {
  if (!page) return;
  page.setData({ showDateSheet: false, dateAction: null });
}

module.exports = { openDateSheet, onDateConfirm, onDateClose };
