/**
 * 抢票悬浮时钟：窗口、会员门槛、事件切换、贴边状态与全页面挂载。
 * 运行：node test/floating-clock.test.js
 */
const fs = require('fs');
const path = require('path');
const clock = require('../miniprogram/utils/floating-clock.js');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const storage = new Map();
let vibrateCalls = 0;
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ''; },
  setStorageSync(key, value) { storage.set(key, value); },
  vibrateLong() { vibrateCalls += 1; },
};

const realNow = Date.now;
const BASE = Date.UTC(2026, 10, 15, 12, 0, 0, 0); /* 北京时间 20:00 */
let fakeNow = BASE;
Date.now = () => fakeNow;

const membership = {
  member: true,
  unlimited: true,
  memberExpiresAt: new Date(BASE + 8 * 86400000).toISOString(),
};
const releaseSlots = [{
  key: 'slot-1',
  releaseTime: '20:05',
  releaseAt: new Date(BASE + 5 * 60000).toISOString(),
}];
const home = {
  serverNow: new Date(BASE).toISOString(),
  membership,
  trips: [{
    items: [{
      itemId: 'item_1', spotId: 'gugong', spotName: '故宫博物院', spotShort: '故宫',
      visitDate: '2026-11-16', remindOn: true, releaseSlots,
    }],
  }],
};

try {
  console.log('=== 1. 格式与会员门槛 ===');
  eq(clock.formatClock(Date.UTC(2026, 10, 15, 12, 0, 0, 123)).main, '20:00:00', '北京时间主时钟');
  eq(clock.formatClock(Date.UTC(2026, 10, 15, 12, 0, 0, 123)).millis, '.123', '毫秒三位');
  eq(clock.formatCountdown(9 * 60000 + 59999), '09:59.999', '倒计时毫秒格式');
  eq(clock.entitlementOf({ member: true, unlimited: true }).entitled, true, '不限额度会员有资格');
  eq(clock.entitlementOf({ member: true, unlimited: false }).entitled, false, '3 元档无资格');
  eq(clock.entitlementOf({ member: false, unlimited: true }).entitled, false, '过期会员无资格');
  eq(clock.entitlementOf({ member: true, unlimited: true, legacyUnlimited: true }).entitled, true, '老不限额度会员有资格');

  console.log('=== 2. 前 10 分钟边界和放票后 1 分钟 ===');
  const event = clock.eventRecordsFromHome(home)[0];
  const group = clock.selectEventGroup([event], BASE);
  eq(clock.windowPhaseOf(group, group.startMs - 1), 'hidden', 'T-10 分钟前隐藏');
  eq(clock.windowPhaseOf(group, group.startMs), 'before', 'T-10 分钟整开始展示');
  eq(clock.windowPhaseOf(group, group.releaseAtMs), 'after', '到点进入开抢态');
  eq(clock.windowPhaseOf(group, group.endMs - 1), 'after', '放票后 1 分钟内保留');
  eq(clock.windowPhaseOf(group, group.endMs), 'hidden', '放票满 1 分钟结束');

  console.log('=== 3. 首页自动展开、关闭贴边、下一场重新展开 ===');
  clock.resetForTest();
  fakeNow = BASE + 5 * 60000; /* 直接进入 T-5 分钟 */
  clock.ingestHomeBootstrap(home);
  clock.setActivePage('page-home', true);
  let view = clock.recompute();
  eq(view.visible, true, '窗口内可见');
  eq(view.expanded, true, '首页自动展开');
  eq(view.spotName, '故宫', '显示服务端简称');
  clock.close();
  view = clock.recompute();
  eq(view.visible, true, '关闭后仍保留贴边入口');
  eq(view.expanded, false, '关闭后收起');
  clock.setActivePage('page-home', true);
  view = clock.recompute();
  eq(view.expanded, false, '同一事件回到首页不重复展开');

  const nextHome = {
    ...home,
    serverNow: new Date(BASE + 11 * 60000).toISOString(),
    trips: [{
      items: [{
        ...home.trips[0].items[0],
        releaseSlots: [{
          key: 'slot-2', releaseTime: '20:16',
          releaseAt: new Date(BASE + 16 * 60000).toISOString(),
        }],
      }],
    }],
  };
  fakeNow = BASE + 11 * 60000;
  clock.ingestHomeBootstrap(nextHome); /* 下一场 T-5 分钟 */
  clock.setActivePage('page-home', true);
  view = clock.recompute();
  eq(view.expanded, true, '下一场可重新自动展开');
  eq(view.releaseTime, '20:16', '切换为下一场');

  console.log('=== 4. 非首页先贴边、跨页保持 ===');
  clock.resetForTest();
  fakeNow = BASE + 5 * 60000;
  clock.ingestHomeBootstrap(home);
  clock.setActivePage('page-spots', false);
  view = clock.recompute();
  eq(view.visible, true, '非首页窗口内出现');
  eq(view.expanded, false, '非首页首次只贴边');
  clock.open();
  view = clock.recompute();
  eq(view.expanded, true, '边标可展开');
  clock.setActivePage('page-membership', false);
  view = clock.recompute();
  eq(view.expanded, true, '跨页保持展开状态');

  console.log('=== 5. 同时刻合并、总开关、布局 ===');
  const twin = clock.eventRecordsFromHome({
    trips: [{ items: [
      { itemId: 'a', spotName: '故宫', remindOn: true, releaseSlots: [releaseSlots[0]] },
      { itemId: 'b', spotName: '国博', remindOn: true, releaseSlots: [releaseSlots[0]] },
    ] }],
  });
  const twinGroup = clock.selectEventGroup(twin, BASE);
  eq(twinGroup.count, 2, '同一放票时刻合并');
  clock.resetForTest();
  fakeNow = BASE + 5 * 60000;
  clock.ingestHomeBootstrap(home);
  clock.setActivePage('page-home', true);
  clock.setEnabled(false);
  view = clock.recompute();
  eq(view.visible, false, '总开关关闭后立即隐藏');
  clock.resetForTest();
  eq(clock.enabled(), false, '总开关本机持久化');
  eq(clock.updateLayout({ xRatio: 2, yRatio: -1, side: 'left' }).xRatio, 1, '横向比例夹紧');
  eq(clock.layout().yRatio, 0, '纵向比例夹紧');

  console.log('=== 6. 真机验收演示入口 ===');
  clock.resetForTest();
  clock.setActivePage('preview-home', true);
  const previewView = clock.startPreview({ minutesBefore: 9, spotShort: '故宫', spotName: '故宫博物院' });
  eq(previewView.visible, true, '演示模式立即可见');
  eq(previewView.expanded, true, '演示模式在首页自动展开');
  eq(previewView.spotName, '故宫', '演示景点可识别');
  eq(/^09:/.test(previewView.countdownText), true, '演示倒计时约 9 分钟');
  eq(previewView.vibrationUnlocked, true, '开发阶段默认解锁震动');
  const beforeVibrate = vibrateCalls;
  eq(clock.testVibration(), true, '提供立即震动验收');
  eq(vibrateCalls, beforeVibrate + 1, '调用系统长震一次');
  clock.setVibrationUnlocked(false);
  eq(clock.recompute().vibrationUnlocked, false, '预留后续视频解锁开关');
  clock.setVibrationUnlocked(true);
  clock.stopPreview();
  eq(clock.recompute().visible, false, '结束演示后恢复真实状态');
  const homeSource = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
  eq(homeSource.includes('floatingClock.startPreview'), true, '首页提供演示触发入口');
  eq(homeSource.includes('floatingClock.testVibration'), true, '首页提供立即震动入口');
  eq(homeSource.includes("g.envVersion === 'develop'"), true, '演示入口仅在开发/预览包显示');
  const clockComponent = fs.readFileSync(path.join(ROOT, 'miniprogram/components/floating-clock/floating-clock.js'), 'utf8');
  eq(clockComponent.includes('clock.testVibration()'), true, '放票时刻自动触发震动');
  eq(clockComponent.includes('this._clockPhase==="before"'), true, '只在倒计时跨过零点时震动');

  console.log('=== 7. 页面挂载与会员页入口 ===');
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  eq(app.usingComponents['floating-clock'], '/components/floating-clock/floating-clock', '组件全局注册');
  const excluded = new Set([
    'pages/admin-after-sales/admin-after-sales',
    'pages/admin-feedback/admin-feedback',
    'pages/payment-probe/payment-probe',
  ]);
  const userPages = app.pages.filter(page => !excluded.has(page));
  const missing = userPages.filter(page => {
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.wxml`), 'utf8');
    return !wxml.includes('<floating-clock');
  });
  eq(missing.length, 0, '全部正式用户页面挂载组件');
  const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  eq(/<floating-clock home-page="\{\{true\}\}" \/>/.test(homeWxml), true, '首页声明自动展开');
  excluded.forEach(page => {
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.wxml`), 'utf8');
    eq(wxml.includes('<floating-clock'), false, `${page} 不挂载`);
  });
  const memberWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxml'), 'utf8');
  const memberJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.js'), 'utf8');
  eq(memberWxml.includes('onFloatingClockToggle'), true, '会员页开关已绑定');
  eq(memberWxml.includes('放票前 10 分钟自动出现'), true, '会员页说明功能');
  eq(memberJs.includes("含抢票悬浮时钟"), true, '4.9 套餐文案含权益');
} finally {
  clock.resetForTest();
  Date.now = realNow;
}

if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
console.log('\nfloating-clock.test.js 全部通过');
