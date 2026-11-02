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

/* `spots.list` 是只读静态数据（真身 data/spots.json），无参数、无用户态，而
   景点库 / 添加行程 / 分享场景页 / 首页空态各自的 onLoad 都会拉一次同一份全量数据。
   加一层短 TTL 内存缓存，连续进这几个页面时只发一次（2026-10-13 调用量优化）。
   ⚠️ TTL 保持分钟级：首页空态那次请求的价值之一就是「感知服务端规则变更」（见
   pages/home/home.js 的 loadHotSpots），缓存太久会让人迟迟看不到规则更新。 */
const SPOTS_LIST_TTL_MS = 3 * 60 * 1000;
let spotsListCache = { at: 0, res: null };

const spots = {
  list: () => {
    const hit = spotsListCache.res;
    if (hit && (Date.now() - spotsListCache.at) < SPOTS_LIST_TTL_MS) {
      /* 每次给一个新的 data 数组：调用方对自己的副本排序/裁剪时不会污染缓存。
         元素对象本身是只读的业务数据，共享引用即可。 */
      return Promise.resolve({ ...hit, data: Array.isArray(hit.data) ? hit.data.slice() : hit.data });
    }
    return call('spots', { action: 'list' }).then(res => {
      spotsListCache = { at: Date.now(), res };
      return res;
    });
  },
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
    planDates: (p) => call('reminder', { action: 'cart.planDates', ...p }),
    addDates: (p) => call('reminder', { action: 'cart.addDates', ...p }),
    add: (p) => call('reminder', { action: 'cart.add', ...p }),
    addAll: (p) => call('reminder', { action: 'cart.addAll', ...p }),
    updateRemindOn: (p) => call('reminder', { action: 'cart.updateRemindOn', ...p }),
    commit: (p) => homeMutationCall('reminder', { action: 'cart.commit', ...p }),
    remove: (cartId) => call('reminder', { action: 'cart.remove', cartId }),
    clear: (tripId) => call('reminder', { action: 'cart.clear', tripId }),
    /* 生成时间线后清理不在本次日期段/景点集合里的暂存草稿 */
    pruneScope: (p) => call('reminder', { action: 'cart.pruneScope', ...p }),
    /* 不传 tripId = 读「当前暂存清单」（纯预览化后清单不再挂在行程上） */
    list: (tripId, options) => call('reminder', {
      action: 'cart.list',
      tripId,
      includeMembership: !!(options && options.includeMembership),
    }),
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
  membership: {
    status: () => call('reminder', { action: 'membership.status' }),
    createOrder: (p) => call('reminder', { action: 'membership.createOrder', ...(p || {}) }),
    orders: () => call('reminder', { action: 'membership.orders' }),
    orderDetail: (orderId) => call('reminder', { action: 'membership.orderDetail', orderId }),
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

/* ===== payment ===== */
const payment = {
  create: (p) => call('payment', { action: 'create', ...(p || {}) }),
  query: (p) => call('payment', { action: 'query', ...(p || {}) }),
  cancel: (p) => call('payment', { action: 'cancel', ...(p || {}) }),
  afterSales: {
    submit: (p) => call('payment', { action: 'afterSales.submit', ...(p || {}) }),
    cancel: (caseId) => call('payment', { action: 'afterSales.cancel', caseId }),
    list: () => call('payment', { action: 'afterSales.list' }),
    detail: (caseId) => call('payment', { action: 'afterSales.detail', caseId }),
    syncRights: (orderId) => call('payment', { action: 'afterSales.syncRights', orderId }),
    adminStatus: () => call('payment', { action: 'afterSales.adminStatus' }),
    adminSetMembershipSales: (p) => call('payment', {
      action: 'afterSales.adminSetMembershipSales', ...(p || {}),
    }),
    adminList: (p) => call('payment', { action: 'afterSales.adminList', ...(p || {}) }),
    adminDetail: (caseId) => call('payment', { action: 'afterSales.adminDetail', caseId }),
    adminApproveRefund: (caseId) => call('payment', { action: 'afterSales.adminApproveRefund', caseId }),
    adminReject: (p) => call('payment', { action: 'afterSales.adminReject', ...(p || {}) }),
    adminSyncPayment: (caseId) => call('payment', { action: 'afterSales.adminSyncPayment', caseId }),
    adminRetryGrant: (caseId) => call('payment', { action: 'afterSales.adminRetryGrant', caseId }),
    adminSyncRefund: (caseId) => call('payment', { action: 'afterSales.adminSyncRefund', caseId }),
    adminMigrateProtection: (cursor) => call('payment', {
      action: 'afterSales.adminMigrateProtection', cursor: cursor || null,
    }),
  },
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
    1008: '授权次数已变化，请重新点击开启',
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
    1022: '请先开通会员再加购提醒名额',
    1023: '支付通道准备中，请稍后再试',
    1024: '订单不存在或已失效',
    1025: '订单金额校验失败',
    1026: '提醒名额不足，请先开通会员或加购名额',
    1027: '订单已过期，请重新下单',
    1028: '该订单已有处理中的售后申请',
    1029: '当前订单暂不符合退款条件',
    1030: '售后记录不存在',
    1032: '会员购买暂停中，请稍后再试',
    1040: '无权限执行此操作',
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

module.exports = { spots, reminder, feedback, payment, ics, toastError, markHomeDataDirty };
