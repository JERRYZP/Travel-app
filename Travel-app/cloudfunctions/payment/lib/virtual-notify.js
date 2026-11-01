/**
 * 虚拟支付消息推送解析。
 *
 * 微信消息推送可能是 XML，也可能是 JSON。平台只负责把消息解析成统一字段；
 * 支付是否成功仍必须调用 query_order 二次确认。
 */

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

class VirtualNotifyParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VirtualNotifyParseError';
  }
}

function parseBody(body) {
  const raw = String(body || '').trim();
  if (!raw) throw new VirtualNotifyParseError('虚拟支付推送为空');
  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new VirtualNotifyParseError('虚拟支付推送 JSON 不合法');
    }
  }
  let parsed;
  try {
    parsed = parser.parse(raw);
  } catch (err) {
    throw new VirtualNotifyParseError('虚拟支付推送 XML 不合法');
  }
  return parsed && parsed.xml ? parsed.xml : parsed;
}

function valueOf(payload = {}, names = []) {
  for (const name of names) {
    if (payload[name] != null && payload[name] !== '') return payload[name];
    const actual = Object.keys(payload).find(key => key.toLowerCase() === name.toLowerCase());
    if (actual && payload[actual] != null && payload[actual] !== '') return payload[actual];
  }
  return '';
}

function eventOf(payload = {}) {
  return String(valueOf(payload, ['Event', 'event'])).trim();
}

function messageOf(payload = {}) {
  const envValue = valueOf(payload, ['Env', 'env']);
  return {
    event: eventOf(payload),
    openId: String(valueOf(payload, ['OpenId', 'openid'])),
    outTradeNo: String(valueOf(payload, ['OutTradeNo', 'MchOrderId', 'out_trade_no'])),
    outRefundNo: String(valueOf(payload, ['MchRefundId', 'out_refund_no'])),
    wxRefundId: String(valueOf(payload, ['WxRefundId', 'wx_refund_id'])),
    mchOrderId: String(valueOf(payload, ['MchOrderId', 'mch_order_id'])),
    refundFee: Number(valueOf(payload, ['RefundFee', 'refund_fee']) || 0),
    retCode: Number(valueOf(payload, ['RetCode', 'ret_code']) || 0),
    retMsg: String(valueOf(payload, ['RetMsg', 'ret_msg'])),
    refundSuccTimestamp: Number(valueOf(payload, ['RefundSuccTimestamp', 'refund_succ_timestamp']) || 0),
    payOrderId: String(valueOf(payload, ['PayOrderId', 'pay_order_id'])),
    provideStatus: String(valueOf(payload, ['ProvideStatus', 'provide_status'])),
    productId: String(valueOf(payload, ['ProductId', 'product_id'])),
    env: envValue === '' ? null : Number(envValue),
    payload,
  };
}

function successResponse(extra = {}) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success', ...extra }),
  };
}

function failureResponse(message, statusCode = 500) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ErrCode: 1, ErrMsg: String(message || 'fail') }),
  };
}

function cloudSuccess(extra = {}) {
  return { ErrCode: 0, ErrMsg: 'success', ...extra };
}

function cloudFailure(message) {
  return { ErrCode: 1, ErrMsg: String(message || 'fail').slice(0, 200) };
}

module.exports = {
  VirtualNotifyParseError,
  parseBody,
  eventOf,
  messageOf,
  successResponse,
  failureResponse,
  cloudSuccess,
  cloudFailure,
};
