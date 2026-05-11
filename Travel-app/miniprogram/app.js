App({
  globalData: {
    userInfo: null,
    openid: null,
    cloudEnv: 'travel-app-env',
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true,
      });
    }

    this.getUserOpenid();
  },

  getUserOpenid() {
    wx.cloud.callFunction({
      name: 'login',
    }).then(res => {
      this.globalData.openid = res.result.openid;
    }).catch(err => {
      console.error('获取 openid 失败', err);
    });
  },
});
