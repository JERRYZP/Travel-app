/**
 * 反馈采纳奖励：30 天会员的唯一非订单发放入口。
 *
 * 发放和撤回都在事务内同时修改用户会员到期日、反馈奖励快照和审计日志。
 * 同一反馈只能发放一次；撤回要求该奖励仍是该用户最后一次会员权益发放。
 */

const {
  COLLECTIONS, ERRORS, MemberLevel, ok, fail,
} = require('./schema');
const userDomain = require('./user');
const quotaLock = require('./quota-lock');
const userRuntimeStale = require('./user-runtime-stale');

const REWARD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const REWARD_TYPE = 'FEEDBACK_REWARD';
const REWARD_PROGRAM_VERSION = 'feedback-member-30d-v1';

function dateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function docDataOf(result) {
  const data = result && result.data;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function findFeedbackById(db, feedbackId) {
  if (!feedbackId) return null;
  const res = await db.collection(COLLECTIONS.FEEDBACKS)
    .where({ _id: feedbackId })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

function rewardViewOf(feedback = {}, extra = {}) {
  return {
    feedbackId: feedback._id,
    status: feedback.rewardStatus || 'NONE',
    days: Math.max(0, Number(feedback.rewardDays) || 0),
    backfill: feedback.rewardBackfill === true,
    grantedAt: feedback.rewardGrantedAt || null,
    revokedAt: feedback.rewardRevokedAt || null,
    memberExpiresAt: feedback.rewardMemberExpiresAt || null,
    ...extra,
  };
}

async function writeAudit(transaction, adminUserId, action, feedback, details) {
  await transaction.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: adminUserId,
      action,
      feedbackId: feedback._id,
      targetUserId: feedback.userId,
      details,
      createdAt: new Date(),
    },
  });
}

async function grantFeedbackReward(db, adminUserId, feedbackId) {
  if (!feedbackId || typeof feedbackId !== 'string') return fail(ERRORS.BAD_PARAM);
  const seed = await findFeedbackById(db, feedbackId);
  if (!seed) return fail(ERRORS.FEEDBACK_NOT_FOUND);
  if (seed.rewardStatus === 'REVOKED') return fail(ERRORS.FEEDBACK_REWARD_REVOKED);
  if (seed.rewardStatus === 'GRANTED') {
    return ok({
      feedbackId,
      alreadyGranted: true,
      reward: rewardViewOf(seed),
      memberExpiresAt: seed.rewardMemberExpiresAt || null,
    });
  }

  const user = await userDomain.ensureUser(db, seed.userId);
  const lock = await quotaLock.acquireQuotaLock(db, seed.userId);
  if (!lock) return fail(ERRORS.TASK_QUOTA_BUSY);

  try {
    const transaction = await db.startTransaction();
    let result = null;
    try {
      const feedback = docDataOf(await transaction.collection(COLLECTIONS.FEEDBACKS)
        .doc(feedbackId).get()) || seed;
      if (feedback.rewardStatus === 'REVOKED') {
        await transaction.rollback();
        return fail(ERRORS.FEEDBACK_REWARD_REVOKED);
      }
      if (feedback.rewardStatus === 'GRANTED') {
        await transaction.rollback();
        return ok({
          feedbackId,
          alreadyGranted: true,
          reward: rewardViewOf(feedback),
          memberExpiresAt: feedback.rewardMemberExpiresAt || null,
        });
      }

      const latestUser = docDataOf(await transaction.collection(COLLECTIONS.USERS)
        .doc(user._id).get()) || user;
      const nowTs = new Date();
      const nowMs = nowTs.getTime();
      const currentExpiryMs = dateMs(latestUser.memberExpiresAt);
      const validCurrentExpiry = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
      const nextExpiryMs = validCurrentExpiry + REWARD_DAYS * DAY_MS;
      const backfill = !feedback.rewardProgramVersion;
      const rewardPatch = {
        rewardStatus: 'GRANTED',
        rewardDays: REWARD_DAYS,
        rewardBackfill: backfill,
        rewardGrantedAt: nowTs,
        rewardGrantedBy: adminUserId,
        rewardPreviousMembershipGrantAt: latestUser.lastMembershipGrantAt || null,
        rewardPreviousMembershipGrantId: latestUser.lastMembershipGrantId || '',
        rewardPreviousMembershipGrantType: latestUser.lastMembershipGrantType || '',
        rewardMemberExpiresBefore: currentExpiryMs ? new Date(currentExpiryMs) : null,
        rewardMemberExpiresAfter: new Date(nextExpiryMs),
        rewardMemberExpiresAt: new Date(nextExpiryMs),
        rewardRevokedAt: null,
        rewardRevokedBy: null,
        rewardUpdatedAt: nowTs,
        status: 'PROCESSED',
        handledAt: nowTs,
        updatedAt: nowTs,
      };
      const userPatch = {
        memberLevel: MemberLevel.MEMBER,
        memberSince: latestUser.memberSince || nowTs,
        memberExpiresAt: new Date(nextExpiryMs),
        lastMembershipGrantAt: nowTs,
        lastMembershipGrantId: feedbackId,
        lastMembershipGrantType: REWARD_TYPE,
      };

      await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({ data: userPatch });
      await transaction.collection(COLLECTIONS.FEEDBACKS).doc(feedbackId).update({ data: rewardPatch });
      await writeAudit(transaction, adminUserId, 'GRANT_FEEDBACK_MEMBER_REWARD', feedback, {
        programVersion: REWARD_PROGRAM_VERSION,
        days: REWARD_DAYS,
        backfill,
        beforeExpiresAt: rewardPatch.rewardMemberExpiresBefore,
        afterExpiresAt: rewardPatch.rewardMemberExpiresAfter,
      });
      await transaction.commit();
      result = ok({
        feedbackId,
        alreadyGranted: false,
        reward: rewardViewOf({ _id: feedbackId, ...rewardPatch }),
        memberExpiresAt: rewardPatch.rewardMemberExpiresAt,
      });
    } catch (err) {
      try { await transaction.rollback(); } catch (rollbackErr) { /* transaction may be committed */ }
      const fresh = await findFeedbackById(db, feedbackId);
      if (fresh && fresh.rewardStatus === 'GRANTED') {
        return ok({
          feedbackId,
          alreadyGranted: true,
          reward: rewardViewOf(fresh),
          memberExpiresAt: fresh.rewardMemberExpiresAt || null,
        });
      }
      throw err;
    }
    await userRuntimeStale.invalidateUsers(db, [seed.userId]);
    return result;
  } finally {
    await quotaLock.releaseQuotaLock(db, lock);
  }
}

async function revokeFeedbackReward(db, adminUserId, feedbackId) {
  if (!feedbackId || typeof feedbackId !== 'string') return fail(ERRORS.BAD_PARAM);
  const seed = await findFeedbackById(db, feedbackId);
  if (!seed) return fail(ERRORS.FEEDBACK_NOT_FOUND);
  if (seed.rewardStatus === 'REVOKED') {
    return ok({ feedbackId, alreadyRevoked: true, reward: rewardViewOf(seed) });
  }
  if (seed.rewardStatus !== 'GRANTED') return fail(ERRORS.FEEDBACK_REWARD_CONFLICT);

  const user = await userDomain.ensureUser(db, seed.userId);
  const lock = await quotaLock.acquireQuotaLock(db, seed.userId);
  if (!lock) return fail(ERRORS.TASK_QUOTA_BUSY);

  try {
    const transaction = await db.startTransaction();
    let result = null;
    try {
      const feedback = docDataOf(await transaction.collection(COLLECTIONS.FEEDBACKS)
        .doc(feedbackId).get()) || seed;
      if (feedback.rewardStatus === 'REVOKED') {
        await transaction.rollback();
        return ok({ feedbackId, alreadyRevoked: true, reward: rewardViewOf(feedback) });
      }
      if (feedback.rewardStatus !== 'GRANTED') {
        await transaction.rollback();
        return fail(ERRORS.FEEDBACK_REWARD_CONFLICT);
      }
      const latestUser = docDataOf(await transaction.collection(COLLECTIONS.USERS)
        .doc(user._id).get()) || user;
      if (latestUser.lastMembershipGrantId !== feedbackId
        || latestUser.lastMembershipGrantType !== REWARD_TYPE) {
        await transaction.rollback();
        return fail(ERRORS.FEEDBACK_REWARD_CONFLICT);
      }

      const nowTs = new Date();
      const nowMs = nowTs.getTime();
      const currentExpiryMs = Math.max(nowMs, dateMs(latestUser.memberExpiresAt));
      const nextExpiryMs = Math.max(nowMs, currentExpiryMs - REWARD_DAYS * DAY_MS);
      const stillMember = nextExpiryMs > nowMs;
      const rewardPatch = {
        rewardStatus: 'REVOKED',
        rewardRevokedAt: nowTs,
        rewardRevokedBy: adminUserId,
        rewardMemberExpiresAt: new Date(nextExpiryMs),
        rewardUpdatedAt: nowTs,
        status: 'PROCESSED',
        handledAt: nowTs,
        updatedAt: nowTs,
      };
      const userPatch = {
        memberLevel: stillMember ? MemberLevel.MEMBER : MemberLevel.NORMAL,
        memberExpiresAt: new Date(nextExpiryMs),
        lastMembershipGrantAt: feedback.rewardPreviousMembershipGrantAt || null,
        lastMembershipGrantId: feedback.rewardPreviousMembershipGrantId || '',
        lastMembershipGrantType: feedback.rewardPreviousMembershipGrantType || '',
      };

      await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({ data: userPatch });
      await transaction.collection(COLLECTIONS.FEEDBACKS).doc(feedbackId).update({ data: rewardPatch });
      await writeAudit(transaction, adminUserId, 'REVOKE_FEEDBACK_MEMBER_REWARD', feedback, {
        programVersion: REWARD_PROGRAM_VERSION,
        days: REWARD_DAYS,
        beforeExpiresAt: latestUser.memberExpiresAt || null,
        afterExpiresAt: userPatch.memberExpiresAt,
      });
      await transaction.commit();
      result = ok({
        feedbackId,
        alreadyRevoked: false,
        reward: rewardViewOf({ _id: feedbackId, ...feedback, ...rewardPatch }),
        memberExpiresAt: userPatch.memberExpiresAt,
      });
    } catch (err) {
      try { await transaction.rollback(); } catch (rollbackErr) { /* transaction may be committed */ }
      const fresh = await findFeedbackById(db, feedbackId);
      if (fresh && fresh.rewardStatus === 'REVOKED') {
        return ok({ feedbackId, alreadyRevoked: true, reward: rewardViewOf(fresh) });
      }
      throw err;
    }
    await userRuntimeStale.invalidateUsers(db, [seed.userId]);
    return result;
  } finally {
    await quotaLock.releaseQuotaLock(db, lock);
  }
}

module.exports = {
  REWARD_DAYS,
  REWARD_TYPE,
  REWARD_PROGRAM_VERSION,
  findFeedbackById,
  rewardViewOf,
  grantFeedbackReward,
  revokeFeedbackReward,
};
