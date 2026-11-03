const STORAGE_KEY = 'profileFeedbackEntryV2';
const TTL_MS = 5 * 60 * 1000;

function read(now = Date.now()) {
  try {
    const cached = wx.getStorageSync(STORAGE_KEY);
    if (!cached || !cached.savedAt || !cached.data) return null;
    const age = now - cached.savedAt;
    return {
      data: cached.data,
      savedAt: cached.savedAt,
      fresh: age >= 0 && age < TTL_MS,
    };
  } catch (e) {
    return null;
  }
}

function write(data, savedAt = Date.now()) {
  try {
    wx.setStorageSync(STORAGE_KEY, { savedAt, data });
  } catch (e) {}
}

/** 用户成功打开“我的反馈”后，立即清掉本地入口数字，且不延长统计缓存。 */
function markUserRead() {
  const cached = read();
  if (!cached) return null;
  const data = {
    ...cached.data,
    handledUnreadCount: 0,
  };
  write(data, cached.savedAt);
  return data;
}

module.exports = {
  STORAGE_KEY,
  TTL_MS,
  read,
  write,
  markUserRead,
};
