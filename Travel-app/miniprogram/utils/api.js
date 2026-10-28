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

/**
 * 写操作完成后标记首页数据版本，供 `onShow` 绕过自适应复用窗口。
 *
 * 典型断点：用户在景点页设完提醒后立刻回首页，首页仍处在 180 秒复用窗口内，
 * 于是继续回放旧缓存 —— 新提醒对应的额度预警/放票横幅要等窗口过期才出现。
 * 这里只递增版本号，不碰任何业务状态；首页读取版本后决定是否必须重新 bootstrap。
 */
function markHomeDataDirty() {
  try {
    const app = getApp();
    if (!app || !app.globalData) return;
    app.globalData.homeDataVersion = (Number(app.globalData.homeDataVersion) || 0) + 1;
  } catch (e) {}
}

/** 会改变首页行程/提醒/授权的写调用：成功后统一让首页缓存失效。 */
function homeMutationCall(name, data) {
  return call(name, data).then(res => {
    markHomeDataDirty();
    return res;
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
  /* 首页聚合（V2）：一次返回行程状态墙的全部数据 ——
     serverNow / primaryTripId / trips[progress,items] / history / stickyBanner / hotSpots */
  home: {
    bootstrap: (p) => call('reminder', { action: 'home.bootstrap', ...(p || {}) }),
  },
  trip: {
    create: (p) => call('reminder', { action: 'trip.create', ...p }),
    list: () => call('reminder', { action: 'trip.list' }),
    updateSpots: (p) => call('reminder', { action: 'trip.updateSpots', ...p }),
    updateRange: (p) => call('reminder', { action: 'trip.updateRange', ...p }),
    remove: (p) => call('reminder', { action: 'trip.remove', ...p }),
  },
  timeline: {
    /* 旧口径：按已落库的行程算。首页改纯预览后已无调用方，保留兼容 */
    generate: (p) => call('reminder', { action: 'timeline.generate', ...p }),
    /* 2026-09-20：按当前所选日期段与景点独立计算，不创建/改写行程，
       也不带入任何已落库状态（所以预览里不会出现「已在行程」） */
    preview: (p) => call('reminder', { action: 'timeline.preview', ...p }),
  },
  /* 行程项（API-契约 8.4）。itemId 是对外主键：
     任务、删除、提醒状态和推送落地全部按它关联 */
  tripItem: {
    markResult: (p) => call('reminder', { action: 'tripItem.markResult', ...p }),
    undoResult: (p) => call('reminder', { action: 'tripItem.undoResult', ...p }),
    updateReminder: (p) => homeMutationCall('reminder', { action: 'tripItem.updateReminder', ...p }),
    remove: (p) => call('reminder', { action: 'tripItem.remove', ...p }),
    removeVisitDate: (p) => call('reminder', { action: 'tripItem.removeVisitDate', ...p }),
    /* 「建议」入口是固定的：误关浮层后随时能重新打开，不做「只能调一次」的限制 */
    recoveryCandidates: (p) => call('reminder', { action: 'tripItem.recoveryCandidates', ...p }),
  },
  cart: {
    add: (p) => call('reminder', { action: 'cart.add', ...p }),
    addAll: (p) => call('reminder', { action: 'cart.addAll', ...p }),
    updateRemindOn: (p) => call('reminder', { action: 'cart.updateRemindOn', ...p }),
    commit: (p) => homeMutationCall('reminder', { action: 'cart.commit', ...p }),
    remove: (cartId) => call('reminder', { action: 'cart.remove', cartId }),
    clear: (tripId) => call('reminder', { action: 'cart.clear', tripId }),
    /* 生成时间线后清理不在本次日期段/景点集合里的暂存草稿 */
    pruneScope: (p) => call('reminder', { action: 'cart.pruneScope', ...p }),
    /* 不传 tripId = 读「当前暂存清单」（纯预览化后清单不再挂在行程上） */
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
    updateProfile: (p) => call('reminder', { action: 'user.updateProfile', ...p }),
    updateNotifyPrefs: (notifyPrefs) => call('reminder', { action: 'user.updateNotifyPrefs', notifyPrefs }),
  },
  subscribe: {
    add: (templateId) => homeMutationCall('reminder', { action: 'subscribe.add', templateId }),
    get: (templateId) => call('reminder', { action: 'subscribe.get', templateId }),
  },
};

/* ===== feedback（意见反馈 / 信息纠错） ===== */
const feedback = {
  submit: (p) => call('feedback', { action: 'feedback.submit', ...p }),
  list: () => call('feedback', { action: 'feedback.list' }),
  /* 管理端（反馈管理页，后端 openid 白名单鉴权） */
  adminStatus: () => call('feedback', { action: 'feedback.adminStatus' }),
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
    1002: '这条已经在清单里啦',
    1005: '数据更新中',
    1006: '行程日期不合法',
    1007: '跳转失败，已复制链接',
    1009: '先添加至少一条提醒',
    1010: '请检查输入',
    1011: '提交失败，请重试',
    1012: '仅待提醒的任务可以删除',
    1013: '这条行程项已不存在',
    1014: '现在还不能标记结果',
    1015: '已超过撤销时间',
    1016: '行程项所在日期已结束',
    1017: '已过放票时间，提醒无法开启或取消',
    1020: '请填写反馈内容',
    1500: '服务异常，请稍后重试',
  };
  if (result && map[result.errorCode]) {
    wx.showToast({ title: map[result.errorCode], icon: 'none' });
    return;
  }
  if (result && result.error) {
    wx.showToast({ title: result.error, icon: 'none' });
    return;
  }
  /* 走到这里说明**不是业务错误，而是调用本身失败了**——最常见的是云函数还没部署，
     或 appid / cloudEnv 不配对。原来一律显示「操作失败」，等于把真正的原因
     （`errMsg` 里写得很清楚）丢掉了，排查时只能靠猜。
     ⚠️ 别再退回成一句笼统文案：静默失败正是这个项目反复踩过的坑。 */
  const raw = (result && (result.errMsg || result.errmsg)) || '';
  if (raw) {
    /* 剥掉「cloud.callFunction:fail 」「Error: 」这类前缀噪音，优先取 errMsg 后面的正文 */
    const text = String(raw).replace(/^cloud\.callFunction:fail\s*/i, '').replace(/^Error:\s*/i, '');
    const hit = /errMsg:\s*(.+)$/.exec(text);
    /* 微信的错误正文本身很长，取前 40 字保住 Toast 可见性 */
    const brief = (hit ? hit[1] : text).trim().slice(0, 40);
    console.error('[api] 云函数调用失败：', raw);
    wx.showToast({ title: brief || '云函数调用失败', icon: 'none' });
    return;
  }
  wx.showToast({ title: '操作失败', icon: 'none' });
}

module.exports = { spots, reminder, feedback, ics, toastError, markHomeDataDirty };
