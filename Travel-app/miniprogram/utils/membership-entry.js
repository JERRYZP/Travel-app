/**
 * 提醒名额超限时的统一展示与会员页入口。
 *
 * 不把配置常量复制到前端：额度、价格和可购项都读服务端随错误返回的
 * membership / packages，这里只负责把本次缺口整理成可展示的视图。
 */

function taskLimitOf(err) {
  if (!err || err.errorCode !== 1026 || !err.taskLimit) return null;
  return err.taskLimit;
}

function beijingDateText(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function viewOf(err) {
  const source = taskLimitOf(err);
  if (!source) return null;

  const current = err.membership || {};
  const member = current.member === true;
  if (current.taskLimitUnlimited === true) return null;
  const limit = Math.max(0, Number(source.limit) || 0);
  const used = Math.max(0, Number(source.used) || 0);
  const rawRemaining = Number(source.remaining);
  const remaining = Number.isFinite(rawRemaining)
    ? Math.max(0, rawRemaining)
    : Math.max(0, limit - used);
  const requested = Math.max(0, Number(source.requested) || 0);
  const rawShortfall = Number(source.shortfall);
  const shortfall = Number.isFinite(rawShortfall)
    ? Math.max(0, rawShortfall)
    : Math.max(0, requested - remaining);
  const packages = Array.isArray(err.packages) ? err.packages : [];
  const sales = err.sales || {};
  const purchaseEnabled = sales.purchaseEnabled !== false;
  const pkg = packages.find(item => item && item.type === 'MEMBER' && item.available !== false)
    || null;
  const freeSlots = Math.max(0, Number(current.freeTaskSlots) || 0);
  const memberDays = Math.max(0, Number(current.memberDurationDays) || 0);
  const priceText = (pkg && pkg.priceText) || '';

  return {
    title: `还差 ${shortfall} 个提醒名额`,
    limit,
    used,
    remaining,
    requested,
    shortfall,
    member,
    packageId: purchaseEnabled && pkg ? pkg.id : '',
    packageType: 'MEMBER',
    packageTitle: pkg ? pkg.title : '',
    priceText: pkg ? pkg.priceText : '',
    addedSlots: 0,
    memberDays: Math.max(0, Number(pkg && pkg.memberDays) || 0),
    memberFloorDays: Math.max(0, Number(pkg && pkg.memberFloorDays) || 0),
    memberExpiresAt: current.memberExpiresAt || null,
    purchaseEnabled,
    salesMessage: sales.message || '',
    actionText: purchaseEnabled
      ? ((pkg && pkg.actionText) || '去开通会员')
      : ((sales && sales.message) || '会员购买暂停中'),
    description: !purchaseEnabled
      ? (sales.message || '会员购买暂停中，已有会员权益和订单不受影响。')
      : `因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额；开通会员后不限提醒名额。`,
    note: `会员有效期 ${memberDays} 天，不自动续费`,
    payText: !purchaseEnabled
      ? '会员购买暂停中'
      : `支付 ${priceText}，购买会员并继续`,
  };
}

function payConfirmOf(limit, now = Date.now()) {
  if (!limit || limit.purchaseEnabled === false || !limit.packageId || !limit.priceText) return null;
  const currentMs = new Date(limit.memberExpiresAt || 0).getTime();
  const validCurrent = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
  const memberDays = Math.max(0, Number(limit.memberDays) || 0);
  const expiryMs = validCurrent + memberDays * 86400000;
  const title = `${memberDays} 天会员`;
  return {
    title,
    amount: limit.priceText,
    expiry: `会员有效期至 ${beijingDateText(expiryMs)}`,
  };
}

function openPage(limit) {
  if (!limit) return false;
  const query = [
    'reason=task_limit',
    `packageId=${encodeURIComponent(limit.packageId || '')}`,
    `used=${encodeURIComponent(limit.used)}`,
    `limit=${encodeURIComponent(limit.limit)}`,
    `requested=${encodeURIComponent(limit.requested)}`,
    `shortfall=${encodeURIComponent(limit.shortfall)}`,
  ];
  wx.navigateTo({ url: `/pages/membership/membership?${query.join('&')}` });
  return true;
}

function openTaskLimit(err) {
  const limit = viewOf(err);
  return openPage(limit);
}

module.exports = { taskLimitOf, viewOf, payConfirmOf, openPage, openTaskLimit };
