/**
 * 会员支付 / 退款页面的有界自动刷新契约。
 *
 * 运行：node test/order-refresh.test.js
 */
const fs = require('fs');
const path = require('path');
const refresh = require('../miniprogram/utils/order-refresh.js');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', m, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', m, '=', a);
  }
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const now = new Date('2026-10-30T15:00:00+08:00').getTime();

console.log('=== 1. 只有仍会变化的状态才自动刷新 ===');
[
  [{ status: 'PENDING', expiresAt: new Date(now + 60000) }, true, '未过期待支付订单'],
  [{ status: 'PENDING', expiresAt: new Date(now - 1000), isExpired: true }, false, '已过期待支付订单'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'NONE' }, false, '支付且权益到账'],
  [{ status: 'PAID', grantStatus: 'FAILED', refundStatus: 'NONE' }, true, '权益补发中'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'REQUESTED' }, true, '退款申请审核中'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'UNDER_REVIEW' }, true, '退款审核中'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'PROCESSING' }, true, '退款处理中'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'REFUNDED' }, true, '退款到账但权益待回收'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'REFUNDED', entitlementGrant: { revertedAt: new Date() } }, false, '权益回收快照已回填'],
  [{ status: 'PAID', grantStatus: 'REVERTED', refundStatus: 'REFUNDED' }, false, '退款与权益回收均完成'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'REJECTED' }, false, '退款已驳回'],
  [{ status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'FAILED' }, false, '退款失败待人工处理'],
  [{ status: 'PAID', grantStatus: 'FAILED', refundStatus: 'REFUNDED' }, false, '发放失败订单退款后不再等待权益回收'],
  [{ status: 'CLOSED', grantStatus: 'NONE', refundStatus: 'NONE' }, false, '订单已关闭'],
].forEach(([order, want, name]) => {
  eq(refresh.isTransientOrder(order, now), want, name);
});

console.log('\n=== 2. 用户提示说明“会自动更新” ===');
eq(refresh.refreshHintOf([
  { status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'PROCESSING' },
], now), '退款处理中，会员与提醒名额状态会自动更新', '退款处理提示');
eq(refresh.refreshHintOf([
  { status: 'PAID', grantStatus: 'GRANTED', refundStatus: 'REFUNDED' },
], now), '退款已到账，正在回收本单权益，页面会自动更新', '权益回收提示');
eq(refresh.refreshHintOf([
  { status: 'PENDING', expiresAt: new Date(now + 60000) },
], now), '支付结果确认中，权益到账后页面会自动更新', '支付确认提示');
eq(refresh.refreshHintOf([
  { status: 'PAID', grantStatus: 'REVERTED', refundStatus: 'REFUNDED' },
], now), '', '终态不再提示');

console.log('\n=== 3. 刷新有上限，页面离开必须清理 ===');
eq(refresh.REFRESH_INTERVAL_MS, 5000, '每 5 秒刷新一次');
eq(refresh.REFRESH_MAX_ATTEMPTS, 30, '最多刷新 30 次（约 2.5 分钟）');
eq(refresh.REFRESH_EXHAUSTED_HINT, '状态仍在处理中，请下拉刷新或稍后重新进入', '达到上限后保留人工刷新兜底提示');
for (const page of [
  'miniprogram/pages/membership/membership',
  'miniprogram/pages/membership-orders/membership-orders',
  'miniprogram/pages/membership-order-detail/membership-order-detail',
]) {
  const js = read(page + '.js');
  const json = JSON.parse(read(page + '.json'));
  const wxml = read(page + '.wxml');
  eq(/order-refresh\.js/.test(js), true, `${path.basename(page)} 接入订单刷新规则`);
  eq(/_pageVisible\s*=\s*false/.test(js) && /stopAutoRefresh/.test(js), true,
    `${path.basename(page)} 离开页面停止刷新`);
  eq(/onPullDownRefresh\s*\(/.test(js), true, `${path.basename(page)} 支持下拉刷新`);
  eq(json.enablePullDownRefresh, true, `${path.basename(page)} 开启下拉刷新`);
  eq(/autoRefreshHint/.test(wxml), true, `${path.basename(page)} 展示自动更新提示`);
  eq(/REFRESH_EXHAUSTED_HINT/.test(js), true, `${path.basename(page)} 达到刷新上限不清空提示`);
}
eq(/退款已到账，权益正在回收/.test(read('miniprogram/pages/membership-order-detail/membership-order-detail.js')), true,
  '先退款到账、后回收权益的中间态有明确文案');
eq(/退款暂时失败/.test(read('miniprogram/pages/membership-order-detail/membership-order-detail.js')), true,
  '退款失败不再误显示成权益已到账');

if (fail) {
  console.log('\n共 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('\n全部通过');
