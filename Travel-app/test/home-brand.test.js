/**
 * 首页品牌露出回归。
 *
 * 顶部：独立图形标识 + 独立中文字标 + 分隔线 +「行程·提醒」；
 * 底部：暖灰标识收束 + slogan。
 * 品牌资源必须按上屏尺寸栅格化，不能把 69KB SVG 原样塞进主包。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
const homeWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');
const markPath = path.join(ROOT, 'miniprogram/images/brand/zd-mark.png');
const wordmarkPath = path.join(ROOT, 'miniprogram/images/brand/zd-wordmark.png');
const mutedMarkPath = path.join(ROOT, 'miniprogram/images/brand/zd-mark-muted.png');
const mutedWordmarkPath = path.join(ROOT, 'miniprogram/images/brand/zd-wordmark-muted.png');
const homeJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};

console.log('=== 首页顶部品牌 ===');
const navbar = (homeWxml.match(/<view class="navbar-content">([\s\S]*?)<\/view>\n<\/view>/) || [])[1] || '';
eq(navbar.includes('class="navbar-brand"'), true, '导航栏使用品牌组合');
eq(navbar.includes('src="/images/brand/zd-mark.png"'), true, '导航栏引用独立图形标识');
eq(navbar.includes('src="/images/brand/zd-wordmark.png"'), true, '导航栏引用独立中文字标');
eq(navbar.includes('class="navbar-brand-divider"'), true, '品牌与页面名之间有分隔线');
eq(navbar.includes('class="navbar-page-title">行程·提醒</text>'), true, '导航栏保留页面名「行程·提醒」');
eq(homeWxml.includes('class="navbar-title"'), false, '旧居中页面名样式不再渲染');

console.log('=== 首页底部品牌 ===');
const footer = (homeWxml.match(/<view class="home-brand-footer"[\s\S]*?<\/view>\n\n  <view wx:if="\{\{previewNewUser\}\}"/) || [])[0] || '';
eq(footer.includes('class="home-brand-logo-lockup"'), true, '底部展示品牌组合');
eq(footer.includes('src="/images/brand/zd-mark-muted.png"'), true, '底部使用暖灰图形标识');
eq(footer.includes('src="/images/brand/zd-wordmark-muted.png"'), true, '底部使用暖灰中文字标');
eq(footer.includes('准点约票 · 从容出游'), true, '底部展示 slogan');
eq(footer.includes('微信搜一搜'), false, '底部不再展示微信搜索提示');
eq(footer.includes('home-brand-center'), true, '底部标识与 slogan 组成单行中间组');
eq(footer.includes('home-brand-divider'), true, '底部中间使用竖分隔线');
eq(footer.includes('home-brand-rule--left'), true, '底部左横线向左渐隐');
eq(footer.includes('home-brand-rule--right'), true, '底部右横线向右渐隐');

console.log('=== 样式与资源 ===');
eq(/\.navbar-content \{[^}]*display:\s*flex;[^}]*padding-left:\s*30rpx;/.test(homeWxss), true,
  '导航栏品牌左对齐并保留页面边距');
eq(/\.navbar-brand-mark \{[^}]*width:\s*52rpx;[^}]*height:\s*57rpx;/.test(homeWxss), true,
  '图形标识随整组再缩至 90%');
eq(/\.navbar-brand-wordmark \{[^}]*width:\s*85rpx;[^}]*height:\s*26rpx;/.test(homeWxss), true,
  '中文字标随整组再缩至 90%');
eq(/\.navbar-page-title \{[^}]*color:\s*var\(--color-text\);[^}]*font-weight:\s*400;/.test(homeWxss), true,
  '页面名不加粗并弱化一阶');
eq(/\.home-brand-mark \{[^}]*width:\s*46rpx;[^}]*height:\s*50rpx;/.test(homeWxss), true,
  '底部图形标识为原尺寸的 90%');
eq(/\.home-brand-wordmark \{[^}]*width:\s*77rpx;[^}]*height:\s*24rpx;/.test(homeWxss), true,
  '底部中文字标尺寸保持不变');
eq(/\.home-brand-footer \{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*margin-top:\s*40rpx;/.test(homeWxss), true,
  '底部品牌单行排列且整体上移 8px');
eq(/\.home-brand-divider \{[^}]*height:\s*27rpx;[^}]*background:\s*#E0D9CC;/.test(homeWxss), true,
  '底部中间分割线缩至 90% 并使用 #E0D9CC');
eq(/\.home-brand-slogan \{[^}]*margin-top:\s*0;[^}]*color:\s*#CABFA9;/.test(homeWxss), true,
  '底部 slogan 与标识同排并使用 #CABFA9');
eq(/\.home-brand-rule--left \{[^}]*rgba\(226,212,192,0\)\s*0%[^}]*#E2D4C0\s*50%/.test(homeWxss), true,
  '左横线边缘完全透明并在中段渐隐到实色');
eq(/\.home-brand-rule--right \{[^}]*#E2D4C0\s*50%[^}]*rgba\(226,212,192,0\)\s*100%/.test(homeWxss), true,
  '右横线中段渐隐到边缘完全透明');
eq(fs.existsSync(markPath), true, '图形标识 PNG 已加入主包');
eq(fs.existsSync(wordmarkPath), true, '中文字标 PNG 已加入主包');
eq(fs.existsSync(mutedMarkPath), true, '暖灰图形 PNG 已加入主包');
eq(fs.existsSync(mutedWordmarkPath), true, '暖灰中文字标 PNG 已加入主包');
const mark = fs.readFileSync(markPath);
const wordmark = fs.readFileSync(wordmarkPath);
const mutedMark = fs.readFileSync(mutedMarkPath);
const mutedWordmark = fs.readFileSync(mutedWordmarkPath);
eq(mark.slice(1, 4).toString('ascii'), 'PNG', '图形标识为 PNG');
eq(wordmark.slice(1, 4).toString('ascii'), 'PNG', '中文字标为 PNG');
eq(mutedMark.slice(1, 4).toString('ascii'), 'PNG', '暖灰图形资源为 PNG');
eq(mutedWordmark.slice(1, 4).toString('ascii'), 'PNG', '暖灰中文字标资源为 PNG');
eq(mark.length <= 16 * 1024, true, '图形标识 PNG 不超过 16KB');
eq(wordmark.length <= 16 * 1024, true, '中文字标 PNG 不超过 16KB');
eq(mutedMark.length <= 16 * 1024, true, '暖灰图形 PNG 不超过 16KB');
eq(mutedWordmark.length <= 16 * 1024, true, '暖灰中文字标 PNG 不超过 16KB');

if (fail) {
  console.error(`\n${fail} assertion(s) failed`);
  process.exit(1);
}
console.log('\nALL PASS');
