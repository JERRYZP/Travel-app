App({
  globalData: {
    userInfo: null,
    openid: null,
    cloudEnv: 'cloud1-d5givb65417e3b8c9',
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButton: null,
    currentTripId: null,
    homeMode: 1,
  },

  onLaunch() {
    const sysInfo = wx.getWindowInfo();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    this.globalData.statusBarHeight = sysInfo.statusBarHeight;
    this.globalData.navBarHeight = (menuButton.top - sysInfo.statusBarHeight) * 2 + menuButton.height;
    this.globalData.menuButton = menuButton;

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true,
      });
    }
  },
});
