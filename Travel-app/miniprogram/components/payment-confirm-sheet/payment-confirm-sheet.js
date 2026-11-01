Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    amount: { type: String, value: '' },
    expiry: { type: String, value: '' },
    buttonText: { type: String, value: '' },
    paying: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    feedback: { type: String, value: '' },
  },

  data: {
    isIosDevice: false,
  },

  lifetimes: {
    attached() {
      try {
        const info = wx.getDeviceInfo
          ? wx.getDeviceInfo()
          : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
        this.setData({
          isIosDevice: String((info && info.platform) || '').toLowerCase() === 'ios',
        });
      } catch (err) {
        this.setData({ isIosDevice: false });
      }
    },
  },

  methods: {
    onClose() {
      if (this.data.paying) return;
      this.triggerEvent('close');
    },

    onConfirm() {
      if (this.data.paying || this.data.disabled) return;
      this.triggerEvent('confirm');
    },

    noop() {},
  },
});
