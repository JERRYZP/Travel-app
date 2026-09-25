/**
 * 分享埋点：使用微信自定义分析事件，不新增云函数或数据库。
 *
 * 约束：
 * - 只有公开的 entry/source/action，不含昵称、OpenID、行程、票务结果；
 * - wx.reportEvent 未配置或 API 不可用时静默降级；
 * - 首次价值动作按“入口 + 动作”去重，避免重复提交放大转化。
 */

const release = require('./release-context.js');

const EVENTS = {
  SHARE_INTENT: 'share_intent',
  SHARE_LANDING_VIEW: 'share_landing_view',
  SHARE_FIRST_ACTION: 'share_first_action',
  SHARE_REVISIT: 'share_revisit',
};

const FIRST_ENTRY_KEY = 'shareFirstEntryV1';
const FIRST_ACTION_PREFIX = 'shareFirstActionV1:';

function storageGet(key, fallback) {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return fallback;
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(key, value);
  } catch (e) {}
}

function cleanParams(params) {
  const out = {};
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else {
      out[k] = String(v).slice(0, 64);
    }
  });
  return out;
}

function track(event, params) {
  const data = cleanParams(params);
  try {
    if (typeof wx !== 'undefined' && typeof wx.reportEvent === 'function') {
      wx.reportEvent(event, data);
    }
    if (typeof console !== 'undefined' && console.info) {
      console.info('[share-analytics]', event, data);
    }
  } catch (e) {}
  return data;
}

function entryPayload(entry, defaultType, defaultId) {
  return {
    entry_type: (entry && entry.entryType) || defaultType || 'home',
    entry_id: (entry && (entry.spotId || entry.sceneId)) || defaultId || 'home',
    source: (entry && entry.source) || 'direct',
  };
}

function trackShareIntent(entryType, entryId) {
  return track(EVENTS.SHARE_INTENT, {
    entry_type: entryType,
    entry_id: entryId || 'all',
  });
}

function captureLanding(entry, defaultType, nowTs) {
  if (!entry || !entry.source || entry.source === 'direct') return;
  const payload = entryPayload(entry, defaultType);
  track(EVENTS.SHARE_LANDING_VIEW, payload);

  const day = release.toDateStr(new Date(nowTs || Date.now()));
  const prev = storageGet(FIRST_ENTRY_KEY, null);
  if (prev && prev.day && prev.entry_type === payload.entry_type && prev.entry_id === payload.entry_id) {
    const diff = release.diffDays(prev.day, day);
    if (diff > 0) {
      track(EVENTS.SHARE_REVISIT, Object.assign({}, payload, { day_offset: diff }));
    }
    return;
  }
  storageSet(FIRST_ENTRY_KEY, {
    day,
    entry_type: payload.entry_type,
    entry_id: payload.entry_id,
    source: payload.source,
  });
}

function trackFirstAction(entry, actionType) {
  if (!entry || !entry.source || entry.source === 'direct') return;
  const payload = entryPayload(entry);
  const day = release.toDateStr(new Date());
  const key = FIRST_ACTION_PREFIX + payload.entry_type + ':' + payload.entry_id + ':' + day;
  if (storageGet(key, false)) return;
  storageSet(key, 1);
  track(EVENTS.SHARE_FIRST_ACTION, Object.assign({}, payload, {
    share_action_type: actionType === 'trip-only' ? 'trip_only' : 'reminder',
  }));
}

module.exports = {
  EVENTS,
  track,
  trackShareIntent,
  captureLanding,
  trackFirstAction,
  _internal: { cleanParams, entryPayload },
};
