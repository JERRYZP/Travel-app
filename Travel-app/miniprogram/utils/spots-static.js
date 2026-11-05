/**
 * 景点静态快照读取层。
 *
 * 包内快照是弱网兜底；每天最多一次从云存储下载新版快照。列表、搜索、
 * 详情、批量和历史记录都在内存中完成，热路径不再调用 spots 云函数。
 */

const PACKAGE_SNAPSHOT = require('../data/spots-snapshot.js');

const CACHE_KEY = 'spotsSnapshotCacheV1';
const SEARCH_HISTORY_KEY = 'spotsSearchHistoryV1';
const REMOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SEARCH_HISTORY_MAX = 10;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

let activeSnapshot = PACKAGE_SNAPSHOT;

function toNow(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function beijingParts(input) {
  const shifted = new Date(toNow(input).getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}

function toDateStr(input) {
  const p = beijingParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDaysStr(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function dayNameOfStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function isOpenOn(card, dayName) {
  const open = card.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(card.closedDays || []).includes(dayName);
}

function releaseStatusOf(card, now) {
  const releaseTimes = Array.isArray(card.releaseTime)
    ? card.releaseTime
    : (card.releaseTime ? [card.releaseTime] : []);
  if (!releaseTimes.length) return 'NOT_RELEASED';
  const p = beijingParts(now);
  if (!isOpenOn(card, p.dayName)) return 'NOT_RELEASED';
  const nowMinutes = p.hour * 60 + p.minute;
  const released = releaseTimes.some(releaseTime => {
    const [hour, minute] = String(releaseTime).split(':').map(Number);
    return nowMinutes >= hour * 60 + minute;
  });
  return released ? 'BOOKABLE' : 'NOT_RELEASED';
}

function releaseSlotsOf(card) {
  if (Array.isArray(card.releaseSlots) && card.releaseSlots.length) return card.releaseSlots;
  const times = Array.isArray(card.releaseTime)
    ? card.releaseTime
    : (card.releaseTime ? [card.releaseTime] : []);
  return times.map((releaseTime, index) => ({
    key: `slot-${index + 1}`,
    releaseTime,
    advanceDays: Number(card.advanceDays),
  })).filter(slot => Number.isFinite(slot.advanceDays));
}

function isHoliday(card, dateStr) {
  return (card && Array.isArray(card.holidayRanges) ? card.holidayRanges : [])
    .some(range => Array.isArray(range)
      && range.length >= 2
      && dateStr >= range[0]
      && dateStr <= range[1]);
}

function isHighDemandDate(card, dateStr) {
  const dayName = dayNameOfStr(dateStr);
  return dayName === 'saturday' || dayName === 'sunday' || isHoliday(card, dateStr);
}

/** 与云端 computeEarliestDate 同口径：不可约时向前回退，不顺延。 */
function earliestDateOf(card, now) {
  const slots = releaseSlotsOf(card);
  if (!slots.length) return null;
  const today = toDateStr(now);
  const maxAdvance = Math.max(...slots.map(slot => {
    const weekend = Number(slot.weekendAdvanceDays);
    return Number.isFinite(weekend)
      ? Math.max(Number(slot.advanceDays), weekend)
      : Number(slot.advanceDays);
  }));
  for (let offset = maxAdvance; offset >= 0; offset -= 1) {
    const target = addDaysStr(today, offset);
    const dayName = dayNameOfStr(target);
    if (!isOpenOn(card, dayName)) continue;
    const weekend = isHighDemandDate(card, target);
    const available = slots.some(slot => {
      const advanceDays = weekend && Number.isFinite(Number(slot.weekendAdvanceDays))
        ? Number(slot.weekendAdvanceDays)
        : Number(slot.advanceDays);
      return addDaysStr(target, -advanceDays) <= today;
    });
    if (available) return target;
  }
  return null;
}

function advanceLabelOf(card) {
  const days = [];
  releaseSlotsOf(card).forEach(slot => {
    days.push(Number(slot.advanceDays));
    if (slot.weekendAdvanceDays !== undefined && slot.weekendAdvanceDays !== null) {
      days.push(Number(slot.weekendAdvanceDays));
    }
  });
  const valid = days.filter(Number.isFinite);
  if (!valid.length) return '';
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return min === max ? `提前${min}天` : `提前${min}-${max}天`;
}

function cardDescOf(card, now) {
  const p = beijingParts(now);
  if (card.peakPrice || card.offPrice) {
    const price = p.month >= 4 && p.month <= 10 ? card.peakPrice : card.offPrice;
    return price ? `随到随买，当前${price}` : '';
  }
  return card.cardPrice ? `随到随买，${card.cardPrice}` : '';
}

function hydrateCard(source, now) {
  const card = Object.assign({}, source);
  const status = releaseStatusOf(card, now);
  const remindable = card.reservationRequired !== false && !!card.remindable;
  const weak = card.reservationRequired !== false
    && card.weak === true;
  let cardDesc = cardDescOf(card, now);
  if (remindable && weak) {
    const release = Array.isArray(card.releaseTime)
      ? card.releaseTime.join('、')
      : card.releaseTime;
    const advance = advanceLabelOf(card);
    cardDesc = `${advance ? `${advance} ` : ''}${release || ''}放票 · 票量充足，无需卡点`;
  }
  else if (!remindable && card.reservationRequired !== false) cardDesc = '无固定放票时刻，随买随用';
  card.releaseStatus = status;
  card.earliestDate = earliestDateOf(card, now);
  card.stale = status === 'BOOKABLE';
  card.cardDesc = cardDesc || source.cardDesc || '';
  return card;
}

function activeSpecialNotice(card, now) {
  if (!card.specialNotice) return '';
  if (!card.specialNoticeUntil) return card.specialNotice;
  return toDateStr(now) <= card.specialNoticeUntil ? card.specialNotice : '';
}

function hydrateDetail(source, now) {
  return Object.assign(hydrateCard(source, now), {
    specialNotice: activeSpecialNotice(source, now),
  });
}

function snapshotOf(value) {
  if (!value
    || value.schemaVersion !== 'spots-snapshot/v1'
    || !Array.isArray(value.cards)
    || value.cards.length === 0) return null;
  return value;
}

function getSnapshot() {
  return activeSnapshot;
}

function setSnapshot(value) {
  const snapshot = snapshotOf(value);
  if (!snapshot) return false;
  activeSnapshot = snapshot;
  return true;
}

function loadCachedRemote() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return;
  try {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (!cached || !cached.savedAt || Date.now() - cached.savedAt > REMOTE_MAX_AGE_MS) return;
    setSnapshot(cached.snapshot);
  } catch (e) {
    // 包内快照永远可用，远程缓存损坏时静默忽略。
  }
}

loadCachedRemote();

function list(now) {
  const at = toNow(now);
  return Promise.resolve({
    success: true,
    data: activeSnapshot.cards.map(card => hydrateCard(card, at)),
    schemaVersion: activeSnapshot.schemaVersion,
    contentVersion: activeSnapshot.contentVersion,
    source: activeSnapshot === PACKAGE_SNAPSHOT ? 'package' : 'remote',
  });
}

function detail(spotId, now) {
  const found = activeSnapshot.cards.find(card => card.spotId === spotId);
  if (!found) {
    return Promise.resolve({ success: false, error: '景点不存在', errorCode: 1001 });
  }
  return Promise.resolve({
    success: true,
    data: hydrateDetail(found, toNow(now)),
    contentVersion: activeSnapshot.contentVersion,
  });
}

function batch(spotIds, now) {
  const ids = Array.isArray(spotIds) ? [...new Set(spotIds.filter(Boolean))] : [];
  const byId = {};
  activeSnapshot.cards.forEach(card => { byId[card.spotId] = card; });
  const at = toNow(now);
  return Promise.resolve({
    success: true,
    data: ids.map(id => byId[id]).filter(Boolean).map(card => hydrateCard(card, at)),
  });
}

function matchSpot(card, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  return [
    card.name,
    card.shortName,
    card.spotId,
    ...(card.aliases || []),
    card.pinyin || '',
    card.pinyinInitials || '',
  ].filter(Boolean).some(value => String(value).toLowerCase().includes(kw));
}

function readSearchHistory() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return [];
    const value = wx.getStorageSync(SEARCH_HISTORY_KEY);
    return Array.isArray(value) ? value.filter(Boolean).slice(0, SEARCH_HISTORY_MAX) : [];
  } catch (e) {
    return [];
  }
}

function rememberSearch(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return readSearchHistory();
  const next = [kw].concat(readSearchHistory().filter(item => item !== kw)).slice(0, SEARCH_HISTORY_MAX);
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(SEARCH_HISTORY_KEY, next);
  } catch (e) {
    // 历史记录只是便利功能，不阻断搜索。
  }
  return next;
}

function search(keyword, now) {
  const kw = String(keyword || '').trim();
  if (!kw) return Promise.resolve({ success: true, data: [], history: readSearchHistory() });
  const at = toNow(now);
  const data = activeSnapshot.cards
    .filter(card => matchSpot(card, kw))
    .map(card => hydrateCard(card, at))
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
  return Promise.resolve({ success: true, data, history: rememberSearch(kw) });
}

function searchHistory() {
  return Promise.resolve({ success: true, data: readSearchHistory() });
}

function clearSearchHistory() {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) wx.removeStorageSync(SEARCH_HISTORY_KEY);
  } catch (e) {}
  return Promise.resolve({ success: true, removed: 1 });
}

function cacheRemoteSnapshot(snapshot, savedAt) {
  if (!setSnapshot(snapshot)) return false;
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(CACHE_KEY, { savedAt: savedAt || Date.now(), snapshot });
    }
  } catch (e) {}
  return true;
}

module.exports = {
  CACHE_KEY,
  SEARCH_HISTORY_KEY,
  PACKAGE_SNAPSHOT,
  getSnapshot,
  setSnapshot,
  cacheRemoteSnapshot,
  list,
  detail,
  batch,
  search,
  searchHistory,
  clearSearchHistory,
  _internal: {
    beijingParts,
    toDateStr,
    addDaysStr,
    dayNameOfStr,
    isOpenOn,
    releaseStatusOf,
    earliestDateOf,
    cardDescOf,
    hydrateCard,
    hydrateDetail,
    matchSpot,
  },
};
