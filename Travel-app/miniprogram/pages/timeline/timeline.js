const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

const { spotsListCards } = require('../../utils/mock.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navOpacity: 0,
    tripId: '',
    cityBg: '/images/cities/beijing.png',
    /* 表单：与首页形态1一致（二级页「添加提醒」内容同首页，仅导航栏不同） */
    startDate: '',
    endDate: '',
    dateRangeText: '',
    dayCount: 0,
    showCalendar: false,
    minDate: '',
    maxDate: '',
    selectedSpots: [],
    selectedSpotIds: [],
    /* 时间线 */
    viewMode: 'departure',
    /* 按景点视图后续开放，本轮先隐藏 */
    showSpotView: false,
    tabs: [],
    activeTab: '',
    events: [],
    closedSpots: [],
    empty: false,
    emptyReason: '',
    cartSummary: null,
    cartCount: 0,
    showCartPopup: false,
    showSpotPopup: false,
    popupSpotId: '',
    loading: true,
    submitting: false,
  },

  /* 导航栏背景：透明 → 滚动 50px 内渐变不透明（与首页一致） */
  onPageScroll(e) {
    const scrollTop = (e.detail && e.detail.scrollTop) || 0;
    this.setData({ navOpacity: Math.min(scrollTop / 50, 1) });
  },

  onLoad(options) {
    const g = app.globalData;
    const win = wx.getWindowInfo();
    const now = new Date();
    const tripId = options.tripId || g.currentTripId || '';
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      tripId,
      minDate: this.fmtDate(now),
      maxDate: this.fmtDate(new Date(now.getTime() + 90 * 86400000)),
    });
    if (tripId) {
      this.loadTimeline();
      this.loadCart();
    } else {
      this.setData({ loading: false });
    }
  },

  onShow() {
    if (this.data.tripId) {
      this.loadCart();
    }
  },

  fmtDate(d) {
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
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
  },

  onCalendarClose() {
    this.setData({ showCalendar: false });
  },

  onMoreSpots() {
    const spotIds = this.data.selectedSpotIds;
    wx.navigateTo({ url: '/pages/spots/spots?tripId=' + this.data.tripId + '&spotIds=' + spotIds.join(',') });
  },

  loadSelectedSpots(ids) {
    if (!ids || ids.length === 0) return;
    api.spots.batch(ids).then(res => {
      this.setData({ selectedSpots: util.markSpotsSelected(res.data || [], ids), selectedSpotIds: ids });
    }).catch(() => {
      this.setData({ selectedSpots: util.markSpotsSelected(spotsListCards().filter(s => ids.indexOf(s.spotId) >= 0), ids), selectedSpotIds: ids });
    });
  },

  /* 生成/重新生成：已有行程则更新范围与景点后重算；否则新建行程（真实后端会合并 TRIP-RULE-002） */
  onGenerateTimeline() {
    if (!this.data.startDate || this.data.selectedSpotIds.length === 0) {
      wx.showToast({ title: '先选择行程日期和想去景点吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在生成...' });
    const payload = {
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
    };
    /* 2026-08-31 起取消自动合并（TRIP-RULE-002）：在已生成行程上重新生成 → 严格按本次输入的日期与景点替换，不做并集 */
    const req = this.data.tripId
      ? api.reminder.trip.list().then(res => {
          const cur = (res.trips || []).find(t => t._id === this.data.tripId);
          if (cur && util.rangesMerge(cur.startDate, cur.endDate, payload.startDate, payload.endDate)) {
            return Promise.all([
              api.reminder.trip.updateRange({
                tripId: cur._id,
                startDate: payload.startDate,
                endDate: payload.endDate,
              }),
              api.reminder.trip.updateSpots({
                tripId: cur._id,
                spotIds: payload.spotIds,
              }),
            ]).then(() => cur._id);
          }
          return api.reminder.trip.create(payload).then(res2 => res2.tripId);
        })
      : api.reminder.trip.create(payload).then(res => res.tripId);
    req.then(tripId => {
      wx.hideLoading();
      app.globalData.currentTripId = tripId;
      this.setData({ tripId });
      this.loadTimeline();
      this.loadCart();
    }).catch(err => {
      wx.hideLoading();
      api.toastError(err);
    });
  },

  loadTimeline(keepTab) {
    this.setData({ loading: true });
    api.reminder.timeline.generate({ tripId: this.data.tripId }).then(res => {
      const tabs = this.data.viewMode === 'departure' ? res.byDeparture : res.bySpot;
      /* 加完提醒/清单变化后刷新时保留当前 Tab；重新生成/切换视图时回到第一个 Tab */
      let activeTab = '';
      if (keepTab && this.data.activeTab) {
        activeTab = tabs.some(t => t.key === this.data.activeTab) ? this.data.activeTab : (tabs.length > 0 ? tabs[0].key : '');
      } else {
        activeTab = tabs.length > 0 ? tabs[0].key : '';
      }
      const events = this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []);
      const trip = res.trip || {};
      const patch = {};
      /* 用行程回填表单（首次进入或行程变化时），不覆盖用户刚填的值 */
      if (trip.startDate && trip.endDate && (this.data.startDate !== trip.startDate || this.data.endDate !== trip.endDate)) {
        patch.startDate = trip.startDate;
        patch.endDate = trip.endDate;
        patch.dateRangeText = util.formatDateRange(trip.startDate, trip.endDate);
        patch.dayCount = util.dayDiff(trip.startDate, trip.endDate);
      }
      this.setData(Object.assign({
        tripId: this.data.tripId,
        tabs,
        activeTab,
        events,
        closedSpots: res.closedSpots || [],
        empty: res.empty,
        emptyReason: res.emptyReason,
        loading: false,
      }, patch));
      if (patch.startDate && this.data.selectedSpotIds.length === 0 && (trip.spotIds || []).length > 0) {
        this.loadSelectedSpots(trip.spotIds);
      }
    }).catch(() => {
      this.setData({ loading: false, empty: true, emptyReason: '加载失败，请重试' });
    });
  },

  loadCart() {
    api.reminder.cart.list(this.data.tripId).then(res => {
      this.setData({
        cartSummary: res.summary,
        cartCount: res.summary ? res.summary.count : 0,
      });
    }).catch(() => {});
  },

  onSwitchView(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode }, () => {
      this.loadTimeline();
    });
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key;
    const tab = this.data.tabs.find(t => t.key === key);
    this.setData({ activeTab: key, events: this.decorateEvents(tab ? tab.events : []) });
  },

  /* 事件装饰：左侧日期文案（今天 / M月D日，不带年）+ 按钮副文案
   * 副文案时机：IN_CART（已加清单）→ 开票倒计时；BOOKABLE（立即预约）→「该景点已开票」；其余状态无副文案
   */
  decorateEvents(events) {
    const now = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    return (events || []).map(ev => {
      let releaseDateLabel = '';
      const dStr = ev.releaseDateStr || '';
      if (dStr) {
        if (dStr === todayStr) {
          releaseDateLabel = '今天';
        } else {
          const parts = dStr.split('-');
          releaseDateLabel = parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
        }
      }
      let btnSub = '';
      if (ev.status === 'BOOKABLE') {
        btnSub = '该景点已开票';
      } else if (ev.status === 'SELECTABLE') {
        /* 倒计时只在「添加提醒」状态、距开票时间 3 小时以内时出现 */
        const ms = new Date(ev.releaseAt).getTime() - now.getTime();
        if (ms > 0 && ms <= 3 * 3600000) {
          const h = Math.floor(ms / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          btnSub = pad(h) + 'h ' + pad(m) + 'm 后开票';
        }
      }
      return Object.assign({}, ev, { releaseDateLabel, btnSub });
    });
  },

  onAddReminder(e) {
    const event = e.currentTarget.dataset.event;
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.add({
      tripId: this.data.tripId,
      spotId: event.spotId,
      visitDate: event.visitDate,
      releaseAt: event.releaseAt,
    }).then(() => {
      wx.showToast({ title: '已加入清单', icon: 'none' });
      this.loadCart();
      this.loadTimeline(true);
      this.setData({ submitting: false });
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onAddAll() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.addAll({
      tripId: this.data.tripId,
      scope: this.data.viewMode === 'departure' ? 'departure' : 'spot',
      scopeKey: this.data.activeTab,
    }).then(res => {
      wx.showToast({ title: '已加入' + res.added + '条提醒', icon: 'none' });
      this.loadCart();
      this.loadTimeline(true);
      this.setData({ submitting: false });
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onEventAction(e) {
    const event = e.currentTarget.dataset.event;
    if (event.status === 'SELECTABLE') {
      this.onAddReminder(e);
    } else if (event.status === 'IN_CART') {
      this.onOpenCart();
    } else if (event.status === 'BOOKABLE') {
      this.onBookNow(e);
    }
  },

 /* 「立即预约」智能路由（FLOW-003 演进）：
  * 有官方小程序 → 直跳；直跳失败 / 无小程序 → 弹景区预约方式弹窗（PAGE-002）兜底 */
 onBookNow(e) {
   const event = e.currentTarget.dataset.event;
   if (event.officialAppid) {
     wx.navigateToMiniProgram({
       appId: event.officialAppid,
       path: event.officialPath || '',
       fail: () => this.openSpotPopup(event.spotId),
     });
   } else {
     this.openSpotPopup(event.spotId);
   }
 },

  onOpenCart() {
    this.setData({ showCartPopup: !this.data.showCartPopup });
  },

  onCartClose() {
    this.setData({ showCartPopup: false });
  },

  onCartChange() {
    this.loadCart();
    this.loadTimeline(true);
  },

  onStartReminder() {
    if (this.data.cartCount === 0) {
      wx.showToast({ title: '先添加至少一条提醒', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/setup/setup?tripId=' + this.data.tripId });
  },

  onSpotNameTap(e) {
    this.setData({ showSpotPopup: true, popupSpotId: e.currentTarget.dataset.id });
  },

  openSpotPopup(spotId) {
    this.setData({ showSpotPopup: true, popupSpotId: spotId });
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false });
  },

  onBack() {
    wx.navigateBack();
  },
});
