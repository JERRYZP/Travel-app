const api = require('../../utils/api.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    tripId: { type: String, value: '' },
    /* 从首页弹出时 true：底部让出 TabBar + 清单栏（192rpx）；否则只让出清单栏（92rpx） */
    aboveTabbar: { type: Boolean, value: false },
  },

  data: {
    groups: [],
    summary: null,
    loading: true,
    showClearDialog: false,
    /* 由 JS 计算的内联样式（px，避免微信端 vh/calc/max-height 解析不可靠） */
    bottomOffset: '0px',  // 弹层/遮罩距屏幕底部的让位距离
    listStyle: '',        // 列表高度内联样式：'height:XXXpx;' 或 ''（自适应内容）
    maxListHeight: 0,     // 列表高度上限（px）= 80% 屏高 - 头部
  },

  lifetimes: {
    attached() {
      this.computeHeights();
    },
  },

  observers: {
    'show': function (show) {
      if (show) {
        this.computeHeights();
        this.loadCart();
      }
    },
    'aboveTabbar': function () {
      this.computeHeights();
    },
  },

  methods: {
    /** 第一性原理：弹层 + 底部提醒按钮栏(92rpx) + 最底部 Tab 栏(100rpx，仅首页) 合计最多占屏 80%。
     * 因此弹层（含头部+列表）上限 = 80% 屏高 − 底部栏高度 − 头部高度。
     * 给列表一个确定性 px 高度（height 而非 max-height），scroll-view 有明确高度就一定内部滚动。 */
    computeHeights() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const screenH = win.windowHeight || 600;
      const screenW = win.windowWidth || 375;
      const safeBottom = win.safeArea && win.safeArea.bottom ? Math.max(0, screenH - win.safeArea.bottom) : 0;
      const cartBarRpx = 92;                                     // 底部提醒按钮栏
      const tabbarRpx = this.data.aboveTabbar ? 100 : 0;        // 最底部 Tab 栏（仅首页有）
      const barPx = Math.ceil((cartBarRpx + tabbarRpx) / 750 * screenW) + safeBottom;
      const sheetMax = Math.floor(screenH * 0.8) - barPx;       // 弹层上限 = 80% − 底部栏
      const headerPx = Math.ceil(110 / 750 * screenW);          // 头部≈110rpx（留余量，保证合计不超 80%）
      const maxList = Math.max(120, sheetMax - headerPx);
      this.setData({
        bottomOffset: barPx + 'px',
        maxListHeight: maxList,
        /* 先按上限渲染：长内容首帧即封顶，不会闪出超高弹层 */
        listStyle: 'height:' + maxList + 'px;',
      });
    },

    /** 渲染后测量内容高度：内容不足上限时恢复自适应（弹层随内容变矮） */
    fitList() {
      if (!this.data.show || !this.data.maxListHeight) return;
      this.createSelectorQuery().select('.cart-list-inner').boundingClientRect(rect => {
        if (!rect || !rect.height) return;
        if (rect.height < this.data.maxListHeight) {
          this.setData({ listStyle: '' });
        }
      }).exec();
    },

    loadCart() {
      this.setData({ loading: true });
      const tripId = this.data.tripId || undefined;
      api.reminder.cart.list(tripId).then(res => {
        /* 归一化 visitDateLabel：真实后端返回「约 X月X日 (周X) 门票」，
         * 拆成 visitDate（日期，字号更大/红色）与 visitRest（「(周X) 门票」，小号/棕色），
         * 周几用英文括号，与「门票」间隔一个空格 */
        const splitVisit = label => {
          let s = String(label || '').replace(/^约\s*/, '').replace(/\s*门票\s*$/, '').trim();
          const m = s.match(/(\d+月\d+日)/);
          let date = s, rest = '';
          if (m) {
            date = m[1];
            rest = s.replace(m[1], '').trim();
          }
          return { visitDate: date, visitRest: (rest ? rest + ' 门票' : ' 门票') };
        };
        const groups = (res.groups || []).map(g => Object.assign({}, g, {
          items: (g.items || []).map(it => Object.assign({}, it, splitVisit(it.visitDateLabel))),
        }));
        this.setData({
          groups,
          summary: res.summary,
          loading: false,
        }, () => this.fitList());
      }).catch(() => {
        this.setData({ loading: false }, () => this.fitList());
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onSheetTap() {},

    noop() {},

    onRemove(e) {
      const cartId = e.currentTarget.dataset.id;
      api.reminder.cart.remove(cartId).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => {
        api.toastError(err);
      });
    },

    onClearTap() {
      this.setData({ showClearDialog: true });
    },

    onClearConfirm() {
      const tripId = this.data.tripId || undefined;
      api.reminder.cart.clear(tripId).then(() => {
        this.setData({ showClearDialog: false });
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => {
        api.toastError(err);
      });
    },

    onClearCancel() {
      this.setData({ showClearDialog: false });
    },

    onToggleRemind(e) {
      const cartId = e.currentTarget.dataset.id;
      const remindOn = e.currentTarget.dataset.remind === true || e.currentTarget.dataset.remind === 'true';
      api.reminder.cart.updateRemindOn({ cartId, remindOn: !remindOn }).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onSubmit() {
      const summary = this.data.summary;
      if (!summary || summary.count === 0) {
        wx.showToast({ title: '先添加至少一项', icon: 'none' });
        return;
      }
      this.onClose();
      if (summary.reminderCount === 0) {
        api.reminder.cart.commit({ tripId: this.data.tripId }).then(res => {
          wx.showToast({ title: res.toast || `已加入行程 · ${res.createdItems || 0} 项`, icon: 'none' });
          this.triggerEvent('change');
        }).catch(err => api.toastError(err));
        return;
      }
      wx.navigateTo({ url: '/pages/setup/setup?tripId=' + this.data.tripId });
    },
  },
});
