/**
 * account —— Travel-app 用户自助注销。
 *
 * 身份只取微信云函数上下文 OPENID。账号注销是业务账户数据清除，不是微信账号操作。
 * 所有删除都按当前 OPENID 限定；重复调用可继续清理已部分完成的数据。
 */

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const {
  COLLECTIONS,
  CONFIRMATION,
  RECENT_CLOSED_SAFETY_MS,
  AUDIT_RETENTION_MS,
  OrderStatus,
  GrantStatus,
  RefundStatus,
  ACTIVE_CASE_STATUSES,
  ACTIVE_REFUND_STATUSES,
  ERRORS,
  ok,
  fail,
} = require('./lib/schema');

const PAGE_SIZE = 100;
const DELETE_CONCURRENCY = 10;
const MAX_PREFETCH_ROWS = 2000;

function timestampOf(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isCollectionMissing(err) {
  const message = String(err && (err.errMsg || err.message) || '');
  return /-502005|collection not exists|Db or Table not exist/i.test(message);
}

async function safeCount(collection, where = {}) {
  try {
    const res = await db.collection(collection).where(where).count();
    return Math.max(0, Number(res.total) || 0);
  } catch (err) {
    if (isCollectionMissing(err)) return 0;
    throw err;
  }
}

async function fetchRows(collection, where, { pageSize = PAGE_SIZE, maxRows = MAX_PREFETCH_ROWS } = {}) {
  const rows = [];
  let skip = 0;
  while (rows.length < maxRows) {
    let res;
    try {
      res = await db.collection(collection)
        .where(where)
        .skip(skip)
        .limit(Math.min(pageSize, maxRows - rows.length))
        .get();
    } catch (err) {
      if (isCollectionMissing(err)) return rows;
      throw err;
    }
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    skip += batch.length;
  }
  return rows;
}

async function docExists(collection, id) {
  if (!id) return false;
  try {
    const res = await db.collection(collection).doc(id).get();
    return !!(res && (res.data || []).length);
  } catch (err) {
    if (isCollectionMissing(err) || /does not exist|not found|-502005/i.test(String(err && (err.message || err.errMsg) || ''))) {
      return false;
    }
    throw err;
  }
}

async function removeDoc(collection, id) {
  if (!id) return 0;
  try {
    const res = await db.collection(collection).doc(id).remove();
    return Math.max(0, Number(res && res.stats && res.stats.removed) || 0);
  } catch (err) {
    if (isCollectionMissing(err)) return 0;
    throw err;
  }
}

async function removeByField(collection, field, value) {
  if (!value) return 0;
  let removed = 0;
  for (let batch = 0; batch < 100; batch += 1) {
    let rows;
    try {
      const res = await db.collection(collection).where({ [field]: value }).limit(PAGE_SIZE).get();
      rows = res.data || [];
    } catch (err) {
      if (isCollectionMissing(err)) return removed;
      throw err;
    }
    if (!rows.length) break;

    for (let index = 0; index < rows.length; index += DELETE_CONCURRENCY) {
      const chunk = rows.slice(index, index + DELETE_CONCURRENCY);
      const counts = await Promise.all(chunk.map(row => removeDoc(collection, row._id)));
      removed += counts.reduce((sum, count) => sum + count, 0);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return removed;
}

function userRuntimeIdOf(userId) {
  return crypto.createHash('sha256').update(String(userId || ''), 'utf8').digest('hex');
}

function blockerOf(code, count, title, message, action) {
  return { code, count, title, message, action: action || 'ORDERS' };
}

function buildBlockers(orders, cases, nowTs) {
  const pendingOrders = orders.filter(order => order.status === OrderStatus.PENDING).length;
  const recentClosed = orders.filter(order => {
    if (order.status !== OrderStatus.CLOSED) return false;
    const closedMs = Math.max(timestampOf(order.closedAt), timestampOf(order.updatedAt), timestampOf(order.createdAt));
    return closedMs > 0 && nowTs - closedMs <= RECENT_CLOSED_SAFETY_MS;
  }).length;
  const unresolvedEntitlements = orders.filter(order => {
    if (order.status !== OrderStatus.PAID) return false;
    if (order.refundStatus === RefundStatus.REFUNDED || order.grantStatus === GrantStatus.REVERTED) return false;
    return order.grantStatus !== GrantStatus.GRANTED;
  }).length;
  const activeCases = cases.filter(item => ACTIVE_CASE_STATUSES.has(item.status)).length
    + orders.filter(order => ACTIVE_REFUND_STATUSES.has(order.refundStatus)).length;

  const blockers = [];
  if (pendingOrders > 0) {
    blockers.push(blockerOf(
      'PAYMENT_PENDING',
      pendingOrders,
      '有待支付订单',
      '请先在会员订单中完成或取消待支付订单，再回来注销。',
      'ORDERS'
    ));
  }
  if (recentClosed > 0) {
    blockers.push(blockerOf(
      'PAYMENT_RECONCILING',
      recentClosed,
      '支付结果仍在核验',
      '有一笔刚刚关闭的支付订单仍在安全核验期，请 24 小时后再试。',
      'ORDERS'
    ));
  }
  if (unresolvedEntitlements > 0) {
    blockers.push(blockerOf(
      'ENTITLEMENT_UNRESOLVED',
      unresolvedEntitlements,
      '会员权益待处理',
      '有订单的权益发放状态尚未确认，请先在会员订单中处理。',
      'ORDERS'
    ));
  }
  if (activeCases > 0) {
    blockers.push(blockerOf(
      'AFTER_SALES_ACTIVE',
      activeCases,
      '售后或退款处理中',
      '请等待处理完成，或先在会员订单中查看售后状态。',
      'ORDERS'
    ));
  }
  return blockers;
}

function memberExpiryText(value) {
  const ms = timestampOf(value);
  if (!ms) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000).toISOString();
  return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
}

async function preflightFor(userId, nowTs = Date.now()) {
  if (!userId) return fail(ERRORS.UNAUTHORIZED);

  const userRows = await fetchRows(COLLECTIONS.USERS, { openId: userId }, { pageSize: 20, maxRows: 20 });
  const [orders, cases, tripCount, itemCount, reminderCount, cartCount, searchCount,
    feedbackCount, adAttemptCount, eventCount, runtimeCount] = await Promise.all([
    fetchRows(COLLECTIONS.ORDERS, { userId }),
    fetchRows(COLLECTIONS.AFTER_SALES_CASES, { userId }),
    safeCount(COLLECTIONS.TRIPS, { userId }),
    safeCount(COLLECTIONS.TRIP_ITEMS, { userId }),
    safeCount(COLLECTIONS.REMINDER_TASKS, { userId }),
    safeCount(COLLECTIONS.REMINDER_CART, { userId }),
    safeCount(COLLECTIONS.SEARCH_HISTORY, { userId }),
    safeCount(COLLECTIONS.FEEDBACKS, { userId }),
    safeCount(COLLECTIONS.REWARDED_AD_ATTEMPTS, { userId }),
    safeCount(COLLECTIONS.REMINDER_EVENTS, { userId }),
    docExists(COLLECTIONS.USER_RUNTIME, userRuntimeIdOf(userId)).then(value => value ? 1 : 0),
  ]);

  const user = userRows[0] || null;
  const memberExpiresMs = timestampOf(user && user.memberExpiresAt);
  const membershipActive = memberExpiresMs > nowTs;
  const blockers = buildBlockers(orders, cases, nowTs);
  const alreadyErased = !user
    && orders.length === 0 && cases.length === 0
    && tripCount === 0 && itemCount === 0 && reminderCount === 0
    && cartCount === 0 && searchCount === 0 && feedbackCount === 0
    && adAttemptCount === 0 && eventCount === 0 && runtimeCount === 0;

  return ok({
    canErase: blockers.length === 0,
    blockers,
    summary: {
      profileCount: userRows.length,
      tripCount,
      itemCount,
      reminderCount,
      cartCount,
      searchCount,
      feedbackCount,
      adAttemptCount,
      eventCount,
      runtimeCount,
      orderCount: orders.length,
      afterSalesCount: cases.length,
      membershipActive,
      memberExpiresAt: membershipActive ? user.memberExpiresAt : null,
      memberExpiresAtText: membershipActive ? memberExpiryText(user.memberExpiresAt) : '',
      alreadyErased,
    },
  });
}

function sanitizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return {};
  const clean = { ...evidence };
  delete clean.user;
  delete clean.userSnapshot;
  delete clean.contact;
  delete clean.phone;
  delete clean.openId;
  return clean;
}

function eraseRefOf() {
  return `erased_${crypto.randomBytes(12).toString('hex')}`;
}

async function anonymizeOrders(orders, erasedAccountRef, nowTs) {
  let count = 0;
  for (let index = 0; index < orders.length; index += DELETE_CONCURRENCY) {
    const chunk = orders.slice(index, index + DELETE_CONCURRENCY);
    const results = await Promise.all(chunk.map(order => db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        userId: '',
        userDocumentId: '',
        accountDeleted: true,
        accountDeletedAt: nowTs,
        erasedAccountRef,
        updatedAt: nowTs,
      },
    }).then(() => 1).catch(err => {
      if (isCollectionMissing(err)) return 0;
      throw err;
    })));
    count += results.reduce((sum, value) => sum + value, 0);
  }
  return count;
}

async function anonymizeCases(cases, erasedAccountRef, nowTs) {
  let count = 0;
  for (let index = 0; index < cases.length; index += DELETE_CONCURRENCY) {
    const chunk = cases.slice(index, index + DELETE_CONCURRENCY);
    const results = await Promise.all(chunk.map(item => db.collection(COLLECTIONS.AFTER_SALES_CASES).doc(item._id).update({
      data: {
        userId: '',
        requestIdHash: '',
        description: '',
        evidence: sanitizeEvidence(item.evidence),
        accountDeleted: true,
        accountDeletedAt: nowTs,
        erasedAccountRef,
        updatedAt: nowTs,
      },
    }).then(() => 1).catch(err => {
      if (isCollectionMissing(err)) return 0;
      throw err;
    })));
    count += results.reduce((sum, value) => sum + value, 0);
  }
  return count;
}

async function anonymizeAuditTargets(targetIds, erasedAccountRef, nowTs) {
  let count = 0;
  for (const targetId of targetIds.filter(Boolean)) {
    const rows = await fetchRows(
      COLLECTIONS.ADMIN_AUDIT_LOGS,
      { targetType: 'user', targetId },
      { pageSize: 100, maxRows: 1000 }
    );
    for (let index = 0; index < rows.length; index += DELETE_CONCURRENCY) {
      const chunk = rows.slice(index, index + DELETE_CONCURRENCY);
      const results = await Promise.all(chunk.map(row => db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS)
        .doc(row._id).update({
          data: {
            targetId: erasedAccountRef,
            accountDeleted: true,
            accountDeletedAt: nowTs,
          },
        }).then(() => 1).catch(err => {
          if (isCollectionMissing(err)) return 0;
          throw err;
        })));
      count += results.reduce((sum, value) => sum + value, 0);
    }
  }
  return count;
}

async function writeAuditSummary(result, erasedAccountRef, nowTs) {
  try {
    await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
      data: {
        adminOpenId: 'SYSTEM',
        targetType: 'account_erasure',
        targetId: erasedAccountRef,
        action: 'ACCOUNT_ERASURE',
        caseId: '',
        orderId: '',
        details: {
          counts: result.counts,
          retained: result.retained,
          accountDeleted: true,
        },
        createdAt: nowTs,
        accountDeletedAt: nowTs,
        expireAt: new Date(nowTs.getTime() + AUDIT_RETENTION_MS),
      },
    });
  } catch (err) {
    /* 审计写失败不能把已经完成的用户数据删除伪装成失败。 */
    console.error('[account] audit-summary-failed', err && (err.errMsg || err.message));
  }
}

async function deleteAvatar(userRows) {
  const fileList = [...new Set(userRows
    .map(user => String(user.avatarUrl || '').trim())
    .filter(url => /^cloud:\/\//.test(url)))];
  if (!fileList.length || typeof cloud.deleteFile !== 'function') return 0;
  try {
    const res = await cloud.deleteFile({ fileList });
    const failed = ((res && res.fileList) || []).filter(item => item.status !== 0);
    if (failed.length) {
      console.warn('[account] avatar-delete-partial', failed.map(item => item.status).join(','));
    }
    return fileList.length - failed.length;
  } catch (err) {
    console.error('[account] avatar-delete-failed', err && (err.errMsg || err.message));
    return 0;
  }
}

async function eraseFor(userId, nowTs = Date.now()) {
  if (!userId) return fail(ERRORS.UNAUTHORIZED);
  const preflight = await preflightFor(userId, nowTs);
  if (!preflight.success) return preflight;
  if (!preflight.canErase) {
    return fail(ERRORS.ERASURE_BLOCKED, {
      blockers: preflight.blockers,
      summary: preflight.summary,
    });
  }

  const userRows = await fetchRows(COLLECTIONS.USERS, { openId: userId }, { pageSize: 20, maxRows: 20 });
  const orders = preflight.summary.orderCount
    ? await fetchRows(COLLECTIONS.ORDERS, { userId })
    : [];
  const cases = preflight.summary.afterSalesCount
    ? await fetchRows(COLLECTIONS.AFTER_SALES_CASES, { userId })
    : [];

  if (preflight.summary.alreadyErased) {
    return ok({ alreadyErased: true, erasedAt: new Date(nowTs), counts: {}, retained: {} });
  }

  const erasedAccountRef = eraseRefOf();
  const avatarFilesDeleted = await deleteAvatar(userRows);
  const counts = {};
  counts.reminderTasks = await removeByField(COLLECTIONS.REMINDER_TASKS, 'userId', userId);
  counts.reminderCart = await removeByField(COLLECTIONS.REMINDER_CART, 'userId', userId);
  counts.tripItems = await removeByField(COLLECTIONS.TRIP_ITEMS, 'userId', userId);
  counts.trips = await removeByField(COLLECTIONS.TRIPS, 'userId', userId);
  counts.searchHistory = await removeByField(COLLECTIONS.SEARCH_HISTORY, 'userId', userId);
  counts.feedbacks = await removeByField(COLLECTIONS.FEEDBACKS, 'userId', userId);
  counts.adAttempts = await removeByField(COLLECTIONS.REWARDED_AD_ATTEMPTS, 'userId', userId);
  counts.reminderEvents = await removeByField(COLLECTIONS.REMINDER_EVENTS, 'userId', userId);
  counts.userRuntime = await removeDoc(COLLECTIONS.USER_RUNTIME, userRuntimeIdOf(userId));

  const retainedOrders = await anonymizeOrders(orders, erasedAccountRef, new Date(nowTs));
  const retainedCases = await anonymizeCases(cases, erasedAccountRef, new Date(nowTs));
  const retainedAuditTargets = await anonymizeAuditTargets(
    [userId, ...userRows.map(user => user._id)],
    erasedAccountRef,
    new Date(nowTs)
  );

  counts.profiles = 0;
  for (const user of userRows) counts.profiles += await removeDoc(COLLECTIONS.USERS, user._id);
  counts.avatarFiles = avatarFilesDeleted;

  const result = {
    counts,
    retained: {
      orders: retainedOrders,
      afterSalesCases: retainedCases,
      auditTargets: retainedAuditTargets,
    },
  };
  await writeAuditSummary(result, erasedAccountRef, new Date(nowTs));
  return ok({
    ...result,
    erasedAccountRef,
    erasedAt: new Date(nowTs),
    alreadyErased: false,
  });
}

async function main(event = {}) {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(ERRORS.UNAUTHORIZED);

  try {
    switch (event.action) {
      case 'account.preflight':
        return await preflightFor(OPENID, Date.now());
      case 'account.erase': {
        if (String(event.confirmation || '') !== CONFIRMATION) {
          return fail(ERRORS.ERASURE_CONFIRM_REQUIRED);
        }
        return await eraseFor(OPENID, Date.now());
      }
      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error('[account] request-failed', event.action || 'unknown', err && (err.errMsg || err.message));
    return fail(ERRORS.SERVER_ERROR);
  }
}

exports.main = main;
exports._internal = {
  buildBlockers,
  preflightFor,
  eraseFor,
  removeByField,
  userRuntimeIdOf,
  sanitizeEvidence,
};
