const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

const { spotsListCards } = require('../../utils/mock.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    searchMode: false,
    keyword: '',
    selectedSpots: [],
    selectedSpotIds: [],
    hotSpots: [],
    hotPool: [],
    history: [],
    searchResults: [],
    searching: false,
    hasSearched: false,
    inputFocus: false,
    tripId: '',
    showSpotPopup: false,
    popupSpotId: '',
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      tripId: options.tripId || '',
    });
    if (options.spotIds) {
      const ids = options.spotIds.split(',').filter(Boolean);
      this.setData({ selectedSpotIds: ids });
      this.loadSelectedSpots(ids);
    }
    this.loadHotSpots();
    this.loadHistory();
  },

  onUnload() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
  },

  loadSelectedSpots(ids) {
    if (ids.length === 0) return;
    api.spots.batch(ids).then(res => {
      this.setData({ selectedSpots: util.markSpotsSelected(res.data || [], ids) });
    }).catch(() => {
      this.setData({ selectedSpots: util.markSpotsSelected(spotsListCards().filter(s => ids.indexOf(s.spotId) >= 0), ids) });
    });
  },

  /* 热门推荐：只混搭 S+A 级，每批 6 个 S（难度≥4）+ 4 个 A（难度≤3），共 10 个，避免全是极难约 */
  loadHotSpots() {
    api.spots.list().then(res => {
      this.applyHotPool(res.data || []);
    }).catch(() => { this.applyHotPool(spotsListCards()); });
  },

  applyHotPool(list) {
    const pool = (list || []).filter(s => s.reservationRequired !== false); // S+A
    this.setData({
      hotPool: pool,
      hotSpots: this.mixBatch(pool, this.data.selectedSpotIds),
    });
  },

  /* 混搭一批：S 取热度前 6、A 取热度前 4，合并后按热度降序；可避开当前批次的 spotId */
  mixBatch(pool, selectedIds, excludeIds) {
    const ex = excludeIds || [];
    const sList = pool.filter(s => (s.difficultyScore || 0) >= 4);
    const aList = pool.filter(s => (s.difficultyScore || 0) <= 3);
    const sPool = sList.filter(s => ex.indexOf(s.spotId) < 0);
    const aPool = aList.filter(s => ex.indexOf(s.spotId) < 0);
    const s = (sPool.length >= 6 ? sPool : sList).slice(0, 6);
    const a = (aPool.length >= 4 ? aPool : aList).slice(0, 4);
    const batch = s.concat(a).sort((x, y) => (y.popularityScore || 0) - (x.popularityScore || 0));
    return util.markSpotsSelected(batch, selectedIds);
  },

  loadHistory() {
    api.spots.searchHistory().then(res => {
      this.setData({ history: (res.data || []).slice(0, 10) });
    }).catch(() => {});
  },

  onSearchFocus() { this.setData({ searchMode: true }); },
  onSearchInput(e) {
    const v = e.detail.value;
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    if (!v.trim()) {
      // 清空关键词：回退到搜索历史态
      this.setData({ keyword: v, searchResults: [], searching: false, hasSearched: false });
      return;
    }
    // 输入即搜：防抖 300ms，期间显示搜索中
    this.setData({ keyword: v, searching: true });
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.onSearchSubmit();
    }, 300);
  },

  onClearKeyword() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.setData({ keyword: '', searchResults: [], searching: false, hasSearched: false, inputFocus: false });
    // 重新拉起键盘焦点，方便清除后继续输入
    setTimeout(() => { this.setData({ inputFocus: true }); }, 0);
  },

  onSearchSubmit() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    const kw = this.data.keyword.trim();
    if (!kw) return;
    this.setData({ searching: true });
    api.spots.search(kw).then(res => {
      this.setData({ searchResults: util.markSpotsSelected(res.data || [], this.data.selectedSpotIds), searching: false, hasSearched: true });
      this.loadHistory();
    }).catch(() => {
      const results = spotsListCards().filter(s => s.name.indexOf(kw) >= 0 || s.spotId.indexOf(kw.toLowerCase()) >= 0);
      this.setData({ searchResults: util.markSpotsSelected(results, this.data.selectedSpotIds), searching: false, hasSearched: true });
      this.loadHistory();
    });
  },

  onSearchCancel() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.setData({ searchMode: false, keyword: '', searchResults: [], searching: false, hasSearched: false, inputFocus: false });
  },

  onHistoryTap(e) {
    this.setData({ keyword: e.currentTarget.dataset.kw, searchMode: true });
    this.onSearchSubmit();
  },

  onClearHistory() {
    api.spots.clearSearchHistory().then(() => { this.setData({ history: [] }); }).catch(() => { this.setData({ history: [] }); });
  },

  onShuffle() {
    this.setData({ hotSpots: this.mixBatch(this.data.hotPool, this.data.selectedSpotIds, this.data.hotSpots.map(s => s.spotId)) });
  },

  onSpotToggle(e) {
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
      ids.splice(idx, 1); spots.splice(idx, 1);
      wx.showToast({ title: '已移除', icon: 'none' });
    } else {
      ids.push(spotId); spots.push(spot);
      wx.showToast({ title: '已添加', icon: 'none' });
    }
    this.setData({
      selectedSpotIds: ids,
      selectedSpots: util.markSpotsSelected(spots, ids),
      hotSpots: util.markSpotsSelected(this.data.hotSpots, ids),
      searchResults: util.markSpotsSelected(this.data.searchResults, ids),
    });
  },

  onRemoveSelected(e) {
    const spotId = e.currentTarget.dataset.id;
    const ids = [].concat(this.data.selectedSpotIds);
    const spots = [].concat(this.data.selectedSpots);
    const idx = ids.indexOf(spotId);
    if (idx >= 0) { ids.splice(idx, 1); spots.splice(idx, 1); }
    this.setData({
      selectedSpotIds: ids,
      selectedSpots: util.markSpotsSelected(spots, ids),
      hotSpots: util.markSpotsSelected(this.data.hotSpots, ids),
      searchResults: util.markSpotsSelected(this.data.searchResults, ids),
    });
  },

  onClearSelected() {
    this.setData({
      selectedSpots: [],
      selectedSpotIds: [],
      hotSpots: util.markSpotsSelected(this.data.hotSpots, []),
      searchResults: util.markSpotsSelected(this.data.searchResults, []),
    });
  },

  onSpotNameTap(e) { this.setData({ showSpotPopup: true, popupSpotId: e.currentTarget.dataset.id }); },
  onSpotPopupClose() { this.setData({ showSpotPopup: false }); },

  onBack() {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    // If coming from timeline page, update trip spots via API
    if (this.data.tripId) {
      api.reminder.trip.updateSpots({
        tripId: this.data.tripId,
        spotIds: this.data.selectedSpotIds,
      }).catch(() => {});
    }
    // Set data on previous page for immediate UI update
    if (prev) {
      prev.setData({ selectedSpotIds: this.data.selectedSpotIds, selectedSpots: this.data.selectedSpots });
    }
    wx.navigateBack();
  },
});
