const app = getApp();
const api = require('../../utils/api.js');

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
const BANNER_RESUME_MS = 10000; // 手动滑动后静置多久恢复自动轮播

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

/* 今日放票 Banner（V3.0 定稿）：候选 = 难度前 9 位中的当日真实放票节点，每页 3 条 */
function buildBanner(cards, now) {
  const bj = beijingDate(now);
  const rows = cards
    .filter(c => hasReleaseToday(c, now))
    .map(c => {
      const timeText = releaseTimesOf(c)[0];
      const m = /^(\d{1,2}):(\d{2})$/.exec(timeText);
      if (!m) return null;
      const minutes = Number(m[1]) * 60 + Number(m[2]);
      const flames = Math.max(1, c.popularityScore || 0);
      return {
        spotId: c.spotId,
        name: c.name,
        timeText,
        dateText: dateTextOf(c.earliestDate), // 可约日期 = 放票日 + advanceDays（已顺延闭馆日）
        released: bj.getHours() * 60 + bj.getMinutes() >= minutes,
        flames: Array.from({ length: flames }, (_, i) => i), // 火焰数 = popularityScore 档位
        difficultyScore: c.difficultyScore || 0,
        popularityScore: c.popularityScore || 0,
        minutes,
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.difficultyScore - a.difficultyScore ||
      b.popularityScore - a.popularityScore ||
      a.minutes - b.minutes)
    .slice(0, BANNER_MAX);

  const pages = [];
  for (let i = 0; i < rows.length; i += BANNER_PAGE_SIZE) {
    pages.push({ key: 'p' + (i / BANNER_PAGE_SIZE), rows: rows.slice(i, i + BANNER_PAGE_SIZE) });
  }
  return {
    dateLabel: `${bj.getMonth() + 1}/${bj.getDate()}（${DOW_CN[bj.getDay()]}）`,
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
    bannerAutoplay: true,
  },

  onLoad() {
    const g = app.globalData;
    const pinTop = (g.statusBarHeight || 20) + (g.navBarHeight || 44);
    this.setData({ statusBarHeight: g.statusBarHeight, navBarHeight: g.navBarHeight, pinTop });
    this.loadSpots();
  },

  onShow() {
    /* 从详情返回时静默刷新，保持规则时效 */
    if (this.data.allSpots.length > 0) {
      this.refreshBanner();
      this.rerenderList();
    } else if (!this.data.loading) {
      this.loadSpots();
    }
  },

  onPageScroll(e) {
    this._scrollTop = e.scrollTop;
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
    this.setData({ banner: buildBanner(this.data.allSpots, new Date()), bannerCurrent: 0, bannerAutoplay: true });
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

  /* ===== 今日放票 Banner：自动轮播循环，手动滑动暂停、静置 10s 恢复 ===== */
  onBannerTouch() {
    if (!this.data.bannerAutoplay) return;
    this.setData({ bannerAutoplay: false });
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.setData({ bannerAutoplay: true }), BANNER_RESUME_MS);
  },

  onBannerChange(e) {
    this.setData({ bannerCurrent: e.detail.current });
    if (e.detail.source === 'touch') this.onBannerTouch();
  },

  onBannerSpotTap(e) {
    this.openDetail(e.currentTarget.dataset.id);
  },

  /* ===== 完整规则详情页（卡片 / Banner 共用） ===== */
  onCardTap(e) {
    this.openDetail(e.detail.spotId);
  },

  openDetail(spotId) {
    if (!spotId) return;
    wx.navigateTo({ url: '/pages/spot-rule/spot-rule?spotId=' + spotId });
  },
});
