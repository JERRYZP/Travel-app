/**
 * 小程序虚拟支付：渠道兼容、签名、消息推送、幂等发放与退款。
 *
 * 运行：node test/payment-virtual.test.js
 */
const https = require('https');
const { EventEmitter } = require('events');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, OrderStatus, RefundStatus, GrantStatus, CaseStatus, CaseType,
} = require('../cloudfunctions/payment/lib/schema');
const paymentProvider = require('../cloudfunctions/payment/lib/payment-provider');
const virtualPay = require('../cloudfunctions/payment/lib/virtual-pay');
const virtualNotify = require('../cloudfunctions/payment/lib/virtual-notify');
const wechatAuth = require('../cloudfunctions/payment/lib/wechat-auth');
const wxpay = require('../cloudfunctions/payment/lib/wxpay-v3');
const afterSales = require('../cloudfunctions/payment/lib/after-sales');

let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

function fakeHttpsSequence(sequence) {
  const original = https.request;
  const calls = [];
  let index = 0;
  https.request = (options, callback) => {
    const req = new EventEmitter();
    let body = '';
    req.write = chunk => { body += String(chunk || ''); };
    req.destroy = err => req.emit('error', err || new Error('destroyed'));
    req.end = () => {
      const current = sequence[index] || sequence[sequence.length - 1];
      index += 1;
      calls.push({ path: options.path, body });
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = current.statusCode || 200;
        callback(res);
        res.emit('data', Buffer.from(JSON.stringify(current.body || {}), 'utf8'));
        res.emit('end');
      });
    };
    return req;
  };
  return {
    calls,
    restore() { https.request = original; },
  };
}

function loadPayment(db, openId = '', source = '') {
  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    if (request === 'wx-server-sdk' && parent && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() {
          return {
            OPENID: openId,
            SOURCE: source || (openId ? 'wx_client' : ''),
          };
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/payment/index.js')];
    return require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }
}

async function testProviderAndSignatures() {
  console.log('=== 1. 渠道选择与签名 ===');
  eq(paymentProvider.configuredProvider({}), 'WECHAT_PAY_V3', '缺省继续使用 API v3');
  eq(paymentProvider.configuredProvider({ PAYMENT_PROVIDER: 'VIRTUAL_PAY' }), 'VIRTUAL_PAY',
    '显式开关才启用虚拟支付');
  eq(paymentProvider.configuredProvider({
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    PAYMENT_VIRTUAL_PAY_TEST_OPENIDS: 'openid-a, openid-b',
  }, 'openid-a'), 'VIRTUAL_PAY', '测试白名单用户启用虚拟支付');
  eq(paymentProvider.configuredProvider({
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    PAYMENT_VIRTUAL_PAY_TEST_OPENIDS: 'openid-a, openid-b',
  }, 'openid-c'), 'WECHAT_PAY_V3', '非白名单用户继续使用 API v3');
  eq(paymentProvider.configuredProvider({
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    PAYMENT_VIRTUAL_PAY_TEST_OPENIDS: 'openid-a',
  }, ''), 'WECHAT_PAY_V3', '缺少用户身份时不会误切虚拟支付');
  eq(paymentProvider.providerOf({ paymentProvider: 'WECHAT_PAY_V3' }, { PAYMENT_PROVIDER: 'VIRTUAL_PAY' }),
    'WECHAT_PAY_V3', '历史订单固化渠道优先于当前环境');
  eq(paymentProvider.providerOf({ transactionId: '4200001' }, { PAYMENT_PROVIDER: 'VIRTUAL_PAY' }),
    'WECHAT_PAY_V3', '带交易号的历史订单继续走 API v3');
  eq(paymentProvider.providerOf({ virtualEnv: 1 }, { PAYMENT_PROVIDER: 'WECHAT_PAY_V3' }),
    'VIRTUAL_PAY', '已固化虚拟环境的订单不会因开关切回而误走 API v3');
  eq(paymentProvider.providerOf({}, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    PAYMENT_VIRTUAL_PAY_TEST_OPENIDS: 'openid-a',
  }, 'openid-b', true), 'WECHAT_PAY_V3', '未固化订单按当前用户白名单选择渠道');
  eq(paymentProvider.providerOf({}, { PAYMENT_PROVIDER: 'VIRTUAL_PAY' }, 'openid-a'),
    'WECHAT_PAY_V3', '未声明虚拟支付能力的旧客户端继续 API v3');
  eq(paymentProvider.providerOf({}, { PAYMENT_PROVIDER: 'VIRTUAL_PAY' }, 'openid-a', true),
    'VIRTUAL_PAY', '声明虚拟支付能力的新客户端可走虚拟支付');

  const config = virtualPay.configOf({
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });
  eq(virtualPay.hasPaymentConfig(config), true, '完整虚拟支付配置判定为可用');
  eq(virtualPay.hasApiConfig({ ...config, memberProductId: '', taskPackProductId: '' }), true,
    '查单退款只要求支付凭据，不依赖商品 ID');
  eq(virtualPay.hasPaymentConfig({ ...config, memberProductId: '', taskPackProductId: '' }), false,
    '完整售卖配置仍要求两个商品 ID');
  const envConfig = {
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: 'prod-key',
    WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY: 'sandbox-key',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  };
  const sandboxConfig = virtualPay.configForOrder({ virtualEnv: 1 }, envConfig);
  eq(sandboxConfig.env, 1, '历史沙箱订单按订单快照选择环境');
  eq(sandboxConfig.appKey, 'sandbox-key', '历史沙箱订单使用沙箱 AppKey');
  const productionConfig = virtualPay.configForOrder({ virtualEnv: 0 }, envConfig);
  eq(productionConfig.env, 0, '历史现网订单按订单快照选择环境');
  eq(productionConfig.appKey, 'prod-key', '历史现网订单使用现网 AppKey');
  const client = virtualPay.createClientPayment({
    order: {
      _id: 'order-virtual-1',
      outTradeNo: 'TVIRT001',
      productType: 'MEMBER',
      amountFen: 300,
    },
    sessionKey: '9hAb/NEYUlkaMBEsmFgzig==',
    config,
  });
  eq(client.mode, 'short_series_goods', '固定价格道具使用 short_series_goods');
  eq(JSON.parse(client.signData).productId, 'member-product', '会员订单映射固定道具 ID');
  eq(JSON.parse(client.signData).goodsPrice, 300, '道具价格由服务端订单决定');
  eq(client.paySig.length, 64, '支付签名是 64 位十六进制串');
  eq(client.signature.length, 64, '用户态签名是 64 位十六进制串');

  const officialBody = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';
  eq(virtualPay.serverPaySigOf('/xpay/query_user_balance', officialBody, '12345'),
    'c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5',
    '服务端支付签名通过微信官方示例向量');
  eq(virtualPay.userSignatureOf(officialBody, '9hAb/NEYUlkaMBEsmFgzig=='),
    '089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7',
    '用户态签名通过微信官方示例向量');
  eq(virtualPay.orderFeeOf({ order_fee: 300, paid_fee: 250 }), 300, '校验道具原价而不是优惠后实付');
  eq(virtualPay.paidAmountOf({ order_fee: 300, paid_fee: 250 }), 250, '保留优惠后实付金额');
}

async function testAccessTokenRefresh() {
  console.log('\n=== 2. access_token 过期自动刷新一次 ===');
  wechatAuth.resetAccessTokenCache();
  const fake = fakeHttpsSequence([
    { body: { access_token: 'old-token', expires_in: 7200 } },
    { body: { errcode: 40001, errmsg: 'invalid credential' } },
    { body: { access_token: 'new-token', expires_in: 7200 } },
    { body: { errcode: 0, order: { order_id: 'TVIRT001', status: 2, order_fee: 300 } } },
  ]);
  const config = {
    appId: 'wx05c160a589b97d76',
    appSecret: 'app-secret',
    offerId: 'offer-test',
    env: 0,
    appKey: '12345',
    memberProductId: 'member-product',
    taskPackProductId: 'pack-product',
  };
  try {
    const result = await virtualPay.queryOrderById('TVIRT001', {
      config,
      openId: 'openid-virtual',
      now: Date.now(),
    });
    eq(result.status, 2, '刷新 token 后查单成功');
    eq(fake.calls.filter(item => item.path.startsWith('/xpay/query_order')).length, 2,
      '无效 token 只触发一次查单重试');
    const tokenBodies = fake.calls
      .filter(item => item.path === '/cgi-bin/stable_token')
      .map(item => JSON.parse(item.body).force_refresh);
    eq(tokenBodies.join(','), 'false,true', '第二次 token 获取显式 force_refresh=true');
  } finally {
    fake.restore();
    wechatAuth.resetAccessTokenCache();
  }
}

async function testExpiredUnpaidVirtualOrderCloses() {
  console.log('\n=== 2a. Apple 未支付订单过期后由补偿关闭 ===');
  const db = createDb();
  const now = Date.now();
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'ov-expired-unpaid',
    userId: 'openid-expired-unpaid',
    outTradeNo: 'TVIRTEXPIREDUNPAID',
    paymentProvider: 'VIRTUAL_PAY',
    virtualEnv: 0,
    packageId: 'member',
    productType: 'MEMBER',
    title: '会员 30 天',
    amountFen: 300,
    memberDays: 30,
    status: OrderStatus.PENDING,
    refundStatus: RefundStatus.NONE,
    grantStatus: GrantStatus.NONE,
    createdAt: new Date(now - 16 * 60 * 1000),
    expiresAt: new Date(now - 60 * 1000),
  }]);

  const previousEnv = { ...process.env };
  const originalQueryPaymentOrder = virtualPay.queryPaymentOrder;
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });
  virtualPay.queryPaymentOrder = async ({ order }) => ({
    order_id: order.outTradeNo,
    order_type: virtualPay.VirtualOrderType.APPLE,
    status: virtualPay.VirtualOrderStatus.CREATED,
    order_fee: 300,
  });
  try {
    const payment = loadPayment(db);
    const summary = await payment._test.reconcile({
      batchSize: 10,
      totalBudgetMs: 1000,
      queueBudgetMs: 500,
      now: Date.now,
    });
    const order = db._dump(COLLECTIONS.ORDERS)[0];
    eq(summary.queues.pendingPayments.updated, 1, '未支付 Apple 订单由待支付补偿收口');
    eq(order.status, OrderStatus.CLOSED, '平台确认未支付且本地过期后关闭订单');
    eq(order.closeReason, 'VIRTUAL_PAY_EXPIRED_UNPAID', '关闭原因标记虚拟支付过期未支付');
    eq(order.virtualOrderStatus, virtualPay.VirtualOrderStatus.CREATED,
      '关闭前保留平台未支付状态证据');
  } finally {
    virtualPay.queryPaymentOrder = originalQueryPaymentOrder;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

function testNotifyParsing() {
  console.log('\n=== 3. 消息推送解析与响应 ===');
  const xml = '<xml><Event>xpay_goods_deliver_notify</Event><OpenId>openid-1</OpenId>' +
    '<OutTradeNo>TVIRT001</OutTradeNo><Env>0</Env></xml>';
  const parsed = virtualNotify.parseBody(xml);
  const message = virtualNotify.messageOf(parsed);
  eq(message.event, 'xpay_goods_deliver_notify', '解析 XML 道具发货事件');
  eq(message.openId, 'openid-1', '解析用户 OpenID');
  eq(message.outTradeNo, 'TVIRT001', '解析商户订单号');
  eq(virtualNotify.cloudSuccess().ErrCode, 0, '云函数推送成功响应用 ErrCode=0');
  eq(virtualNotify.cloudFailure('retry').ErrCode, 1, '处理失败返回非 0 让微信重试');
}

async function testVirtualMessageIntegration() {
  console.log('\n=== 4. 发货推送查单、幂等发放与 iOS 问询 ===');
  const db = createDb();
  const now = Date.now();
  db._seed(COLLECTIONS.USERS, [
    {
      _id: 'u-virtual-1', openId: 'openid-virtual-1', memberLevel: 'NORMAL',
      memberExpiresAt: null, taskPackCount: 0, lastReminderCreatedAt: null,
    },
    {
      _id: 'u-ios-unused', openId: 'openid-ios-unused', memberLevel: 'MEMBER',
      memberExpiresAt: new Date(now + 30 * 86400000), taskPackCount: 0,
      lastReminderCreatedAt: new Date(now - 2 * 86400000),
    },
    {
      _id: 'u-ios-used', openId: 'openid-ios-used', memberLevel: 'MEMBER',
      memberExpiresAt: new Date(now + 30 * 86400000), taskPackCount: 0,
      lastReminderCreatedAt: new Date(now - 10 * 60000),
    },
  ]);
  db._seed(COLLECTIONS.ORDERS, [
    {
      _id: 'ov-deliver', userId: 'openid-virtual-1', outTradeNo: 'TVIRT001',
      paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0,
      packageId: 'member', productType: 'MEMBER',
      specVersion: 'member-30d-v2', virtualProductId: 'member-product',
      title: '会员 30 天', amountFen: 300, memberDays: 30, memberFloorDays: 0,
      status: OrderStatus.PENDING, refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.NONE, createdAt: new Date(), paidAt: null,
    },
    {
      _id: 'ov-ios-unused', userId: 'openid-ios-unused', outTradeNo: 'TVIRT-IOS-UNUSED',
      paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0,
      packageId: 'member', productType: 'MEMBER',
      title: '会员 30 天', amountFen: 300, memberDays: 30,
      status: OrderStatus.PAID, refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.GRANTED, paidAt: new Date(now - 3600000),
    },
    {
      _id: 'ov-ios-used', userId: 'openid-ios-used', outTradeNo: 'TVIRT-IOS-USED',
      paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0,
      packageId: 'member', productType: 'MEMBER',
      title: '会员 30 天', amountFen: 300, memberDays: 30,
      status: OrderStatus.PAID, refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.GRANTED, paidAt: new Date(now - 3600000),
    },
  ]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });

  const originalQueryPayment = virtualPay.queryPaymentOrder;
  let queriedOrderFee = 300;
  let queriedOrderPatch = {};
  let queryCalls = 0;
  virtualPay.queryPaymentOrder = async ({ order }) => {
    queryCalls += 1;
    return {
      order_id: order.outTradeNo,
      order_fee: queriedOrderFee,
      paid_fee: 300,
      order_type: 0,
      status: 2,
      env_type: 1,
      wx_order_id: 'wx-order-1',
      wxpay_order_id: '4200000001',
      channel_order_id: 'channel-1',
      ...queriedOrderPatch,
    };
  };

  try {
    const payment = loadPayment(db);
    const clientPayment = loadPayment(db, 'openid-virtual-1');
    const forgedMessage = await clientPayment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT001',
      Env: 0,
    });
    eq(forgedMessage.ErrCode, 1, '客户端伪造虚拟支付事件被拒绝');
    eq(queryCalls, 0, '客户端伪造事件不会触发微信查单');
    eq(payment._test.isTrustedVirtualMessageContext({
      OPENID: 'openid-virtual-1', SOURCE: 'wx_paycallback',
    }), true, '平台支付回调即使带 OpenId 也按支付回调来源放行');
    eq(payment._test.isTrustedVirtualMessageContext({
      OPENID: 'openid-virtual-1', SOURCE: 'wx_client',
    }), false, '小程序客户端来源仍不能伪造虚拟支付事件');

    const forgedHttp = await clientPayment.main({
      path: '/payment/virtual-notify',
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Event: 'xpay_goods_deliver_notify',
        OpenId: 'openid-virtual-1',
        OutTradeNo: 'TVIRT001',
        Env: 0,
      }),
    });
    eq(forgedHttp.statusCode, 403, '客户端伪造 HTTP 回调形态被拒绝');
    eq(queryCalls, 0, 'HTTP 形态绕过也不会触发微信查单');

    const wrongUser = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'other-user',
      OutTradeNo: 'TVIRT001',
      Env: 0,
    });
    eq(wrongUser.ErrCode, 1, '用户与订单不一致时拒绝发货');

    queriedOrderFee = 299;
    const wrongAmount = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT001',
      Env: 0,
    });
    eq(wrongAmount.ErrCode, 1, '道具原价不一致时拒绝发放');
    eq(db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-deliver').status,
      OrderStatus.PENDING, '金额校验失败不修改订单');

    queriedOrderFee = 300;
    const delivered = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT001',
      Env: 0,
    });
    eq(delivered.ErrCode, 0, '合法发货推送确认成功');
    let order = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-deliver');
    const userAfterFirst = db._dump(COLLECTIONS.USERS).find(item => item._id === 'u-virtual-1');
    eq(order.status, OrderStatus.PAID, '查单确认后订单置为 PAID');
    eq(order.grantStatus, GrantStatus.GRANTED, '权益发放成功');
    const expiryAfterFirst = new Date(userAfterFirst.memberExpiresAt).getTime();

    const duplicate = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT001',
      Env: 0,
    });
    eq(duplicate.ErrCode, 0, '重复发货推送仍确认成功');
    order = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-deliver');
    const userAfterSecond = db._dump(COLLECTIONS.USERS).find(item => item._id === 'u-virtual-1');
    eq(new Date(userAfterSecond.memberExpiresAt).getTime(), expiryAfterFirst, '重复推送不重复增加会员时长');

    const iosUnused = await payment.main({
      Event: 'xpay_subscribe_ios_refund_query_notify',
      OpenId: 'openid-ios-unused',
      PayOrderId: 'TVIRT-IOS-UNUSED',
      ProvideStatus: '1',
    });
    eq(iosUnused.ErrCode, 0, 'iOS 未使用订单问询正常响应');
    eq(iosUnused.IosRefundQueryResponse.result_code, 0, '24 小时内未使用订单建议退款');
    eq(/尚未新增提醒/.test(iosUnused.IosRefundQueryResponse.evidence), true, '退款凭据说明未使用事实');

    const iosUsed = await payment.main({
      Event: 'xpay_subscribe_ios_refund_query_notify',
      OpenId: 'openid-ios-used',
      PayOrderId: 'TVIRT-IOS-USED',
      ProvideStatus: '1',
    });
    eq(iosUsed.IosRefundQueryResponse.result_code, 1, '支付后已使用权益的订单拒绝退款');
    eq(db._dump(COLLECTIONS.AFTER_SALES_CASES).length, 0, 'Apple 退款问询不会提前创建售后记录');

    const riskyBase = {
      userId: 'openid-virtual-1', paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0,
      packageId: 'member', productType: 'MEMBER', specVersion: 'member-30d-v2',
      title: '会员 30 天', amountFen: 300, memberDays: 30,
      status: OrderStatus.PENDING, refundStatus: RefundStatus.NONE,
      grantStatus: GrantStatus.NONE, createdAt: new Date(), paidAt: null,
    };
    db._seed(COLLECTIONS.ORDERS, [
      { ...riskyBase, _id: 'ov-biz-mismatch', outTradeNo: 'TVIRT-BIZ-MISMATCH', virtualProductId: 'member-product' },
      { ...riskyBase, _id: 'ov-missing-product', outTradeNo: 'TVIRT-MISSING-PRODUCT' },
      { ...riskyBase, _id: 'ov-sku-mismatch', outTradeNo: 'TVIRT-SKU-MISMATCH', virtualProductId: 'pack-product' },
    ]);

    queriedOrderFee = 300;
    queriedOrderPatch = { biz_meta: JSON.stringify({ orderId: 'different-order' }) };
    const mismatchedMeta = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT-BIZ-MISMATCH',
      Env: 0,
    });
    eq(mismatchedMeta.ErrCode, 1, 'biz_meta 与订单不一致时拒绝发放');
    let riskyOrder = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-biz-mismatch');
    eq(riskyOrder.status, OrderStatus.PAID, 'biz_meta 不一致仍记录支付已确认');
    eq(riskyOrder.grantStatus, GrantStatus.FAILED, 'biz_meta 不一致进入发放失败状态');

    queriedOrderPatch = {};
    const missingSnapshot = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT-MISSING-PRODUCT',
      Env: 0,
    });
    eq(missingSnapshot.ErrCode, 1, '缺少虚拟商品快照时拒绝发放');
    riskyOrder = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-missing-product');
    eq(riskyOrder.grantStatus, GrantStatus.FAILED, '缺少商品快照转人工核验');

    const skuMismatch = await payment.main({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-virtual-1',
      OutTradeNo: 'TVIRT-SKU-MISMATCH',
      Env: 0,
    });
    eq(skuMismatch.ErrCode, 1, '保存的虚拟商品快照与配置不一致时拒绝发放');
    const manualCases = db._dump(COLLECTIONS.AFTER_SALES_CASES)
      .filter(item => ['ov-biz-mismatch', 'ov-missing-product', 'ov-sku-mismatch'].includes(item.orderId));
    eq(manualCases.length, 3, '三类高风险发放失败都生成人工售后记录');
  } finally {
    virtualPay.queryPaymentOrder = originalQueryPayment;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

async function testRefundNotification() {
  console.log('\n=== 5. 退款推送查单、权益回收与幂等 ===');
  const db = createDb();
  const now = Date.now();
  const originalQueryRefund = virtualPay.queryRefund;
  virtualPay.queryRefund = async ({ outRefundNo }) => ({
    order_id: outRefundNo,
    order_type: 1,
    status: virtualPay.VirtualOrderStatus.REFUNDED,
    order_fee: 300,
    refund_fee: 300,
    paid_time: Math.floor(now / 1000),
    env_type: 1,
    wx_order_id: 'wx-refund-1',
  });
  db._seed(COLLECTIONS.USERS, [{
    _id: 'u-refund', openId: 'openid-refund', memberLevel: 'MEMBER',
    memberExpiresAt: new Date(now + 30 * 86400000), taskPackCount: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'ov-refund', userId: 'openid-refund', outTradeNo: 'TVIRT-REFUND',
    paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0,
    packageId: 'member', productType: 'MEMBER',
    title: '会员 30 天', amountFen: 300, memberDays: 30,
    status: OrderStatus.PAID, refundStatus: RefundStatus.PROCESSING,
    grantStatus: GrantStatus.GRANTED, paidAt: new Date(now - 3600000),
    entitlementGrant: {
      memberDaysAddedMs: 30 * 86400000,
      taskPackDelta: 0,
      appliedAt: new Date(now - 3600000),
    },
  }]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'case-refund', caseNo: 'ASC-VIRTUAL-REFUND', userId: 'openid-refund',
    orderId: 'ov-refund', outTradeNo: 'TVIRT-REFUND', outRefundNo: 'RFTVIRTUALREFUND',
    title: '会员 30 天', amountFen: 300, type: 'UNUSED_REFUND',
    status: CaseStatus.PROCESSING, refundStatus: RefundStatus.PROCESSING,
    createdAt: new Date(now - 1800000),
  }]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });
  try {
    const payment = loadPayment(db);
    const event = {
      Event: 'xpay_refund_notify',
      OpenId: 'openid-refund',
      MchRefundId: 'RFTVIRTUALREFUND',
      MchOrderId: 'TVIRT-REFUND',
      RefundFee: 300,
      RetCode: 0,
    };
    const refunded = await payment.main(event);
    eq(refunded.ErrCode, 0, '退款推送确认成功');
    let order = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-refund');
    let caseItem = db._dump(COLLECTIONS.AFTER_SALES_CASES).find(item => item._id === 'case-refund');
    eq(order.refundStatus, RefundStatus.REFUNDED, '查询到退款完成后再标记订单已退款');
    eq(order.grantStatus, GrantStatus.REVERTED, '按订单快照回收权益');
    eq(caseItem.status, CaseStatus.REFUNDED, '售后记录标记已退款');

    const duplicate = await payment.main(event);
    eq(duplicate.ErrCode, 0, '重复退款推送仍确认成功');
    order = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-refund');
    eq(order.grantStatus, GrantStatus.REVERTED, '重复退款推送不重复回收权益');
  } finally {
    virtualPay.queryRefund = originalQueryRefund;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

async function testPlatformRefundBackfill() {
  console.log('\n=== 6. 平台退款完成后自动补建售后记录 ===');
  const db = createDb();
  const now = Date.now();
  const originalQueryRefund = virtualPay.queryRefund;
  virtualPay.queryRefund = async ({ outRefundNo }) => ({
    order_id: outRefundNo,
    order_type: 8,
    status: virtualPay.VirtualOrderStatus.REFUNDED,
    order_fee: 300,
    refund_fee: 300,
    paid_time: Math.floor(now / 1000),
    env_type: 1,
    wx_order_id: 'wx-platform-refund-1',
  });
  db._seed(COLLECTIONS.USERS, [{
    _id: 'u-platform-refund', openId: 'openid-platform-refund', memberLevel: 'MEMBER',
    memberExpiresAt: new Date(now + 30 * 86400000), taskPackCount: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'ov-platform-refund', userId: 'openid-platform-refund', outTradeNo: 'TVIRT-PLATFORM-REFUND',
    paymentProvider: 'VIRTUAL_PAY', virtualEnv: 0, channelOrderType: 7,
    packageId: 'member', productType: 'MEMBER',
    title: '会员 30 天', amountFen: 300, memberDays: 30,
    status: OrderStatus.PAID, refundStatus: RefundStatus.REFUNDED,
    grantStatus: GrantStatus.REVERTED, paidAt: new Date(now - 3600000),
    entitlementGrant: {
      memberDaysAddedMs: 30 * 86400000,
      taskPackDelta: 0,
      appliedAt: new Date(now - 3600000),
      revertedAt: new Date(now),
    },
  }]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });
  try {
    const payment = loadPayment(db);
    const event = {
      Event: 'xpay_refund_notify',
      OpenId: 'openid-platform-refund',
      MchRefundId: 'RFPLATFORMREFUND',
      MchOrderId: 'TVIRT-PLATFORM-REFUND',
      RefundFee: 300,
      RetCode: 0,
    };
    const refunded = await payment.main(event);
    eq(refunded.ErrCode, 0, '无售后单的平台退款推送确认成功');
    let cases = db._dump(COLLECTIONS.AFTER_SALES_CASES);
    eq(cases.length, 1, '平台退款完成后自动补建一条售后记录');
    const caseItem = cases[0];
    eq(caseItem.type, CaseType.OTHER, '自动记录沿用兼容的系统售后类型');
    eq(caseItem.reasonCode, 'PLATFORM_REFUND_NOTIFY', '自动记录带平台退款原因码');
    eq(caseItem.systemGenerated, true, '自动记录标记为系统生成');
    eq(caseItem.evidence.systemGenerated, true, '证据快照保留系统生成标记');
    eq(caseItem.outRefundNo, 'RFPLATFORMREFUND', '自动记录保存退款单号');
    eq(caseItem.status, CaseStatus.REFUNDED, '自动记录最终状态为已退款');
    eq(caseItem.refundAmountFen, 300, '自动记录保存退款金额');
    eq(caseItem.evidence.paymentChannel, 'APPLE', '自动记录保存 Apple 支付渠道');
    eq(db._dump(COLLECTIONS.ORDERS)[0].outRefundNo, 'RFPLATFORMREFUND',
      '订单补存平台退款单号');
    eq(caseItem.description, '平台退款结果已确认，系统自动补建售后记录。',
      '自动记录使用可辨识的系统说明');
    eq(afterSales.caseViewOf(caseItem).typeLabel, '平台退款', '售后工作台显示平台退款类型');

    const duplicate = await payment.main(event);
    eq(duplicate.ErrCode, 0, '重复平台退款推送仍确认成功');
    cases = db._dump(COLLECTIONS.AFTER_SALES_CASES);
    eq(cases.length, 1, '重复平台退款推送不重复补建售后记录');
  } finally {
    virtualPay.queryRefund = originalQueryRefund;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

async function testPlatformRefundProcessingWithOpenId() {
  console.log('\n=== 7. 平台退款处理中通知带 OpenId 时仍可落库 ===');
  const db = createDb();
  const now = Date.now();
  const originalQueryRefund = virtualPay.queryRefund;
  virtualPay.queryRefund = async ({ outRefundNo }) => ({
    order_id: outRefundNo,
    order_type: 8,
    status: virtualPay.VirtualOrderStatus.REFUND_MERCHANT_DONE,
    order_fee: 300,
    refund_fee: 300,
    paid_time: Math.floor(now / 1000),
    env_type: 1,
    wx_order_id: 'wx-platform-refund-processing',
  });
  db._seed(COLLECTIONS.USERS, [{
    _id: 'u-platform-processing', openId: 'openid-platform-processing', memberLevel: 'MEMBER',
    memberExpiresAt: new Date(now + 30 * 86400000), taskPackCount: 0,
  }]);
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'ov-platform-processing', userId: 'openid-platform-processing',
    outTradeNo: 'TVIRT-PLATFORM-PROCESSING', paymentProvider: 'VIRTUAL_PAY',
    virtualEnv: 0, channelOrderType: 7, packageId: 'member', productType: 'MEMBER',
    title: '会员 30 天', amountFen: 300, memberDays: 30,
    status: OrderStatus.PAID, refundStatus: RefundStatus.NONE,
    grantStatus: GrantStatus.GRANTED, paidAt: new Date(now - 3600000),
    entitlementGrant: {
      memberDaysAddedMs: 30 * 86400000,
      taskPackDelta: 0,
      appliedAt: new Date(now - 3600000),
    },
  }]);

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'VIRTUAL_PAY',
    WECHAT_APP_ID: 'wx05c160a589b97d76',
    WECHAT_APP_SECRET: 'app-secret',
    WECHAT_VIRTUAL_PAY_ENV: '0',
    WECHAT_VIRTUAL_PAY_OFFER_ID: 'offer-test',
    WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY: '12345',
    WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER: 'member-product',
    WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK: 'pack-product',
  });
  try {
    const payment = loadPayment(db, 'openid-platform-processing', 'wx_paycallback');
    const result = await payment.main({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-platform-processing',
      MchRefundId: 'RFPLATFORMPROCESSING',
      MchOrderId: 'TVIRT-PLATFORM-PROCESSING',
      RefundFee: 300,
      RetCode: 0,
    });
    eq(result.ErrCode, 0, '平台退款处理中通知确认成功');
    const order = db._dump(COLLECTIONS.ORDERS)[0];
    const cases = db._dump(COLLECTIONS.AFTER_SALES_CASES);
    eq(order.refundStatus, RefundStatus.PROCESSING, '订单进入退款处理中');
    eq(order.grantStatus, GrantStatus.GRANTED, '尚未完成前不提前回收权益');
    eq(cases.length, 1, '平台退款处理中即生成售后记录');
    eq(cases[0].outRefundNo, 'RFPLATFORMPROCESSING', '售后记录保存平台退款单号');
    eq(cases[0].status, CaseStatus.PROCESSING, '售后工作台可看到退款处理中');
    eq(cases[0].evidence.paymentChannel, 'APPLE', '售后记录标记 Apple 渠道');
  } finally {
    virtualPay.queryRefund = originalQueryRefund;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

async function testLegacyProviderPinning() {
  console.log('\n=== 7. 旧微信支付在首次拉起时固化渠道 ===');
  const db = createDb();
  const now = Date.now();
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'ov-legacy', userId: 'openid-legacy', outTradeNo: 'TLEGACY001',
    packageId: 'member', productType: 'MEMBER', title: '会员 30 天',
    amountFen: 300, memberDays: 30, status: OrderStatus.PENDING,
    refundStatus: RefundStatus.NONE, grantStatus: GrantStatus.NONE,
    createdAt: new Date(now), expiresAt: new Date(now + 15 * 60 * 1000),
  }]);

  const originalHasApiConfig = wxpay.hasApiConfig;
  const originalCreateJsapiOrder = wxpay.createJsapiOrder;
  const originalSignPayParams = wxpay.signPayParams;
  const originalConfigOf = wxpay.configOf;
  wxpay.hasApiConfig = () => true;
  wxpay.configOf = () => ({ privateKey: 'test-key' });
  wxpay.createJsapiOrder = async () => ({ prepay_id: 'prepay-test' });
  wxpay.signPayParams = () => ({ paySign: 'test-sign' });
  try {
    const payment = loadPayment(db, 'openid-legacy');
    const result = await payment.main({ action: 'create', orderId: 'ov-legacy' });
    const order = db._dump(COLLECTIONS.ORDERS).find(item => item._id === 'ov-legacy');
    eq(result.success, true, '旧支付通道可以正常拉起');
    eq(order.paymentProvider, 'WECHAT_PAY_V3', '首次拉起后固化 API v3 渠道');
    eq(paymentProvider.providerOf(order, { PAYMENT_PROVIDER: 'VIRTUAL_PAY' }), 'WECHAT_PAY_V3',
      '后续切换虚拟支付不影响该待支付订单');
  } finally {
    wxpay.hasApiConfig = originalHasApiConfig;
    wxpay.createJsapiOrder = originalCreateJsapiOrder;
    wxpay.signPayParams = originalSignPayParams;
    wxpay.configOf = originalConfigOf;
  }
}

async function testRefundBalanceFailureMessage() {
  console.log('\n=== 8. 管理端退款余额不足返回可操作原因并校验权限 ===');
  const db = createDb();
  const now = Date.now();
  db._seed(COLLECTIONS.ORDERS, [{
    _id: 'order-balance-fail', userId: 'openid-balance-fail', outTradeNo: 'TBALANCEFAIL',
    paymentProvider: 'WECHAT_PAY_V3', packageId: 'member', productType: 'MEMBER',
    title: '会员 30 天', amountFen: 300, memberDays: 30,
    status: OrderStatus.PAID, refundStatus: RefundStatus.NONE,
    grantStatus: GrantStatus.GRANTED, paidAt: new Date(now - 3600000),
  }]);
  db._seed(COLLECTIONS.AFTER_SALES_CASES, [{
    _id: 'case-balance-fail', caseNo: 'ASC-BALANCE-FAIL', userId: 'openid-balance-fail',
    orderId: 'order-balance-fail', outTradeNo: 'TBALANCEFAIL', type: CaseType.UNUSED_REFUND,
    title: '会员 30 天', amountFen: 300, status: CaseStatus.UNDER_REVIEW,
    refundStatus: RefundStatus.UNDER_REVIEW, createdAt: new Date(now),
  }]);

  const previousEnv = { ...process.env };
  const originalConfigOf = wxpay.configOf;
  const originalHasRefundConfig = wxpay.hasRefundConfig;
  const originalCreateRefund = wxpay.createRefund;
  process.env.AFTER_SALES_ADMIN_OPENIDS = 'admin-balance';
  wxpay.configOf = () => ({});
  wxpay.hasRefundConfig = () => true;
  wxpay.createRefund = async () => {
    const err = new Error('基本账户余额不足，请充值后重新发起');
    err.statusCode = 403;
    err.code = 'NOT_ENOUGH';
    throw err;
  };

  try {
    const payment = loadPayment(db);
    const denied = await payment._test.approveRefund(
      { OPENID: 'openid-not-admin' },
      { caseId: 'case-balance-fail' }
    );
    eq(denied.errorCode, 1040, '非管理员不能绕过售后审核发起退款');

    const result = await payment._test.approveRefund(
      { OPENID: 'admin-balance' },
      { caseId: 'case-balance-fail' }
    );
    eq(result.success, false, '微信支付拒绝时退款不返回成功');
    eq(result.error, '基本账户余额不足，请充值后重新发起',
      '管理端收到可直接处理的余额不足原因');
    eq(db._dump(COLLECTIONS.AFTER_SALES_CASES)[0].status, CaseStatus.REFUND_FAILED,
      '退款失败后售后单进入可重试状态');
    const failedCase = db._dump(COLLECTIONS.AFTER_SALES_CASES)[0];
    eq(failedCase.fundingBlocked, true, '余额不足售后单持久标记资金阻断');
    eq(failedCase.failureCode, 'BASIC_ACCOUNT_INSUFFICIENT', '资金阻断使用稳定错误码');
    eq(failedCase.failureReason, '基本账户余额不足，请充值后重新发起', '资金阻断原因落库');
    eq(afterSales.caseViewOf(failedCase).fundingBlocked, true, '管理端详情可读取资金阻断标记');
    eq(db._dump(COLLECTIONS.ORDERS)[0].refundStatus, RefundStatus.FAILED,
      '退款失败后订单记录失败状态');
    const audit = db._dump(COLLECTIONS.ADMIN_AUDIT_LOGS)
      .find(item => item.action === 'REFUND_ATTEMPT_FAILED');
    eq(audit.details.error, '基本账户余额不足，请充值后重新发起', '审计保留微信原始错误');
    eq(audit.details.errorCode, 'NOT_ENOUGH', '审计保留微信错误码');
    eq(audit.details.statusCode, 403, '审计保留 HTTP 状态码');

    const adminPayment = loadPayment(db, 'admin-balance');
    const status = await adminPayment.main({ action: 'afterSales.adminStatus' });
    eq(status.success, true, '管理员可读取售后状态');
    eq(status.pendingCount, 1, '资金阻断仍计入待处理售后');
    eq(status.fundingBlockedCount, 1, '管理员入口可单独统计资金阻断售后');

    wxpay.createRefund = async () => ({
      status: 'PROCESSING',
      refund_id: 'wx-refund-retry',
    });
    const retried = await adminPayment._test.approveRefund(
      { OPENID: 'admin-balance' },
      { caseId: 'case-balance-fail' }
    );
    eq(retried.success, true, '充值后可在原售后单重新发起退款');
    const resumedCase = db._dump(COLLECTIONS.AFTER_SALES_CASES)[0];
    eq(resumedCase.status, CaseStatus.PROCESSING, '重试成功后售后单回到处理中');
    eq(resumedCase.fundingBlocked, false, '重试成功后清除资金阻断标记');
    eq(resumedCase.failureReason, '', '重试成功后清除旧失败原因');
  } finally {
    wxpay.configOf = originalConfigOf;
    wxpay.hasRefundConfig = originalHasRefundConfig;
    wxpay.createRefund = originalCreateRefund;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

async function run() {
  await testProviderAndSignatures();
  await testAccessTokenRefresh();
  await testExpiredUnpaidVirtualOrderCloses();
  testNotifyParsing();
  await testVirtualMessageIntegration();
  await testRefundNotification();
  await testPlatformRefundBackfill();
  await testPlatformRefundProcessingWithOpenId();
  await testLegacyProviderPinning();
  await testRefundBalanceFailureMessage();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
