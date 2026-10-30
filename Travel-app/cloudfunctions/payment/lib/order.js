/**
 * 支付订单状态机（唯一发放入口）
 *
 * 客户端只能创建 PENDING 订单并拉起支付；会员与提醒名额只在这里按
 * 已支付订单发放。金额、商品类型和权益都来自服务端订单快照。
 */

const {
  COLLECTIONS, ERRORS, MemberLevel, OrderStatus, RefundStatus, GrantStatus, ok, fail,
} = require('./schema');

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_TTL_MS = 15 * 60 * 1000;
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function amountOf(payment = {}) {
  const raw = payment.amount && typeof payment.amount === 'object'
    ? payment.amount.total
    : (payment.totalFee != null ? payment.totalFee : payment.total_fee);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function dateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function rollbackQuietly(transaction) {
  try { await transaction.rollback(); } catch (err) { /* 无写入事务或已结束事务无需回滚 */ }
}

function orderExpiresAtMs(order = {}) {
  const explicit = dateMs(order.expiresAt);
  if (explicit) return explicit;
  const created = dateMs(order.createdAt);
  return created ? created + ORDER_TTL_MS : 0;
}

function isOrderExpired(order = {}, now = new Date()) {
  const expiresAt = orderExpiresAtMs(order);
  return !!expiresAt && expiresAt <= new Date(now).getTime();
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

async function findCaseByOutRefundNo(db, outRefundNo) {
  if (!outRefundNo) return null;
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES).where({ outRefundNo }).get();
  return (res.data || [])[0] || null;
}

function grantStateOf(order = {}) {
  if (order.status !== OrderStatus.PAID) {
    return order.status === OrderStatus.CLOSED ? 'CLOSED' : 'PENDING';
  }
  if (order.grantStatus === GrantStatus.REVERTED || order.refundStatus === RefundStatus.REFUNDED) {
    return 'REFUNDED';
  }
  if (order.grantStatus === GrantStatus.FAILED) return 'PAID_GRANT_FAILED';
  return 'PAID_GRANTED';
}

function paymentViewOf(order = {}) {
  return {
    orderId: order._id,
    status: order.status,
    entitlementStatus: grantStateOf(order),
    refundStatus: order.refundStatus || RefundStatus.NONE,
    isExpired: isOrderExpired(order),
  };
}

async function markOrderClosed(db, order, reason = 'EXPIRED') {
  if (!order || order.status !== OrderStatus.PENDING) return order;
  const nowTs = new Date();
  await db.collection(COLLECTIONS.ORDERS).where({
    _id: order._id,
    status: OrderStatus.PENDING,
  }).update({
    data: {
      status: OrderStatus.CLOSED,
      closedAt: nowTs,
      closeReason: reason,
      updatedAt: nowTs,
    },
  });
  // 条件更新避免“查询时仍 PENDING、回调已置 PAID、随后本地关单覆盖支付结果”。
  return (await findOrderById(db, order._id)) || {
    ...order, status: OrderStatus.CLOSED, closedAt: nowTs, closeReason: reason,
  };
}

async function markGrantFailed(db, order, message) {
  if (!order || !order._id) return;
  const fresh = await findOrderById(db, order._id);
  if (!fresh) return;
  if (fresh.grantStatus === GrantStatus.GRANTED || fresh.grantStatus === GrantStatus.REVERTED) return;
  const where = { _id: fresh._id, status: fresh.status };
  if (fresh.grantStatus != null) where.grantStatus = fresh.grantStatus;
  await db.collection(COLLECTIONS.ORDERS).where(where).update({
    data: {
      status: OrderStatus.PAID,
      refundStatus: fresh.refundStatus || RefundStatus.NONE,
      grantStatus: GrantStatus.FAILED,
      grantError: String(message || '权益发放失败').slice(0, 500),
      grantFailedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * 幂等地把订单置为 PAID，并发放对应权益。
 * - PENDING 正常发放；
 * - PAID + 未发放/发放失败时允许重试；
 * - 已发放订单重复回调只返回 alreadyPaid，不重复增加权益。
 */
async function fulfillOrder(db, order, payment = {}) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const paidAmount = amountOf(payment);
  if (paidAmount !== null && paidAmount !== Number(order.amountFen)) {
    return fail(ERRORS.ORDER_AMOUNT_MISMATCH);
  }

  const alreadyGranted = order.status === OrderStatus.PAID
    && order.grantStatus !== GrantStatus.FAILED
    && order.grantStatus !== GrantStatus.REVERTED;
  if (alreadyGranted) {
    return ok({
      orderId: order._id,
      status: OrderStatus.PAID,
      entitlementStatus: 'PAID_GRANTED',
      alreadyPaid: true,
    });
  }
  if (order.grantStatus === GrantStatus.REVERTED
    || order.refundStatus === RefundStatus.REFUNDED
    || order.status === OrderStatus.REFUNDED) {
    return ok({
      orderId: order._id,
      status: OrderStatus.PAID,
      entitlementStatus: 'REFUNDED',
      alreadyReverted: true,
    });
  }
  if (order.status !== OrderStatus.PENDING
    && order.status !== OrderStatus.PAID
    && order.status !== OrderStatus.CLOSED) {
    return fail(ERRORS.ORDER_NOT_FOUND);
  }

  const userRes = await db.collection(COLLECTIONS.USERS).where({ openId: order.userId }).get();
  const user = (userRes.data || [])[0];
  if (!user) return fail(ERRORS.UNAUTHORIZED);

  const transactionId = payment.transactionId || payment.transaction_id || order.transactionId || '';
  const paymentResult = {
    transactionId,
    amountFen: paidAmount,
    tradeState: payment.tradeState || payment.trade_state || '',
    appId: payment.appId || payment.appid || '',
    mchId: payment.mchId || payment.mchid || '',
    outTradeNo: payment.outTradeNo || payment.out_trade_no || order.outTradeNo,
  };
  const memberDays = Math.max(0, Number(order.memberDays) || 0);
  const memberFloorDays = Math.max(0, Number(order.memberFloorDays) || 0);
  const taskPackDelta = order.productType === 'TASK_PACK' ? 1 : 0;

  const transaction = await db.startTransaction();
  let userPatch = null;
  let entitlementGrant = null;
  try {
    const latestOrder = docDataOf(await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).get())
      || order;
    if (latestOrder.grantStatus === GrantStatus.REVERTED
      || latestOrder.refundStatus === RefundStatus.REFUNDED
      || latestOrder.status === OrderStatus.REFUNDED) {
      await rollbackQuietly(transaction);
      return ok({
        orderId: latestOrder._id,
        status: OrderStatus.PAID,
        entitlementStatus: 'REFUNDED',
        alreadyReverted: true,
      });
    }
    if (latestOrder.status === OrderStatus.PAID
      && latestOrder.grantStatus !== GrantStatus.FAILED) {
      await rollbackQuietly(transaction);
      return ok({
        orderId: latestOrder._id,
        status: OrderStatus.PAID,
        entitlementStatus: 'PAID_GRANTED',
        alreadyPaid: true,
      });
    }
    if (![OrderStatus.PENDING, OrderStatus.PAID, OrderStatus.CLOSED].includes(latestOrder.status)) {
      await rollbackQuietly(transaction);
      return fail(ERRORS.ORDER_NOT_FOUND);
    }

    const latestUser = docDataOf(await transaction.collection(COLLECTIONS.USERS).doc(user._id).get())
      || user;
    const nowTs = new Date();
    const currentExpiryMs = dateMs(latestUser.memberExpiresAt);
    const validCurrentExpiry = currentExpiryMs > nowTs.getTime() ? currentExpiryMs : nowTs.getTime();
    const expiryCandidates = [
      memberDays > 0 ? validCurrentExpiry + memberDays * DAY_MS : 0,
      memberFloorDays > 0 ? nowTs.getTime() + memberFloorDays * DAY_MS : 0,
      currentExpiryMs > 0 ? currentExpiryMs : 0,
    ];
    const nextExpiryMs = Math.max(...expiryCandidates);
    entitlementGrant = {
      beforeExpiresAt: currentExpiryMs ? new Date(currentExpiryMs) : null,
      afterExpiresAt: new Date(nextExpiryMs),
      memberDaysAddedMs: Math.max(0, nextExpiryMs - validCurrentExpiry),
      taskPackDelta,
      appliedAt: nowTs,
      revertedAt: null,
    };
    userPatch = {
      memberLevel: MemberLevel.MEMBER,
      memberSince: latestUser.memberSince || nowTs,
      memberOrderId: order._id,
      memberExpiresAt: new Date(nextExpiryMs),
    };
    if (taskPackDelta) {
      userPatch.taskPackCount = Math.max(0, parseInt(latestUser.taskPackCount, 10) || 0) + taskPackDelta;
    }

    await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({ data: userPatch });
    await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        status: OrderStatus.PAID,
        paidAt: latestOrder.paidAt || nowTs,
        transactionId,
        paymentResult,
        refundStatus: latestOrder.refundStatus || RefundStatus.NONE,
        grantStatus: GrantStatus.GRANTED,
        entitlementGrant,
        grantError: '',
        updatedAt: nowTs,
      },
    });
    await transaction.commit();
  } catch (err) {
    try { await transaction.rollback(); } catch (rollbackErr) { /* commit 结果未知，下面以数据库回读为准 */ }
    // commit 响应丢失时数据库可能已经成功。先回读，避免把已发放订单覆盖成 FAILED。
    const fresh = await findOrderById(db, order._id);
    if (fresh && (fresh.grantStatus === GrantStatus.REVERTED
      || fresh.refundStatus === RefundStatus.REFUNDED)) {
      return ok({
        orderId: fresh._id,
        status: OrderStatus.PAID,
        entitlementStatus: 'REFUNDED',
        alreadyReverted: true,
      });
    }
    if (fresh && fresh.status === OrderStatus.PAID && fresh.grantStatus === GrantStatus.GRANTED) {
      return ok({
        orderId: fresh._id,
        status: OrderStatus.PAID,
        entitlementStatus: 'PAID_GRANTED',
        alreadyPaid: true,
      });
    }
    await markGrantFailed(db, order, err.message);
    return fail({ code: 1500, message: `订单发放失败：${err.message}` });
  }

  return ok({
    orderId: order._id,
    status: OrderStatus.PAID,
    entitlementStatus: 'PAID_GRANTED',
    memberLevel: MemberLevel.MEMBER,
    memberExpiresAt: userPatch && userPatch.memberExpiresAt,
    taskPackCount: userPatch && userPatch.taskPackCount != null
      ? userPatch.taskPackCount
      : (parseInt(user.taskPackCount, 10) || 0),
  });
}

async function reverseOrderEntitlement(db, order, refundedAmountFen) {
  if (!order || order.status !== OrderStatus.PAID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.grantStatus === GrantStatus.REVERTED || order.refundStatus === RefundStatus.REFUNDED) {
    return ok({ orderId: order._id, alreadyReverted: true });
  }

  const userRes = await db.collection(COLLECTIONS.USERS).where({ openId: order.userId }).get();
  const user = (userRes.data || [])[0];
  if (!user) return fail(ERRORS.UNAUTHORIZED);

  const transaction = await db.startTransaction();
  try {
    const latestOrder = docDataOf(await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).get())
      || order;
    if (latestOrder.grantStatus === GrantStatus.REVERTED
      || latestOrder.refundStatus === RefundStatus.REFUNDED) {
      await rollbackQuietly(transaction);
      return ok({ orderId: latestOrder._id, alreadyReverted: true });
    }
    if (latestOrder.status !== OrderStatus.PAID) {
      await rollbackQuietly(transaction);
      return fail(ERRORS.ORDER_NOT_FOUND);
    }
    const latestUser = docDataOf(await transaction.collection(COLLECTIONS.USERS).doc(user._id).get())
      || user;
    const grant = latestOrder.entitlementGrant || {};
    const nowTs = new Date();
    const currentExpiryMs = dateMs(latestUser.memberExpiresAt);
    // 兼容上线前已支付、但没有权益快照的历史订单。订单自身仍保留商品
    // 快照，因此可以保守地按商品天数/名额包数量回收，不能直接把权益留空。
    const hasMemberSnapshot = grant.memberDaysAddedMs != null;
    const hasPackSnapshot = grant.taskPackDelta != null;
    const addedMs = Math.max(0, Number(
      hasMemberSnapshot ? grant.memberDaysAddedMs : (Number(latestOrder.memberDays) || 0) * DAY_MS
    ) || 0);
    const taskPackDelta = Math.max(0, Number(
      hasPackSnapshot ? grant.taskPackDelta : (latestOrder.productType === 'TASK_PACK' ? 1 : 0)
    ) || 0);
    const nextExpiryMs = Math.max(nowTs.getTime(), currentExpiryMs - addedMs);
    const nextPackCount = Math.max(
      0,
      (parseInt(latestUser.taskPackCount, 10) || 0) - taskPackDelta
    );
    const member = nextExpiryMs > nowTs.getTime();
    const userPatch = {
      memberExpiresAt: new Date(nextExpiryMs),
      memberLevel: member ? MemberLevel.MEMBER : MemberLevel.NORMAL,
      taskPackCount: nextPackCount,
    };
    await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({ data: userPatch });
    await transaction.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        refundStatus: RefundStatus.REFUNDED,
        refundedAmountFen: Number(refundedAmountFen) || Number(latestOrder.amountFen) || 0,
        refundedAt: nowTs,
        grantStatus: GrantStatus.REVERTED,
        entitlementGrant: {
          ...grant,
          memberDaysAddedMs: addedMs,
          taskPackDelta,
          legacyBackfill: !hasMemberSnapshot || !hasPackSnapshot,
          revertedAt: nowTs,
        },
        updatedAt: nowTs,
      },
    });
    await transaction.commit();
  } catch (err) {
    try { await transaction.rollback(); } catch (rollbackErr) { /* commit 结果未知，下面以数据库回读为准 */ }
    const fresh = await findOrderById(db, order._id);
    if (fresh && fresh.grantStatus === GrantStatus.REVERTED) {
      return ok({ orderId: fresh._id, alreadyReverted: true });
    }
    return fail({ code: 1500, message: `权益回收失败：${err.message}` });
  }
  return ok({
    orderId: order._id,
    refundedAmountFen: Number(refundedAmountFen) || Number(order.amountFen) || 0,
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

function isQueryClosedResult(result = {}) {
  const state = result.tradeState || result.trade_state || '';
  return ['CLOSED', 'REVOKED', 'PAYERROR'].includes(state);
}

module.exports = {
  DAY_MS,
  ORDER_TTL_MS,
  REFUND_WINDOW_MS,
  DUPLICATE_WINDOW_MS,
  amountOf,
  dateMs,
  orderExpiresAtMs,
  isOrderExpired,
  findOrderById,
  findOrderByOutTradeNo,
  findCaseByOutRefundNo,
  grantStateOf,
  paymentViewOf,
  markOrderClosed,
  markGrantFailed,
  fulfillOrder,
  reverseOrderEntitlement,
  isCallbackPaidResult,
  isQueryPaidResult,
  isQueryClosedResult,
};
