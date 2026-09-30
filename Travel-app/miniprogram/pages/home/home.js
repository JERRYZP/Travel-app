const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const notify = require('../../utils/notify.js');
const tripCalendar = require('../../utils/trip-calendar.js');
const shareEntry = require('../../utils/share-entry.js');
const analytics = require('../../utils/analytics.js');
const release = require('../../utils/release-context.js');

/* 导航块高度（rpx）= `.navbar-content` 的 height，两处必须一致。 */
const NAV_BAR_RPX = 88;
/* 标题行高（rpx）= `.navbar-title` 的 font-size 30rpx × page 的 line-height 1.5。
   导航块比标题高得多，标题在其中垂直居中，于是上下各空 (88−45)/2 ≈ 21.5rpx。 */
const NAV_TITLE_RPX = 45;
/* 标题下沿 → 正文顶：直接对齐，不再额外留白 */
const PAGE_GAP_RPX = 0;
/* 滚多少像素把导航栏底色从全透明推到不透明 */
const NAV_FADE_PX = 50;
const QUOTA_WARNING_DISMISS_KEY = 'reminderQuotaWarningDismissedOnV1';
const EMPTY_RELEASE_FALLBACK = release.buildHomeReleasePreview([], new Date()).sample;

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
    /* 正文的 padding-top（rpx）= 标题下沿，见 `pageTopOf()`。
       导航栏是 fixed 的、不占文档流，正文不让位就会被它盖住（横幅首当其冲）。
       ⚠️ 这里**不含横幅高度**：横幅就在正文里，高度由它自己占。 */
    pageTop: 0,
    /* 导航栏底色不透明度：0 = 全透明，1 = 填满页面底色。滚 NAV_FADE_PX 推满。 */
    navOpacity: 0,
    loading: true,

    trips: [],
    history: [],
    primaryTrip: null,
    /* 摘要卡底部的「即将提醒」胶囊：接下来的放票时刻（服务端拼好文案）。
       来源是 stickyBanner.pills —— 不放独立字段，避免两处口径漂。 */
    bannerPills: [],
    /* 完全没有行程项 = 空态。空态自带一个居中的创建行程 CTA，
       所以要把悬浮按钮藏掉，避免同屏两个一模一样的入口。 */
    isBlank: false,
    previewNewUser: false,
    /* 新用户空态的内容证据：一张真实规则预览 + 3 个近期热门景点放票节点。
       数据来自 home.bootstrap 已返回的 hotSpots，不额外请求接口。 */
    emptyReleaseRows: [],
    emptyReleaseSample: EMPTY_RELEASE_FALLBACK,
    historyOpen: false,
    banner: null,
    reminderQuotaWarning: null,
    showReminderQuotaWarning: false,
    quotaWarningDayKey: '',

    /* 同屏只允许一个菜单开着 */
    menuId: '',
    menuDate: '',
    /* 被「忽略」划掉的气泡：这一点不再主动追问（补标走菜单） */
    dismissed: [],
    /* 有候选可挽回的 itemId：由服务端三层规则判定后回填 */
    recoverableIds: [],

    showSpotPopup: false,
    popupSpotId: '',
    popupSpotMeta: null,
    showSampleSheet: false,
    showResultSheet: false,
    showDateSheet: false,
    sheetItemId: '',
    sheetSpotName: '',
    sheetSpotId: '',
    sheetCurrent: '',
    dateTripDates: [],
    dateBookedDates: [],
    dateMinDate: '',

    snackbar: { show: false, lead: '', highlight: '', tail: '', tone: '' },
    undoSeconds: 4,
    _undoItemId: '',
    _undoResultAt: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const entryContext = shareEntry.consumeEntry(app, options);
    if (entryContext.source) analytics.captureLanding(entryContext, 'home');
    this.setData({
      /* ⚠️ 模板里只把 `statusBarHeight` 当**数字**用（换算成 rpx 要 ×2），
         不能与 rpx 常量做字符串拼接 —— 见过把 px 值和 rpx 直接相加的先例。
         `navBarHeight` 只给 `scrollToItem` 的偏移量用：导航基线本身固定 88rpx，
         不读 app.js 反推的那个值（它会偏大，让标题整体下坠）。 */
      statusBarHeight: g.statusBarHeight || 20,
      navBarHeight: g.navBarHeight || 44,
      pageTop: pageTopOf(g.statusBarHeight),
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

  onShareAppMessage(options) {
    /* 详情浮窗里的 open-type=share 也会走页面生命周期。
       只有按钮发起的转发才按景点分享；右上角菜单仍分享首页今日场景。 */
    if ((!options || options.from === 'button') && this.data.showSpotPopup && this.data.popupSpotMeta) {
      const spot = this.data.popupSpotMeta;
      analytics.trackShareIntent('spot', spot.spotId || this.data.popupSpotId);
      return shareEntry.buildSpotSharePayload(spot, this.data.popupSpotId);
    }
    analytics.trackShareIntent('home', 'today');
    return shareEntry.buildHomeSharePayload();
  },

  onPageScroll(e) {
    /* ⚠️ **两种事件形态都要认**，这就是「导航栏滚动变填充一直没生效」的真正原因：
       页面生命周期给的是 `e.scrollTop`，而 Vant 的 pageScrollMixin 转发时
       包了一层 `e.detail.scrollTop`。原实现只写了后者，于是滚动值**恒为 0**、
       `navOpacity` 永远是 0 —— 不报错、不警告，功能看着像根本没写。
       （2026-09-23 前我一直以为「本页在顶部不能滚动」，判断错了。） */
    const d = e && e.detail;
    const scrollTop = (d && typeof d.scrollTop === 'number')
      ? d.scrollTop
      : ((e && e.scrollTop) || 0);

    const patch = {};
    /* 导航栏底色：滚 NAV_FADE_PX(50px) 的过程中不透明度 0 → 100%。
       逐帧给值而不是「到阈值切一个类」——后者是硬切，中间那一帧看起来像闪一下。
       ⚠️ 只在值真的变了才 setData：每帧带上一个没变的浮点也会触发一次 diff。 */
    const navOpacity = Math.min(1, Math.max(0, scrollTop / NAV_FADE_PX));
    if (navOpacity !== this.data.navOpacity) patch.navOpacity = navOpacity;
    /* ⚠️ 这里**没有 hideBanner 了**（2026-09-23 删）。横幅在文档流里、
       跟着内容一起滚，本来就会滑到导航栏底下 —— 它自己会走。
       而按阈值把它从文档里摘掉，会让下面的内容**瞬间上跳一个横幅的高度**。 */
    /* 三个字段都只在「真的变了」时才写进 patch，所以这里无脑提交即可：
       `setData({})` 是空操作，不会白白 diff。 */
    this.setData(patch);
    /* ⚠️ 原此处调 measureSections 测分段标题位置做吸顶。分段标题已整条删除
       （2026-09-21），吸顶随之失效，别再把它加回来——它每次滚动都发一轮
       boundingClientRect 查询，而结果已经没人消费。 */
  },

  /* ===== 数据加载 ===== */

  loadHome(opts) {
    const silent = opts && opts.silent;
    if (!silent) this.setData({ loading: true });

    const g = app.globalData;
    if (g.envVersion === 'develop' && g.previewNewUser) {
      this.setData({
        loading: false,
        trips: [],
        history: [],
        primaryTrip: null,
        bannerPills: [],
        banner: null,
        reminderQuotaWarning: null,
        showReminderQuotaWarning: false,
        quotaWarningDayKey: '',
        isBlank: true,
        previewNewUser: true,
        emptyReleaseRows: [],
        emptyReleaseSample: EMPTY_RELEASE_FALLBACK,
        historyOpen: false,
        recoverableIds: [],
        menuId: '',
        menuDate: '',
      });
      /* 开发预览没有走 bootstrap 的 hotSpots；单独取一次公开景点卡，
         让设计/真机验收可以看到完整的“近期热门景点放票”模块。失败时保留兜底示例。 */
      api.spots.list().then(res => {
        const preview = release.buildHomeReleasePreview(res.data || [], new Date(), 3);
        this.setData({ emptyReleaseRows: preview.rows, emptyReleaseSample: preview.sample });
      }).catch(() => {});
      return;
    }

    api.reminder.home.bootstrap({}).then(res => {
      const trips = (res.trips || []).map((t, i) => this.decorateTrip(t, i === 0));
      const primary = trips.length ? trips[0] : null;
      const serverNow = res.serverNow ? new Date(res.serverNow) : new Date();
      const releasePreview = release.buildHomeReleasePreview(res.hotSpots || [], serverNow, 3);
      const quotaWarningDayKey = release.toDateStr(serverNow);
      let dismissedOn = '';
      try { dismissedOn = wx.getStorageSync(QUOTA_WARNING_DISMISS_KEY) || ''; } catch (e) {}
      const reminderQuotaWarning = res.reminderQuotaWarning || null;
      this.setData(Object.assign({
        loading: false,
        trips,
        history: res.history || [],
        /* 空态判定：没有任何进行中行程、也没有历史行程 */
        isBlank: trips.length === 0 && (res.history || []).length === 0,
        previewNewUser: false,
        primaryTrip: primary,
        /* ⚠️ 胶囊是**顶层独立字段**，不挂在 stickyBanner 下——横幅只覆盖眼下一小时，
           而胶囊要回答「后面还有哪几场」。别在这里自己从 trips 里挑放票时刻：
           那是第二套口径，必然与云端漂。 */
        bannerPills: res.releasePills || [],
        banner: res.stickyBanner || null,
        emptyReleaseRows: releasePreview.rows,
        emptyReleaseSample: releasePreview.sample,
        reminderQuotaWarning,
        quotaWarningDayKey,
        showReminderQuotaWarning: !!reminderQuotaWarning && dismissedOn !== quotaWarningDayKey,
        /* 「还有别的日期可约」的候选集合随 bootstrap 一起回来（服务端 lib/recovery.js）。
           ⚠️ **别再在页面侧另发一次请求去算**（2026-09-24 踩过）：那样这条响应
           与候选之间没有顺序保证，返回体已经带着 `result = FAILED` 而候选还在路上，
           卡片就按「FAILED 但不可挽回」渲染 —— 症状是**挽回线永远不出现**，
           菜单里也只剩「删除这天」，而两边的单测全绿（各自都没问题，是时序问题）。 */
        recoverableIds: res.recoverableIds || [],
        menuId: '',
        menuDate: '',
        /* 被划掉的气泡在重新加载后清空：新的一次会话可以再问一次，
           但同一次会话里不重复追问（「忽略」的语义 = 提前进入中性态） */
        dismissed: silent ? this.data.dismissed : [],
      }), () => {
        /* 进首页自动滚到最近该标记的一条（优先可抢 —— 还来得及救） */
        if (!silent && res.scrollTargetId) this.scrollToItem(res.scrollTargetId);
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  onQuotaWarningOpen() {
    wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  },

  onQuotaWarningDismiss() {
    const dayKey = this.data.quotaWarningDayKey;
    if (dayKey) {
      try { wx.setStorageSync(QUOTA_WARNING_DISMISS_KEY, dayKey); } catch (e) {}
    }
    this.setData({ showReminderQuotaWarning: false });
  },

  /**
   * 给行程附加视图层字段。
   *
   * `_weak` 决定行程分段标题渲不渲染，**这个判断放在这里、不放模板**：
   * `trips` 里的对象在 loadHome 里是同一个引用，`trips[0] === primaryTrip` 成立，
   * 所以数组序就是唯一事实。模板里写 `wx:for-index === 0` 把「第一段」这个语义
   * 编码进模板内部计数器，加一个 `wx:if` 都会静默错位；这里 `isPrimary` 是明说。
   *
   * ⚠️ 顶部摘要卡只展示最近即将发生或正在发生的那一趟（= `trips[0]`）：
   *   - `trips[0]`：与摘要卡重复 → 标题行不渲染；
   *   - 其余（后面还没发生的行程）：摘要卡没覆盖，**必须保留标题行**，
   *     否则那一段会塌成一堆裸日期，读不出「这是独立的一段、到哪结束」。
   * 单趟行程是最常见形态，`isPrimary` 让首页就是一堵干净的墙。
   */
  decorateTrip(t, isPrimary) {
    return Object.assign({}, t, { _weak: !!isPrimary });
  },

  /* ===== 分段吸顶测量 =====
     不用 position: sticky —— skyline 下表现不稳。沿用既有做法：
     onPageScroll 里测每个分段标题在文档中的位置，越过阈值就切成固定态，
     并撑一个等高的 spacer 防止内容跳动。 */

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

  /**
   * 新增提醒 —— 把「最近那趟进行中行程」带进去预填。
   *
   * 用户点这个按钮的典型意图是「往我刚规划的那趟行程里再加个景点」，让他把日期段
   * 和已经选过的景点重新输一遍是纯浪费。预填的是 `primaryTrip`（trips[0]，进行中
   * 行程按开始日期升序的第一个，与首页置顶那趟是同一趟），不是别的：
   * 空态时 primaryTrip 为 null，参数自然为空，页面维持从零填。
   *
   * 传 tripId 只影响两件事——预填 + 预览里把**这一趟**已有的项标成「已加入行程」；
   * 生成时间线依旧只按「当前所选日期段 × 景点」即时算，不会因此读别趟行程的状态。
   * 提交时行程的创建与合并照旧由 TRIP-RULE-002 判定（多半会并回这一趟）。
   */
  onAddTrip() {
    /* 空态（含开发预览）永远从零填写。即使页面因刷新时序暂时留着旧
       primaryTrip，也不能把已删除行程的日期段带进 PAGE-005。 */
    const emptyHome = !!this.data.isBlank || !!this.data.previewNewUser;
    if (this.data.previewNewUser) {
      app.globalData.previewNewUser = false;
      this.setData({ previewNewUser: false });
    }
    const t = emptyHome ? null : this.data.primaryTrip;
    const q = (t && t._id)
      ? ('?tripId=' + t._id
        + '&startDate=' + t.startDate
        + '&endDate=' + t.endDate
        + '&spotIds=' + (t.spotIds || []).join(','))
      : '';
    wx.navigateTo({ url: '/pages/add-trip/add-trip' + q });
  },

  onEmptySpotTap(e) {
    const spotId = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (spotId) this.openSpotPopup(spotId);
  },

  onOpenAllSpots() {
    wx.redirectTo({ url: '/pages/spot-hub/spot-hub' });
  },

  onOpenReminderSamples() {
    this.setData({ showSampleSheet: true });
  },

  onCloseReminderSamples() {
    this.setData({ showSampleSheet: false });
  },

  onExitNewUserPreview() {
    if (app.globalData.envVersion !== 'develop' || !app.globalData.previewNewUser) return;
    app.globalData.previewNewUser = false;
    this.setData({ previewNewUser: false });
    this.loadHome();
  },

  /** 摘要卡「即将提醒」胶囊：点它打开该景点详情浮窗（预约入口 + 倒计时） */
  onBannerPillTap(e) {
    const spotId = e.detail && e.detail.spotId;
    if (spotId) this.openSpotPopup(spotId);
  },

  onBannerOpen(e) {
    const spotId = e.detail && e.detail.spotId;
    if (spotId) this.openSpotPopup(spotId);
  },

  onSpot(e) {
    this.openSpotPopup(e.detail.spotId);
  },

  openSpotPopup(spotId) {
    this.setData({ showSpotPopup: true, popupSpotId: spotId, popupSpotMeta: null });
  },

  onSpotPopupLoaded(e) {
    const spot = e && e.detail && e.detail.spot;
    if (spot) this.setData({ popupSpotMeta: spot });
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false, popupSpotMeta: null });
  },

  onToggleHistory() {
    this.setData({ historyOpen: !this.data.historyOpen });
  },

  /* ===== 菜单 ===== */

  /**
   * 点行程项卡的三点菜单：**只负责开合**。
   *
   * ⚠️ 这里原来接的是 `bind:menu`，而组件把「开合」和「编辑提醒」抛成了同一个事件，
   * 于是点菜单会直接弹出「修改提醒设置」浮层——用户报的「右侧菜单点击没触发」。
   * 现在组件拆成 `menutoggle`（开合）与 `editreminder`（菜单里那一项）两个事件。
   */
  onCardMenuToggle(e) {
    const id = e.detail.itemId;
    /* ⚠️ 诊断用，与 `trip-card.js` 的 `onMenuToggle` 那行配对：
       一个证明「组件抛了」，一个证明「页面收到了并改了什么」。
       两行都在 → 链路没问题，问题必然在渲染或命中；只有前者 → 事件绑定断了。 */
    console.log('[home] menutoggle <-', id, '| menuId', this.data.menuId, '->', this.data.menuId === id ? '' : id);
    this.setData({ menuId: this.data.menuId === id ? '' : id, menuDate: '' });
  },

  onDateMenu(e) {
    /* 菜单键只认 visitDate：分段标题删除后不再需要把 tripId 编进键里。
       ⚠️ 必须与 trip-section 里 menuOpen 的算法逐字一致（`menuDate === visitDate`），
       否则点菜单标题不展开。 */
    const key = e.detail.visitDate;
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
        /* 分段文案（撤销条要按结果给「抢到了」上绿、「没抢到」上朱砂）。
           拼法收在 util.snackbarPartsOf —— 这里与 onUndo 的清空结构必须同形。 */
        snackbar: Object.assign({ show: true }, util.snackbarPartsOf(item.spotName, isSuccess)),
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
      this.setData({ snackbar: { show: false, lead: '', highlight: '', tail: '', tone: '' }, _undoItemId: '', _undoResultAt: '' });
    });
  },

  onUndoExpire() {
    this.setData({ snackbar: { show: false, lead: '', highlight: '', tail: '', tone: '' }, _undoItemId: '', _undoResultAt: '' });
  },

  /* ===== 忽略气泡 =====
     语义 = 提前进入「待确认」中性态：不再主动追问，补标走三点菜单。

     ⚠️ **两个气泡要分开记，不能共用一个 itemId**（2026-09-22 修）：
     卡片上有两个「忽略」——「票抢到了吗」气泡的和「还有其他日期可约」气泡的。
     共用一个 id 时，「先忽略追问、之后从菜单补标没抢到」这条路径上，
     旧标记会把**新出现的挽回气泡**一起压掉，用户看不到「约其他日」。
     语义上「别问我结果」和「别给我挽回方案」是两件事，键也就该分开。
     加后缀而不是开第二个数组：模板里只有 `it.bubbleDismissed` 一个布尔，
     两个数组会让 trip-section 的合并逻辑变成两趟。 */
  onDismissBubble(e) {
    const id = e.detail.itemId;
    this.setData({ dismissed: this.data.dismissed.concat(id) });
  },

  onDismissRecover(e) {
    const id = e.detail.itemId;
    this.setData({ dismissed: this.data.dismissed.concat(id + ':recover') });
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
    if (!found) return;
    const spotId = found.spotId;

    const calendar = tripCalendar.collectTripCalendarDates(
      this.data.trips,
      this.data.history,
      spotId
    );

    /* minDate = 今天 */
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const minDate = today.getFullYear() + '-' + mm + '-' + dd;

    this.setData({
      showDateSheet: true,
      sheetItemId: itemId,
      sheetSpotName: found.spotName,
      sheetSpotId: spotId,
      dateTripDates: calendar.tripDates,
      dateBookedDates: calendar.bookedDates,
      dateMinDate: minDate,
    });
  },

  /* 挽回（约其他日）
     ⚠️ 这里**只传 spotId + visitDate + remindOn**，不传 releaseAt：
     放票时刻由服务端按 `visitDate − advanceDays` 推（`lib/cart.add`），
     页面再算一遍就是第二套口径。原先服务端强制要求传 releaseAt，
     于是点「确定」只回一句「请检查输入」——挽回线点得开、走不通（2026-09-24 修）。

     ⚠️ **提交前必须先要订阅授权**：这条动线落的是一个提醒任务，
     而微信订阅消息是「一次授权 = 能发 1 条」。不要授权直接提交，
     结果就是用户换了个日期、行程项建好了、提醒却永远送不到——
     症状与「未送达」的静默失败一模一样，事后排查只能看到 43101。
     额度已经拿到过就不重复弹；额度不足时先就地解释，用户点“补授权并继续”后再弹微信授权。 */
  onRecoverConfirm(e) {
    const { visitDate } = e.detail || {};
    if (!visitDate || !this.data.sheetSpotId) return;
    this.setData({ showDateSheet: false });
    if (this._recovering) return;
    this._recovering = true;
    wx.showLoading({ title: '正在添加...' });

    /* 这次只提交新增的 1 条 cartId，不把其他暂存草稿的提醒额度一起算进来。 */
    notify.confirmReminderAccess(1)
      .then(access => {
        if (access.action === 'settings') {
          this._recovering = false;
          wx.hideLoading();
          notify.openReminderAccessSettings(access);
          return null;
        }
        if (access.action === 'cancelled') {
          this._recovering = false;
          wx.hideLoading();
          return null;
        }
        const tripOnly = access.action === 'trip-only';
        return api.reminder.cart.add({
          spotId: this.data.sheetSpotId,
          visitDate,
          remindOn: true,
        }).then(added => api.reminder.cart.commit(
          tripOnly
            ? { cartId: added.cartId, disableReminders: true }
            : { cartId: added.cartId, channels: ['OFFICIAL_ACCOUNT'], offsets: [5] }
        )).then(res => {
          this._recovering = false;
          wx.hideLoading();
          const dateLabel = util.formatDate(visitDate);
          /* ⚠️ 文案必须看 `createdTasks`：选中的日期放票时刻可能已经过去，
             `cart.add` 会把该条 remindOn 落成 false，提交后一个提醒都没建。
             无条件写「提醒已设置」就是在骗用户——症状和下面注释里说的
             「静默失败」一模一样（只是这次是提醒根本没生成）。 */
          let title;
          if (tripOnly) {
            title = `已加入 ${dateLabel}行程，未设置提醒`;
          } else if ((res.expiredReminder || 0) > 0) {
            title = `已加入 ${dateLabel}行程 · 已过放票时间，提醒无法设置`;
          } else if (res.createdTasks > 0) {
            title = `已加入 ${dateLabel}行程，提醒已设置`;
          } else {
            title = `已加入 ${dateLabel}行程，未设置提醒`;
          }
          if (!tripOnly && res.createdTasks > 0 && notify.consumeFirstReminderSuccessTip()) {
            title = '提醒已设置，先备好游客信息';
          }
          wx.showToast({ title, icon: 'none', duration: 2000 });
          this.loadHome({ silent: true });
        });
      }).catch(err => {
        this._recovering = false;
        wx.hideLoading();
        api.toastError(err);
      });
  },

  onDateSheetClose() {
    this.setData({ showDateSheet: false });
  },

  /* ===== 删除动线（两层，每层都二次确认） =====
     ⚠️ 原本的第三层「整趟行程删除」已废止（HOME-RULE-004，2026-09-21）：
     不提供整趟删除按钮，空行程由服务端自行收尾。
     因此下面的提示语都按「删一条 / 删一天」写，不出现「行程」二字。 */

  /** 第一层：删这一个行程项（同一景点其他备选日期不受影响） */
  onRemoveItem(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    /* 「已成」是成果记录，误删可惜 —— 提示语要更重 */
    const isDone = found && found.result === 'SUCCESS';
    wx.showModal({
      title: '删除这条？',
      content: (found ? found.spotName : '该行程项')
        + (isDone ? '\n这条已经抢到了，是本次行程的成果记录。' : '')
        + '\n该行程项与其提醒会一并删除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success: r => {
        if (!r.confirm) return;
        api.reminder.tripItem.remove({ itemId }).then(res => {
          /* ⚠️ 不再走 res.tripRemoved 那条分支：首页已废止整趟行程删除，
             这里的动作一律是「删这一条」。行程若因此空了，服务端会自行清理，
             但**不该**在这时报「行程已删除」——用户没删行程，会以为自己删多了。 */
          wx.showToast({ title: '已删除', icon: 'none' });
          this.loadHome({ silent: true });
        }).catch(err => api.toastError(err));
      },
    });
  },

  /** 第二层：删某一天的全部行程项（日期分段标题右侧菜单） */
  onRemoveDate(e) {
    const { tripId, visitDate, itemIds } = e.detail;
    const trip = this.data.trips.find(t => t._id === tripId);
    const count = Array.isArray(itemIds) && itemIds.length
      ? itemIds.length
      : (trip ? (trip.items || []).filter(i => i.visitDate === visitDate).length : 0);
    wx.showModal({
      title: '删除当天的全部？',
      content: '该日期下的 ' + count + ' 条行程项和提醒会一并删除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success: r => {
        if (!r.confirm) return;
        api.reminder.tripItem.removeVisitDate({ tripId, visitDate, itemIds }).then(res => {
          wx.showToast({ title: '已删除当天', icon: 'none' });
          this.loadHome({ silent: true });
        }).catch(err => api.toastError(err));
      },
    });
  },

  /* ===== 提醒设置 ===== */

  /**
   * 「开启提醒 / 取消提醒」——菜单项文案即动作，**点一下直接生效**（2026-09-23 定稿）。
   *
   * ⚠️ 原先这里是「修改提醒」+ 一个系统 ActionSheet 二选一，2026-09-23 拆掉：
   *   ① 名字没兑现——点开只有一个开关，改不了提前量、更改不了出行日期；
   *   ② 菜单文案（读 `reminderClass`）与 ActionSheet 文案（原先读 `found.remindOn`）
   *      是两套判据，在边界上会「菜单写设置提醒、弹出却是取消提醒」；
   *   ③ 多一次点击只为确认一个本来就不该问的动作。
   *   现在判据与服务端同源（`item.reminder.state`），与 cart-popup 的
   *   「点一下即生效」是同一条口径。
   *
   * ⚠️ 微信那边的授权次数已经花掉，取消提醒**不退还额度**。
   */
  onEditReminder(e) {
    const itemId = e.detail.itemId;
    const found = this.findItem(itemId);
    if (!found) return;
    /* ⚠️ 不能用 `remindOn` 判——「未设提醒」与「任务已终态却被关掉」都可能
       remindOn 为 false，而文案由 `reminder.state` 决定（`reminderClass === 'none'`）。
       两边不同源就会出现「点开启、结果执行了取消」。 */
    const on = found.reminder && found.reminder.state !== 'NOT_SET';
    api.reminder.tripItem.updateReminder({
      itemId,
      remindOn: !on,
      channels: ['OFFICIAL_ACCOUNT'],
      offsets: [5],
    }).then(res => {
      /* 取消提醒时若还留着未送达记录，服务端会把它保留下来（不抹掉失败信号）。
         这里必须说一句，否则用户以为取消完就干净了，chip 上却还写着「未送达」。 */
      const kept = !on && res && res.missedKept;
      wx.showToast({
        title: on ? '已取消提醒' : '已开启提醒',
        icon: 'none',
      });
      if (kept) {
        wx.showModal({
          title: '提醒已关闭',
          content: '这条提醒此前未送达，记录保留在卡片上。若不再需要，可删除这天。',
          showCancel: false,
          confirmText: '知道了',
        });
      }
      this.loadHome({ silent: true });
    }).catch(err => api.toastError(err));
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

/**
 * 正文顶（rpx）= **标题下沿**。
 *
 * ⚠️ 不是「导航栏底边」：导航块 88rpx 是给胶囊按钮留的高度，
 * 标题在它里面垂直居中，底边到标题下沿还空着 (88−45)/2 ≈ 21.5rpx。
 * 按底边算会多出这一截；当前正文直接与标题下沿对齐。
 * ⚠️ 状态栏是 px 且带小数（iPhone 15 实测 48.5px），换算成 rpx 必须 ×2。
 * ⚠️ 这个值**不含横幅高度**：横幅排在正文内部，占位由它自己负责。
 */
function pageTopOf(statusBarHeight) {
  /* 减掉的是**导航块比标题高出来的那一半**（上下各空这么多，标题居中），
     不是整个标题高度 —— 前者是 21.5rpx，后者是 45rpx，差一倍。 */
  const titleInset = (NAV_BAR_RPX - NAV_TITLE_RPX) / 2;
  return (statusBarHeight || 20) * 2 + NAV_BAR_RPX + PAGE_GAP_RPX - titleInset;
}
