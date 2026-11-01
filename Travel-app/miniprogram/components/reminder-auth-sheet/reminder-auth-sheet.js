Component({
  data: {
    showSample: false,
  },

  properties: {
    show: { type: Boolean, value: false },
    auth: { type: Object, value: null },
    datePlan: { type: Object, value: null },
    membership: { type: Object, value: null },
    checkoutReady: { type: Boolean, value: false },
    continueText: { type: String, value: '开启行程放票提醒' },
    busy: { type: Boolean, value: false },
    feedback: { type: String, value: '' },
    payConfirm: { type: Object, value: null },
    payButtonText: { type: String, value: '' },
    paying: { type: Boolean, value: false },
    payDisabled: { type: Boolean, value: false },
    payFeedback: { type: String, value: '' },
  },

  methods: {
    onPrimary() {
      if (this.data.busy) return;
      this.triggerEvent('primary');
    },

    onSettings() {
      if (this.data.busy) return;
      this.triggerEvent('settings');
    },

    onPay() {
      if (this.data.paying || this.data.payDisabled || !this.data.membership) return;
      this.triggerEvent('pay');
    },

    onBenefits() {
      this.triggerEvent('benefits');
    },

    onPayClose() {
      if (this.data.paying) return;
      this.triggerEvent('payclose');
    },

    onPayConfirm() {
      if (this.data.paying) return;
      this.triggerEvent('payconfirm');
    },

    onContinue() {
      if (this.data.busy || !this.data.checkoutReady) return;
      this.triggerEvent('continue');
    },

    onReselect() {
      if (this.data.busy) return;
      this.triggerEvent('reselect');
    },

    onSample() {
      this.setData({ showSample: true });
    },

    onCloseSample() {
      this.setData({ showSample: false });
    },

    onTripOnly() {
      if (this.data.busy) return;
      this.triggerEvent('triponly');
    },

    onClose() {
      if (this.data.busy) return;
      this.triggerEvent('close');
    },

    noop() {},
  },
});
