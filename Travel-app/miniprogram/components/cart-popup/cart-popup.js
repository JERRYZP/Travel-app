const api = require('../../utils/api.js');

/**
 * 行程清单 BottomSheet（31.png，2026-09-20 改版）
 *
 * 清单是**提交至行程的前一个步骤**：
 *   - 没提交之前就暂存在这里（退出、切后台都还在）；
 *   - 提交（cart.commit）之后立即清空。
 * 因为「生成时间线」已改为纯预览，用户加清单时还没有行程 ——
 * 所以这里**不传 tripId**，服务端按「当前暂存清单」处理。
 *
 * 每行有两条信息必须同屏可见：
 *   ① 这张票什么时候放（或「无需预约·随到随玩」）；
 *   ② 要不要提醒（下拉二选一）。
 * 弱提醒景点默认「仅加入行程，不提醒」，可手动改；免预约项固定不可改。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    /* 从首页弹出时 true：底部让出 TabBar（100rpx） */
    aboveTabbar: { type: Boolean, value: false },
  },

  data: {
    groups: [],
    summary: null,
    loading: true,
    showClearDialog: false,
    /* 由 JS 计算的内联样式（px，避免微信端 vh/calc/max-height 解析不可靠） */
    bottomOffset: '0px',
    listStyle: '',
    maxListHeight: 0,
    /* 「开票前提醒我」——不写「放票了提醒我」：
       提醒实际于开票**前 N 分钟**发送，后者会让用户误以为是开票那一刻推送 */
    OPTION_ON: '开票前提醒我',
    OPTION_OFF: '仅加入行程·不提醒',
  },

  lifetimes: {
    attached() { this.computeHeights(); },
  },

  observers: {
    show: function (show) {
      if (show) {
        this.computeHeights();
        this.loadCart();
      } else {
      }
    },
    aboveTabbar: function () { this.computeHeights(); },
  },

  methods: {
    /**
     * 弹层 + 底部栏合计最多占屏 80%。
     *
     * 2026-09-20 起底部条**内置在本组件里**（31.png），不再依赖页面的清单条，
     * 所以这里只需让出 TabBar，不再为页面那条 92rpx 预留高度。
     */
    computeHeights() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const screenH = win.windowHeight || 600;
      const screenW = win.windowWidth || 375;
      const safeBottom = win.safeArea && win.safeArea.bottom ? Math.max(0, screenH - win.safeArea.bottom) : 0;
      const tabbarRpx = this.data.aboveTabbar ? 100 : 0;
      const barPx = Math.ceil(tabbarRpx / 750 * screenW) + safeBottom;
      const sheetMax = Math.floor(screenH * 0.8) - barPx;
      /* 头部 + 底部提交条 ≈ 110 + 130 rpx */
      const chromePx = Math.ceil(240 / 750 * screenW);
      const maxList = Math.max(140, sheetMax - chromePx);
      this.setData({
        bottomOffset: barPx + 'px',
        maxListHeight: maxList,
        listStyle: 'height:' + maxList + 'px;',
      });
    },

    /** 内容不足上限时恢复自适应，弹层随内容变矮 */
    fitList() {
      if (!this.data.show || !this.data.maxListHeight) return;
      this.createSelectorQuery().select('.cart-list-inner').boundingClientRect(rect => {
        if (!rect || !rect.height) return;
        if (rect.height < this.data.maxListHeight) this.setData({ listStyle: '' });
      }).exec();
    },

    loadCart() {
      this.setData({ loading: true });
      /* 不传 tripId = 读「当前暂存清单」 */
      api.reminder.cart.list().then(res => {
        const groups = (res.groups || []).map(g => Object.assign({}, g, {
          items: (g.items || []).map(it => Object.assign({}, it, {
            /* 副行：需预约说放票时刻，免预约说随到随玩。
               stateTag 只做展示，真正决定提醒开不开的是 remindOn */
            subline: it.reservationRequired === false
              ? '无需预约·随到随玩'
              : ((it.releaseTimeLabel || '') + ' 放票'),
            /* 免预约项固定不可改，不是置灰——是压根没有这个选择 */
            canToggle: it.reservationRequired !== false,
            remindText: it.remindOn ? this.data.OPTION_ON : this.data.OPTION_OFF,
          })),
        }));
        this.setData({ groups, summary: res.summary, loading: false }, () => this.fitList());
      }).catch(() => {
        this.setData({ loading: false }, () => this.fitList());
      });
    },

    onClose() { this.triggerEvent('close'); },
    onMaskTap() { this.onClose(); },
    onSheetTap() {},
    noop() {},

    /**
     * 切换提醒：直接调**系统 ActionSheet**。
     *
     * 为什么不用自绘浮层（重要，别再改回去）：
     *   这里的位置在 `scroll-view` 里。`fixed` 元素在 `scroll-view` 内会被裁切，
     *   还会引入层级、遮罩拦截点击、滚动错位等一连串问题 —— 每一层都要单独打补丁，
     *   而每一层在真机上都可能表现不同。实测反复失败。
     *
     * 系统 ActionSheet 是**原生层**的：不经过 WXML，天然不受 scroll-view / 层级
     * 影响，点选项与点遮罩的行为由微信保证。只有两项的选择，这本来就是最合适的控件。
     */
    onToggleDropdown(e) {
      const cartId = e.currentTarget.dataset.id;
      const item = this.findItem(cartId);
      /* 免预约项固定不可改：不是置灰，是压根没有这个选择 */
      if (!item || !item.canToggle) return;

      const ON = this.data.OPTION_ON;
      const OFF = this.data.OPTION_OFF;
      const other = item.remindOn ? OFF : ON;
      wx.showActionSheet({
        itemList: [other],
        success: res => {
          if (res.tapIndex !== 0) return;
          this.applyRemind(cartId, !item.remindOn);
        },
        fail: () => {},   // 用户点了取消/遮罩 —— 什么都不做
      });
    },

    /** 写入提醒开关并刷新 */
    applyRemind(cartId, remindOn) {
      api.reminder.cart.updateRemindOn({ cartId, remindOn }).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onRemove(e) {
      const cartId = e.currentTarget.dataset.id;
      api.reminder.cart.remove(cartId).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onClearTap() { this.setData({ showClearDialog: true }); },

    onClearConfirm() {
      api.reminder.cart.clear().then(() => {
        this.setData({ showClearDialog: false });
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onClearCancel() { this.setData({ showClearDialog: false }); },

    /* 主按钮：提交行程清单 —— 行程在这一刻才创建/合并 */
    onSubmit() {
      const summary = this.data.summary;
      if (!summary || summary.count === 0) {
        wx.showToast({ title: '先添加至少一项', icon: 'none' });
        return;
      }
      if (summary.reminderCount === 0) {
        this.triggerEvent('submit', { needSetup: false });
        return;
      }
      /* 有提醒项 → 先去设置提醒页配提前量，由它调 cart.commit */
      this.triggerEvent('submit', { needSetup: true });
    },

    findItem(cartId) {
      for (const g of this.data.groups) {
        const hit = (g.items || []).find(i => i._id === cartId);
        if (hit) return hit;
      }
      return null;
    },
  },
});
