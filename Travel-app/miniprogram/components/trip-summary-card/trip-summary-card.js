/**
 * 全局行程摘要卡（首页唯一一张完整摘要）
 *
 * 只给**最近的一趟**未结束行程：再多的行程不重复整张卡，
 * 只在各自的紧凑分段标题上显示日期与进度（决策文档 2.4）。
 * 两张完整摘要卡会让用户每次进首页先做一次「看哪张」的选择。
 *
 * 卡底部的「即将提醒」胶囊（设计稿 UI/V.0.2-0919）：把接下来的放票时刻摊开，
 * 回答「接下来该抢什么」。⚠️ 这里一度放过一行「未来行程」小字，已按用户口径撤掉——
 * 那是行程结构信息，摘要卡底部要的是**行动信息**。
 * 文案由服务端拼好（task.buildReleasePills，用景点简称），页面只渲染。
 *
 * 版式（2026-09-21 按设计稿一比一还原）：
 *   ① 「北京之行」+ 右上角装饰英文；② 日期段与倒计时**同一行**；③ 门票搞定 N/M + 进度条；
 *   ④ 放票胶囊（上方无分隔线）。三处格式计算都收敛在 util 里
 *   （tripDisplayName / tripMetaLine / tripWatermark），组件不自己拼字符串。
 */
Component({
  properties: {
    trip: { type: Object, value: null },
    /* 即将放票的项，来自 home.bootstrap 的 stickyBanner.pills。
       ⚠️ 文案已由服务端拼好，组件不碰时间格式化。 */
    pills: { type: Array, value: [] },
  },
  data: {
    /* 「北京 10.2-10.4」→「北京之行」 */
    displayName: '',
    /* 「10月2日~10月4日 · 还有27天」——日期与倒计时同一行 */
    metaLine: '',
    /* 右上角装饰英文，逐字符数组（见 util.tripWatermark） */
    watermark: [],
    percent: 0,
    /* 「另有 X 处景点无需预约，随到随玩」——免预约项不进 N/M 分母，但也不能让它消失 */
    noReservation: 0,
  },
  observers: {
    trip: function (trip) {
      if (!trip) return;
      const util = require('../../utils/util.js');
      const p = trip.progress || { done: 0, total: 0, noReservationCount: 0 };
      this.setData({
        displayName: util.tripDisplayName(trip),
        /* ⚠️ 用 tripCountdownTextOf（行程级）而不是 countdownTextOf（景点级）：
           后者在进行中显示「就是今天」，摘要卡要的是「进行中第N天」。 */
        metaLine: util.tripMetaLine(trip.startDate, trip.endDate,
          util.tripCountdownTextOf(trip.startDate, trip.endDate)),
        watermark: util.tripWatermark(trip),
        percent: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
        noReservation: p.noReservationCount || 0,
      });
    },
  },
  methods: {
    /* 点胶囊 → 打开该景点的详情浮窗（预约入口 + 倒计时）。
       ⚠️ 这里的合理动作是「去看看这张票」，不是「新增提醒」——
       旧「未来行程」那行小字曾接到 onAddTrip，那是语义错配。 */
    onPillTap(e) {
      const d = e.currentTarget.dataset;
      this.triggerEvent('pill', { itemId: d.id, spotId: d.spot });
    },
  },
});
