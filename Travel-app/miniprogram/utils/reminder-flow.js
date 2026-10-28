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
    if (!cartId) return Promise.resolve();
    /* 回滚必须等接口完成再结束“提交中”状态。否则用户刚取消授权就重试，
       列表里这一次的暂存项还没删掉，会被误判成“已在清单里”。 */
    return api.reminder.cart.remove(cartId).catch(() => {});
  };

  return api.reminder.cart.add({
    spotId: action.spotId,
    visitDate,
    remindOn: action.remindOn,
  }).then(added => {
    const cartId = added && added.cartId;
    /* 服务端按真实放票时刻决定这一项还能不能设提醒。用户勾了提醒、但放票时刻
       已经过去时，`cart.add` 会把 remindOn 落成 false。此时不能再走授权闸门：
       用户会白授权一次，最后仍只落一条没有提醒的行程。直接按“仅加行程”提交，
       并把“已过放票时间”如实带回页面。 */
    const reminderDowngraded = action.remindOn && added && added.remindOn === false;
    if (!action.remindOn || reminderDowngraded) {
      const payload = reminderDowngraded ? { cartId, disableReminders: true } : { cartId };
      return api.reminder.cart.commit(payload).then(res => ({
        res,
        mode: 'trip-only',
        expired: !!reminderDowngraded,
      }));
    }
    return notify.confirmReminderAccess(1).catch(err => {
      /* 授权链路自身异常时不能把刚加入的清单项留在暂存区，否则用户重试会看到
         “已在清单中”，而本次其实没有完成任何提醒设置。 */
      return rollbackAdded(cartId).then(() => { throw err; });
    }).then(access => {
      if (access.action === 'ready') {
        return api.reminder.cart.commit({ cartId, channels: ['OFFICIAL_ACCOUNT'], offsets: [5] })
          .then(res => ({ res, mode: 'reminder' }));
      }
      if (access.action === 'trip-only') {
        return api.reminder.cart.commit({ cartId, disableReminders: true })
          .then(res => ({ res, mode: 'trip-only' }));
      }
      return rollbackAdded(cartId).then(() => {
        if (access.action === 'settings') {
          notify.openReminderAccessSettings(access);
        } else if (access.action === 'cancelled') {
          notify.showReminderAccessCancelled(access);
        }
        return { res: null, mode: '' };
      });
    });
  }).then(result => {
    page._dateSubmitting = false;
    page.setData({ dateAction: null });
    wx.hideLoading();
    if (!result || !result.res) return false;

    analytics.trackFirstAction(page.data.entryContext, result.mode);
    let title;
    if (result.expired) {
      title = '已加入行程 · 已过放票时间，提醒无法设置';
    } else if (result.mode === 'trip-only') {
      title = '已加入行程，未设置提醒';
    } else if ((result.res.expiredReminder || 0) > 0) {
      /* 勾了提醒但放票时刻已经过去：服务端照常落行程项，只不建任务。
         这里必须和 setup / 首页挽回一样如实说「提醒无法设置」。 */
      title = `已加入行程 · ${result.res.expiredReminder} 项已过放票时间，提醒无法设置`;
    } else if ((result.res.createdTasks || 0) > 0) {
      title = '提醒已设置，放票前见';
    } else {
      title = '已加入行程，未设置提醒';
    }
    if (result.mode === 'reminder' && (result.res.createdTasks || 0) > 0 && notify.consumeFirstReminderSuccessTip()) {
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
