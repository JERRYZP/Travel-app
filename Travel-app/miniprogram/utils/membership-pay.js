/**
 * 会员支付公共流程。
 *
 * 页面只决定“买哪个服务端返回的 packageId”，金额、权益和有效期全部由云端订单决定。
 * wx.requestPayment 成功只表示客户端流程结束，权益必须以 payment.query / 回调为准。
 * 返回值是持久的业务状态，页面不能再用短暂 Toast 代替支付结果。
 */

const api = require('./api.js');

const QUERY_ATTEMPTS = 8;
const QUERY_INTERVAL_MS = 1200;
const PENDING_ORDER_KEY = 'membership_pending_order_v1';
const PENDING_ORDER_MAX_AGE_MS = 20 * 60 * 1000;

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

function requestPayment(payment, orderId) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...payment,
      success: resolve,
      fail: err => {
        const message = String((err && err.errMsg) || '');
        if (/cancel/i.test(message)) {
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
    return {
      status: 'PAID_GRANTED',
      orderId,
      memberExpiresAt: result.memberExpiresAt || null,
      taskPackCount: Number(result.taskPackCount) || 0,
    };
  }
  if (entitlementStatus === 'PAID_GRANT_FAILED') {
    return { status: 'PAID_GRANT_FAILED', orderId, message: '支付已完成，权益发放异常' };
  }
  if (entitlementStatus === 'REFUNDED') {
    return { status: 'REFUNDED', orderId, message: '订单已退款' };
  }
  if (result && result.status === 'PAID') {
    // 兼容旧版 payment.query 返回；新版后端始终带 entitlementStatus。
    return { status: 'PAID_GRANTED', orderId, memberExpiresAt: result.memberExpiresAt || null, taskPackCount: Number(result.taskPackCount) || 0 };
  }
  if (result && result.status === 'CLOSED') {
    return { status: 'CLOSED', orderId, message: '订单已关闭' };
  }
  return null;
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
  const created = await api.payment.create({ orderId });
  const resolvedFromCreate = paidResultOf(created, orderId);
  if (resolvedFromCreate) {
    clearPendingOrder(orderId);
    return resolvedFromCreate;
  }

  if (!created.mockPaid) {
    if (!created.payment) throw { errorCode: 1023, error: '支付参数缺失，请稍后再试', orderId };
    try {
      await requestPayment(created.payment, orderId);
    } catch (err) {
      throw { ...err, orderId: err.orderId || orderId };
    }
  }
  const result = await waitForPaid(orderId);
  if (result.status !== 'PENDING') clearPendingOrder(orderId);
  return result;
}

async function purchase(packageId) {
  const order = await api.reminder.membership.createOrder({ packageId });
  if (!order || !order.orderId) throw { errorCode: 1023, error: '订单创建失败' };
  return payExistingOrder(order.orderId);
}

module.exports = {
  purchase,
  payExistingOrder,
  requestPayment,
  waitForPaid,
  paidResultOf,
  rememberPendingOrder,
  pendingOrder,
  clearPendingOrder,
};
