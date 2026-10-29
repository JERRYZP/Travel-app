const app = getApp();

Page({
  data: {
    envVersion: '',
    cloudEnv: '',
    blocked: false,
    loading: false,
    status: '尚未开始',
    outTradeNo: '',
    detail: '',
  },

  onLoad() {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    const envVersion = (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion) || '';
    const cloudEnv = (app && app.globalData && app.globalData.cloudEnv) || '';
    this.setData({
      envVersion,
      cloudEnv,
      blocked: envVersion !== 'develop',
    });
  },

  onCreatePayment() {
    if (this.data.blocked || this.data.loading) return;
    this.setData({
      loading: true,
      status: '正在创建 ¥0.01 测试订单…',
      outTradeNo: '',
      detail: '',
    });

    wx.cloud.callFunction({
      name: 'payment-test',
      data: { action: 'create' },
    }).then(res => {
      const result = (res && res.result) || {};
      if (!result.success || !result.payment) {
        throw new Error(result.error || '支付测试函数未返回支付参数');
      }
      this.setData({
        loading: false,
        status: '订单已创建，请在微信支付窗口完成支付',
        outTradeNo: result.outTradeNo || '',
        detail: `商户订单号：${result.outTradeNo || ''}`,
      });
      wx.requestPayment({
        ...result.payment,
        success: () => this.pollPayment(result.outTradeNo),
        fail: err => {
          const message = String((err && err.errMsg) || '支付未完成');
          this.setData({
            loading: false,
            status: /cancel/i.test(message) ? '已取消支付' : `支付失败：${message}`,
          });
        },
      });
    }).catch(err => {
      this.setData({
        loading: false,
        status: `测试函数失败：${(err && err.message) || '未知错误'}`,
      });
    });
  },

  pollPayment(outTradeNo) {
    if (!outTradeNo) return;
    this.setData({ loading: true, status: '客户端支付完成，正在向微信支付查单…' });
    wx.cloud.callFunction({
      name: 'payment-test',
      data: { action: 'query', outTradeNo },
    }).then(res => {
      const result = (res && res.result) || {};
      if (!result.success) throw new Error(result.error || '查单失败');
      this.setData({
        loading: false,
        status: result.tradeState === 'SUCCESS' ? '支付成功，微信支付查单已确认' : `支付状态：${result.tradeState || '未知'}`,
        detail: `商户订单号：${result.outTradeNo || outTradeNo}\n微信交易号：${result.transactionId || '暂无'}\n金额：${(Number(result.amountFen) || 0) / 100} 元`,
      });
    }).catch(err => {
      this.setData({
        loading: false,
        status: `查单失败：${(err && err.message) || '未知错误'}`,
      });
    });
  },
});
