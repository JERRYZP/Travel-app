const api = require('../../utils/api.js');
const verify = require('../../utils/verify.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    spotId: { type: String, value: '' },
    /* 底部操作栏（加入提醒 / 加入行程）是否渲染。
     * 首页触发的浮窗传 false —— 首页本身就是提醒动线的起点，无需再从浮窗进入；
     * 其余入口（景点 Tab 等）保持默认 true。 */
    showActions: { type: Boolean, value: true },
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

    /* 我要纠错：与内页版详情页 spot-rule 的 onCorrect 同口径，带景点信息跳转纠错页自动预选。
     * 先关浮窗，避免纠错页返回时它仍盖在最上层。 */
    onCorrect() {
      const spot = this.data.spot;
      if (!spot) return;
      this.onClose();
      wx.navigateTo({
        url: '/pages/spot-correction/spot-correction?spotId=' + spot.spotId
          + '&spotName=' + encodeURIComponent(spot.name)
          + '&district=' + encodeURIComponent(spot.district || ''),
      });
    },

    noop() {},
  },
});
