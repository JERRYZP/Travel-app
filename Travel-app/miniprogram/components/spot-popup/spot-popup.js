const api = require('../../utils/api.js');
const verify = require('../../utils/verify.js');
const release = require('../../utils/release-context.js');
const assets = require('../../utils/assets.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    spotId: { type: String, value: '' },
    /* 底部操作栏（加入提醒 / 加入行程）是否渲染。
     * 首页触发的浮窗传 false —— 首页本身就是提醒动线的起点，无需再从浮窗进入；
     * 其余入口（景点 Tab 等）保持默认 true。 */
    showActions: { type: Boolean, value: true },
    /* 分享落地模式：首屏直接露出规则推算日期和核验信息。 */
    landingMode: { type: Boolean, value: false },
    /* 只给公开分享入口渲染转发按钮。 */
    showShare: { type: Boolean, value: false },
  },

  data: {
    spot: null,
    earliestDateLabel: '',
    loading: true,
    loadFailed: false,
    tipsExpanded: false,
    showQr: false,
    qrSpot: null,
    /* 真机 px 约束：微信端 vh/calc/max-height 在 fixed + flex 弹层里不可靠。
       高度由 JS 下发，滚动区明确高度，确保正文可以滚到操作栏上方。 */
    sheetStyle: '',
    scrollStyle: '',
  },

  observers: {
    'show, spotId': function (show, spotId) {
      if (show && spotId) {
        this.computeSheetLimit();
        this.loadDetail(spotId);
      }
      if (!show) {
        if (this.fitTimer) {
          clearTimeout(this.fitTimer);
          this.fitTimer = null;
        }
        this.setData({ tipsExpanded: false, showQr: false, qrSpot: null });
      }
    },
  },

  methods: {
    computeSheetLimit() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.sheetMaxHeight = Math.max(320, Math.floor((win.windowHeight || 600) * 0.8));
      this.setData({
        sheetStyle: 'max-height:' + this.sheetMaxHeight + 'px;',
        scrollStyle: '',
      });
    },

    scheduleFitSheet() {
      if (this.fitTimer) clearTimeout(this.fitTimer);
      this.fitTimer = setTimeout(() => {
        this.fitTimer = null;
        this.fitSheet();
      }, 0);
    },

    /* 内容不足 80% 时弹层随内容自适应；超过上限时给 scroll-view 明确高度。
       scroll-view 会把内容容器和末尾占位都拉满视口，因此直接量容器会得到满高。
       这里量最后一个真实内容节点：折叠时是注意事项标题行，展开后是注意事项正文。 */
    fitSheet() {
      if (!this.data.show || !this.sheetMaxHeight) return;
      const query = this.createSelectorQuery();
      query.select('.popup-scroll-content').boundingClientRect();
      query.select('.popup-tips').boundingClientRect();
      query.select('.popup-tips-body').boundingClientRect();
      query.select('.popup-actions-bar').boundingClientRect();
      query.exec(rects => {
        const content = rects && rects[0];
        const contentEnd = (rects && (rects[2] || rects[1])) || null;
        if (!content || !contentEnd) return;
        const barHeight = rects[3] ? rects[3].height : 0;
        const naturalContentHeight = Math.max(0, contentEnd.bottom - content.top);
        const sheetHeight = Math.min(
          this.sheetMaxHeight,
          Math.ceil(naturalContentHeight + barHeight)
        );
        const scrollHeight = Math.max(1, Math.floor(sheetHeight - barHeight));
        this.setData({
          sheetStyle: 'height:' + sheetHeight + 'px;max-height:' + this.sheetMaxHeight + 'px;',
          scrollStyle: 'height:' + scrollHeight + 'px;flex:none;',
        });
      });
    },

    loadDetail(spotId) {
      this.setData({ loading: true, loadFailed: false, earliestDateLabel: '' }, () => {
        this.scheduleFitSheet();
      });
      api.spots.detail(spotId).then(res => {
        const spot = Object.assign({}, res.data, {
          verifiedLabel: verify.verifiedLabel(res.data.lastCheckedDate),
          verified: verify.isVerified(res.data.lastCheckedDate),
        });
        this.setData({
          spot,
          earliestDateLabel: spot.earliestDate
            ? release.formatMonthDay(spot.earliestDate)
            : '暂无固定窗口',
          loading: false,
          loadFailed: false,
        }, () => {
          this.scheduleFitSheet();
          this.triggerEvent('loaded', { spot });
        });
      }).catch(() => {
        this.setData({ loading: false, loadFailed: true, spot: null }, () => {
          this.scheduleFitSheet();
        });
        wx.showToast({ title: '景点详情加载失败', icon: 'none' });
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
      this.setData({ tipsExpanded: !this.data.tipsExpanded }, () => {
        this.scheduleFitSheet();
      });
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
            qrSpot: { name: entry.value || '公众号', qrCode: assets.fromLocalPath(entry.qrCode) },
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

    /* 「设置提醒」：通知父页面弹出日期选择器，选完日期后由父页面调 cart.add */
    onSetReminder() {
      if (!this.data.spot) return;
      const s = this.data.spot;
      this.triggerEvent('setreminder', {
        spotId: s.spotId,
        spotName: s.name,
        remindOn: true,
        advanceDays: s.advanceDays || 0,
        releaseTime: s.releaseTime || '',
      });
    },

    /* 「仅加行程不提醒」：同上，但 remindOn=false */
    onAddTripOnly() {
      if (!this.data.spot) return;
      const s = this.data.spot;
      this.triggerEvent('addtriponly', {
        spotId: s.spotId,
        spotName: s.name,
        remindOn: false,
        advanceDays: s.advanceDays || 0,
        releaseTime: s.releaseTime || '',
      });
    },
  },
});
