/**
 * 支付订单状态机（唯一发放入口）
 *
 * 客户端只能创建 PENDING 订单并拉起支付；会员与任务位只在这里按
 * 已支付订单发放。金额、商品类型和赠送任务位都来自服务端订单快照。
 */

const {
  COLLECTIONS, ERRORS, MemberLevel, OrderStatus, ok, fail,
} = require('./schema');

const DAY_MS = 24 * 60 * 60 * 1000;

function amountOf(payment = {}) {
  const raw = payment.totalFee != null ? payment.totalFee : payment.total_fee;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function findOrderById(db, orderId) {
  if (!orderId) return null;
  const res = await db.collection(COLLECTIONS.ORDERS).where({ _id: orderId }).get();
  return (res.data || [])[0] || null;
}

async function findOrderByOutTradeNo(db, outTradeNo) {
  if (!outTradeNo) return null;
  const res = await db.collection(COLLECTIONS.ORDERS).where({ outTradeNo }).get();
  return (res.data || [])[0] || null;
}

/**
 * 幂等地把 PENDING 订单置为 PAID，并发放对应权益。
 * 金额不一致时不发放；重复回调只返回 alreadyPaid，不会重复加任务位。
 */
async function fulfillOrder(db, order, payment = {}) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const paidAmount = amountOf(payment);
  if (paidAmount !== null && paidAmount !== Number(order.amountFen)) {
    return fail(ERRORS.ORDER_AMOUNT_MISMATCH);
  }
  if (order.status === OrderStatus.PAID) {
    return ok({ orderId: order._id, alreadyPaid: true });
  }
  if (order.status !== OrderStatus.PENDING) {
    return fail(ERRORS.ORDER_NOT_FOUND);
  }

  const userRes = await db.collection(COLLECTIONS.USERS).where({ openId: order.userId }).get();
  const user = (userRes.data || [])[0];
  if (!user) return fail(ERRORS.UNAUTHORIZED);

  const nowTs = new Date();
  const transactionId = payment.transactionId || payment.transaction_id || '';
  const userPatch = {
    memberLevel: MemberLevel.MEMBER,
    memberSince: user.memberSince || nowTs,
    memberOrderId: order._id,
  };
  const currentExpiryMs = new Date(user.memberExpiresAt || 0).getTime();
  const validCurrentExpiry = Number.isFinite(currentExpiryMs) && currentExpiryMs > nowTs.getTime()
    ? currentExpiryMs
    : nowTs.getTime();
  const memberDays = Math.max(0, Number(order.memberDays) || 0);
  const memberFloorDays = Math.max(0, Number(order.memberFloorDays) || 0);
  const expiryCandidates = [
    memberDays > 0 ? validCurrentExpiry + memberDays * DAY_MS : 0,
    memberFloorDays > 0 ? nowTs.getTime() + memberFloorDays * DAY_MS : 0,
    currentExpiryMs > 0 ? currentExpiryMs : 0,
  ];
  const nextExpiryMs = Math.max(...expiryCandidates);
  userPatch.memberExpiresAt = new Date(nextExpiryMs);
  if (order.productType === 'TASK_PACK') {
    userPatch.taskPackCount = Math.max(0, parseInt(user.taskPackCount, 10) || 0) + 1;
  }

  const transaction = await db.startTransaction();
  try {
    await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({ data: userPatch });
    await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        status: OrderStatus.PAID,
        paidAt: nowTs,
        transactionId,
        paymentResult: payment,
      },
    });
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    return fail({ code: 1500, message: `订单发放失败：${err.message}` });
  }

  return ok({
    orderId: order._id,
    status: OrderStatus.PAID,
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: userPatch.memberExpiresAt,
    taskPackCount: userPatch.taskPackCount != null
      ? userPatch.taskPackCount
      : (parseInt(user.taskPackCount, 10) || 0),
  });
}

function isCallbackPaidResult(result = {}) {
  const returnCode = result.returnCode || result.return_code;
  const resultCode = result.resultCode || result.result_code;
  const hasCodes = !!(returnCode || resultCode);
  if (returnCode && returnCode !== 'SUCCESS') return false;
  if (resultCode && resultCode !== 'SUCCESS') return false;
  const tradeState = result.tradeState || result.trade_state;
  return tradeState ? tradeState === 'SUCCESS' : hasCodes;
}

function isQueryPaidResult(result = {}) {
  return result.tradeState === 'SUCCESS'
    || result.trade_state === 'SUCCESS';
}

module.exports = {
  amountOf,
  findOrderById,
  findOrderByOutTradeNo,
  fulfillOrder,
  isCallbackPaidResult,
  isQueryPaidResult,
};
