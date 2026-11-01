/**
 * 管理员密码哈希与无状态会话 token。
 *
 * 这里不依赖第三方 JWT 库：Node 内置 crypto 足以完成 scrypt 和 HS256。
 * 密码永远只保存 salt + hash；token 只保存 HMAC 签名后的载荷。
 */
const crypto = require('crypto');
const { ROLES, ADMIN_STATUS } = require('./schema');

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt = randomSalt()) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex');
  return { salt, hash };
}

function timingSafeHexEqual(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch (e) {
    return false;
  }
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const computed = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex');
  return timingSafeHexEqual(computed, expectedHash);
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signRaw(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createToken(admin, secret, nowMs = Date.now()) {
  if (!secret) throw new Error('ADMIN_SESSION_SECRET 未配置');
  const nowSec = Math.floor(nowMs / 1000);
  const payload = {
    sub: admin._id,
    username: admin.username,
    role: admin.role || ROLES.SUPER_ADMIN,
    tokenVersion: Number(admin.tokenVersion) || 0,
    iat: nowSec,
    exp: nowSec + Math.floor(SESSION_TTL_MS / 1000),
  };
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson(payload);
  return `${header}.${body}.${signRaw(`${header}.${body}`, secret)}`;
}

function verifyToken(token, secret, nowMs = Date.now()) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = signRaw(`${parts[0]}.${parts[1]}`, secret);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  const nowSec = Math.floor(nowMs / 1000);
  if (!payload || !payload.sub || !payload.exp || payload.exp <= nowSec) return null;
  return payload;
}

function isActiveAdmin(admin) {
  return !!admin && admin.status === ADMIN_STATUS.ACTIVE;
}

module.exports = {
  SESSION_TTL_MS,
  randomSalt,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  isActiveAdmin,
};
