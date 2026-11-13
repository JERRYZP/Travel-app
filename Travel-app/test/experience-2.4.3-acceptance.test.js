/**
 * v2.4.3 体验版验收包：2026-11-13 UI / 交互修复。
 * 只锁本轮可独立回滚的入口与视觉契约。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

console.log('=== 1. 首页悬浮提醒入口 ===');
const homeWxml = read('miniprogram/pages/home/home.wxml');
const homeWxss = read('miniprogram/pages/home/home.wxss');
eq(/<text>添加放票提醒<\/text>/.test(homeWxml), true, '悬浮按钮使用「添加放票提醒」');
eq(/\.fab-btn\s*\{[\s\S]*?bottom:\s*calc\(126rpx \+ env\(safe-area-inset-bottom\)\);/.test(homeWxss), true,
  '悬浮按钮在 150rpx 基础上累计下移 12px');

console.log('\n=== 2. 景点详情浮层按钮 ===');
const popupWxml = read('miniprogram/components/spot-popup/spot-popup.wxml');
const popupWxss = read('miniprogram/components/spot-popup/spot-popup.wxss');
eq(/class="popup-entry-btn[\s\S]*?catchtap="onEntryTap"[\s\S]*?data-entry="\{\{item\}\}"/.test(popupWxml), true,
  '入口按钮自身处理点击，不依赖整行冒泡');
eq(/class="popup-btn popup-btn-primary" catchtap="onSetReminder"/.test(popupWxml)
  && /class="popup-btn popup-btn-ghost" catchtap="onAddTripOnly"/.test(popupWxml), true,
  '底部设置提醒与仅加行程按钮直接捕获点击');
eq(/\.popup-actions-bar\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*2;/.test(popupWxss), true,
  '底部操作栏高于滚动内容');
eq(/class="popup-actions-bar"[^>]*>[\s\S]*?class="popup-actions-fade"/.test(popupWxml), true,
  '渐隐层位于操作栏内部，不覆盖按钮点击区');

console.log('\n=== 3. 想去景点页浮层接线 ===');
const spotsWxml = read('miniprogram/pages/spots/spots.wxml');
const spotsJson = JSON.parse(read('miniprogram/pages/spots/spots.json'));
const spotsJs = read('miniprogram/pages/spots/spots.js');
eq(/bind:setreminder="onPopupSetReminder"/.test(spotsWxml)
  && /bind:addtriponly="onPopupAddTripOnly"/.test(spotsWxml), true,
  '景点浮层事件已接到页面');
eq(/<date-picker-sheet[\s\S]*?bind:confirm="onDateConfirm"/.test(spotsWxml)
  && /<reminder-auth-sheet[\s\S]*?bind:primary="onReminderAuthPrimary"/.test(spotsWxml), true,
  '日期与授权浮层已挂载');
eq(Boolean(spotsJson.usingComponents['date-picker-sheet'])
  && Boolean(spotsJson.usingComponents['reminder-auth-sheet']), true,
  '日期与授权组件已注册');
eq(/onPopupSetReminder\(e\)[\s\S]*?multiple:\s*true/.test(spotsJs)
  && /onPopupAddTripOnly\(e\)[\s\S]*?multiple:\s*true/.test(spotsJs), true,
  '设置提醒与仅加行程均复用多日期快捷流程');

console.log('\n=== 4. 今日放票页顶部卡片 ===');
const sceneWxml = read('miniprogram/pages/share-scene/share-scene.wxml');
const sceneWxss = read('miniprogram/pages/share-scene/share-scene.wxss');
const sceneJs = read('miniprogram/pages/share-scene/share-scene.js');
eq(/scene-date/.test(sceneWxml), false, '顶部卡片不再单独展示带年份日期行');
eq(/return `\$\{p\.month\}月\$\{p\.day\}日 周\$\{weekday\}`/.test(sceneJs), true,
  '主标题使用月、日、星期且不带年份');
eq(/今日热门景点放票情况/.test(sceneJs), true, '副标题使用「今日热门景点放票情况」');
eq(/\.scene-hero\s*\{[\s\S]*?padding:\s*30rpx 28rpx;[\s\S]*?border:\s*1rpx solid #E8D4B0;[\s\S]*?box-shadow:\s*0 4rpx 16rpx rgba\(100, 60, 20, 0\.055\)/.test(sceneWxss), true,
  '顶部卡片保留留白、微弱描边和柔和投影');
eq(/\.home-float\s*\{[^}]*bottom:\s*calc\(28px \+ env\(safe-area-inset-bottom\)\)/.test(sceneWxss), true,
  '返回主页按钮保持在 28px 位置');

console.log('\n=== 5. 后台修复随候选版本 ===');
const qualityJs = read('cloudfunctions/payment/lib/admin-reminder-quality.js');
const afterSalesJs = read('cloudfunctions/payment/lib/after-sales.js');
const afterSalesTest = read('test/payment-after-sales.test.js');
const adminWorkbenchWxml = read('miniprogram/admin/after-sales/admin-after-sales.wxml');
eq(/SNAPSHOT_SCHEMA_VERSION\s*=\s*2/.test(qualityJs), true,
  '提醒质量快照使用 schema v2');
eq(/qualityFetchRanges[\s\S]*key:\s*'current'[\s\S]*key:\s*'baseline'/.test(qualityJs), true,
  '当前窗口与 5 日基线分开查询');
eq(/upgradeDependencyBlockingRefund/.test(afterSalesJs), true,
  '基础会员单退款前检查有效升级单');
eq(/errorCode,\s*1034/.test(afterSalesTest), true,
  '1.9 元升级依赖退款拦截有回归测试');
eq(/class="admin-control-card pricing-card"/.test(adminWorkbenchWxml), true,
  '工作台保留两档定价控制卡');
eq(adminWorkbenchWxml.includes('会员升级公告'), false,
  '工作台隐藏会员升级公告控制卡');

console.log('\n=== 6. 产品文档同步 ===');
const productDoc = read('产品文档.md');
eq(productDoc.includes('悬浮「+ 添加放票提醒」'), true, '首页悬浮入口文案已同步产品文档');
eq(productDoc.includes('卡片保留充足内边距，并使用微弱描边与更柔和的投影'), true,
  '今日放票顶部卡片视觉约定已同步产品文档');
eq(productDoc.includes('距底 28px'), true, '返回主页按钮位置已同步产品文档');

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nALL PASS');
