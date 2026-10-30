/**
 * 会员与提醒名额支付 / 售后入口。
 *
 * 支付协议：微信支付 API v3 直连，不依赖 cloud.cloudPay 或云开发服务商。
 * 普通调用：wx.cloud.callFunction({
 *   name: 'payment',
 *   data: { action: 'create' | 'query' | 'cancel' | 'afterSales.submit' | ... }
 * })
 *
 * HTTP 回调：
 * - /payment/notify         支付结果
 * - /payment/refund-notify  退款结果
 * 两种回调都必须先使用微信支付公钥验证原始 body，再解密 resource。
 */

const crypto = require('crypto');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const {
  COLLECTIONS, ERRORS, OrderStatus, RefundStatus, GrantStatus, CaseType, CaseStatus, ok, fail,
} = require('./lib/schema');
const {
  amountOf,
  findOrderById,
  findOrderByOutTradeNo,
  findCaseByOutRefundNo,
  fulfillOrder,
  markOrderClosed,
  isOrderExpired,
  isQueryPaidResult,
  isQueryClosedResult,
  paymentViewOf,
  grantStateOf,
  reverseOrderEntitlement,
} = require('./lib/order');
const afterSales = require('./lib/after-sales');
const { migrateProtectionBatch, protectionMigrationCompleted } = require('./lib/migration');
const wxpay = require('./lib/wxpay-v3');

const TIMER_SCAN_LIMIT = 100;

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
  if (path === '/payment/refund-notify' || path === '/refund-notify') return 'refund';
  if (path === '/payment/notify' || path === '/notify') return 'payment';
  return 'unknown';
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
    });
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: {
        refundId: result.refund_id || order.refundId || '',
        refundedAt: nowTs,
        updatedAt: new Date(),
      },
    });
    return ok({ refundStatus: RefundStatus.REFUNDED, caseId: caseItem._id });
  }

  if (['CLOSED', 'ABNORMAL', 'REFUND_FAILED'].includes(refundStatus)) {
    await afterSales.updateCase(db, caseItem._id, {
      status: CaseStatus.REFUND_FAILED,
      refundStatus: RefundStatus.FAILED,
      refundId: result.refund_id || caseItem.refundId || '',
      failureReason: result.failure_reason || result.status || '微信退款未成功',
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
  if (targetOrder.refundStatus && targetOrder.refundStatus !== RefundStatus.NONE) {
    return ok({ skipped: true, reason: 'REFUND_ALREADY_STARTED' });
  }
  const user = await afterSales.refundEvidenceUser(db, targetOrder.userId);
  const eligibility = afterSales.refundEligibilityOf(targetOrder, user || {});
  const created = await afterSales.createCaseRecord(db, targetOrder.userId, {
    orderId: targetOrder._id,
    type: CaseType.DUPLICATE_CHARGE,
    reasonCode: 'SYSTEM_DUPLICATE_CHARGE',
    description: '系统检测到同商品 10 分钟内存在重复支付。',
  }, {
    priority: 'HIGH',
    systemGenerated: true,
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
  }
}

async function paymentResultView(order) {
  const user = await userOf(order);
  return {
    ...paymentViewOf(order),
    memberExpiresAt: user ? user.memberExpiresAt || null : null,
    taskPackCount: user ? Math.max(0, parseInt(user.taskPackCount, 10) || 0) : 0,
  };
}

async function syncOrder(order, config = wxpay.configOf()) {
  if (!order) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.PAID) {
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

async function createPayment(context, event) {
  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);

  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);

  if (order.status === OrderStatus.PENDING && isOrderExpired(order)) {
    const synced = await syncOrder(order, config);
    if (!synced.success) return synced;
    order = await findOrderById(db, order._id);
    if (order.status === OrderStatus.CLOSED) return fail(ERRORS.ORDER_EXPIRED);
  }
  if (order.status === OrderStatus.PAID) {
    if (order.grantStatus === GrantStatus.FAILED) {
      const retried = await syncOrder(order, config);
      if (!retried.success) return retried;
    }
    return ok({ ...(await paymentResultView(await findOrderById(db, order._id) || order)), alreadyPaid: true });
  }
  if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_EXPIRED);

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
    expiresAt: order.expiresAt || null,
  });
}

async function queryPayment(context, event) {
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
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
  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  let order = await findOrderById(db, event.orderId);
  if (!order || order.userId !== context.OPENID) return fail(ERRORS.ORDER_NOT_FOUND);
  if (order.status === OrderStatus.CLOSED) return ok(await paymentResultView(order));
  if (order.status !== OrderStatus.PENDING) return fail(ERRORS.ORDER_NOT_FOUND);

  const synced = await syncOrder(order, config);
  if (!synced.success) return synced;
  order = await findOrderById(db, order._id);
  if (order.status !== OrderStatus.PENDING) return ok(await paymentResultView(order));

  await wxpay.closeOrder({ outTradeNo: order.outTradeNo, config });
  const closed = await markOrderClosed(db, order, 'USER_CANCEL');
  return ok(await paymentResultView(closed));
}

/* ============================== 售后 ============================== */

function adminRequired(context) {
  return afterSales.isAfterSalesAdmin(context.OPENID) ? null : fail(ERRORS.FORBIDDEN);
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

async function syncRefundCase(caseItem) {
  const config = wxpay.configOf();
  if (!wxpay.hasRefundConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);
  if (!caseItem.outRefundNo) return fail({ code: ERRORS.REFUND_NOT_ELIGIBLE.code, message: '退款单尚未发起' });
  const result = await wxpay.queryRefund({ outRefundNo: caseItem.outRefundNo, config });
  return applyRefundResult(caseItem, result, 'refund_query');
}

async function approveRefund(context, event, operatorOverride = '') {
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
  const config = wxpay.configOf();
  if (!wxpay.hasRefundConfig(config)) return fail(ERRORS.PAYMENT_NOT_READY);

  const outRefundNo = caseItem.outRefundNo || afterSales.outRefundNoOf(order);
  await afterSales.markRefundProcessing(db, caseItem, outRefundNo);
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
    await afterSales.updateCase(db, caseItem._id, {
      status: CaseStatus.REFUND_FAILED,
      refundStatus: RefundStatus.FAILED,
      failureReason: String(err.message || '退款请求失败').slice(0, 500),
      outRefundNo,
    });
    await db.collection(COLLECTIONS.ORDERS).doc(order._id).update({
      data: { refundStatus: RefundStatus.FAILED, updatedAt: new Date() },
    });
    await afterSales.logAdminAction(db, operator, 'REFUND_ATTEMPT_FAILED', caseItem, {
      outRefundNo,
      error: String(err.message || '').slice(0, 300),
      statusCode: err.statusCode || 0,
    });
    return fail({ code: ERRORS.PAYMENT_NOT_READY.code, message: '退款发起失败，可稍后重试' });
  }
}

async function adminList(context, event) {
  const denied = adminRequired(context);
  if (denied) return denied;
  return afterSales.listCasesForAdmin(db, event.status || '');
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
  await db.collection(COLLECTIONS.ORDERS).doc(caseItem.orderId).update({
    data: { refundStatus: RefundStatus.REJECTED, updatedAt: new Date() },
  });
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

async function reconcile() {
  const config = wxpay.configOf();
  if (!wxpay.hasApiConfig(config)) return ok({ skipped: true, reason: 'PAYMENT_NOT_READY' });
  const summary = { paymentScanned: 0, paymentUpdated: 0, refundScanned: 0, refundUpdated: 0, errors: 0 };

  const pendingRes = await db.collection(COLLECTIONS.ORDERS)
    .where({ status: OrderStatus.PENDING })
    .limit(TIMER_SCAN_LIMIT)
    .get();
  for (const order of (pendingRes.data || [])) {
    summary.paymentScanned += 1;
    try {
      const before = order.status;
      const result = await syncOrder(order, config);
      if (result.success && result.status !== before) summary.paymentUpdated += 1;
      if (!result.success) summary.errors += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('[payment] reconcile order failed', { orderId: order._id, message: err.message });
    }
  }

  const failedGrantRes = await db.collection(COLLECTIONS.ORDERS)
    .where({ status: OrderStatus.PAID, grantStatus: GrantStatus.FAILED })
    .limit(TIMER_SCAN_LIMIT)
    .get();
  for (const order of (failedGrantRes.data || [])) {
    summary.paymentScanned += 1;
    try {
      const result = await syncOrder(order, config);
      if (result.success && result.entitlementStatus === 'PAID_GRANTED') summary.paymentUpdated += 1;
      if (!result.success) summary.errors += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('[payment] retry grant failed', { orderId: order._id, message: err.message });
    }
  }

  const autoCheckingRes = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ status: CaseStatus.AUTO_CHECKING })
    .limit(TIMER_SCAN_LIMIT)
    .get();
  for (const caseItem of (autoCheckingRes.data || [])) {
    summary.refundScanned += 1;
    try {
      const order = await findOrderById(db, caseItem.orderId);
      if (!order) {
        summary.errors += 1;
        continue;
      }
      if (caseItem.type === CaseType.RIGHTS_NOT_RECEIVED) {
        const retried = await syncOrder(order, config);
        if (!retried.success) summary.errors += 1;
        else if (retried.entitlementStatus === 'PAID_GRANTED') summary.refundUpdated += 1;
        continue;
      }
      if (caseItem.type === CaseType.DUPLICATE_CHARGE) {
        const target = await afterSales.duplicateChargeTarget(db, order);
        const user = await afterSales.refundEvidenceUser(db, order.userId);
        const eligibility = afterSales.refundEligibilityOf(order, user || {});
        if (!target.duplicate || target.targetOrderId !== order._id || eligibility.usedAfterPurchase) {
          await afterSales.updateCase(db, caseItem._id, {
            status: CaseStatus.UNDER_REVIEW,
            decisionNote: '自动核验未能满足未使用条件，转客服审核。',
          });
          continue;
        }
        const applied = await approveRefund(
          { OPENID: '' },
          { caseId: caseItem._id },
          'SYSTEM_DUPLICATE_CHARGE'
        );
        if (applied.success) summary.refundUpdated += 1;
        else summary.errors += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error('[payment] auto checking case failed', { caseId: caseItem._id, message: err.message });
    }
  }

  const processingRes = await db.collection(COLLECTIONS.AFTER_SALES_CASES)
    .where({ status: db.command.in([CaseStatus.PROCESSING, CaseStatus.REFUND_FAILED]) })
    .limit(TIMER_SCAN_LIMIT)
    .get();
  for (const caseItem of (processingRes.data || [])) {
    summary.refundScanned += 1;
    try {
      const before = caseItem.status;
      const result = await syncRefundCase(caseItem);
      if (result.success && result.refundStatus !== RefundStatus.PROCESSING) summary.refundUpdated += 1;
      if (!result.success) summary.errors += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('[payment] reconcile refund failed', { caseId: caseItem._id, message: err.message });
    }
  }
  return ok(summary);
}

/* ============================== 路由 ============================== */

exports.main = async (event = {}) => {
  if (httpEventOf(event)) return handleHttpCallback(event);
  if (isTimerEvent(event)) return reconcile();

  const context = cloud.getWXContext();
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
      case 'afterSales.list':
        return await afterSales.listUserCases(db, context.OPENID);
      case 'afterSales.detail':
        return await afterSales.getCaseForUser(db, context.OPENID, event.caseId);
      case 'afterSales.syncRights':
        return await syncRights(context, event);
      case 'afterSales.adminStatus': {
        const isAdmin = afterSales.isAfterSalesAdmin(context.OPENID);
        if (!isAdmin) {
          return ok({ isAdmin: false, migrationCompleted: false, pendingCount: 0 });
        }
        const [migrationCompleted, pendingCount] = await Promise.all([
          protectionMigrationCompleted(db),
          afterSales.countActiveCases(db).catch(() => 0),
        ]);
        return ok({
          isAdmin: true,
          migrationCompleted,
          pendingCount,
        });
      }
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
      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error('[payment] failed', {
      action: event.action,
      name: err.name,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
    });
    return fail({
      code: ERRORS.PAYMENT_NOT_READY.code,
      message: err.code || '支付通道准备中，请稍后再试',
    });
  }
};

// 仅导出给纯 Node 回归测试，不进入客户端 API 契约。
exports._test = {
  applyRefundResult,
  approveRefund,
  reconcile,
  syncOrder,
  handleHttpCallback,
};
