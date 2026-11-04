const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    openFaq: '',
    focus: '',
    showSampleSheet: false,
    reminderFaqs: [
      {
        key: 'commit',
        q: '生成时间线后就创建行程了吗？',
        a: '还没有。生成时间线只是预览；把项目加入清单并提交后，才会创建行程和提醒。',
      },
      {
        key: 'quota',
        q: '为什么一个行程可能授权多次？',
        a: '微信订阅消息按条授权，每条提醒需要一次授权。每次点“补授权次数+1”最多增加 1 次；勾选“总是保持以上选择”只会减少后续弹窗，不会增加次数。',
      },
      {
        key: 'success',
        q: '已经约到的景点还会提醒吗？',
        a: '不会。标记为“已约到”后不再发送提醒，也不会继续占用待提醒任务。',
      },
      {
        key: 'free',
        q: '免预约景点为什么不设提醒？',
        a: '免预约项目没有固定放票时刻，只记录进行程；需要购票时请以官方渠道当日信息为准。',
      },
    ],
    paymentFaqs: [
      {
        key: 'payment-arrival',
        q: '支付成功后，会员权益没有马上到账怎么办？',
        a: '先不要重复支付。进入对应订单点“同步支付结果”，系统也会自动查单。仍显示发放异常时，从本单进入“未到账/申请售后”，系统会带上订单信息。',
      },
      {
        key: 'payment-slots',
        q: '开通会员后，提醒名额会怎么变化？',
        a: '免费版最多 5 个；会员有效期内不限提醒名额。微信订阅消息仍需按条授权，会员身份不能替代微信授权。',
      },
      {
        key: 'payment-renew',
        q: '会员会自动续费吗？到期后已有提醒会怎样？',
        a: '不会自动续费。会员到期不删除已有提醒，已创建的提醒继续处理；新增提醒仍按到期后的当前提醒名额上限校验。',
      },
      {
        key: 'payment-refund',
        q: '哪些订单可以申请退款？',
        a: '微信支付订单需在支付后 24 小时内且没有新增任何提醒，才可提交未使用退款申请，由客服核实。新增过提醒后即使删除，也视为已使用。每笔订单最多一次全额退款。',
      },
      {
        key: 'payment-interrupted',
        q: '支付中断、取消或重复扣款怎么办？',
        a: '取消或中断不代表已扣款，最终以服务端查单结果为准。若已扣款但权益未到账，不要再次支付，先在订单详情同步结果；确认重复扣款时，可从订单售后提交问题，系统会核对重复订单。',
      },
      {
        key: 'payment-apple',
        q: 'iOS 订单为什么不能在小程序里申请退款？',
        a: 'Apple 订单由 App Store 受理退款。请在 App Store 购买记录或 reportaproblem.apple.com 申请。Apple 审核期间会员继续有效；拒绝退款时权益不变；确认退款后系统只回收本单新增权益。最终结果和到账时间以 Apple 为准。',
      },
      {
        key: 'payment-revert',
        q: '退款成功后，已经创建的提醒会被删除吗？',
        a: '不会。退款只回收本订单新增的会员权益，不删除已有提醒。退款后若会员已失效，后续新增提醒按免费版 5 个名额校验。',
      },
      {
        key: 'payment-guarantee',
        q: '开通会员能保证抢到票或免广告吗？',
        a: '不能。会员只增加提醒名额，不代抢、不代约、不保证有票。微信后台自动广告也不受会员身份控制。',
      },
    ],
  },

  onLoad(options) {
    const g = app.globalData;
    const focus = options && options.focus ? String(options.focus) : '';
    this.setData({
      statusBarHeight: g.statusBarHeight,
      navBarHeight: g.navBarHeight,
      focus,
      openFaq: focus === 'payment-faq' ? 'payment-arrival' : '',
    });
  },

  onReady() {
    if (this.data.focus !== 'payment-faq') return;
    setTimeout(() => {
      wx.pageScrollTo({
        selector: '#payment-faq',
        offsetTop: -(this.data.statusBarHeight + this.data.navBarHeight + 12),
        duration: 0,
      });
    }, 60);
  },

  onBack() {
    wx.navigateBack();
  },

  onAddTrip() {
    wx.navigateTo({ url: '/pages/add-trip/add-trip' });
  },

  onReminderSamples() {
    this.setData({ showSampleSheet: true });
  },

  onCloseReminderSamples() {
    this.setData({ showSampleSheet: false });
  },

  onNotifySettings() {
    wx.navigateTo({ url: '/pages/notify-settings/notify-settings' });
  },

  onSpots() {
    wx.redirectTo({ url: '/pages/spot-hub/spot-hub' });
  },

  onCorrection() {
    wx.navigateTo({ url: '/pages/spot-correction/spot-correction' });
  },

  onToggleFaq(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ openFaq: this.data.openFaq === key ? '' : key });
  },
});
