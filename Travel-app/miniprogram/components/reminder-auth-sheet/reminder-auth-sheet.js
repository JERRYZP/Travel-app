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

    onPay(e) {
      if (this.data.paying || this.data.payDisabled || !this.data.membership) return;
      const packageId = String((e && e.currentTarget && e.currentTarget.dataset
        && e.currentTarget.dataset.id) || '');
      const option = ((this.data.membership && this.data.membership.options) || [])
        .find(item => item && item.packageId === packageId);
      if (option && option.disabled) return;
      this.triggerEvent('pay', { packageId });
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
