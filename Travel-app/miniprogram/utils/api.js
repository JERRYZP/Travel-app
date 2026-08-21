/**
 * 云函数调用封装 — 对应 API-契约.md
 */

const { mockCall, USE_MOCK } = require('./mock.js');

function call(name, data) {
  if (USE_MOCK) return mockCall(name, data);
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: res => {
        if (res.result && res.result.success === false) {
          reject(res.result);
        } else {
          resolve(res.result);
        }
      },
      fail: err => reject(err),
    });
  });
}

/* ===== spots ===== */
const spots = {
  list: () => call('spots', { action: 'list' }),
  detail: (spotId) => call('spots', { action: 'detail', spotId }),
  batch: (spotIds) => call('spots', { action: 'batch', spotIds }),
  search: (keyword) => call('spots', { action: 'search', keyword }),
  searchHistory: () => call('spots', { action: 'searchHistory' }),
  clearSearchHistory: () => call('spots', { action: 'clearSearchHistory' }),
};

/* ===== reminder ===== */
const reminder = {
  trip: {
    create: (p) => call('reminder', { action: 'trip.create', ...p }),
    list: () => call('reminder', { action: 'trip.list' }),
    updateSpots: (p) => call('reminder', { action: 'trip.updateSpots', ...p }),
    updateRange: (p) => call('reminder', { action: 'trip.updateRange', ...p }),
  },
  timeline: {
    generate: (p) => call('reminder', { action: 'timeline.generate', ...p }),
  },
  cart: {
    add: (p) => call('reminder', { action: 'cart.add', ...p }),
    addAll: (p) => call('reminder', { action: 'cart.addAll', ...p }),
    remove: (cartId) => call('reminder', { action: 'cart.remove', cartId }),
    clear: (tripId) => call('reminder', { action: 'cart.clear', tripId }),
    list: (tripId) => call('reminder', { action: 'cart.list', tripId }),
  },
  task: {
    submit: (p) => call('reminder', { action: 'task.submit', ...p }),
    list: (p) => call('reminder', { action: 'task.list', ...p }),
    remove: (taskId) => call('reminder', { action: 'task.remove', taskId }),
    clear: (p) => call('reminder', { action: 'task.clear', ...(p || {}) }),
  },
  user: {
    profile: () => call('reminder', { action: 'user.profile' }),
    updateNotifyPrefs: (notifyPrefs) => call('reminder', { action: 'user.updateNotifyPrefs', notifyPrefs }),
  },
  subscribe: {
    add: (templateId) => call('reminder', { action: 'subscribe.add', templateId }),
    get: (templateId) => call('reminder', { action: 'subscribe.get', templateId }),
  },
};

/* ===== feedback（意见反馈 / 信息纠错） ===== */
const feedback = {
  submit: (p) => call('feedback', { action: 'feedback.submit', ...p }),
  list: () => call('feedback', { action: 'feedback.list' }),
  /* 管理端（反馈管理页，后端 openid 白名单鉴权） */
  adminList: (p) => call('feedback', { action: 'feedback.adminList', ...p }),
  adminUpdateStatus: (p) => call('feedback', { action: 'feedback.adminUpdateStatus', ...p }),
};

/* ===== ICS ===== */
const ics = {
};

/* ===== Toast helpers ===== */
function toastError(result) {
  const map = {
    1001: '景点不存在',
    1002: '这条提醒已经在清单里啦',
    1005: '数据更新中',
    1006: '行程日期不合法',
    1007: '跳转失败，已复制链接',
    1009: '先添加至少一条提醒',
    1010: '请检查输入',
    1011: '提交失败，请重试',
    1012: '仅待提醒的任务可以删除',
    1500: '服务异常，请稍后重试',
  };
  const msg = (result && map[result.errorCode]) || (result && result.error) || '操作失败';
  wx.showToast({ title: msg, icon: 'none' });
}

module.exports = { spots, reminder, feedback, ics, toastError };
