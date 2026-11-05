/**
 * 放票时段解析（data/rules.json 的唯一读取口径）。
 *
 * 一个景点在一个出行日可能对应多个放票时段：
 * - 军博：08:00 / 17:00 / 20:00 三个放票时刻；
 * - 清华：即时预约与抽签预约两条线，且工作日与周末/法定节假日的提前天数不同。
 *
 * 旧规则没有 releaseSlots 时继续按 advanceDays + releaseTime/releaseTimes 兼容。
 */

const time = require('./time');

const WEEKEND_DAYS = new Set(['saturday', 'sunday']);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSlot(slot, index) {
  if (!slot || !slot.releaseTime) return null;
  const advanceDays = numberOrNull(slot.advanceDays);
  if (advanceDays === null) return null;
  return {
    key: String(slot.key || `slot-${index + 1}`),
    label: String(slot.label || ''),
    releaseTime: String(slot.releaseTime),
    advanceDays,
    weekendAdvanceDays: numberOrNull(slot.weekendAdvanceDays),
  };
}

/**
 * 规则声明的全部时段，按规则顺序返回。
 * releaseSlots 优先；没有时把 releaseTimes / releaseTime 摊成单日多任务。
 */
function slotsOf(rule) {
  if (!rule) return [];
  if (Array.isArray(rule.releaseSlots) && rule.releaseSlots.length > 0) {
    return rule.releaseSlots
      .map((slot, index) => normalizeSlot(slot, index))
      .filter(Boolean);
  }

  const advanceDays = numberOrNull(rule.advanceDays);
  if (advanceDays === null) return [];
  const rawTimes = Array.isArray(rule.releaseTimes) && rule.releaseTimes.length > 0
    ? rule.releaseTimes
    : [rule.releaseTime];
  const seen = new Set();
  return rawTimes
    .filter(Boolean)
    .map(String)
    .filter(releaseTime => {
      if (seen.has(releaseTime)) return false;
      seen.add(releaseTime);
      return true;
    })
    .map((releaseTime, index) => ({
      key: `${releaseTime}-${index + 1}`,
      label: '',
      releaseTime,
      advanceDays,
      weekendAdvanceDays: null,
    }));
}

function hasSchedule(rule) {
  return slotsOf(rule).length > 0;
}

function isHoliday(rule, visitDate) {
  return (rule && Array.isArray(rule.holidayRanges) ? rule.holidayRanges : [])
    .some(range => Array.isArray(range)
      && range.length >= 2
      && visitDate >= range[0]
      && visitDate <= range[1]);
}

function advanceDaysFor(rule, slot, visitDate) {
  const highDemand = WEEKEND_DAYS.has(time.dayNameOf(visitDate)) || isHoliday(rule, visitDate);
  return highDemand && slot.weekendAdvanceDays !== null
    ? slot.weekendAdvanceDays
    : slot.advanceDays;
}

/**
 * 某个出行日对应的全部放票时刻，按 releaseAt 升序。
 * 不判断当前时刻是否已过；调用方按任务/资格语义自行筛选。
 */
function slotsForVisitDate(spot, rule, visitDate) {
  if (!visitDate || (spot && spot.reservationRequired === false)) return [];
  return slotsOf(rule)
    .map(slot => {
      const advanceDays = advanceDaysFor(rule, slot, visitDate);
      const releaseDateStr = time.addDays(visitDate, -advanceDays);
      const releaseAt = time.parseBeijing(releaseDateStr, slot.releaseTime);
      return {
        ...slot,
        advanceDays,
        releaseDateStr,
        releaseAt,
      };
    })
    .filter(slot => slot.releaseAt && Number.isFinite(slot.releaseAt.getTime()))
    .sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime());
}

/**
 * 旧客户端兼容：只使用旧的 advanceDays + releaseTime 生成单条任务。
 * 新客户端显式传 supportsMultiRelease=true 后才读取 releaseSlots。
 */
function slotsForRequest(spot, rule, visitDate, supportsMultiRelease) {
  if (supportsMultiRelease === true) return slotsForVisitDate(spot, rule, visitDate);
  if (!visitDate || !rule || !rule.advanceDays || !rule.releaseTime
    || (spot && spot.reservationRequired === false)) return [];
  const releaseDateStr = time.addDays(visitDate, -Number(rule.advanceDays));
  return [{
    key: 'legacy-release',
    label: '',
    releaseTime: String(rule.releaseTime),
    advanceDays: Number(rule.advanceDays),
    releaseDateStr,
    releaseAt: time.parseBeijing(releaseDateStr, String(rule.releaseTime)),
  }];
}

function firstReleaseAt(spot, rule, visitDate) {
  const slots = slotsForVisitDate(spot, rule, visitDate);
  return slots.length ? slots[0].releaseAt : null;
}

function nextReleaseSlot(spot, rule, visitDate, nowTs = time.now()) {
  const nowMs = new Date(nowTs).getTime();
  return slotsForVisitDate(spot, rule, visitDate)
    .find(slot => slot.releaseAt.getTime() > nowMs) || null;
}

function nextReleaseAt(spot, rule, visitDate, nowTs = time.now()) {
  const slot = nextReleaseSlot(spot, rule, visitDate, nowTs);
  return slot ? slot.releaseAt : null;
}

function taskSlotsForVisit(spot, rule, visitDate, nowTs = time.now()) {
  const nowMs = new Date(nowTs).getTime();
  return slotsForVisitDate(spot, rule, visitDate)
    .filter(slot => slot.releaseAt.getTime() > nowMs);
}

function taskSlotsForRequest(spot, rule, visitDate, nowTs = time.now(), supportsMultiRelease = false) {
  const nowMs = new Date(nowTs).getTime();
  return slotsForRequest(spot, rule, visitDate, supportsMultiRelease)
    .filter(slot => slot.releaseAt.getTime() > nowMs);
}

function slotByKey(spot, rule, visitDate, releaseKey) {
  const slots = slotsForVisitDate(spot, rule, visitDate);
  if (!releaseKey) return slots[0] || null;
  return slots.find(slot => slot.key === releaseKey) || null;
}

module.exports = {
  WEEKEND_DAYS,
  slotsOf,
  hasSchedule,
  isHoliday,
  advanceDaysFor,
  slotsForVisitDate,
  slotsForRequest,
  firstReleaseAt,
  nextReleaseSlot,
  nextReleaseAt,
  taskSlotsForVisit,
  taskSlotsForRequest,
  slotByKey,
};
