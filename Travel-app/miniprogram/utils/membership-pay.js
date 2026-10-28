/**
 * 会员支付公共流程。
 *
 * 页面只决定“买哪个服务端返回的 packageId”，金额、权益和有效期全部由云端订单决定。
 * wx.requestPayment 成功只表示客户端流程完成，权益必须以 payment.query / 回调为准。
 */

const api = require('./api.js');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestPayment(payment) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...payment,
      success: resolve,
      fail: err => {
        const message = String((err && err.errMsg) || '');
        if (/cancel/i.test(message)) {
          reject({ cancelled: true, error: '已取消支付' });
          return;
        }
        reject({ errorCode: 1023, error: message || '支付未完成' });
      },
    });
  });
}

async function waitForPaid(orderId) {
  for (let i = 0; i < 7; i += 1) {
    const result = await api.payment.query({ orderId });
    if (result && result.status === 'PAID') return result;
    await delay(1200);
  }
  return { status: 'PENDING', pending: true };
}

async function purchase(packageId) {
  const order = await api.reminder.membership.createOrder({ packageId });
  const created = await api.payment.create({ orderId: order.orderId });

  if (!created.mockPaid) {
    if (created.alreadyPaid) {
      return api.reminder.membership.status();
    }
    if (!created.payment) throw { errorCode: 1023, error: '支付参数缺失，请稍后再试' };
    await requestPayment(created.payment);
  }

  const paid = await waitForPaid(order.orderId);
  if (paid.pending) return { pending: true, orderId: order.orderId };
  return api.reminder.membership.status();
}

module.exports = { purchase, requestPayment, waitForPaid };
