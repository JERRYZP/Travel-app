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
  const preferredType = member ? 'TASK_PACK' : 'MEMBER';
  const pkg = packages.find(item => item && item.type === preferredType && item.available !== false)
    || packages.find(item => item && item.type === preferredType)
    || null;
  const freeSlots = Math.max(0, Number(current.freeTaskSlots) || 0);
  const memberSlots = Math.max(freeSlots, Number(current.memberTaskSlots) || 0);
  const memberDays = Math.max(0, Number(current.memberDurationDays) || 0);
  const priceText = (pkg && pkg.priceText) || '';
  const addedSlots = Math.max(0, Number(pkg && pkg.addedSlots) || 0);

  return {
    title: `还差 ${shortfall} 个提醒名额`,
    limit,
    used,
    remaining,
    requested,
    shortfall,
    member,
    packageId: pkg ? pkg.id : '',
    packageType: pkg ? pkg.type : (member ? 'TASK_PACK' : 'MEMBER'),
    packageTitle: pkg ? pkg.title : '',
    priceText: pkg ? pkg.priceText : '',
    addedSlots,
    memberDays: Math.max(0, Number(pkg && pkg.memberDays) || 0),
    memberFloorDays: Math.max(0, Number(pkg && pkg.memberFloorDays) || 0),
    memberExpiresAt: current.memberExpiresAt || null,
    actionText: (pkg && pkg.actionText)
      || (member ? '去加购提醒名额' : '去开通会员'),
    description: member
      ? (pkg && pkg.description) || '可在会员有效期内加购提醒名额。'
      : `因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额；开通会员后上限提升至 ${memberSlots} 个。`,
    note: member
      ? (current.memberExpiresAtText ? `会员到期：${current.memberExpiresAtText}` : '')
      : `会员有效期 ${memberDays} 天，不自动续费`,
    payText: member
      ? `支付 ${priceText}，购买 ${addedSlots} 个提醒名额并继续`
      : `支付 ${priceText}，购买会员并继续`,
  };
}

function payConfirmOf(limit, now = Date.now()) {
  if (!limit || !limit.packageId || !limit.priceText) return null;
  const currentMs = new Date(limit.memberExpiresAt || 0).getTime();
  const validCurrent = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
  const memberDays = Math.max(0, Number(limit.memberDays) || 0);
  const memberFloorDays = Math.max(0, Number(limit.memberFloorDays) || 0);
  const expiryMs = limit.packageType === 'MEMBER'
    ? validCurrent + memberDays * 86400000
    : Math.max(validCurrent, now + memberFloorDays * 86400000);
  const title = limit.packageType === 'MEMBER'
    ? `${memberDays} 天会员`
    : `${Math.max(0, Number(limit.addedSlots) || 0)} 个提醒名额`;
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
