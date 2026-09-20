/**
 * 全局行程摘要卡（首页唯一一张完整摘要）
 *
 * 只给**最近的一趟**未结束行程：再多的行程不重复整张卡，
 * 只在各自的紧凑分段标题上显示日期与进度（决策文档 2.4）。
 * 两张完整摘要卡会让用户每次进首页先做一次「看哪张」的选择。
 */
Component({
  properties: {
    trip: { type: Object, value: null },
  },
  data: {
    dateRange: '',
    countdown: '',
    percent: 0,
    /* 「另有 X 处随到随玩」——免预约项不进 N/M 分母，但也不能让它消失 */
    noReservation: 0,
  },
  observers: {
    trip: function (trip) {
      if (!trip) return;
      const util = require('../../utils/util.js');
      const p = trip.progress || { done: 0, total: 0, noReservationCount: 0 };
      this.setData({
        dateRange: util.monthDayRange(trip.startDate, trip.endDate),
        countdown: util.countdownTextOf(trip.startDate),
        percent: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
        noReservation: p.noReservationCount || 0,
      });
    },
  },
});
