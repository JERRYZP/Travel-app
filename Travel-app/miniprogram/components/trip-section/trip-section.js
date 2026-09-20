const util = require('../../utils/util.js');

/**
 * 行程分段容器
 *
 * 两级标题，职责不同，都必须「一眼看出归属」：
 *   ① 行程分段标题（城市 + 日期范围 + 紧凑进度 + 右侧行程管理入口）—— 哪一趟；
 *   ② 日期分段标题（`10月2日 · 周五` + `第1天`）—— 这趟里的哪一天。
 *
 * 行程标题在区间内**吸顶**；日期标题带「删除当天行程」菜单，
 * 对应删除动线的第二层（删某一天的全部行程项）。
 *
 * ⚠️ 吸顶**不用 position: sticky**（skyline 下表现不稳），
 * 沿用页面级 onPageScroll + boundingClientRect 测位 + spacer 撑高的既有做法
 * （见 pages/home 的 measureSections）。组件本身只按 `sticky` 属性渲染固定态。
 */
Component({
  properties: {
    trip: { type: Object, value: null },
    /* 是否历史上已结束的行程：灰化、无操作按钮 */
    history: { type: Boolean, value: false },
    /* 由页面统一管，保证同屏只有一个菜单开着 */
    menuId: { type: String, value: '' },
    menuDate: { type: String, value: '' },
    /* 已被划掉的气泡（itemId 集合） */
    dismissed: { type: Array, value: [] },
    /* 有候选可挽回的 itemId 集合（服务端三层规则判定后回传） */
    recoverableIds: { type: Array, value: [] },
    /* 该行程分段标题是否处于吸顶态 */
    sticky: { type: Boolean, value: false },
    /* 吸顶时距顶部的偏移（px） */
    stickyTop: { type: Number, value: 0 },
    /* 吸顶时撑高的占位高度（px），由页面测量后传入 */
    headHeight: { type: Number, value: 0 },
  },

  data: {
    days: [],
    progressText: '',
    dateRange: '',
    /* 单趟行程时分段标题弱化，看起来就是一堵干净的墙 */
    weak: false,
  },

  observers: {
    'trip, menuId, menuDate, dismissed, recoverableIds, history': function (
      trip, menuId, menuDate, dismissed, recoverableIds, history
    ) {
      if (!trip) return;
      const dismissedSet = {};
      (dismissed || []).forEach(id => { dismissedSet[id] = true; });
      const recoverSet = {};
      (recoverableIds || []).forEach(id => { recoverSet[id] = true; });

      const p = trip.progress || { done: 0, total: 0, noReservationCount: 0 };
      /* 按出行日分组。⚠️ wx:key 必须用 itemId——
         同一景点可以有多个备选日期，用 spotId 会重键（backendup 组正是为此存在） */
      const map = new Map();
      (trip.items || []).forEach(it => {
        if (!map.has(it.visitDate)) map.set(it.visitDate, []);
        map.get(it.visitDate).push(Object.assign({}, it, {
          bubbleDismissed: !!dismissedSet[it.itemId],
          recoverable: !!recoverSet[it.itemId],
          recoverHint: '',
        }));
      });

      const start = trip.startDate;
      const days = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([visitDate, items]) => ({
          key: visitDate,
          title: util.dayTitleOf(visitDate),
          /* 「第 1 天」——让用户在行程里定位自己在哪一段 */
          badge: '第 ' + (util.dayDiff(start, visitDate)) + ' 天',
          items,
          menuOpen: menuDate === trip._id + '|' + visitDate,
        }));

      this.setData({
        days,
        dateRange: util.monthDayRange(trip.startDate, trip.endDate),
        progressText: p.total > 0 ? ('搞定 ' + p.done + '/' + p.total) : '随到随玩',
        weak: this.data.weak,
      });
    },
  },

  methods: {
    onManage() {
      this.triggerEvent('manage', { tripId: this.data.trip._id });
    },
    onDateMenuToggle(e) {
      if (this.data.history) return;
      this.triggerEvent('datemenu', {
        tripId: this.data.trip._id,
        visitDate: e.currentTarget.dataset.date,
      });
    },
    onRemoveDate(e) {
      this.triggerEvent('datemenuclose');
      this.triggerEvent('removedate', {
        tripId: this.data.trip._id,
        visitDate: e.currentTarget.dataset.date,
      });
    },
    onMenuClose() { this.triggerEvent('menuclose'); },

    /* ==== 以下把 trip-card 的事件原样上抛给页面 ==== */
    onCardSpot(e) { this.triggerEvent('spot', e.detail); },
    onCardMenu(e) { this.triggerEvent('menu', e.detail); },
    onCardMark(e) { this.triggerEvent('mark', e.detail); },
    onCardEditReminder(e) { this.triggerEvent('editreminder', e.detail); },
    onCardRemove(e) { this.triggerEvent('remove', e.detail); },
    onCardResult(e) { this.triggerEvent('result', e.detail); },
    onCardDismiss(e) { this.triggerEvent('dismiss', e.detail); },
    onCardRecover(e) { this.triggerEvent('recover', e.detail); },
    onCardMissedReason(e) { this.triggerEvent('missedreason', e.detail); },
  },
});
