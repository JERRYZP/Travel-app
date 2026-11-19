/** 注销后的延迟支付：不得重建旧用户，只生成匿名人工核验单。 */
const assert = require('assert');
const { createDb } = require('./mock-db');
const orderDomain = require('../cloudfunctions/payment/lib/order.js');
const { COLLECTIONS } = require('../cloudfunctions/payment/lib/schema.js');
const adminOrders = require('../cloudfunctions/payment/lib/admin-orders.js');
const afterSales = require('../cloudfunctions/payment/lib/after-sales.js');

async function main() {
  const db = createDb();
  const paidOrder = {
    _id: 'order_erased_late_paid',
    userId: '',
    userDocumentId: '',
    outTradeNo: 'TERASEDLATE001',
    transactionId: '',
    amountFen: 300,
    productType: 'MEMBER',
    packageId: 'member_quota_10',
    title: '10 个提醒名额 · 30 天',
    status: 'CLOSED',
    grantStatus: null,
    refundStatus: 'NONE',
    accountDeleted: true,
    accountDeletedAt: new Date(),
    erasedAccountRef: 'erased_payment_test',
  };
  db._seed(COLLECTIONS.ORDERS, [paidOrder]);

  const first = await orderDomain.fulfillOrder(db, paidOrder, {
    amount: { total: 300 },
    transactionId: 'WX_LATE_001',
    tradeState: 'SUCCESS',
    outTradeNo: paidOrder.outTradeNo,
  });
  assert.strictEqual(first.success, true, JSON.stringify(first));
  assert.strictEqual(first.accountDeleted, true);
  assert.ok(first.caseId);

  assert.strictEqual(db._size(COLLECTIONS.USERS), 0, '不得重建旧账户');
  const storedOrder = db._dump(COLLECTIONS.ORDERS)[0];
  assert.strictEqual(storedOrder.status, 'PAID');
  assert.strictEqual(storedOrder.grantStatus, 'FAILED');
  assert.strictEqual(storedOrder.userId, '');
  assert.strictEqual(storedOrder.accountDeleted, true);

  const cases = db._dump(COLLECTIONS.AFTER_SALES_CASES);
  assert.strictEqual(cases.length, 1);
  assert.strictEqual(cases[0].userId, '');
  assert.strictEqual(cases[0].accountDeleted, true);
  assert.strictEqual(cases[0].reasonCode, 'PAYMENT_AFTER_ACCOUNT_DELETION');
  assert.strictEqual(cases[0].priority, 'HIGH');
  assert.strictEqual(cases[0].status, 'UNDER_REVIEW');

  const adminOrderView = adminOrders.orderViewOf(storedOrder, {}, cases, { detail: true });
  assert.strictEqual(adminOrderView.user.nickname, '已注销用户');
  assert.strictEqual(adminOrderView.user.openId, '');
  assert.strictEqual(adminOrderView.user.identityText, '身份已注销');
  const adminCaseList = await afterSales.listCasesForAdmin(db, {
    keyword: cases[0].caseNo,
    page: 1,
    pageSize: 20,
  });
  assert.strictEqual(adminCaseList.success, true);
  assert.strictEqual(adminCaseList.items[0].user.nickname, '已注销用户');
  assert.strictEqual(adminCaseList.items[0].user.openId, '');

  const repeat = await orderDomain.fulfillOrder(db, storedOrder, {
    amount: { total: 300 },
    outTradeNo: paidOrder.outTradeNo,
  });
  assert.strictEqual(repeat.success, true);
  assert.strictEqual(db._size(COLLECTIONS.AFTER_SALES_CASES), 1, '重复回调不重复建单');

  const granted = {
    ...storedOrder,
    grantStatus: 'GRANTED',
    status: 'PAID',
  };
  const duplicateGrant = await orderDomain.fulfillOrder(db, granted, {
    amount: { total: 300 },
  });
  assert.strictEqual(duplicateGrant.success, true);
  assert.strictEqual(duplicateGrant.alreadyPaid, true);
  assert.strictEqual(db._size(COLLECTIONS.USERS), 0);

  db._seed(COLLECTIONS.ORDERS, [{
    ...storedOrder,
    _id: 'order_erased_refundable',
    status: 'PAID',
    grantStatus: 'GRANTED',
    refundStatus: 'PROCESSING',
  }]);
  const reversed = await orderDomain.reverseOrderEntitlement(
    db,
    { _id: 'order_erased_refundable', status: 'PAID' },
    300
  );
  assert.strictEqual(reversed.success, true);
  const reversedOrder = db._dump(COLLECTIONS.ORDERS)
    .find(row => row._id === 'order_erased_refundable');
  assert.strictEqual(reversedOrder.refundStatus, 'REFUNDED');
  assert.strictEqual(reversedOrder.userId, '');
  assert.strictEqual(db._size(COLLECTIONS.USERS), 0, '注销后退款不得重建用户账户');

  const platformCase = await afterSales.createPlatformRefundCase(
    db,
    reversedOrder,
    'RFERASED001',
    { paymentChannel: 'APPLE' }
  );
  assert.strictEqual(platformCase.userId, '');
  assert.strictEqual(platformCase.accountDeleted, true);
  assert.strictEqual(platformCase.erasedAccountRef, storedOrder.erasedAccountRef);

  console.log('account-payment-callback.test.js 全部通过');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
