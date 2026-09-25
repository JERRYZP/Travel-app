const shareEntry = require('./utils/share-entry.js');

App({
  globalData: {
    userInfo: null,
    openid: null,
    cloudEnv: 'cloud1-d9g9f4hja396d6e92',
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButton: null,
    currentTripId: null,
    homeMode: 1,
    envVersion: '',
    previewNewUser: false,
    pendingShareEntry: null,
  },

  onLaunch(options) {
    shareEntry.rememberPending(this, options);
    const sysInfo = wx.getWindowInfo();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    this.globalData.statusBarHeight = sysInfo.statusBarHeight;
    this.globalData.navBarHeight = (menuButton.top - sysInfo.statusBarHeight) * 2 + menuButton.height;
    this.globalData.menuButton = menuButton;
    this.globalData.envVersion = (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion) || '';

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true,
      });
    }
  },

  onShow(options) {
    shareEntry.rememberPending(this, options);
  },
});
