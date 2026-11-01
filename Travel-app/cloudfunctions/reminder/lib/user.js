/** 用户文档的唯一创建入口。
 *
 * 新用户使用 OpenID 作为确定性 _id，避免首页、订单和支付回调并发时创建
 * 多份用户记录。历史随机 _id 用户仍按 openId 正常读取，不做破坏性迁移。
 */

const { COLLECTIONS, MemberLevel, V1 } = require('./schema');
const time = require('./time');

function genAutoProfile() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += chars[Math.floor(Math.random() * chars.length)];
  return {
    nickname: '用户' + suffix,
    avatarUrl: '/images/avatars/default-' + (1 + Math.floor(Math.random() * 6)) + '.png',
  };
}

function defaultUserData(userId, nowTs = time.now()) {
  return {
    openId: userId,
    ...genAutoProfile(),
    phone: '',
    notifyPrefs: {
      officialAccount: false,
      sms: false,
      offsets: [...V1.ALLOWED_OFFSETS],
    },
    subscribeQuota: 0,
    memberLevel: MemberLevel.NORMAL,
    points: 0,
    taskPackCount: 0,
    taskPackSlots: 0,
    protectedTaskQuota: 5,
    protectionMigratedAt: nowTs,
    lastReminderCreatedAt: null,
    memberSince: null,
    memberExpiresAt: null,
    createdAt: nowTs,
  };
}

async function findUser(db, userId) {
  if (!userId) return null;
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function ensureUser(db, userId, { nowTs = time.now() } = {}) {
  const existing = await findUser(db, userId);
  if (existing) return existing;
  const data = defaultUserData(userId, nowTs);
  try {
    await db.collection(COLLECTIONS.USERS).doc(userId).set({ data });
    return { _id: userId, ...data };
  } catch (err) {
    const raced = await findUser(db, userId);
    if (raced) return raced;
    throw err;
  }
}

module.exports = {
  genAutoProfile,
  defaultUserData,
  findUser,
  ensureUser,
};
