/**
 * v2.4.4 体验候选验收锁：状态标签点击守卫 + 用户协议归组。
 * 同时锁死悬浮时钟不得进入本候选。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

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

console.log('=== 1. 提醒状态标签守卫 ===');
const cardJs = read('miniprogram/components/trip-card/trip-card.js');
const cardWxml = read('miniprogram/components/trip-card/trip-card.wxml');
eq(/if \(this\.data\.reminderClass !== 'miss'\) return;/.test(cardJs), true,
  '只有未送达状态会发出 missedreason');
eq(/bindtap="onMissedTap"/.test(cardWxml), true, '提醒状态 chip 仍保留统一点击入口');
const ticketChip = (cardWxml.match(/<view class="tc-state [^"]*">/) || [''])[0];
eq(/bindtap|catchtap/.test(ticketChip), false, '票务状态标签不绑定点击事件');

console.log('\n=== 2. 用户协议归组 ===');
const profileWxml = read('miniprogram/pages/profile/profile.wxml');
const profileJs = read('miniprogram/pages/profile/profile.js');
const legalWxml = read('miniprogram/pages/legal/legal.wxml');
const legalJs = read('miniprogram/pages/legal/legal.js');
eq(/feedback-gift-hint[\s\S]*name="gift"[\s\S]*\/ 在线客服 \/ 反馈与纠错/.test(profileWxml), true,
  '帮助与反馈保留线上礼品图标和斜杠文案');
eq(/bindtap="onHelpFeedback"[\s\S]*bindtap="onAgreements"/.test(profileWxml), true,
  '帮助与反馈与用户协议同组');
eq(/onAgreements\(\)[\s\S]*legal\?type=index/.test(profileJs), true, '用户协议进入菜单模式');
eq(/type === 'index'[\s\S]*onAgreementType/.test(legalWxml), true, '菜单提供两个法律入口');
eq(/options\.type === 'index'[\s\S]*navTitle: '用户协议'/.test(legalJs), true, '菜单标题为「用户协议」');

console.log('\n=== 3. 发布边界 ===');
eq(exists('miniprogram/utils/floating-clock.js'), true, '后续候选已包含悬浮时钟工具');
eq(exists('miniprogram/components/floating-clock/floating-clock.wxml'), true, '后续候选已包含悬浮时钟组件');
eq(/floating-clock/.test(read('miniprogram/pages/home/home.js') + read('miniprogram/pages/home/home.wxml')), true,
  '首页已接线悬浮时钟');

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nALL PASS');
