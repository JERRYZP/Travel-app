const crypto = require('crypto');

exports.main = async (event = {}) => {
  const bodyBuffer = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const headers = event.headers || {};
  const headerOf = name => {
    const key = Object.keys(headers).find(
      item => item.toLowerCase() === name.toLowerCase()
    );
    return key ? headers[key] : '';
  };

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      ok: true,
      httpMethod: event.httpMethod || '',
      path: event.path || '',
      bodyLength: bodyBuffer.length,
      bodySha256: crypto.createHash('sha256').update(bodyBuffer).digest('hex'),
      contentType: headerOf('content-type'),
      hasWechatTimestamp: Boolean(headerOf('Wechatpay-Timestamp')),
      hasWechatNonce: Boolean(headerOf('Wechatpay-Nonce')),
      hasWechatSignature: Boolean(headerOf('Wechatpay-Signature')),
      hasWechatSerial: Boolean(headerOf('Wechatpay-Serial')),
    }),
  };
};
