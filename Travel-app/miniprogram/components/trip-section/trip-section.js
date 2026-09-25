const util = require('../../utils/util.js');

/**
 * 行程分段容器
 *
 * 两级标题，职责不同：
 *   ① 行程分段标题（城市 + 日期范围 + 紧凑进度）—— 哪一趟。**按 weak 取舍**；
 *   ② 日期分段标题（`10月2日 · 周五` + `第1天`）—— 这趟里的哪一天，带「删除当天」菜单。
 *
 * ⚠️ 行程分段标题为什么按 weak 取舍（2026-09-21 用户口径，踩过一次才定下来）：
 * 顶部摘要卡只展示**最近即将发生或正在发生**的那一趟（`trips[0]`）。所以——
 *   - `trips[0]` 那一段用 `weak`，不渲染标题行：它与摘要卡是同一批信息，同屏重复；
 *   - 后面还没发生的行程 **必须渲染**：摘要卡没覆盖它们，没有标题行就会塌成一堆裸日期，
 *     读不出「这是独立的一段、到哪结束」。
 * 「未来行程」那行小字只是摘要卡上的**指路**，不是标题的替代品——它没有进度、
 * 也不承载分段的视觉边界。**别再把这一行一刀切删掉。**
 *
 * 已废止且不要再加回来的：行程分段标题的**吸顶**（模板 spacer、sticky/stickyTop/
 * headHeight 三个属性、页面滚动测位）；右侧「行程管理」入口（进入的是无上下文的
 * add-trip）。`menuDate` 的键也从 `tripId|visitDate` 简化为纯 `visitDate`。
 */
Component({
  properties: {
    trip: { type: Object, value: null },
    /* 是否历史上已结束的行程：灰化、无操作按钮 */
    history: { type: Boolean, value: false },
    /* 由页面统一管，保证同屏只有一个日期菜单开着 */
    menuDate: { type: String, value: '' },
    /* 行程项三点菜单的展开 itemId：页面统一管，保证同屏只有一个卡片菜单开着。
       ⚠️ 2026-09-23 踩过一次：重构时把这个声明删了，而 wxml 仍在传 `menu-id="{{menuId}}"`、
          home 也仍在传——但**没声明的属性不会进组件 data**，模板里的 `{{menuId}}`
          解析为 undefined，trip-card 的 `menuOpen` 永远 false。
          事件链（menutoggle 一路到 home 的 setData）全程是通的，日志都在打，
          唯独值回不来——表现是「点菜单 icon 没反应且不报错」。
          wxml 里被引用的属性必须在这里声明，删属性先删模板引用。 */
    menuId: { type: String, value: '' },
    /* 已被划掉的气泡（itemId 集合） */
    dismissed: { type: Array, value: [] },
    /* 有候选可挽回的 itemId 集合（服务端三层规则判定后回传） */
    recoverableIds: { type: Array, value: [] },
    /* ⚠️ 由页面决定（`trips.length === 1`）：**只有一趟行程**时该段与摘要卡完全重复，
       连标题行一起弱化不渲染。单行程是最常见形态，这一条撑住了「首页是一堵干净的墙」
       的观感；两趟以上时每段都得靠标题行表明自己是哪一趟。 */
    weak: { type: Boolean, value: false },
  },

  data: {
    days: [],
    progressText: '',
    dateRange: '',
  },

  observers: {
    'trip, menuDate, dismissed, recoverableIds': function (
      trip, menuDate, dismissed, recoverableIds
    ) {
      if (!trip) return;
      const dismissedSet = {};
      (dismissed || []).forEach(id => { dismissedSet[id] = true; });
      const recoverSet = {};
      (recoverableIds || []).forEach(id => { recoverSet[id] = true; });

      /* 按出行日分组。⚠️ wx:key 必须用 itemId——
         同一景点可以有多个备选日期，用 spotId 会重键（backendup 组正是为此存在） */
      const p = trip.progress || { done: 0, total: 0, noReservationCount: 0 };
      const map = new Map();
      (trip.items || []).forEach(it => {
        if (!map.has(it.visitDate)) map.set(it.visitDate, []);
        map.get(it.visitDate).push(Object.assign({}, it, {
          /* ⚠️ 两个气泡的忽略状态**分开算**（键是 `id` 与 `id:recover`）：
             共用一个标记时，「先忽略追问、再从菜单补标没抢到」会让新出现的
             挽回气泡被旧的忽略记录压掉，用户永远看不到「约其他日」。 */
          bubbleDismissed: !!dismissedSet[it.itemId],
          recoverDismissed: !!dismissedSet[it.itemId + ':recover'],
          recoverable: !!recoverSet[it.itemId],
        }));
      });

      const start = trip.startDate;
      const days = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([visitDate, items]) => ({
          key: visitDate,
          title: util.dayTitleOf(visitDate),
          /* 「第 1 天」——让用户在行程里定位自己在哪一段。
             2026-09-22 按设计稿改为**方括号包裹**（`【第1天】`）：徽标改成了金色底，
             方括号让它在视觉上更明确是「这一段是第几天」的标记，而不是一个可点的标签。
             ⚠️ 数字两侧不加空格（设计稿是 `第1天`，旧实现是 `第 1 天`）。 */
          badge: '【第' + (util.dayDiff(start, visitDate)) + '天】',
          items,
          /* 菜单键只认 visitDate：同屏只会展开一趟行程的某一天
             （同一天出现在两趟行程里本就罕见，且这样不必再把 tripId 编进键里）。 */
          menuOpen: menuDate === visitDate,
        }));

      this.setData({
        days,
        dateRange: util.monthDayRange(trip.startDate, trip.endDate),
        progressText: p.total > 0 ? ('搞定 ' + p.done + '/' + p.total) : '随到随玩',
      });
    },
  },

  methods: {
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
    /* 蒙层上的 touchmove 吞掉，防止在蒙层上拖动时页面跟着滚 */
    noop() {},

    /* ==== 以下把 trip-card 的事件原样上抛给页面 ==== */
    onCardSpot(e) { this.triggerEvent('spot', e.detail); },
    onCardMenuToggle(e) { this.triggerEvent('menutoggle', e.detail); },
    /* ⚠️ 原来这里还有一个 `onCardMenu` → `triggerEvent('menu')`，已删。
       它是**问题三的根因**：trip-card 把「菜单开合」和「编辑提醒」抛成同一个
       `menu`，trip-section 原样上抛，而页面把 bind:menu 接在了「弹编辑浮层」上——
       于是点三点菜单直接弹出改提醒的设置面板，看起来就是"菜单没触发"。
       拆成 menutoggle / editreminder 后，这个共用事件名必须消失，
       留着就是下一个「抛了但没人听」的静默失效点。 */
    onCardMark(e) { this.triggerEvent('mark', e.detail); },
    onCardEditReminder(e) { this.triggerEvent('editreminder', e.detail); },
    onCardRemove(e) { this.triggerEvent('remove', e.detail); },
    onCardResult(e) { this.triggerEvent('result', e.detail); },
    onCardDismiss(e) { this.triggerEvent('dismiss', e.detail); },
    /* 「还有其他日期可约」气泡的忽略——与上面那个**是两个不同的语义**
       （别问我结果 ≠ 别给我挽回方案），页面据此分开记 key。 */
    onCardDismissRecover(e) { this.triggerEvent('dismissrecover', e.detail); },
    onCardRecover(e) { this.triggerEvent('recover', e.detail); },
    onCardMissedReason(e) { this.triggerEvent('missedreason', e.detail); },
  },
});
