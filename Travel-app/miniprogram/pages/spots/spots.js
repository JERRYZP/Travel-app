const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

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
    shuffleRound: 0,
    history: [],
    searchResults: [],
    searching: false,
    hasSearched: false,
    inputFocus: false,
    tripId: '',
    showSpotPopup: false,
    popupSpotId: '',
    showClearDialog: false,
  },

  onLoad(options) {
    const g = app.globalData;
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      tripId: options.tripId || '',
    });
    if (options.spotIds) {
      const ids = util.uniqueSpotIds(options.spotIds.split(','));
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
      this.setData({ selectedSpots: util.selectSpotsByIds(res.data || [], ids) });
    }).catch(() => {
      this.setData({ selectedSpots: [] });
    });
  },

  /* 热门推荐：只混搭 S+A 级，S 优先占满、其余用 A 补足到 10 个，避免全是极难约（见 mixBatch） */
  loadHotSpots() {
    api.spots.list().then(res => {
      this.applyHotPool(res.data || []);
    }).catch(() => { this.applyHotPool([]); });
  },

  applyHotPool(list) {
    const pool = (list || []).filter(s => s.addable === true || s.remindable || s.reservationRequired === false); // 可加入行程；无放票时刻的环球影城仍挡出
    this.setData({
      hotPool: pool,
      shuffleRound: 0,
      hotSpots: this.mixBatch(pool, this.data.selectedSpotIds, 0),
    });
  },

  /* 混搭一批：S 全取占满，其余用 A/B 交替补足到目标数（凑满 10），合并后按热度降序。
   * 用轮次平移（round × count 取模）代替「排除当前批」——当前池子 S 仅 3 个、A 存量充足，
   * 排除后不足目标数会回退整表，导致每次换一批都是同一批。 */
  mixBatch(pool, selectedIds, round = 0) {
    const COUNT = 10;
    const sList = pool.filter(s => s.remindable && (s.difficultyScore || 0) >= 4);
    const aList = pool.filter(s => s.remindable && (s.difficultyScore || 0) <= 3);
    const bList = pool.filter(s => s.reservationRequired === false);
    const rotate = (list, count) => {
      if (list.length <= count) return list.slice(); // 不足 count 直接全展示
      const start = (round * count) % list.length;
      const picked = [];
      for (let i = 0; i < count; i += 1) picked.push(list[(start + i) % list.length]);
      return picked;
    };
    const s = sList.slice(); // S 全取占满（现仅 3 个，不足 COUNT）
    const rest = Math.max(0, COUNT - s.length);
    const mixedRest = [];
    const maxLen = Math.max(aList.length, bList.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (aList[i]) mixedRest.push(aList[i]);
      if (bList[i]) mixedRest.push(bList[i]);
    }
    const filler = rotate(mixedRest, rest);
    const batch = s.concat(filler).sort((x, y) => (y.popularityScore || 0) - (x.popularityScore || 0));
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
      this.setData({ searchResults: [], searching: false, hasSearched: true });
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
    const round = (this.data.shuffleRound || 0) + 1;
    this.setData({
      shuffleRound: round,
      hotSpots: this.mixBatch(this.data.hotPool, this.data.selectedSpotIds, round),
    });
  },

  onSpotToggle(e) {
    const spotId = e.currentTarget.dataset.id;
    const spot = e.currentTarget.dataset.spot;
    if (!spotId || !spot) return;
    const addable = spot && (spot.addable === true || spot.remindable || spot.reservationRequired === false);
    if (spot && !addable) {
      wx.showToast({ title: '该景点无固定放票时刻，随买随用即可', icon: 'none' });
      return;
    }
    const ids = util.uniqueSpotIds(this.data.selectedSpotIds);
    const spots = util.markSpotsSelected(this.data.selectedSpots, ids);
    const selected = ids.indexOf(spotId) >= 0;
    let nextIds;
    let nextSpots;
    if (selected) {
      nextIds = ids.filter(id => id !== spotId);
      nextSpots = spots.filter(s => s && s.spotId !== spotId);
      wx.showToast({ title: '已移除', icon: 'none' });
    } else {
      nextIds = ids.concat(spotId);
      nextSpots = util.markSpotsSelected(spots.concat(spot), nextIds);
      wx.showToast({ title: '已加入行程清单', icon: 'none' });
    }
    this.setData({
      selectedSpotIds: util.uniqueSpotIds(nextIds),
      selectedSpots: util.markSpotsSelected(nextSpots, nextIds),
      hotSpots: util.markSpotsSelected(this.data.hotSpots, nextIds),
      searchResults: util.markSpotsSelected(this.data.searchResults, nextIds),
    });
  },

  onRemoveSelected(e) {
    const spotId = e.currentTarget.dataset.id;
    if (!spotId) return;
    const ids = util.uniqueSpotIds(this.data.selectedSpotIds).filter(id => id !== spotId);
    const spots = util.markSpotsSelected(this.data.selectedSpots, ids)
      .filter(s => s && s.spotId !== spotId);
    this.setData({
      selectedSpotIds: ids,
      selectedSpots: spots,
      hotSpots: util.markSpotsSelected(this.data.hotSpots, ids),
      searchResults: util.markSpotsSelected(this.data.searchResults, ids),
    });
  },

  onClearSelected() {
    if (!this.data.selectedSpotIds.length) return;
    this.setData({ showClearDialog: true });
  },

  onClearCancel() { this.setData({ showClearDialog: false }); },

  onClearConfirm() {
    this.setData({
      showClearDialog: false,
      selectedSpots: [],
      selectedSpotIds: [],
      hotSpots: util.markSpotsSelected(this.data.hotSpots, []),
      searchResults: util.markSpotsSelected(this.data.searchResults, []),
    });
  },

  onSpotNameTap(e) { this.setData({ showSpotPopup: true, popupSpotId: e.currentTarget.dataset.id }); },
  onSpotPopupClose() { this.setData({ showSpotPopup: false }); },

  onDone() { this.onBack(); },

  onBack() {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    // If coming from timeline page, update trip spots via API
    if (this.data.tripId) {
      api.reminder.trip.updateSpots({
        tripId: this.data.tripId,
        spotIds: util.uniqueSpotIds(this.data.selectedSpotIds),
      }).catch(() => {});
    }
    // Set data on previous page for immediate UI update
    if (prev) {
      const selectedSpotIds = util.uniqueSpotIds(this.data.selectedSpotIds);
      const patch = {
        selectedSpotIds,
        selectedSpots: util.selectSpotsByIds(this.data.selectedSpots, selectedSpotIds),
      };
      /* 添加提醒页同时渲染「北京热门景点预约状态」网格。
         该网格的选中态是卡片的 `selected` 布尔值，不能只回写 selectedSpotIds，
         否则数据已更新但 WXML 仍显示旧按钮。 */
      if (Array.isArray(prev.data && prev.data.hotSpots)) {
        patch.hotSpots = util.markSpotsSelected(prev.data.hotSpots, selectedSpotIds);
      }
      prev.setData(patch);
    }
    wx.navigateBack();
  },
});
