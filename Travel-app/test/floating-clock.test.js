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

  const defaultLayout = clock.normalizeLayout();
  eq(defaultLayout.xRatio, 1, '默认横向位置靠右且切边');
  eq(defaultLayout.yRatio, 0.2, '默认纵向位置距顶部20%');
  eq(defaultLayout.side, 'right', '默认停在右侧');
  console.log('=== 2. 前 10 分钟边界和放票后 1 分钟 ===');
  const event = clock.eventRecordsFromHome(home)[0];
  const group = clock.selectEventGroup([event], BASE);
  eq(clock.windowPhaseOf(group, group.startMs - 1), 'hidden', 'T-10 分钟前隐藏');
  eq(clock.windowPhaseOf(group, group.startMs), 'before', 'T-10 分钟整开始展示');
  eq(clock.windowPhaseOf(group, group.releaseAtMs), 'after', '到点进入开抢态');
  eq(group.endMs - group.releaseAtMs, 30000, '结束窗口严格为放票后 30 秒');
  eq(clock.windowPhaseOf(group, group.endMs - 1), 'after', '放票后 30 秒内保留');
  eq(clock.windowPhaseOf(group, group.endMs), 'hidden', '放票满 30 秒结束');
  const liveView = clock.makeViewModel({
    events: [event], nowMs: group.releaseAtMs + 5500, entitled: true, enabled: true,
    expanded: true, dismissedKeys: [], timeSynced: true, activeHome: true,
    vibrationUnlocked: true, vibrationEnabled: true,
  });
  eq(liveView.openedElapsedText, '5s', '开抢后显示已开抢时长');
  eq(liveView.spotId, 'gugong', '浮窗携带可点击景点 ID');
  eq(liveView.dockedCountdownNumber, '开抢中', '收起态使用开抢中文案');
  eq(liveView.dockedElapsedNumber, '5', '收起态显示开抢秒数');
  eq(liveView.dockedCountdownUnit, 's', '收起态秒单位单独展示');

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
  clock.updateLayout({ xRatio: 0.2, yRatio: 0.7, side: 'left' });
  const previewView = clock.startPreview({ secondsBefore: 45, spotShort: '故宫', spotName: '故宫博物院' });
  eq(clock.layout().xRatio, 1, '演示从右上贴边默认位开始');
  eq(clock.layout().yRatio, 0.2, '演示从顶部20%默认位置开始');
  eq(clock.layout().side, 'right', '演示默认吸附右侧');
  eq(previewView.visible, true, '演示模式立即可见');
  clock.setSpotPopupVisible('test-detail-popup', true);
  eq(clock.recompute().visible, false, '景点详情浮窗打开时隐藏悬浮时钟');
  clock.setSpotPopupVisible('test-detail-popup', false);
  eq(clock.recompute().visible, true, '景点详情浮窗关闭后恢复悬浮时钟');
  eq(previewView.expanded, true, '演示模式在首页自动展开');
  eq(previewView.spotName, '故宫', '演示景点可识别');
  eq(/^00:45/.test(previewView.countdownText), true, '演示倒计时在 1 分钟内');
  eq(/^4[45]$/.test(previewView.dockedCountdownNumber), true, '贴边态显示秒级数字');
  eq(previewView.dockedCountdownUnit, 's', '贴边态显示小 s 秒单位');
  eq(previewView.isDemo, true, '验收模式标记为示例');
  eq(previewView.vibrationUnlocked, true, '开发预览临时解锁震动');
  const beforeVibrate = vibrateCalls;
  eq(clock.vibrateCue(30), true, 'T-30 秒提供强震');
  eq(clock.vibrateCue(10), true, 'T-10 秒提供强震');
  eq(clock.testVibration(), true, '提供立即强震验收');
  eq(vibrateCalls, beforeVibrate + 3, '三个节点都调用系统长震');
  clock.setVibrationUnlocked(false);
  eq(clock.recompute().vibrationUnlocked, false, '预留后续视频解锁开关');
  clock.setVibrationUnlocked(true);
  clock.stopPreview();
  eq(clock.layout().xRatio, 0.2, '结束演示后恢复用户位置');
  eq(clock.layout().side, 'left', '结束演示后恢复用户吸附侧');
  eq(clock.recompute().visible, false, '结束演示后恢复真实状态');
  eq(clock.vibrationUnlocked(), false, '演示结束后恢复震动锁定');
  eq(clock.vibrationEnabled(), false, '震动开关默认关闭');
  clock.setActivePage('member-page', false);
  const memberDemo = clock.startPreview({ secondsBefore: 45, expand: true, spotShort: '故宫' });
  eq(memberDemo.isDemo, true, '会员页示例复用演示状态');
  eq(memberDemo.expanded, true, '会员页示例强制展开');
  clock.stopPreview();
  const homeSource = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
  eq(homeSource.includes('floatingClock.startPreview'), true, '首页提供演示触发入口');
  eq(homeSource.includes('onFloatingClockSpotOpen'), true, '首页接入景点详情点击');
  const spotHubSource = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.js'), 'utf8');
  const spotHubWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.wxml'), 'utf8');
  eq(spotHubSource.includes('this.openDetail(spotId)'), true, '景点 Tab 的时钟景点名复用当前详情浮窗');
  eq(spotHubSource.includes('\n    openDetail('), false, '景点 Tab 不得调用未绑定的详情方法');
  eq(spotHubWxml.includes('<spot-popup'), true, '景点 Tab 使用当前 PAGE-002 浮窗');
  eq(homeSource.includes('floatingClock.testVibration'), true, '首页提供立即震动入口');
  eq(homeSource.includes("g.envVersion === 'develop'"), true, '演示入口仅在开发/预览包显示');
  const clockComponent = fs.readFileSync(path.join(ROOT, 'miniprogram/components/floating-clock/floating-clock.js'), 'utf8');
  eq(clockComponent.includes('clock.vibrateCue(30)'), true, '倒计时 30 秒自动强震');
  eq(clockComponent.includes('clock.vibrateCue(10)'), true, '倒计时 10 秒自动强震');
  eq(clockComponent.includes('clock.vibrateCue(0)'), true, '开抢时刻自动长震');
  eq(clockComponent.includes('_vibrationCues'), true, '每个震动节点只触发一次');
  eq(homeSource.includes('membership?preview=nonmember'), true, '首页提供新会员方案验收入口');
  eq(homeSource.includes('membership?preview=unlimited'), true, '首页提供 4.9 权益验收入口');

  console.log('=== 7. 页面挂载与会员页入口 ===');
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  eq(app.usingComponents['floating-clock'], '/components/floating-clock/floating-clock', '组件全局注册');
  const excluded = new Set(['pages/payment-probe/payment-probe']);
  const userPages = app.pages.filter(page => !excluded.has(page));
  const missing = userPages.filter(page => {
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.wxml`), 'utf8');
    return !wxml.includes('<floating-clock');
  });
  eq(missing.length, 0, '全部正式用户页面挂载组件');
  const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  eq(homeWxml.includes('id="floatingClock"') && homeWxml.includes('home-page="{{true}}"'), true, '首页声明自动展开');
  excluded.forEach(page => {
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.wxml`), 'utf8');
    eq(wxml.includes('<floating-clock'), false, `${page} 不挂载`);
  });
  const adminPages = (app.subPackages || []).flatMap(pkg =>
    (pkg.pages || []).map(page => `${pkg.root}/${page}`));
  adminPages.forEach(page => {
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.wxml`), 'utf8');
    eq(wxml.includes('<floating-clock'), false, `${page} 不挂载`);
  });
  const memberWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxml'), 'utf8');
  const memberJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.js'), 'utf8');
  eq(memberWxml.includes('onFloatingClockToggle'), true, '会员页开关已绑定');
  eq(memberWxml.includes('开抢倒计时震动提醒'), true, '会员页使用新的震动权益标题');
  eq(memberWxml.includes('放票前 30 秒、10 秒和开抢时各强震一次'), true, '会员页单独说明震动权益');
  eq(memberWxml.includes('看广告视频解锁震动功能'), true, '会员页提供广告视频解锁按钮');
  eq(memberWxml.includes('name="vibration-line"'), true, '震动权益使用线性震动图标');
  eq(memberWxml.includes('name="unlock-line"'), true, '视频解锁按钮使用解锁图标');
  eq(memberWxml.includes('onFloatingClockDemo'), true, '悬浮时钟权益提供查看示例');
  eq(memberWxml.includes('package-demo-link'), true, '会员套餐内也提供查看示例');
  eq((memberWxml.match(/>查看示例><\/text>/g) || []).length, 2, '两个查看示例入口模板统一带右箭头');
  eq(memberJs.includes('expand:!0') || memberJs.includes('expand: true'), true, '会员页示例复用 45 秒展开演示');
  eq(memberWxml.includes('package-benefit-mark'), true, '套餐权益带圆点标识');
  eq(memberWxml.includes('name="lock"'), true, '震动开关默认带锁');
  eq(memberJs.includes('悬浮时钟展示放票倒计时') && (memberJs.includes('isNew:!0') || memberJs.includes('isNew: true')), true, '4.9 套餐放票倒计时展示带 New 标签');
  const clockWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/floating-clock/floating-clock.wxml'), 'utf8');
  const clockJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/components/floating-clock/floating-clock.json'), 'utf8'));
  const detailLayerWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-detail-layer/spot-detail-layer.wxml'), 'utf8');
  const detailLayerJs = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-detail-layer/spot-detail-layer.js'), 'utf8');
  eq(clockWxml.includes('<spot-detail-layer'), true, '悬浮时钟自带同页景点详情层');
  eq(clockComponent.includes('wx.navigateTo'), false, '无页面详情浮窗时也不得跳转其他页面');
  eq(clockJson.usingComponents['spot-detail-layer'], '/components/spot-detail-layer/spot-detail-layer', '悬浮时钟注册同页详情层');
  eq(detailLayerWxml.includes('show="{{showSpotPopup}}"'), true, '同页详情层复用当前 PAGE-002 样式');
  eq(detailLayerWxml.includes('<date-picker-sheet') && detailLayerWxml.includes('<reminder-auth-sheet'), true, '同页详情层具备完整提醒行动链');
  eq(detailLayerJs.includes('reminderFlow.onDateConfirm(this, e)'), true, '同页详情层复用统一提醒流程');
  const spotPopupJs = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.js'), 'utf8');
  eq(spotPopupJs.includes('floatingClock.setSpotPopupVisible'), true, '景点详情浮窗通知悬浮时钟隐藏');
  eq(clockWxml.includes('bindtouchstart="onTouchStart"'), true, '拖拽起点不拦截点击合成');
  eq(clockWxml.includes('catchtouchstart'), false, '不得用 catchtouchstart 拦截时钟子按钮点击');
  eq(clockWxml.includes('capture-catch:touchmove="onTouchMove"'), true, '捕获阶段阻断页面下拉');
  eq(clockWxml.includes('bindtouchstart="onTouchStart"'), true, '拖拽起点保留点击合成');
  eq(clockWxml.includes('bindtouchend="onTouchEnd"'), true, '拖拽结束保留点击合成');
  eq(clockWxml.includes('bindtouchcancel="onTouchCancel"'), true, '拖拽取消保留事件冒泡');
  eq(clockWxml.includes('catchtouchend'), false, '不得拦截 touchend 导致子按钮点击失效');
  eq(clockComponent.includes('wx.setPageStyle'), true, '拖拽期间临时锁定页面滚动');
  eq(clockComponent.includes('setPageScrollLock(!0)'), true, '拖拽开始锁页面');
  eq(clockComponent.includes('onTouchEnd(){setPageScrollLock(!1)'), true, '拖拽结束恢复页面滚动');
  eq(clockWxml.includes('bindtap="onClose"'), true, '关闭按钮绑定点击事件');
  eq(clockWxml.includes('fc-collapse-arrow'), true, '关闭按钮使用右箭头收起图标');
  eq(clockWxml.includes('>收起</text>'), true, '关闭按钮显示收起文案');
  eq(clockWxml.includes('bindtap="onOpen"'), true, '贴边入口绑定展开事件');
  eq(clockWxml.includes('fc-edge-number'), true, '贴边态展示秒级数字');
  eq(clockWxml.includes('fc-edge-unit'), true, '贴边态展示小 s 单位');
  eq(clockWxml.includes('fc-elapsed'), true, '展开态展示开抢时长');
  eq(clockWxml.includes('fc-spot-hit'), true, '景点名称增加点击热区');
  eq(clockWxml.includes('fc-edge-elapsed-number'), true, '收起态秒数单独竖排');
  eq(clockComponent.includes('SIDE_GAP=0'), true, '展开态默认可贴齐屏幕边缘');
  eq(clockComponent.includes('+(t.isDemo?20:0)'), true, '示例贴边态为底部标签预留高度');
  const clockWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/components/floating-clock/floating-clock.wxss'), 'utf8');
  eq(clockWxss.includes('padding-top: 13px'), true, '开抢收起态上内边距增加 2px');
  eq(clockWxss.includes('padding-bottom: 13px'), true, '开抢收起态下内边距增加 2px');
  eq(clockWxss.includes('.fc-root.is-demo .fc-edge { justify-content: flex-start; }'), true, '贴边示例内容从顶部排列');
  eq(clockWxss.includes('margin-top: auto;'), true, '贴边示例标签固定在底部');
  eq(clockWxss.includes('fc-edge-time.is-live { margin-top: 4px; }'), true, '景点与数字间距减少 2px');
  eq(clockWxml.includes('bindtap="onSpotTap"'), true, '景点名可点击打开详情');
  eq(clockWxml.includes('开抢中 '), true, '开抢后使用开抢中文案');
  eq(clockWxml.includes('{{spotName}} >'), true, '开抢后景点名右侧显示箭头');
  eq(clockWxml.includes('fc-demo-footer'), true, '示例信息位于底部');
  eq(clockWxml.includes('fc-edge-demo'), true, '贴边示例底部显示示例标签');
  eq(clockWxml.includes('wx:if="{{isDemo}}" class="fc-edge-demo"'), true, '贴边示例标签仅在演示模式出现');
  eq(clockWxml.includes('class="fc-edge-demo">\n      <text class="fc-demo-badge">示例</text>'), true, '收起态示例标签复用展开态样式');
  eq(clockWxml.includes('fc-edge-title'), true, '贴边态竖排展示抢票');
  eq(clockWxml.includes('name="clock-gold"'), true, '倒计时使用线性时钟图标');
  eq(clockWxml.includes('phase-{{phase}}'), true, '开抢时切换浮窗状态样式');
  eq(clockWxml.includes('>示例</text>'), true, '示例浮窗显示示例标识');
  eq(clockWxml.includes('>关闭演示</view>'), true, '示例浮窗提供关闭演示文字按钮');
  eq(clockWxml.includes('fc-demo-footer'), true, '示例与关闭演示位于浮窗底部');
  const memberWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxss'), 'utf8');
  eq(memberWxss.includes('.benefit-row { display: flex; align-items: flex-start;'), true, '三项权益行使用顶部对齐');
  eq((memberWxml.match(/class="benefit-icon"/g) || []).length, 3, '三项权益图标使用独立对齐容器');
  eq(memberWxss.includes('.benefit-title {') && memberWxss.includes('line-height: 32rpx;'), true, '权益标题行高与图标尺寸对齐');
  eq(memberWxss.includes('.clock-benefit-row { align-items: flex-start; }'), true, '悬浮时钟权益保持顶部对齐');
  eq(memberWxss.includes('.vibration-benefit-row { align-items: flex-start; }'), true, '震动权益保持顶部对齐');
  eq(clockWxml.includes('dockedSpotChars'), true, '贴边态在上方显示景点简称');
  eq(clockWxml.includes("phase === 'after' ? 'is-live'"), true, '开抢二字使用竖排样式');
} finally {
  clock.resetForTest();
  Date.now = realNow;
}

if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
console.log('\nfloating-clock.test.js 全部通过');
