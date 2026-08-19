/**
 * feedback 模块集成测试：用 mock-db 跑 feedback.submit / list 逻辑
 * 运行：node test/feedback.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, FeedbackType, FeedbackCategory, FeedbackStatus, ADMIN_OPENIDS } = require('../cloudfunctions/feedback/lib/schema');
const feedback = require('../cloudfunctions/feedback/lib/feedback');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const USER = 'openid_test_001';

(async () => {
  const db = createDb();

  console.log('\n=== 1. 意见反馈（feedback） ===');
  const fb = await feedback.submit(db, USER, {
    type: FeedbackType.FEEDBACK,
    category: FeedbackCategory.SUGGESTION,
    content: '  希望支持多城市  ',
    contact: 'wx_abc',
  });
  eq(fb.success, true, '建议反馈提交成功');
  eq(db._size(COLLECTIONS.FEEDBACKS), 1, '入库 1 条');
  const saved = db._dump(COLLECTIONS.FEEDBACKS)[0];
  eq(saved.type, 'feedback', 'type 正确');
  eq(saved.category, 'suggestion', 'category 正确');
  eq(saved.content, '希望支持多城市', 'content 已 trim');
  eq(saved.contact, 'wx_abc', 'contact 已 trim');
  eq(saved.status, FeedbackStatus.OPEN, '初始状态 OPEN');
  eq(saved.spotId, null, 'feedback 无 spotId');

  const bug = await feedback.submit(db, USER, {
    type: FeedbackType.FEEDBACK,
    category: FeedbackCategory.BUG,
    content: '时间线刷新后回顶',
  });
  eq(bug.success, true, 'Bug 反馈提交成功');
  eq(db._size(COLLECTIONS.FEEDBACKS), 2, '入库 2 条');

  console.log('\n=== 2. 校验 ===');
  const badType = await feedback.submit(db, USER, { type: 'other', content: 'x' });
  eq(badType.success, false, '非法 type 拒绝');
  const badCat = await feedback.submit(db, USER, { type: 'feedback', category: 'spam', content: 'x' });
  eq(badCat.success, false, '非法 category 拒绝');
  const empty = await feedback.submit(db, USER, { type: 'feedback', category: 'bug', content: '   ' });
  eq(empty.success, false, '空内容拒绝');
  eq(empty.errorCode, 1020, '空内容错误码 1020');

  console.log('\n=== 3. 信息纠错（correction） ===');
  const corr = await feedback.submit(db, USER, {
    type: FeedbackType.CORRECTION,
    spotId: 'gugong',
    spotName: '故宫博物院',
    errorType: 'RELEASE_TIME',
    content: '实际放票时间是 20:00 整',
  });
  eq(corr.success, true, '纠错提交成功');
  const c = db._dump(COLLECTIONS.FEEDBACKS).find(d => d.type === 'correction');
  eq(c.spotId, 'gugong', 'spotId 正确');
  eq(c.spotName, '故宫博物院', 'spotName 正确');
  eq(c.errorType, 'RELEASE_TIME', 'errorType 正确');
  eq(c.category, null, 'correction 无 category');

  const noSpot = await feedback.submit(db, USER, { type: 'correction', errorType: 'OTHER', content: 'x' });
  eq(noSpot.success, false, '未选景点拒绝');
  const badErr = await feedback.submit(db, USER, { type: 'correction', spotId: 'gugong', errorType: 'FOO', content: 'x' });
  eq(badErr.success, false, '非法纠错类型拒绝');

  console.log('\n=== 4. 列表（本人历史，倒序） ===');
  // 控制时间戳：把最早一条改成过去时间，验证倒序（避免同毫秒创建导致顺序不稳定）
  const first = db._dump(COLLECTIONS.FEEDBACKS).find(d => d.type === 'feedback');
  await db.collection(COLLECTIONS.FEEDBACKS).doc(first._id).update({
    data: { createdAt: new Date(Date.now() - 86400000) },
  });
  const list = await feedback.list(db, USER);
  eq(list.success, true, 'list 成功');
  eq(list.items.length, 3, '共 3 条');
  const times = list.items.map(i => new Date(i.createdAt).getTime());
  eq(times[0] >= times[1] && times[1] >= times[2], true, '按 createdAt 倒序');
  eq(list.items[2].type, 'feedback', '最旧一条是最早提交的建议反馈');

  console.log('\n=== 5. 管理端（adminList / adminUpdateStatus） ===');
  // 普通用户：全部拒绝
  const deniedList = await feedback.adminList(db, USER, {});
  eq(deniedList.success, false, '非管理员 adminList 拒绝');
  eq(deniedList.errorCode, 1040, '拒绝错误码 1040');
  const deniedUpd = await feedback.adminUpdateStatus(db, USER, { id: first._id, status: 'PROCESSED' });
  eq(deniedUpd.success, false, '非管理员 updateStatus 拒绝');
  eq(deniedUpd.errorCode, 1040, '拒绝错误码 1040');

  // 注入管理员白名单（isAdmin 引用同一数组，push 即生效）
  ADMIN_OPENIDS.push('openid_admin_001');

  // 另一个用户提交一条，验证管理员能看到全部（不按 userId 过滤）
  await feedback.submit(db, 'openid_test_002', {
    type: FeedbackType.FEEDBACK, category: FeedbackCategory.SUGGESTION, content: '别人提的建议',
  });
  const all = await feedback.adminList(db, 'openid_admin_001', {});
  eq(all.success, true, '管理员 list 成功');
  eq(all.total, 4, '全部 4 条（含他人提交）');
  const userIds = new Set(all.items.map(i => i.userId));
  eq(userIds.size, 2, '覆盖两个提交者');

  const onlyCorr = await feedback.adminList(db, 'openid_admin_001', { type: 'correction' });
  eq(onlyCorr.total, 1, 'type 筛选只剩 1 条纠错');
  eq(onlyCorr.items[0].spotId, 'gugong', '筛选结果是纠错记录');

  // 状态流转
  const upd = await feedback.adminUpdateStatus(db, 'openid_admin_001', { id: first._id, status: 'PROCESSED' });
  eq(upd.success, true, '管理员改状态成功');
  eq(db._dump(COLLECTIONS.FEEDBACKS).find(d => d._id === first._id).status, 'PROCESSED', '状态已变 PROCESSED');
  const badStatus = await feedback.adminUpdateStatus(db, 'openid_admin_001', { id: first._id, status: 'DONE' });
  eq(badStatus.success, false, '非法 status 拒绝');
  const noId = await feedback.adminUpdateStatus(db, 'openid_admin_001', { status: 'OPEN' });
  eq(noId.success, false, '缺 id 拒绝');
  const reopen = await feedback.adminUpdateStatus(db, 'openid_admin_001', { id: first._id, status: 'OPEN' });
  eq(reopen.success, true, '重新打开成功');
  eq(db._dump(COLLECTIONS.FEEDBACKS).find(d => d._id === first._id).status, 'OPEN', '状态已回到 OPEN');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
