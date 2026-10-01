const app = getApp();
const api = require('../../utils/api.js');
const notify = require('../../utils/notify.js');
const shareEntry = require('../../utils/share-entry.js');
const analytics = require('../../utils/analytics.js');
const reminderFlow = require('../../utils/reminder-flow.js');

/* 景点类型 Tab（V3.0 定稿：页面唯一筛选维度，不设「预约方式」筛选） */
const TABS = [
  { key: 'hot', label: '热门', flame: true },
  { key: 'family', label: '亲子' },
  { key: 'elder', label: '带父母' },
  { key: 'museum', label: '博物馆' },
  { key: 'heritage', label: '古迹' },
  { key: 'nature', label: '自然' },
];

/* 分类 Tab → category 归并（人群 Tab 走 audienceTags，不在此列） */
const CATEGORY_TAB = {
  museum: ['博物馆', '纪念场馆'],
  heritage: ['古迹'],
  nature: ['公园'],
};

const DOW_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOW_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const BANNER_PAGE_SIZE = 3; // 每页 3 条
const BANNER_MAX = 9; // 最多 9 条（3 页）
const SEARCH_DEBOUNCE_MS = 300;

/* 放票提醒 Banner 白名单：只从这 10 个景点中随机选品 */
const BANNER_SPOT_IDS = new Set([
  'gugong', 'tiananmen-chenglou', 'guobo',
  'maozhuxi-jiniantang', 'renmin-dahuitang', 'tsinghua', 'peking-university',
  'gongwangfu', 'tiananmen-square', 'junbo',
]);

function releaseTimesOf(card) {
  return Array.isArray(card.releaseTime) ? card.releaseTime : (card.releaseTime ? [card.releaseTime] : []);
}

/* 转成「用本地 getter 读取北京时间」的 Date，统一供星期、日期和时刻判断使用。 */
function beijingDate(now) {
  return new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000));
}

/* 今日是否可约（按北京时间，TIME-RULE-001）
 *
 * 设备时区可能是任意值，getDay() 直读本地时间在境外时区会算错星期。
 * openDays 非空时接管 closedDays（白名单，北大/清华仅周末），与云函数 isOpenOn 同语义。
 */
function isOpenToday(card, now) {
  const bj = beijingDate(now);
  const dayName = DOW_EN[bj.getDay()];
  const open = card.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(card.closedDays || []).includes(dayName);
}

/* 当日是否有真实放票节点：可提醒 + 有时刻 + 今日可约 */
function hasReleaseToday(card, now) {
  if (!card.remindable || releaseTimesOf(card).length === 0) return false;
  return isOpenToday(card, now);
}

function dateTextOf(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr || '');
  return m ? `${Number(m[2])}月${Number(m[3])}日` : '';
}

/* Fisher-Yates 洗牌（拷贝后原地打乱，不改原数组） */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* 今日放票 Banner：随机选品 · 每页 3 条 · 前两页各保底 1 个极难约 · 不重复 */
function buildBanner(cards, now) {
  const bj = beijingDate(now);
  const rows = cards
    .filter(c => BANNER_SPOT_IDS.has(c.spotId))
    .filter(c => hasReleaseToday(c, now))
    .map(c => {
      const timeText = releaseTimesOf(c)[0];
      const m = /^(\d{1,2}):(\d{2})$/.exec(timeText);
      if (!m) return null;
      const minutes = Number(m[1]) * 60 + Number(m[2]);
      const flames = Math.max(1, c.popularityScore || 0);
      const ds = c.difficultyScore || 0;
      const diff = ds >= 4
        ? { key: 'extreme', text: '极难约' }
        : ds === 3
          ? { key: 'normal', text: '较难约' }
          : { key: 'easy', text: '容易约' };
      return {
        spotId: c.spotId,
        name: c.name,
        timeText,
        dateText: dateTextOf(c.earliestDate),
        released: bj.getHours() * 60 + bj.getMinutes() >= minutes,
        flames: Array.from({ length: flames }, (_, i) => i),
        diffKey: diff.key,
        diffText: diff.text,
        difficultyScore: ds,
        popularityScore: c.popularityScore || 0,
        minutes,
      };
    })
    .filter(Boolean);

  /* 洗牌后分两堆：极难约（ds≥4）和其他；逐池消耗保证不重复 */
  const extremes = shuffle(rows.filter(r => r.difficultyScore >= 4));
  const others = shuffle(rows.filter(r => r.difficultyScore < 4));

  const picked = [];
  /* 前两页各保底抽 1 个极难约，其余名额从 others 随机补满到 3 */
  for (let page = 0; page < 2; page++) {
    if (extremes.length) picked.push(extremes.shift());
    while (picked.length % BANNER_PAGE_SIZE !== 0 && others.length) picked.push(others.shift());
  }
  /* 剩余：两池合并 */
  picked.push(...extremes, ...others);
  const limited = picked.slice(0, BANNER_MAX);

  const pages = [];
  for (let i = 0; i < limited.length; i += BANNER_PAGE_SIZE) {
    pages.push({ key: 'p' + (i / BANNER_PAGE_SIZE), rows: limited.slice(i, i + BANNER_PAGE_SIZE) });
  }
  return {
    dateLabel: `${bj.getMonth() + 1}/${bj.getDate()} (${DOW_CN[bj.getDay()]})`,
    pages,
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    pinTop: 64, // 搜索吸顶位 = 状态栏 + 导航栏
    loading: true,
    loadFailed: false,
    dataEmpty: false,
    tabs: TABS,
    activeTab: 'hot',
    allSpots: [],
    spots: [],
    keyword: '',
    searchFocused: false,
    searchMode: false,
    searchResults: [],
    banner: null,
    bannerCurrent: 0,
    showSpotPopup: false,
    popupSpotId: '',
    popupSpotMeta: null,
    popupLandingMode: false,
    entryContext: null,
    /* 日期选择器 */
    showDateSheet: false,
    dateSpotName: '',
    dateTitle: '',
    dateTripDates: [],
    dateBookedDates: [],
    dateMinDate: '',
    dateAction: null,
  },

  onLoad(options) {
    const g = app.globalData;
    const pinTop = (g.statusBarHeight || 20) + (g.navBarHeight || 44);
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight, pinTop });
    this.applyEntry(shareEntry.consumeEntry(app, options));
    this.loadSpots();
  },

  onShow() {
    /* 小程序已打开时再次从分享卡片进入，App.onShow 会把 query 暂存到这里。 */
    const pending = shareEntry.peekPending(app);
    if (pending && (pending.spotId || (!pending.sceneId && pending.source === 'home_share'))) {
      shareEntry.clearPending(app);
      this.applyEntry(pending);
    }

    /* 从详情返回时静默刷新，保持规则时效 */
    if (this.data.allSpots.length > 0) {
      this.refreshBanner();
      this.rerenderList();
    } else if (!this.data.loading) {
      this.loadSpots();
    }
  },

  applyEntry(entry) {
    const spotId = (entry && entry.spotId) || '';
    const context = Object.assign({}, entry || {}, {
      entryType: spotId ? 'spot' : 'list',
    });
    this.setData({
      entryContext: context,
      popupLandingMode: !!spotId,
    });
    if (entry && entry.source) analytics.captureLanding(context, context.entryType);
    if (spotId) this.openDetail(spotId);
  },

  onShareAppMessage() {
    const spot = this.data.popupSpotMeta
      || (this.data.allSpots || []).find(s => s.spotId === this.data.popupSpotId);
    const payload = spot
      ? shareEntry.buildSpotSharePayload(spot, this.data.popupSpotId)
      : shareEntry.buildSpotListPayload();
    const type = spot ? 'spot' : 'list';
    analytics.trackShareIntent(type, spot ? spot.spotId : 'all');
    return payload;
  },

  onPageScroll(e) {
    this._scrollTop = e.scrollTop;
  },

  onCityTap() {
    wx.showToast({ title: '更多城市敬请期待', icon: 'none' });
  },

  loadSpots() {
    this.setData({ loading: true });
    api.spots.list().then(res => {
      /* 卡片展示字段（难度标签/放票标签/cardDesc）由云函数 buildCard 一次给全，前端不再加工 */
      const allSpots = res.data || [];
      this.setData({ allSpots, loading: false, loadFailed: false }, () => {
        try {
          this.refreshBanner();
          this.rerenderList();
        } catch (err) {
          /* 数据已成功返回：展示层异常不能再回写成“云端加载失败” */
          console.error('[spot-hub] render-after-load-failed', err);
          this.setData({ spots: allSpots, dataEmpty: allSpots.length === 0 });
        }
      });
    }).catch(() => {
      /* 只展示真实云环境结果：请求失败才标错，不回退 mock */
      this.setData({ allSpots: [], loading: false, loadFailed: true, dataEmpty: true, spots: [] });
      wx.showToast({ title: '景点数据加载失败，请检查云端', icon: 'none' });
    });
  },

  /* Tab 命中：人群 Tab 按 audienceTags，分类 Tab 按 category 归并 */
  matchTab(spot, tab) {
    if (CATEGORY_TAB[tab]) return CATEGORY_TAB[tab].includes(spot.category);
    return (spot.audienceTags || []).includes(tab);
  },

  /* 重算当前列表（非搜索态） */
  rerenderList() {
    const { activeTab, allSpots } = this.data;
    const list = activeTab === 'hot'
      ? allSpots
      : allSpots.filter(s => this.matchTab(s, activeTab));
    this.setData({ spots: list, dataEmpty: allSpots.length === 0 });
  },

  refreshBanner() {
    this.setData({ banner: buildBanner(this.data.allSpots, new Date()), bannerCurrent: 0 });
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key });
    if (this.data.searchMode && this.data.keyword.trim()) {
      this.applySearchResults();
    } else {
      this.rerenderList();
    }
  },

  /* ===== 搜索：聚焦 → 整页滚动使搜索框吸顶（Banner 滑出视口，Tab 跟随吸顶） ===== */
  onSearchFocus() {
    this.setData({ searchFocused: true });
    this.pinToSearch();
  },

  pinToSearch() {
    wx.createSelectorQuery().in(this)
      .select('.pin-wrap')
      .boundingClientRect(rect => {
        if (!rect) return;
        const target = this._scrollTop + rect.top - this.data.pinTop;
        if (target > 4) {
          wx.pageScrollTo({ scrollTop: target + 1, duration: 260 });
        }
      }).exec();
  },

  onSearchInput(e) {
    const kw = e.detail.value;
    this.setData({ keyword: kw });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!kw.trim()) {
      this._searchSeq = (this._searchSeq || 0) + 1; // 作废在途请求
      this.setData({ searchMode: false, searchResults: [] });
      this.rerenderList();
      return;
    }
    this.setData({ searchMode: true });
    this._searchTimer = setTimeout(() => this.runSearch(kw.trim()), SEARCH_DEBOUNCE_MS);
  },

  /* SEARCH-RULE-001：云端本地模糊匹配（名称/别名/拼音）；失败回退已加载数据的名称过滤 */
  runSearch(kw) {
    const seq = (this._searchSeq = (this._searchSeq || 0) + 1);
    api.spots.search(kw).then(res => {
      if (seq !== this._searchSeq) return;
      this._searchRaw = res.data || [];
      this.applySearchResults();
    }).catch(() => {
      if (seq !== this._searchSeq) return;
      const lower = kw.toLowerCase();
      this._searchRaw = this.data.allSpots.filter(s =>
        (s.name || '').toLowerCase().includes(lower) || (s.spotId || '').toLowerCase().includes(lower));
      this.applySearchResults();
    });
  },

  /* 搜索结果 × 当前 Tab 过滤 */
  applySearchResults() {
    const { activeTab, searchMode, keyword } = this.data;
    if (!searchMode || !keyword.trim()) return;
    const raw = this._searchRaw || [];
    const list = activeTab === 'hot' ? raw : raw.filter(s => this.matchTab(s, activeTab));
    this.setData({ searchResults: list });
  },

  onClearKeyword() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchSeq = (this._searchSeq || 0) + 1;
    this.setData({ keyword: '', searchMode: false, searchResults: [] });
    this.rerenderList();
  },

  /* 取消搜索：清空 + 失焦 + 滚回默认态 */
  onSearchCancel() {
    this.onClearKeyword();
    this.setData({ searchFocused: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 260 });
  },

  onBannerChange(e) {
    this.setData({ bannerCurrent: e.detail.current });
  },

  onBannerSpotTap(e) {
    this.openDetail(e.currentTarget.dataset.id);
  },

  /* ===== 景点详情浮窗（卡片 / 今日放票 Banner 共用） =====
   * 全站统一为浮窗形态；内页 spot-rule 保留文件与路由，已无入口。
   * 浮窗底部行动栏（加入提醒 / 加入行程）维持视觉占位，交互待首页改版后统一接。 */
  onCardTap(e) {
    this.openDetail(e.detail.spotId);
  },

  /* 卡片上的「设提醒」直接进入现有日期选择与授权链路，不再必须先打开详情。 */
  onCardRemind(e) {
    const d = (e && e.detail) || {};
    if (!d.spotId) return;
    reminderFlow.openDateSheet(this, {
      spotId: d.spotId,
      spotName: d.spotName,
      title: '设置提醒',
      remindOn: true,
    });
  },

  openDetail(spotId) {
    if (!spotId) return;
    this.setData({ showSpotPopup: true, popupSpotId: spotId, popupSpotMeta: null });
  },

  onSpotPopupLoaded(e) {
    const spot = e && e.detail && e.detail.spot;
    if (!spot) return;
    this.setData({ popupSpotMeta: spot });
    // SEO-9.2 标题规则：长名称优先使用 shortName，标题不超过 20 字
    const displayName = spot.shortName || spot.name;
    if (displayName) {
      const suffix = spot.reservationRequired === false ? '免预约·门票信息' : '门票预约·放票时间';
      wx.setNavigationBarTitle({ title: displayName + '·' + suffix });
    }
  },

  onSpotPopupClose() {
    this.setData({ showSpotPopup: false, popupSpotId: '', popupSpotMeta: null });
  },

  /* ===== 详情浮窗按钮：设置提醒 / 仅加行程不提醒 → 弹出日历 ===== */

  onPopupSetReminder(e) {
    const d = e.detail;
    reminderFlow.openDateSheet(this, {
      spotId: d.spotId,
      spotName: d.spotName,
      title: '设置提醒',
      remindOn: true,
    });
  },

  onPopupAddTripOnly(e) {
    const d = e.detail;
    reminderFlow.openDateSheet(this, {
      spotId: d.spotId,
      spotName: d.spotName,
      title: '加入行程',
      remindOn: false,
    });
  },

  openDateSheet(spotId, spotName, title, remindOn) {
    return reminderFlow.openDateSheet(this, { spotId, spotName, title, remindOn });
  },

  onDateConfirm(e) {
    return reminderFlow.onDateConfirm(this, e);
  },

  onDateClose() {
    reminderFlow.onDateClose(this);
  },

});
