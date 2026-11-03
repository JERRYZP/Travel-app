/**
 * feedback 模块集成测试：用 mock-db 跑 feedback.submit / list / adminReply 逻辑
 * 运行：node test/feedback.test.js
 */
const { createDb } = require('./mock-db');
const {
  COLLECTIONS, FeedbackType, FeedbackCategory, FeedbackStatus, REPLY_MAX_LEN, ADMIN_OPENIDS,
} = require('../cloudfunctions/feedback/lib/schema');
const feedback = require('../cloudfunctions/feedback/lib/feedback');
const userDirectory = require('../cloudfunctions/feedback/lib/user-directory');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const hasKey = (obj, key, m) => {
  const ok = Object.prototype.hasOwnProperty.call(obj, key);
  if (!ok) { fail += 1; console.log('FAIL', m, '(missing key:', key + ')'); }
  else console.log('ok  ', m);
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
  eq(saved.adminReply, '', '提交时 adminReply 为空串');
  eq(saved.adminReplyAt, null, '提交时 adminReplyAt 为 null');
  eq(saved.adminReplyBy, null, '提交时 adminReplyBy 为 null');

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
  const deniedStatus = await feedback.adminStatus(USER);
  eq(deniedStatus.success, true, '非管理员状态查询成功');
  eq(deniedStatus.isAdmin, false, '非管理员身份为 false');
  const deniedList = await feedback.adminList(db, USER, {});
  eq(deniedList.success, false, '非管理员 adminList 拒绝');
  eq(deniedList.errorCode, 1040, '拒绝错误码 1040');
  const deniedUpd = await feedback.adminUpdateStatus(db, USER, { id: first._id, status: 'PROCESSED' });
  eq(deniedUpd.success, false, '非管理员 updateStatus 拒绝');
  eq(deniedUpd.errorCode, 1040, '拒绝错误码 1040');

  // 注入管理员白名单（isAdmin 引用同一数组，push 即生效）
  ADMIN_OPENIDS.push('openid_admin_001');
  const adminStatus = await feedback.adminStatus('openid_admin_001');
  eq(adminStatus.success, true, '管理员状态查询成功');
  eq(adminStatus.isAdmin, true, '管理员身份为 true');

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

  console.log('\n=== 6. 本人反馈列表最多返回 50 条 ===');
  for (let i = 0; i < 48; i += 1) {
    await feedback.submit(db, USER, {
      type: FeedbackType.FEEDBACK,
      category: FeedbackCategory.SUGGESTION,
      content: `分页边界 ${i}`,
    });
  }
  const capped = await feedback.list(db, USER);
  eq(capped.success, true, '超过 50 条时 list 仍成功');
  eq(capped.items.length, 50, '本人反馈历史最多返回 50 条');

  console.log('\n=== 7. 管理员分页（adminList page/pageSize） ===');
  // 新库：避免被第 6 节的 48 条插入污染计数。ADMIN 白名单已在第 5 节注入，进程内一直有效。
  const ADMIN = 'openid_admin_001';
  const db2 = createDb();
  const PAGE_USER = 'openid_page_user';
  db2._seed(COLLECTIONS.FEEDBACKS, [1, 2, 3, 4, 5].map(i => ({
    _id: `fb${i}`,
    userId: PAGE_USER,
    type: FeedbackType.FEEDBACK,
    category: i % 2 ? FeedbackCategory.SUGGESTION : FeedbackCategory.BUG,
    spotId: null,
    spotName: null,
    errorType: null,
    content: `第 ${i} 条`,
    contact: '',
    status: FeedbackStatus.OPEN,
    adminReply: '',
    adminReplyAt: null,
    adminReplyBy: null,
    createdAt: new Date(Date.now() - (5 - i) * 60000),
  })));

  const p1 = await feedback.adminList(db2, ADMIN, { page: 1, pageSize: 2 });
  eq(p1.success, true, '分页第 1 页成功');
  eq(p1.items.length, 2, '第 1 页 2 条');
  eq(p1.total, 5, 'total 是全部 5 条，不是本页条数');
  eq(p1.hasMore, true, '第 1 页还有更多');
  eq(p1.items[0]._id, 'fb5', '倒序：最新在前');
  const p2 = await feedback.adminList(db2, ADMIN, { page: 2, pageSize: 2 });
  eq(p2.items[0]._id, 'fb3', '第 2 页从 fb3 开始');
  const p3 = await feedback.adminList(db2, ADMIN, { page: 3, pageSize: 2 });
  eq(p3.items.length, 1, '第 3 页 1 条');
  eq(p3.hasMore, false, '最后一页没有更多');
  const pagedIds = [...p1.items, ...p2.items, ...p3.items].map(i => i._id).sort();
  eq(pagedIds.join(','), 'fb1,fb2,fb3,fb4,fb5', '三页拼起来无重复无遗漏');

  // 越界页：空但 total 仍正确 —— 这条专门抓 count() 写在 skip() 之后的问题
  const far = await feedback.adminList(db2, ADMIN, { page: 99, pageSize: 2 });
  eq(far.success, true, '越界页不报错');
  eq(far.items.length, 0, '越界页为空');
  eq(far.total, 5, '越界页 total 仍是 5');

  eq((await feedback.adminList(db2, ADMIN, { pageSize: 999 })).pageSize, 50, 'pageSize 上限 50');
  eq((await feedback.adminList(db2, ADMIN, { pageSize: 0 })).pageSize, 20, 'pageSize 0 回退 20');
  eq((await feedback.adminList(db2, ADMIN, { page: 'abc' })).page, 1, '非法 page 回退 1');
  eq((await feedback.adminList(db2, ADMIN, { page: -3 })).page, 1, '负数 page 回退 1');

  const deniedPaged = await feedback.adminList(db2, USER, { page: 2, pageSize: 10 });
  eq(deniedPaged.errorCode, 1040, '非管理员带分页参数仍 1040');

  console.log('\n=== 8. 筛选（category） ===');
  const bugs = await feedback.adminList(db2, ADMIN, { category: 'bug' });
  eq(bugs.success, true, 'category=bug 筛选成功');
  eq(bugs.total, 2, 'bug 2 条');
  eq(bugs.items.every(i => i.category === 'bug'), true, '筛选结果全部是 bug');

  // 纠错的 category 恒为 null，天然被 category 筛选排除 —— 钉住管理页 Tab 的参数映射
  await feedback.submit(db2, 'openid_corr_user', {
    type: FeedbackType.CORRECTION, spotId: 'tiantan', spotName: '天坛', errorType: 'OTHER', content: '闭馆日不对',
  });
  const bugAfterCorr = await feedback.adminList(db2, ADMIN, { category: 'bug' });
  eq(bugAfterCorr.total, 2, 'category 筛选天然排除纠错');
  eq((await feedback.adminList(db2, ADMIN, { category: 'spam' })).total, 6, '非法 category 按无筛选处理');
  eq((await feedback.adminList(db2, ADMIN, { type: 'correction' })).total, 1, 'type=correction 只剩纠错');
  const combined = await feedback.adminList(db2, ADMIN, { type: 'feedback', category: 'bug' });
  eq(combined.total, 2, 'type + category 可叠加');

  console.log('\n=== 9. 用户信息补全 ===');
  db2._seed(COLLECTIONS.USERS, [
    { openId: PAGE_USER, nickname: '小赵', avatarUrl: 'https://x/a.png' },
  ]);
  const withUser = await feedback.adminList(db2, ADMIN, { pageSize: 10 });
  const byUser = withUser.items.find(i => i.userId === PAGE_USER);
  eq(byUser.user.nickname, '小赵', '关联到 users 昵称');
  eq(byUser.user.openId, PAGE_USER, 'openId 正确');
  eq(byUser.user.avatarUrl, 'https://x/a.png', 'avatarUrl 透传');
  const noUser = withUser.items.find(i => i.userId === 'openid_corr_user');
  eq(noUser.user.nickname, '', '无 users 文档时昵称为空串');
  eq(noUser.user.openId, 'openid_corr_user', '无文档时 openId 用 userId 兜底');
  eq(userDirectory.USER_QUERY_CHUNK, 20, '查表分块 20 条（与 payment 侧一致）');

  console.log('\n=== 10. 管理员回复（adminReply） ===');
  const deniedReply = await feedback.adminReply(db2, USER, { id: 'fb1', reply: 'hi' });
  eq(deniedReply.success, false, '非管理员回复拒绝');
  eq(deniedReply.errorCode, 1040, '回复拒绝错误码 1040');
  eq((await feedback.adminReply(db2, ADMIN, { reply: 'hi' })).errorCode, 1010, '缺 id → 1010');
  eq((await feedback.adminReply(db2, ADMIN, { id: 'fb1', reply: 123 })).errorCode, 1010, 'reply 非字符串 → 1010');
  eq((await feedback.adminReply(db2, ADMIN, { id: 'fb1', reply: '   ' })).errorCode, 1044, '空白回复 → 1044');
  eq((await feedback.adminReply(db2, ADMIN, { id: 'fb1', reply: 'x'.repeat(REPLY_MAX_LEN + 1) })).errorCode, 1010, '超 300 字 → 1010');
  eq((await feedback.adminReply(db2, ADMIN, { id: 'nope', reply: 'hi' })).errorCode, 1043, '反馈不存在 → 1043');

  const r1 = await feedback.adminReply(db2, ADMIN, { id: 'fb1', reply: '  收到，下版本处理  ' });
  eq(r1.success, true, '回复成功');
  eq(r1.adminReply, '收到，下版本处理', '返回 trim 后正文');
  eq(r1.status, 'PROCESSED', '回复即 PROCESSED');
  const doc1 = db2._dump(COLLECTIONS.FEEDBACKS).find(d => d._id === 'fb1');
  eq(doc1.adminReply, '收到，下版本处理', '回复已入库');
  eq(doc1.adminReplyBy, ADMIN, '回复人 OpenID 入库');
  eq(doc1.adminReplyAt instanceof Date, true, '回复时间入库为 Date');
  eq(doc1.status, 'PROCESSED', '状态已置 PROCESSED');

  const r2 = await feedback.adminReply(db2, ADMIN, { id: 'fb1', reply: '更新：已上线' });
  eq(r2.adminReply, '更新：已上线', '二次回复覆盖');
  const doc1b = db2._dump(COLLECTIONS.FEEDBACKS).find(d => d._id === 'fb1');
  eq(doc1b.adminReply, '更新：已上线', '库里仍是单条回复（字符串，不是数组）');
  eq(Array.isArray(doc1b.adminReply), false, '回复字段不是数组');

  await feedback.adminUpdateStatus(db2, ADMIN, { id: 'fb2', status: 'IGNORED' });
  const r3 = await feedback.adminReply(db2, ADMIN, { id: 'fb2', reply: '这条不改，规则是对的' });
  eq(r3.status, 'PROCESSED', '对 IGNORED 回复后翻成 PROCESSED');

  console.log('\n=== 11. 本人列表隔离（不泄露管理端字段） ===');
  const mine = await feedback.list(db2, PAGE_USER);
  eq(mine.success, true, '本人 list 成功');
  eq(Object.prototype.hasOwnProperty.call(mine.items[0], 'adminReplyBy'), false, '不返回 adminReplyBy');
  eq(Object.prototype.hasOwnProperty.call(mine.items[0], 'userId'), false, '不返回 userId');
  hasKey(mine.items[0], 'adminReply', 'adminReply 字段存在');
  const repliedItem = mine.items.find(i => i._id === 'fb1');
  eq(repliedItem.adminReply, '更新：已上线', '用户能看到回复正文');
  eq(repliedItem.adminReplyAt instanceof Date, true, '用户能看到回复时间');
  eq(repliedItem.status, 'PROCESSED', '用户能看到处理状态');
  const plainItem = mine.items.find(i => i._id === 'fb3');
  eq(plainItem.adminReply, '', '未回复的条目回复为空串');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
