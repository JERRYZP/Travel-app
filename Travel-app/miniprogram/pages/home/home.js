const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

const { spotsListCards } = require('../../utils/mock.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navBarRight: 100,
    navOpacity: 0,
   homeMode: 1,
    cityBg: '/images/cities/beijing.png',
   loading: true,
    startDate: '',
    endDate: '',
    dateRangeText: '',
    dayCount: 0,
    showCalendar: false,
    minDate: '',
    maxDate: '',
    selectedSpots: [],
   selectedSpotIds: [],
    hotSpots: [],
   taskGroups: [],
    activeFilter: 'active',
    counts: { active: 0, expired: 0 },
    banner: null,
    trips: [],
    activeTripTab: '',
    showGroupTabs: false,
    showSpotPopup: false,
    popupSpotId: '',
    badge: 0,
    menuTaskId: '',
    collapsedGroups: [],

    /* 形态1 内联时间线（无提醒任务时，在当前页生成，不跳转） */
    showTimeline: false,
    timelineTripId: '',
    timelineTabs: [],
    timelineActiveTab: '',
    timelineEvents: [],
    timelineClosedSpots: [],
    timelineEmpty: false,
    timelineEmptyReason: '',
    timelineLoading: false,
    timelineCartSummary: null,
    timelineCartCount: 0,
    showCartPopup: false,
    /* 时间线标题吸顶 */
    timelineSticky: false,
    timelineStickyTop: 0,
    timelineHeaderHeight: 0,
    submitting: false,
    /* 按景点视图后续开放，本轮先隐藏 */
    showSpotView: false,
  },

  /* 时间线标题在滚动内容中的自然偏移（px） */
  _headerTop: 0,
  /* 滚动位置（px），供吸顶测量使用，不参与渲染 */
  _scrollTop: 0,

  onLoad() {
    const g = app.globalData;
    const win = wx.getWindowInfo();
    const now = new Date();
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      navBarRight: win.windowWidth - g.menuButton.left + 16,
      minDate: this.fmtDate(now),
      maxDate: this.fmtDate(new Date(now.getTime() + 90 * 86400000)),
    });
  },

  onShow() {
    this.loadHomeData();
  },

  /* 导航栏背景：默认透明，滚动 50px 内逐渐变不透明，满 50px 后 100% */
  onPageScroll(e) {
    const scrollTop = (e.detail && e.detail.scrollTop) || 0;
    this._scrollTop = scrollTop;
    const patch = { navOpacity: Math.min(scrollTop / 50, 1) };
    if (this.data.menuTaskId) patch.menuTaskId = '';
    this.setData(patch);
    /* 时间线标题吸顶：滚动越过阈值后标题固定在导航栏下方 */
    if (this.data.showTimeline && this._headerTop > 0) {
      const stickTop = this.data.statusBarHeight + this.data.navBarHeight;
      const stick = scrollTop >= this._headerTop - stickTop;
      if (stick !== this.data.timelineSticky) {
        this.setData({ timelineSticky: stick });
      }
    }
  },


  /* 任务卡副标题「开抢5月31日（周四）门票」→ 拆出红色日期段（对齐设计稿） */
  decorateTaskGroups(groups) {
    const collapsed = this.data.collapsedGroups || [];
    return (groups || []).map(g => {
      const items = (g.items || []).map(t => {
        const m = /^(开抢)(.+?)(门票)$/.exec(t.grabLabel || '');
        return Object.assign({}, t, {
          grabPre: m ? m[1] : t.grabLabel,
          grabDate: m ? m[2] : '',
          grabPost: m ? m[3] : '',
        });
      });
      return Object.assign({}, g, { items, collapsed: collapsed.indexOf(g.key) !== -1 });
    });
  },

  onTaskMenuTap(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ menuTaskId: this.data.menuTaskId === id ? '' : id });
  },

  onTaskMenuClose() {
    this.setData({ menuTaskId: '' });
  },



  doClearTasks() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.task.clear().then(() => {
      this.setData({ submitting: false, menuTaskId: '' });
      this.loadHomeData();
    }).catch(err => { this.setData({ submitting: false }); api.toastError(err); });
  },

  onClearTasks() {
    if (this.data.submitting) return;
    /* 二次确认：先看还有没有「进行中」的待提醒任务 */
    api.reminder.task.list({ filter: 'active' }).then(res => {
      const pending = res.counts ? res.counts.active : 0;
      if (pending > 0) {
        wx.showModal({
          title: `还有${pending}条任务待提醒，确认删除？`,
          success: r => { if (r.confirm) this.doClearTasks(); },
        });
        return;
      }
      api.reminder.task.list({ filter: 'expired' }).then(r2 => {
        const expired = r2.counts ? r2.counts.expired : 0;
        if (expired === 0) {
          wx.showToast({ title: '没有可清空的任务', icon: 'none' });
          return;
        }
        wx.showModal({
          title: '确认清空任务？',
          success: r => { if (r.confirm) this.doClearTasks(); },
        });
      }).catch(err => api.toastError(err));
    }).catch(err => api.toastError(err));
  },

  onGroupHeaderTap(e) {
    const key = e.currentTarget.dataset.key;
    const collapsed = (this.data.collapsedGroups || []).slice();
    const i = collapsed.indexOf(key);
    if (i !== -1) collapsed.splice(i, 1); else collapsed.push(key);
    const groups = (this.data.taskGroups || []).map(g => Object.assign({}, g, { collapsed: collapsed.indexOf(g.key) !== -1 }));
    this.setData({ collapsedGroups: collapsed, taskGroups: groups });
  },

  loadHomeData() {
    this.setData({ loading: true });
    api.reminder.task.list({ filter: 'active' }).then(res => {
      const mode = res.homeMode || 1;
      this.setData({ homeMode: mode, badge: res.badge || 0, loading: false });
      if (mode === 2) {
        this.setData({
          taskGroups: this.decorateTaskGroups(res.groups),
          counts: res.counts || { active: 0, expired: 0 },
          banner: res.banner,
          showTimeline: false,
          timelineSticky: false,
          menuTaskId: '',
          showCartPopup: false,
        });
        this.loadTrips();
      } else {
        /* 形态1：已有内联时间线则保留并刷新清单，否则加载热门景点 */
        if (this.data.showTimeline && this.data.timelineTripId) {
          this.loadInlineCart();
        } else {
          this.loadHotSpots();
        }
      }
    }).catch(() => {
      this.setData({ homeMode: 1, badge: 0, loading: false });
      this.loadHotSpots();
    });
  },

 loadHotSpots() {
   api.spots.list().then(res => {
      this.setData({ hotSpots: this.buildHotSpots(res.data || [], this.data.selectedSpotIds), loading: false });
   }).catch(() => {
      this.setData({ hotSpots: this.buildHotSpots(spotsListCards(), this.data.selectedSpotIds), loading: false });
   });
 },

  /* 首页热门网格：只放 S 级（需预约 + 难度≥4），最多展示 10 个 */
  buildHotSpots(rawSpots, selectedIds) {
    const MAX = 10;
    const sTier = (rawSpots || []).filter(s => s.reservationRequired !== false && (s.difficultyScore || 0) >= 4);
    const marked = util.markSpotsSelected(sTier, selectedIds);
    return marked.slice(0, MAX);
  },

 loadTrips() {
    api.reminder.trip.list().then(res => {
      this.setData({ trips: res.trips || [], showGroupTabs: res.showGroupTabs || false });
    }).catch(() => {});
  },

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
  },

  onCalendarClose() {
    this.setData({ showCalendar: false });
  },

  fmtDate(d) {
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  onSpotSelectToggle(e) {
    const spotId = e.currentTarget.dataset.id;
    const spot = e.currentTarget.dataset.spot;
    // B 层免预约景点不可选（UI 已是「无需预约」tag，此处兜底）
    if (spot && spot.reservationRequired === false) {
      wx.showToast({ title: '该景点无需预约，现场购票即可', icon: 'none' });
      return;
    }
    const ids = [].concat(this.data.selectedSpotIds);
    const spots = [].concat(this.data.selectedSpots);
    const idx = ids.indexOf(spotId);
    if (idx >= 0) {
      ids.splice(idx, 1);
      spots.splice(idx, 1);
    } else {
      ids.push(spotId);
      spots.push(spot);
    }
    this.setData({
     selectedSpotIds: ids,
     selectedSpots: spots,
      hotSpots: this.data.hotSpots.map(card =>
        Object.assign({}, card, { selected: ids.indexOf(card.spotId) >= 0 })
      ),
   });
  },

  /* ===== 内联时间线：生成（不再跳转，当前页展示） ===== */
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
    /* 任务分组第一性原则：以本次生成的时间段与既有行程时间段是否相交/相接来判断合并（TRIP-RULE-002）。
     * 相交/相接 → 归入同一任务组（时间段取并集、景点替换为当前选择）；否则新建行程（新任务组，顶部自动多一个 Tab） */
    const req = this.data.timelineTripId
      ? api.reminder.trip.list().then(res => {
          const cur = (res.trips || []).find(t => t._id === this.data.timelineTripId);
          if (cur && util.rangesMerge(cur.startDate, cur.endDate, payload.startDate, payload.endDate)) {
            const merged = util.mergeRanges(cur.startDate, cur.endDate, payload.startDate, payload.endDate);
            return Promise.all([
              api.reminder.trip.updateRange({
                tripId: cur._id,
                startDate: merged.startDate,
                endDate: merged.endDate,
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
      this.setData({ showTimeline: true });
      this.loadInlineTimeline(tripId);
    }).catch(err => {
      wx.hideLoading();
      api.toastError(err);
    });
  },

  loadInlineTimeline(tripId, keepTab, silent) {
    /* silent=true：加完提醒/清单变化后的静默刷新——不置 loading，避免列表高度塌缩导致 scroll-view 跳回顶部 */
    this.setData({
      timelineTripId: tripId,
      ...(silent ? {} : { timelineLoading: true }),
    });
    api.reminder.timeline.generate({ tripId }).then(res => {
      const tabs = res.byDeparture || [];
      /* 加完提醒/清单变化后刷新时保留当前出游日 Tab；重新生成时回到第一个 Tab */
      let activeTab = '';
      if (keepTab && this.data.timelineActiveTab) {
        activeTab = tabs.some(t => t.key === this.data.timelineActiveTab) ? this.data.timelineActiveTab : (tabs.length > 0 ? tabs[0].key : '');
      } else {
        activeTab = tabs.length > 0 ? tabs[0].key : '';
      }
      const events = this.decorateEvents(activeTab ? (tabs.find(t => t.key === activeTab) || {}).events || [] : []);
      this.setData({
        timelineTabs: tabs,
        timelineActiveTab: activeTab,
        timelineEvents: events,
        timelineClosedSpots: res.closedSpots || [],
        timelineEmpty: res.empty,
        timelineEmptyReason: res.emptyReason,
        timelineLoading: false,
      }, () => this.measureTimelineHeader());
      this.loadInlineCart(tripId);
    }).catch(() => {
      this.setData({ timelineLoading: false, timelineEmpty: true, timelineEmptyReason: '加载失败，请重试' });
    });
  },

  loadInlineCart(tripId) {
    const id = tripId || this.data.timelineTripId;
    if (!id) return;
    api.reminder.cart.list(id).then(res => {
      this.setData({
        timelineCartSummary: res.summary,
        timelineCartCount: res.summary ? res.summary.count : 0,
      });
    }).catch(() => {});
  },

  /* 测量时间线标题在滚动内容中的位置与高度，用于吸顶 */
  measureTimelineHeader() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#timeline-header').boundingClientRect(rect => {
      if (rect) {
        this._headerTop = rect.top + (this._scrollTop || 0);
        this.setData({
          timelineHeaderHeight: rect.height,
          timelineStickyTop: this.data.statusBarHeight + this.data.navBarHeight,
        });
        const stickTop = this.data.statusBarHeight + this.data.navBarHeight;
        const stick = (this._scrollTop || 0) >= this._headerTop - stickTop;
        if (stick !== this.data.timelineSticky) {
          this.setData({ timelineSticky: stick });
        }
      }
    }).exec();
  },

  onInlineTabTap(e) {
    const key = e.currentTarget.dataset.key;
    const tab = this.data.timelineTabs.find(t => t.key === key);
    this.setData({ timelineActiveTab: key, timelineEvents: this.decorateEvents(tab ? tab.events : []) });
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

  onInlineAddAll() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.addAll({
      tripId: this.data.timelineTripId,
      scope: 'departure',
      scopeKey: this.data.timelineActiveTab,
    }).then(res => {
      wx.showToast({ title: '已加入' + res.added + '条提醒', icon: 'none' });
      this.loadInlineTimeline(this.data.timelineTripId, true, true);
      this.setData({ submitting: false });
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onInlineEventAction(e) {
    const event = e.currentTarget.dataset.event;
    if (event.status === 'SELECTABLE') {
      this.onInlineAddReminder(e);
    } else if (event.status === 'IN_CART') {
      this.onInlineOpenCart();
    } else if (event.status === 'BOOKABLE') {
      this.onInlineBookNow(e);
    }
  },

  onInlineAddReminder(e) {
    const event = e.currentTarget.dataset.event;
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.cart.add({
      tripId: this.data.timelineTripId,
      spotId: event.spotId,
      visitDate: event.visitDate,
      releaseAt: event.releaseAt,
    }).then(() => {
      wx.showToast({ title: '已加入清单', icon: 'none' });
      this.loadInlineTimeline(this.data.timelineTripId, true, true);
      this.setData({ submitting: false });
    }).catch(err => {
      api.toastError(err);
      this.setData({ submitting: false });
    });
  },

  onInlineOpenCart() {
    this.setData({ showCartPopup: !this.data.showCartPopup });
  },

  onInlineCartClose() {
    this.setData({ showCartPopup: false });
  },

  onInlineCartChange() {
    this.loadInlineCart();
    this.loadInlineTimeline(this.data.timelineTripId, true, true);
  },

  onInlineStartReminder() {
    if (this.data.timelineCartCount === 0) {
      wx.showToast({ title: '先添加至少一条提醒', icon: 'none' });
      return;
    }
    /* 关闭提醒清单浮窗，避免提交返回后残留遮挡任务页 */
    this.setData({ showCartPopup: false });
    wx.navigateTo({ url: '/pages/setup/setup?tripId=' + this.data.timelineTripId });
  },

  /* 「立即预约」智能路由（FLOW-003 演进）：
   * 有官方小程序 → 直跳；直跳失败 / 无小程序 → 弹景区预约方式弹窗（PAGE-002）兜底 */
  onInlineBookNow(e) {
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

  openSpotPopup(spotId) {
    this.setData({ showSpotPopup: true, popupSpotId: spotId });
  },

  onMoreSpots() {
    wx.navigateTo({ url: '/pages/spots/spots?spotIds=' + this.data.selectedSpotIds.join(',') });
  },

  onSpotNameTap(e) {
    this.openSpotPopup(e.currentTarget.dataset.id);
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false });
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ activeFilter: filter });
    api.reminder.task.list({ filter }).then(res => {
      this.setData({ taskGroups: this.decorateTaskGroups(res.groups), menuTaskId: '' });
    }).catch(() => {});
  },

  onTripTabTap(e) {
    const tripId = e.currentTarget.dataset.id;
    this.setData({ activeTripTab: tripId });
    api.reminder.task.list({ tripId: tripId || undefined, filter: this.data.activeFilter }).then(res => {
      this.setData({ taskGroups: this.decorateTaskGroups(res.groups), menuTaskId: '' });
    }).catch(() => {});
  },

  onTaskDelete(e) {
    this.setData({ menuTaskId: '' });
    const taskId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认移除这条提醒？',
      success: res => {
        if (res.confirm) {
          api.reminder.task.remove(taskId).then(() => {
            this.loadHomeData();
          }).catch(err => api.toastError(err));
        }
      },
    });
  },

  onNewReminder() {
    const tripId = this.data.activeTripTab || (this.data.trips[0] && this.data.trips[0]._id) || '';
    if (tripId) {
      wx.navigateTo({ url: '/pages/timeline/timeline?tripId=' + tripId });
    } else {
      wx.navigateTo({ url: '/pages/timeline/timeline' });
    }
  },

});
