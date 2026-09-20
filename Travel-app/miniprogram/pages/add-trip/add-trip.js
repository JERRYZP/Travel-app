const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

const { spotsListCards } = require('../../utils/mock.js');

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
    timelineActiveTab: '',
    timelineEvents: [],
    timelineClosedSpots: [],
    timelineEmpty: false,
    timelineEmptyReason: '',
    timelineLoading: false,
    submitting: false,

    showCartPopup: false,
    cartCount: 0,
    cartText: '清单为空',

    showSpotPopup: false,
    popupSpotId: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const now = new Date();
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      minDate: this.fmtDate(now),
      maxDate: this.fmtDate(new Date(now.getTime() + 90 * 86400000)),
    });
    this.loadHotSpots();
    this.loadCart();
  },

  onShow() {
    this.loadCart();
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
    if (this.data.showTimeline) this.setData({ showTimeline: false, timelineEvents: [] });
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

  /* 热门网格只放 S 级（需预约 + 难度≥4），最多 10 个 */
  buildHotSpots(rawSpots, selectedIds) {
    const sTier = (rawSpots || []).filter(s => s.reservationRequired !== false && (s.difficultyScore || 0) >= 4);
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

  onGenerateTimeline() {
    if (!this.data.startDate || this.data.selectedSpotIds.length === 0) {
      wx.showToast({ title: '先选择行程日期和想去景点吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在生成...' });
    /* ⚠️ 纯预览：不传 tripId，也**不创建任何行程**。
       每一次生成都只按当前所选日期段与景点独立计算 —— 换一批日期重新生成时，
       上一条时间线的「已在行程」不会被带进来（那正是旧实现的问题）。 */
    api.reminder.timeline.preview({
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
    }).then(res => {
      wx.hideLoading();
      const tabs = res.byDeparture || [];
      const activeTab = tabs.length ? tabs[0].key : '';
      this.setData({
        showTimeline: true,
        timelineTabs: tabs,
        timelineActiveTab: activeTab,
        timelineEvents: this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []),
        timelineClosedSpots: (res.closedSpots || []).concat(res.closedDaySkips || []),
        timelineEmpty: res.empty,
        timelineEmptyReason: res.emptyReason,
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
        }
      }
      return Object.assign({}, ev, {
        releaseDateLabel,
        btnSub,
        /* wx:key 用复合键：同一景点可以有多个备选日期 */
        eventKey: ev.spotId + '|' + ev.visitDate,
      });
    });
  },

  onInlineTabTap(e) {
    const key = e.currentTarget.dataset.key;
    const tab = this.data.timelineTabs.find(t => t.key === key);
    this.setData({ timelineActiveTab: key, timelineEvents: this.decorateEvents(tab ? tab.events : []) });
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
      wx.showToast({ title: '已加入 ' + res.added + ' 项', icon: 'none' });
      this.setData({ submitting: false });
      this.reloadPreview();
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onInlineEventAction(e) {
    const event = e.currentTarget.dataset.event;
    if (event.status === 'SELECTABLE') this.onInlineAddReminder(e);
    else if (event.status === 'IN_CART') this.onInlineOpenCart();
    /* BOOKABLE（已开票）在时间线上**不给预约入口**（2026-09-20 废止第四态）：
       临期建行程时用户先提交清单，再从首页墙进官方渠道，多一步但流程干净 */
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
    }).then(() => {
      wx.showToast({
        title: event.reservationRequired === false ? '已加入行程清单' : '已加入提醒清单',
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
    api.reminder.timeline.preview({
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
    }).then(res => {
      const tabs = res.byDeparture || [];
      const keep = this.data.timelineActiveTab;
      const activeTab = tabs.some(t => t.key === keep) ? keep : (tabs.length ? tabs[0].key : '');
      this.setData({
        timelineTabs: tabs,
        timelineActiveTab: activeTab,
        timelineEvents: this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []),
        timelineClosedSpots: (res.closedSpots || []).concat(res.closedDaySkips || []),
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
      this.setData({
        cartCount: s.count || 0,
        cartText: s.count > 0 ? ('已选 ' + s.count + ' 项，覆盖 ' + s.spotCount + ' 个景点') : '清单为空',
      });
    }).catch(() => {});
  },

  onInlineOpenCart() {
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
    wx.showToast({ title: res.toast || '已加入行程', icon: 'none' });
    /* 提交后回首页看新的状态墙。currentTripId 在这一刻才写 ——
       纯预览化后生成时间线不再建行程，写早了会挂到过期/错误的行程上。 */
    if (res.tripId) app.globalData.currentTripId = res.tripId;
    app.globalData.reminderSubmitted = true;
    setTimeout(() => wx.navigateBack(), 900);
  },
});
