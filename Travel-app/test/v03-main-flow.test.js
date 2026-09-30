/**
 * V0.3 主流程 UX 优化回归。
 *
 * 覆盖：
 * - 创建行程：步骤文案、日期锚点、平铺出游日；
 * - 行程清单：动态 CTA、提醒数汇总、首次提示；
 * - 想去景点：即时生效、完成并返回、清空二次确认；
 * - 设置提醒：权限拆分、授权硬闸门、用户主动补齐、主 CTA。
 *
 * 运行：node test/v03-main-flow.test.js
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

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
const ADD_WXML = read('miniprogram/pages/add-trip/add-trip.wxml');
const ADD_JS = read('miniprogram/pages/add-trip/add-trip.js');
const ADD_WXSS = read('miniprogram/pages/add-trip/add-trip.wxss');
const CART_WXML = read('miniprogram/components/cart-popup/cart-popup.wxml');
const CART_JS = read('miniprogram/components/cart-popup/cart-popup.js');
const SPOTS_WXML = read('miniprogram/pages/spots/spots.wxml');
const SPOTS_JS = read('miniprogram/pages/spots/spots.js');
const SETUP_WXML = read('miniprogram/pages/setup/setup.wxml');
const SETUP_JS = read('miniprogram/pages/setup/setup.js');
const SAMPLE_JS = read('miniprogram/components/reminder-sample-sheet/reminder-sample-sheet.js');
const SAMPLE_WXML = read('miniprogram/components/reminder-sample-sheet/reminder-sample-sheet.wxml');
const SAMPLE_WXSS = read('miniprogram/components/reminder-sample-sheet/reminder-sample-sheet.wxss');

console.log('=== 1. 创建行程主流程 ===');
{
  eq(/第一步：填行程信息，生成放票时间线/.test(ADD_WXML), true, '第一步有步骤编号和说明');
  eq(/仅生成预览，提交后才创建提醒/.test(ADD_WXML), true, '明确生成只是预览');
  eq(/第二步，选择要加入行程的景点/.test(ADD_WXML), true, '第二步描述用户真实动作');
  eq(/<view wx:if="\{\{showTimeline\}\}" class="timeline-section">[\s\S]*?<view class="step-heading">[\s\S]*?第二步，选择要加入行程的景点/.test(ADD_WXML), true,
    '第二步标题与日期锚点同属时间线模块');
  eq(/<view id="timeline-header" class="timeline-panel"[\s\S]*?<view class="step-heading">/.test(ADD_WXML), true,
    '第二步标题包含在吸顶面板内');
  eq(/\.step-heading \{[^}]*background: var\(--color-surface\)/.test(ADD_WXSS), true,
    '第二步标题背景与时间线模块一致');
  eq(/\.step-heading \{[^}]*padding: 34rpx 30rpx 30rpx/.test(ADD_WXSS), true,
    '第二步标题上下间距按 UI 收紧');
  eq(/\.timeline-panel \{[^}]*padding: 0 0 16rpx/.test(ADD_WXSS), true,
    '标题移入吸顶面板后不再叠加顶部模块间距');
  eq(/\.preview-note \{[^}]*margin: -18rpx 0 34rpx/.test(ADD_WXSS), true,
    '上一模块到时间线卡片的间距按 UI 调整');
  eq(/\.hot-section \{[^}]*margin-top: -16rpx/.test(ADD_WXSS), true,
    '热门景点及下方内容整体上移 8px');
  eq(/\.hot-section \{[^}]*margin-bottom: 24rpx/.test(ADD_WXSS), true,
    '选择更多景点按钮额外上移 4px');
  eq(/\.timeline-panel \{[^}]*border-radius: 32rpx 32rpx 0 0/.test(ADD_WXSS), true,
    '时间线模块顶部沿用 UI 圆角');
  eq(ADD_WXML.indexOf('id="page-scroll"') >= 0
    && ADD_WXML.indexOf('scroll-top="\{\{pageScrollTop\}\}"') >= 0, true,
  '页面滚动容器接可控的 scroll-top 锚点');
  eq(ADD_WXML.indexOf('id="timeline-day-head-{{day.key}}"') >= 0, true, '日期标题有独立定位锚点');
  eq(ADD_WXML.indexOf('id="timeline-tab-scroll"') >= 0
    && ADD_WXML.indexOf('scroll-left="\{\{tabScrollLeft\}\}"') >= 0, true,
  '横向日期锚点走可控的 scroll-left');
  eq(ADD_WXML.indexOf('scroll-into-view="date-anchor-') < 0, true, '横向日期锚点不再把选中项贴到最左侧');
  eq(/revealTimelineTab/.test(ADD_JS), true, '选中日期被遮挡时触发横向补位');
  eq(/this\.setData\(\{ timelineActiveTab: key \}, \(\) => this\.revealTimelineTab\(key\)\)/.test(ADD_JS), true,
    '滚动联动更新选中态后检查是否需要居中');
  eq(/scrollTimelineDayIntoView/.test(ADD_JS), true, '点击日期锚点后按标题位置精确滚动');
  eq(/dayLabel: tab\.dayLabel \|\| \(startDate && tab\.key/.test(ADD_JS), true,
    '页面为旧云端数据兜底计算第几天');
  eq(/daysPast: util\.pastDaysOf\(tab\.key\)/.test(ADD_JS), true,
    '时间线日期标题计算已过去天数');
  eq(/timeline-past-note/.test(ADD_WXML), true, '时间线日期标题渲染已过去备注');
  eq(/\.timeline-past-note\s*\{[^}]*font-size:\s*20rpx/.test(ADD_WXSS), true,
    '时间线已过去备注使用辅助字号');

  const anchorFnSrc = (/function timelineAnchorScrollTop[\s\S]*?\n\}/.exec(ADD_JS) || [''])[0];
  const timelineAnchorScrollTop = anchorFnSrc
    ? new Function(anchorFnSrc + '; return timelineAnchorScrollTop;')()
    : () => 'missing';
  eq(timelineAnchorScrollTop({
    scrollTop: 0,
    titleTop: 500,
    stickyTop: 91,
    panelHeight: 110,
  }), 299, '锚点滚动让日期标题落在吸顶面板底边');
  eq(timelineAnchorScrollTop({
    scrollTop: 400,
    titleTop: 250,
    stickyTop: 91,
    panelHeight: 110,
  }), 449, '已在标题下方时仍能精确回正');
  eq(timelineAnchorScrollTop({
    scrollTop: 0,
    titleTop: 80,
    stickyTop: 91,
    panelHeight: 110,
  }), 0, '标题不需要上移时滚动位置不为负');

  const targetFnSrc = (/function timelineTabScrollTarget[\s\S]*?\n\}/.exec(ADD_JS) || [''])[0];
  const timelineTabScrollTarget = targetFnSrc
    ? new Function(targetFnSrc + '; return timelineTabScrollTarget;')()
    : () => 'missing';
  const viewport = { left: 0, width: 375 };
  eq(timelineTabScrollTarget({
    viewport,
    item: { left: 80, right: 200, width: 120 },
    contentWidth: 700,
    scrollLeft: 100,
  }), null, '选中项完整可见时不滚，保留自然向右推进');
  eq(timelineTabScrollTarget({
    viewport,
    item: { left: 330, right: 450, width: 120 },
    contentWidth: 700,
    scrollLeft: 100,
  }), 303, '选中项被右侧遮挡时计算居中位置');
  eq(timelineTabScrollTarget({
    viewport,
    item: { left: 310, right: 430, width: 120 },
    contentWidth: 700,
    scrollLeft: 400,
  }), 325, '靠末尾时滚动位置夹在最大范围内');
  eq(/class="timeline-day"/.test(ADD_WXML), true, '出游日平铺渲染');
  eq(/onDateAnchorTap/.test(ADD_JS), true, '日期锚点由页面方法处理');
  eq(/scheduleTimelineSpy/.test(ADD_JS), true, '下滑时更新顶部日期选中态');
  eq(/第三步：确认行程清单/.test(ADD_WXML), true, '底部进入清单的按钮延续步骤编号');
  eq(/cart-bar-reminder-count/.test(ADD_WXML), true, '时间线清单条的提醒数单独高亮');
  eq(/\.cart-bar\s*\{[^}]*height:\s*96rpx[^}]*background:\s*#FDFBF7/.test(ADD_WXSS), true,
    '时间线底部横条为 96rpx 高且背景为 #FDFBF7');
  eq(/\.cart-bar-icon\s*\{[^}]*width:\s*72rpx[^}]*height:\s*72rpx/.test(ADD_WXSS), true,
    '第三步清单图标与第四步保持一致');
  eq(/name="list-white" size="24px"/.test(ADD_WXML), true,
    '第三步清单图标内部图形与第四步保持一致');
  eq(/\.cart-bar-badge\s*\{[^}]*min-width:\s*34rpx[^}]*height:\s*34rpx[^}]*font-size:\s*20rpx/.test(ADD_WXSS), true,
    '第三步数量角标与第四步保持一致');
}

console.log('\n=== 2. 行程清单 ===');
{
  eq(/超难约的景点默认开启提醒/.test(CART_WXML), true, '展开后的默认提醒策略可见');
  eq(/cart-tips-title">默认提醒策略</.test(CART_WXML), true, '温馨提示标题改为默认提醒策略');
  eq(/cart-tips-folded">超难约开启 · 较易约关闭 ·免预约不提醒 · 已开票不提醒</.test(CART_WXML), true,
    '收起态正文去掉重复前缀');
  eq(/已过放票时间的景点不予提醒/.test(CART_WXML), true, '温馨提示包含已过放票时间不提醒规则');
  eq(/tipsExpanded/.test(CART_WXML + CART_JS), true, '温馨提示支持展开与折叠');
  eq(/tipsExpanded: false/.test(CART_JS), true, '温馨提示默认收起');
  eq(/cartDefaultTipsCollapsedV1/.test(CART_JS), false, '不再依赖旧的本机展开记忆');
  eq(/第四步：设置提醒方式/.test(CART_JS), true, '有提醒时 CTA 指向第四步');
  eq(/确认加入行程/.test(CART_JS), true, '无提醒时 CTA 直接确认入行程');
  eq(/cart-foot-reminder-count/.test(CART_WXML), true, '清单底部摘要按状态动态渲染');
}

console.log('\n=== 3. 想去景点即时生效 ===');
{
  eq(/完成并返回/.test(SPOTS_WXML), true, '底部按钮使用即时生效语义');
  eq(/确认选择并返回/.test(SPOTS_WXML), false, '不再使用暂存确认语义');
  eq(/onDone\(\) \{ this\.onBack\(\); \}/.test(SPOTS_JS), true, '顶部返回和底部按钮共用返回逻辑');
  eq(/已加入行程清单/.test(SPOTS_JS), true, '选择后有即时保存反馈');
  eq(/清空已选景点？/.test(SPOTS_WXML), true, '清空已选需要二次确认');
}

console.log('\n=== 4. 设置提醒权限与硬闸门 ===');
{
  eq(/第四步：设置提醒/.test(SETUP_WXML), true, '导航标题使用第四步设置提醒');
  eq(/step-caption/.test(SETUP_WXML + SETUP_JS), false, '移除导航下方的重复小标题');
  eq(/navbar-home|onHome/.test(SETUP_WXML + SETUP_JS), false, '移除返回按钮旁首页图标');
  eq(/name="back" size="18px"/.test(SETUP_WXML), true, '返回按钮样式与其他页面一致');
  eq(/\.navbar-title\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/.test(SETUP_WXML), false,
    '居中标题样式由 WXSS 管理（模板不内联定位）');
  const SETUP_WXSS = read('miniprogram/pages/setup/setup.wxss');
  eq(/\.navbar-title\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/.test(SETUP_WXSS), true,
    '设置页标题保持居中');
  eq(/name="wechat-large" size="26px"/.test(SETUP_WXML), true, '微信通知图标内部白色图形加大');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram/images/icons/wechat-large.svg')), true,
    '微信放大图标资源存在');
  eq(/checkbox \{\{channels\.officialAccount \? 'checked' : ''\}\}/.test(SETUP_WXML), true,
    '微信通知勾选框默认开启');
  eq(/name="check-white"/.test(SETUP_WXML), true, '勾选框默认显示选中图标');
  eq(/微信通知权限：/.test(SETUP_WXML), true, '系统通知权限单独展示');
  eq(/放票提醒授权：/.test(SETUP_WXML), true, '订阅授权单独展示');
  eq(/点击补授权次数/.test(SETUP_WXML), true, '缺口按钮使用点击补授权次数文案');
  eq(/\.quota-summary\s*\{[^}]*font-size:\s*23rpx/.test(SETUP_WXSS), true,
    '还差授权提示降一号字号');
  eq(/开启行程放票提醒/.test(SETUP_WXML), true, '主 CTA 使用最终文案');
  eq(/加满提醒授权/.test(SETUP_WXML + SETUP_JS), false, '移除“加满”文案');
  eq(/经过二次开发|限种子用户使用/.test(SETUP_WXML + SETUP_JS), false, '移除内部实现语言');
  eq(/暂不开启提醒|仅加入行程/.test(SETUP_WXML + SETUP_JS), false, '设置提醒页不提供绕过授权的出口');
  eq(/requestSubscribeBurst\(1\)/.test(SETUP_JS), true,
    'PAGE-008 每次用户点击只申请 1 条授权');
  eq(/confirmReminderAccess/.test(SETUP_JS), false, '提交不再调用带“仅加行程”分支的旧闸门');
  eq(/还差 \' \+ shortfall \+ \' 次授权，补齐后才能开启提醒/.test(SETUP_JS), true, '额度不足时给出明确硬提示');
  eq(/view class="submit-btn \{\{canSubmit \? '' : 'disabled'\}\}"/.test(SETUP_WXML), true, '额度不足时主按钮禁用');
  eq(/wx:if="\{\{shortfall > 0 && systemOk\}\}"[\s\S]*?class="auth-note"/.test(SETUP_WXML), true,
    '授权说明只在授权不足且可补齐时展示');
  eq(/种子用户体验/.test(SETUP_WXML + SETUP_JS), false, '移除种子用户体验标题');
  eq(/1、微信通知提醒需要主动授权，1次授权可发送1条提醒/.test(SETUP_WXML), true,
    '第一条说明主动授权用途');
  eq(/2、微信一次性订阅每次点击最多增加 1 次授权，需要几次请重复点击/.test(SETUP_WXML), true,
    '第二条说明每次点击的真实授权上限');
  eq(/3、“总是保持以上选择”只会免去后续弹窗，不会让一次点击增加多次授权/.test(SETUP_WXML), true,
    '第三条说明总是保持不改变单次授权上限');
  eq(/4、该能力当前限时免费，后续正式版可能付费。/.test(SETUP_WXML), true, '第四条短句说明限时免费');
  eq(/class="sample-link" bindtap="onOpenSample"/.test(SETUP_WXML), true,
    '查看提醒样式示例保持常驻');
  eq(/offset-hint|建议提前 5 分钟/.test(SETUP_WXML + read('miniprogram/pages/setup/setup.wxss')), false,
    '移除放票提前量下方提示');
  eq(/\.quota-line\s*\{[^}]*margin-top:\s*-24rpx/.test(SETUP_WXSS), true,
    '本次提醒文案上移 12px');
  eq(/\.sample-item\s*\{[^}]*width:\s*468rpx/.test(SAMPLE_WXSS), true,
    '提醒样式示例整体缩至原来的 90%');
  const sampleImgDecl = (/\.sample-img\s*\{[^}]*\}/.exec(SAMPLE_WXSS) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
  eq(/\.sample-img\s*\{[^}]*width:\s*468rpx/.test(SAMPLE_WXSS)
    && /max-height\s*:/.test(sampleImgDecl) === false, true,
  '提醒样式图片按原比例显示且不再压扁');
  eq(/mode="widthFix"/.test(SAMPLE_WXML), true, '图片使用等比宽度模式');
  eq(/reminder-sample-sheet show="\{\{showSampleSheet\}\}" bind:close="onCloseSample"/.test(SETUP_WXML), true,
    '设置页复用共享提醒样式组件');
  eq(/options\.showSample|sampleOnly/.test(SETUP_JS), false, '设置页不再承担示例中转');
  eq(/sampleShots/.test(SAMPLE_JS) && /查看提醒样式示例/.test(SETUP_WXML), true, '提醒样式示例直接可查看');
  eq(/提醒卡片详情/.test(SAMPLE_JS) && /reminderSample\('style-2'\)/.test(SAMPLE_JS), true, '补充提醒卡片详情示例');
  eq(/微信内的提醒样式/.test(SAMPLE_JS) && /reminderSample\('style-3'\)/.test(SAMPLE_JS), true, '补充微信内提醒列表示例');
  eq(fs.existsSync(path.join(ROOT, 'cloud-assets/images/reminder-samples/style-1.jpg')), true, '第一张提醒样式图已保留云上传源文件');
  eq(fs.existsSync(path.join(ROOT, 'cloud-assets/images/reminder-samples/style-2.jpg')), true, '提醒卡片详情图已保留云上传源文件');
  eq(fs.existsSync(path.join(ROOT, 'cloud-assets/images/reminder-samples/style-3.jpg')), true, '微信内提醒样式图已保留云上传源文件');
  eq(fs.existsSync(path.join(ROOT, 'miniprogram/images/reminder-samples/style-1.jpg')), false, '提醒样式图不再占用代码包图片额度');
}

console.log('\n=== 5. 设置提醒页面行为 ===');
const apiCalls = { commits: [] };
const toasts = [];
const modalCalls = [];
const apiStub = {
  reminder: {
    cart: {
      list: () => Promise.resolve({ summary: { reminderCount: 10 } }),
      commit: payload => {
        apiCalls.commits.push(payload);
        return Promise.resolve({ createdTasks: 10, tripId: 'trip-v03', needsOaAuth: true });
      },
    },
  },
  toastError: () => {},
};
const health = { systemOk: true, quota: 5 };
const notifyStub = {
  getReminderHealth: () => Promise.resolve(Object.assign({}, health)),
  requestSubscribeBurst: times => {
    health.quota += 1;
    return Promise.resolve({ ok: true, added: 1, silent: false, shortfall: Math.max(0, times - 1) });
  },
  hintKeepAlwaysChoice: () => {},
  openSystemNotifySetting: () => {},
  guideOpenSubscribeSetting: () => {},
  consumeFirstReminderSuccessTip: () => false,
};

global.getApp = () => ({ globalData: { statusBarHeight: 47, navBarHeight: 44 } });
global.getCurrentPages = () => [{ route: 'pages/setup/setup' }, { route: 'pages/home/home' }];
global.wx = {
  showLoading: () => {},
  hideLoading: () => {},
  showToast: o => toasts.push(o.title),
  showModal: o => modalCalls.push(o.title),
  navigateBack: () => {},
  previewImage: () => {},
  getWindowInfo: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
  getSystemInfoSync: () => ({ windowWidth: 402, windowHeight: 800, safeArea: { bottom: 800 } }),
};

const origLoad = Module._load;
function loadPage(rel) {
  let def = null;
  global.Page = o => { def = o; };
  Module._load = function (request, parent) {
    if (request === '../../utils/api.js') return apiStub;
    if (request === '../../utils/notify.js') return notifyStub;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  Module._load = origLoad;
  return def;
}

function instantiate(def) {
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

(async () => {
  const page = instantiate(loadPage('miniprogram/pages/setup/setup.js'));
  await page.refreshAccessState(10);
  eq(page.data.shortfall, 5, '额度不足时显示真实缺口');
  eq(page.data.canSubmit, false, '额度不足时主按钮不可提交');
  toasts.length = 0;
  page.onSubmit();
  eq(toasts[0].indexOf('请先补齐 5 次授权') >= 0, true, '点击禁用主按钮只提示先补齐');
  eq(apiCalls.commits.length, 0, '额度不足绝不在提交动作中偷偷自动授权');

  await page.onFillQuota();
  eq(health.quota, 6, '用户主动补齐后额度真实增加');
  eq(page.data.shortfall, 4, '页面实时刷新剩余缺口');
  eq(page.data.canSubmit, false, '仍不足时继续禁用主按钮');

  health.quota = 10;
  await page.refreshAccessState(10);
  eq(page.data.canSubmit, true, '授权满足后启用主按钮');
  modalCalls.length = 0;
  page.onSubmit();
  await new Promise(r => setTimeout(r, 20));
  eq(apiCalls.commits.length, 1, '授权满足后主按钮触发提交');
  eq(apiCalls.commits[0].channels[0], 'OFFICIAL_ACCOUNT', '提交走微信通知通道');
  eq(modalCalls.length, 0, '提交成功后不弹公众号关注引导');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  Module._load = origLoad;
  console.error('测试异常:', err);
  process.exit(1);
});
