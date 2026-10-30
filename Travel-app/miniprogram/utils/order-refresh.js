/**
 * 会员订单的状态收敛规则。
 *
 * 微信支付可能先完成退款，再异步回收本单权益；没有 HTTP 回调时，支付结果还会
 * 由 2 分钟定时补偿确认。页面只在这些“仍会变化”的状态下做有界刷新，终态立即停。
 */
const REFRESH_INTERVAL_MS = 5000;
const REFRESH_MAX_ATTEMPTS = 30;
const REFRESH_EXHAUSTED_HINT = '状态仍在处理中，请下拉刷新或稍后重新进入';
const REFUND_PROGRESS = ['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'];

function isExpiredPendingOrder(order, nowMs) {
  if (!order || order.status !== 'PENDING') return false;
  if (order.isExpired === true) return true;
  const expiresMs = new Date(order.expiresAt || 0).getTime();
  return Number.isFinite(expiresMs) && expiresMs > 0 && expiresMs <= nowMs;
}

function isTransientOrder(order, nowMs = Date.now()) {
  if (!order) return false;
  const refundStatus = order.refundStatus || 'NONE';
  if (REFUND_PROGRESS.includes(refundStatus)) return true;
  /* 微信已退款，但本单新增权益可能还在回收队列里。 */
  const revertedAt = order.entitlementGrant && order.entitlementGrant.revertedAt;
  if (refundStatus === 'REFUNDED' && order.grantStatus === 'GRANTED' && !revertedAt) return true;
  if (order.status === 'PAID' && order.grantStatus === 'FAILED') return true;
  if (order.status === 'PENDING') return !isExpiredPendingOrder(order, nowMs);
  return false;
}

function hasTransientOrder(orders, nowMs = Date.now()) {
  return (orders || []).some(order => isTransientOrder(order, nowMs));
}

function refreshHintOf(orders, nowMs = Date.now()) {
  const items = orders || [];
  if (items.some(order => REFUND_PROGRESS.includes(order.refundStatus || 'NONE'))) {
    return '退款处理中，会员与提醒名额状态会自动更新';
  }
  if (items.some(order => order.refundStatus === 'REFUNDED' && order.grantStatus === 'GRANTED')) {
    return '退款已到账，正在回收本单权益，页面会自动更新';
  }
  if (items.some(order => order.status === 'PAID' && order.grantStatus === 'FAILED')) {
    return '支付已完成，权益正在自动补发，请勿重复支付';
  }
  if (items.some(order => isTransientOrder(order, nowMs))) {
    return '支付结果确认中，权益到账后页面会自动更新';
  }
  return '';
}

module.exports = {
  REFRESH_INTERVAL_MS,
  REFRESH_MAX_ATTEMPTS,
  REFRESH_EXHAUSTED_HINT,
  isTransientOrder,
  hasTransientOrder,
  refreshHintOf,
};
