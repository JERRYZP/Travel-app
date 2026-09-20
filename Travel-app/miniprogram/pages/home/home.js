const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

/**
 * 首页 · 行程状态墙（2026-09-20 首页行程化改版 P3）
 *
 * 主轴从「什么时候动手」换成「这趟成了没」：按出行日一行行列出要去的地方，
 * 每个地方标清楚票到手没有。提醒功能一条没删，但退到行程项内部。
 *
 * 三条纪律：
 *  ① **状态一律用服务端算好的**。ticketState / canMark / progress / reminder
 *     都来自 home.bootstrap，页面不按时间自己重推一遍——那必然漂。
 *  ② **票务态与提醒送达态分开渲染**。抢票失败 ≠ 提醒没送到。
 *  ③ **静默刷新**。标记/删除后重载不置 loading，否则列表塌缩会把页面弹回顶部。
 */
Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navOpacity: 0,
    loading: true,

    trips: [],
    history: [],
    primaryTrip: null,
    /* 完全没有行程项 = 空态。空态自带一个居中的「+ 新增提醒」，
       所以要把悬浮按钮藏掉，避免同屏两个一模一样的入口。 */
    isBlank: false,
    historyOpen: false,
    banner: null,
    hideBanner: false,

    /* 同屏只允许一个菜单开着 */
    menuId: '',
    menuDate: '',
    /* 被「忽略」划掉的气泡：这一点不再主动追问（补标走菜单） */
    dismissed: [],
    /* 有候选可挽回的 itemId：由服务端三层规则判定后回填 */
    recoverableIds: [],
    recoveryCandidates: [],
    recoveryLoading: false,

    showSpotPopup: false,
    popupSpotId: '',
    showResultSheet: false,
    showDateSheet: false,
    sheetItemId: '',
    sheetSpotName: '',
    sheetCurrent: '',

    snackbar: { show: false, text: '' },
    undoSeconds: 4,
    _undoItemId: '',
    _undoResultAt: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const now = new Date();
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
    });
    /* 从订阅消息点进来：先落到对应景点的详情浮窗（预约直达 + 倒计时）。
       标记入口**不在浮窗里**——等用户回到首页才在行程卡片上看到（决策文档 4.1）。 */
    const spotId = options && options.spotId;
    if (spotId) this.openSpotPopup(decodeURIComponent(spotId));
    this._lastLoad = Date.now();
  },

  onShow() {
    this.loadHome();
  },

  onPageScroll(e) {
    const scrollTop = (e.detail && e.detail.scrollTop) || 0;
    this._scrollTop = scrollTop;
    const patch = { navOpacity: Math.min(scrollTop / 50, 1) };
    /* 滚动即收起菜单与横幅，避免浮层跟着页面乱跑 */
    if (this.data.menuId) patch.menuId = '';
    if (this.data.menuDate) patch.menuDate = '';
    if (scrollTop > 60 && !this.data.hideBanner) patch.hideBanner = true;
    if (scrollTop <= 60 && this.data.hideBanner) patch.hideBanner = false;
    this.setData(patch);
    this.measureSections(scrollTop);
  },

  /* ===== 数据加载 ===== */

  loadHome(opts) {
    const silent = opts && opts.silent;
    if (!silent) this.setData({ loading: true });

    api.reminder.home.bootstrap({}).then(res => {
      const trips = (res.trips || []).map(t => this.decorateTrip(t));
      const primary = trips.length ? trips[0] : null;
      this.setData({
        loading: false,
        trips,
        history: res.history || [],
        /* 空态判定：没有任何进行中行程、也没有历史行程 */
        isBlank: trips.length === 0 && (res.history || []).length === 0,
        primaryTrip: primary,
        banner: res.stickyBanner || null,
        hideBanner: false,
        menuId: '',
        menuDate: '',
        /* 被划掉的气泡在重新加载后清空：新的一次会话可以再问一次，
           但同一次会话里不重复追问（「忽略」的语义 = 提前进入中性态） */
        dismissed: silent ? this.data.dismissed : [],
      }, () => {
        this.measureSections(this._scrollTop || 0);
        /* 进首页自动滚到最近该标记的一条（优先可抢 —— 还来得及救） */
        if (!silent && res.scrollTargetId) this.scrollToItem(res.scrollTargetId);
        if (!silent) this.loadRecoverables(trips);
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  /** 给行程附加视图层字段（分段吸顶的测量结果由 measureSections 回填） */
  decorateTrip(t) {
    return Object.assign({}, t, { _sticky: false, _height: 0, _stickyTop: 0 });
  },

  /**
   * 哪些「没抢到」的项还有别的日期可约 —— 三层规则在服务端
   * （lib/recovery.js）。没有候选就是**静默**，卡片上不会出现挽回入口。
   */
  loadRecoverables(trips) {
    const failed = [];
    (trips || []).forEach(t => (t.items || []).forEach(it => {
      if (it.result === 'FAILED' && !it.ended) failed.push(it.itemId);
    }));
    if (failed.length === 0) {
      if (this.data.recoverableIds.length) this.setData({ recoverableIds: [] });
      return;
    }
    Promise.all(failed.map(id =>
      api.reminder.tripItem.recoveryCandidates({ itemId: id })
        .then(r => ({ id, ok: (r.candidates || []).length > 0 }))
        .catch(() => ({ id, ok: false }))
    )).then(list => {
      this.setData({ recoverableIds: list.filter(x => x.ok).map(x => x.id) });
    });
  },

  /* ===== 分段吸顶测量 =====
     不用 position: sticky —— skyline 下表现不稳。沿用既有做法：
     onPageScroll 里测每个分段标题在文档中的位置，越过阈值就切成固定态，
     并撑一个等高的 spacer 防止内容跳动。 */

  measureSections(scrollTop) {
    if (!this.data.trips.length) return;
    const stickTop = this.data.statusBarHeight + this.data.navBarHeight;
    const query = wx.createSelectorQuery().in(this);
    this.data.trips.forEach(t => query.select('#sec-' + t._id).boundingClientRect());
    query.exec(rects => {
      if (!rects) return;
      const trips = this.data.trips.map((t, i) => {
        const r = rects[i];
        if (!r) return t;
        /* boundingClientRect 给的是视口坐标，换算回文档坐标 */
        const docTop = r.top + (this._scrollTop || 0);
        const stick = (this._scrollTop || 0) >= docTop - stickTop;
        return Object.assign({}, t, {
          _sticky: stick,
          _height: r.height,
          _stickyTop: stickTop,
          _docTop: docTop,
        });
      });
      const changed = trips.some((t, i) =>
        t._sticky !== this.data.trips[i]._sticky || t._height !== this.data.trips[i]._height);
      if (changed) this.setData({ trips });
    });
  },

  /**
   * 滚到某条行程项（进首页自动定位）。
   *
   * 找它所属的行程分段再滚过去，而不是精确到卡片：卡片高度会随气泡出现/收起变化，
   * 按分段定位更稳，而且目标项就在那一段里，用户一眼能看到。
   * 只有「24 小时内刚开抢、还没标记」的项才会触发（服务端算 scrollTargetId）。
   */
  scrollToItem(itemId) {
    const trip = this.data.trips.find(t => (t.items || []).some(i => i.itemId === itemId));
    if (!trip) return;
    setTimeout(() => {
      wx.pageScrollTo({
        selector: '#sec-' + trip._id,
        duration: 260,
        offsetTop: -(this.data.statusBarHeight + this.data.navBarHeight + 12),
      });
    }, 120);
  },

  /* ===== 导航 / 浮窗 ===== */

  onAddTrip() {
    wx.navigateTo({ url: '/pages/add-trip/add-trip' });
  },

  onManage() {
    wx.navigateTo({ url: '/pages/add-trip/add-trip?manage=1' });
  },

  onBannerOpen(e) {
    const spotId = e.detail && e.detail.spotId;
    if (spotId) this.openSpotPopup(spotId);
  },

  onSpot(e) {
    this.openSpotPopup(e.detail.spotId);
  },

  openSpotPopup(spotId) {
    this.setData({ showSpotPopup: true, popupSpotId: spotId });
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false });
  },

  onToggleHistory() {
    this.setData({ historyOpen: !this.data.historyOpen });
  },

  /* ===== 菜单 ===== */

  onMenu(e) {
    const id = e.detail.itemId;
    this.setData({ menuId: this.data.menuId === id ? '' : id, menuDate: '' });
  },

  onDateMenu(e) {
    const key = e.detail.tripId + '|' + e.detail.visitDate;
    this.setData({ menuDate: this.data.menuDate === key ? '' : key, menuId: '' });
  },

  onMenuClose() {
    if (this.data.menuId || this.data.menuDate) this.setData({ menuId: '', menuDate: '' });
  },

  /* ===== 标记结果（主入口） ===== */

  onResult(e) {
    this.doMark(e.detail.itemId, e.detail.result);
  },

  doMark(itemId, result) {
    if (this._marking) return;
    this._marking = true;
    api.reminder.tripItem.markResult({ itemId, result }).then(res => {
      this._marking = false;
      const item = res.item;
      const isSuccess = result === 'SUCCESS';
      this.setData({
        _undoItemId: itemId,
        _undoResultAt: item.resultAt,
        snackbar: {
          show: true,
          text: (item.spotName || '该景点') + ' 已标记为「' + (isSuccess ? '抢到了' : '没抢到') + '」',
        },
        undoSeconds: 4,
      });
      this.loadHome({ silent: true });
      /* 抢到了且还有备选 → 内联追问（永不静默自动删除备选） */
      if (isSuccess && res.backupPrompt) this.promptBackup(res.backupPrompt);
    }).catch(err => {
      this._marking = false;
      api.toastError(err);
    });
  },

  /**
   * 收束动线：已确认某天去，同一批备选还留着。
   * ⚠️ **永不静默自动删除备选**：用户点「保留」或不操作 → 备选照常抢票、
   * 照常发提醒（他可能还没最终定，也可能想抢到两天再退一天）。
   */
  promptBackup(prompt) {
    const dates = (prompt.pending || []).map(p => p.visitDateLabel).join('、');
    wx.showModal({
      title: '备选日期怎么处理？',
      content: prompt.text + '。' + dates + '的备选还要吗？留着会照常抢票和提醒。',
      confirmText: '删掉备选',
      cancelText: '保留',
      success: r => {
        if (!r.confirm) return; // 保留 = 什么都不做
        (prompt.pending || []).forEach(p => {
          api.reminder.tripItem.remove({ itemId: p.itemId }).catch(() => {});
        });
        wx.showToast({ title: '已删除备选', icon: 'none' });
        setTimeout(() => this.loadHome({ silent: true }), 600);
      },
    });
  },

  /* ===== 撤销（4 秒内） ===== */

  onUndo() {
    const itemId = this.data._undoItemId;
    if (!itemId) return;
    api.reminder.tripItem.undoResult({
      itemId,
      expectedResultAt: this.data._undoResultAt,
    }).then(() => {
      wx.showToast({ title: '已撤销', icon: 'none' });
      this.loadHome({ silent: true });
    }).catch(err => {
      api.toastError(err);
      this.loadHome({ silent: true });
    }).then(() => {
      this.setData({ snackbar: { show: false, text: '' }, _undoItemId: '', _undoResultAt: '' });
    });
  },

  onUndoExpire() {
    this.setData({ snackbar: { show: false, text: '' }, _undoItemId: '', _undoResultAt: '' });
  },

  /* ===== 忽略气泡 =====
     语义 = 提前进入「未标记」中性态：不再主动追问，补标走三点菜单。 */

  onDismissBubble(e) {
    const id = e.detail.itemId;
    this.setData({ dismissed: this.data.dismissed.concat(id) });
  },

  /* ===== 标记结果的次入口（Sheet） ===== */

  onMark(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    this.setData({
      showResultSheet: true,
      sheetItemId: itemId,
      sheetSpotName: found ? found.spotName : '',
      sheetCurrent: found ? (found.result || '') : '',
    });
  },

  onResultConfirm(e) {
    const itemId = this.data.sheetItemId;
    this.setData({ showResultSheet: false });
    if (itemId) this.doMark(itemId, e.detail.result);
  },

  onResultClose() {
    this.setData({ showResultSheet: false });
  },

  /* ===== 挽回（约其他日） ===== */

  onRecover(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    this.setData({
      showDateSheet: true,
      sheetItemId: itemId,
      sheetSpotName: found ? found.spotName : '',
      recoveryLoading: true,
      recoveryCandidates: [],
    });
    api.reminder.tripItem.recoveryCandidates({ itemId }).then(res => {
      this.setData({ recoveryLoading: false, recoveryCandidates: res.candidates || [] });
    }).catch(() => {
      this.setData({ recoveryLoading: false, recoveryCandidates: [] });
    });
  },

  /**
   * 选定一个候选日 → 生成新的行程项（与原项**并列**，不是替换）。
   *
   * 实现上复用「加清单 + 提交」这条既有链路：
   * 候选日可能已经开票（直接去约）或还没开票（要设提醒），两者都是
   * 「在行程里多一条这一天的记录」，与从「添加提醒」页加入没有区别。
   */
  onRecoverConfirm(e) {
    const c = e.detail || {};
    if (!c.visitDate) return;
    const ctx = this.data.recoveryCandidates.length ? c : null;
    this.setData({ showDateSheet: false });

    api.reminder.cart.add({
      spotId: c.spotId,
      visitDate: c.visitDate,
      releaseAt: c.releaseAt,
      remindOn: c.action === 'SET_REMINDER',
    }).then(() => api.reminder.cart.commit({
      channels: c.action === 'SET_REMINDER' ? ['OFFICIAL_ACCOUNT'] : undefined,
      offsets: c.action === 'SET_REMINDER' ? [5] : undefined,
    })).then(() => {
      wx.showToast({ title: '已加进行程', icon: 'none' });
      this.loadHome({ silent: true });
    }).catch(err => {
      api.toastError(err);
    });
  },

  onDateSheetClose() {
    this.setData({ showDateSheet: false });
  },

  /* ===== 删除动线（三层，每层都二次确认） ===== */

  /** 第一层：删单个行程项 */
  onRemoveItem(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    /* 「已成」是成果记录，误删可惜 —— 提示语要更重 */
    const isDone = found && found.result === 'SUCCESS';
    wx.showModal({
      title: '删除这条行程？',
      content: (found ? found.spotName : '该行程项')
        + (isDone ? '\n这条已经抢到了，是本次行程的成果记录。' : '')
        + '\n该行程项与其提醒会一并删除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success: r => {
        if (!r.confirm) return;
        api.reminder.tripItem.remove({ itemId }).then(res => {
          wx.showToast({ title: res.tripRemoved ? '行程已删除' : '已删除', icon: 'none' });
          this.loadHome({ silent: true });
        }).catch(err => api.toastError(err));
      },
    });
  },

  /** 第二层：删某一天的全部行程项（日期分段标题右侧菜单） */
  onRemoveDate(e) {
    const { tripId, visitDate } = e.detail;
    const trip = this.data.trips.find(t => t._id === tripId);
    const count = trip ? (trip.items || []).filter(i => i.visitDate === visitDate).length : 0;
    wx.showModal({
      title: '删除当天行程？',
      content: '该日期下的 ' + count + ' 条行程项和提醒会一并删除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success: r => {
        if (!r.confirm) return;
        api.reminder.tripItem.removeVisitDate({ tripId, visitDate }).then(res => {
          wx.showToast({ title: res.tripRemoved ? '行程已删除' : '已删除当天', icon: 'none' });
          this.loadHome({ silent: true });
        }).catch(err => api.toastError(err));
      },
    });
  },

  /* ===== 提醒设置 ===== */

  /**
   * 「修改提醒设置」：改提前量 / 取消提醒。
   * 开票后提醒已发完，这个入口在卡片菜单里就不显示了（见 trip-card）。
   * ⚠️ 微信那边的授权次数已经花掉，取消提醒**不退还额度**。
   */
  onEditReminder(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    const on = found && found.remindOn;
    wx.showActionSheet({
      itemList: on ? ['取消提醒', '保持现状'] : ['开启提醒'],
      success: r => {
        if (on && r.tapIndex !== 0) return;
        api.reminder.tripItem.updateReminder({
          itemId,
          remindOn: !on,
          channels: ['OFFICIAL_ACCOUNT'],
          offsets: [5],
        }).then(() => {
          wx.showToast({ title: on ? '已取消提醒' : '已开启提醒', icon: 'none' });
          this.loadHome({ silent: true });
        }).catch(err => api.toastError(err));
      },
      fail: () => {},
    });
  },

  /* ===== 提醒未送达：状态直显，点开看原因 ===== */

  onMissedReason(e) {
    const reason = (e.detail && e.detail.reason) || '';
    let content;
    if (/43101/.test(reason)) {
      content = '微信订阅消息授权次数不足：每设置一次提醒需重新授权一次，本次发送被微信拒绝。下次设置提醒时，请在授权弹窗中点「允许」。';
    } else if (/WX_APPSECRET|未配置/.test(reason)) {
      content = '提醒服务未完成配置（订阅消息密钥缺失），通知发不出去。请在「意见反馈」里告知我们。';
    } else if (reason) {
      content = reason;
    } else {
      content = '这条提醒已过放票时间，但没有发出通知。可能是微信通知权限未开启，或提醒服务未正常运行；可在「意见反馈」里告知我们。';
    }
    wx.showModal({ title: '未送达原因', content, showCancel: false, confirmText: '知道了' });
  },

  /* ===== 工具 ===== */

  findItem(itemId) {
    for (const t of this.data.trips.concat(this.data.history)) {
      const hit = (t.items || []).find(i => i.itemId === itemId);
      if (hit) return hit;
    }
    return null;
  },
});
