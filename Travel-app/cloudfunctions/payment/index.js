/**
 * 会员与提醒名额支付 / 售后入口。
 *
 * 支付协议保留两条并行通道：
 * - WECHAT_PAY_V3：微信支付 API v3 直连，缺省通道；
 * - VIRTUAL_PAY：小程序虚拟支付，显式设置 PAYMENT_PROVIDER=VIRTUAL_PAY 后启用。
 * 普通调用：wx.cloud.callFunction({
 *   name: 'payment',
 *   data: { action: 'create' | 'query' | 'cancel' | 'afterSales.submit' | ... }
 * })
 *
 * HTTP 回调：
 * - /payment/notify         支付结果
 * - /payment/refund-notify  退款结果
 * - /payment/virtual-notify 虚拟支付兼容入口（推荐改用云开发消息推送）
 * API v3 回调必须先验签再解密；虚拟支付发货和退款事件必须重新查单确认。
 */

const crypto = require('crypto');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const rawDb = cloud.database();
const { createResourceMonitor } = require('./lib/resource-metrics');
const resource = createResourceMonitor('payment', rawDb);
const db = resource.db;

const {
  COLLECTIONS, ERRORS, OrderStatus, RefundStatus, GrantStatus, MembershipSalesState,
  CaseType, CaseStatus, ok, fail,
} = require('./lib/schema');
const {
  amountOf,
  findOrderById,
  findOrderByOutTradeNo,
  findCaseByOutRefundNo,
  fulfillOrder,
  markOrderClosed,
  markGrantFailed,
  isOrderExpired,
  orderExpiresAtMs,
  DUPLICATE_WINDOW_MS,
  isQueryPaidResult,
  isQueryClosedResult,
  paymentViewOf,
  grantStateOf,
  reverseOrderEntitlement,
} = require('./lib/order');
const afterSales = require('./lib/after-sales');
const membershipSales = require('./lib/membership-sales');
const membershipEnforcement = require('./lib/membership-enforcement');
const membershipUpgradeNotice = require('./lib/membership-upgrade-notice');
const adminOrders = require('./lib/admin-orders');
const adminReminderQuality = require('./lib/admin-reminder-quality');
const {
  migrateProtectionBatch,
  protectionMigrationCompleted,
  migrateEntitlementLedgerBatch,
  entitlementMigrationCompleted,
} = require('./lib/migration');
const wxpay = require('./lib/wxpay-v3');
const paymentProvider = require('./lib/payment-provider');
const virtualPay = require('./lib/virtual-pay');
const virtualNotify = require('./lib/virtual-notify');
const wechatAuth = require('./lib/wechat-auth');

const RECONCILE_BATCH_SIZE = 50;
const RECONCILE_TOTAL_BUDGET_MS = 45 * 1000;
const RECONCILE_QUEUE_BUDGET_MS = 10 * 1000;
const RECONCILE_HEALTH_ID = 'reconcile_health';
/* 查不到平台结果时，本地订单过期后再等这么多次重试才强制收口。 */
const VIRTUAL_PAY_QUERY_GRACE_MS = 30 * 60 * 1000;
const REFUND_BALANCE_INSUFFICIENT_MESSAGE = '基本账户余额不足，请充值后重新发起';
const CLIENT_CLOUD_SOURCES = new Set(['wx_client', 'wx_devtools', 'wx_localdebug']);

function isTrustedVirtualMessageContext(context = {}) {
  const source = String(context.SOURCE || '').trim();
  if (!source) return !context.OPENID;
  return !source.split(',').map(item => item.trim()).some(item => CLIENT_CLOUD_SOURCES.has(item));
}

function refundFailureOf(err, fallback = '退款发起失败，可稍后重试') {
  const message = String((err && err.message) || '').trim();
  const code = String((err && err.code) || '').trim();
  const statusCode = Number(err && err.statusCode);
  const isBalanceInsufficient = /基本账户余额不足|账户余额不足|余额不足/.test(message)
    || /(?:balance|fund).*(?:insufficient|not.?enough)/i.test(`${message} ${code}`);
  const fundingBlocked = isBalanceInsufficient && (statusCode === 0 || statusCode === 403);
  return {
    message: fundingBlocked ? REFUND_BALANCE_INSUFFICIENT_MESSAGE : fallback,
    failureReason: String((fundingBlocked ? REFUND_BALANCE_INSUFFICIENT_MESSAGE : message) || fallback).slice(0, 500),
    failureCode: fundingBlocked ? 'BASIC_ACCOUNT_INSUFFICIENT' : code.slice(0, 100),
    fundingBlocked,
  };
}

/* ============================== HTTP 回调 ============================== */

function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  const source = headers || {};
  const key = Object.keys(source).find(item => item.toLowerCase() === target);
  if (!key) return '';
  const value = source[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function httpEventOf(event = {}) {
  return !!event
    && Object.prototype.hasOwnProperty.call(event, 'body')
    && !!(event.headers || event.requestContext || event.httpMethod || event.path || event.rawPath);
}

function requestPathOf(event = {}) {
  const context = event.requestContext || {};
  const http = context.http || {};
  return String(
    event.rawPath
    || event.path
    || context.path
    || context.rawPath
    || http.path
    || ''
  );
}

function callbackKindOf(event = {}) {
  const path = requestPathOf(event).replace(/\/+$/, '');
  if (!path) return 'payment'; // 兼容旧网关和单测事件；显式路径存在时必须精确匹配
  if (path === '/payment/virtual-notify' || path === '/virtual-notify') return 'virtual';
  if (path === '/payment/refund-notify' || path === '/refund-notify') return 'refund';
  if (path === '/payment/notify' || path === '/notify') return 'payment';
  return 'unknown';
}

function isVirtualMessageEvent(event = {}) {
  return String(event.Event || event.event || '').trim().startsWith('xpay_');
}

function rawBodyOf(event = {}) {
  if (typeof event.body !== 'string') return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function callbackResponse(statusCode, code, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ code, message }),
  };
}

function callbackSuccess() {
  return callbackResponse(200, 'SUCCESS', '成功');
}

function callbackFailure(message, statusCode = 400) {
  return callbackResponse(statusCode, 'FAIL', message);
}

function safeLog({ route, eventType, outTradeNo, outRefundNo, headers, body, verified, reason }) {
  console.log('[payment] callback', {
    route,
    eventType: eventType || '',
    outTradeNo: outTradeNo || '',
    outRefundNo: outRefundNo || '',
    publicKeyId: headerValue(headers, 'Wechatpay-Serial'),
    timestamp: headerValue(headers, 'Wechatpay-Timestamp'),
    bodySha256: sha256(body),
    verified: verified === true,
    reason: reason || '',
  });
}

function callbackVerificationReason(headers, body, config, verified, now = Date.now()) {
  const timestamp = headerValue(headers, 'Wechatpay-Timestamp');
  const nonce = headerValue(headers, 'Wechatpay-Nonce');
  const signature = headerValue(headers, 'Wechatpay-Signature');
  const serial = headerValue(headers, 'Wechatpay-Serial');
  if (!body) return 'EMPTY_BODY';
  if (!timestamp || !nonce || !signature || !serial) return 'MISSING_SIGNATURE_HEADER';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return 'INVALID_TIMESTAMP';
  const maxSkew = Number.isFinite(Number(config.maxSkewSeconds))
    ? Math.max(30, Number(config.maxSkewSeconds)) : 300;
  if (Math.abs(Math.floor(now / 1000) - ts) > maxSkew) return 'TIMESTAMP_OUT_OF_WINDOW';
  if (config.platformPublicKey && serial !== config.platformPublicKeyId) return 'PUBLIC_KEY_ID_MISMATCH';
  if (!config.platformPublicKey && config.platformCert && serial !== config.platformCertSerial) {
    return 'PLATFORM_CERT_SERIAL_MISMATCH';
  }
  return verified ? 'VERIFIED' : 'SIGNATURE_MISMATCH';
}

async function handlePaymentCallback(event, body, notification, config) {
  if (notification.event_type && notification.event_type !== 'TRANSACTION.SUCCESS') {
    safeLog({
      route: 'payment', eventType: notification.event_type, headers: event.headers, body, verified: true,
      reason: 'IGNORED_EVENT_TYPE',
    });
    return callbackSuccess();
  }

  let transaction;
  try {
    transaction = wxpay.decryptResource(notification.resource, config.apiV3Key);
  } catch (err) {
    safeLog({
      route: 'payment', eventType: notification.event_type, headers: event.headers, body, verified: true,
      reason: `DECRYPT_FAILED:${err.message}`,
    });
    return callbackFailure('回调资源解密失败', 500);
  }

  const outTradeNo = transaction.out_trade_no || '';
  safeLog({
    route: 'payment', eventType: notification.event_type, outTradeNo,
    headers: event.headers, body, verified: true,
    reason: transaction.trade_state === 'SUCCESS' ? 'PROCESSING' : 'IGNORED_TRADE_STATE',
  });
  if (transaction.trade_state !== 'SUCCESS') return callbackSuccess();
  if (transaction.appid !== config.appId || transaction.mchid !== config.mchId) {
    safeLog({
      route: 'payment', eventType: notification.event_type, outTradeNo,
      headers: event.headers, body, verified: true, reason: 'APP_OR_MERCHANT_MISMATCH',
    });
    return callbackFailure('商户或小程序不匹配', 400);
  }

  const order = await findOrderByOutTradeNo(db, outTradeNo);
  if (!order) return callbackFailure('订单不存在', 500);
  if (amountOf(transaction) !== Number(order.amountFen)) {
    return callbackFailure('订单金额校验失败', 400);
  }

  const result = await fulfillOrder(db, order, {
    totalFee: amountOf(transaction),
    transactionId: transaction.transaction_id || '',
    raw: {
      tradeState: transaction.trade_state,
      appId: transaction.appid,
      mchId: transaction.mchid,
      outTradeNo,
    },
  });
  if (!result.success) {
    safeLog({
      route: 'payment', eventType: notification.event_type, outTradeNo,
      headers: event.headers, body, verified: true,
      reason: `FULFILL_FAILED:${result.errorCode || 0}`,
    });
    await ensureGrantFailureCase(await findOrderById(db, order._id), result.error).catch(err => {
      console.error('[payment] grant failure case create failed', { orderId: order._id, message: err.message });
    });
    return callbackFailure(result.error || '订单发放失败', result.errorCode === 1025 ? 400 : 500);
  }
  await paymentSideEffects(await findOrderById(db, order._id)).catch(err => {
    console.error('[payment] payment side effects failed', { orderId: order._id, message: err.message });
  });
  return callbackSuccess();
}

async function applyRefundResult(caseItem, result, source = 'queries') {
  const refundStatus = String(result.refund_status || result.status || '').toUpperCase();
  const order = await findOrderById(db, caseItem.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);

  if (result.mchid && result.mchid !== wxpay.configOf().mchId) {
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '退款查询商户校验失败' });
  }
  if (result.out_trade_no && result.out_trade_no !== order.outTradeNo) {
    return fail({ code: ERRORS.ORDER_NOT_FOUND.code, message: '退款回调商户订单号不一致' });
  }
  if (result.out_refund_no && caseItem.outRefundNo && result.out_refund_no !== caseItem.outRefundNo) {
    return fail({ code: ERRORS.CASE_NOT_FOUND.code, message: '退款回调退款单号不一致' });
  }
  const refundFen = result.amount && result.amount.refund != null
    ? Number(result.amount.refund) : null;
  const totalFen = result.amount && result.amount.total != null
    ? Number(result.amount.total) : null;
  if (refundFen !== null && refundFen !== Number(caseItem.amountFen)) {
    return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '退款金额与订单不一致' });
  }
  if (totalFen !== null && totalFen !== Number(order.amountFen)) {
    return fail({ code: ERRORS.ORDER_AMOUNT_MISMATCH.code, message: '订单总额校验失败' });
  }

  if (refundStatus === 'SUCCESS') {
    const reversed = await reverseOrderEntitlement(
      db,
      order,
      refundFen == null ? Number(caseItem.amountFen) : refundFen
    );
    if (!reversed.success) return reversed;
    const nowTs = result.success_time ? new Date(result.success_time) : new Date();
    await afterSales.updateCase(db, caseItem._id, {
      status: CaseStatus.REFUNDED,
      refundStatus: RefundStatus.REFUNDED,
      refundedAt: nowTs,
      refundId: result.refund_id || caseItem.refundId || '',
      refundAmountFen: refundFen == null ? Number(caseItem.amountFen) : refundFen,
      refundResult: {
        status: refundStatus,
        refundId: result.refund_id || '',
        successTime: result.success_time || '',
        source,
      },
      failureReason: '',
      failureCode: '',
      fundingBlocked: false,
      fundingBlockedAt: null,
    });
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        refundStatus: RefundStatus.REFUNDED,
        refundId: result.refund_id || order.refundId || '',
        refundedAmountFen: refundFen == null ? Number(caseItem.amountFen) : refundFen,
        refundedAt: nowTs,
        updatedAt: new Date(),
      },
    });
    return ok({ refundStatus: RefundStatus.REFUNDED, caseId: caseItem._id });
  }

  if (['CLOSED', 'ABNORMAL', 'REFUND_FAILED'].includes(refundStatus)) {
    const failure = refundFailureOf({
      message: result.failure_reason || result.status || '微信退款未成功',
      code: result.failure_code || result.code || '',
      statusCode: 0,
    }, '微信退款未成功');
    await afterSales.updateCase(db, caseItem._id, {
      status: CaseStatus.REFUND_FAILED,
      refundStatus: RefundStatus.FAILED,
      refundId: result.refund_id || caseItem.refundId || '',
      failureReason: failure.failureReason,
      failureCode: failure.failureCode,
      fundingBlocked: failure.fundingBlocked,
      fundingBlockedAt: failure.fundingBlocked ? new Date() : null,
      refundResult: { status: refundStatus, source },
    });
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: { refundStatus: RefundStatus.FAILED, updatedAt: new Date() },
    });
    return ok({ refundStatus: RefundStatus.FAILED, caseId: caseItem._id });
  }

  await afterSales.updateCase(db, caseItem._id, {
    status: CaseStatus.PROCESSING,
    refundStatus: RefundStatus.PROCESSING,
    refundId: result.refund_id || caseItem.refundId || '',
    failureReason: '',
    failureCode: '',
    fundingBlocked: false,
    fundingBlockedAt: null,
    refundResult: { status: refundStatus || 'PROCESSING', source },
  });
  return ok({ refundStatus: RefundStatus.PROCESSING, caseId: caseItem._id });
}

async function handleRefundCallback(event, body, notification, config) {
  let refund;
  try {
    refund = wxpay.decryptResource(notification.resource, config.apiV3Key);
  } catch (err) {
    safeLog({
      route: 'refund', eventType: notification.event_type, headers: event.headers, body, verified: true,
      reason: `DECRYPT_FAILED:${err.message}`,
    });
    return callbackFailure('退款回调资源解密失败', 500);
  }

  const outRefundNo = refund.out_refund_no || '';
  safeLog({
    route: 'refund', eventType: notification.event_type, outRefundNo,
    outTradeNo: refund.out_trade_no || '', headers: event.headers, body, verified: true,
    reason: 'PROCESSING',
  });
  const caseItem = await findCaseByOutRefundNo(db, outRefundNo);
  if (!caseItem) return callbackFailure('售后记录不存在', 500);

  const applied = await applyRefundResult(caseItem, refund, 'refund_callback');
  if (!applied.success) {
    safeLog({
      route: 'refund', eventType: notification.event_type, outRefundNo,
      outTradeNo: refund.out_trade_no || '', headers: event.headers, body, verified: true,
      reason: `APPLY_FAILED:${applied.errorCode || 0}`,
    });
    return callbackFailure(applied.error || '退款状态更新失败', 500);
  }
  return callbackSuccess();
}

async function handleHttpCallback(event) {
  const route = callbackKindOf(event);
  if (route === 'unknown') return callbackFailure('回调路由不存在', 404);
  if (route === 'virtual') return handleVirtualHttpCallback(event);

  const config = wxpay.configOf();
  if (!wxpay.hasCallbackPublicKey(config) || !config.apiV3Key) {
    console.error('[payment] callback configuration missing');
    return callbackFailure('支付回调配置未完成', 500);
  }

  const body = rawBodyOf(event);
  if (!body) return callbackFailure('请求体为空');
  const verified = wxpay.verifyCallbackSignature({
    headers: event.headers || {},
    body,
    config,
  });
  const reason = callbackVerificationReason(event.headers || {}, body, config, verified);
  safeLog({ route, headers: event.headers, body, verified, reason });
  if (!verified) return callbackFailure('签名校验失败', 401);

  let notification;
  try {
    notification = JSON.parse(body);
  } catch (err) {
    safeLog({ route, headers: event.headers, body, verified: true, reason: 'INVALID_JSON' });
    return callbackFailure('回调 JSON 不合法');
  }

  if (route === 'refund') {
    return handleRefundCallback(event, body, notification, config);
  }
  return handlePaymentCallback(event, body, notification, config);
}

/* ============================== 查单与订单 ============================== */

function orderErrorView(order) {
  return {
    orderId: order && order._id,
    status: order ? order.status : '',
    entitlementStatus: order ? grantStateOf(order) : '',
    pending: !!(order && order.status === OrderStatus.PENDING),
  };
}

async function userOf(order) {
  if (!order) return null;
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: order.userId }).get();
  return (res.data || [])[0] || null;
}

async function ensureGrantFailureCase(order, message = '') {
  if (!order || !order._id) return null;
  const fresh = await findOrderById(db, order._id);
  if (!fresh || fresh.status !== OrderStatus.PAID || fresh.grantStatus !== GrantStatus.FAILED) return null;
  try {
    const created = await afterSales.createCaseRecord(db, fresh.userId, {
      orderId: fresh._id,
      type: CaseType.RIGHTS_NOT_RECEIVED,
      requestId: afterSales.systemRequestIdOf('GRANT_FAILED', fresh._id),
      reasonCode: 'SYSTEM_GRANT_FAILED',
      description: '支付已确认但权益发放失败，系统已进入补发队列。',
    }, {
      priority: 'HIGH',
      systemGenerated: true,
      grantError: String(message || fresh.grantError || '').slice(0, 300),
    });
    if (!created.success && created.errorCode !== ERRORS.AFTER_SALES_EXISTS.code) {
      console.error('[payment] create grant failure case failed', {
        orderId: fresh._id,
        errorCode: created.errorCode,
        error: created.error,
      });
    }
    return created;
  } catch (err) {
    console.error('[payment] create grant failure case failed', { orderId: fresh._id, message: err.message });
    return null;
  }
}

async function ensureGrantUnknownCase(order) {
  if (!order || !order._id || order.status !== OrderStatus.PAID
    || order.grantStatus) return null;
  try {
    return await afterSales.createCaseRecord(db, order.userId, {
      orderId: order._id,
      type: CaseType.RIGHTS_NOT_RECEIVED,
      requestId: afterSales.systemRequestIdOf('GRANT_UNKNOWN', order._id),
      reasonCode: 'SYSTEM_GRANT_LEGACY_UNKNOWN',
      description: '历史订单缺少明确的权益发放状态，系统已转人工核验。',
    }, {
      priority: 'HIGH',
      systemGenerated: true,
      grantSchemaVersion: order.grantSchemaVersion || 0,
    });
  } catch (err) {
    if (err && err.errorCode === ERRORS.AFTER_SALES_EXISTS.code) return null;
    console.error('[payment] create unknown grant case failed', {
      orderId: order._id,
      message: err.message,
    });
    return null;
  }
}

async function resolveGrantCasesForOrder(order) {
  if (!order || !order._id) return;
  const res = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({
      orderId: order._id,
      type: CaseType.RIGHTS_NOT_RECEIVED,
      status: db.command.in([CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW, CaseStatus.REFUND_FAILED]),
    })
    .get();
  for (const item of (res.data || [])) {
    await afterSales.updateCase(db, item._id, {
      status: CaseStatus.RESOLVED,
      decisionNote: '系统已补发权益，无需退款。',
      reviewedAt: new Date(),
      reviewerOpenId: 'SYSTEM',
    });
    await afterSales.logAdminAction(db, 'SYSTEM', 'RESOLVE_GRANT', item, {
      entitlementStatus: 'PAID_GRANTED',
    });
  }
}

/**
 * 只把候选重复支付送入 2 分钟定时队列，不在支付回调里发起退款网络请求，
 * 避免退款接口超时拖垮微信支付回调响应。
 */
async function queueDuplicateChargeCase(order) {
  const target = await afterSales.duplicateChargeTarget(db, order);
  if (!target.duplicate || !target.targetOrderId) return ok({ skipped: true, reason: 'NO_DUPLICATE' });
  if (await afterSales.hasAnyCaseForOrder(db, order.userId, target.targetOrderId)) {
    return ok({ skipped: true, reason: 'CASE_EXISTS' });
  }
  const targetOrder = await findOrderById(db, target.targetOrderId);
  if (!targetOrder || targetOrder.status !== OrderStatus.PAID) {
    return ok({ skipped: true, reason: 'TARGET_NOT_PAID' });
  }
  if (afterSales.paymentChannelOf(targetOrder) === 'APPLE') {
    // Apple 订单的退款只能由用户在 App Store 发起，服务端不能代退，客服也没有可执行的动作。
    // 给它建单只会生成一条谁都处理不了的工单，还会让用户在自己的订单里凭空看到售后记录。
    console.warn('[payment] skip duplicate charge case for apple order', {
      orderId: targetOrder._id,
      otherOrderId: target.otherOrderId || '',
    });
    return ok({ skipped: true, reason: 'APPLE_CHANNEL' });
  }
  if (targetOrder.refundStatus && targetOrder.refundStatus !== RefundStatus.NONE) {
    return ok({ skipped: true, reason: 'REFUND_ALREADY_STARTED' });
  }
  const user = await afterSales.refundEvidenceUser(db, targetOrder.userId);
  const eligibility = afterSales.refundEligibilityOf(targetOrder, user || {});
  const created = await afterSales.createCaseRecord(db, targetOrder.userId, {
    orderId: targetOrder._id,
    type: CaseType.DUPLICATE_CHARGE,
    requestId: afterSales.systemRequestIdOf('DUPLICATE_CHARGE', targetOrder._id),
    reasonCode: 'SYSTEM_DUPLICATE_CHARGE',
    description: `系统检测到同商品 ${Math.floor(DUPLICATE_WINDOW_MS / 60000)} 分钟内存在重复支付。`,
  }, {
    priority: 'HIGH',
    systemGenerated: true,
    // 系统自查出来的重复单只做人工核验，不自动退款，也不写订单退款状态：
    // 用户没有申请过售后，不能让他打开订单就看见一张退款卡片。
    reviewOnly: true,
    duplicate: target,
    eligibility,
  });
  if (!created.success) return created;
  return created;
}

async function paymentSideEffects(order) {
  if (!order) return;
  if (order.status === OrderStatus.PAID && order.grantStatus === GrantStatus.FAILED) {
    await ensureGrantFailureCase(order, order.grantError || '');
    return;
  }
  if (order.status === OrderStatus.PAID && order.grantStatus === GrantStatus.GRANTED) {
    await resolveGrantCasesForOrder(order);
    await queueDuplicateChargeCase(order);
    return;
  }
  if (order.status === OrderStatus.PAID && !order.grantStatus) {
    await ensureGrantUnknownCase(order);
  }
}

async function paymentResultView(order) {
  const user = await userOf(order);
  return {
    ...paymentViewOf(order),
    memberExpiresAt: user ? user.memberExpiresAt || null : null,
    taskPackCount: user ? Math.max(0, parseInt(user.taskPackCount, 10) || 0) : 0,
    taskPackSlots: user ? Math.max(0, parseInt(user.taskPackSlots, 10) || 0) : 0,
  };
}

async function syncLegacyOrder(order, config = wxpay.configOf()) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID) {
    if (order.grantStatus === GrantStatus.GRANTED) {
      await paymentSideEffects(order);
      return ok(await paymentResultView(order));
    }
    if (order.grantStatus !== GrantStatus.FAILED) {
      await paymentSideEffects(order);
      return ok(await paymentResultView(order));
    }
    // 已确认支付但发放事务失败：允许在查单/补偿/客服操作中重试同一订单，不重复扣款。
    const retried = await fulfillOrder(db, order, {
      totalFee: Number(order.amountFen),
      transactionId: order.transactionId || '',
      raw: {
        tradeState: 'SUCCESS',
        appId: config.appId,
        mchId: config.mchId,
        outTradeNo: order.outTradeNo,
      },
    });
    if (!retried.success) {
      await ensureGrantFailureCase(await findOrderById(db, order._id), retried.error || '');
      return retried;
    }
    const fresh = await findOrderById(db, order._id);
    await paymentSideEffects(fresh || order);
    return ok(await paymentResultView(fresh || order));
  }
  if (order.status === OrderStatus.CLOSED && !isOrderExpired(order)) {
    return ok(await paymentResultView(order));
  }
  if (!wxpay.hasApiConfig(config)) return ok(await paymentResultView(order));

  const queried = await wxpay.queryOrder({ outTradeNo: order.outTradeNo, config });
  if (queried.mchid && queried.mchid !== config.mchId) {
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '支付查询商户校验失败' });
  }
  if (queried.appid && queried.appid !== config.appId) {
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '支付查询 AppID 校验失败' });
  }
  if (queried.out_trade_no && queried.out_trade_no !== order.outTradeNo) {
    return fail({ code: ERRORS.ORDER_NOT_FOUND.code, message: '支付查询订单号校验失败' });
  }
  if (isQueryPaidResult(queried)) {
    if (amountOf(queried) !== Number(order.amountFen)) return fail(ERRORS.ORDER_AMOUNT_MISMATCH);
    const fulfilled = await fulfillOrder(db, order, {
      totalFee: amountOf(queried),
      transactionId: queried.transaction_id || '',
      raw: {
        tradeState: queried.trade_state,
        appId: queried.appid,
        mchId: queried.mchid,
        outTradeNo: order.outTradeNo,
      },
    });
    if (!fulfilled.success) {
      await ensureGrantFailureCase(await findOrderById(db, order._id), fulfilled.error || '');
      return fulfilled;
    }
    const fresh = await findOrderById(db, order._id);
    await paymentSideEffects(fresh || { ...order, status: OrderStatus.PAID });
    return ok(await paymentResultView(fresh || { ...order, status: OrderStatus.PAID }));
  }

  if (isQueryClosedResult(queried)) {
    const closed = await markOrderClosed(db, order, 'WECHAT_CLOSED');
    return ok(await paymentResultView(closed));
  }

  if (isOrderExpired(order)) {
    try {
      await wxpay.closeOrder({ outTradeNo: order.outTradeNo, config });
      const closed = await markOrderClosed(db, order, 'EXPIRED');
      return ok(await paymentResultView(closed));
    } catch (err) {
      // 只有在微信明确告知订单不存在/已关闭时才能落 CLOSED；网络失败继续保留 PENDING 等补偿。
      if (!/ORDER_NOT_EXIST|ORDER_CLOSED|已关闭|不存在/i.test(`${err.code || ''} ${err.message || ''}`)) {
        throw err;
      }
      const closed = await markOrderClosed(db, order, 'WECHAT_ORDER_NOT_OPEN');
      return ok(await paymentResultView(closed));
    }
  }

  return ok(await paymentResultView(order));
}

async function persistVirtualQuery(order, queried) {
  const nowTs = new Date();
  const status = virtualPay.statusOf(queried);
  const orderType = virtualPay.orderTypeOf(queried);
  const patch = {
    paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
    virtualEnv: virtualPay.environmentOf(queried) == null
      ? Number(order.virtualEnv) || 0
      : virtualPay.environmentOf(queried),
    virtualOrderStatus: status,
    channelOrderType: orderType,
    wxOrderId: queried.wx_order_id || '',
    wxPayOrderId: queried.wxpay_order_id || '',
    channelOrderId: queried.channel_order_id || '',
    updatedAt: nowTs,
  };
  const orderFee = virtualPay.orderFeeOf(queried);
  const paidFee = virtualPay.paidAmountOf(queried);
  if (orderFee != null) patch.orderFee = orderFee;
  if (paidFee != null) patch.paidFee = paidFee;
  if (status === virtualPay.VirtualOrderStatus.DELIVERED) patch.deliveredAt = nowTs;
  await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({ data: patch });
}

async function grantVirtualOrder(order, queried) {
  let grantError = '';
  try {
    if (!virtualPay.bizMetaMatchesOrder(queried, order)) {
      grantError = '虚拟支付订单附加标识不一致';
    }
  } catch (err) {
    grantError = err.message;
  }
  if (!grantError) {
    try {
      virtualPay.assertGrantProduct(order, virtualPay.configForOrder(order));
    } catch (err) {
      grantError = err.message;
    }
  }
  if (grantError) {
    try {
      await persistVirtualQuery(order, queried);
    } catch (err) {
      console.error('[payment] persist rejected virtual grant failed', {
        orderId: order._id,
        message: err.message,
      });
    }
    await markGrantFailed(db, order, grantError);
    const failed = await findOrderById(db, order._id);
    await ensureGrantFailureCase(failed || order, grantError);
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: grantError });
  }
  await persistVirtualQuery(order, queried);
  const fulfilled = await fulfillOrder(db, order, {
    totalFee: Number(order.amountFen),
    transactionId: queried.wxpay_order_id || queried.wx_order_id || queried.channel_order_id || '',
    paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
    channelOrderType: virtualPay.orderTypeOf(queried),
    tradeState: 'SUCCESS',
    outTradeNo: order.outTradeNo,
  });
  if (!fulfilled.success) {
    await ensureGrantFailureCase(await findOrderById(db, order._id), fulfilled.error || '');
    return fulfilled;
  }
  const fresh = await findOrderById(db, order._id);
  await paymentSideEffects(fresh || { ...order, status: OrderStatus.PAID });
  return ok(await paymentResultView(fresh || { ...order, status: OrderStatus.PAID }));
}

/**
 * 查不到平台结果时必须留下证据：没有失败记录的滞留单等于静默故障。
 * 写库失败只打日志，不能让补偿本身中断。
 */
async function recordVirtualQueryFailure(order, reason, err) {
  const detail = String((err && (err.errcode || err.code || err.message)) || reason || '').slice(0, 200);
  try {
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        reconcileError: detail || reason,
        reconcileErrorAt: new Date(),
        reconcileFailCount: Math.max(0, Number(order.reconcileFailCount) || 0) + 1,
        updatedAt: new Date(),
      },
    });
  } catch (writeErr) {
    console.error('[payment] record virtual query failure failed', {
      orderId: order._id,
      message: writeErr && (writeErr.errMsg || writeErr.message),
    });
  }
}

/**
 * 平台确认不了支付结果时，用本地有效期收口。
 * - 未过期：不动，交给上层重试；
 * - 过期但仍在宽限期内：只记录失败证据；
 * - 过期超过宽限期：本地关单，避免订单永久停留在待支付。
 * 关单不吞掉真实支付：已关闭且已过期的订单仍会继续查单，平台确认支付后
 * 从 CLOSED 收口回 PAID 并补发权益。
 */
async function settleExpiredVirtualOrder(order, reason, err) {
  if (!order || !isOrderExpired(order)) return null;
  await recordVirtualQueryFailure(order, reason, err);
  const expiredAt = orderExpiresAtMs(order);
  if (Date.now() - expiredAt < VIRTUAL_PAY_QUERY_GRACE_MS) return null;
  const closed = await markOrderClosed(db, order, reason);
  console.warn('[payment] closed virtual order without platform confirmation', {
    orderId: order._id,
    closeReason: reason,
  });
  return closed;
}

async function syncVirtualOrder(order, config = virtualPay.configOf()) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID) {
    if (order.grantStatus === GrantStatus.GRANTED) {
      await paymentSideEffects(order);
      return ok(await paymentResultView(order));
    }
    if (order.grantStatus !== GrantStatus.FAILED) {
      await paymentSideEffects(order);
      return ok(await paymentResultView(order));
    }
    try {
      virtualPay.assertGrantProduct(order, config);
    } catch (err) {
      await ensureGrantFailureCase(order, err.message);
      return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: err.message });
    }
    const retried = await fulfillOrder(db, order, {
      totalFee: Number(order.amountFen),
      transactionId: order.transactionId || '',
      paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
      channelOrderType: order.channelOrderType,
      tradeState: 'SUCCESS',
      outTradeNo: order.outTradeNo,
    });
    if (!retried.success) {
      await ensureGrantFailureCase(await findOrderById(db, order._id), retried.error || '');
      return retried;
    }
    const fresh = await findOrderById(db, order._id);
    await paymentSideEffects(fresh || order);
    return ok(await paymentResultView(fresh || order));
  }
  if (order.status === OrderStatus.CLOSED && !isOrderExpired(order)) {
    return ok(await paymentResultView(order));
  }
  if (!virtualPay.hasApiConfig(config)) {
    console.error('[payment] virtual pay config incomplete', { orderId: order._id });
    const closed = await settleExpiredVirtualOrder(order, 'VIRTUAL_PAY_CONFIG_MISSING');
    return ok(await paymentResultView(closed || order));
  }

  let queried;
  try {
    queried = await virtualPay.queryPaymentOrder({ order, config });
  } catch (err) {
    const closed = await settleExpiredVirtualOrder(order, 'VIRTUAL_PAY_QUERY_FAILED', err);
    if (closed) return ok(await paymentResultView(closed));
    throw err;
  }
  if (queried.order_id && queried.order_id !== order.outTradeNo) {
    return fail({ code: ERRORS.ORDER_NOT_FOUND.code, message: '虚拟支付查单订单号不一致' });
  }
  const queriedEnv = virtualPay.environmentOf(queried);
  if (queriedEnv != null && queriedEnv !== Number(config.env)) {
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '虚拟支付查单环境不一致' });
  }
  if (virtualPay.isPaidResult(queried)) {
    const orderFee = virtualPay.orderFeeOf(queried);
    if (orderFee == null || orderFee !== Number(order.amountFen)) {
      return fail(ERRORS.ORDER_AMOUNT_MISMATCH);
    }
    return grantVirtualOrder(order, queried);
  }
  if (virtualPay.isClosedResult(queried)) {
    await persistVirtualQuery(order, queried);
    const closed = await markOrderClosed(db, order, 'VIRTUAL_PAY_CLOSED');
    return ok(await paymentResultView(closed));
  }

  await persistVirtualQuery(order, queried).catch(err => {
    console.error('[payment] persist virtual query failed', { orderId: order._id, message: err.message });
  });
  if (isOrderExpired(order)) {
    // 走到这里已经排除“平台确认已支付”和“平台确认已关闭”，过期就该收口。
    // 不再要求平台明确返回 INIT/CREATED：未知或无法解析的状态同样不能永久停留在待支付。
    const closed = await markOrderClosed(db, order, 'VIRTUAL_PAY_EXPIRED_UNPAID');
    return ok(await paymentResultView(closed));
  }
  return ok(await paymentResultView(order));
}

async function syncOrder(order, legacyConfig = wxpay.configOf()) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (paymentProvider.isVirtualPay(order)) {
    return syncVirtualOrder(order, virtualPay.configForOrder(order));
  }
  return syncLegacyOrder(order, legacyConfig);
}

async function createVirtualPayment(context, event, order) {
  const config = virtualPay.configForOrder(order);
  if (!virtualPay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  let virtualProductId = '';
  try {
    virtualProductId = virtualPay.validateOrderSku(order, config);
    if (order.virtualProductId && String(order.virtualProductId) !== virtualProductId) {
      return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '订单商品快照与配置不一致' });
    }
  } catch (err) {
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: err.message });
  }
  if (!event.loginCode) {
    return fail({ code: ERRORS.BAD_PARAM.code, message: '请重新登录后发起支付' });
  }

  const login = await wechatAuth.exchangeLoginCode({
    code: event.loginCode,
    config: { appId: config.appId, appSecret: config.appSecret },
  });
  if (login.openId !== context.OPENID) {
    return fail({ code: ERRORS.UNAUTHORIZED.code, message: '微信登录态与当前用户不一致' });
  }

  const virtualPayment = virtualPay.createClientPayment({
    order,
    sessionKey: login.sessionKey,
    config,
  });
  await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
    data: {
      paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
      virtualProductId,
      virtualEnv: config.env,
      updatedAt: new Date(),
    },
  });
  return ok({
    ...(await paymentResultView(order)),
    outTradeNo: order.outTradeNo,
    paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
    virtualPayment,
    expiresAt: order.expiresAt || null,
  });
}

async function createPayment(context, event) {
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);

  if (order.status === OrderStatus.PENDING && isOrderExpired(order)) {
    const synced = await syncOrder(order);
    if (!synced.success) return synced;
    order = await findOrderById(db, order._id);
    if (order.status === OrderStatus.CLOSED) return fail(ERRORS.ORDER_EXPIRED);
  }
  if (order.status === OrderStatus.PAID) {
    if (order.grantStatus === GrantStatus.FAILED) {
      const retried = await syncOrder(order);
      if (!retried.success) return retried;
    } else if (order.grantStatus !== GrantStatus.GRANTED) {
      await paymentSideEffects(order);
    }
    return ok({ ...(await paymentResultView(await findOrderById(db, order._id) || order)), alreadyPaid: true });
  }
  if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_EXPIRED);

  const sales = await membershipSales.read(db);
  if (sales.purchaseEnabled !== true) {
    return fail(ERRORS.MEMBERSHIP_SALES_PAUSED, {
      sales: membershipSales.publicView(sales),
    });
  }

  if (paymentProvider.isVirtualPay(
    order,
    process.env,
    context.OPENID,
    event.clientSupportsVirtualPay === true
  )) {
    return createVirtualPayment(context, event, order);
  }

  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);

  // 首次拉起旧通道时固化渠道。这样部署切换 PAYMENT_PROVIDER 时，已经
  // 进入支付窗口的订单仍会用原渠道查单、关单和退款。
  const pinnedAt = new Date();
  await db.collection(COLLECTIONS.ORDERS).where({
    _id: order._id,
    status: OrderStatus.PENDING,
  }).update({
    data: {
      paymentProvider: paymentProvider.PaymentProvider.WECHAT_PAY_V3,
      updatedAt: pinnedAt,
    },
  });
  order = {
    ...order,
    paymentProvider: paymentProvider.PaymentProvider.WECHAT_PAY_V3,
    updatedAt: pinnedAt,
  };

  const result = await wxpay.createJsapiOrder({ order, openid: context.OPENID, config });
  if (!result.prepay_id) throw new wxpay.WxPayApiError('微信支付未返回 prepay_id');
  const payment = wxpay.signPayParams({
    appId: config.appId,
    prepayId: result.prepay_id,
    privateKey: config.privateKey,
  });
  return ok({
    ...(await paymentResultView(order)),
    outTradeNo: order.outTradeNo,
    payment,
    paymentProvider: paymentProvider.PaymentProvider.WECHAT_PAY_V3,
    expiresAt: order.expiresAt || null,
  });
}

async function queryPayment(context, event) {
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID && order.grantStatus === GrantStatus.GRANTED) {
    await paymentSideEffects(order);
    return ok(await paymentResultView(order));
  }
  if (order.status === OrderStatus.PAID && order.grantStatus !== GrantStatus.FAILED) {
    await paymentSideEffects(order);
    return ok(await paymentResultView(order));
  }

  const synced = await syncOrder(order);
  if (!synced.success) return synced;
  order = await findOrderById(db, order._id);
  return ok(await paymentResultView(order));
}

async function cancelPayment(context, event) {
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.CLOSED) return ok(await paymentResultView(order));
  if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_NOT_FOUND);

  const synced = await syncOrder(order);
  if (!synced.success) return synced;
  order = await findOrderById(db, order._id);
  if (order.status !== OrderStatus.PENDING) return ok(await paymentResultView(order));

  if (paymentProvider.isVirtualPay(order, process.env, context.OPENID)) {
    const closed = await markOrderClosed(db, order, 'USER_CANCEL_VIRTUAL_PAY');
    return ok(await paymentResultView(closed));
  }

  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  await wxpay.closeOrder({ outTradeNo: order.outTradeNo, config });
  const closed = await markOrderClosed(db, order, 'USER_CANCEL');
  return ok(await paymentResultView(closed));
}

/* ============================== 售后 ============================== */

function adminRequired(context) {
  return afterSales.isAfterSalesAdmin(context.OPENID) ? null : fail(ERRORS.FORBIDDEN);
}

async function setMembershipSales(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const state = String(event.state || '').trim().toUpperCase();
  if (![MembershipSalesState.OPEN, MembershipSalesState.PAUSED].includes(state)) {
    return fail(ERRORS.BAD_PARAM);
  }
  const reason = String(event.reason || '').trim().slice(0, 160);
  if (state === MembershipSalesState.PAUSED && !reason) {
    return fail({ code: ERRORS.BAD_PARAM.code, message: '暂停会员购买时必须填写原因' });
  }
  const nowTs = new Date();
  await db.runTransaction(async transaction => {
    await transaction.collection(COLLECTIONS.PAYMENT_CONFIG)
      .doc(membershipSales.SALES_CONFIG_ID)
      .set({
        data: {
          state,
          reason: state === MembershipSalesState.PAUSED ? reason : '',
          updatedAt: nowTs,
          updatedBy: context.OPENID,
        },
      });
    await transaction.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
      data: {
        adminOpenId: context.OPENID,
        action: 'SET_MEMBERSHIP_SALES',
        caseId: '',
        orderId: '',
        details: { state, reason },
        createdAt: nowTs,
      },
    });
  });
  membershipSales.invalidate(db);
  const current = await membershipSales.read(db);
  return ok({ membershipSales: membershipSales.adminView(current) });
}

async function setMembershipEnforcement(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const mode = membershipEnforcement.normalizedMode(event.mode);
  if (!mode) return fail(ERRORS.BAD_PARAM);

  if (mode === membershipEnforcement.EnforcementMode.ALL) {
    const [protectionReady, entitlementReady] = await Promise.all([
      protectionMigrationCompleted(db).catch(() => false),
      entitlementMigrationCompleted(db).catch(() => false),
    ]);
    if (!protectionReady || !entitlementReady) {
      return fail(ERRORS.MEMBERSHIP_ENFORCEMENT_NOT_READY);
    }
  }

  const previous = await membershipEnforcement.read(db);
  const nowTs = new Date();
  await db.runTransaction(async transaction => {
    await membershipEnforcement.write(transaction, {
      mode,
      updatedBy: context.OPENID,
      now: nowTs,
    });
    await transaction.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
      data: {
        adminOpenId: context.OPENID,
        action: 'SET_MEMBERSHIP_ENFORCEMENT',
        caseId: '',
        orderId: '',
        details: {
          mode,
          previousMode: previous.mode || '',
          previousSource: previous.source || '',
        },
        createdAt: nowTs,
      },
    });
  });
  membershipEnforcement.invalidate(db);
  const current = await membershipEnforcement.read(db);
  return ok({ membershipEnforcement: membershipEnforcement.adminView(current) });
}

async function setMembershipUpgradeNotice(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const enabled = event.enabled === true;
  const current = await membershipUpgradeNotice.read(db, { cache: false });
  const nowTs = new Date();
  const currentEndsMs = new Date(current.endsAt || 0).getTime();
  const restarting = enabled && (current.enabled !== true
    || !Number.isFinite(currentEndsMs)
    || currentEndsMs <= nowTs.getTime());
  const startsAt = restarting ? nowTs : (current.startsAt || nowTs);
  const endsAt = restarting
    ? new Date(nowTs.getTime() + 72 * 60 * 60 * 1000)
    : (current.endsAt || new Date(nowTs.getTime() + 72 * 60 * 60 * 1000));
  await db.runTransaction(async transaction => {
    await transaction.collection(COLLECTIONS.PAYMENT_CONFIG)
      .doc(membershipUpgradeNotice.CONFIG_ID)
      .set({
        data: {
          noticeId: current.noticeId || 'membership-unlimited-upgrade',
          enabled,
          startsAt,
          endsAt,
          updatedAt: nowTs,
          updatedBy: context.OPENID,
        },
      });
    await transaction.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
      data: {
        adminOpenId: context.OPENID,
        action: 'SET_MEMBERSHIP_UPGRADE_NOTICE',
        caseId: '',
        orderId: '',
        details: { enabled },
        createdAt: nowTs,
      },
    });
  });
  membershipUpgradeNotice.invalidate(db);
  const fresh = await membershipUpgradeNotice.read(db, { cache: false });
  return ok({ membershipUpgradeNotice: membershipUpgradeNotice.adminViewOf(fresh) });
}

async function adminCaseBundle(caseItem) {
  const order = await findOrderById(db, caseItem.orderId);
  const user = order ? await afterSales.refundEvidenceUser(db, order.userId) : null;
  const history = await afterSales.userCaseHistory(db, caseItem.userId, caseItem.orderId);
  const orderRefunded = !!order && (
    order.refundStatus === RefundStatus.REFUNDED
    || order.grantStatus === GrantStatus.REVERTED
    || order.status === OrderStatus.REFUNDED
  );
  const reviewableCase = [CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW, CaseStatus.REFUND_FAILED]
    .includes(caseItem.status);
  const rejectableCase = [CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW]
    .includes(caseItem.status);
  const paymentChannel = order ? afterSales.paymentChannelOf(order) : '';
  return {
    case: afterSales.caseViewOf(caseItem),
    order: order ? {
      orderId: order._id,
      outTradeNo: order.outTradeNo,
      title: order.title || '',
      amountFen: Number(order.amountFen) || 0,
      status: order.status,
      entitlementStatus: grantStateOf(order),
      refundStatus: order.refundStatus || RefundStatus.NONE,
      grantStatus: order.grantStatus || GrantStatus.NONE,
      paymentChannel,
      paymentChannelLabel: paymentChannel === 'APPLE'
        ? 'Apple 应用内购买'
        : (paymentChannel === 'WECHAT_VIRTUAL' ? '微信虚拟支付' : '微信支付'),
      entitlementGrant: order.entitlementGrant || {},
      paymentResult: order.paymentResult || {},
      paidAt: order.paidAt || null,
    } : null,
    user: user ? {
      openId: user.openId,
      nickname: user.nickname || '',
      memberExpiresAt: user.memberExpiresAt || null,
      taskPackCount: Math.max(0, parseInt(user.taskPackCount, 10) || 0),
      protectedTaskQuota: Math.max(0, parseInt(user.protectedTaskQuota, 10) || 0),
      lastReminderCreatedAt: user.lastReminderCreatedAt || null,
    } : null,
    history,
    actionCapabilities: {
      canSyncPayment: !!order && [OrderStatus.PENDING, OrderStatus.PAID].includes(order.status),
      canRetryGrant: !!order && order.status === OrderStatus.PAID
        && order.grantStatus === GrantStatus.FAILED && !orderRefunded,
      canApproveRefund: !!order && order.status === OrderStatus.PAID
        && reviewableCase && !orderRefunded,
      approveRefundLabel: caseItem.status === CaseStatus.REFUND_FAILED ? '重新发起退款' : '同意全额退款',
      canReject: rejectableCase,
      canSyncRefund: !!caseItem.outRefundNo
        && [CaseStatus.PROCESSING, CaseStatus.REFUND_FAILED].includes(caseItem.status),
    },
  };
}

async function submitAfterSales(context, event) {
  let syncResult = null;
  if ([
    'RIGHTS_NOT_RECEIVED', 'DUPLICATE_CHARGE', 'UNUSED_REFUND',
    'ENTITLEMENT_MISMATCH', 'OTHER',
  ].includes(event.type)) {
    const order = await afterSales.findOrderForUser(db, context.OPENID, event.orderId);
    if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
    if (order.status === OrderStatus.PENDING) {
      syncResult = await syncOrder(order);
      if (!syncResult.success) return syncResult;
      const fresh = await findOrderById(db, order._id);
      if (event.type === 'RIGHTS_NOT_RECEIVED' && grantStateOf(fresh) === 'PAID_GRANTED') {
        return ok({ resolved: true, ...(await paymentResultView(fresh)) });
      }
    } else if (event.type === 'RIGHTS_NOT_RECEIVED') {
      syncResult = await syncOrder(order);
      if (syncResult.success && syncResult.entitlementStatus === 'PAID_GRANTED') {
        return ok({ resolved: true, ...syncResult });
      }
    }
  }

  const order = await afterSales.findOrderForUser(db, context.OPENID, event.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const user = await afterSales.refundEvidenceUser(db, context.OPENID);
  let evidence = { eligibility: afterSales.refundEligibilityOf(order, user) };

  if (event.type === 'DUPLICATE_CHARGE') {
    evidence = { ...evidence, duplicate: await afterSales.duplicateEvidence(db, order) };
  }

  const created = await afterSales.createCaseRecord(db, context.OPENID, event, evidence);
  if (!created.success) return created;

  // 重复支付在证据明确且本单尚未被使用时自动发起全额退款；其余类型进入客服审核。
  const persistedEligibility = (created.case && created.case.evidence
    && created.case.evidence.eligibility) || evidence.eligibility;
  if (event.type === 'DUPLICATE_CHARGE'
    && evidence.duplicate && evidence.duplicate.duplicate
    && !persistedEligibility.usedAfterPurchase) {
    const caseItem = await afterSales.getCaseById(db, created.case._id);
    const auto = await approveRefund(context, { caseId: caseItem._id }, 'SYSTEM_DUPLICATE_CHARGE');
    const fresh = await afterSales.getCaseById(db, caseItem._id);
    return ok({
      case: afterSales.caseViewOf(fresh || caseItem),
      autoRefund: auto.success,
      autoRefundError: auto.success ? '' : auto.error,
    });
  }

  return created;
}

async function syncRights(context, event) {
  const order = await afterSales.findOrderForUser(db, context.OPENID, event.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const synced = await syncOrder(order);
  if (!synced.success) return synced;
  return synced;
}

function virtualRefundResultOf(caseItem, order, result = {}) {
  const status = virtualPay.statusOf(result);
  const refundStatus = status === virtualPay.VirtualOrderStatus.REFUNDED
    ? 'SUCCESS'
    : (status === virtualPay.VirtualOrderStatus.REFUND_FAILED ? 'REFUND_FAILED' : 'PROCESSING');
  const refundFen = Number(result.refund_fee != null ? result.refund_fee : caseItem.amountFen);
  return {
    status: refundStatus,
    out_trade_no: order.outTradeNo,
    out_refund_no: result.order_id || caseItem.outRefundNo,
    refund_id: result.wx_order_id || '',
    amount: {
      refund: Number.isFinite(refundFen) ? refundFen : Number(caseItem.amountFen),
      total: Number(order.amountFen),
    },
    success_time: result.paid_time
      ? new Date(Number(result.paid_time) * 1000).toISOString()
      : '',
    failure_reason: status === virtualPay.VirtualOrderStatus.REFUND_FAILED ? '虚拟支付退款失败' : '',
  };
}

function logVirtualEvent(message) {
  console.log('[payment] virtual event', {
    event: message.event || '',
    outTradeNo: message.outTradeNo || '',
    outRefundNo: message.outRefundNo || '',
    env: message.env,
  });
}

async function handleVirtualDelivery(message) {
  if (!message.outTradeNo) return virtualNotify.cloudFailure('缺少商户订单号');
  const order = await findOrderByOutTradeNo(db, message.outTradeNo);
  if (!order) return virtualNotify.cloudFailure('订单不存在');
  if (!paymentProvider.isVirtualPay(order)) return virtualNotify.cloudFailure('订单支付渠道不匹配');
  if (message.openId !== order.userId) return virtualNotify.cloudFailure('用户与订单不匹配');

  const config = virtualPay.configForOrder(order, process.env, message.env);
  if (!virtualPay.hasApiConfig(config)) return virtualNotify.cloudFailure('虚拟支付配置未完成');
  if (message.env != null && Number(message.env) !== Number(config.env)) {
    return virtualNotify.cloudFailure('虚拟支付环境不匹配');
  }
  if (order.virtualEnv != null && Number(order.virtualEnv) !== Number(config.env)) {
    return virtualNotify.cloudFailure('订单保存的虚拟支付环境不匹配');
  }

  if (order.status === OrderStatus.PAID && order.grantStatus === GrantStatus.GRANTED) {
    return virtualNotify.cloudSuccess();
  }
  if (order.grantStatus === GrantStatus.REVERTED
    || order.refundStatus === RefundStatus.REFUNDED
    || order.status === OrderStatus.REFUNDED) {
    return virtualNotify.cloudSuccess();
  }

  const result = await syncVirtualOrder(order, config);
  if (!result.success) return virtualNotify.cloudFailure(result.error || '权益发放失败');
  const fresh = await findOrderById(db, order._id);
  if (fresh && fresh.status === OrderStatus.PAID && fresh.grantStatus === GrantStatus.GRANTED) {
    return virtualNotify.cloudSuccess();
  }
  if (fresh && fresh.status === OrderStatus.PAID && fresh.grantStatus !== GrantStatus.FAILED) {
    await paymentSideEffects(fresh);
    return virtualNotify.cloudSuccess();
  }
  if (fresh && (fresh.grantStatus === GrantStatus.REVERTED
    || fresh.refundStatus === RefundStatus.REFUNDED
    || fresh.status === OrderStatus.REFUNDED)) {
    return virtualNotify.cloudSuccess();
  }
  return virtualNotify.cloudFailure('微信尚未确认支付成功');
}

async function virtualRefundCaseOf(message, order, outRefundNo, refundResult = {}) {
  let caseItem = await findCaseByOutRefundNo(db, outRefundNo);
  if (caseItem) return caseItem;

  const cases = await afterSales.casesForOrder(db, order.userId, order._id);
  caseItem = cases.find(item => item.outRefundNo === outRefundNo) || cases.find(item => [
    CaseStatus.AUTO_CHECKING,
    CaseStatus.UNDER_REVIEW,
    CaseStatus.APPROVED,
    CaseStatus.PROCESSING,
    CaseStatus.REFUND_FAILED,
  ].includes(item.status));
  if (caseItem && caseItem.outRefundNo !== outRefundNo) {
    await afterSales.markRefundProcessing(db, caseItem, outRefundNo);
    caseItem = await afterSales.getCaseById(db, caseItem._id);
  }
  if (caseItem) return caseItem;

  return afterSales.createPlatformRefundCase(db, order, outRefundNo, {
    systemGenerated: true,
    paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
    paymentChannel: virtualPay.isAppleOrder(refundResult) ? 'APPLE' : '',
  });
}

async function handleVirtualRefund(message) {
  if (!message.outRefundNo) return virtualNotify.cloudFailure('缺少商户退款单号');
  const orderNo = message.mchOrderId || message.outTradeNo;
  if (!orderNo) return virtualNotify.cloudFailure('缺少商户订单号');
  const order = await findOrderByOutTradeNo(db, orderNo);
  if (!order) return virtualNotify.cloudFailure('订单不存在');
  if (!paymentProvider.isVirtualPay(order)) return virtualNotify.cloudFailure('订单支付渠道不匹配');
  if (message.openId !== order.userId) return virtualNotify.cloudFailure('用户与订单不匹配');

  const config = virtualPay.configForOrder(order, process.env, message.env);
  if (!virtualPay.hasApiConfig(config)) return virtualNotify.cloudFailure('虚拟支付配置未完成');
  if (message.env != null && Number(message.env) !== Number(config.env)) {
    return virtualNotify.cloudFailure('虚拟支付环境不匹配');
  }
  if (order.virtualEnv != null && Number(order.virtualEnv) !== Number(config.env)) {
    return virtualNotify.cloudFailure('订单保存的虚拟支付环境不匹配');
  }

  const queried = await virtualPay.queryRefund({
    outRefundNo: message.outRefundNo,
    order,
    config,
  });
  if (queried.order_id && queried.order_id !== message.outRefundNo) {
    return virtualNotify.cloudFailure('虚拟支付退款单号不一致');
  }
  const refundFee = Number(queried.refund_fee != null ? queried.refund_fee : message.refundFee);
  if (Number.isFinite(refundFee) && refundFee !== Number(order.amountFen)) {
    return virtualNotify.cloudFailure('退款金额与订单不一致');
  }
  if (!virtualPay.isRefundedResult(queried)
    && !virtualPay.isRefundFailedResult(queried)
    && !virtualPay.isRefundProcessingResult(queried)) {
    return virtualNotify.cloudFailure('退款尚未完成');
  }

  const caseItem = await virtualRefundCaseOf(message, order, message.outRefundNo, queried);
  if (!caseItem) {
    if (order.refundStatus === RefundStatus.REFUNDED || order.status === OrderStatus.REFUNDED) {
      return virtualNotify.cloudSuccess();
    }
    return virtualNotify.cloudFailure('退款售后记录不存在');
  }
  const applied = await applyRefundResult(
    caseItem,
    virtualRefundResultOf(caseItem, order, queried),
    'virtual_refund_notify'
  );
  if (!applied.success) return virtualNotify.cloudFailure(applied.error || '退款状态更新失败');
  return virtualNotify.cloudSuccess();
}

async function iosRefundDecision(message) {
  const orderNo = message.payOrderId || message.mchOrderId || message.outTradeNo;
  if (!orderNo) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '退款问询缺少支付订单号，无法确认已发放权益，建议退款。',
    };
  }
  const order = await findOrderByOutTradeNo(db, orderNo);
  if (!order) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '系统未找到对应支付订单或权益发放记录，建议退款。',
    };
  }
  if (message.openId && order.userId !== message.openId) {
    return {
      result_code: 1,
      result_info: '拒绝退款',
      evidence: '退款问询中的用户与订单归属不一致，需人工核验。',
    };
  }
  if (order.refundStatus === RefundStatus.REFUNDED || order.status === OrderStatus.REFUNDED) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '该订单已经完成退款或权益回收，建议退款。',
    };
  }
  if (order.refundStatus === RefundStatus.PROCESSING) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '该订单退款正在处理中，建议退款。',
    };
  }
  if (order.status !== OrderStatus.PAID || order.grantStatus !== GrantStatus.GRANTED) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '订单尚未确认发放会员或提醒名额权益，建议退款。',
    };
  }

  const user = await afterSales.refundEvidenceUser(db, order.userId);
  const eligibility = afterSales.refundEligibilityOf(order, user || {});
  if (eligibility.eligibleForReview) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: `订单支付后尚未新增提醒，且仍在 24 小时退款窗口内，建议退款。订单支付时间：${order.paidAt || ''}。`,
    };
  }
  if (eligibility.usedAfterPurchase) {
    return {
      result_code: 1,
      result_info: '拒绝退款',
      evidence: '用户已在本单支付后新增提醒，本单新增会员或提醒名额权益已实际使用，不建议退款。',
    };
  }
  if (!eligibility.withinWindow) {
    return {
      result_code: 1,
      result_info: '拒绝退款',
      evidence: '订单已超过 24 小时退款窗口，权益已发放，不建议退款。',
    };
  }
  return {
    result_code: 1,
    result_info: '拒绝退款',
    evidence: '订单权益已经发放且当前不满足未使用退款条件，不建议退款。',
  };
}

async function handleIosRefundQuery(message) {
  let decision;
  try {
    decision = await iosRefundDecision(message);
  } catch (err) {
    console.error('[payment] ios refund decision failed', { message: err.message });
    decision = {
      result_code: 0,
      result_info: '建议退款',
      evidence: '系统暂时无法核验权益使用情况，为保障用户权益建议退款。',
    };
  }
  return virtualNotify.cloudSuccess({ IosRefundQueryResponse: decision });
}

async function handleVirtualMessage(payload = {}) {
  const message = virtualNotify.messageOf(payload);
  logVirtualEvent(message);
  switch (message.event) {
    case 'xpay_goods_deliver_notify':
      return handleVirtualDelivery(message);
    case 'xpay_refund_notify':
      return handleVirtualRefund(message);
    case 'xpay_subscribe_ios_refund_query_notify':
      return handleIosRefundQuery(message);
    default:
      // 未订阅的事件直接确认，避免微信无意义重试；新增事件时必须在这里显式处理。
      return virtualNotify.cloudSuccess();
  }
}

async function handleVirtualHttpCallback(event) {
  let payload;
  try {
    payload = virtualNotify.parseBody(rawBodyOf(event));
  } catch (err) {
    return virtualNotify.failureResponse(err.message, 400);
  }
  try {
    const result = await handleVirtualMessage(payload);
    if (result.ErrCode === 0) {
      const extra = result.IosRefundQueryResponse
        ? { IosRefundQueryResponse: result.IosRefundQueryResponse }
        : {};
      return virtualNotify.successResponse(extra);
    }
    return virtualNotify.failureResponse(result.ErrMsg || '虚拟支付消息处理失败');
  } catch (err) {
    console.error('[payment] virtual http callback failed', {
      name: err.name,
      message: err.message,
      errcode: err.errcode || 0,
    });
    return virtualNotify.failureResponse(err.message || '虚拟支付消息处理失败');
  }
}

async function syncRefundCase(caseItem) {
  const order = await findOrderById(db, caseItem.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (paymentProvider.isVirtualPay(order)) {
    const config = virtualPay.configForOrder(order);
    if (!virtualPay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
    if (!caseItem.outRefundNo) {
      return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '退款单尚未发起' });
    }
    const result = await virtualPay.queryRefund({
      outRefundNo: caseItem.outRefundNo,
      order,
      config,
    });
    return applyRefundResult(caseItem, virtualRefundResultOf(caseItem, order, result), 'refund_query');
  }

  const config = wxpay.configOf();
  if (!wxpay.hasRefundConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  if (!caseItem.outRefundNo) return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '退款单尚未发起' });
  const result = await wxpay.queryRefund({ outRefundNo: caseItem.outRefundNo, config });
  return applyRefundResult(caseItem, result, 'refund_query');
}

function isExplicitRefundNotFoundError(err) {
  const statusCode = Number(err && err.statusCode);
  const code = String((err && (err.code || err.errcode)) || '');
  const message = String((err && (err.message || err.errMsg)) || '');
  if (statusCode === 404) return true;
  if (/RESOURCE_NOT_EXISTS|REFUND_NOT_EXIST|ORDER_NOT_EXIST|NOT_FOUND/i.test(code)) return true;
  return /退款(?:单|记录)?.{0,8}不存在|退款记录未找到|order.{0,16}not.{0,8}exist/i.test(message);
}

async function confirmNoRemoteRefund(caseItem, order) {
  if (caseItem.status !== CaseStatus.REFUND_FAILED || !caseItem.outRefundNo) {
    return ok({ remoteRefundAbsent: true });
  }
  try {
    if (paymentProvider.isVirtualPay(order)) {
      const config = virtualPay.configForOrder(order);
      if (!virtualPay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
      await virtualPay.queryRefund({
        outRefundNo: caseItem.outRefundNo,
        order,
        config,
      });
    } else {
      const config = wxpay.configOf();
      if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
      await wxpay.queryRefund({ outRefundNo: caseItem.outRefundNo, config });
    }
  } catch (err) {
    if (isExplicitRefundNotFoundError(err)) return ok({ remoteRefundAbsent: true });
    console.error('[payment] cancel after-sales refund preflight failed', {
      caseId: caseItem._id,
      outRefundNo: caseItem.outRefundNo,
      statusCode: err && err.statusCode,
      code: err && (err.code || err.errcode),
      message: err && (err.message || err.errMsg),
    });
    return fail({
      code: ERRORS.PAYMENT_NOT_READY.code,
      message: '暂时无法确认退款记录，请稍后重试',
    });
  }
  return fail({
    code: ERRORS.REFUND_NOT_ELIGIBLE.code,
    message: '支付渠道已存在退款记录，请刷新订单退款进度',
  });
}

async function cancelAfterSales(context, event) {
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem || caseItem.userId !== context.OPENID) return fail(ERRORS.CASE_NOT_FOUND);
  if (caseItem.status === CaseStatus.CANCELLED) {
    return ok({ case: afterSales.caseViewOf(caseItem), idempotent: true });
  }
  if (!afterSales.USER_CANCELLABLE_CASE_STATUSES.has(caseItem.status)) {
    return fail({
      code: ERRORS.REFUND_NOT_ELIGIBLE.code,
      message: caseItem.status === CaseStatus.PROCESSING
        ? '退款已发起，当前不能取消售后'
        : '当前售后状态不能取消',
    });
  }
  const order = await findOrderById(db, caseItem.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.refundStatus === RefundStatus.REFUNDED
    || order.refundStatus === RefundStatus.PROCESSING
    || order.grantStatus === GrantStatus.REVERTED) {
    return fail({
      code: ERRORS.REFUND_NOT_ELIGIBLE.code,
      message: '退款已处理或正在处理，当前不能取消售后',
    });
  }
  const preflight = await confirmNoRemoteRefund(caseItem, order);
  if (!preflight.success) return preflight;
  return afterSales.cancelCaseForUser(db, context.OPENID, caseItem._id, {
    expectedStatus: caseItem.status,
  });
}

async function approveRefund(context, event, operatorOverride = '') {
  if (!operatorOverride) {
    const denied = adminRequired(context);
    if (denied) return denied;
  }
  const operator = operatorOverride || context.OPENID;
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  if (![CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW, CaseStatus.REFUND_FAILED].includes(caseItem.status)) {
    return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '当前售后状态不能同意退款' });
  }
  const order = await findOrderById(db, caseItem.orderId);
  if (!order || order.status !== OrderStatus.PAID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.refundStatus === RefundStatus.REFUNDED || order.grantStatus === GrantStatus.REVERTED) {
    return fail(ERRORS.AFTER_SALES_EXISTS);
  }
  const outRefundNo = caseItem.outRefundNo || afterSales.outRefundNoOf(order);

  if (paymentProvider.isVirtualPay(order)) {
    const config = virtualPay.configForOrder(order);
    if (!virtualPay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
    let current;
    try {
      current = await virtualPay.queryPaymentOrder({ order, config });
    } catch (err) {
      return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '退款前查单失败，请稍后重试' });
    }
    if (virtualPay.isAppleOrder(current)) {
      return fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: 'iOS 订单需用户通过 App Store 发起退款，不能由服务端直接退款',
      });
    }
    if (!virtualPay.isPaidResult(current)) {
      return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '订单当前不是可退款状态' });
    }
    const marked = await afterSales.markRefundProcessing(db, caseItem, outRefundNo);
    if (!marked) {
      return fail({
        code: ERRORS.REFUND_NOT_ELIGIBLE.code,
        message: '售后状态已更新，请刷新后重试',
      });
    }
    try {
      const created = await virtualPay.createRefund({
        order,
        outRefundNo,
        reason: caseItem.decisionNote || caseItem.description || '会员提醒名额退款',
        queryResult: current,
        config,
      });
      let result = created;
      try {
        result = await virtualPay.queryRefund({ outRefundNo, order, config });
      } catch (queryErr) {
        // 退款任务已成功创建；查询短暂失败只能保持处理中，不能再次发起或误判失败。
        console.error('[payment] virtual refund query after create failed', {
          caseId: caseItem._id,
          message: queryErr.message,
        });
      }
      const applied = await applyRefundResult(
        { ...caseItem, outRefundNo, amountFen: order.amountFen },
        virtualRefundResultOf(caseItem, order, result),
        'refund_create'
      );
      if (!applied.success) return applied;
      await afterSales.logAdminAction(db, operator, 'APPROVE_REFUND', caseItem, {
        outRefundNo,
        paymentProvider: paymentProvider.PaymentProvider.VIRTUAL_PAY,
        resultStatus: virtualPay.statusOf(result),
      });
      return applied;
    } catch (err) {
      const failure = refundFailureOf(err, '虚拟支付退款请求失败');
      await afterSales.updateCase(db, caseItem._id, {
        status: CaseStatus.REFUND_FAILED,
        refundStatus: RefundStatus.FAILED,
        failureReason: failure.failureReason,
        failureCode: failure.failureCode,
        fundingBlocked: failure.fundingBlocked,
        fundingBlockedAt: failure.fundingBlocked ? new Date() : null,
        outRefundNo,
      });
      await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
        data: { refundStatus: RefundStatus.FAILED, updatedAt: new Date() },
      });
      await afterSales.logAdminAction(db, operator, 'REFUND_ATTEMPT_FAILED', caseItem, {
        outRefundNo,
        error: String(err.message || '').slice(0, 300),
        errorCode: String(err.code || '').slice(0, 100),
        statusCode: err.statusCode || 0,
      });
      return fail({
        code: ERRORS.PAYMENT_NOT_READY.code,
        message: failure.message,
      });
    }
  }

  const config = wxpay.configOf();
  if (!wxpay.hasRefundConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  const marked = await afterSales.markRefundProcessing(db, caseItem, outRefundNo);
  if (!marked) {
    return fail({
      code: ERRORS.REFUND_NOT_ELIGIBLE.code,
      message: '售后状态已更新，请刷新后重试',
    });
  }
  try {
    const result = await wxpay.createRefund({
      order,
      outRefundNo,
      reason: caseItem.decisionNote || caseItem.description || '会员提醒名额退款',
      config,
    });
    const applied = await applyRefundResult(
      { ...caseItem, outRefundNo, amountFen: order.amountFen },
      result,
      'refund_create'
    );
    if (!applied.success) return applied;
    await afterSales.logAdminAction(db, operator, 'APPROVE_REFUND', caseItem, {
      outRefundNo,
      resultStatus: result.status || result.refund_status || '',
    });
    return applied;
  } catch (err) {
    const failure = refundFailureOf(err);
    await afterSales.updateCase(db, caseItem._id, {
      status: CaseStatus.REFUND_FAILED,
      refundStatus: RefundStatus.FAILED,
      failureReason: failure.failureReason,
      failureCode: failure.failureCode,
      fundingBlocked: failure.fundingBlocked,
      fundingBlockedAt: failure.fundingBlocked ? new Date() : null,
      outRefundNo,
    });
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: { refundStatus: RefundStatus.FAILED, updatedAt: new Date() },
    });
    await afterSales.logAdminAction(db, operator, 'REFUND_ATTEMPT_FAILED', caseItem, {
      outRefundNo,
      error: String(err.message || '').slice(0, 300),
      errorCode: String(err.code || '').slice(0, 100),
      statusCode: err.statusCode || 0,
    });
    return fail({
      code: ERRORS.PAYMENT_NOT_READY.code,
      message: failure.message,
    });
  }
}

async function adminList(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const result = await afterSales.listCasesForAdmin(db, {
    status: event.status || '',
    keyword: event.keyword || '',
    page: event.page,
    pageSize: event.pageSize,
  });
  if (result.success && event.keyword && result.keywordType) {
    await afterSales.logAdminAction(db, context.OPENID, 'SEARCH_ADMIN_AFTER_SALES', null, {
      keywordType: result.keywordType,
      status: event.status || '',
    });
  }
  return result;
}

async function adminOrderList(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const result = await adminOrders.listOrdersForAdmin(db, event);
  if (result.success && event.keyword && result.keywordType) {
    await afterSales.logAdminAction(db, context.OPENID, 'SEARCH_ADMIN_ORDERS', null, {
      keywordType: result.keywordType,
      status: event.status || '',
    });
  }
  return result;
}

async function adminOrderStats(context) {
  const denied = adminRequired(context);
  if (denied) return denied;
  return adminOrders.dailyStatsForAdmin(db);
}

async function adminReminderQualityStats(context) {
  const denied = adminRequired(context);
  if (denied) return denied;
  return adminReminderQuality.statsForAdmin(db);
}

async function refreshReminderQualitySnapshot(nowTs) {
  try {
    const result = await adminReminderQuality.refreshSnapshot(db, nowTs);
    return {
      refreshed: result.refreshed === true,
      windowKey: result.windowKey,
    };
  } catch (err) {
    console.error('[payment] reminder quality snapshot failed', {
      name: err.name,
      message: err.errMsg || err.message,
    });
    return {
      refreshed: false,
      error: 'QUALITY_SNAPSHOT_FAILED',
    };
  }
}

async function adminOrderDetail(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const result = await adminOrders.getOrderForAdmin(db, event.orderId);
  if (!result.success) return result;
  await afterSales.logAdminAction(db, context.OPENID, 'VIEW_ADMIN_ORDER_DETAIL', {
    _id: '',
    orderId: result.order.orderId,
  }, {
    hasTransactionId: !!result.order.transactionId,
  });
  return result;
}

async function adminDetail(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  await afterSales.logAdminAction(db, context.OPENID, 'VIEW_CASE_DETAIL', caseItem, {});
  return ok(await adminCaseBundle(caseItem));
}

async function adminReject(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const decisionNote = String(event.decisionNote || '').trim();
  if (!decisionNote) return fail({ code: ERRORS.BAD_PARAM.code, message: '请填写驳回原因' });
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  if (![CaseStatus.AUTO_CHECKING, CaseStatus.UNDER_REVIEW].includes(caseItem.status)) {
    return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '当前售后状态不能驳回' });
  }
  await afterSales.updateCase(db, caseItem._id, {
    status: CaseStatus.REJECTED,
    refundStatus: RefundStatus.REJECTED,
    decisionNote,
    reviewerOpenId: context.OPENID,
    reviewedAt: new Date(),
  });
  // 系统自查单不是用户申请的售后：驳回只关工单，不能把订单写成「退款未通过」，
  // 否则用户打开自己的订单会看到一条他从没申请过的退款失败记录。
  // 判据同时兼容本次改造前已建出的历史系统单（只有 systemGenerated，没有 reviewOnly）。
  const evidenceOfCase = caseItem.evidence || {};
  if (evidenceOfCase.reviewOnly !== true && evidenceOfCase.systemGenerated !== true) {
    await db.collection(COLLECTIONS.ORDERS).doc(caseItem.orderId).update({
      data: { refundStatus: RefundStatus.REJECTED, updatedAt: new Date() },
    });
  }
  await afterSales.logAdminAction(db, context.OPENID, 'REJECT_REFUND', caseItem, { decisionNote });
  const fresh = await afterSales.getCaseById(db, caseItem._id);
  return ok({ case: afterSales.caseViewOf(fresh) });
}

async function adminSyncPayment(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  const order = await findOrderById(db, caseItem.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  const result = await syncOrder(order);
  await afterSales.logAdminAction(db, context.OPENID, 'SYNC_PAYMENT', caseItem, {
    success: result.success === true,
    entitlementStatus: result.entitlementStatus || '',
  });
  return result;
}

async function adminRetryGrant(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  const order = await findOrderById(db, caseItem.orderId);
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status !== OrderStatus.PAID || order.grantStatus !== GrantStatus.FAILED) {
    return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '当前订单不需要补发权益' });
  }
  const result = await syncOrder(order);
  await afterSales.logAdminAction(db, context.OPENID, 'RETRY_GRANT', caseItem, {
    success: result.success === true,
    entitlementStatus: result.entitlementStatus || '',
  });
  return result;
}

async function adminSyncRefund(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  const caseItem = await afterSales.getCaseById(db, event.caseId);
  if (!caseItem) return fail(ERRORS.CASE_NOT_FOUND);
  const result = await syncRefundCase(caseItem);
  await afterSales.logAdminAction(db, context.OPENID, 'SYNC_REFUND', caseItem, {
    success: result.success === true,
    refundStatus: result.refundStatus || '',
  });
  return result;
}

/* ============================== 定时补偿 ============================== */

function isTimerEvent(event = {}) {
  const type = String(event.Type || event.type || '').toLowerCase();
  return type === 'timer';
}

function reconcileDocDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function isMissingCollectionError(err) {
  const message = String((err && (err.errMsg || err.message)) || err || '');
  return /-502005|database collection not exists|Db or Table not exist/i.test(message);
}

async function ensureReconcileStateCollection() {
  if (typeof db.createCollection !== 'function') {
    console.error('[payment] createCollection API unavailable; reconcile state is optional', {
      collection: COLLECTIONS.PAYMENT_RECONCILE_STATE,
    });
    return false;
  }
  try {
    await db.createCollection(COLLECTIONS.PAYMENT_RECONCILE_STATE);
    return true;
  } catch (err) {
    const message = String((err && (err.errMsg || err.message)) || err || '');
    if (/already exists|collection exists|ResourceExists/i.test(message)) return true;
    console.error('[payment] ensure reconcile state collection failed', { message });
    return false;
  }
}

async function readReconcileState(queue) {
  const res = await db.collection(COLLECTIONS.PAYMENT_RECONCILE_STATE)
    .where({ _id: queue })
    .limit(1)
    .get();
  const state = reconcileDocDataOf(res);
  return {
    cursor: state && state.cursor ? String(state.cursor) : null,
    round: Math.max(0, Number(state && state.round) || 0),
  };
}

async function reconcileStateOf(queue) {
  try {
    return await readReconcileState(queue);
  } catch (err) {
    if (isMissingCollectionError(err)) {
      await ensureReconcileStateCollection();
      try {
        return await readReconcileState(queue);
      } catch (retryErr) {
        err = retryErr;
      }
    }
    console.error('[payment] reconcile state unavailable; continuing without cursor', {
      collection: COLLECTIONS.PAYMENT_RECONCILE_STATE,
      queue,
      message: err && (err.errMsg || err.message),
    });
    return { cursor: null, round: 0, storageAvailable: false };
  }
}

async function saveReconcileState(queue, state, details = {}) {
  const nowTs = new Date();
  const data = {
    queue,
    cursor: state.cursor || null,
    round: Math.max(0, Number(state.round) || 0),
    lastProcessedId: details.lastProcessedId || '',
    lastRunAt: nowTs,
    updatedAt: nowTs,
  };
  const writeState = () => db.collection(COLLECTIONS.PAYMENT_RECONCILE_STATE)
    .doc(queue)
    .set({ data });
  try {
    await writeState();
  } catch (err) {
    if (isMissingCollectionError(err)) {
      await ensureReconcileStateCollection();
      try {
        await writeState();
        return true;
      } catch (retryErr) {
        err = retryErr;
      }
    }
    console.error('[payment] reconcile cursor not persisted; processing continues', {
      collection: COLLECTIONS.PAYMENT_RECONCILE_STATE,
      queue,
      message: err && (err.errMsg || err.message),
    });
    return false;
  }
  return true;
}

async function runReconcileQueue({
  queue,
  where,
  handle,
  deadline,
  queueBudgetMs,
  batchSize,
  now,
}) {
  const summary = { scanned: 0, updated: 0, errors: 0 };
  let state = await reconcileStateOf(queue);
  const baseWhere = { ...(where || {}) };
  let page = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const scopedWhere = state.cursor
      ? { ...baseWhere, _id: db.command.gt(state.cursor) }
      : baseWhere;
    const res = await db.collection(queue === 'failedGrants' || queue === 'pendingPayments'
      ? COLLECTIONS.ORDERS
      : COLLECTIONS.AFTER_SALES_CASES)
      .where(scopedWhere)
      .orderBy('_id', 'asc')
      .limit(batchSize + 1)
      .get();
    page = res.data || [];
    if (page.length || !state.cursor) break;
    // 游标之后已无记录：本轮回到队首，下一轮从最早积压开始。
    state = { ...state, cursor: null };
  }

  const rows = page || [];
  const candidates = rows.slice(0, batchSize);
  const moreFetched = rows.length > batchSize;
  const queueDeadline = Math.min(deadline, now() + queueBudgetMs);
  let processed = 0;
  let lastProcessedId = '';

  for (const item of candidates) {
    if (now() >= queueDeadline) break;
    processed += 1;
    lastProcessedId = item._id;
    summary.scanned += 1;
    try {
      const result = await handle(item);
      if (!result || result.success !== false) {
        if (result && result.updated === true) summary.updated += 1;
      } else {
        summary.errors += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error('[payment] reconcile queue item failed', {
        queue,
        itemId: item._id,
        message: err.message,
      });
    }
  }

  const fullyScanned = processed === candidates.length && !moreFetched;
  state = {
    cursor: fullyScanned ? null : (lastProcessedId || state.cursor),
    round: state.round + (fullyScanned ? 1 : 0),
  };
  const cursorSaved = await saveReconcileState(queue, state, { lastProcessedId });
  return {
    ...summary,
    cursorSaved,
    remainingInPage: Math.max(0, candidates.length - processed) + (moreFetched ? 1 : 0),
  };
}

/**
 * 空转短路：四队列都为空时，只做三次 limit(1) 探测，不读写游标。
 */
async function hasReconcileWork() {
  const [pending, failedGrant, activeCase] = await Promise.all([
    db.collection(COLLECTIONS.ORDERS)
      .where({ status: OrderStatus.PENDING })
      .limit(1)
      .get()
      .catch(() => null),
    db.collection(COLLECTIONS.ORDERS)
      .where({ status: OrderStatus.PAID, grantStatus: GrantStatus.FAILED })
      .limit(1)
      .get()
      .catch(() => null),
    db.collection(COLLECTIONS.AFTER_SALES_CASES)
      .where({
        status: db.command.in([
          CaseStatus.PROCESSING,
          CaseStatus.REFUND_FAILED,
          CaseStatus.AUTO_CHECKING,
        ]),
      })
      .limit(1)
      .get()
      .catch(() => null),
  ]);
  /* 探测失败时不能误判为空，否则会跳过一个可能仍有积压的队列。 */
  if (!pending || !failedGrant || !activeCase) return true;
  return (pending.data || []).length > 0
    || (failedGrant.data || []).length > 0
    || (activeCase.data || []).length > 0;
}

async function reconcileOnce(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const quality = await refreshReminderQualitySnapshot(new Date(now()));
  const config = wxpay.configOf();
  const legacyReady = wxpay.hasApiConfig(config);
  const virtualReady = virtualPay.hasApiConfig(virtualPay.configOf());
  if (!legacyReady && !virtualReady) {
    return ok({ skipped: true, reason: 'PAYMENT_NOT_READY', quality });
  }
  const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || RECONCILE_BATCH_SIZE));
  const totalBudgetMs = Math.max(1, Number(options.totalBudgetMs) || RECONCILE_TOTAL_BUDGET_MS);
  const queueBudgetMs = Math.max(1, Number(options.queueBudgetMs) || RECONCILE_QUEUE_BUDGET_MS);
  const deadline = now() + totalBudgetMs;
  if (options.skipWhenIdle !== false && !(await hasReconcileWork())) {
    return ok({
      skipped: true,
      reason: 'NO_RECONCILE_WORK',
      queues: {},
      errors: 0,
      quality,
    });
  }
  const summary = {
    paymentScanned: 0,
    paymentUpdated: 0,
    refundScanned: 0,
    refundUpdated: 0,
    errors: 0,
    queues: {},
  };
  const addQueueSummary = (name, result, kind) => {
    summary.queues[name] = result;
    summary.errors += result.errors;
    if (kind === 'payment') {
      summary.paymentScanned += result.scanned;
      summary.paymentUpdated += result.updated;
    } else {
      summary.refundScanned += result.scanned;
      summary.refundUpdated += result.updated;
    }
  };

  const runQueueIsolated = async (name, kind, runner) => {
    if (now() >= deadline) return;
    try {
      const result = await runner();
      addQueueSummary(name, result, kind);
    } catch (err) {
      summary.errors += 1;
      summary.queues[name] = {
        scanned: 0,
        updated: 0,
        errors: 1,
        error: String((err && (err.errMsg || err.message)) || err || 'unknown error'),
      };
      console.error('[payment] reconcile queue skipped after unexpected failure', {
        queue: name,
        message: err && (err.errMsg || err.message),
      });
    }
  };

  await runQueueIsolated('failedGrants', 'payment', () => runReconcileQueue({
    queue: 'failedGrants',
    where: { status: OrderStatus.PAID, grantStatus: GrantStatus.FAILED },
    deadline,
    queueBudgetMs,
    batchSize,
    now,
    handle: async order => {
      const synced = await syncOrder(order, config);
      return { ...synced, updated: !!(synced.success && synced.entitlementStatus === 'PAID_GRANTED') };
    },
  }));

  await runQueueIsolated('pendingPayments', 'payment', () => runReconcileQueue({
    queue: 'pendingPayments',
    where: { status: OrderStatus.PENDING },
    deadline,
    queueBudgetMs,
    batchSize,
    now,
    handle: async order => {
      const before = order.status;
      const synced = await syncOrder(order, config);
      return { ...synced, updated: !!(synced.success && synced.status !== before) };
    },
  }));

  await runQueueIsolated('refundProcessing', 'refund', () => runReconcileQueue({
    queue: 'refundProcessing',
    where: { status: db.command.in([CaseStatus.PROCESSING, CaseStatus.REFUND_FAILED]) },
    deadline,
    queueBudgetMs,
    batchSize,
    now,
    handle: async caseItem => {
      const synced = await syncRefundCase(caseItem);
      return {
        ...synced,
        updated: !!(synced.success && synced.refundStatus !== RefundStatus.PROCESSING),
      };
    },
  }));

  await runQueueIsolated('autoChecking', 'refund', () => runReconcileQueue({
    queue: 'autoChecking',
    where: { status: CaseStatus.AUTO_CHECKING },
    deadline,
    queueBudgetMs,
    batchSize,
    now,
    handle: async caseItem => {
      const order = await findOrderById(db, caseItem.orderId);
      if (!order) return { success: false };
      if (caseItem.type === CaseType.RIGHTS_NOT_RECEIVED) {
        const retried = await syncOrder(order, config);
        return {
          ...retried,
          updated: !!(retried.success && retried.entitlementStatus === 'PAID_GRANTED'),
        };
      }
      if (caseItem.type === CaseType.DUPLICATE_CHARGE) {
        const reviewOnly = (caseItem.evidence || {}).reviewOnly === true;
        const target = await afterSales.duplicateChargeTarget(db, order);
        const user = await afterSales.refundEvidenceUser(db, order.userId);
        const eligibility = afterSales.refundEligibilityOf(order, user || {});
        const confirmed = !!target.duplicate
          && target.targetOrderId === order._id
          && !eligibility.usedAfterPurchase;
        if (reviewOnly) {
          // 系统自查单只做人工核验，从不自动退款：用户没有申请过售后，
          // 不能因为系统怀疑就动他的钱和订单退款状态。
          await afterSales.updateCase(db, caseItem._id, {
            status: CaseStatus.UNDER_REVIEW,
            decisionNote: confirmed
              ? '系统发现同商品短时间内两笔已支付订单，转客服核验是否需要退款。'
              : '自动核验未发现可确认的重复支付，转客服核验。',
          });
          return { success: true, updated: true };
        }
        if (!confirmed) {
          await afterSales.updateCase(db, caseItem._id, {
            status: CaseStatus.UNDER_REVIEW,
            decisionNote: '自动核验未能满足未使用条件，转客服审核。',
          });
          return { success: true, updated: true };
        }
        const applied = await approveRefund(
          { OPENID: '' },
          { caseId: caseItem._id },
          'SYSTEM_DUPLICATE_CHARGE'
        );
        return { ...applied, updated: applied.success === true };
      }
      return { success: true, updated: false };
    },
  }));
  return ok({ ...summary, quality });
}

/**
 * 补偿心跳：每轮都写，跳过的轮次和异常的轮次也写。
 * 心跳时间不更新 = 定时器没跑；心跳在更新但 errors > 0 = 跑起来了但一直失败。
 * 这是区分“没跑”和“跑失败”的唯一手段，写失败只打日志，不影响补偿本身。
 */
async function writeReconcileHealth(startedAtMs, result, err) {
  const nowTs = new Date();
  const payload = result && typeof result === 'object' ? result : {};
  const queues = payload.queues && typeof payload.queues === 'object' ? payload.queues : {};
  const errorText = err ? String((err && (err.errMsg || err.message)) || err) : '';
  try {
    await db.collection(COLLECTIONS.PAYMENT_CONFIG).doc(RECONCILE_HEALTH_ID).set({
      data: {
        lastRunAt: nowTs,
        lastDurationMs: Math.max(0, nowTs.getTime() - Number(startedAtMs || nowTs.getTime())),
        skipped: payload.skipped === true,
        reason: String(payload.reason || (errorText ? 'ERROR' : '')),
        errors: Number(payload.errors) || 0,
        queues,
        error: errorText.slice(0, 200),
        updatedAt: nowTs,
      },
    });
  } catch (writeErr) {
    console.error('[payment] reconcile health write failed', {
      message: writeErr && (writeErr.errMsg || writeErr.message),
    });
  }
}

async function reconcile(options = {}) {
  const startedAtMs = Date.now();
  try {
    const result = await reconcileOnce(options);
    await writeReconcileHealth(startedAtMs, result);
    return result;
  } catch (err) {
    await writeReconcileHealth(startedAtMs, null, err);
    throw err;
  }
}

/* ============================== 路由 ============================== */

async function main(event = {}) {
  const context = cloud.getWXContext() || {};
  if (isVirtualMessageEvent(event)) {
    if (!isTrustedVirtualMessageContext(context)) {
      console.warn('[payment] rejected client virtual message event', {
        event: event.Event || event.event || '',
        source: context.SOURCE || '',
      });
      return virtualNotify.cloudFailure('虚拟支付消息只接受平台推送');
    }
    try {
      return await handleVirtualMessage(event);
    } catch (err) {
      console.error('[payment] virtual message push failed', {
        event: event.Event || event.event || '',
        name: err.name,
        message: err.message,
        errcode: err.errcode || 0,
      });
      return virtualNotify.cloudFailure(err.message || '虚拟支付消息处理失败');
    }
  }
  if (httpEventOf(event)) {
    if (context.OPENID) {
      console.warn('[payment] rejected client-shaped callback event', {
        path: requestPathOf(event),
      });
      return callbackFailure('客户端不能调用支付回调入口', 403);
    }
    return handleHttpCallback(event);
  }
  if (isTimerEvent(event)) return reconcile();

  if (!context.OPENID) return fail(ERRORS.UNAUTHORIZED);

  try {
    switch (event.action) {
      case 'create':
        return await createPayment(context, event);
      case 'query':
        return await queryPayment(context, event);
      case 'cancel':
        return await cancelPayment(context, event);
      case 'afterSales.submit':
        return await submitAfterSales(context, event);
      case 'afterSales.cancel':
        return await cancelAfterSales(context, event);
      case 'afterSales.list':
        return await afterSales.listUserCases(db, context.OPENID);
      case 'afterSales.detail':
        return await afterSales.getCaseForUser(db, context.OPENID, event.caseId);
      case 'afterSales.syncRights':
        return await syncRights(context, event);
      case 'afterSales.adminStatus': {
        const isAdmin = afterSales.isAfterSalesAdmin(context.OPENID);
        if (!isAdmin) {
          return ok({
            isAdmin: false,
            migrationCompleted: false,
            pendingCount: 0,
            fundingBlockedCount: 0,
          });
        }
        const [
          migrationCompleted,
          entitlementMigrationReady,
          pendingCount,
          fundingBlockedCount,
          sales,
          enforcement,
          upgradeNotice,
        ] = await Promise.all([
          protectionMigrationCompleted(db).catch(() => false),
          entitlementMigrationCompleted(db).catch(() => false),
          afterSales.countActiveCases(db).catch(() => 0),
          afterSales.countFundingBlockedCases(db).catch(() => 0),
          membershipSales.read(db),
          membershipEnforcement.read(db),
          membershipUpgradeNotice.read(db),
        ]);
        return ok({
          isAdmin: true,
          migrationCompleted,
          entitlementMigrationCompleted: entitlementMigrationReady,
          pendingCount,
          fundingBlockedCount,
          membershipSales: membershipSales.adminView(sales),
          membershipEnforcement: membershipEnforcement.adminView(enforcement),
          membershipUpgradeNotice: membershipUpgradeNotice.adminViewOf(upgradeNotice),
        });
      }
      case 'afterSales.adminSetMembershipSales':
        return await setMembershipSales(context, event);
      case 'afterSales.adminSetMembershipEnforcement':
        return await setMembershipEnforcement(context, event);
      case 'afterSales.adminSetMembershipUpgradeNotice':
        return await setMembershipUpgradeNotice(context, event);
      case 'adminOrders.list':
        return await adminOrderList(context, event);
      case 'adminOrders.stats':
        return await adminOrderStats(context);
      case 'adminReminderQuality.stats':
        return await adminReminderQualityStats(context);
      case 'adminOrders.detail':
        return await adminOrderDetail(context, event);
      case 'afterSales.adminList':
        return await adminList(context, event);
      case 'afterSales.adminDetail':
        return await adminDetail(context, event);
      case 'afterSales.adminApproveRefund':
        return await approveRefund(context, event);
      case 'afterSales.adminReject':
        return await adminReject(context, event);
      case 'afterSales.adminSyncPayment':
        return await adminSyncPayment(context, event);
      case 'afterSales.adminRetryGrant':
        return await adminRetryGrant(context, event);
      case 'afterSales.adminSyncRefund':
        return await adminSyncRefund(context, event);
      case 'afterSales.adminMigrateProtection': {
        const denied = adminRequired(context);
        if (denied) return denied;
        return migrateProtectionBatch(db, {
          cursor: event.cursor || null,
          adminOpenId: context.OPENID,
        });
      }
      case 'afterSales.adminMigrateEntitlementLedger': {
        const denied = adminRequired(context);
        if (denied) return denied;
        return migrateEntitlementLedgerBatch(db, {
          cursor: event.cursor || null,
          adminOpenId: context.OPENID,
          dryRun: event.dryRun === true,
        });
      }
      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error('[payment] failed', {
      action: event.action,
      name: err.name,
      code: err.code,
      errCode: err.errCode,
      statusCode: err.statusCode,
      message: err.errMsg || err.message,
    });
    return fail(ERRORS.SERVER_ERROR);
  }
}

exports.main = event => {
  const action = event && (event.action || event.Event || event.type || event.Type);
  return resource.run(String(action || 'tick'), rawDb, () => main(event));
};

// 仅导出给纯 Node 回归测试，不进入客户端 API 契约。
exports._test = {
  applyRefundResult,
  approveRefund,
  cancelAfterSales,
  isExplicitRefundNotFoundError,
  listUserCases: afterSales.listUserCases,
  queueDuplicateChargeCase,
  reconcile,
  hasReconcileWork,
  runReconcileQueue,
  syncOrder,
  handleHttpCallback,
  handleVirtualMessage,
  iosRefundDecision,
  isTrustedVirtualMessageContext,
};
