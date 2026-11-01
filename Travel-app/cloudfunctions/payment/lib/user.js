/** payment 云函数独立部署时的最小用户文档创建契约。 */

const { COLLECTIONS, MemberLevel } = require('./schema');

function defaultUserData(userId, nowTs = new Date()) {
  return {
    openId: userId,
    memberLevel: MemberLevel.NORMAL,
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

async function ensureUser(db, userId, { nowTs = new Date() } = {}) {
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

module.exports = { defaultUserData, findUser, ensureUser };
