/**
 * 首页数据缓存（2026-09-30）。
 *
 * 起因：首页每次 `onShow` 都重跑一次 `home.bootstrap`，而这期间页面是空白的。
 * 有了缓存，**再进首页可以立刻画出上次的状态墙**，云端返回后再原地替换。
 *
 * 边界（重要）：
 * - 缓存**只用于首屏填充**。它永远不参与任何业务判定 —— 航向、进度、票务态
 *   一律以云端返回为准，本模块只是把上一次的返回体原样回放。
 * - 写入的是**原始返回体**，不是页面加工后的 data。加工统一走
 *   `pages/home/home.js` 的 `buildHomeData()`，保证缓存和实况两条路不可能漂。
 * - 读失败 / 解析失败 / 版本不符一律当作「没有缓存」，静默降级到本地切片。
 */

const KEY = 'homeBootstrapCacheV1';
/* 超过这个时长就不再用来画首屏 —— 放票状态按天变，太旧的数据画出来
   反而更容易出现「先显示昨天的状态再跳变」。live 到达后总会覆盖。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storageGet(key) {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? null : v;
  } catch (e) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function storageRemove(key) {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) wx.removeStorageSync(key);
  } catch (e) {}
}

/**
 * 读取缓存的返回体。返回 `null` 表示不可用（没有 / 过期 / 损坏）。
 * @returns {object|null} 与 `home.bootstrap` 成功返回同形状的对象
 */
function read() {
  const entry = storageGet(KEY);
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.savedAt || !entry.res) return null;
  if (Date.now() - entry.savedAt > MAX_AGE_MS) {
    storageRemove(KEY);
    return null;
  }
  return entry.res;
}

/** 写入一次成功的返回体。失败（超配额等）静默忽略，不影响主流程。 */
function write(res) {
  if (!res || typeof res !== 'object') return false;
  /* 只存 bootstrap 的返回体本身；页面加工产物（decorateTrip 后的 trips 等）
     不进缓存，避免把页面口径固化下来。 */
  return storageSet(KEY, { savedAt: Date.now(), res });
}

function clear() {
  storageRemove(KEY);
}

module.exports = { KEY, MAX_AGE_MS, read, write, clear };
