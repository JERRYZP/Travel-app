const app = getApp();
const api = require('../../utils/api.js');
const analytics = require('../../utils/analytics.js');
const shareEntry = require('../../utils/share-entry.js');
const util = require('../../utils/util.js');

function formatExpiry(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return '';
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function buildTripView(res) {
  const trip = (res && res.trip) || {};
  return {
    city: trip.city || '',
    title: util.tripDisplayName(trip),
    watermark: util.tripWatermark(trip),
    dateRange: util.monthDayRange(trip.startDate, trip.endDate),
    dayCount: Number(trip.dayCount) || 0,
    spotCount: Number(trip.spotCount) || 0,
    days: (trip.days || []).map(day => ({
      key: day.visitDate,
      title: util.dayTitleOf(day.visitDate),
      dayNumber: Number(day.dayNumber) || 1,
      items: day.items || [],
    })),
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTop: 64,
    canGoBack: false,
    loading: true,
    loadFailed: false,
    invalid: false,
    trip: null,
    expiresText: '',
  },

  onLoad(options) {
    const g = app.globalData;
    const statusBarHeight = g.statusBarHeight || 20;
    const navBarHeight = g.navBarHeight || 44;
    try {
      wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (e) {}
    const entry = shareEntry.consumeEntry(app, options);
    this._shareToken = entry.token;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navTop: statusBarHeight + navBarHeight,
      canGoBack: this.canGoBack(),
    });
    analytics.captureLanding({
      source: 'trip_share',
      entryType: 'trip',
      entryId: 'readonly',
    }, 'trip');
    this.loadShare();
  },

  onShow() {
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    const canGoBack = this.canGoBack();
    if (canGoBack !== this.data.canGoBack) this.setData({ canGoBack });
    if (this._shareToken) this.loadShare({ silent: true });
  },

  onPullDownRefresh() {
    this.loadShare({ silent: true }).then(() => wx.stopPullDownRefresh());
  },

  canGoBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : null;
    return !!(pages && pages.length > 1);
  },

  loadShare(opts) {
    const silent = !!(opts && opts.silent);
    const token = String(this._shareToken || '');
    if (!token) {
      this.setData({
        loading: false,
        invalid: true,
        loadFailed: false,
        trip: null,
      });
      return Promise.resolve();
    }
    if (!silent) this.setData({ loading: true, invalid: false, loadFailed: false });
    return api.reminder.tripShare.open(token).then(res => {
      this.setData({
        loading: false,
        invalid: false,
        loadFailed: false,
        trip: buildTripView(res),
        expiresText: formatExpiry(res.share && res.share.expiresOn),
      });
    }).catch(err => {
      const invalid = !!(err && err.errorCode === 1042);
      this.setData({
        loading: false,
        invalid,
        loadFailed: !invalid,
        trip: invalid ? null : this.data.trip,
      });
    });
  },

  onRetry() {
    return this.loadShare();
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  },
});
