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

function packageForLimit(current, packages, requested, includeUnavailable = false) {
  const source = (packages || []).filter(item =>
    item && item.type === 'MEMBER' && (includeUnavailable || item.available !== false));
  if (!source.length) return null;
  if (current && current.memberTier === 'QUOTA_10') {
    return source.find(item => item.upgrade === true) || source[0];
  }
  if (current && current.member) {
    return source.find(item => item.unlimited === true && item.upgrade !== true)
      || source.find(item => item.unlimitedReminders === true)
      || source[0];
  }
  const quotaPlan = source.find(item => item.unlimited !== true && item.upgrade !== true) || null;
  const unlimitedPlan = source.find(item => item.unlimited === true && item.upgrade !== true)
    || source.find(item => item.unlimitedReminders === true)
    || null;
  const used = Math.max(0, Number(current && current.taskUsed) || 0);
  const quotaLimit = Math.max(0, Number(quotaPlan && quotaPlan.taskSlots) || 10);
  if (quotaPlan && used + requested <= quotaLimit) return quotaPlan;
  return unlimitedPlan || quotaPlan;
}

function viewOf(err) {
  const source = taskLimitOf(err);
  if (!source) return null;

  const current = err.membership || {};
  const member = current.member === true;
  if (current.unlimited === true || current.taskLimitUnlimited === true) return null;
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
  const pkg = purchaseEnabled ? packageForLimit(current, packages, requested) : null;
  const fallbackPkg = packageForLimit(current, packages, requested, true);
  const freeSlots = Math.max(0, Number(current.freeTaskSlots) || 0);
  const memberSlots = Math.max(freeSlots, Number(current.memberTaskSlots) || 0);
  const memberDays = Math.max(0, Number(current.memberDurationDays) || 0);
  const selected = pkg || fallbackPkg || {};
  const isUpgrade = selected.upgrade === true;
  const isUnlimited = selected.unlimited === true || selected.unlimitedReminders === true;
  const priceText = selected.priceText || '';
  const upgradeShortWindow = current.upgradeShortWindow === true;
  const upgradeWindowClosed = current.upgradeWindowClosed === true
    || (isUpgrade && selected.available === false);

  return {
    title: `还差 ${shortfall} 个提醒名额`,
    limit,
    used,
    remaining,
    requested,
    shortfall,
    member,
    unlimited: isUnlimited,
    upgrade: isUpgrade,
    memberTier: current.memberTier || '',
    packageId: purchaseEnabled && pkg && !upgradeWindowClosed ? pkg.id : '',
    packageType: selected.type || 'MEMBER',
    packageTitle: selected.title || '',
    priceText: pkg ? pkg.priceText : '',
    taskSlots: selected.taskSlots == null ? null : Math.max(0, Number(selected.taskSlots) || 0),
    addedSlots: pkg ? Math.max(0, Number(pkg.addedSlots) || 0) : 0,
    memberDays: Math.max(0, Number(selected.memberDays) || 0),
    memberFloorDays: Math.max(0, Number(selected.memberFloorDays) || 0),
    memberExpiresAt: current.memberExpiresAt || null,
    memberExpiresAtText: current.memberExpiresAtText || '',
    upgradeShortWindow,
    upgradeWindowClosed,
    purchaseEnabled,
    salesMessage: sales.message || '',
    actionText: upgradeWindowClosed
      ? '会员即将到期'
      : (purchaseEnabled
      ? ((pkg && pkg.actionText) || (member ? '去升级提醒名额' : '去选择会员方案'))
      : ((sales && sales.message) || '会员购买暂停中')),
    description: upgradeWindowClosed
      ? '当前会员即将到期，请到期后重新选择会员方案。'
      : (!purchaseEnabled
      ? (sales.message || '会员购买暂停中，已有会员权益和订单不受影响。')
      : (isUpgrade
        ? `补 ${priceText} 升级为不限提醒名额，仅当前会员期内生效，不延长有效期。`
        : (isUnlimited
          ? '选择不限额度方案后，30 天内不限制提醒名额。'
          : `因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额；${priceText} 会员档最多 ${memberSlots} 个。`))),
    note: member
      ? (current.memberExpiresAtText ? `会员到期：${current.memberExpiresAtText}` : '')
      : `会员有效期 ${memberDays} 天，不自动续费`,
    payText: upgradeWindowClosed
      ? '会员即将到期'
      : (!purchaseEnabled
      ? '会员购买暂停中'
      : (isUpgrade
        ? `补 ${priceText}，升级不限额度并继续`
        : (isUnlimited
          ? `支付 ${priceText}，开通不限额度并继续`
          : `支付 ${priceText}，开通 ${memberSlots} 个提醒名额并继续`))),
  };
}

function showUpgradeWindowWarning(limit, onConfirm) {
  if (!limit || limit.upgrade !== true || limit.upgradeShortWindow !== true) {
    onConfirm();
    return;
  }
  wx.showModal({
    title: '会员即将到期',
    content: `当前会员不足5天，升级不延长有效期，仍于 ${limit.memberExpiresAtText || '当前到期日'} 到期。`,
    confirmText: '继续升级',
    cancelText: '暂不升级',
    success: res => {
      if (res.confirm) onConfirm();
    },
  });
}

function payConfirmOf(limit, now = Date.now()) {
  if (!limit || limit.purchaseEnabled === false || !limit.packageId || !limit.priceText) return null;
  const currentMs = new Date(limit.memberExpiresAt || 0).getTime();
  const validCurrent = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
  const memberDays = Math.max(0, Number(limit.memberDays) || 0);
  const memberFloorDays = Math.max(0, Number(limit.memberFloorDays) || 0);
  const expiryMs = Math.max(
    memberDays ? validCurrent + memberDays * 86400000 : 0,
    memberFloorDays ? now + memberFloorDays * 86400000 : 0,
    Number.isFinite(currentMs) ? currentMs : 0
  );
  const title = limit.upgrade
    ? '升级不限提醒名额'
    : (limit.unlimited
      ? `${memberDays} 天不限提醒名额`
      : `${memberDays} 天 ${Math.max(0, Number(limit.taskSlots) || 0)} 个提醒名额`);
  return {
    title,
    amount: limit.priceText,
    expiry: `会员有效期至 ${beijingDateText(expiryMs)}`,
    effect: limit.upgrade
      ? '支付成功后立即升级为不限提醒名额，不延长会员有效期'
      : '支付成功后立即生效',
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

module.exports = {
  taskLimitOf, viewOf, payConfirmOf, showUpgradeWindowWarning, openPage, openTaskLimit,
};
