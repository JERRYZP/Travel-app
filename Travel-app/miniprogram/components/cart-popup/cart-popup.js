const api = require('../../utils/api.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    tripId: { type: String, value: '' },
    /* 从首页弹出时 true：底部露出 TabBar（sheet 结束于 Tab 上方） */
    aboveTabbar: { type: Boolean, value: false },
  },

  data: {
    groups: [],
    summary: null,
    loading: true,
    showClearDialog: false,
  },

  observers: {
    'show': function (show) {
      if (show) {
        this.loadCart();
      }
    },
  },

  methods: {
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
        });
      }).catch(() => {
        this.setData({ loading: false });
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onSheetTap() {},

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

    onSubmit() {
      if (!this.data.summary || this.data.summary.count === 0) {
        wx.showToast({ title: '先添加至少一条提醒', icon: 'none' });
        return;
      }
      this.onClose();
      wx.navigateTo({ url: '/pages/setup/setup?tripId=' + this.data.tripId });
    },
  },
});
