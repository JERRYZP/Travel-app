const api = require('../../utils/api.js');
const verify = require('../../utils/verify.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    spotId: { type: String, value: '' },
  },

  data: {
    spot: null,
    loading: true,
    tipsExpanded: false,
    showQr: false,
    qrSpot: null,
  },

  observers: {
    'show, spotId': function (show, spotId) {
      if (show && spotId) {
        this.loadDetail(spotId);
      }
      if (!show) {
        this.setData({ tipsExpanded: false, showQr: false, qrSpot: null });
      }
    },
  },

  methods: {
    loadDetail(spotId) {
      this.setData({ loading: true });
      api.spots.detail(spotId).then(res => {
        this.setData({
          spot: Object.assign({}, res.data, {
            verifiedLabel: verify.verifiedLabel(res.data.lastCheckedDate),
            verified: verify.isVerified(res.data.lastCheckedDate),
          }),
          loading: false,
        });
      }).catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onSheetTap() {
      // prevent close when tapping the sheet
    },

    toggleTips() {
      this.setData({ tipsExpanded: !this.data.tipsExpanded });
    },

    onEntryTap(e) {
      const entry = e.currentTarget.dataset.entry;
      if (entry.type === 'MINIPROGRAM' && entry.appid) {
        wx.navigateToMiniProgram({
          appId: entry.appid,
          path: entry.path || '',
          fail: () => {
            const fallback = entry.url || entry.path || '';
            if (fallback) {
              wx.setClipboardData({ data: fallback });
              wx.showToast({ title: '跳转失败，已复制官网链接', icon: 'none' });
            }
          },
        });
      } else if (entry.type === 'WEB' && entry.url) {
        wx.navigateTo({
          url: '/pages/webview/webview?url=' + encodeURIComponent(entry.url) + '&title=' + encodeURIComponent(entry.label || '景区官网'),
          fail: () => {
            wx.setClipboardData({ data: entry.url });
            wx.showToast({ title: '打开失败，已复制链接', icon: 'none' });
          },
        });
      } else if (entry.type === 'OFFICIAL_ACCOUNT') {
        if (entry.qrCode) {
          this.setData({
            showQr: true,
            qrSpot: { name: entry.value || '公众号', qrCode: entry.qrCode },
          });
        } else {
          wx.showToast({ title: '请关注公众号「' + entry.value + '」', icon: 'none' });
        }
      }
    },

    onCopyEntry(e) {
      const entry = e.currentTarget.dataset.entry;
      if (entry && entry.url) {
        wx.setClipboardData({ data: entry.url });
        wx.showToast({ title: '官网链接已复制', icon: 'none' });
      }
    },

    closeQr() {
      this.setData({ showQr: false, qrSpot: null });
    },

    noop() {},
  },
});
