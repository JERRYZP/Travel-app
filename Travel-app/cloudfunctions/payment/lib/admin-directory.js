/**
 * 客服工作台共用的用户检索与用户信息补全。
 *
 * OpenID、订单号、售后单号必须精确查询；昵称允许部分匹配。列表只返回
 * 白名单管理员能够看到的必要用户信息，不读取或伪造微信资料。
 */

const { COLLECTIONS } = require('./schema');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_USER_MATCHES = 50;

function keywordOf(value) {
  return String(value || '').trim().slice(0, 80);
}

function keywordKindOf(keyword) {
  if (/^o[A-Za-z0-9_-]{20,}$/.test(keyword)) return 'OPENID';
  if (/^ord_[A-Za-z0-9_-]+$/i.test(keyword)) return 'ORDER_ID';
  if (/^AS[A-Z0-9]{8,}$/i.test(keyword)) return 'CASE_NO';
  if (/^T[A-Z0-9]{8,}$/i.test(keyword)) return 'OUT_TRADE_NO';
  return 'NICKNAME';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePage(params = {}) {
  const rawPage = Math.floor(Number(params.page) || 1);
  const rawPageSize = Math.floor(Number(params.pageSize) || DEFAULT_PAGE_SIZE);
  const page = Math.max(1, rawPage);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, rawPageSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

async function usersByNickname(db, keyword) {
  const query = db.collection(COLLECTIONS.USERS);
  if (typeof db.RegExp === 'function') {
    const res = await query
      .where({ nickname: db.RegExp({ regexp: escapeRegex(keyword), options: 'i' }) })
      .limit(MAX_USER_MATCHES)
      .get();
    return res.data || [];
  }
  const res = await query.limit(200).get();
  const lower = keyword.toLowerCase();
  return (res.data || [])
    .filter(user => String(user.nickname || '').toLowerCase().includes(lower))
    .slice(0, MAX_USER_MATCHES);
}

async function userMapByOpenIds(db, openIds) {
  const ids = [...new Set((openIds || []).filter(Boolean))];
  const users = [];
  for (let index = 0; index < ids.length; index += 20) {
    const chunk = ids.slice(index, index + 20);
    const res = await db.collection(COLLECTIONS.USERS)
      .where({ openId: db.command.in(chunk) })
      .limit(chunk.length)
      .get();
    users.push(...(res.data || []));
  }
  return users.reduce((map, user) => {
    if (user.openId) map[user.openId] = user;
    return map;
  }, {});
}

function dateText(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function userBriefOf(user = {}, fallbackOpenId = '') {
  const openId = String(user.openId || fallbackOpenId || '');
  const expiresAt = user.memberExpiresAt || null;
  const member = !!expiresAt && new Date(expiresAt).getTime() > Date.now();
  return {
    openId,
    nickname: String(user.nickname || ''),
    avatarUrl: String(user.avatarUrl || ''),
    member,
    memberExpiresAt: expiresAt,
    memberExpiresAtText: dateText(expiresAt),
    taskPackCount: Math.max(0, parseInt(user.taskPackCount, 10) || 0),
    taskPackSlots: Math.max(0, parseInt(user.taskPackSlots, 10) || 0),
    lastReminderCreatedAt: user.lastReminderCreatedAt || null,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  keywordOf,
  keywordKindOf,
  escapeRegex,
  normalizePage,
  usersByNickname,
  userMapByOpenIds,
  userBriefOf,
};
