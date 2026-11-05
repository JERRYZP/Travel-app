/**
 * 反馈管理页：分页、筛选参数、回复与就地更新的行为回归。
 *
 * 这一层只能页面测试：Tab → 请求参数的映射、过期响应丢弃、回复后只改目标卡片，
 * 都不在云函数的覆盖范围里。
 * 运行：node test/admin-feedback-ui.test.js
 */

const api = require('../miniprogram/utils/api');

const original = {
  adminList: api.feedback.adminList,
  adminReply: api.feedback.adminReply,
  adminAddReply: api.feedback.adminAddReply,
  adminUpdateReply: api.feedback.adminUpdateReply,
  adminUpdateStatus: api.feedback.adminUpdateStatus,
  rewardStatus: api.payment.feedbackReward.adminStatus,
  rewardGrant: api.payment.feedbackReward.adminGrant,
  rewardRevoke: api.payment.feedbackReward.adminRevoke,
};

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

const clipboard = [];
const toastTitles = [];
const modalAnswers = [];
let modalCount = 0;

let pageDefinition = null;
global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } });
global.Page = definition => { pageDefinition = definition; };
global.wx = {
  showToast(options) { toastTitles.push(options && options.title); },
  setClipboardData(options) { clipboard.push(options && options.data); },
  showModal(options) {
    modalCount += 1;
    const confirm = modalAnswers.length ? modalAnswers.shift() : true;
    if (options && options.success) options.success({ confirm, cancel: !confirm });
  },
  navigateBack() {},
  stopPullDownRefresh() {},
};

require('../miniprogram/admin/feedback/feedback');

function rawItem(overrides = {}) {
  return {
    _id: 'f1',
    type: 'feedback',
    category: 'suggestion',
    spotId: null,
    spotName: null,
    errorType: null,
    content: '希望支持多城市',
    contact: '',
    status: 'OPEN',
    adminReply: '',
    adminReplyAt: null,
    adminReplyBy: null,
    replies: [],
    reward: {
      status: 'NONE', days: 0, backfill: false, grantedAt: null, revokedAt: null, memberExpiresAt: null,
    },
    createdAt: new Date('2026-11-01T02:00:00.000Z'),
    userId: 'openid_a',
    user: { openId: 'openid_a', nickname: '小赵', avatarUrl: '' },
    ...overrides,
  };
}

function pageOf(items, overrides = {}) {
  return {
    success: true,
    items,
    count: items.length,
    total: items.length,
    page: 1,
    pageSize: 20,
    hasMore: false,
    ...overrides,
  };
}

const PAGE_METHODS = [
  'load', 'loadRewardPermission', 'decorate', 'onFilter', 'onLoadMore', 'onRetry', 'onMark',
  'onReplyStart', 'onReplyEdit', 'onReplyInput', 'onReplyCancel', 'onReplySubmit', 'onCopyText',
  'onGrantReward', 'onRevokeReward',
];

function context() {
  const ctx = {
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch) { Object.assign(this.data, patch); },
    _listRequestSeq: 0,
  };
  for (const method of PAGE_METHODS) ctx[method] = pageDefinition[method];
  return ctx;
}

async function run() {
  console.log('=== 1. 初始加载 ===');
  let calls = [];
  let ctx = context();
  api.feedback.adminList = params => {
    calls.push(params);
    return Promise.resolve(pageOf([rawItem(), rawItem({
      _id: 'f2',
      status: 'PROCESSED',
      content: '已处理过的一条',
      adminReply: '收到，下版本处理',
      adminReplyAt: new Date('2026-11-01T03:00:00.000Z'),
    })], { total: 30, hasMore: true }));
  };
  await ctx.load();
  eq(JSON.stringify(calls[0]), JSON.stringify({ page: 1, pageSize: 20 }), '全部 Tab 只带分页参数，不带空的筛选键');
  eq(ctx.data.items.length, 2, '渲染 2 条');
  eq(ctx.data.hasMore, true, 'hasMore 取自服务端');
  eq(ctx.data.items[0].nickname, '小赵', '展示昵称');
  eq(ctx.data.items[0].openId, 'openid_a', '展示完整 OpenID');
  eq(ctx.data.items[1].hasReply, true, '有回复时打「已回复」标记');
  eq(ctx.data.items[1].adminReply, '收到，下版本处理', '回复正文透传');
  eq(ctx.data.items[1].replyTime !== '', true, '回复时间已格式化为北京时间');
  eq(ctx.data.items[0].time, '11月1日 10:00', '提交时间按北京时间展示，不用设备时区');

  console.log('\n=== 2. 筛选 Tab 的参数映射 ===');
  const tabCases = [
    ['suggestion', { category: 'suggestion', page: 1, pageSize: 20 }],
    ['bug', { category: 'bug', page: 1, pageSize: 20 }],
    ['correction', { type: 'correction', page: 1, pageSize: 20 }],
    ['all', { page: 1, pageSize: 20 }],
  ];
  for (const [key, expected] of tabCases) {
    calls = [];
    pageDefinition.onFilter.call(ctx, { currentTarget: { dataset: { key } } });
    await new Promise(resolve => setImmediate(resolve));
    eq(JSON.stringify(calls[0]), JSON.stringify(expected), `${key} Tab 请求参数`);
  }
  eq(ctx.data.activeFilter, 'all', '回到全部 Tab');
  const beforeRepeat = calls.length;
  pageDefinition.onFilter.call(ctx, { currentTarget: { dataset: { key: 'all' } } });
  eq(calls.length, beforeRepeat, '重复点击当前 Tab 不重新请求');

  console.log('\n=== 3. 加载更多 ===');
  calls = [];
  api.feedback.adminList = params => {
    calls.push(params);
    return Promise.resolve(params.page === 1
      ? pageOf([rawItem({ _id: 'a1' })], { hasMore: true })
      : pageOf([rawItem({ _id: 'a2' })], { page: 2, hasMore: false }));
  };
  ctx = context();
  await ctx.load();
  eq(ctx.data.items.length, 1, '第一页 1 条');
  await ctx.onLoadMore();
  eq(calls[1].page, 2, '加载更多请求第 2 页');
  eq(ctx.data.items.length, 2, '第二页拼在末尾');
  eq(ctx.data.items[1].id, 'a2', '追加顺序正确');
  eq(ctx.data.hasMore, false, '最后一页 hasMore=false');

  await ctx.onLoadMore();
  eq(calls.length, 2, '没有更多时不再请求');

  // 加载中重复点击不叠加请求
  calls = [];
  let releaseFirst;
  api.feedback.adminList = params => {
    calls.push(params);
    return new Promise(resolve => { releaseFirst = resolve; });
  };
  ctx = context();
  const pending = ctx.load();
  await ctx.onLoadMore();
  eq(calls.length, 1, '加载中点击加载更多不发请求');
  releaseFirst(pageOf([rawItem()], { hasMore: false }));
  await pending;

  console.log('\n=== 4. 过期响应丢弃 ===');
  const pendingResolvers = [];
  api.feedback.adminList = () => new Promise(resolve => pendingResolvers.push(resolve));
  ctx = context();
  const staleRequest = ctx.load();                                  // seq 1
  pageDefinition.onFilter.call(ctx, { currentTarget: { dataset: { key: 'bug' } } }); // seq 3
  await new Promise(resolve => setImmediate(resolve));
  pendingResolvers[0](pageOf([rawItem({ _id: 'stale', content: '过期结果' })]));
  pendingResolvers[1](pageOf([rawItem({ _id: 'fresh', content: '新结果' })]));
  await staleRequest;
  await new Promise(resolve => setImmediate(resolve));
  eq(ctx.data.items[0].id, 'fresh', '先发的慢响应不会覆盖后发的结果');
  eq(ctx.data.items.length, 1, '只保留新结果');

  console.log('\n=== 5. 无权限与网络失败要分开 ===');
  api.feedback.adminList = () => Promise.reject({ errorCode: 1040, error: '无权限' });
  ctx = context();
  await ctx.load();
  eq(ctx.data.forbidden, true, '1040 进无权限态');
  eq(ctx.data.loadFailed, false, '1040 不算加载失败');

  api.feedback.adminList = () => Promise.reject({ errMsg: 'cloud.callFunction:fail' });
  ctx = context();
  await ctx.load();
  eq(ctx.data.loadFailed, true, '网络错误进加载失败态');
  eq(ctx.data.forbidden, false, '网络错误不冒充无权限');
  eq(ctx.data.items.length, 0, '失败时清空列表');

  console.log('\n=== 6. 多条回复、追加与指定回复修改 ===');
  const addCalls = [];
  const editCalls = [];
  api.feedback.adminAddReply = params => {
    addCalls.push(params);
    return Promise.resolve({
      success: true,
      replies: [{
        replyId: 'legacy', content: '旧回复', createdAt: new Date('2026-11-01T03:00:00.000Z'),
        updatedAt: new Date('2026-11-01T03:00:00.000Z'), editCount: 0,
      }, {
        replyId: 'new-1', content: params.reply, createdAt: new Date('2026-11-02T06:00:00.000Z'),
        updatedAt: new Date('2026-11-02T06:00:00.000Z'), editCount: 0,
      }],
      adminReply: '谢谢反馈',
      adminReplyAt: new Date('2026-11-02T06:00:00.000Z'),
      status: 'PROCESSED',
    });
  };
  api.feedback.adminUpdateReply = params => {
    editCalls.push(params);
    return Promise.resolve({
      success: true,
      replies: [{
        replyId: params.replyId, content: params.reply, createdAt: new Date('2026-11-01T03:00:00.000Z'),
        updatedAt: new Date('2026-11-03T06:00:00.000Z'), editCount: 1,
      }, {
        replyId: 'second', content: '后一条回复', createdAt: new Date('2026-11-02T06:00:00.000Z'),
        updatedAt: new Date('2026-11-02T06:00:00.000Z'), editCount: 0,
      }],
      adminReply: '后一条回复',
      adminReplyAt: new Date('2026-11-02T06:00:00.000Z'),
      status: 'PROCESSED',
    });
  };
  api.feedback.adminList = () => Promise.resolve(pageOf([
    rawItem({
      _id: 'r1',
      replies: [{
        replyId: 'first', content: '旧回复', createdAt: new Date('2026-11-01T03:00:00.000Z'),
        updatedAt: new Date('2026-11-01T03:00:00.000Z'), editCount: 0,
      }, {
        replyId: 'second', content: '后一条回复', createdAt: new Date('2026-11-02T03:00:00.000Z'),
        updatedAt: new Date('2026-11-02T03:00:00.000Z'), editCount: 0,
      }],
    }),
    rawItem({ _id: 'r2' }),
  ]));
  ctx = context();
  await ctx.load();
  const olderItem = ctx.data.items[0];

  pageDefinition.onReplyStart.call(ctx, { currentTarget: { dataset: { id: 'r1' } } });
  eq(ctx.data.replyId, 'r1', '打开对应卡片的编辑器');
  eq(ctx.data.replyMode, 'add', '默认进入追加回复模式');
  eq(ctx.data.replyDraft, '', '追加回复不复用旧正文');
  eq(ctx.data.replyCanSend, false, '空的新回复不能发送');

  pageDefinition.onReplyEdit.call(ctx, { currentTarget: { dataset: { id: 'r1', replyId: 'first' } } });
  eq(ctx.data.replyMode, 'edit', '点击单条回复进入修改模式');
  eq(ctx.data.editingReplyId, 'first', '修改目标为指定 replyId');
  eq(ctx.data.replyDraft, '旧回复', '修改时预填目标回复');
  eq(ctx.data.replyCanSend, true, '预填内容可保存');
  pageDefinition.onReplyCancel.call(ctx);

  pageDefinition.onReplyStart.call(ctx, { currentTarget: { dataset: { id: 'r2' } } });
  eq(ctx.data.replyId, 'r2', '同一时间只开一个编辑器');
  eq(ctx.data.replyDraft, '', '没有回复的条目草稿为空');
  eq(ctx.data.replyCanSend, false, '空草稿不能发送');

  pageDefinition.onReplyInput.call(ctx, { detail: { value: '   ' } });
  eq(ctx.data.replyCanSend, false, '纯空白不能发送');
  pageDefinition.onReplySubmit.call(ctx);
  eq(addCalls.length, 0, '不能发送时不发请求');

  pageDefinition.onReplyInput.call(ctx, { detail: { value: '  谢谢反馈  ' } });
  eq(ctx.data.replyCanSend, true, '有内容可发送');
  await pageDefinition.onReplySubmit.call(ctx);
  eq(addCalls.length, 1, '追加回复发送一次请求');
  eq(addCalls[0].id, 'r2', '发给当前编辑的条目');
  eq(addCalls[0].reply, '谢谢反馈', '提交前 trim');
  eq(ctx.data.replyId, '', '发送成功后收起编辑器');
  eq(ctx.data.replyDraft, '', '发送成功后清空草稿');

  const updated = ctx.data.items.find(i => i.id === 'r2');
  eq(updated.replies.length, 2, '目标卡片显示完整回复线程');
  eq(updated.replies[1].content, '谢谢反馈', '新回复追加在线程末尾');
  eq(updated.hasReply, true, '目标卡片打上已回复标记');
  eq(updated.status, 'PROCESSED', '回复后状态同步为已处理');
  eq(updated.statusLabel, '已处理', '状态文案同步');
  eq(ctx.data.items[0] === olderItem, true, '未涉及的条目对象引用不变');

  const beforeEditItem = ctx.data.items.find(i => i.id === 'r1');
  pageDefinition.onReplyEdit.call(ctx, {
    currentTarget: { dataset: { id: 'r1', replyId: 'first' } },
  });
  pageDefinition.onReplyInput.call(ctx, { detail: { value: '旧回复（修订）' } });
  await pageDefinition.onReplySubmit.call(ctx);
  eq(editCalls.length, 1, '修改回复只调用 updateReply');
  eq(editCalls[0].id, 'r1', '修改请求带反馈 id');
  eq(editCalls[0].replyId, 'first', '修改请求带指定 replyId');
  eq(editCalls[0].reply, '旧回复（修订）', '修改正文已 trim');
  const editedItem = ctx.data.items.find(i => i.id === 'r1');
  eq(editedItem.replies[0].edited, true, '被修改的回复显示已修改');
  eq(editedItem.replies[0].content, '旧回复（修订）', '被修改回复就地更新');
  eq(editedItem.replies[1].content, '后一条回复', '其他回复保持不变');
  eq(editedItem.adminReply, '后一条回复', '旧镜像正文仍指向最新回复');
  eq(editedItem !== beforeEditItem, true, '修改后列表使用新对象');

  console.log('\n=== 7. 复制 OpenID 与状态流转 ===');
  clipboard.length = 0;
  pageDefinition.onCopyText.call(ctx, { currentTarget: { dataset: { value: 'openid_a' } } });
  eq(clipboard[0], 'openid_a', '复制的是完整 OpenID');

  const statusCalls = [];
  api.feedback.adminUpdateStatus = params => {
    statusCalls.push(params);
    return Promise.resolve({ success: true, updated: 1 });
  };
  const beforeMark = ctx.data.items;
  pageDefinition.onMark.call(ctx, { currentTarget: { dataset: { id: 'r1', status: 'IGNORED' } } });
  await new Promise(resolve => setImmediate(resolve));
  eq(statusCalls[0].status, 'IGNORED', '状态流转请求正确');
  eq(ctx.data.items.find(i => i.id === 'r1').statusCls, 'ignored', '目标卡片状态样式更新');
  eq(ctx.data.items !== beforeMark, true, '列表使用新数组引用');
  eq(ctx.data.items.find(i => i.id === 'r2').status, 'PROCESSED', '其他条目状态不受影响');

  console.log('\n=== 8. 奖励权限、赠送与撤回 ===');
  api.payment.feedbackReward.adminStatus = () => Promise.resolve({ success: true, isAdmin: true });
  await ctx.loadRewardPermission();
  eq(ctx.data.canReward, true, '客服管理员同时获得奖励操作权限');

  const grantCalls = [];
  modalAnswers.push(true, true);
  modalCount = 0;
  api.payment.feedbackReward.adminGrant = id => {
    grantCalls.push(id);
    return Promise.resolve({
      success: true,
      feedbackId: id,
      reward: {
        status: 'GRANTED', days: 30, backfill: true,
        grantedAt: new Date('2026-11-04T03:00:00.000Z'),
        revokedAt: null, memberExpiresAt: new Date('2026-12-04T03:00:00.000Z'),
      },
    });
  };
  await pageDefinition.onGrantReward.call(ctx, { currentTarget: { dataset: { id: 'r1' } } });
  eq(grantCalls[0], 'r1', '赠送请求带反馈 id');
  eq(modalCount, 2, '赠送需要连续两次确认');
  eq(ctx.data.items.find(i => i.id === 'r1').reward.status, 'GRANTED', '赠送后就地更新奖励状态');
  eq(ctx.data.items.find(i => i.id === 'r1').reward.backfill, true, '历史反馈显示补发');

  const revokeCalls = [];
  modalAnswers.push(true, true);
  modalCount = 0;
  api.payment.feedbackReward.adminRevoke = id => {
    revokeCalls.push(id);
    return Promise.resolve({
      success: true,
      feedbackId: id,
      reward: {
        status: 'REVOKED', days: 30, backfill: true,
        grantedAt: new Date('2026-11-04T03:00:00.000Z'),
        revokedAt: new Date('2026-11-05T03:00:00.000Z'),
        memberExpiresAt: new Date('2026-11-05T03:00:00.000Z'),
      },
    });
  };
  await pageDefinition.onRevokeReward.call(ctx, { currentTarget: { dataset: { id: 'r1' } } });
  eq(revokeCalls[0], 'r1', '撤回请求带反馈 id');
  eq(modalCount, 2, '撤回需要连续两次确认');
  eq(ctx.data.items.find(i => i.id === 'r1').reward.status, 'REVOKED', '撤回后就地更新状态');

  api.feedback.adminList = original.adminList;
  api.feedback.adminReply = original.adminReply;
  api.feedback.adminAddReply = original.adminAddReply;
  api.feedback.adminUpdateReply = original.adminUpdateReply;
  api.feedback.adminUpdateStatus = original.adminUpdateStatus;
  api.payment.feedbackReward.adminStatus = original.rewardStatus;
  api.payment.feedbackReward.adminGrant = original.rewardGrant;
  api.payment.feedbackReward.adminRevoke = original.rewardRevoke;

  if (fail) {
    console.error(`\n${fail} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll admin feedback UI tests passed.');
}

run().catch(err => {
  api.feedback.adminList = original.adminList;
  api.feedback.adminReply = original.adminReply;
  api.feedback.adminAddReply = original.adminAddReply;
  api.feedback.adminUpdateReply = original.adminUpdateReply;
  api.feedback.adminUpdateStatus = original.adminUpdateStatus;
  api.payment.feedbackReward.adminStatus = original.rewardStatus;
  api.payment.feedbackReward.adminGrant = original.rewardGrant;
  api.payment.feedbackReward.adminRevoke = original.rewardRevoke;
  console.error(err);
  process.exit(1);
});
