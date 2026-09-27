const api = require('../../utils/api.js');
const cartView = require('../../utils/cart-view.js');

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
 *   ① 这张票什么时候放（或「无需预约，随到随玩」）；
 *   ② 要不要提醒（下拉二选一）。
 * 弱提醒景点默认「仅加行程·不提醒」，可手动改；免预约项固定不可改。
 * 已开票项同样固定不可改：服务端下发 remindLocked，页面只渲染「仅加行程·不提醒」。
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
    tipsExpanded: true,
    cartFootText: '清单为空',
    cartBtnText: '确认加入行程',
    /* 由 JS 计算的内联样式（px，避免微信端 vh/calc/max-height 解析不可靠） */
    bottomOffset: '0px',
    listStyle: '',
    maxListHeight: 0,
    /* 「开票前提醒我」——不写「放票了提醒我」：
       提醒实际于开票**前 N 分钟**发送，后者会让用户误以为是开票那一刻推送 */
    OPTION_ON: '开票前提醒我',
    OPTION_OFF: '仅加行程·不提醒',
    /* 自定义下拉层的位置与选项。面板渲染在 scroll-view 外，避免旧实现被裁切。 */
    dropdown: { show: false, cartId: '', top: 0, left: 0, width: 0 },
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
      this.closeDropdown();
      let tipsExpanded = true;
      try { tipsExpanded = !wx.getStorageSync('cartDefaultTipsCollapsedV1'); } catch (e) {}
      this.setData({ loading: true, tipsExpanded });
      /* 不传 tripId = 读「当前暂存清单」 */
      api.reminder.cart.list().then(res => {
        const groups = cartView.normalizeCartGroups(res).map(g => Object.assign({}, g, {
          items: (g.items || []).map(it => Object.assign({}, it, {
            /* 免预约项和已开票项都固定不可改，不是置灰——是压根没有这个选择。
               已开票项由服务端下发 remindLocked，避免页面按当前时间再算一遍。 */
            canToggle: it.reservationRequired !== false && !it.remindLocked,
            remindLocked: it.remindLocked === true,
            remindText: it.remindOn ? this.data.OPTION_ON : this.data.OPTION_OFF,
          })),
        }));
        const summary = res.summary || {};
        const reminderCount = summary.reminderCount || 0;
        const count = summary.count || 0;
        this.setData({
          groups,
          summary,
          loading: false,
          cartFootText: count > 0
            ? ('已选 ' + count + ' 项，其中 ' + reminderCount + ' 项会提醒')
            : '清单为空',
          cartBtnText: reminderCount > 0 ? '第四步：设置提醒方式' : '确认加入行程',
        }, () => this.fitList());
      }).catch(() => {
        this.setData({ loading: false }, () => this.fitList());
      });
    },

    onClose() { this.closeDropdown(); this.triggerEvent('close'); },
    onToggleTips() { this.setData({ tipsExpanded: !this.data.tipsExpanded }); },
    onMaskTap() { this.onClose(); },
    onSheetTap() { this.closeDropdown(); },
    noop() {},

    closeDropdown() {
      if (this.data.dropdown && this.data.dropdown.show) {
        this.setData({ dropdown: { show: false, cartId: '', top: 0, left: 0, width: 0 } });
      }
    },

    onDropdownClose() { this.closeDropdown(); },

    onListScroll() { this.closeDropdown(); },

    /** 打开提醒下拉。面板在 scroll-view 外 fixed 渲染，位置按触发框计算。 */
    onToggleDropdown(e) {
      const cartId = e.currentTarget.dataset.id;
      const item = this.findItem(cartId);
      /* 免预约/已开票项固定不可改：保留同款灰态，但不打开菜单。 */
      if (!item || !item.canToggle) return;
      this.createSelectorQuery().select('#cart-drop-' + cartId).boundingClientRect(rect => {
        if (!rect) return;
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menuHeight = 100;
        const top = rect.bottom + menuHeight + 8 < (win.windowHeight || 800)
          ? rect.bottom + 4
          : Math.max(8, rect.top - menuHeight - 4);
        this.setData({
          dropdown: { show: true, cartId, top, left: rect.left, width: rect.width },
        });
      }).exec();
    },

    onDropdownPick(e) {
      const dropdown = this.data.dropdown;
      const item = dropdown && this.findItem(dropdown.cartId);
      const next = e.currentTarget.dataset.remind === true
        || e.currentTarget.dataset.remind === 'true';
      if (!item) return this.closeDropdown();
      if (item.remindOn === next) return this.closeDropdown();
      this.applyRemind(dropdown.cartId, next);
    },

    /** 写入提醒开关并刷新 */
    applyRemind(cartId, remindOn) {
      this.closeDropdown();
      api.reminder.cart.updateRemindOn({ cartId, remindOn }).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onRemove(e) {
      const cartId = e.currentTarget.dataset.id;
      this.closeDropdown();
      api.reminder.cart.remove(cartId).then(() => {
        this.loadCart();
        this.triggerEvent('change');
      }).catch(err => api.toastError(err));
    },

    onClearTap() { this.closeDropdown(); this.setData({ showClearDialog: true }); },

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
      try { wx.setStorageSync('cartDefaultTipsCollapsedV1', 1); } catch (e) {}
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
