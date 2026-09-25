/**
 * 分享入口上下文（2026-09-25）
 *
 * 只处理公开参数 source / spotId / sceneId：
 * - 页面 onLoad 可直接传 options；
 * - App.onLaunch / App.onShow 传的是 { query: {...} }；
 * - 不解析或保存昵称、OpenID、行程和票务状态。
 */

const SOURCES = ['share', 'timeline', 'home_share', 'search', 'direct'];

function safeDecode(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

function normalizeSource(source) {
  const s = safeDecode(source);
  return SOURCES.indexOf(s) >= 0 ? s : '';
}

/** 从页面 options 或 App 的 options.query 读取公开入口参数。 */
function parseEntryOptions(options) {
  const o = (options && options.query) ? options.query : (options || {});
  return {
    source: normalizeSource(o.source),
    spotId: safeDecode(o.spotId),
    sceneId: safeDecode(o.sceneId),
  };
}

function hasEntry(entry) {
  return !!(entry && (entry.source || entry.spotId || entry.sceneId));
}

/** App 生命周期只暂存，不立即改变当前页面；由目标页消费。 */
function rememberPending(app, options) {
  const entry = parseEntryOptions(options);
  if (!hasEntry(entry) || !app || !app.globalData) return entry;
  app.globalData.pendingShareEntry = entry;
  return entry;
}

/** 优先使用当前页 options；没有时消费 App 暂存入口。 */
function peekPending(app) {
  return (app && app.globalData && app.globalData.pendingShareEntry) || null;
}

function clearPending(app) {
  if (app && app.globalData) app.globalData.pendingShareEntry = null;
}

function consumeEntry(app, options) {
  const direct = parseEntryOptions(options);
  if (hasEntry(direct)) return direct;
  const pending = peekPending(app);
  if (pending) clearPending(app);
  return pending || direct;
}

/** 从分享来源解析日志条目类型；页面可传 defaultType 覆盖 list/home。 */
function entryTypeOf(entry, defaultType) {
  if (entry && entry.spotId) return 'spot';
  if (entry && entry.sceneId) return 'scene';
  return defaultType || 'home';
}

function entryIdOf(entry, defaultId) {
  if (!entry) return defaultId || '';
  return entry.spotId || entry.sceneId || defaultId || '';
}


function releaseTimeText(value) {
  if (!value) return '';
  return Array.isArray(value) ? value.join('、') : String(value);
}

function buildSpotSharePayload(spot, fallbackSpotId) {
  const spotId = (spot && spot.spotId) || fallbackSpotId || '';
  const name = (spot && spot.name) || '这个景点';
  const times = releaseTimeText(spot && spot.releaseTime);
  let title = '景点放票信息，先设提醒';
  if (spot && spot.remindable && spot.advanceDays && times) {
    title = `${name}提前${spot.advanceDays}天，${times}放票，先设提醒`;
  } else if (spot && spot.name) {
    title = `${name}门票预约与开放规则`;
  }
  return {
    title,
    path: buildSpotHubPath(spotId, 'share'),
    imageUrl: spotId ? '/images/spots/' + spotId + '.jpg' : '/images/banner_bg.png',
  };
}

function buildSpotListPayload() {
  return {
    title: '北京热门景点放票时间，一张表看完',
    path: buildSpotHubPath('', 'share'),
    imageUrl: '/images/banner_bg.png',
  };
}

function buildSpotHubPath(spotId, source) {
  const q = [];
  if (spotId) q.push('spotId=' + encodeURIComponent(spotId));
  q.push('source=' + encodeURIComponent(normalizeSource(source) || 'share'));
  return '/pages/spot-hub/spot-hub?' + q.join('&');
}

function buildScenePath(sceneId, source) {
  return '/pages/share-scene/share-scene?sceneId=' + encodeURIComponent(sceneId || 'today')
    + '&source=' + encodeURIComponent(normalizeSource(source) || 'share');
}

function buildSceneQuery(sceneId, source) {
  return 'sceneId=' + encodeURIComponent(sceneId || 'today')
    + '&source=' + encodeURIComponent(normalizeSource(source) || 'timeline');
}

module.exports = {
  SOURCES,
  parseEntryOptions,
  hasEntry,
  rememberPending,
  consumeEntry,
  peekPending,
  clearPending,
  entryTypeOf,
  entryIdOf,
  buildSpotHubPath,
  buildSpotSharePayload,
  buildSpotListPayload,
  buildScenePath,
  buildSceneQuery,
};
