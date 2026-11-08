/**
 * 云函数调用封装 — 对应 API-契约.md
 */

const { mockCall, USE_MOCK } = require('./mock.js');
const spotsStatic = require('./spots-static.js');

const READ_ACTIONS = new Set([
  'home.bootstrap',
  'timeline.preview',
  'cart.list',
  'cart.bootstrap',
  'user.profile',
  'user.bootstrap',
  'subscribe.get',
  'membership.status',
  'membership.orders',
  'membership.orderDetail',
  'feedback.list',
  'feedback.entrySummary',
  'feedback.adminStatus',
  'payment.query',
  'payment.afterSales.list',
  'payment.afterSales.detail',
  'payment.afterSales.adminStatus',
  'payment.adminOrders.list',
  'payment.adminOrders.stats',
  'payment.adminOrders.detail',
  'payment.feedbackReward.adminStatus',
]);

const inflightReads = new Map();
const failedReads = new Map();
const READ_RETRY_BACKOFF_MS = 1500;
const MEMBERSHIP_CAPABILITIES = Object.freeze(['unlimited-v3', 'two-tier-v5']);

/**
 * 会员契约能力声明由客户端统一注入。老版本不会带此字段，服务端因此继续返回
 * legacy-v2 套餐和额度，不依赖发布后等待旧包覆盖率归零。
 */
function withRequestCapabilities(name, data) {
  if (name !== 'reminder' || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...data, membershipCapabilities: [...MEMBERSHIP_CAPABILITIES] };
}

function requestKey(name, data) {
  let payload = '';
  try {
    payload = JSON.stringify(data || {});
  } catch (e) {
    payload = String(Date.now());
  }
  return `${name}:${payload}`;
}

function call(name, data, options) {
  /* 新旧契约都走请求级能力门禁；未声明能力的旧客户端继续由服务端回退。 */
  const payload = withRequestCapabilities(
    name,
    name === 'reminder' ? { supportsMultiRelease: true, ...(data || {}) } : data
  );
  if (USE_MOCK) return mockCall(name, payload);
  const action = payload && payload.action;
  const canCoalesce = READ_ACTIONS.has(action) && !(options && options.noCoalesce);
  const key = canCoalesce ? requestKey(name, payload) : '';
  if (canCoalesce && inflightReads.has(key)) return inflightReads.get(key);
  if (canCoalesce) {
    const failed = failedReads.get(key);
    if (failed && failed.until > Date.now()) return Promise.reject(failed.error);
    if (failed) failedReads.delete(key);
  }

  const request = new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: payload,
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
  if (canCoalesce) {
    inflightReads.set(key, request);
    request.then(
      () => inflightReads.delete(key),
      err => {
        inflightReads.delete(key);
        /* 只对网络/平台失败做短暂退避；业务错误由页面立即处理，不人为延迟。 */
        if (canCoalesce && !(err && err.errorCode)) {
          if (failedReads.size >= 100) failedReads.clear();
          failedReads.set(key, { until: Date.now() + READ_RETRY_BACKOFF_MS, error: err });
        }
      }
    );
  }
  return request;
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
  list: () => (USE_MOCK ? call('spots', { action: 'list' }) : spotsStatic.list()),
  detail: (spotId) => (USE_MOCK ? call('spots', { action: 'detail', spotId }) : spotsStatic.detail(spotId)),
  batch: (spotIds) => (USE_MOCK ? call('spots', { action: 'batch', spotIds }) : spotsStatic.batch(spotIds)),
  search: (keyword) => (USE_MOCK ? call('spots', { action: 'search', keyword }) : spotsStatic.search(keyword)),
  searchHistory: () => (USE_MOCK ? call('spots', { action: 'searchHistory' }) : spotsStatic.searchHistory()),
  clearSearchHistory: () => (USE_MOCK ? call('spots', { action: 'clearSearchHistory' }) : spotsStatic.clearSearchHistory()),
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
  tripShare: {
    create: (p) => homeMutationCall('reminder', { action: 'tripShare.create', ...p }),
    status: (p) => call('reminder', { action: 'tripShare.status', ...p }),
    revoke: (p) => homeMutationCall('reminder', { action: 'tripShare.revoke', ...p }),
    open: (token) => call('reminder', { action: 'tripShare.open', token }),
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
    planQuickDates: (p) => call('reminder', { action: 'cart.planQuickDates', ...p }),
    quickCommit: (p) => homeMutationCall('reminder', { action: 'cart.quickCommit', ...p }),
    addDates: (p) => call('reminder', { action: 'cart.addDates', ...p }),
    bootstrap: () => call('reminder', { action: 'cart.bootstrap' }),
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
    bootstrap: () => call('reminder', { action: 'user.bootstrap' }),
    updateProfile: (p) => call('reminder', { action: 'user.updateProfile', ...p }),
    updateNotifyPrefs: (notifyPrefs) => call('reminder', { action: 'user.updateNotifyPrefs', notifyPrefs }),
  },
  subscribe: {
    add: (templateId) => homeMutationCall('reminder', { action: 'subscribe.add', templateId }),
    get: (templateId) => call('reminder', { action: 'subscribe.get', templateId }),
  },
  membership: {
    status: () => call('reminder', { action: 'membership.status' }),
    previewStatus: (preview) => mockCall('membership.status', { preview }),
    previewOrders: () => mockCall('membership.orders', { preview: true }),
    createOrder: (p) => call('reminder', { action: 'membership.createOrder', ...(p || {}) }),
    orders: () => call('reminder', { action: 'membership.orders' }),
    orderDetail: (orderId) => call('reminder', { action: 'membership.orderDetail', orderId }),
  },
};

/* ===== feedback（意见反馈 / 信息纠错） ===== */
const feedback = {
  submit: (p) => call('feedback', { action: 'feedback.submit', ...p }),
  list: () => call('feedback', { action: 'feedback.list' }),
  entrySummary: () => call('feedback', { action: 'feedback.entrySummary' }),
  markSeen: (p) => call('feedback', { action: 'feedback.markSeen', ...(p || {}) }),
  /* 管理端（反馈管理页，后端 openid 白名单鉴权） */
  adminStatus: () => call('feedback', { action: 'feedback.adminStatus' }),
  adminList: (p) => call('feedback', { action: 'feedback.adminList', ...p }),
  adminAddReply: (p) => call('feedback', { action: 'feedback.adminAddReply', ...p }),
  adminUpdateReply: (p) => call('feedback', { action: 'feedback.adminUpdateReply', ...p }),
  adminReply: (p) => call('feedback', { action: 'feedback.adminReply', ...p }),
  adminUpdateStatus: (p) => call('feedback', { action: 'feedback.adminUpdateStatus', ...p }),
};

/* ===== payment ===== */
const payment = {
  create: (p) => call('payment', { action: 'create', ...(p || {}) }),
  query: (p) => call('payment', { action: 'query', ...(p || {}) }),
  cancel: (p) => call('payment', { action: 'cancel', ...(p || {}) }),
  adminOrders: {
    list: (p) => call('payment', { action: 'adminOrders.list', ...(p || {}) }),
    stats: () => call('payment', { action: 'adminOrders.stats' }),
    detail: (orderId) => call('payment', { action: 'adminOrders.detail', orderId }),
  },
  adminReminderQuality: {
    stats: () => call('payment', { action: 'adminReminderQuality.stats' }),
  },
  feedbackReward: {
    adminStatus: () => call('payment', { action: 'feedbackReward.adminStatus' }),
    adminGrant: (feedbackId) => call('payment', { action: 'feedbackReward.adminGrant', feedbackId }),
    adminRevoke: (feedbackId) => call('payment', { action: 'feedbackReward.adminRevoke', feedbackId }),
  },
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
    adminSetMembershipEnforcement: (p) => call('payment', {
      action: 'afterSales.adminSetMembershipEnforcement', ...(p || {}),
    }),
    adminSetMembershipPricing: (p) => call('payment', {
      action: 'afterSales.adminSetMembershipPricing', ...(p || {}),
    }),
    adminSetMembershipUpgradeNotice: (p) => call('payment', {
      action: 'afterSales.adminSetMembershipUpgradeNotice', ...(p || {}),
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
    1022: '请先开通会员',
    1023: '支付通道准备中，请稍后再试',
    1024: '订单不存在或已失效',
    1025: '订单金额校验失败',
    1026: '提醒名额不足，请先开通会员',
    1027: '订单已过期，请重新下单',
    1028: '该订单已有处理中的售后申请',
    1029: '当前订单暂不符合退款条件',
    1030: '售后记录不存在',
    1032: '会员购买暂停中，请稍后再试',
    1033: '上线前迁移未完成，不能切换全量',
    1040: '无权限执行此操作',
    1041: '当前行程暂不可分享',
    1042: '这份行程暂时无法查看',
    1043: '反馈不存在',
    1044: '回复内容不能为空',
    1045: '回复条数已达上限',
    1046: '回复不存在或已被更新',
    1047: '该反馈奖励已撤回，不能重复发放',
    1048: '奖励后已有新的会员权益，不能自动撤回',
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
