Component({
  properties: {
    show: { type: Boolean, value: false },
    sheet: { type: Object, value: null },
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },
    onRetry() {
      this.triggerEvent('retry');
    },
    onRevoke() {
      this.triggerEvent('revoke');
    },
    noop() {},
  },
});
