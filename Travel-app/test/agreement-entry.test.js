/**
 * 「我的 → 用户协议 → 隐私政策 / 用户服务协议」入口结构回归。
 *
 * 运行：node test/agreement-entry.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cardAround = (src, handler) => {
  const at = src.indexOf(`bindtap="${handler}"`);
  if (at < 0) return '';
  const start = src.lastIndexOf('<view class="setting-card">', at);
  const end = src.indexOf('<view class="setting-card">', at + 1);
  return src.slice(start, end < 0 ? src.length : end);
};

const PROFILE_JS = read('miniprogram/pages/profile/profile.js');
const PROFILE_WXML = read('miniprogram/pages/profile/profile.wxml');
const LEGAL_JS = read('miniprogram/pages/legal/legal.js');
const LEGAL_WXML = read('miniprogram/pages/legal/legal.wxml');

console.log('=== 1. 我的页归组 ===');
const group = cardAround(PROFILE_WXML, 'onHelpFeedback');
eq(!!group, true, '帮助与反馈仍为独立可点击行');
eq(/feedback-gift-hint[\s\S]*name="gift"[\s\S]*\/ 在线客服 \/ 反馈与纠错/.test(group), true,
  '帮助与反馈小字使用线上礼品图标，并以斜杠连接在线客服');
eq(group.includes('bindtap="onAgreements"'), true, '用户协议与帮助与反馈在同一设置卡');
eq(group.includes('>用户协议<'), true, '合并入口文案为「用户协议」');
eq(group.includes('class="setting-row-label">隐私政策<'), false, '我的页不再直接展示隐私政策行');
eq(group.includes('class="setting-row-label">用户服务协议<'), false, '我的页不再直接展示用户服务协议行');
eq(/onAgreements\(\)[\s\S]*\/pages\/legal\/legal\?type=index/.test(PROFILE_JS), true,
  '我的页用户协议入口进入二级菜单模式');
eq(/data-type="privacy"|data-type="terms"|bindtap="onLegal"/.test(PROFILE_WXML), false,
  '我的页不再承载法律正文跳转参数');

console.log('\n=== 2. 用户协议菜单 ===');
eq((LEGAL_WXML.match(/bindtap="onAgreementType"/g) || []).length, 2, '菜单提供两个法律入口');
eq(/data-type="privacy"[\s\S]*隐私政策/.test(LEGAL_WXML), true, '隐私政策入口存在');
eq(/data-type="terms"[\s\S]*用户服务协议/.test(LEGAL_WXML), true, '用户服务协议入口存在');
eq(/options\.type === 'index'[\s\S]*navTitle: '用户协议'/.test(LEGAL_JS), true,
  '同一页面支持用户协议菜单态');
eq(/onAgreementType\(e\)[\s\S]*\/pages\/legal\/legal\?type=\$\{type\}/.test(LEGAL_JS), true,
  '两个入口分别进入现有法律正文模式');
eq(/dataset\.type === 'terms' \? 'terms' : 'privacy'/.test(LEGAL_JS), true,
  '法律正文类型只允许 privacy / terms');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
