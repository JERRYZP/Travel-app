/**
 * 会员升级临时公告：白名单隔离、有效期、后台快速下架与客户端分群文案。
 *
 * 运行：node test/membership-upgrade-notice.test.js
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');
const reminderSchema = require('../cloudfunctions/reminder/lib/schema');
const paymentSchema = require('../cloudfunctions/payment/lib/schema');
const membership = require('../cloudfunctions/reminder/lib/membership');
const reminderNotice = require('../cloudfunctions/reminder/lib/membership-upgrade-notice');
const paymentNotice = require('../cloudfunctions/payment/lib/membership-upgrade-notice');

const USER = 'openid_upgrade_notice_user';
const FREE_USER = 'openid_upgrade_notice_free';
const NEW_MEMBER = 'openid_upgrade_notice_new_member';
const LEGACY_USER = 'openid_upgrade_notice_legacy';
const ADMIN = 'openid_upgrade_notice_admin';
const ROOT = path.join(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;
let fail = 0;

function eq(actual, expected, message) {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
}

function seedUser(db, openId, patch = {}) {
  db._seed(reminderSchema.COLLECTIONS.USERS, [{
    _id: `user_${openId}`,
    openId,
    nickname: openId,
    memberLevel: 'NORMAL',
    taskPackCount: 0,
    protectedTaskQuota: 5,
    ...patch,
  }]);
}

function seedNotice(db, patch = {}) {
  const now = Date.now();
  db._seed(paymentSchema.COLLECTIONS.PAYMENT_CONFIG, [{
    _id: reminderNotice.CONFIG_ID,
    noticeId: 'membership-unlimited-upgrade',
    enabled: true,
    startsAt: new Date(now - 60 * 1000),
    endsAt: new Date(now + DAY_MS),
    ...patch,
  }]);
}

function loadPayment(db, openId) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (request === 'wx-server-sdk'
      && parent
      && parent.filename.endsWith(`${path.sep}payment${path.sep}index.js`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        database() { return db; },
        getWXContext() { return { OPENID: openId, SOURCE: 'wx_client' }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/payment/index.js')];
    return require('../cloudfunctions/payment/index.js');
  } finally {
    Module._load = originalLoad;
  }
}

async function testNoticeRules() {
  console.log('=== 1. 公告只对 unlimited-v3 白名单且仅在有效期内可见 ===');
  const now = new Date('2026-11-04T12:00:00+08:00');
  const active = {
    _id: reminderNotice.CONFIG_ID,
    noticeId: 'membership-unlimited-upgrade',
    enabled: true,
    startsAt: new Date('2026-11-04T10:00:00+08:00'),
    endsAt: new Date('2026-11-07T10:00:00+08:00'),
  };
  eq(reminderNotice.CONFIG_ID, paymentNotice.CONFIG_ID, 'reminder / payment 共用同一配置文档');
  eq(reminderNotice.publicViewOf(active, now, {
    newPlan: true,
    member: true,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }).id, 'membership-unlimited-upgrade', '公告前已开通的白名单会员返回公告 ID');
  eq(reminderNotice.publicViewOf(active, now, {
    newPlan: true,
    member: true,
    memberSince: new Date('2026-11-04T11:00:00+08:00'),
  }), null, '公告后新开通会员不返回公告');
  eq(reminderNotice.publicViewOf(active, now, {
    newPlan: true,
    member: true,
  }), null, '缺少会员开通时间时不冒险展示公告');
  eq(reminderNotice.publicViewOf(active, now, {
    newPlan: true,
    member: false,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }),
    null, '白名单免费用户不返回公告');
  eq(reminderNotice.publicViewOf(active, now, {
    newPlan: false,
    member: true,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }),
    null, 'legacy 非白名单永远不返回公告');
  eq(reminderNotice.publicViewOf({ ...active, enabled: false }, now, {
    newPlan: true,
    member: true,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }),
    null, '已下架公告不可见');
  eq(reminderNotice.publicViewOf({
    ...active,
    endsAt: new Date('2026-11-04T11:59:59+08:00'),
  }, now, {
    newPlan: true,
    member: true,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }), null, '过期公告不可见');
  eq(reminderNotice.publicViewOf({
    ...active,
    startsAt: new Date('2026-11-04T12:00:01+08:00'),
  }, now, {
    newPlan: true,
    member: true,
    memberSince: new Date('2026-10-01T10:00:00+08:00'),
  }), null, '未到开始时间不可见');
}

async function testStatusIsolation() {
  console.log('\n=== 2. membership.status 复用白名单并隔离 legacy 响应 ===');
  const originalMode = process.env.MEMBERSHIP_ENFORCEMENT_MODE;
  const originalOpenIds = process.env.MEMBERSHIP_TEST_OPENIDS;
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'test';
  process.env.MEMBERSHIP_TEST_OPENIDS = `${USER},${FREE_USER},${NEW_MEMBER}`;
  const db = createDb();
  seedUser(db, USER, {
    memberLevel: 'MEMBER',
    memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    memberSince: new Date(Date.now() - 10 * DAY_MS),
  });
  seedUser(db, FREE_USER);
  seedUser(db, NEW_MEMBER, {
    memberLevel: 'MEMBER',
    memberExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    memberSince: new Date(),
  });
  seedUser(db, LEGACY_USER);
  seedNotice(db);
  const now = new Date();

  const current = await membership.status(db, USER, now, { includeUpgradeNotice: true });
  eq(current.membership.planVersion, 'unlimited-v3', '白名单用户进入新方案');
  eq(current.upgradeNotice && current.upgradeNotice.id,
    'membership-unlimited-upgrade', '白名单有效会员收到公告');

  const free = await membership.status(db, FREE_USER, now, { includeUpgradeNotice: true });
  eq(free.membership.member, false, '白名单免费用户仍为免费状态');
  eq(Object.prototype.hasOwnProperty.call(free, 'upgradeNotice'), false,
    '白名单免费用户不收到公告');

  const newMember = await membership.status(db, NEW_MEMBER, now, { includeUpgradeNotice: true });
  eq(newMember.membership.member, true, '公告后开通的新会员仍为有效会员');
  eq(Object.prototype.hasOwnProperty.call(newMember, 'upgradeNotice'), false,
    '公告后新开通会员不收到公告');

  const legacy = await membership.status(db, LEGACY_USER, now, { includeUpgradeNotice: true });
  eq(legacy.membership.planVersion, 'legacy-v2', '非白名单继续旧方案');
  eq(Object.prototype.hasOwnProperty.call(legacy, 'upgradeNotice'), false,
    '非白名单响应不增加公告字段');

  await db.collection(reminderSchema.COLLECTIONS.PAYMENT_CONFIG)
    .doc(reminderNotice.CONFIG_ID)
    .update({ data: { enabled: false } });
  reminderNotice.invalidate(db);
  const disabled = await membership.status(db, USER, now, { includeUpgradeNotice: true });
  eq(Object.prototype.hasOwnProperty.call(disabled, 'upgradeNotice'), false,
    '后台下架后服务端立即停止返回公告');

  if (originalMode == null) delete process.env.MEMBERSHIP_ENFORCEMENT_MODE;
  else process.env.MEMBERSHIP_ENFORCEMENT_MODE = originalMode;
  if (originalOpenIds == null) delete process.env.MEMBERSHIP_TEST_OPENIDS;
  else process.env.MEMBERSHIP_TEST_OPENIDS = originalOpenIds;
}

async function testAdminKillSwitch() {
  console.log('\n=== 3. 管理员下架、恢复默认 72 小时与审计 ===');
  const originalAdmin = process.env.AFTER_SALES_ADMIN_OPENIDS;
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;
  const db = createDb();
  seedUser(db, USER);
  seedNotice(db);
  const payment = loadPayment(db, ADMIN);

  const disabled = await payment.main({
    action: 'afterSales.adminSetMembershipUpgradeNotice',
    enabled: false,
  });
  eq(disabled.membershipUpgradeNotice.enabled, false, '管理员可一键下架公告');
  eq(disabled.membershipUpgradeNotice.active, false, '下架后立即失效');
  const audits = db._dump(paymentSchema.COLLECTIONS.ADMIN_AUDIT_LOGS)
    .filter(item => item.action === 'SET_MEMBERSHIP_UPGRADE_NOTICE');
  eq(audits.length, 1, '公告开关写入管理员审计');

  await db.collection(paymentSchema.COLLECTIONS.PAYMENT_CONFIG)
    .doc(paymentNotice.CONFIG_ID)
    .update({ data: { endsAt: new Date(Date.now() - 1000) } });
  const restored = await payment.main({
    action: 'afterSales.adminSetMembershipUpgradeNotice',
    enabled: true,
  });
  const restoredEndsMs = new Date(restored.membershipUpgradeNotice.endsAt).getTime();
  eq(restored.membershipUpgradeNotice.active, true, '过期后恢复立即重新展示');
  eq(restoredEndsMs > Date.now() + 71 * 60 * 60 * 1000, true, '恢复时默认延长 72 小时');

  const denied = await loadPayment(db, USER).main({
    action: 'afterSales.adminSetMembershipUpgradeNotice',
    enabled: false,
  });
  eq(denied.errorCode, 1040, '非管理员不能操作公告开关');

  if (originalAdmin == null) delete process.env.AFTER_SALES_ADMIN_OPENIDS;
  else process.env.AFTER_SALES_ADMIN_OPENIDS = originalAdmin;
}

function profilePageDefinition(storage) {
  const originalGetApp = global.getApp;
  const originalPage = global.Page;
  const originalWx = global.wx;
  let definition = null;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, membershipDataVersion: 0 },
  });
  global.Page = value => { definition = value; };
  global.wx = {
    getStorageSync(key) { return storage[key]; },
    setStorageSync(key, value) { storage[key] = value; },
  };
  delete require.cache[require.resolve('../miniprogram/pages/profile/profile.js')];
  require('../miniprogram/pages/profile/profile.js');
  return {
    definition,
    restore() {
      global.getApp = originalGetApp;
      global.Page = originalPage;
      global.wx = originalWx;
    },
  };
}

async function testProfileCopyAndDismissal() {
  console.log('\n=== 4. “我的”横幅仅会员可见并支持按公告 ID 关闭 ===');
  const storage = {};
  const loaded = profilePageDefinition(storage);
  try {
    const page = loaded.definition;
    const context = {
      data: {},
      setData(patch) { Object.assign(this.data, patch); },
    };
    page.applyMembershipUpgradeNotice.call(context, { id: 'notice-v1' }, {
      planVersion: 'unlimited-v3',
      member: false,
    });
    eq(context.data.membershipUpgradeNotice, null, '非会员不展示升级横幅');

    page.applyMembershipUpgradeNotice.call(context, { id: 'notice-v1' }, {
      planVersion: 'unlimited-v3',
      member: true,
    });
    eq(context.data.membershipUpgradeNotice.title,
      '您的会员权益已升级', '会员横幅使用“您的会员权益已升级”标题');
    eq(context.data.membershipUpgradeNotice.body,
      '您的会员有效期不变，提醒名额已升级为不限', '有效会员文案说明到期时间不变');

    page.onDismissMembershipUpgradeNotice.call(context);
    eq(storage.membershipUpgradeNoticeDismissedV1, 'notice-v1', '关闭状态按公告 ID 持久化');
    eq(context.data.membershipUpgradeNotice, null, '关闭后当前页面立即隐藏');

    page.applyMembershipUpgradeNotice.call(context, { id: 'notice-v1' }, {
      planVersion: 'unlimited-v3',
      member: true,
    });
    eq(context.data.membershipUpgradeNotice, null, '同一公告 ID 不再重复展示');
    page.applyMembershipUpgradeNotice.call(context, { id: 'notice-v2' }, {
      planVersion: 'unlimited-v3',
      member: true,
    });
    eq(context.data.membershipUpgradeNotice.id, 'notice-v2', '新公告 ID 可重新展示');
  } finally {
    loaded.restore();
  }

  const profileWxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/profile/profile.wxml'),
    'utf8'
  );
  eq(profileWxml.includes('onDismissMembershipUpgradeNotice'), true,
    '“我的”模板提供关闭入口');
  eq(profileWxml.includes('不限次数'), false, '横幅不使用“不限次数”口径');
  const sparkle = fs.readFileSync(
    path.join(ROOT, 'miniprogram/images/icons/sparkle.svg'),
    'utf8'
  );
  eq(sparkle.includes('stroke="#B8904A"'), true, '横幅图标使用会员按钮金色');
}

async function testAdminUi() {
  console.log('\n=== 5. 客服工作台提供快速下架入口 ===');
  const wxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  eq(wxml.includes('会员升级公告'), true, '工作台展示公告控制卡');
  eq(wxml.includes('onToggleMembershipUpgradeNotice'), true, '工作台提供公告开关动作');
  eq(wxml.includes('membershipUpgradeNotice.actionText'), true, '按钮文案由展示状态决定');
  const api = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/api.js'), 'utf8');
  eq(api.includes('afterSales.adminSetMembershipUpgradeNotice'), true,
    '客户端 API 已接入公告开关');
}

(async () => {
  await testNoticeRules();
  await testStatusIsolation();
  await testAdminKillSwitch();
  await testProfileCopyAndDismissal();
  await testAdminUi();
  if (fail > 0) {
    console.error(`\n${fail} membership upgrade notice assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll membership upgrade notice tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
