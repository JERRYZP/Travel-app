/**
 * 上线前 UX 批次静态回归 + 订阅授权选择测试。
 *
 * 覆盖：
 * - getReminderQuotaNeeded 的清单口径；
 * - confirmReminderAccess 的 ready / settings / trip-only / cancelled 分支；
 * - 三条设置提醒路径都接入共享接口，景点页不再绕过授权；
 * - 使用攻略路由、入口和禁入内容；
 * - notifier 订阅消息文案。
 *
 * 运行：node test/prelaunch-ux.test.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const apiStub = {
  reminder: {
    cart: {
      list: () => Promise.resolve({ success: true, summary: { reminderCount: 3 } }),
    },
    subscribe: {
      add: () => Promise.resolve({ success: true }),
      get: () => Promise.resolve({ success: true, quota: wxState.quota, totalQuota: wxState.quota }),
    },
  },
};

const wxState = {
  system: 'authorized',
  quota: 0,
  remembered: null,
  subscribeValue: 'accept',
  subscribeCalls: 0,
  actionIndex: 0,
  actionCalls: [],
  storage: {},
};

global.wx = {
  getAppAuthorizeSetting: () => ({
    notificationAuthorized: wxState.system,
    notificationEnabled: wxState.system === 'authorized',
  }),
  getSetting({ success }) {
    success({
      authSetting: {},
      subscriptionsSetting: {
        mainSwitch: true,
        itemSettings: wxState.remembered ? { [notify.SUBSCRIBE_TEMPLATE_ID]: wxState.remembered } : {},
      },
    });
  },
  requestSubscribeMessage({ tmplIds, success }) {
    wxState.subscribeCalls += 1;
    success({ [tmplIds[0]]: wxState.subscribeValue });
  },
  showActionSheet(opts) {
    wxState.actionCalls.push(opts);
    opts.success({ tapIndex: wxState.actionIndex });
  },
  openSetting() {},
  openAppAuthorizeSetting() {},
  showToast() {},
  getStorageSync(key) { return wxState.storage[key]; },
  setStorageSync(key, value) { wxState.storage[key] = value; },
};

const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === './api.js' && parent && parent.filename.endsWith(`${path.sep}utils${path.sep}notify.js`)) {
    return apiStub;
  }
  return origLoad.apply(this, arguments);
};
const notify = require('../miniprogram/utils/notify.js');
Module._load = origLoad;

function resetWx(patch = {}) {
  wxState.system = patch.system || 'authorized';
  wxState.quota = Number.isFinite(patch.quota) ? patch.quota : 3;
  wxState.remembered = patch.remembered || null;
  wxState.subscribeCalls = 0;
  wxState.actionIndex = Number.isFinite(patch.actionIndex) ? patch.actionIndex : 0;
  wxState.actionCalls = [];
}

(async () => {
  console.log('=== 1. 额度口径 ===');
  eq(await notify.getReminderQuotaNeeded(2), 6, '3 条提醒 × 2 个提前量 = 6 条授权');

  console.log('\n=== 1.1 mock disableReminders 镜像 ===');
  const mock = require('../miniprogram/utils/mock.js');
  const mockFirst = await mock.mockCall('cart.add', { spotId: 'gugong', visitDate: '2026-12-20', remindOn: true });
  await mock.mockCall('cart.add', { spotId: 'guobo', visitDate: '2026-12-21', remindOn: false });
  const mockDisabled = await mock.mockCall('cart.commit', {
    cartId: mockFirst.cartId,
    disableReminders: true,
  });
  eq(mockDisabled.disableReminders, true, 'mock 返回 disableReminders');
  eq(mockDisabled.createdTasks, 0, 'mock 不创建提醒任务');
  eq(Object.values(mock.__internals.db.items).every(i => i.remindOn === false), true, 'mock 行程项均不提醒');
  eq(Object.values(mock.__internals.db.carts).length, 1, 'mock 只消费指定 cartId，其他草稿仍保留');

  console.log('\n=== 2. 统一授权选择 ===');
  resetWx({ system: 'authorized', quota: 3 });
  let access = await notify.confirmReminderAccess(3);
  eq(access.action, 'ready', '额度足够直接 ready');
  eq(wxState.actionCalls.length, 0, '额度足够不弹选择面板');

  resetWx({ system: 'authorized', quota: 0, actionIndex: 1 });
  wxState.subscribeValue = 'accept';
  access = await notify.confirmReminderAccess(2);
  eq(wxState.subscribeCalls, 0, '用户选择仅加行程时不触发微信授权');
  eq(access.action, 'trip-only', '用户可选仅加行程');
  eq(access.shortfall, 2, '仅加行程时返回用户未补授权前的真实缺口');
  eq(wxState.actionCalls[0].itemList[1], '仅加行程·不提醒', '选择面板有仅加行程入口');

  resetWx({ system: 'authorized', quota: 0, actionIndex: 0 });
  access = await notify.confirmReminderAccess(1);
  eq(wxState.subscribeCalls, 1, '用户点“补授权并继续”后才发起微信授权');
  eq(access.action, 'ready', '补授权成功后原地继续本次提醒');
  eq(access.shortfall, 0, '补授权成功后缺口清零');
  eq(wxState.actionCalls[0].itemList[0], '补授权并继续', '选择面板首项明确说明会继续原流程');

  resetWx({ system: 'authorized', quota: 0, actionIndex: 0 });
  access = await notify.confirmReminderAccess(2);
  eq(access.action, 'cancelled', '一次手势只补到 1 条时不能假装全部补齐');
  eq(access.reason, 'quota-shortfall', '部分补齐返回明确原因');
  eq(access.shortfall, 1, '部分补齐返回真实缺口');

  resetWx({ system: 'denied', actionIndex: 0 });
  access = await notify.confirmReminderAccess(1);
  eq(access.action, 'settings', '系统通知关闭时可选去设置');
  eq(access.settingsKind, 'system', '设置类型为系统通知');

  resetWx({ system: 'denied', actionIndex: 2 });
  access = await notify.confirmReminderAccess(1);
  eq(access.action, 'cancelled', '用户可取消且不提交');

  console.log('\n=== 3. 三条设置提醒路径共用闸门 ===');
  const setupSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/setup/setup.js'), 'utf8');
  const homeSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
  const hubSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.js'), 'utf8');
  const reminderFlowSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/reminder-flow.js'), 'utf8');
  eq(/reminderCount \* this\.data\.offsets\.length/.test(setupSrc), true, 'setup 按提醒条数和提前量计算额度');
  eq(/getReminderHealth/.test(setupSrc), true, 'setup 使用统一授权健康状态');
  eq(/requestSubscribeBurst\(1\)/.test(setupSrc), true,
    'setup 每次用户点击只申请 1 条授权');
  eq(/confirmReminderAccess/.test(setupSrc), false, 'setup 不再提供仅加行程旁路');
  eq(/confirmReminderAccess\(1\)/.test(homeSrc), true, '挽回路径只按本次 1 条提醒校验授权');
  eq(/disableReminders: true/.test(homeSrc), true, '挽回路径支持仅加行程');
  eq(/reminderFlow\.onDateConfirm/.test(hubSrc), true, '景点页使用共享提醒流程');
  eq(/confirmReminderAccess\(1\)/.test(reminderFlowSrc), true, '共享提醒流程统一处理授权闸门');
  eq(/disableReminders: true/.test(reminderFlowSrc), true, '共享提醒流程支持仅加行程');
  eq(/ensureSubscribe/.test(reminderFlowSrc), false, '共享提醒流程不保留旁路授权实现');

  console.log('\n=== 4. 使用攻略与消息文案 ===');
  const appJson = fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8');
  const profileJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.js'), 'utf8');
  const guideWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/guide/guide.wxml'), 'utf8');
  const guideJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/guide/guide.js'), 'utf8');
  eq(/"pages\/guide\/guide"/.test(appJson), true, '攻略页已注册路由');
  eq(/navigateTo\(\{ url: '\/pages\/guide\/guide' \}\)/.test(profileJs), true, '我的页入口指向攻略页');
  eq(/3 步设置提醒/.test(guideWxml), true, '攻略含三步使用说明');
  eq(/查看提醒样式示例/.test(guideWxml), true, '攻略第一步含提醒样式入口');
  eq(/onReminderSamples\(\)[\s\S]*showSampleSheet: true/.test(guideJs), true,
    '提醒样式入口在当前页打开');
  eq(/reminder-sample-sheet show="\{\{showSampleSheet\}\}"/.test(guideWxml), true,
    '攻略页复用共享提醒样式弹层');
  eq(/pages\/setup\/setup\?showSample=1/.test(guideJs), false,
    '提醒样式入口不再跳设置页中转');
  eq(/没收到提醒怎么办/.test(guideWxml), true, '攻略含提醒排障');
  eq(/去官方渠道前/.test(guideWxml), true, '攻略含官方渠道准备');
  eq(/回流|双设备|悬浮时钟|成功率翻倍/.test(guideWxml), false, '攻略不含高风险或过期技巧');

  console.log('\n=== 4.0 帮助与反馈入口 ===');
  const helpWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/help-feedback/help-feedback.wxml'), 'utf8');
  const helpJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/help-feedback/help-feedback.js'), 'utf8');
  const myFeedbackJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/my-feedback/my-feedback.js'), 'utf8');
  const feedbackWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/feedback/feedback.wxml'), 'utf8');
  const helpWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/help-feedback/help-feedback.wxss'), 'utf8');
  eq(/"pages\/help-feedback\/help-feedback"/.test(appJson), true, '帮助与反馈页已注册路由');
  eq(/"pages\/my-feedback\/my-feedback"/.test(appJson), true, '我的反馈页已注册路由');
  eq(/onHelpFeedback/.test(profileJs) && /\/pages\/help-feedback\/help-feedback/.test(profileJs), true,
    '我的页统一进入帮助与反馈');
  eq(/api\.feedback\.adminStatus\(\)[\s\S]*res\.isAdmin[\s\S]*\/pages\/admin-feedback\/admin-feedback/.test(profileJs), true,
    '长按头像仅在服务端确认管理员后进入反馈管理页');
  eq(/<button class="setting-row service-row" open-type="contact"/.test(helpWxml), true,
    '帮助与反馈页提供微信原生在线客服');
  eq(helpWxml.indexOf('在线客服') < helpWxml.indexOf('意见反馈')
    && helpWxml.indexOf('意见反馈') < helpWxml.indexOf('信息纠错'), true,
  '上方依次展示在线客服、意见反馈、信息纠错');
  eq(/setting-card my-feedback-card[\s\S]*我的反馈/.test(helpWxml), true,
    '我的反馈使用下方独立卡片');
  eq(/常见问题/.test(helpWxml), false, '帮助页不重复展示攻略中的常见问题');
  eq(/onFeedback\(\)[\s\S]*\/pages\/feedback\/feedback/.test(helpJs), true, '意见反馈直接进入表单页');
  eq(/onReportError\(\)[\s\S]*\/pages\/spot-correction\/spot-correction/.test(helpJs), true,
    '信息纠错直接进入纠错页');
  eq(/onMyFeedback\(\)[\s\S]*\/pages\/my-feedback\/my-feedback/.test(helpJs), true,
    '我的反馈直接进入记录页');
  eq(/open-type="contact"/.test(feedbackWxml), true, '意见反馈页保留次要在线客服入口');
  eq(/api\.feedback\.list\(\)/.test(myFeedbackJs), true, '我的反馈读取本人历史接口');
  eq(/util\.monthDayTime\(item\.createdAt\)/.test(myFeedbackJs), true, '反馈时间按北京时间展示');
  eq(/\.service-row \{[^}]*border-bottom: 1rpx solid var\(--color-border\)/.test(helpWxss), true,
    '在线客服与意见反馈之间有分隔线');
  const notifierSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/notifier/index.js'), 'utf8');
  eq(/thing1: \{ value: String\(spotName \|\| '景点'\) \}/.test(notifierSrc), true,
    '订阅消息预约门票显示景点名称');
  eq(/thing3: \{ value: `预约即将在\$\{offset\}分钟后开启` \}/.test(notifierSrc), true,
    '订阅消息温馨提示保留开启倒计时');
  eq(/请注意查看/.test(notifierSrc), false,
    '订阅消息温馨提示不包含“请注意查看”');

  console.log('\n=== 4.1 开发环境新用户预览 ===');
  const appSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/app.js'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
  const profileWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxss'), 'utf8');
  const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  eq(/开发调试|onPreviewNewUser|devMode|dev-card|dev-hint/.test(profileJs + profileWxml + profileWxss),
    false, '我的页不展示开发调试入口');
  eq(/previewNewUser: false/.test(appSrc), true, '全局默认不开启新用户预览');
  eq(/g\.envVersion === 'develop' && g\.previewNewUser/.test(homeSrc), true,
    '首页仅在 develop 且开关开启时强制空态');
  eq(/onExitNewUserPreview/.test(homeSrc) && /dev-preview-notice/.test(homeWxml), true,
    '预览态有明确标识和退出入口');
  eq(/app\.globalData\.previewNewUser = false/.test(homeSrc), true,
    '进入真实流程时自动退出预览');

  const feedbackWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/feedback/feedback.wxss'), 'utf8');
  eq(/\.form-input\s*\{[^}]*height:\s*88rpx[^}]*line-height:\s*88rpx[^}]*padding:\s*0\s+20rpx/.test(feedbackWxss),
    true, '意见反馈输入框有足够高度和行高，文字不被裁切');

  console.log('\n=== 5. 首次成功提示只出现一次 ===');
  wxState.storage = {};
  eq(notify.consumeFirstReminderSuccessTip(), true, '首次成功返回 true');
  eq(notify.consumeFirstReminderSuccessTip(), false, '第二次不再提示');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('测试异常:', err); process.exit(1); });
