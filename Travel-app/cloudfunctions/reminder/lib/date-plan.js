/**
 * 景点 + 出行日期 → 提醒资格的唯一纯函数真身。
 *
 * 景点卡片、详情和分享轻量入口都先调用 `cart.planDates`，再调用
 * `cart.addDates`。客户端不得根据 advanceDays / releaseTime 自行重算资格。
 */

const item = require('./item');

const DATE_PLAN_STATUS = Object.freeze({
  REMINDABLE: 'REMINDABLE',
  TRIP_ONLY: 'TRIP_ONLY',
  IN_CART: 'IN_CART',
  IN_TRIP: 'IN_TRIP',
});

const DATE_PLAN_REASON = Object.freeze({
  RELEASE_PASSED: 'RELEASE_PASSED',
  NO_RESERVATION: 'NO_RESERVATION',
  NO_FIXED_RELEASE: 'NO_FIXED_RELEASE',
  IN_CART: 'IN_CART',
  IN_TRIP: 'IN_TRIP',
});

function normalizeVisitDates(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.filter(Boolean).map(String))].sort();
}

function planOne({ spot, rule, visitDate, nowTs, cartDates, tripDates }) {
  const existingCart = !!(cartDates && cartDates.has(visitDate));
  const existingTrip = !!(tripDates && tripDates.has(visitDate));
  const releaseAt = item.deriveReleaseAt(spot, rule, visitDate);
  const releaseMs = releaseAt ? new Date(releaseAt).getTime() : 0;

  let status;
  let reason = '';
  if (existingTrip) {
    status = DATE_PLAN_STATUS.IN_TRIP;
    reason = DATE_PLAN_REASON.IN_TRIP;
  } else if (existingCart) {
    status = DATE_PLAN_STATUS.IN_CART;
    reason = DATE_PLAN_REASON.IN_CART;
  } else if (!spot || spot.reservationRequired === false) {
    status = DATE_PLAN_STATUS.TRIP_ONLY;
    reason = DATE_PLAN_REASON.NO_RESERVATION;
  } else if (!releaseAt) {
    status = DATE_PLAN_STATUS.TRIP_ONLY;
    reason = DATE_PLAN_REASON.NO_FIXED_RELEASE;
  } else if (releaseMs <= new Date(nowTs).getTime()) {
    status = DATE_PLAN_STATUS.TRIP_ONLY;
    reason = DATE_PLAN_REASON.RELEASE_PASSED;
  } else {
    status = DATE_PLAN_STATUS.REMINDABLE;
  }

  return {
    visitDate,
    status,
    reason,
    releaseAt,
    addable: status === DATE_PLAN_STATUS.REMINDABLE || status === DATE_PLAN_STATUS.TRIP_ONLY,
    reminderAllowed: status === DATE_PLAN_STATUS.REMINDABLE,
  };
}

function summarize(dates) {
  const summary = {
    requested: dates.length,
    addable: 0,
    reminder: 0,
    tripOnly: 0,
    existing: 0,
    releasePassed: 0,
    noFixedRelease: 0,
    noReservation: 0,
  };
  dates.forEach(row => {
    if (row.addable) summary.addable += 1;
    if (row.reminderAllowed) summary.reminder += 1;
    if (row.status === DATE_PLAN_STATUS.TRIP_ONLY) summary.tripOnly += 1;
    if (row.status === DATE_PLAN_STATUS.IN_CART || row.status === DATE_PLAN_STATUS.IN_TRIP) summary.existing += 1;
    if (row.reason === DATE_PLAN_REASON.RELEASE_PASSED) summary.releasePassed += 1;
    if (row.reason === DATE_PLAN_REASON.NO_FIXED_RELEASE) summary.noFixedRelease += 1;
    if (row.reason === DATE_PLAN_REASON.NO_RESERVATION) summary.noReservation += 1;
  });
  return summary;
}

function build({ spot, rule, visitDates, nowTs, cartDates, tripDates }) {
  const dates = normalizeVisitDates(visitDates).map(visitDate => planOne({
    spot,
    rule,
    visitDate,
    nowTs,
    cartDates,
    tripDates,
  }));
  return { dates, summary: summarize(dates) };
}

module.exports = {
  DATE_PLAN_STATUS,
  DATE_PLAN_REASON,
  normalizeVisitDates,
  summarize,
  build,
};
