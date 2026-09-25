/**
 * 日历上下文：从 home.bootstrap 的 trips/history 收集已有行程日期。
 *
 * - tripDates：所有已有行程覆盖的日期，用于浅色条带；
 * - bookedDates：当前景点已经存在的日期，用于禁用重复添加。
 */
function collectTripCalendarDates(trips, history, spotId) {
  const tripDates = new Set();
  const bookedDates = new Set();
  (trips || []).concat(history || []).forEach(trip => {
    ((trip && trip.items) || []).forEach(item => {
      if (!item || !item.visitDate) return;
      tripDates.add(item.visitDate);
      if (spotId && item.spotId === spotId) bookedDates.add(item.visitDate);
    });
  });
  return {
    tripDates: Array.from(tripDates),
    bookedDates: Array.from(bookedDates),
  };
}

function fromHomeBootstrap(res, spotId) {
  return collectTripCalendarDates(
    (res && res.trips) || [],
    (res && res.history) || [],
    spotId
  );
}

module.exports = { collectTripCalendarDates, fromHomeBootstrap };
