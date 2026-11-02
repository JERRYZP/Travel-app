const shareEntry = require('./utils/share-entry.js');
const spotsSnapshotSync = require('./utils/spots-snapshot-sync.js');

const CLOUD_ENV_PROD = 'cloud1-d9g9f4hja396d6e92';
const CLOUD_ENV_TEST = 'unpay-d4gf8fyrt5523ca65';

App({
  globalData: {
    userInfo: null,
    openid: null,
    cloudEnv: CLOUD_ENV_PROD,
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
    /* 只有独立支付探针在开发版/真机调试中进入免费环境，其他页面继续使用 cloud1。 */
    const launchPath = String((options && options.path) || '').split('?')[0].replace(/^\//, '');
    const isPaymentProbe = launchPath === 'pages/payment-probe/payment-probe';
    this.globalData.cloudEnv = this.globalData.envVersion === 'develop' && isPaymentProbe
      ? CLOUD_ENV_TEST
      : CLOUD_ENV_PROD;

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true,
      });
      /* 景点数据优先使用包内快照；远程同步每天最多一次，失败不阻断启动。 */
      spotsSnapshotSync.syncNow().catch(() => {});
    }
  },

  onShow(options) {
    shareEntry.rememberPending(this, options);
  },
});
