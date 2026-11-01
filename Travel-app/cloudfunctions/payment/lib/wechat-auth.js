/**
 * 微信小程序登录态与接口凭据。
 *
 * 虚拟支付客户端签名需要当前用户 session_key；虚拟支付查单、退款接口
 * 需要 access_token。两者都只在服务端处理，AppSecret 不得进入小程序端。
 */

const https = require('https');

const API_HOST = 'api.weixin.qq.com';
const REQUEST_TIMEOUT_MS = 10000;
const TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;

let stableTokenCache = null;

class WechatAuthError extends Error {
  constructor(message, { errcode = 0, statusCode = 0 } = {}) {
    super(message);
    this.name = 'WechatAuthError';
    this.errcode = errcode;
    this.statusCode = statusCode;
  }
}

function configOf(env = process.env) {
  return {
    appId: String(env.WECHAT_APP_ID || env.WECHAT_PAY_APP_ID || 'wx05c160a589b97d76').trim(),
    appSecret: String(env.WECHAT_APP_SECRET || '').trim(),
  };
}

function hasConfig(config = {}) {
  return !!(config.appId && config.appSecret);
}

function queryString(params = {}) {
  return Object.keys(params)
    .filter(key => params[key] != null && params[key] !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

function requestJson({ method = 'GET', path, query, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const pathWithQuery = query ? `${path}?${queryString(query)}` : path;
  const payload = body == null ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      port: 443,
      path: pathWithQuery,
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'travel-app-payment/1.0',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
      timeout: timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (err) {
          reject(new WechatAuthError('微信登录接口返回了无法解析的数据', {
            statusCode: res.statusCode,
          }));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new WechatAuthError(data.errmsg || `微信登录接口 HTTP ${res.statusCode}`, {
            errcode: Number(data.errcode) || 0,
            statusCode: res.statusCode,
          }));
          return;
        }
        if (Number(data.errcode) && Number(data.errcode) !== 0) {
          reject(new WechatAuthError(data.errmsg || '微信登录接口调用失败', {
            errcode: Number(data.errcode),
            statusCode: res.statusCode,
          }));
          return;
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('微信登录接口请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function exchangeLoginCode({ code, config = configOf() }) {
  const loginCode = String(code || '').trim();
  if (!loginCode) throw new WechatAuthError('缺少微信登录 code');
  if (!hasConfig(config)) throw new WechatAuthError('微信登录配置未完成');

  const result = await requestJson({
    path: '/sns/jscode2session',
    query: {
      appid: config.appId,
      secret: config.appSecret,
      js_code: loginCode,
      grant_type: 'authorization_code',
    },
  });
  if (!result.openid || !result.session_key) {
    throw new WechatAuthError('微信登录未返回 openid 或 session_key');
  }
  return {
    openId: result.openid,
    unionId: result.unionid || '',
    sessionKey: result.session_key,
  };
}

async function getStableAccessToken({ config = configOf(), forceRefresh = false, now = Date.now() } = {}) {
  if (!hasConfig(config)) throw new WechatAuthError('微信接口凭据配置未完成');
  const cacheKey = `${config.appId}:${config.appSecret}`;
  if (!forceRefresh
    && stableTokenCache
    && stableTokenCache.key === cacheKey
    && stableTokenCache.expiresAt - TOKEN_REFRESH_AHEAD_MS > now) {
    return stableTokenCache.accessToken;
  }

  const result = await requestJson({
    method: 'POST',
    path: '/cgi-bin/stable_token',
    body: {
      grant_type: 'client_credential',
      appid: config.appId,
      secret: config.appSecret,
      force_refresh: forceRefresh === true,
    },
  });
  const accessToken = String(result.access_token || '');
  const expiresIn = Math.max(60, Number(result.expires_in) || 7200);
  if (!accessToken) throw new WechatAuthError('微信接口未返回 access_token');
  stableTokenCache = {
    key: cacheKey,
    accessToken,
    expiresAt: now + expiresIn * 1000,
  };
  return accessToken;
}

function resetAccessTokenCache() {
  stableTokenCache = null;
}

module.exports = {
  WechatAuthError,
  configOf,
  hasConfig,
  exchangeLoginCode,
  getStableAccessToken,
  resetAccessTokenCache,
};
