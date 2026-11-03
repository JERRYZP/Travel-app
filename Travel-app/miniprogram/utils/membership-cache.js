/**
 * 会员相关页面缓存的失效版本。
 *
 * 会员权益会因支付、补偿到账和退款回收而变化，不能只靠页面 TTL 判断新鲜度。
 * 写后确认权益变化时递增版本；持有会员快照的页面发现版本不一致，必须绕过缓存重拉。
 */
function globalData() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    return app && app.globalData ? app.globalData : null;
  } catch (err) {
    return null;
  }
}

function version() {
  const data = globalData();
  return Math.max(0, Math.floor(Number(data && data.membershipDataVersion) || 0));
}

function markDirty() {
  const data = globalData();
  if (!data) return 0;
  const next = version() + 1;
  data.membershipDataVersion = next;
  return next;
}

module.exports = { version, markDirty };
