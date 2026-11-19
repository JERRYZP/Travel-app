/**
 * 用户自助注销：预检、阻塞项、数据删除、交易匿名化和再次进入空账户。
 */
const assert = require('assert');
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-db');

const USER = 'openid_account_erasure_001';
const OTHER = 'openid_account_erasure_002';
const CURRENT_DB = createDb();
const deletedFiles = [];
let currentOpenId = USER;
const origLoad = Module._load;

Module._load = function (request) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
      getWXContext() { return { OPENID: currentOpenId }; },
      deleteFile({ fileList }) {
        deletedFiles.push(...fileList);
        return Promise.resolve({ fileList: fileList.map(fileID => ({ fileID, status: 0 })) });
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const account = require('../cloudfunctions/account/index.js');
const accountSchema = require('../cloudfunctions/account/lib/schema.js');
const reminderUser = require('../cloudfunctions/reminder/lib/user.js');
const paymentSchema = require('../cloudfunctions/payment/lib/schema.js');
const paymentAfterSales = require('../cloudfunctions/payment/lib/after-sales.js');
Module._load = origLoad;

function reset() {
  CURRENT_DB._reset();
  deletedFiles.length = 0;
  currentOpenId = USER;
}

function seedUser(id = USER, extra = {}) {
  CURRENT_DB._seed('users', [{
    _id: id,
    openId: id,
    nickname: extra.nickname || '注销测试用户',
    avatarUrl: extra.avatarUrl || '/images/avatars/default-1.png',
    phone: extra.phone || '',
    memberExpiresAt: extra.memberExpiresAt || null,
    createdAt: new Date(),
  }]);
}

async function testMirroredStatuses() {
  assert.strictEqual(accountSchema.OrderStatus.PENDING, paymentSchema.OrderStatus.PENDING);
  assert.strictEqual(accountSchema.GrantStatus.GRANTED, paymentSchema.GrantStatus.GRANTED);
  assert.strictEqual(accountSchema.RefundStatus.PROCESSING, paymentSchema.RefundStatus.PROCESSING);
  assert.deepStrictEqual(
    [...accountSchema.ACTIVE_CASE_STATUSES].sort(),
    [...paymentAfterSales.ACTIVE_CASE_STATUSES].sort(),
    'account 注销阻塞状态必须与 payment 售后真身一致'
  );
}

async function testBlockers() {
  reset();
  seedUser();
  CURRENT_DB._seed('orders', [{
    _id: 'order_pending', userId: USER, status: 'PENDING', createdAt: new Date(),
  }]);
  let res = await account.main({ action: 'account.preflight' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.canErase, false);
  assert.ok(res.blockers.some(item => item.code === 'PAYMENT_PENDING'));

  reset();
  seedUser();
  CURRENT_DB._seed('orders', [{
    _id: 'order_closed_recent', userId: USER, status: 'CLOSED', closedAt: new Date(),
  }]);
  res = await account.main({ action: 'account.preflight' });
  assert.ok(res.blockers.some(item => item.code === 'PAYMENT_RECONCILING'));

  reset();
  seedUser();
  CURRENT_DB._seed('orders', [{
    _id: 'order_unresolved', userId: USER, status: 'PAID', grantStatus: null,
  }]);
  res = await account.main({ action: 'account.preflight' });
  assert.ok(res.blockers.some(item => item.code === 'ENTITLEMENT_UNRESOLVED'));

  reset();
  seedUser();
  CURRENT_DB._seed('after_sales_cases', [{
    _id: 'case_active', userId: USER, status: 'UNDER_REVIEW', orderId: 'o1',
  }]);
  res = await account.main({ action: 'account.preflight' });
  assert.ok(res.blockers.some(item => item.code === 'AFTER_SALES_ACTIVE'));

  reset();
  seedUser(USER, { memberExpiresAt: new Date(Date.now() + 10 * 86400000) });
  res = await account.main({ action: 'account.preflight' });
  assert.strictEqual(res.canErase, true, '有效会员不阻断注销');
  assert.strictEqual(res.summary.membershipActive, true);
  assert.ok(res.summary.memberExpiresAtText);

  const denied = await account.main({ action: 'account.erase' });
  assert.strictEqual(denied.success, false);
  assert.strictEqual(denied.errorCode, accountSchema.ERRORS.ERASURE_CONFIRM_REQUIRED.code);
}

async function testSuccessfulErase() {
  reset();
  seedUser(USER, {
    nickname: '原始昵称',
    phone: '13800138000',
    avatarUrl: 'cloud://test/avatars/account-owner.png',
    memberExpiresAt: new Date(Date.now() + 5 * 86400000),
  });
  seedUser(OTHER);
  CURRENT_DB._seed('trips', [
    { _id: 'trip_owner', userId: USER, city: '北京' },
    { _id: 'trip_other', userId: OTHER, city: '北京' },
  ]);
  CURRENT_DB._seed('trip_items', [
    { _id: 'item_owner', userId: USER, tripId: 'trip_owner', spotId: 'gugong' },
    { _id: 'item_other', userId: OTHER, tripId: 'trip_other', spotId: 'gugong' },
  ]);
  CURRENT_DB._seed('reminder_tasks', [
    { _id: 'task_owner', userId: USER, backendStatus: 'WAITING' },
    { _id: 'task_other', userId: OTHER, backendStatus: 'WAITING' },
  ]);
  CURRENT_DB._seed('reminder_cart', [{ _id: 'cart_owner', userId: USER, spotId: 'gugong' }]);
  CURRENT_DB._seed('search_history', [{ _id: 'search_owner', userId: USER, keyword: '故宫' }]);
  CURRENT_DB._seed('feedbacks', [{
    _id: 'feedback_owner', userId: USER, content: '含个人信息的反馈', handledAt: new Date(),
  }]);
  CURRENT_DB._seed('rewarded_ad_attempts', [{ _id: 'ad_owner', userId: USER, status: 'CLAIMED' }]);
  CURRENT_DB._seed('reminder_events', [
    { _id: 'event_owner', userId: USER, eventType: 'TASK_CREATED' },
    { _id: 'event_other', userId: OTHER, eventType: 'TASK_CREATED' },
  ]);
  const runtimeId = account._internal.userRuntimeIdOf(USER);
  CURRENT_DB._seed('user_runtime', [{ _id: runtimeId, userId: USER, sources: {} }]);
  CURRENT_DB._seed('orders', [{
    _id: 'order_owner',
    userId: USER,
    userDocumentId: USER,
    outTradeNo: 'TACCOUNT001',
    transactionId: 'WX001',
    amountFen: 490,
    status: 'PAID',
    grantStatus: 'GRANTED',
    refundStatus: 'NONE',
    accountDeleted: false,
  }, {
    _id: 'order_other',
    userId: OTHER,
    outTradeNo: 'TOTHER001',
    amountFen: 300,
    status: 'PAID',
    grantStatus: 'GRANTED',
  }]);
  CURRENT_DB._seed('after_sales_cases', [{
    _id: 'case_owner',
    caseNo: 'ASOWNER001',
    userId: USER,
    orderId: 'order_owner',
    outTradeNo: 'TACCOUNT001',
    amountFen: 490,
    status: 'REFUNDED',
    refundStatus: 'REFUNDED',
    requestIdHash: 'contains-user-id',
    description: '用户填写的联系人 13800138000',
    evidence: { user: { phone: '13800138000' }, eligibility: { eligible: true } },
    createdAt: new Date(),
  }]);
  CURRENT_DB._seed('admin_audit_logs', [{
    _id: 'audit_owner',
    targetType: 'user',
    targetId: USER,
    action: 'VIEW_SENSITIVE',
  }]);

  let res = await account.main({ action: 'account.preflight' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.canErase, true);
  assert.strictEqual(res.summary.tripCount, 1);
  assert.strictEqual(res.summary.membershipActive, true);

  res = await account.main({
    action: 'account.erase',
    confirmation: accountSchema.CONFIRMATION,
  });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.counts.trips, 1);
  assert.strictEqual(res.counts.reminderTasks, 1);
  assert.strictEqual(res.counts.profiles, 1);
  assert.strictEqual(res.counts.avatarFiles, 1);
  assert.deepStrictEqual(deletedFiles, ['cloud://test/avatars/account-owner.png']);

  assert.strictEqual(CURRENT_DB._size('trips'), 1);
  assert.strictEqual(CURRENT_DB._size('trip_items'), 1);
  assert.strictEqual(CURRENT_DB._size('reminder_tasks'), 1);
  assert.strictEqual(CURRENT_DB._size('users'), 1);
  assert.strictEqual(CURRENT_DB._size('feedbacks'), 0);
  assert.strictEqual(CURRENT_DB._size('user_runtime'), 0);
  assert.ok(CURRENT_DB._dump('trips').every(row => row.userId === OTHER));
  assert.ok(CURRENT_DB._dump('reminder_tasks').every(row => row.userId === OTHER));

  const order = CURRENT_DB._dump('orders').find(row => row._id === 'order_owner');
  assert.strictEqual(order.userId, '');
  assert.strictEqual(order.accountDeleted, true);
  assert.ok(order.erasedAccountRef.startsWith('erased_'));
  assert.strictEqual(order.outTradeNo, 'TACCOUNT001');
  assert.strictEqual(order.amountFen, 490);
  assert.ok(!JSON.stringify(order).includes(USER));

  const afterSales = CURRENT_DB._dump('after_sales_cases').find(row => row._id === 'case_owner');
  assert.strictEqual(afterSales.userId, '');
  assert.strictEqual(afterSales.requestIdHash, '');
  assert.strictEqual(afterSales.description, '');
  assert.deepStrictEqual(afterSales.evidence, { eligibility: { eligible: true } });
  assert.ok(!JSON.stringify(afterSales).includes(USER));

  const audit = CURRENT_DB._dump('admin_audit_logs').find(row => row._id === 'audit_owner');
  assert.strictEqual(audit.targetId, order.erasedAccountRef);
  assert.ok(CURRENT_DB._dump('admin_audit_logs').some(row =>
    row.targetType === 'account_erasure'
    && row.action === 'ACCOUNT_ERASURE'
    && !JSON.stringify(row.details).includes(USER)));

  const oldOrders = await CURRENT_DB.collection('orders').where({ userId: USER }).get();
  assert.strictEqual(oldOrders.data.length, 0, '旧 OpenID 无法查询已注销订单');

  const blank = await reminderUser.ensureUser(CURRENT_DB, USER, { nowTs: new Date() });
  assert.strictEqual(blank.openId, USER);
  assert.ok(blank.nickname.startsWith('用户'));
  const visible = await CURRENT_DB.collection('orders').where({ userId: USER }).get();
  assert.strictEqual(visible.data.length, 0, '重建的空账户看不到旧订单');

  const repeat = await account.main({
    action: 'account.erase',
    confirmation: accountSchema.CONFIRMATION,
  });
  assert.strictEqual(repeat.success, true);
  assert.strictEqual(repeat.alreadyErased, false, '新空账户可以被再次注销');
}

async function testPartialDataIsRetryable() {
  reset();
  CURRENT_DB._seed('reminder_tasks', [{ _id: 'task_resume', userId: USER, backendStatus: 'WAITING' }]);
  let resume = await account.main({
    action: 'account.erase',
    confirmation: accountSchema.CONFIRMATION,
  });
  assert.strictEqual(resume.success, true);
  assert.strictEqual(CURRENT_DB._size('reminder_tasks'), 0, '用户文档缺失但仍有任务时必须继续清理');
  resume = await account.main({
    action: 'account.erase',
    confirmation: accountSchema.CONFIRMATION,
  });
  assert.strictEqual(resume.success, true);
  assert.strictEqual(resume.alreadyErased, true);

  reset();
  // 用户已在上次调用中被删除，但匿名化订单仍残留旧 userId；重试必须继续清干净。
  CURRENT_DB._seed('orders', [{
    _id: 'order_resume',
    userId: USER,
    outTradeNo: 'TRESUME001',
    amountFen: 300,
    status: 'PAID',
    grantStatus: 'GRANTED',
  }]);
  const res = await account.main({
    action: 'account.erase',
    confirmation: accountSchema.CONFIRMATION,
  });
  assert.strictEqual(res.success, true);
  assert.ok(res.retained.orders >= 1);
  const order = CURRENT_DB._dump('orders')[0];
  assert.strictEqual(order.userId, '');
  assert.strictEqual(order.accountDeleted, true);
}

async function main() {
  await testMirroredStatuses();
  await testBlockers();
  await testSuccessfulErase();
  await testPartialDataIsRetryable();
  console.log('account-erasure.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
