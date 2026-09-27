const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

const { spotsListCards } = require('../../utils/mock.js');

/**
 * 热门网格里**除 S 级外额外保留**的景点（2026-09-24 用户口径）。
 *
 * 只影响这个网格的选卡范围，**不动任何难度数据**：纪念堂照实显示「较难约」，
 * 景点 Tab / spots 列表 / spot-popup / 运营 skill 的口径一律不变。
 * 详细因由见 `buildHotSpots` 的注释。
 */
const EXTRA_HOT_IDS = ['maozhuxi-jiniantang'];

/* 滚多少像素把导航栏底色从全透明推到不透明（与首页一致）。 */
const NAV_FADE_PX = 50;

/**
 * 添加提醒 · 表单 + 专属放票时间线（PAGE-005，2026-09-20 拆为独立页）
 *
 * 从首页剥离出来的原因：新首页只剩行程状态墙，表单不该再混在里面；
 * 首页的悬浮「+ 新增提醒」跳到这里，提交后自动返回。
 *
 * ⚠️ **「生成」是纯预览**（决策文档 2026-09-20 条目 6）：
 *   只按当前所选日期段与景点独立计算，不创建、不改写任何行程；
 *   历史行程与已提交项的状态**不带入**预览。
 *   行程的创建与合并判定（TRIP-RULE-002）挪到提交清单时执行。
 */
Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    /* 导航栏底色不透明度：0 = 全透明，1 = 填满页面底色。滚 NAV_FADE_PX 推满。 */
    navOpacity: 0,
    minDate: '',
    maxDate: '',

    startDate: '',
    endDate: '',
    dateRangeText: '',
    dayCount: 0,
    showCalendar: false,
    selectedSpots: [],
    selectedSpotIds: [],
    hotSpots: [],

    showTimeline: false,
    timelineTabs: [],
    timelineDays: [],
    timelineActiveTab: '',
    scrollIntoView: '',
    timelineEvents: [],
    /* ⚠️ 这里原有 `timelineClosedSpots`（闭馆/无放票时刻提示列表），2026-09-24 随
       底部提示块一并删除——行程一跨周一就是每个景点一行的恒定噪音，见 wxml 里的注释。
       服务端返回的 `closedSpots` / `closedDaySkips` **保留不动**（数据契约不缩水），
       只是页面不再消费。 */
    timelineEmpty: false,
    timelineEmptyReason: '',
    timelineLoading: false,
    submitting: false,

    showCartPopup: false,
    cartCount: 0,
    cartReminderCount: 0,
    cartText: '清单为空',

    showSpotPopup: false,
    popupSpotId: '',

    /* 从某趟进行中行程进来时的 tripId（首页预填）。只用于两件事：
       ① 生成预览时把**这一趟**已有的项标成「已加入行程」禁选；
       ② 让用户看得见自己在往哪趟行程里补。
       它不是「要写入的行程」——行程的创建与合并仍由提交时的 TRIP-RULE-002 决定。 */
    entryTripId: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const now = new Date();
    const opts = options || {};
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      minDate: this.fmtDate(now),
      maxDate: this.fmtDate(new Date(now.getTime() + 90 * 86400000)),
      entryTripId: opts.tripId || '',
    });
    /* 从首页某趟进行中的行程进来 → 预填它的日期段与景点。
       ⚠️ 预填的只有**表单**（顶部日期 + 景点），生成的预览仍按这次的输入即时算，
       与那趟行程的既成状态无关（见 onGenerateTimeline 的注释）。 */
    this.prefillFromTrip(opts);
    this.loadHotSpots();
    this.loadCart();
  },

  /**
   * 预填表单：日期段 + 景点。
   * 景点名要显示成标签，而 URL 里只有 id，故走 spots.batch 取名字；
   * 取不到（网络失败 / USE_MOCK 切换期）就只预填日期，不阻断用户操作。
   */
  prefillFromTrip(opts) {
    const startDate = opts.startDate || '';
    const endDate = opts.endDate || startDate;
    const ids = (opts.spotIds || '').split(',').filter(Boolean);
    const patch = {};
    if (startDate && endDate) {
      patch.startDate = startDate;
      patch.endDate = endDate;
      patch.dateRangeText = util.formatDateRange(startDate, endDate);
      patch.dayCount = util.dayDiff(startDate, endDate);
    }
    if (ids.length > 0) patch.selectedSpotIds = ids;
    if (Object.keys(patch).length > 0) this.setData(patch);
    if (ids.length === 0) return;
    api.spots.batch(ids).then(res => {
      const list = util.markSpotsSelected(res.data || [], ids);
      /* 只在用户还没动过景点时回填，避免覆盖他预填后立刻手点掉的选择 */
      if (this.data.selectedSpotIds.join(',') === ids.join(',')) {
        this.setData({ selectedSpots: list });
      }
    }).catch(() => {});
  },

  onShow() {
    this.loadCart();
  },

  /**
   * 导航栏底色：滚 NAV_FADE_PX 的过程中不透明度 0 → 100%。
   *
   * ⚠️ 与首页 `home.js` 同一口径（含下面那段「两种事件形态都要认」的坑，
   *    首页那里踩过一次：只认 `e.detail.scrollTop` 时滚动值恒为 0）。
   *    本页是 `bindscroll`（scroll-view 事件），微信给的**就是 `e.detail.scrollTop`**，
   *    仍照抄双形态是因为 `page-scroll` 一旦换回页面级 `onPageScroll` 就会静默失效。
   *
   * ⚠️ 逐帧给值而不是「到阈值切一个类」——后者是硬切，中间那一帧看起来像闪一下。
   * ⚠️ 只在值真的变了才 setData：每帧带上一个没变的浮点也会触发一次 diff。
   *
   * 时间线头部的吸顶**不在这里**：那是 wxss 的 `position: sticky`，渲染层自己算。
   */
  onScroll(e) {
    const d = e && e.detail;
    const scrollTop = (d && typeof d.scrollTop === 'number')
      ? d.scrollTop
      : ((e && e.scrollTop) || 0);
    const navOpacity = Math.min(1, Math.max(0, scrollTop / NAV_FADE_PX));
    if (navOpacity !== this.data.navOpacity) this.setData({ navOpacity });
    this.scheduleTimelineSpy();
  },

  /** 滚动时延迟测量当前出游日，避免每帧同步查询节点。 */
  scheduleTimelineSpy() {
    if (!this.data.showTimeline || !this.data.timelineDays.length) return;
    if (this._anchorLockUntil && Date.now() < this._anchorLockUntil) return;
    if (this._timelineSpyTimer) clearTimeout(this._timelineSpyTimer);
    this._timelineSpyTimer = setTimeout(() => this.refreshActiveTimelineDay(), 80);
  },

  /** 以吸顶日期锚点下方为判定线，取最后一个已经越线的日期分组。 */
  refreshActiveTimelineDay() {
    if (!this.data.showTimeline || !this.data.timelineDays.length) return;
    const query = this.createSelectorQuery ? this.createSelectorQuery() : (wx.createSelectorQuery && wx.createSelectorQuery());
    if (!query || !query.selectAll) return;
    query.selectAll('.timeline-day').boundingClientRect(rects => {
      const list = rects || [];
      if (!list.length) return;
      const screenW = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 375;
      const threshold = this.data.statusBarHeight + this.data.navBarHeight + (150 / 750 * screenW);
      let key = this.data.timelineActiveTab;
      list.forEach(rect => {
        if (rect && rect.top <= threshold && rect.id) {
          key = rect.id.replace('timeline-day-', '');
        }
      });
      if (key && key !== this.data.timelineActiveTab) this.setData({ timelineActiveTab: key });
    }).exec();
  },

  /**
   * 顶部日期不是筛选 Tab，而是锚点：
   * 点击滚动到对应出游日，滚动时由 scroll spy 反向更新选中态。
   */
  onDateAnchorTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this._anchorLockUntil = Date.now() + 600;
    this.setData({ timelineActiveTab: key, scrollIntoView: '' }, () => {
      setTimeout(() => this.setData({ scrollIntoView: 'timeline-day-' + key }), 20);
    });
  },

  onBack() {
    wx.navigateBack();
  },

  fmtDate(d) {
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  /* ===== 表单 ===== */

  onCityTap() {
    wx.showToast({ title: '更多城市即将开放', icon: 'none' });
  },

  onDateCardTap() {
    this.setData({ showCalendar: true });
  },

  onCalendarConfirm(e) {
    const { start, end } = e.detail;
    this.setData({
      startDate: start,
      endDate: end,
      dateRangeText: util.formatDateRange(start, end),
      dayCount: util.dayDiff(start, end),
      showCalendar: false,
    });
    /* 日期段变了 → 预览作废（它是按旧范围算的），必须重新生成 */
    if (this.data.showTimeline) this.setData({ showTimeline: false, timelineDays: [], timelineEvents: [] });
  },

  onCalendarClose() {
    this.setData({ showCalendar: false });
  },

  onMoreSpots() {
    wx.navigateTo({ url: '/pages/spots/spots?spotIds=' + this.data.selectedSpotIds.join(',') });
  },

  loadHotSpots() {
    api.spots.list().then(res => {
      this.setData({ hotSpots: this.buildHotSpots(res.data || [], this.data.selectedSpotIds) });
    }).catch(() => {
      this.setData({ hotSpots: this.buildHotSpots(spotsListCards(), this.data.selectedSpotIds) });
    });
  },

  /**
   * 热门网格 = S 级（需预约 + 难度≥4）**加几个点名保留的景点**，最多 10 个。
   *
   * ⚠️ **`EXTRA_HOT_IDS` 是加了锁定卡片、不是改了难度分**（2026-09-24 用户口径）：
   * 纪念堂在 2026-09-15 的 V3 重评里由 4 分降到 3 分（原分值依据「固定补放」已证伪，
   * 用户当日确认），所以它被 `>= 4` 筛出了这个网格。
   * 用户要它回到「北京热门景点预约状态」里，但**难度分不动**——
   * 卡片照实显示「较难约」，全站（景点 Tab / spots 列表 / spot-popup / 运营 skill）
   * 的数据口径一律不变。别图省事去改 `difficultyScore`：那会连带改掉四处。
   *
   * ⚠️ 这里返回的是服务端排好序的切片（`spots.list` 已按 popularityScore 降序，SORT-RULE-001），
   * 所以 `push` 进来的补充景点会排在末尾 —— 网格顺序稳定，不会因为补一个就重排。
   */
  buildHotSpots(rawSpots, selectedIds) {
    const sTier = (rawSpots || []).filter(s =>
      s.reservationRequired !== false
      && ((s.difficultyScore || 0) >= 4 || EXTRA_HOT_IDS.indexOf(s.spotId) >= 0));
    return util.markSpotsSelected(sTier, selectedIds).slice(0, 10);
  },

  onSpotSelectToggle(e) {
    const spotId = e.currentTarget.dataset.id;
    const spot = e.currentTarget.dataset.spot;
    /* 免预约景点可加入行程；仅「需预约但无固定放票时刻」的景点不可选 */
    const addable = spot && (spot.addable === true || spot.remindable || spot.reservationRequired === false);
    if (spot && !addable) {
      wx.showToast({ title: '该景点无固定放票时刻，随买随用即可', icon: 'none' });
      return;
    }
    const ids = [].concat(this.data.selectedSpotIds);
    const spots = [].concat(this.data.selectedSpots);
    const idx = ids.indexOf(spotId);
    if (idx >= 0) { ids.splice(idx, 1); spots.splice(idx, 1); }
    else { ids.push(spotId); spots.push(spot); }
    this.setData({
      selectedSpotIds: ids,
      selectedSpots: spots,
      hotSpots: this.data.hotSpots.map(card =>
        Object.assign({}, card, { selected: ids.indexOf(card.spotId) >= 0 })),
      /* 景点变了 → 预览作废 */
      showTimeline: false,
      timelineDays: [],
      timelineEvents: [],
    });
  },

  onSpotNameTap(e) {
    this.setData({ showSpotPopup: true, popupSpotId: e.currentTarget.dataset.id });
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false });
  },

  /* ===== 生成时间线（纯预览） ===== */

  /** 预览入参。两个调用点（首次生成 / 加完清单重算）必须完全一致，
      否则重算时会悄悄丢掉 committedTripId，已加入行程的项又变回可点。 */
  previewInput() {
    return {
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
      committedTripId: this.data.entryTripId,
    };
  },

  onGenerateTimeline() {
    if (!this.data.startDate || this.data.selectedSpotIds.length === 0) {
      wx.showToast({ title: '先选择行程日期和想去景点吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在生成...' });
    /* ⚠️ 仍然**不创建任何行程**：每一次生成都只按「当前所选日期段 × 景点」独立计算，
       换一批日期重新生成时不会把上一次的结果带进来（那正是旧实现的问题）。
       committedTripId 只多回答一件事——这批项里哪些**已经躺在用户此刻正在编辑的那趟
       行程里**，好把它们标成「已加入行程」禁选。它是唯一读得到的既成状态，且限定这一趟；
       不是从行程进来的（新建）就为空，与旧口径完全一致。 */
    api.reminder.timeline.preview(this.previewInput()).then(res => {
      wx.hideLoading();
      const tabs = res.byDeparture || [];
      const activeTab = tabs.length ? tabs[0].key : '';
      this.setData({
        showTimeline: true,
        timelineTabs: tabs,
        timelineDays: this.decorateTimelineDays(tabs),
        timelineActiveTab: activeTab,
        timelineEvents: this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []),
        timelineEmpty: res.empty,
        timelineEmptyReason: res.emptyReason,
      }, () => {
        setTimeout(() => this.onDateAnchorTap({ currentTarget: { dataset: { key: activeTab } } }), 30);
      });
      this.loadCart();
    }).catch(err => {
      wx.hideLoading();
      api.toastError(err);
    });
  },

  /* 左侧日期文案 + 按钮副文案 */
  decorateEvents(events) {
    const now = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const p = new Date(now.getTime() + 8 * 3600000);
    const todayStr = p.getUTCFullYear() + '-' + pad(p.getUTCMonth() + 1) + '-' + pad(p.getUTCDate());
    return (events || []).map(ev => {
      let releaseDateLabel = '';
      const dStr = ev.releaseDateStr || '';
      if (dStr) {
        if (dStr === todayStr) releaseDateLabel = '今天';
        else {
          const parts = dStr.split('-');
          releaseDateLabel = parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
        }
      }
      let btnSub = '';
      if (ev.reservationRequired === false) {
        releaseDateLabel = '随时可约';
      } else if (ev.status === 'SELECTABLE' && ev.releaseAt) {
        const ms = new Date(ev.releaseAt).getTime() - Date.now();
        if (ms > 0 && ms <= 3 * 3600000) {
          const h = Math.floor(ms / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          btnSub = pad(h) + 'h ' + pad(m) + 'm 后开票';
        } else if (ms <= 0) {
          btnSub = '加入后去行程页预约';
        }
      }
      const freeRailDateLabel = String(ev.visitDateLabel || '')
        .replace(/\s*[（(]周[一二三四五六日][）)]\s*$/, '');
      return Object.assign({}, ev, {
        releaseDateLabel,
        railDateLabel: ev.reservationRequired === false ? freeRailDateLabel : releaseDateLabel,
        btnSub,
        /* wx:key 用复合键：同一景点可以有多个备选日期 */
        eventKey: ev.spotId + '|' + ev.visitDate,
      });
    });
  },

  onInlineTabTap(e) {
    this.onDateAnchorTap(e);
  },

  /** 平铺时间线数据：每个出游日一段，事件仍走同一套装饰逻辑。 */
  decorateTimelineDays(tabs) {
    return (tabs || []).map(tab => Object.assign({}, tab, {
      events: this.decorateEvents(tab.events || []),
      anchorId: 'timeline-day-' + tab.key,
    }));
  },

  onInlineAddAll() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.addAll({
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      scope: 'departure',
      scopeKey: this.data.timelineActiveTab,
    }).then(res => {
      /* 「已加入 0 项」是个信息量为零的 toast：既没说为什么，也不告诉用户
         本来想加的项去哪了。两种必要解释——① 这些项已经在清单或行程里了
         （配合首页预填，这是常见路径，且 addBatch 是按 SELECTABLE 过滤的，
         已在行程/已在清单的项根本进不了 selectable）；② 当前出游日确实没得加。 */
      if (res.added > 0) {
        wx.showToast({ title: '已加入 ' + res.added + ' 项', icon: 'none' });
      } else if (res.skipped.length > 0) {
        wx.showToast({ title: '这 ' + res.skipped.length + ' 项已在清单或行程里', icon: 'none' });
      } else {
        wx.showToast({ title: '这一天没有可加入的项', icon: 'none' });
      }
      this.setData({ submitting: false });
      /* ⚠️ reloadPreview 里只更新事件；清单条计数要单独刷，否则批量加完
         底部还显示「0 项」，看起来也是没生效 */
      this.reloadPreview();
      this.loadCart();
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onInlineEventAction(e) {
    const event = e.currentTarget.dataset.event;
    if (event.status === 'SELECTABLE') this.onInlineAddReminder(e);
    else if (event.status === 'IN_CART') this.onInlineOpenCart();
    /* 已开票只改变顶部状态，不会把 status 变成 BOOKABLE。
       用户仍然先加入清单，提交后从首页行程项进入官方预约入口。 */
  },

  onInlineAddReminder(e) {
    const event = e.currentTarget.dataset.event;
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.add({
      spotId: event.spotId,
      visitDate: event.visitDate,
      releaseAt: event.releaseAt,
      remindOn: event.remindOnDefault,
    }).then(res => {
      /* ⚠️ 必须等**确认加成功**再弹成功 toast。原来不看返回值一律弹「已加入」，
         于是当这项已在行程里（配合首页预填，这是常见路径）时，用户看到「已加入」
         却发现清单和预览都没变——正是「按钮像坏的」那类投诉的来源。
         文案跟着按钮走：按钮已统一成「加入清单 / 加入行程」（32.png），
         toast 再写「提醒清单」会和用户刚点的那个按钮对不上。 */
      wx.showToast({
        title: (res && res.success === false)
          ? '这一项已经在行程里了'
          : (event.reservationRequired === false ? '已加入行程' : '已加清单'),
        icon: 'none',
      });
      this.setData({ submitting: false });
      this.reloadPreview();
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  /** 加完清单后刷新预览与清单条。
      预览是纯函数，重算一次就能反映「已加清单」；清单条读暂存区。 */
  reloadPreview() {
    api.reminder.timeline.preview(this.previewInput()).then(res => {
      const tabs = res.byDeparture || [];
      const keep = this.data.timelineActiveTab;
      const activeTab = tabs.some(t => t.key === keep) ? keep : (tabs.length ? tabs[0].key : '');
      this.setData({
        timelineTabs: tabs,
        timelineDays: this.decorateTimelineDays(tabs),
        timelineActiveTab: activeTab,
        timelineEvents: this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []),
        timelineEmpty: res.empty,
        timelineEmptyReason: res.emptyReason,
      });
      this.loadCart();
    }).catch(() => { this.loadCart(); });
  },

  /* ===== 清单（暂存区） ===== */

  loadCart() {
    api.reminder.cart.list().then(res => {
      const s = res.summary || {};
      const count = s.count || 0;
      const reminderCount = s.reminderCount || 0;
      this.setData({
        cartCount: count,
        cartReminderCount: reminderCount,
        cartText: count > 0
          ? ('已选 ' + count + ' 项，其中 ' + reminderCount + ' 项会提醒')
          : '清单为空',
      });
    }).catch(() => {});
  },

  onInlineOpenCart() {
    if (!this.data.cartCount) {
      wx.showToast({ title: '先加入至少一项行程', icon: 'none' });
      return;
    }
    this.setData({ showCartPopup: !this.data.showCartPopup });
  },

  onInlineCartClose() {
    this.setData({ showCartPopup: false });
  },

  onInlineCartChange() {
    this.loadCart();
    if (this.data.showTimeline) this.reloadPreview();
  },

  /**
   * 提交行程清单 —— **行程在这一刻才被创建/合并**（纯预览化后的唯一落地点）。
   * 由 cart-popup 的底部按钮触发：
   *   - 全是「不提醒」的项 → 直接提交；
   *   - 有提醒项 → 先去设置提醒页配提前量，由它调 cart.commit。
   */
  onCartSubmit(e) {
    const needSetup = e.detail && e.detail.needSetup;
    this.setData({ showCartPopup: false });

    if (needSetup) {
      /* 有提醒项 → 去设置页配提前量与通道，由它调 cart.commit。
         提交后的收尾（写 currentTripId / 回首页）走它自己的 submitTask。 */
      wx.navigateTo({ url: '/pages/setup/setup' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.commit({}).then(r => {
      this.setData({ submitting: false });
      this.afterCommit(r);
    }).catch(err => {
      this.setData({ submitting: false });
      api.toastError(err);
    });
  },

  afterCommit(res) {
    const firstTip = res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip();
    wx.showToast({
      title: firstTip ? '提醒已设置，先备好游客信息' : res.toast,
      icon: 'none',
    });
    /* 提交后回首页看新的状态墙。currentTripId 在这一刻才写 ——
       纯预览化后生成时间线不再建行程，写早了会挂到过期/错误的行程上。 */
    if (res.tripId) app.globalData.currentTripId = res.tripId;
    app.globalData.reminderSubmitted = true;
    setTimeout(() => {
      /* ⚠️ 用 `navigateBack({delta})` 而不是裸 `navigateBack()`：用户可能中途去过
         景点页（`onMoreSpots`），栈就变成 首页 → 添加提醒 → 景点页。裸退一层会把他
         丢回景点页，看起来像「提交完什么也没发生」。直接退回首页；万一栈里没有首页
         （理论上不会）就退一层，别把用户卡住。 */
      const pages = getCurrentPages();
      const homeIdx = pages.findIndex(p => p.route === 'pages/home/home');
      wx.navigateBack({ delta: homeIdx >= 0 ? pages.length - 1 - homeIdx : 1 });
    }, 900);
  },
});
