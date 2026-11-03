/**
 * 会员支付公共流程。
 *
 * 页面只决定“买哪个服务端返回的 packageId”，金额、权益和有效期全部由云端订单决定。
 * 普通微信支付与小程序虚拟支付共用同一套订单、查单和权益流程。
 * 客户端拉起成功只表示客户端流程结束，权益必须以 payment.query / 回调为准。
 * 返回值是持久的业务状态，页面不能再用短暂 Toast 代替支付结果。
 */

const api = require('./api.js');
const membershipCache = require('./membership-cache.js');

const QUERY_ATTEMPTS = 8;
const QUERY_INTERVAL_MS = 1200;
const PENDING_ORDER_KEY = 'membership_pending_order_v1';
const PENDING_ORDER_MAX_AGE_MS = 20 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RETRYABLE_STATUSES = new Set(['PENDING', 'PAID_GRANT_UNKNOWN']);

function newRequestId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `pay_${Date.now().toString(36)}_${random}`.slice(0, 80);
}

function storageGet() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
  try { return wx.getStorageSync(PENDING_ORDER_KEY) || null; } catch (err) { return null; }
}

function storageSet(value) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return;
  try { wx.setStorageSync(PENDING_ORDER_KEY, value); } catch (err) { /* 本地状态只用于恢复，不阻断支付 */ }
}

function storageRemove() {
  if (typeof wx === 'undefined' || !wx.removeStorageSync) return;
  try { wx.removeStorageSync(PENDING_ORDER_KEY); } catch (err) { /* ignore */ }
}

function rememberPendingOrder(orderId) {
  if (!orderId) return;
  storageSet({ orderId, rememberedAt: Date.now() });
}

function pendingOrder(now = Date.now()) {
  const saved = storageGet();
  if (!saved || !saved.orderId) return null;
  if (!saved.rememberedAt || Number(now) - Number(saved.rememberedAt) > PENDING_ORDER_MAX_AGE_MS) {
    storageRemove();
    return null;
  }
  return saved;
}

function clearPendingOrder(orderId) {
  const saved = storageGet();
  if (!saved || !orderId || saved.orderId === orderId) storageRemove();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loginCode() {
  return new Promise(resolve => {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
      resolve('');
      return;
    }
    wx.login({
      success: res => resolve((res && res.code) || ''),
      fail: () => resolve(''),
    });
  });
}

/**
 * 客户端是否具备拉起虚拟支付的能力。
 *
 * 只能判断 API 是否存在——它缺失就意味着微信版本过低，这是客户端能自证的
 * 唯一条件。iOS 版本、Apple ID 地区这类真机条件客户端查不到，只能由微信在
 * 拉起时否决。调用方据此在进入支付流程前给出可执行提示，而不是等失败再猜。
 */
function virtualPayCapability() {
  const supported = typeof wx !== 'undefined'
    && typeof wx.requestVirtualPayment === 'function';
  return {
    supported,
    reason: supported ? '' : '当前微信版本暂不支持虚拟支付',
  };
}

function requestVirtualPayment(payment, orderId) {
  return new Promise((resolve, reject) => {
    if (!virtualPayCapability().supported) {
      // unsupported 与「微信拒绝拉起」都是 1023，调用方需要分开提示。
      reject({
        errorCode: 1023,
        error: '当前微信版本暂不支持虚拟支付',
        orderId,
        unsupported: true,
      });
      return;
    }
    wx.requestVirtualPayment({
      ...payment,
      success: resolve,
      fail: err => {
        const message = String((err && err.errMsg) || '');
        const errorCode = Number(err && (err.errCode || err.errcode));
        if (errorCode === -2 || /cancel|canceled|cancelled|取消/i.test(message)) {
          reject({ cancelled: true, error: '支付未完成', orderId });
          return;
        }
        reject({
          errorCode: 1023,
          channelErrorCode: errorCode || 0,
          error: message || '支付未完成',
          orderId,
        });
      },
    });
  });
}

function requestPayment(payment, orderId, paymentProvider) {
  const virtual = paymentProvider === 'VIRTUAL_PAY'
    || (payment && payment.mode === 'short_series_goods');
  if (virtual) return requestVirtualPayment(payment, orderId);
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...payment,
      success: resolve,
      fail: err => {
        const message = String((err && err.errMsg) || '');
        if (/cancel|canceled|cancelled|取消/i.test(message)) {
          reject({ cancelled: true, error: '支付未完成', orderId });
          return;
        }
        reject({ errorCode: 1023, error: message || '支付未完成', orderId });
      },
    });
  });
}

function paidResultOf(result, orderId) {
  const entitlementStatus = (result && result.entitlementStatus) || '';
  if (entitlementStatus === 'PAID_GRANTED') {
    membershipCache.markDirty();
    return {
      status: 'PAID_GRANTED',
      orderId,
      memberExpiresAt: result.memberExpiresAt || null,
      taskPackCount: Number(result.taskPackCount) || 0,
      taskPackSlots: Number(result.taskPackSlots) || 0,
    };
  }
  if (entitlementStatus === 'PAID_GRANT_FAILED') {
    return { status: 'PAID_GRANT_FAILED', orderId, message: '支付已完成，权益发放异常' };
  }
  if (entitlementStatus === 'REFUNDED') {
    membershipCache.markDirty();
    return { status: 'REFUNDED', orderId, message: '订单已退款' };
  }
  if (entitlementStatus === 'PAID_GRANT_UNKNOWN') {
    return {
      status: 'PAID_GRANT_UNKNOWN',
      orderId,
      message: '支付已确认，权益发放状态待核验，请查看订单详情',
    };
  }
  if (result && result.status === 'CLOSED') {
    return { status: 'CLOSED', orderId, message: '订单已关闭' };
  }
  return null;
}

function shouldKeepPending(result) {
  return !!result && RETRYABLE_STATUSES.has(result.status);
}

async function cancelAfterUserCancel(orderId) {
  if (!orderId || !api.payment || typeof api.payment.cancel !== 'function') return null;
  const result = await api.payment.cancel({ orderId });
  const resolved = paidResultOf(result, orderId);
  if (resolved && !shouldKeepPending(resolved)) clearPendingOrder(orderId);
  return resolved || result || null;
}

async function waitForPaid(orderId) {
  let lastError = null;
  for (let i = 0; i < QUERY_ATTEMPTS; i += 1) {
    try {
      const result = await api.payment.query({ orderId });
      const resolved = paidResultOf(result, orderId);
      if (resolved) return resolved;
    } catch (err) {
      // 微信客户端已返回成功后，一次网络/云函数抖动不能把用户推回“支付失败”。
      // 继续轮询；仍无法确认时由服务端 2 分钟补偿兜底。
      lastError = err || { error: '支付结果查询失败' };
    }
    if (i < QUERY_ATTEMPTS - 1) await delay(QUERY_INTERVAL_MS);
  }
  return {
    status: 'PENDING',
    pending: true,
    orderId,
    message: lastError && lastError.error
      ? '暂时无法确认支付结果，权益不会丢失'
      : '正在确认支付结果，请勿重复支付',
  };
}

async function payExistingOrder(orderId) {
  if (!orderId) throw { errorCode: 1023, error: '订单不存在' };
  rememberPendingOrder(orderId);
  const code = await loginCode();
  const created = await api.payment.create({
    orderId,
    loginCode: code,
    clientSupportsVirtualPay: true,
  });
  const resolvedFromCreate = paidResultOf(created, orderId);
  if (resolvedFromCreate) {
    if (!shouldKeepPending(resolvedFromCreate)) clearPendingOrder(orderId);
    return resolvedFromCreate;
  }

  if (!created.mockPaid) {
    const channelPayment = created.virtualPayment || created.payment;
    if (!channelPayment) throw { errorCode: 1023, error: '支付参数缺失，请稍后再试', orderId };
    try {
      await requestPayment(channelPayment, orderId, created.paymentProvider);
    } catch (err) {
      if (err && err.cancelled) {
        try {
          const resolved = await cancelAfterUserCancel(orderId);
          if (resolved && resolved.status !== 'PENDING' && resolved.status !== 'CLOSED') return resolved;
        } catch (cancelErr) {
          // 取消动作本身不能覆盖原支付错误；订单仍保留在本地，后续可继续查单。
        }
      }
      throw { ...err, orderId: err.orderId || orderId };
    }
  }
  const result = await waitForPaid(orderId);
  if (!shouldKeepPending(result)) clearPendingOrder(orderId);
  return result;
}

async function purchase(packageId, options = {}) {
  const requestId = REQUEST_ID_PATTERN.test(String(options.requestId || ''))
    ? String(options.requestId)
    : newRequestId();
  const order = await api.reminder.membership.createOrder({ packageId, requestId });
  if (!order || !order.orderId) throw { errorCode: 1023, error: '订单创建失败' };
  return payExistingOrder(order.orderId);
}

module.exports = {
  purchase,
  payExistingOrder,
  requestPayment,
  requestVirtualPayment,
  virtualPayCapability,
  newRequestId,
  waitForPaid,
  paidResultOf,
  shouldKeepPending,
  rememberPendingOrder,
  pendingOrder,
  clearPendingOrder,
};
