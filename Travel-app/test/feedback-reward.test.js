/**
 * 反馈多条回复与采纳奖励回归。
 * 运行：node test/feedback-reward.test.js
 */
const { createDb } = require('./mock-db');
const feedbackSchema = require('../cloudfunctions/feedback/lib/schema');
const feedback = require('../cloudfunctions/feedback/lib/feedback');
const paymentSchema = require('../cloudfunctions/payment/lib/schema');
const reward = require('../cloudfunctions/payment/lib/feedback-reward');

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

const DAY = 86400000;
const ADMIN = feedbackSchema.ADMIN_OPENIDS[0];
const USER = 'openid_feedback_reward';

function seedUser(db, userId = USER, patch = {}) {
  db._seed(paymentSchema.COLLECTIONS.USERS, [{
    _id: `user_${userId}`,
    openId: userId,
    memberLevel: 'NORMAL',
    memberSince: null,
    memberExpiresAt: null,
    taskPackCount: 0,
    feedbackSeenAt: new Date(0),
    ...patch,
  }]);
}

function feedbackDoc(id, userId = USER, patch = {}) {
  return {
    _id: id,
    userId,
    type: 'feedback',
    category: 'suggestion',
    spotId: null,
    spotName: null,
    errorType: null,
    content: `反馈 ${id}`,
    contact: '',
    status: 'OPEN',
    adminReply: '',
    adminReplyAt: null,
    adminReplyBy: null,
    rewardStatus: 'NONE',
    createdAt: new Date(),
    ...patch,
  };
}

function findUser(db) {
  return db._dump(paymentSchema.COLLECTIONS.USERS)[0];
}

function findFeedback(db, id) {
  return db._dump(feedbackSchema.COLLECTIONS.FEEDBACKS).find(item => item._id === id);
}

async function testReplies() {
  console.log('\n=== 1. 管理员多条回复与逐条修改 ===');
  const db = createDb();
  const oldCreatedAt = new Date('2026-08-01T03:00:00.000Z');
  const replyAt = new Date('2026-08-02T03:00:00.000Z');
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, [feedbackDoc('fb_legacy', USER, {
    content: '旧反馈',
    status: 'PROCESSED',
    adminReply: '旧回复',
    adminReplyAt: replyAt,
    adminReplyBy: ADMIN,
    createdAt: oldCreatedAt,
  })]);

  const first = await feedback.adminAddReply(db, ADMIN, { id: 'fb_legacy', reply: ' 第一条新回复 ' });
  eq(first.success, true, '追加回复成功');
  eq(first.replies.length, 2, '历史单条回复被规范化为线程中的第一条');
  eq(first.replies[0].legacy, true, '历史回复带 legacy 标记');
  eq(first.replies[1].content, '第一条新回复', '新回复已 trim');
  eq(findFeedback(db, 'fb_legacy').adminReply, '第一条新回复', '旧镜像字段同步到最新回复');

  const updated = await feedback.adminUpdateReply(db, ADMIN, {
    id: 'fb_legacy',
    replyId: first.replies[1].replyId,
    reply: '第一条新回复（已修订）',
  });
  eq(updated.success, true, '任意日期均可修改指定回复');
  eq(updated.reply.content, '第一条新回复（已修订）', '修改后的正文返回');
  eq(updated.reply.createdAt.getTime(), first.replies[1].createdAt.getTime(), '修改不重置原回复时间');
  eq(updated.reply.editCount, 1, '修改次数递增');

  const notFound = await feedback.adminUpdateReply(db, ADMIN, {
    id: 'fb_legacy', replyId: 'missing', reply: 'x',
  });
  eq(notFound.errorCode, feedbackSchema.ERRORS.REPLY_NOT_FOUND.code, '指定回复不存在时拒绝');
  const forbidden = await feedback.adminAddReply(db, USER, { id: 'fb_legacy', reply: 'x' });
  eq(forbidden.errorCode, 1040, '普通用户不能写回复');

  const userList = await feedback.list(db, USER);
  const item = userList.items[0];
  eq(item.replies.length, 2, '用户端看到完整回复线程');
  eq(item.replies[1].edited, true, '用户端看到「已修改」状态');
  eq(Object.prototype.hasOwnProperty.call(item.replies[1], 'createdBy'), false,
    '用户端不泄露回复人 OpenID');

  const fullReplies = Array.from({ length: feedbackSchema.MAX_ADMIN_REPLIES }, (_, index) => ({
    replyId: `full_${index}`,
    content: `回复 ${index}`,
    createdAt: new Date(),
    createdBy: ADMIN,
    updatedAt: new Date(),
    updatedBy: ADMIN,
    editCount: 0,
    legacy: false,
  }));
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, [feedbackDoc('fb_full', USER, { adminReplies: fullReplies })]);
  const limited = await feedback.adminAddReply(db, ADMIN, { id: 'fb_full', reply: '第 101 条' });
  eq(limited.errorCode, feedbackSchema.ERRORS.REPLY_LIMIT.code, '回复达到上限时返回 1045');
}

async function testGrantStackAndRevoke() {
  console.log('\n=== 2. 30 天奖励、叠加、幂等与撤回 ===');
  const db = createDb();
  const initialExpiry = Date.now() + 10 * DAY;
  seedUser(db, USER, { memberLevel: 'MEMBER', memberExpiresAt: new Date(initialExpiry) });
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, [
    feedbackDoc('fb_a', USER),
    feedbackDoc('fb_b', USER),
  ]);

  const first = await reward.grantFeedbackReward(db, ADMIN, 'fb_a');
  eq(first.success, true, '管理员可赠送本人反馈奖励');
  eq(first.reward.backfill, true, '无 rewardProgramVersion 的历史反馈标记为补发');
  let user = findUser(db);
  eq(new Date(user.memberExpiresAt).getTime() >= initialExpiry + 30 * DAY - 2000, true,
    '奖励从当前会员到期日继续顺延 30 天');
  eq(user.lastMembershipGrantId, 'fb_a', '记录最后一次权益发放为反馈奖励');
  eq(user.lastMembershipGrantType, reward.REWARD_TYPE, '记录奖励发放类型');

  const again = await reward.grantFeedbackReward(db, ADMIN, 'fb_a');
  eq(again.alreadyGranted, true, '同一反馈重复赠送幂等');
  eq(new Date(findUser(db).memberExpiresAt).getTime(), new Date(user.memberExpiresAt).getTime(),
    '重复赠送不重复增加时长');

  const second = await reward.grantFeedbackReward(db, ADMIN, 'fb_b');
  eq(second.success, true, '不同反馈可连续赠送');
  user = findUser(db);
  eq(new Date(user.memberExpiresAt).getTime() >= initialExpiry + 60 * DAY - 2000, true,
    '不同反馈奖励可叠加');

  const conflict = await reward.revokeFeedbackReward(db, ADMIN, 'fb_a');
  eq(conflict.errorCode, paymentSchema.ERRORS.FEEDBACK_REWARD_CONFLICT.code,
    '不是最新权益发放时不能撤回');

  const revokeSecond = await reward.revokeFeedbackReward(db, ADMIN, 'fb_b');
  eq(revokeSecond.success, true, '可撤回最新一笔奖励');
  user = findUser(db);
  eq(user.lastMembershipGrantId, 'fb_a', '撤回最新奖励后恢复到上一笔反馈奖励');
  eq(new Date(user.memberExpiresAt).getTime() >= initialExpiry + 30 * DAY - 2000, true,
    '只扣回被撤回的 30 天');

  const revokeFirst = await reward.revokeFeedbackReward(db, ADMIN, 'fb_a');
  eq(revokeFirst.success, true, '上一笔奖励恢复为最新后可继续撤回');
  user = findUser(db);
  eq(user.lastMembershipGrantId, '', '全部反馈奖励撤回后清空发放指针');

  const regrant = await reward.grantFeedbackReward(db, ADMIN, 'fb_a');
  eq(regrant.errorCode, paymentSchema.ERRORS.FEEDBACK_REWARD_REVOKED.code,
    '撤回后的同一反馈不能再次赠送');
  eq(db._size(paymentSchema.COLLECTIONS.ADMIN_AUDIT_LOGS), 4,
    '两次发放和两次撤回均写入审计日志');
}

async function testOrderConflict() {
  console.log('\n=== 3. 后续订单权益会阻断反馈奖励撤回 ===');
  const db = createDb();
  seedUser(db);
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, [feedbackDoc('fb_order_conflict')]);
  await reward.grantFeedbackReward(db, ADMIN, 'fb_order_conflict');
  await db.collection(paymentSchema.COLLECTIONS.USERS).doc(`user_${USER}`).update({
    data: {
      lastMembershipGrantId: 'order_after_reward',
      lastMembershipGrantType: 'ORDER',
      lastMembershipGrantAt: new Date(),
    },
  });
  const conflict = await reward.revokeFeedbackReward(db, ADMIN, 'fb_order_conflict');
  eq(conflict.errorCode, paymentSchema.ERRORS.FEEDBACK_REWARD_CONFLICT.code,
    '奖励后出现新订单权益时禁止自动撤回');
  eq(findFeedback(db, 'fb_order_conflict').rewardStatus, 'GRANTED', '冲突时不改奖励状态');
}

async function testBackfillFlagAndPartialConsumption() {
  console.log('\n=== 4. 新反馈与部分消耗后的奖励撤回 ===');
  const db = createDb();
  seedUser(db);
  const submitted = await feedback.submit(db, USER, {
    type: 'feedback', category: 'suggestion', content: '新提交的反馈',
  });

  const granted = await reward.grantFeedbackReward(db, ADMIN, submitted.id);
  eq(granted.success, true, '上线后提交的新反馈可以赠送');
  eq(granted.reward.backfill, false, '新反馈不被误标为补发');

  const now = Date.now();
  await db.collection(paymentSchema.COLLECTIONS.USERS).doc(`user_${USER}`).update({
    data: { memberExpiresAt: new Date(now + 10 * DAY) },
  });
  const revoked = await reward.revokeFeedbackReward(db, ADMIN, submitted.id);
  eq(revoked.success, true, '部分消耗后仍可撤回最新奖励');
  const remainingMs = new Date(findUser(db).memberExpiresAt).getTime() - Date.now();
  eq(remainingMs > -2000 && remainingMs < 2000, true, '只扣剩余奖励期，撤回时间附近不产生可用负时长');
}

async function testBackfillNotice() {
  console.log('\n=== 5. 历史反馈补发通知不受最近 50 条限制 ===');
  const db = createDb();
  seedUser(db);
  const base = Date.now() - 100 * DAY;
  const rows = Array.from({ length: 51 }, (_, index) => feedbackDoc(`fb_notice_${index}`, USER, {
    content: `历史反馈 ${index}`,
    createdAt: new Date(base - index * 1000),
  }));
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, rows);
  const oldestId = 'fb_notice_50';
  await reward.grantFeedbackReward(db, ADMIN, oldestId);

  const list = await feedback.list(db, USER);
  eq(list.items.length, 50, '本人历史仍只返回最近 50 条');
  eq(list.items.some(item => item._id === oldestId), false, '补发目标本身在最近 50 条之外');
  eq(list.rewardNotices.length, 1, '补发通知独立返回');
  eq(list.rewardNotices[0].feedbackId, oldestId, '通知指向被补发的历史反馈');
  eq(list.rewardNotices[0].reward.backfill, true, '通知明确是补发奖励');
  eq((await feedback.entrySummary(db, USER)).handledUnreadCount, 1, '补发计入用户未读');

  await feedback.markSeen(db, USER, { through: list.asOf });
  eq((await feedback.list(db, USER)).rewardNotices.length, 0, '查看后通知水位清零');

  await new Promise(resolve => setTimeout(resolve, 2));
  await reward.revokeFeedbackReward(db, ADMIN, oldestId);
  const revokedList = await feedback.list(db, USER);
  eq(revokedList.rewardNotices.length, 1, '撤回产生新的用户通知');
  eq(revokedList.rewardNotices[0].reward.status, 'REVOKED', '用户能识别奖励已撤回');
}

async function testRewardNoticePagination() {
  console.log('\n=== 6. 批量补发通知分页读取 ===');
  const db = createDb();
  seedUser(db);
  const updatedAt = Date.now() - 1000;
  db._seed(feedbackSchema.COLLECTIONS.FEEDBACKS, Array.from({ length: 125 }, (_, index) => feedbackDoc(
    `fb_bulk_${index}`,
    USER,
    {
      rewardStatus: 'GRANTED',
      rewardDays: 30,
      rewardBackfill: true,
      rewardProgramVersion: reward.REWARD_PROGRAM_VERSION,
      rewardGrantedAt: new Date(updatedAt - index),
      rewardMemberExpiresAt: new Date(updatedAt + 30 * DAY),
      rewardUpdatedAt: new Date(updatedAt - index),
    }
  )));

  const list = await feedback.list(db, USER);
  eq(list.rewardNotices.length, 125, '超过单页上限的补发通知全部返回');
}

async function run() {
  await testReplies();
  await testGrantStackAndRevoke();
  await testOrderConflict();
  await testBackfillFlagAndPartialConsumption();
  await testBackfillNotice();
  await testRewardNoticePagination();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
