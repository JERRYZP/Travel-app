/**
 * 一次性升级权益券。
 *
 * 只有“会员主订单被平台强制退款，而升级单仍有效”时才会创建。
 * 它只能随下一次 member_quota_10 会员单原子消费，不能单独兑换会员。
 */

const crypto = require('crypto');
const { COLLECTIONS } = require('./schema');

const CreditStatus = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  CONSUMED: 'CONSUMED',
  REVOKED: 'REVOKED',
});

const CREDIT_TEXT = '已保留 ¥1.9 升级权益，开通 3 元档后自动升级为不限额度';

function idOf(userId) {
  const hash = crypto.createHash('sha256').update(String(userId || '')).digest('hex');
  return `upgrade_credit_${hash.slice(0, 28)}`;
}

function dataOf(result) {
  const data = result && result.data;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function read(client, userId) {
  if (!client || !userId) return null;
  const collection = client.collection(COLLECTIONS.MEMBERSHIP_CREDITS);
  try {
    return dataOf(await collection.doc(idOf(userId)).get());
  } catch (err) {
    const res = await collection.where({ _id: idOf(userId) }).limit(1).get();
    return dataOf(res);
  }
}

function publicViewOf(credit, nowTs = new Date()) {
  if (!credit || credit.status !== CreditStatus.AVAILABLE) {
    return {
      available: false,
      pending: false,
      text: '',
      sourceOrderId: '',
      pendingOrderId: '',
    };
  }
  const reservedAt = new Date(credit.reservationExpiresAt || 0).getTime();
  const pending = !!credit.reservedByOrderId
    && Number.isFinite(reservedAt)
    && reservedAt > new Date(nowTs).getTime();
  return {
    available: true,
    pending,
    text: CREDIT_TEXT,
    sourceOrderId: credit.sourceOrderId || '',
    pendingOrderId: pending ? credit.reservedByOrderId : '',
  };
}

async function createForOrder(transaction, userId, upgradeOrder, nowTs = new Date()) {
  const id = idOf(userId);
  const current = await read(transaction, userId);
  if (current && current.status === CreditStatus.AVAILABLE) return current;
  const credit = {
    userId,
    sourceOrderId: upgradeOrder._id,
    sourceAmountFen: Math.max(0, Number(upgradeOrder.amountFen) || 0),
    status: CreditStatus.AVAILABLE,
    reservedByOrderId: '',
    reservationExpiresAt: null,
    consumedByOrderId: '',
    createdAt: nowTs,
    updatedAt: nowTs,
  };
  await transaction.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(id).set({ data: credit });
  return { _id: id, ...credit };
}

async function reserve(db, userId, orderId, expiresAt, nowTs = new Date()) {
  const credit = await read(db, userId);
  if (!credit || credit.status !== CreditStatus.AVAILABLE) return null;
  const reservedMs = new Date(credit.reservationExpiresAt || 0).getTime();
  if (credit.reservedByOrderId
    && credit.reservedByOrderId !== orderId
    && Number.isFinite(reservedMs)
    && reservedMs > new Date(nowTs).getTime()) {
    return null;
  }
  await db.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(idOf(userId)).update({
    data: {
      reservedByOrderId: orderId,
      reservationExpiresAt: expiresAt || null,
      updatedAt: nowTs,
    },
  });
  return { ...credit, reservedByOrderId: orderId, reservationExpiresAt: expiresAt || null };
}

async function consume(transaction, userId, orderId, nowTs = new Date()) {
  const credit = await read(transaction, userId);
  if (!credit) return null;
  if (credit.status !== CreditStatus.AVAILABLE) {
    if (credit && credit.consumedByOrderId === orderId) return credit;
    return null;
  }
  if (credit.reservedByOrderId && credit.reservedByOrderId !== orderId) return null;
  await transaction.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(idOf(userId)).update({
    data: {
      status: CreditStatus.CONSUMED,
      consumedByOrderId: orderId,
      reservedByOrderId: '',
      reservationExpiresAt: null,
      updatedAt: nowTs,
    },
  });
  return {
    ...credit,
    status: CreditStatus.CONSUMED,
    consumedByOrderId: orderId,
  };
}

async function release(db, userId, orderId, nowTs = new Date()) {
  const credit = await read(db, userId);
  if (!credit || credit.status !== CreditStatus.AVAILABLE) return false;
  if (credit.reservedByOrderId !== orderId) return false;
  await db.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(idOf(userId)).update({
    data: {
      reservedByOrderId: '',
      reservationExpiresAt: null,
      updatedAt: nowTs,
    },
  });
  return true;
}

async function restore(transaction, userId, consumedByOrderId, nowTs = new Date()) {
  const credit = await read(transaction, userId);
  if (!credit
    || credit.status !== CreditStatus.CONSUMED
    || credit.consumedByOrderId !== consumedByOrderId) {
    return null;
  }
  await transaction.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(idOf(userId)).update({
    data: {
      status: CreditStatus.AVAILABLE,
      consumedByOrderId: '',
      reservedByOrderId: '',
      reservationExpiresAt: null,
      updatedAt: nowTs,
    },
  });
  return { ...credit, status: CreditStatus.AVAILABLE, consumedByOrderId: '' };
}

async function revoke(client, userId, sourceOrderId, nowTs = new Date()) {
  const credit = await read(client, userId);
  if (!credit
    || credit.sourceOrderId !== sourceOrderId
    || credit.status === CreditStatus.REVOKED) {
    return null;
  }
  await client.collection(COLLECTIONS.MEMBERSHIP_CREDITS).doc(idOf(userId)).update({
    data: {
      status: CreditStatus.REVOKED,
      reservedByOrderId: '',
      reservationExpiresAt: null,
      revokedAt: nowTs,
      updatedAt: nowTs,
    },
  });
  return { ...credit, status: CreditStatus.REVOKED };
}

module.exports = {
  CreditStatus,
  CREDIT_TEXT,
  idOf,
  read,
  publicViewOf,
  createForOrder,
  reserve,
  consume,
  release,
  restore,
  revoke,
};
