/**
 * 支付渠道选择。
 *
 * 新老渠道必须按订单固化，不能只依赖当前云函数环境变量。否则切换到
 * 虚拟支付后，历史普通微信支付订单的查单、退款会被错误路由。
 */

const PaymentProvider = Object.freeze({
  WECHAT_PAY_V3: 'WECHAT_PAY_V3',
  VIRTUAL_PAY: 'VIRTUAL_PAY',
});

const PROVIDERS = new Set(Object.values(PaymentProvider));

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function testOpenIdsOf(env = process.env) {
  return String(env.PAYMENT_VIRTUAL_PAY_TEST_OPENIDS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function configuredProvider(env = process.env, openId = '') {
  if (normalize(env.PAYMENT_PROVIDER) !== PaymentProvider.VIRTUAL_PAY) {
    return PaymentProvider.WECHAT_PAY_V3;
  }
  const testOpenIds = testOpenIdsOf(env);
  if (testOpenIds.length === 0) return PaymentProvider.VIRTUAL_PAY;
  return testOpenIds.includes(String(openId || '').trim())
    ? PaymentProvider.VIRTUAL_PAY
    : PaymentProvider.WECHAT_PAY_V3;
}

function providerOf(order = {}, env = process.env, openId = '', clientSupportsVirtualPay = false) {
  const saved = normalize(order.paymentProvider);
  if (PROVIDERS.has(saved)) return saved;

  // 虚拟支付创建阶段会固化环境或道具 ID；即使 provider 字段因异常缺失，
  // 也不能在后续切回 API v3 时把该订单错误路由。
  if (order.virtualEnv != null || order.virtualProductId) {
    return PaymentProvider.VIRTUAL_PAY;
  }

  // 普通微信支付历史订单已有交易号或支付查单结果。即使环境已经切换，
  // 也必须继续走旧通道完成查单、退款和历史售后。
  const legacyMarker = order.transactionId
    || (order.paymentResult && (
      order.paymentResult.mchId
      || order.paymentResult.tradeState
      || order.paymentResult.transactionId
    ));
  if (legacyMarker || !clientSupportsVirtualPay) return PaymentProvider.WECHAT_PAY_V3;
  return configuredProvider(env, openId);
}

function isVirtualPay(order = {}, env = process.env, openId = '', clientSupportsVirtualPay = false) {
  return providerOf(order, env, openId, clientSupportsVirtualPay) === PaymentProvider.VIRTUAL_PAY;
}

module.exports = {
  PaymentProvider,
  testOpenIdsOf,
  configuredProvider,
  providerOf,
  isVirtualPay,
};
