/**
 * 会员限制模式后台切换：配置真身、迁移闸门、服务端鉴权、即时生效与审计。
 *
 * 运行：node test/membership-enforcement.test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/payment/lib/schema');
const membership = require('../cloudfunctions/reminder/lib/membership');
const reminderEnforcement = require('../cloudfunctions/reminder/lib/membership-enforcement');
const paymentEnforcement = require('../cloudfunctions/payment/lib/membership-enforcement');
const {
  MIGRATION_MARKER_CASE_ID,
  MIGRATION_COMPLETE_ACTION,
  ENTITLEMENT_MIGRATION_MARKER_CASE_ID,
  ENTITLEMENT_MIGRATION_COMPLETE_ACTION,
} = require('../cloudfunctions/payment/lib/migration');

const USER = 'openid_enforcement_user';
const TEST_OPENID = 'oZ6IFxvYK1mKzBaehMcOPIl_CgN0';
const ADMIN = 'openid_enforcement_admin';
let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

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

async function addMigrationMarkers(db) {
  await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: ADMIN,
      action: MIGRATION_COMPLETE_ACTION,
      caseId: MIGRATION_MARKER_CASE_ID,
      details: {},
      createdAt: new Date(),
    },
  });
  await db.collection(COLLECTIONS.ADMIN_AUDIT_LOGS).add({
    data: {
      adminOpenId: ADMIN,
      action: ENTITLEMENT_MIGRATION_COMPLETE_ACTION,
      caseId: ENTITLEMENT_MIGRATION_MARKER_CASE_ID,
      details: {},
      createdAt: new Date(),
    },
  });
}

async function run() {
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'test';
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;

  console.log('=== 1. 同一配置真身与环境变量兜底 ===');
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_enforcement',
    openId: USER,
    nickname: '限制模式测试用户',
    memberLevel: 'NORMAL',
  }]);
  eq(
    reminderEnforcement.ENFORCEMENT_CONFIG_ID,
    paymentEnforcement.ENFORCEMENT_CONFIG_ID,
    'reminder 与 payment 使用同一配置文档'
  );
  eq(reminderEnforcement.ENFORCEMENT_CONFIG_ID, 'membership_enforcement', '配置文档 ID 固定');
  const fallback = await reminderEnforcement.read(db);
  eq(fallback.mode, 'test', '配置缺失时 reminder 回退环境变量');
  eq(fallback.source, 'ENV', '回退来源明确标记为环境变量');
  const missingAdmin = paymentEnforcement.adminView(await paymentEnforcement.read(db));
  eq(missingAdmin.mode, '', '后台不猜测配置缺失时的运行模式');
  eq(missingAdmin.description.includes('环境变量'), true, '后台提示当前由环境变量兜底');

  const brokenDb = createDb({ missingCollections: [COLLECTIONS.PAYMENT_CONFIG] });
  const broken = await reminderEnforcement.read(brokenDb);
  eq(broken.mode, 'test', '配置读取失败时 reminder 继续使用环境变量');
  eq(broken.readError, true, '读取失败带显式标记');

  console.log('\n=== 2. 后台鉴权、迁移闸门与审计 ===');
  const userPayment = loadPayment(db, USER);
  const adminPayment = loadPayment(db, ADMIN);
  const denied = await userPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'all',
  });
  eq(denied.errorCode, 1040, '非管理员不能切换会员限制');
  const blocked = await adminPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'all',
  });
  eq(blocked.errorCode, 1033, '迁移完成前不能切全量');
  eq(db._dump(COLLECTIONS.PAYMENT_CONFIG).length, 0, '被拦截的切换不写配置');

  await addMigrationMarkers(db);
  const enabled = await adminPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'all',
  });
  eq(enabled.success, true, '迁移完成后管理员可切全量');
  eq(enabled.membershipEnforcement.mode, 'all', '切换结果返回新模式');
  const status = await adminPayment.main({ action: 'afterSales.adminStatus' });
  eq(status.membershipEnforcement.mode, 'all', '工作台状态返回当前限制模式');
  eq(status.entitlementMigrationCompleted, true, '工作台返回权益账本迁移状态');
  const audits = db._dump(COLLECTIONS.ADMIN_AUDIT_LOGS)
    .filter(item => item.action === 'SET_MEMBERSHIP_ENFORCEMENT');
  eq(audits.length, 1, '切换动作写入管理员审计');
  eq(audits[0].details.mode, 'all', '审计记录新模式');
  eq(audits[0].details.previousMode, '', '审计记录切换前为环境变量兜底');

  console.log('\n=== 3. 即时生效与任务池别 ===');
  const allState = await reminderEnforcement.read(db);
  eq(allState.mode, 'all', 'reminder 立即读到后台全量模式');
  eq(allState.source, 'DB', '生效来源为后台配置');
  eq(
    membership.newTaskQuotaPoolOf(USER, allState),
    membership.TASK_QUOTA_POOL.ENTITLEMENT,
    '全量模式的新任务进入新增池'
  );
  const allStatus = await membership.status(db, USER);
  eq(allStatus.enforced, true, '普通用户在全部模式受限制');

  const switchedTest = await adminPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'test',
  });
  eq(switchedTest.membershipEnforcement.mode, 'test', '管理员可切回测试模式');
  const testState = await reminderEnforcement.read(db);
  eq(
    membership.newTaskQuotaPoolOf(USER, testState),
    membership.TASK_QUOTA_POOL.PROTECTED,
    '测试模式非白名单用户进入保护池'
  );
  eq(
    membership.newTaskQuotaPoolOf(TEST_OPENID, testState),
    membership.TASK_QUOTA_POOL.ENTITLEMENT,
    '测试模式白名单用户进入新增池'
  );

  const switchedOff = await adminPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'off',
  });
  eq(switchedOff.membershipEnforcement.mode, 'off', '管理员可关闭会员限制');
  const offStatus = await membership.status(db, USER);
  eq(offStatus.enforced, false, '关闭模式对所有用户停用名额闸门');
  const invalid = await adminPayment.main({
    action: 'afterSales.adminSetMembershipEnforcement',
    mode: 'invalid',
  });
  eq(invalid.errorCode, 1010, '非法模式被服务端拒绝');

  console.log('\n=== 4. 工作台保留购买开关在顶部 ===');
  const root = path.join(__dirname, '..');
  const wxml = fs.readFileSync(
    path.join(root, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  eq(
    wxml.indexOf('class="sales-card') < wxml.indexOf('class="enforcement-card'),
    true,
    '会员购买开关仍在会员限制控制上方'
  );
  eq(wxml.includes('onEnforcementModeTap'), true, '工作台提供限制模式切换入口');
  const api = fs.readFileSync(path.join(root, 'miniprogram/utils/api.js'), 'utf8');
  eq(
    api.includes('afterSales.adminSetMembershipEnforcement'),
    true,
    '客户端 API 已接入后台切换接口'
  );

  if (fail > 0) {
    console.error(`\n${fail} membership enforcement assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll membership enforcement tests passed.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
