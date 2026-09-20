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
    /* 展开下拉的 cartId（同屏只开一个） */
    openDropdown: '',
    /* 下拉里那一行（用于回显当前值） */
    dropItem: null,
    /* 下拉浮层的内联定位（px）。在 JS 里按触发按钮的位置算——
       见 onToggleDropdown 的注释：它必须在最外层，不能放 scroll-view 里 */
    dropStyle: '',
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
        this.setData({ openDropdown: '', dropItem: null, dropStyle: '' });
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

    onClose() { this.closeDropdown(); this.triggerEvent('close'); },
    onMaskTap() { this.onClose(); },
    onSheetTap() {},
    noop() {},

    /* 下拉二选一：清单是一次性任务，不做中间态管理，只有「提醒 / 不提醒」两种 */
    onToggleDropdown(e) {
      const cartId = e.currentTarget.dataset.id;
      const item = this.findItem(cartId);
      if (!item || !item.canToggle) return;
      if (this.data.openDropdown === cartId) { this.closeDropdown(); return; }
      this.openDropdownAt(cartId, item);
    },

    /**
     * 打开下拉，并按触发按钮的位置给它定坐标。
     *
     * ⚠️ 浮层必须渲染在 `.cart-popup` 这一层（**最外层**），不能放在 row 里：
     *   - row 在 `scroll-view` 内 → 溢出部分会被裁掉，用户实测「选项看不到、被遮」
     *   - 放 `.cart-sheet` 内也不行：sheet 有入场动画（transform），
     *     会让 `position: fixed` 的后代改以它为包含块，定位整个跑偏
     * 所以浮层是 `.cart-popup` 的直接子元素，用 `position: fixed` + 视口坐标。
     */
    openDropdownAt(cartId, item) {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.createSelectorQuery().select('#drop-' + cartId).boundingClientRect(trig => {
        if (!trig) return;
        const H = 88;      // 两行选项 + 内边距（px）
        const GAP = 6;
        let top = trig.top - H - GAP;
        if (top < 10) top = trig.bottom + GAP;
        const right = Math.max(12, (win.windowWidth || 375) - trig.right);
        this.setData({
          openDropdown: cartId,
          dropItem: item,
          /* 只**预选**当前值，不提交 —— 必须点「确定」才生效 */
          dropStyle: 'top:' + top + 'px; right:' + right + 'px;',
        });
      }).exec();
    },

    closeDropdown() {
      if (!this.data.openDropdown) return;
      this.setData({ openDropdown: '', dropItem: null, dropStyle: '' });
    },

    /* 列表一滚，触发按钮就移位了 —— fixed 浮层不会跟着走，直接收起来 */
    onListScroll() {
      this.closeDropdown();
    },

    /**
     * 点选项 = **立即生效并关闭**。
     *
     * 这是手机端的手指交互：只有两项，点哪一项就是选它，不需要额外的确认步骤。
     * 「点开看一眼」也不会误改——点空白只关闭、不改动。
     */
    onPickRemind(e) {
      const cartId = this.data.openDropdown;
      const item = this.data.dropItem;
      if (!cartId || !item) return;
      const remind = e.currentTarget.dataset.remind === true
        || e.currentTarget.dataset.remind === 'true';
      this.closeDropdown();
      if (item.remindOn === remind) return;   // 点的就是当前值，不用白跑一趟
      api.reminder.cart.updateRemindOn({ cartId, remindOn: remind }).then(() => {
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
