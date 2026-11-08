/**
 * 支付窗口没弹出来时的自查路径。
 *
 * 本组件是会员页、设置提醒页和景点补录浮层的唯一共用点，提示只写在这里就不会各存一份。
 * 这句话描述的是「点了支付但什么都没发生」这个现象，和页面上「设备不支持」
 * 是两种场景，所以按现象措辞，不下能力结论。
 */
function payHintOf(isIos) {
  return isIos
    ? '若点击支付后没有出现 Apple 支付窗口，请确认微信已更新到最新版本、iPhone 系统为 iOS 15 及以上、Apple ID 为中国大陆账号。若提示付款方式不可用，请在 iPhone“设置 > 你的姓名 > 付款与配送”中添加或更新付款方式，中国大陆可使用微信支付。'
    : '若点击支付后没有出现支付窗口，请将微信更新到最新版本后重试。';
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    amount: { type: String, value: '' },
    expiry: { type: String, value: '' },
    effect: { type: String, value: '' },
    buttonText: { type: String, value: '' },
    paying: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    feedback: { type: String, value: '' },
  },

  data: {
    isIosDevice: false,
    payHint: '',
    agreementAccepted: false,
  },

  observers: {
    show(value) {
      if (value) this.setData({ agreementAccepted: false });
    },
  },

  lifetimes: {
    attached() {
      let isIos = false;
      try {
        const info = wx.getDeviceInfo
          ? wx.getDeviceInfo()
          : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
        isIos = String((info && info.platform) || '').toLowerCase() === 'ios';
      } catch (err) {
        isIos = false;
      }
      this.setData({
        isIosDevice: isIos,
        payHint: payHintOf(isIos),
      });
    },
  },

  methods: {
    onClose() {
      if (this.data.paying) return;
      this.triggerEvent('close');
    },

    onConfirm() {
      if (this.data.paying || this.data.disabled) return;
      if (!this.data.agreementAccepted) {
        wx.showToast({ title: '请先勾选协议', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm');
    },

    onToggleAgreement() {
      if (this.data.paying) return;
      this.setData({ agreementAccepted: !this.data.agreementAccepted });
    },

    onOpenAgreement(e) {
      if (this.data.paying) return;
      const type = e && e.currentTarget && e.currentTarget.dataset.type === 'terms'
        ? 'terms'
        : 'privacy';
      wx.navigateTo({
        url: `/pages/legal/legal?type=${type}`,
        fail: () => wx.showToast({ title: '协议暂时无法打开，请稍后重试', icon: 'none' }),
      });
    },

    noop() {},
  },
});
