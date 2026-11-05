/**
 * “我的”页反馈入口：统计缓存、管理按钮与用户已读的页面回归。
 * 运行：node test/feedback-entry.test.js
 */
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

const storage = {};
const appState = { globalData: { statusBarHeight: 20, navBarHeight: 44, membershipDataVersion: 0 } };
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  navigateTo() {},
  stopPullDownRefresh() {},
};
global.getApp = () => appState;

let pageDefinition = null;
global.Page = definition => { pageDefinition = definition; };

const calls = { summary: 0, list: 0, markSeen: [] };
let summaryResponse = {
  success: true,
  isAdmin: true,
  handledUnreadCount: 3,
  adminPendingCount: 7,
};
let listResponse = { success: true, items: [], asOf: new Date('2026-11-03T08:00:00.000Z') };
const apiStub = {
  feedback: {
    entrySummary() {
      calls.summary += 1;
      return Promise.resolve(summaryResponse);
    },
    list() {
      calls.list += 1;
      return Promise.resolve(listResponse);
    },
    markSeen(params) {
      calls.markSeen.push(params);
      return Promise.resolve({ success: true });
    },
  },
  toastError() {},
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === '../../utils/api.js') return apiStub;
  return originalLoad.apply(this, arguments);
};

function loadPage(rel) {
  pageDefinition = null;
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  return pageDefinition;
}

function instantiate(definition) {
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) {
    Object.assign(this.data, patch);
  };
  return page;
}

async function run() {
  const cache = require('../miniprogram/utils/feedback-entry-cache.js');
  const now = Date.now();
  cache.write({ isAdmin: false, handledUnreadCount: 2, adminPendingCount: 0 }, now);
  eq(cache.read(now + 30 * 1000).fresh, true, '入口统计在 1 分钟内复用缓存');
  eq(cache.read(now + cache.TTL_MS).fresh, false, '入口统计缓存到期后重新请求');
  cache.markUserRead();
  eq(cache.read(now).data.handledUnreadCount, 0, '打开我的反馈后本地用户数字立即清零');
  eq(cache.read(now).savedAt, now, '清用户数字不延长统计缓存');

  const profile = instantiate(loadPage('miniprogram/pages/profile/profile.js'));
  delete storage[cache.STORAGE_KEY];
  calls.summary = 0;
  await profile.loadFeedbackEntry.call(profile);
  await profile.loadFeedbackEntry.call(profile);
  eq(calls.summary, 1, '一分钟内重复进入我的页不重复统计');
  eq(profile.data.showFeedbackAdminEntry, true, '管理员显示右对齐反馈管理按钮');
  eq(profile.data.feedbackAdminPendingText, '7', '管理按钮显示待处理数字');
  eq(profile.data.feedbackUnreadText, '3', '帮助与反馈行显示用户未读数字');

  summaryResponse = {
    success: true,
    isAdmin: false,
    handledUnreadCount: 120,
    adminPendingCount: 9,
  };
  profile.applyFeedbackEntry.call(profile, summaryResponse);
  eq(profile.data.showFeedbackAdminEntry, false, '普通用户隐藏反馈管理按钮');
  eq(profile.data.feedbackAdminPendingCount, 0, '普通用户不显示管理端计数');
  eq(profile.data.feedbackUnreadText, '99+', '用户未读数过大时使用 99+');

  const helpFeedback = instantiate(loadPage('miniprogram/pages/help-feedback/help-feedback.js'));
  delete storage[cache.STORAGE_KEY];
  cache.write({ isAdmin: false, handledUnreadCount: 5, adminPendingCount: 0 });
  calls.summary = 0;
  await helpFeedback.loadFeedbackEntry.call(helpFeedback);
  eq(calls.summary, 0, '帮助页复用一分钟内的入口统计缓存');
  eq(helpFeedback.data.feedbackUnreadText, '5', '帮助页的我的反馈行显示未读数字');
  helpFeedback.applyFeedbackEntry.call(helpFeedback, { handledUnreadCount: 120 });
  eq(helpFeedback.data.feedbackUnreadText, '99+', '帮助页未读数过大时使用 99+');

  const myFeedback = instantiate(loadPage('miniprogram/pages/my-feedback/my-feedback.js'));
  delete storage[cache.STORAGE_KEY];
  cache.write({ isAdmin: false, handledUnreadCount: 4, adminPendingCount: 0 });
  calls.markSeen = [];
  await myFeedback.load.call(myFeedback);
  eq(calls.markSeen.length, 1, '我的反馈成功加载后推进一次已读水位');
  eq(calls.markSeen[0].through, listResponse.asOf, '已读水位使用列表 asOf 快照');
  eq(cache.read().data.handledUnreadCount, 0, '加载成功后清掉缓存中的用户数字');

  calls.markSeen = [];
  listResponse = { success: true, items: [] };
  await myFeedback.load.call(myFeedback);
  eq(calls.markSeen.length, 0, '旧接口未返回 asOf 时不误清未读');

  console.log('\n=== 我的反馈：多条回复与奖励通知 ===');
  listResponse = {
    success: true,
    asOf: new Date('2026-11-05T08:00:00.000Z'),
    items: [{
      _id: 'fb_rewarded',
      type: 'feedback',
      category: 'suggestion',
      status: 'PROCESSED',
      content: '建议增加景点筛选',
      replies: [{
        replyId: 'reply_1', content: '已记录', createdAt: new Date('2026-11-04T02:00:00.000Z'),
        updatedAt: new Date('2026-11-04T03:00:00.000Z'), editCount: 1,
      }, {
        replyId: 'reply_2', content: '该建议已上线', createdAt: new Date('2026-11-05T02:00:00.000Z'),
        updatedAt: new Date('2026-11-05T02:00:00.000Z'), editCount: 0,
      }],
      reward: {
        status: 'GRANTED', days: 30, backfill: true,
        grantedAt: new Date('2026-11-05T03:00:00.000Z'),
        memberExpiresAt: new Date('2026-12-05T03:00:00.000Z'),
        updatedAt: new Date('2026-11-05T03:00:00.000Z'),
      },
      createdAt: new Date('2026-11-01T02:00:00.000Z'),
    }],
    rewardNotices: [{
      feedbackId: 'legacy_feedback',
      type: 'correction',
      category: null,
      content: '补发的历史反馈',
      reward: {
        status: 'GRANTED', days: 30, backfill: true,
        grantedAt: new Date('2026-11-05T03:00:00.000Z'),
        memberExpiresAt: new Date('2026-12-05T03:00:00.000Z'),
        updatedAt: new Date('2026-11-05T03:00:00.000Z'),
      },
    }],
  };
  calls.markSeen = [];
  const rewardedPage = instantiate(loadPage('miniprogram/pages/my-feedback/my-feedback.js'));
  const versionBefore = appState.globalData.membershipDataVersion;
  await rewardedPage.load.call(rewardedPage);
  eq(rewardedPage.data.items[0].replies.length, 2, '用户端展示完整回复线程');
  eq(rewardedPage.data.items[0].replies[0].edited, true, '用户端展示已修改标记');
  eq(rewardedPage.data.items[0].reward.backfill, true, '用户端展示补发标记');
  eq(rewardedPage.data.rewardNotices.length, 1, '独立奖励通知可见');
  eq(/补发奖励已到账/.test(rewardedPage.data.rewardNotices[0].title), true, '补发通知标题明确');
  eq(/2026年12月5日/.test(rewardedPage.data.rewardNotices[0].detail), true, '通知展示会员到期日');
  eq(calls.markSeen.length, 1, '看到奖励通知后按列表快照推进已读');
  eq(appState.globalData.membershipDataVersion, versionBefore + 1,
    '新奖励到账后递增会员缓存版本');

  await rewardedPage.load.call(rewardedPage);
  eq(appState.globalData.membershipDataVersion, versionBefore + 1,
    '同一通知重复加载不重复递增版本');

  listResponse.rewardNotices[0].reward.status = 'REVOKED';
  listResponse.rewardNotices[0].reward.updatedAt = new Date('2026-11-06T03:00:00.000Z');
  await rewardedPage.load.call(rewardedPage);
  eq(rewardedPage.data.rewardNotices[0].title, '反馈奖励已撤回', '撤回通知对用户可见');
  eq(appState.globalData.membershipDataVersion, versionBefore + 2,
    '奖励撤回也触发会员缓存刷新');

  Module._load = originalLoad;
  if (fail) {
    console.error(`\n${fail} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll feedback entry tests passed.');
}

run().catch(err => {
  Module._load = originalLoad;
  console.error(err);
  process.exit(1);
});
