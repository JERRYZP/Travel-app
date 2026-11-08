/**
 * 两档会员定价灰度：默认测试、后台全量切换、审计与能力门禁。
 *
 * 运行：node test/membership-pricing.test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./mock-db');
const { COLLECTIONS } = require('../cloudfunctions/payment/lib/schema');
const membership = require('../cloudfunctions/reminder/lib/membership');
const reminderPricing = require('../cloudfunctions/reminder/lib/membership-pricing');
const paymentPricing = require('../cloudfunctions/payment/lib/membership-pricing');

const USER = 'openid_pricing_user';
const TEST_OPENID = 'oZ6IFxvYK1mKzBaehMcOPIl_CgN0';
const ADMIN = 'openid_pricing_admin';
const TWO_TIER = ['unlimited-v3', 'two-tier-v5'];
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

async function run() {
  process.env.MEMBERSHIP_TEST_OPENIDS = TEST_OPENID;
  process.env.MEMBERSHIP_ENFORCEMENT_MODE = 'all';
  process.env.AFTER_SALES_ADMIN_OPENIDS = ADMIN;

  console.log('=== 1. 默认安全回退测试名单 ===');
  const db = createDb();
  db._seed(COLLECTIONS.USERS, [
    { _id: 'user_pricing', openId: USER, memberLevel: 'NORMAL', taskPackCount: 0 },
    { _id: 'user_pricing_test', openId: TEST_OPENID, memberLevel: 'NORMAL', taskPackCount: 0 },
  ]);
  db._seed(COLLECTIONS.PAYMENT_CONFIG, [
    { _id: 'membership_enforcement', mode: 'all', updatedAt: null, updatedBy: '' },
  ]);
  eq(reminderPricing.PRICING_CONFIG_ID, paymentPricing.PRICING_CONFIG_ID,
    'reminder 与 payment 使用同一配置文档');
  eq(reminderPricing.PRICING_CONFIG_ID, 'membership_pricing', '配置文档 ID 固定');
  const fallback = await reminderPricing.read(db);
  eq(fallback.mode, 'test', '配置缺失时默认测试模式');
  eq(fallback.source, 'DEFAULT', '默认回退来源明确');

  const normalStatus = await membership.status(db, USER, undefined, {
    membershipCapabilities: TWO_TIER,
  });
  eq(normalStatus.membership.planVersion, 'unlimited-v3',
    '测试模式下非白名单继续现有 ¥6 契约');
  const testStatus = await membership.status(db, TEST_OPENID, undefined, {
    membershipCapabilities: TWO_TIER,
  });
  eq(testStatus.membership.planVersion, 'two-tier-v5',
    '测试模式下白名单命中两档定价');

  console.log('\n=== 2. 管理员切换全量并审计 ===');
  const userPayment = loadPayment(db, USER);
  const adminPayment = loadPayment(db, ADMIN);
  const denied = await userPayment.main({
    action: 'afterSales.adminSetMembershipPricing',
    mode: 'all',
  });
  eq(denied.errorCode, 1040, '非管理员不能切换两档定价');

  const invalid = await adminPayment.main({
    action: 'afterSales.adminSetMembershipPricing',
    mode: 'invalid',
  });
  eq(invalid.errorCode, 1010, '非法定价模式被拒绝');

  const enabled = await adminPayment.main({
    action: 'afterSales.adminSetMembershipPricing',
    mode: 'all',
  });
  eq(enabled.success, true, '管理员可切换两档定价全量');
  eq(enabled.membershipPricing.mode, 'all', '切换结果返回全量模式');
  const config = db._dump(COLLECTIONS.PAYMENT_CONFIG)
    .find(item => item._id === 'membership_pricing');
  eq(config.mode, 'all', '配置文档写入全量模式');
  const enforcement = db._dump(COLLECTIONS.PAYMENT_CONFIG)
    .find(item => item._id === 'membership_enforcement');
  eq(enforcement && enforcement.mode, 'all', '定价切换不修改会员额度模式');
  const audits = db._dump(COLLECTIONS.ADMIN_AUDIT_LOGS)
    .filter(item => item.action === 'SET_MEMBERSHIP_PRICING');
  eq(audits.length, 1, '切换动作写入管理员审计');
  eq(audits[0].details.mode, 'all', '审计记录目标模式');

  console.log('\n=== 3. 全量配置按客户端能力开放 ===');
  const allStatus = await membership.status(db, USER, undefined, {
    membershipCapabilities: TWO_TIER,
  });
  eq(allStatus.membership.planVersion, 'two-tier-v5',
    '全量后普通新客户端使用两档定价');
  const oldClient = await membership.status(db, USER, undefined, {
    membershipCapabilities: [],
  });
  eq(oldClient.membership.planVersion, 'legacy-v2', '旧客户端继续 legacy 契约');
  const noTwoTier = await membership.status(db, USER, undefined, {
    membershipCapabilities: ['unlimited-v3'],
  });
  eq(noTwoTier.membership.planVersion, 'unlimited-v3',
    '未声明 two-tier-v5 的中间版本继续现有 ¥6 契约');

  const status = await adminPayment.main({ action: 'afterSales.adminStatus' });
  eq(status.membershipPricing.mode, 'all', '工作台状态返回定价模式');
  eq(status.membershipEnforcement.mode, 'all', '工作台中的额度模式保持独立');
  eq(status.membershipPricing.shortDescription, '新客户端全量使用两档定价',
    '工作台返回定价范围说明');

  const switchedTest = await adminPayment.main({
    action: 'afterSales.adminSetMembershipPricing',
    mode: 'test',
  });
  eq(switchedTest.membershipPricing.mode, 'test', '管理员可切回测试模式');
  const testAgain = await membership.status(db, USER, undefined, {
    membershipCapabilities: TWO_TIER,
  });
  eq(testAgain.membership.planVersion, 'unlimited-v3',
    '切回测试后普通用户恢复现有 ¥6 契约');

  console.log('\n=== 4. 配置异常安全回退 ===');
  const brokenDb = createDb({ missingCollections: [COLLECTIONS.PAYMENT_CONFIG] });
  const broken = await reminderPricing.read(brokenDb);
  eq(broken.mode, 'test', '配置读取失败仍只开放测试名单');
  eq(broken.readError, true, '读取失败带显式标记');

  console.log('\n=== 5. 后台控制与客户端接口 ===');
  const root = path.join(__dirname, '..');
  const wxml = fs.readFileSync(
    path.join(root, 'miniprogram/admin/after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  const api = fs.readFileSync(path.join(root, 'miniprogram/utils/api.js'), 'utf8');
  eq(wxml.includes('class="admin-control-card pricing-card"'), true,
    '工作台提供两档定价控制卡');
  eq(wxml.includes('onPricingModeChange'), true, '定价卡使用下拉切换');
  eq(api.includes('afterSales.adminSetMembershipPricing'), true,
    '客户端 API 接入定价切换接口');
  const mock = require('../miniprogram/utils/mock.js');
  const mockBefore = await mock.mockCall('payment', { action: 'afterSales.adminStatus' });
  eq(mockBefore.membershipPricing.mode, 'test', 'mock 工作台默认测试模式');
  const mockEnabled = await mock.mockCall('payment', {
    action: 'afterSales.adminSetMembershipPricing',
    mode: 'all',
  });
  eq(mockEnabled.membershipPricing.mode, 'all', 'mock 支持切到全量模式');

  if (fail > 0) throw new Error(`${fail} membership pricing assertion(s) failed`);
  console.log('\nALL PASS');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
