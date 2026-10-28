const app = getApp();
const api = require('../../utils/api.js');
const spotsCache = require('../../utils/spots-cache.js');
const util = require('../../utils/util.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    keyword: '',
    selectedSpots: [],
    selectedSpotIds: [],
    allSpots: [],
    visibleSpots: [],
    spotsLoading: true,
    spotsError: false,
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
    this.loadSpots();
  },

  loadSelectedSpots(ids) {
    if (ids.length === 0) return;
    api.spots.batch(ids).then(res => {
      this.setData({ selectedSpots: util.selectSpotsByIds(res.data || [], ids) });
    }).catch(() => {
      this.setData({ selectedSpots: [] });
    });
  },

  /* 全量景点一次取回：页面内即时过滤，不再为每个关键词请求云函数。 */
  loadSpots() {
    this.setData({ spotsLoading: true, spotsError: false });
    spotsCache.list(() => api.spots.list()).then(res => {
      const allSpots = util.markSpotsSelected(res.data || [], this.data.selectedSpotIds);
      this.setData({
        allSpots,
        visibleSpots: this.filterSpots(allSpots, this.data.keyword),
        spotsLoading: false,
      });
    }).catch(() => {
      this.setData({
        allSpots: [],
        visibleSpots: [],
        spotsLoading: false,
        spotsError: true,
      });
    });
  },

  /* SEARCH-RULE-001 的页面内版本：名称 / 简称 / 别名 / spotId 子串匹配。
     别名由 spots.list 随卡片下发，避免页面再维护一套景点数据。 */
  filterSpots(list, keyword) {
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return list || [];
    return (list || []).filter(spot => {
      const fields = [spot.name, spot.shortName, spot.spotId].concat(spot.aliases || []);
      return fields.some(value => String(value || '').toLowerCase().indexOf(kw) >= 0);
    });
  },

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({
      keyword,
      visibleSpots: this.filterSpots(this.data.allSpots, keyword),
    });
  },

  onClearKeyword() {
    this.setData({
      keyword: '',
      visibleSpots: this.data.allSpots,
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
    }
    const allSpots = util.markSpotsSelected(this.data.allSpots, nextIds);
    this.setData({
      selectedSpotIds: util.uniqueSpotIds(nextIds),
      selectedSpots: util.markSpotsSelected(nextSpots, nextIds),
      allSpots,
      visibleSpots: this.filterSpots(allSpots, this.data.keyword),
    });
  },

  onRemoveSelected(e) {
    const spotId = e.currentTarget.dataset.id;
    if (!spotId) return;
    const ids = util.uniqueSpotIds(this.data.selectedSpotIds).filter(id => id !== spotId);
    const spots = util.markSpotsSelected(this.data.selectedSpots, ids)
      .filter(s => s && s.spotId !== spotId);
    const allSpots = util.markSpotsSelected(this.data.allSpots, ids);
    this.setData({
      selectedSpotIds: ids,
      selectedSpots: spots,
      allSpots,
      visibleSpots: this.filterSpots(allSpots, this.data.keyword),
    });
  },

  onClearSelected() {
    if (!this.data.selectedSpotIds.length) return;
    this.setData({ showClearDialog: true });
  },

  onClearCancel() { this.setData({ showClearDialog: false }); },

  onClearConfirm() {
    const allSpots = util.markSpotsSelected(this.data.allSpots, []);
    this.setData({
      showClearDialog: false,
      selectedSpots: [],
      selectedSpotIds: [],
      allSpots,
      visibleSpots: this.filterSpots(allSpots, this.data.keyword),
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
