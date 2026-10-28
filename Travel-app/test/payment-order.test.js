/**
 * 支付订单发放：金额校验、幂等、会员与任务包。
 *
 * 运行：node test/payment-order.test.js
 */
const { createDb } = require('./mock-db');
const { COLLECTIONS, MemberLevel, OrderStatus } = require('../cloudfunctions/payment/lib/schema');
const {
  findOrderById, fulfillOrder, isCallbackPaidResult, isQueryPaidResult,
} = require('../cloudfunctions/payment/lib/order');

const USER = 'openid_pay_001';

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

function seedUser(db) {
  db._seed(COLLECTIONS.USERS, [{
    _id: 'user_pay_001',
    openId: USER,
    memberLevel: MemberLevel.NORMAL,
    taskPackCount: 0,
    memberExpiresAt: null,
  }]);
}

async function addOrder(db, patch = {}) {
  return db.collection(COLLECTIONS.ORDERS).add({
    data: {
      userId: USER,
      outTradeNo: 'T' + Math.random().toString(36).slice(2),
      productType: 'MEMBER',
      amountFen: 200,
      memberDays: 30,
      status: OrderStatus.PENDING,
      ...patch,
    },
  });
}

async function run() {
  console.log('=== 1. 会员订单发放 ===');
  let db = createDb();
  seedUser(db);
  let added = await addOrder(db);
  let order = await findOrderById(db, added._id);
  let paid = await fulfillOrder(db, order, { totalFee: 200, transactionId: 'wx_tx_1' });
  eq(paid.success, true, '订单发放成功');
  let user = db._dump(COLLECTIONS.USERS)[0];
  order = await findOrderById(db, added._id);
  eq(user.memberLevel, MemberLevel.MEMBER, '用户升为会员');
  eq(
    new Date(user.memberExpiresAt).getTime() >= Date.now() + 29 * 86400000,
    true,
    '会员有效约 30 天'
  );
  eq(order.status, OrderStatus.PAID, '订单置为 PAID');
  eq(order.transactionId, 'wx_tx_1', '保存微信交易号');

  console.log('\n=== 2. 重复回调幂等 ===');
  paid = await fulfillOrder(db, order, { totalFee: 200, transactionId: 'wx_tx_1' });
  eq(paid.success, true, '重复回调返回成功');
  eq(paid.alreadyPaid, true, '标记已发放');
  user = db._dump(COLLECTIONS.USERS)[0];
  eq(user.taskPackCount || 0, 0, '不会重复增加任务包');

  console.log('\n=== 3. 任务包叠加 ===');
  await db.collection(COLLECTIONS.USERS).doc('user_pay_001').update({
    data: { memberExpiresAt: new Date(Date.now() + 86400000) },
  });
  added = await addOrder(db, {
    productType: 'TASK_PACK',
    memberFloorDays: 30,
  });
  order = await findOrderById(db, added._id);
  paid = await fulfillOrder(db, order, { totalFee: 200 });
  eq(paid.success, true, '任务包发放成功');
  user = db._dump(COLLECTIONS.USERS)[0];
  eq(user.taskPackCount, 1, 'taskPackCount +1');
  eq(
    new Date(user.memberExpiresAt).getTime() >= Date.now() + 29 * 86400000,
    true,
    '临近到期购买任务包后会员至少还有约 30 天'
  );

  console.log('\n=== 4. 金额不一致拒绝发放 ===');
  db = createDb();
  seedUser(db);
  added = await addOrder(db);
  order = await findOrderById(db, added._id);
  paid = await fulfillOrder(db, order, { totalFee: 1 });
  eq(paid.success, false, '金额不一致失败');
  eq(paid.errorCode, 1025, '返回金额错误码');
  user = db._dump(COLLECTIONS.USERS)[0];
  order = await findOrderById(db, added._id);
  eq(user.memberLevel, MemberLevel.NORMAL, '会员未发放');
  eq(order.status, OrderStatus.PENDING, '订单仍待支付');

  console.log('\n=== 5. 回调与查单成功口径 ===');
  eq(isCallbackPaidResult({ returnCode: 'SUCCESS', resultCode: 'SUCCESS' }), true, '回调 SUCCESS 视为支付成功');
  eq(isCallbackPaidResult({ returnCode: 'SUCCESS', resultCode: 'FAIL' }), false, '回调 FAIL 不发放');
  eq(isQueryPaidResult({ resultCode: 'SUCCESS', tradeState: 'NOTPAY' }), false, '查单只认 tradeState=SUCCESS');
  eq(isQueryPaidResult({ tradeState: 'SUCCESS' }), true, '查单 SUCCESS 发放');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
