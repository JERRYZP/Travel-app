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
    /* 有任务时的顶部双 Tab（提醒任务 / 添加提醒），默认落在任务列表 */
    homeTab: 'tasks',
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
    /* 设置提醒提交成功后返回首页，落回「提醒任务」让用户直接看到新任务 */
    if (app.globalData.reminderSubmitted) {
      app.globalData.reminderSubmitted = false;
      this.setData({ homeTab: 'tasks' });
    }
    /* 从「景点规则详情页」点「设置预约提醒」进入：预选该景点并落回「添加提醒」 */
    if (app.globalData.pendingReminderSpot) {
      const spot = app.globalData.pendingReminderSpot;
      app.globalData.pendingReminderSpot = null;
      const ids = [].concat(this.data.selectedSpotIds);
      const spots = [].concat(this.data.selectedSpots);
      if (spot && spot.spotId && ids.indexOf(spot.spotId) < 0) {
        ids.push(spot.spotId);
        spots.push(spot);
        this.setData({ selectedSpotIds: ids, selectedSpots: spots, homeTab: 'add' });
      }
    }
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
    const STATUS_CLASS = { WAITING: 'waiting', TRIGGERED: 'done', MISSED: 'missed' };
    /* REMINDER-RULE-005（2026-09-14 放宽）：WAITING 与 MISSED 可单条删除；仅 TRIGGERED 保留为历史记录 */
    const DELETABLE = { WAITING: true, MISSED: true };
    return (groups || []).map(g => {
      const items = (g.items || []).map(t => {
        const m = /^(开抢)(.+?)(门票)$/.exec(t.grabLabel || '');
        /* 已过放票时刻却仍是 WAITING = 未送达（REMINDER-RULE-004）。
           云端新版已在 task.list 里收敛成 MISSED，这里再兜一次，
           兼容未重新部署的旧云端——否则「已过期」列表里会显示「待提醒」且没有任何失败提示。 */
        const status = (t.backendStatus === 'WAITING' && t.expired) ? 'MISSED' : t.backendStatus;
        return Object.assign({}, t, {
          grabPre: m ? m[1] : t.grabLabel,
          grabDate: m ? m[2] : '',
          grabPost: m ? m[3] : '',
          backendStatus: status,
          statusClass: STATUS_CLASS[status] || 'done',
          statusLabel: status === t.backendStatus ? t.statusLabel : '未送达',
          missed: status === 'MISSED',
          deletable: !!DELETABLE[status],
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



  doClearTasks(params) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.task.clear(params).then(() => {
      this.setData({ submitting: false, menuTaskId: '' });
      this.loadHomeData();
    }).catch(err => { this.setData({ submitting: false }); api.toastError(err); });
  },

  /* 显式删除空壳行程（TRIP-RULE-004）：清掉行程 + 其提醒任务 + 未提交的提醒清单 */
  doDeleteEmptyTrip(tripId) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.reminder.trip.remove({ tripId }).then(() => {
      this.setData({
        submitting: false,
        menuTaskId: '',
        ...(this.data.activeTripTab === tripId ? { activeTripTab: '' } : {}),
      });
      wx.showToast({ title: '行程已删除', icon: 'none' });
      this.loadHomeData();
    }).catch(err => { this.setData({ submitting: false }); api.toastError(err); });
  },

  onClearTasks() {
    if (this.data.submitting) return;
    /* 只清空当前 tab（状态筛选 + 行程分组），提示语带上 tab 名与条数 */
    const filter = this.data.activeFilter;
    const tripId = this.data.activeTripTab || undefined;
    api.reminder.task.list({ filter, tripId }).then(res => {
      const counts = res.counts || {};
      const n = counts[filter] || 0;
      const tabName = filter === 'expired' ? '已过期' : '进行中';
      if (n === 0) {
        /* 产品需求（2026-09-14）：选中行程的「进行中 + 已过期」都为 0 = 已被清空，
           行程不该继续占着 Tab。旧数据里可能留下这种空壳（清单还挂着未提交的提醒，
           导致服务端兜底清理判为「非空」），这里给一个显式删除入口。 */
        const totalLeft = (counts.active || 0) + (counts.expired || 0);
        if (tripId && totalLeft === 0) {
          const name = ((this.data.trips || []).find(t => t._id === tripId) || {}).name || '当前行程';
          wx.showModal({
            title: '删除这个空行程？',
            content: `「${name}」已没有任何提醒任务，删除后该行程及其提醒清单都会被清掉，无法恢复。`,
            confirmText: '删除行程',
            confirmColor: '#C0392B',
            success: r => { if (r.confirm) this.doDeleteEmptyTrip(tripId); },
          });
          return;
        }
        wx.showToast({ title: '当前没有可清空的任务', icon: 'none' });
        return;
      }
      /* TRIP-RULE-004（2026-09-14）：清空后该行程若再无任何任务，行程本身
         与其提醒清单会被一并删除。这里把结果提前讲清楚，避免用户点完发现
         整个行程 Tab 消失而困惑。仅当选中了某个行程 Tab 时才会连带删行程，
         「全部」视图只清任务、不动行程。 */
      const otherKey = filter === 'expired' ? 'active' : 'expired';
      const otherLeft = counts[otherKey] || 0;
      const willDropTrip = Boolean(tripId) && otherLeft === 0;
      const tripName = ((this.data.trips || []).find(t => t._id === tripId) || {}).name || '当前行程';
      const content = willDropTrip
        ? `清空后「${tripName}」将没有任何提醒任务，该行程及其提醒清单会被一并删除，无法恢复。`
        : (tripId && otherLeft > 0
          ? `清空后这 ${n} 条提醒记录无法恢复；「${tripName}」仍保留 ${otherLeft} 条其他任务。`
          : `清空后这 ${n} 条提醒记录无法恢复。`);
      wx.showModal({
        title: `确认清空${tabName}的 ${n} 条任务？`,
        content,
        confirmText: '确认清空',
        confirmColor: '#C0392B',
        success: r => { if (r.confirm) this.doClearTasks({ filter, tripId }); },
      });
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
    const filter = this.data.activeFilter;
    /* 双 Tab 的「添加提醒」视图下保留内联时间线，返回本页不丢进度 */
    const keepInline = this.data.homeTab === 'add' && this.data.showTimeline && this.data.timelineTripId;
    api.reminder.home.bootstrap({
      filter,
      activeTripTab: this.data.activeTripTab || '',
      tripId: keepInline ? this.data.timelineTripId : '',
      includeSpots: this.data.hotSpots.length === 0,
    }).then(res => {
      const mode = res.homeMode || 1;
      if (mode === 2) {
        /* 选中行程已被服务端级联删除（空行程）→ 回到「全部」 */
        const stillHasTrip = !this.data.activeTripTab || (res.trips || []).some(t => t._id === this.data.activeTripTab);
        const activeTripTab = stillHasTrip ? this.data.activeTripTab : '';
        const groups = (activeTripTab && res.tripTasks && res.tripTasks.groups) ? res.tripTasks.groups : res.groups;
        this.setData({
          homeMode: mode, loading: false,
          taskGroups: this.decorateTaskGroups(groups || []),
          counts: res.counts || { active: 0, expired: 0 },
          banner: res.banner,
          showTimeline: keepInline,
          timelineSticky: false,
          menuTaskId: '',
          showCartPopup: false,
          trips: res.trips || [],
          showGroupTabs: res.showGroupTabs || false,
          activeTripTab,
        });
        if (keepInline && res.cart) {
          this.setData({
            timelineCartSummary: res.cart.summary,
            timelineCartCount: res.cart.summary ? res.cart.summary.count : 0,
          });
        }
        /* 预加热点网格（切换到「添加提醒」时秒显），已有数据不覆盖 */
        if (res.hotSpots && res.hotSpots.length) {
          this.setData({ hotSpots: this.buildHotSpots(res.hotSpots, this.data.selectedSpotIds) });
        }
      } else {
        /* 形态1：已有内联时间线则保留并刷新清单，否则加载热门景点 */
        if (this.data.showTimeline && this.data.timelineTripId) {
          this.setData({ homeMode: mode, loading: false });
          if (res.cart) {
            this.setData({
              timelineCartSummary: res.cart.summary,
              timelineCartCount: res.cart.summary ? res.cart.summary.count : 0,
            });
          }
        } else {
          this.setData({ homeMode: mode, loading: false });
          if (res.hotSpots && res.hotSpots.length) {
            this.setData({ hotSpots: this.buildHotSpots(res.hotSpots, this.data.selectedSpotIds) });
          } else if (this.data.hotSpots.length === 0) {
            /* 兜底：bootstrap 未返回热点（如内部 spots 调用失败）→ 单独拉一次 */
            this.loadHotSpots();
          }
        }
      }
      /* 自愈：内联时间线的行程被孤儿清理删除（timelineTripId 悬空）→ 重新创建恢复 */
      this.ensureInlineTrip(res.trips);
    }).catch(() => {
      /* 回退路径：home.bootstrap 未部署（旧云端）或 mock 缺失时，退回 task.list 旧链路，
         保证任务列表形态与内联时间线仍能展示；云端部署新版后此回退不触发 */
      api.reminder.task.list({ filter, tripId: this.data.activeTripTab || undefined }).then(res => {
        const mode = res.homeMode || 1;
        this.setData({
          homeMode: mode, loading: false,
          taskGroups: this.decorateTaskGroups(res.groups || []),
          counts: res.counts || { active: 0, expired: 0 },
          banner: res.banner,
          showTimeline: keepInline,
          timelineSticky: false,
          menuTaskId: '',
          showCartPopup: false,
        });
        this.loadTrips().then(() => this.ensureInlineTrip(this.data.trips));
        if (keepInline) this.loadInlineCart();
        this.loadHotSpots();
      }).catch(() => {
        this.setData({ homeMode: 1, loading: false });
        this.loadHotSpots();
      });
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
    return api.reminder.trip.list().then(res => {
      const trips = res.trips || [];
      const patch = { trips, showGroupTabs: res.showGroupTabs || false };
      /* 选中行程已被服务端级联删除（空行程）→ 回到「全部」 */
      if (this.data.activeTripTab && !trips.some(t => t._id === this.data.activeTripTab)) {
        patch.activeTripTab = '';
      }
      this.setData(patch);
    }).catch(() => {});
  },

  onCityTap() {
    wx.showToast({ title: '更多城市即将开放', icon: 'none' });
  },

  onHomeTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.homeTab) return;
    const patch = { homeTab: tab, menuTaskId: '' };
    /* 首次切到「添加提醒」且没有内联时间线时，惰性加载热门景点 */
    if (tab === 'add' && !this.data.showTimeline && this.data.hotSpots.length === 0) {
      this.loadHotSpots();
    }
    this.setData(patch);
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
    // 免预约或无放票时刻景点不可选（UI 已是 tag，此处兜底）
    if (spot && !spot.remindable) {
      wx.showToast({
        title: spot.reservationRequired ? '该景点无固定放票时刻，随买随用即可' : '该景点无需预约，现场购票即可',
        icon: 'none',
      });
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
    /* 任务分组第一性原则（TRIP-RULE-002，2026-09-14 恢复自动合并）：
     * 服务端按「同城市 + 日期有交集 或 首尾相接」把本次输入与既有行程合并成一个行程
     * （一个任务分组 Tab），日期取并集，但**各景点保留自己被选中时的日期段**，
     * 所以时间线不会冒出用户没选过的日期/景点组合。
     * adjustTripId：当前页已有内联时间线时表示「在这个行程上重新生成」，
     * 该行程的景点段按本次输入替换（不是并集），其余相交/相接的行程仍会被并进来。 */
    const payload = {
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
      adjustTripId: this.data.timelineTripId || '',
    };
    api.reminder.trip.create(payload).then(res => {
      wx.hideLoading();
      const tripId = res.tripId;
      app.globalData.currentTripId = tripId;
      this.setData({ showTimeline: true });
      this.loadInlineTimeline(tripId);
    }).catch(err => {
      wx.hideLoading();
      api.toastError(err);
    });
  },

  /* 内联时间线的行程自愈：孤儿清理（TRIP-RULE-004：无任务且无清单的行程在 trip.list 读取时被删）
   * 会把刚生成、尚未加提醒的行程删掉，导致 timelineTripId 悬空——此后"添加提醒"会加进已删除行程、
   * 时间线刷新失败、购物车栏停留在 0。这里在 loadHomeData 后检测：行程若已不在 trips 里，
   * 用当前表单（startDate/endDate/selectedSpotIds）重新创建并恢复时间线。 */
  ensureInlineTrip(trips) {
    const id = this.data.timelineTripId;
    if (!id || !this.data.showTimeline) return Promise.resolve(id);
    if ((trips || []).some(t => t._id === id)) return Promise.resolve(id);
    if (!this.data.startDate || this.data.selectedSpotIds.length === 0) return Promise.resolve(id);
    return api.reminder.trip.create({
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      spotIds: this.data.selectedSpotIds,
      city: '北京',
    }).then(res => {
      const newId = res.tripId;
      app.globalData.currentTripId = newId;
      this.loadInlineTimeline(newId);
      return newId;
    }).catch(() => id);
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
        timelineClosedSpots: (res.closedSpots || []).concat(res.closedDaySkips || []),
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

  /* 刷新任务列表+计数：过期状态是任务组 Tab 的下一层级，
   * 列表与计数始终以当前 activeTripTab + activeFilter 为准 */
  loadTasks() {
    const filter = this.data.activeFilter;
    const tripId = this.data.activeTripTab || undefined;
    return api.reminder.task.list({ filter, tripId }).then(res => {
      this.setData({
        taskGroups: this.decorateTaskGroups(res.groups),
        counts: res.counts || { active: 0, expired: 0 },
        menuTaskId: '',
      });
    }).catch(() => {});
  },

  onFilterChange(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.filter });
    this.loadTasks();
  },

  onTripTabTap(e) {
    this.setData({ activeTripTab: e.currentTarget.dataset.id });
    this.loadTasks();
  },

  /* 在当前分组里按 _id 找任务（供状态解释弹窗、删除权限判断复用） */
  findTask(taskId) {
    for (const g of this.data.taskGroups || []) {
      const hit = (g.items || []).find(i => i._id === taskId);
      if (hit) return hit;
    }
    return null;
  },

  onTaskDelete(e) {
    this.setData({ menuTaskId: '' });
    const taskId = e.currentTarget.dataset.id;
    const task = this.findTask(taskId);
    /* REMINDER-RULE-005（2026-09-14 放宽）：WAITING / MISSED 可单删，TRIGGERED 只能走「清空任务」 */
    if (task && !task.deletable) {
      wx.showToast({ title: '已提醒的任务可在「清空任务」中清理', icon: 'none' });
      return;
    }
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

  /* MISSED（含「已过放票时刻但未送达」）任务状态胶囊可点 → 弹未送达原因；其他状态不拦截 */
  onMissedExplain(e) {
    const task = this.findTask(e.currentTarget.dataset.id);
    if (!task || !task.missed) return;
    const reason = task.missedReason || '';
    let content;
    if (/43101/.test(reason)) {
      content = '微信订阅消息授权次数不足：每设置一次提醒需重新授权一次，本次发送被微信拒绝。下次设置提醒时，请在授权弹窗中点「允许」。';
    } else if (/WX_APPSECRET|未配置/.test(reason)) {
      content = '提醒服务未完成配置（订阅消息密钥缺失），通知发不出去。请在「意见反馈」里告知我们。';
    } else if (reason.includes('超过放票时间') || reason.includes('已过放票时刻')) {
      content = '已过放票时间仍未送达。常见原因：订阅消息授权次数不足，或微信通知权限未开启。';
    } else if (reason) {
      content = reason;
    } else {
      content = '这条提醒已过放票时间，但没有发出通知。可能是微信通知权限未开启，或提醒服务未正常运行；可在「意见反馈」里告知我们。';
    }
    wx.showModal({
      title: '未送达原因',
      content,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onNewReminder() {
    /* 底部主操作改为切到「添加提醒」Tab，不再跳二级页 */
    /* 与导航栏 Tab 一致：首次切到添加页且没有内联时间线时，惰性加载热门景点 */
    if (!this.data.showTimeline && this.data.hotSpots.length === 0) {
      this.loadHotSpots();
    }
    this.setData({ homeTab: 'add', menuTaskId: '' });
  },

});
