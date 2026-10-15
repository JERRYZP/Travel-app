/**
 * 日期分段标题吸顶（预约时间线 + 首页行程墙）的结构与交互约定。
 *
 * 两处共用同一套口径：`position: sticky` + 页面下发的偏移量 + 不透明底 + 夹在中间的 z-index。
 * 运行：node test/sticky-day-head.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};
/** 取第一条匹配的规则块文本；找不到返回空串（后续断言会失败并报出差异）。 */
const rule = (src, selector) => {
  const m = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(src);
  return m ? m[1] : '';
};
const num = (block, prop) => {
  const m = new RegExp(prop + '\\s*:\\s*(-?\\d+)').exec(block);
  return m ? Number(m[1]) : NaN;
};

const TS_WXSS = read('miniprogram/components/trip-section/trip-section.wxss');
const TS_WXML = read('miniprogram/components/trip-section/trip-section.wxml');
const TS_JS = read('miniprogram/components/trip-section/trip-section.js');
const HOME_WXML = read('miniprogram/pages/home/home.wxml');
const HOME_JS = read('miniprogram/pages/home/home.js');
const TC_WXSS = read('miniprogram/components/trip-card/trip-card.wxss');
const ADD_WXML = read('miniprogram/pages/add-trip/add-trip.wxml');
const ADD_WXSS = read('miniprogram/pages/add-trip/add-trip.wxss');
const ADD_JS = read('miniprogram/pages/add-trip/add-trip.js');

console.log('=== 1. 首页行程墙：日期标题吸顶，偏移量由页面下发 ===');
{
  eq(/dayStickyTop:\s*\{\s*type:\s*Number/.test(TS_JS), true,
    'dayStickyTop 属性已声明（未声明的属性不会进组件 data）');
  eq(/class="ts-day-head \{\{dayStickyTop > 0 \? 'is-pinned' : ''\}\}"/.test(TS_WXML), true,
    '偏移量未知时不吸顶');
  eq(/style="top: \{\{dayStickyTop\}\}px;"/.test(TS_WXML), true,
    'top 由页面内联下发，不在 wxss 里写死');

  const pinned = rule(TS_WXSS, '.ts-day-head.is-pinned');
  eq(/position:\s*sticky/.test(pinned), true, '吸顶用 position: sticky');
  eq(/(^|[;{\s])top\s*:/.test(pinned), false, 'wxss 不写 top（写了只会被内联覆盖，写死还会吸到状态栏底下）');
  eq(/background:\s*var\(--color-page\)/.test(pinned), true, '吸顶标题有不透明底（否则卡片透出来糊住日期）');

  /* 页面级滚动：偏移量只能是「状态栏 + 导航栏」，写常量在各机型上都会错 */
  const usages = HOME_WXML.match(/<trip-section/g) || [];
  const sticky = HOME_WXML.match(/day-sticky-top="\{\{statusBarHeight \+ navBarHeight\}\}"/g) || [];
  eq(usages.length > 0, true, '首页有 trip-section');
  eq(sticky.length, usages.length, '每个 trip-section（含历史）都下发了 day-sticky-top');
  eq(/createSelectorQuery\(/.test(HOME_JS), false,
    '首页不在 onPageScroll 里做测位（吸顶交给渲染层，别退回逐帧量位置）');
}

console.log('=== 2. 行程墙 z-index：卡片内容与菜单都要能从标题下面滑过去 ===');
{
  const pinned = rule(TS_WXSS, '.ts-day-head.is-pinned');
  const stickyZ = num(pinned, 'z-index');
  const dayMenuZ = num(rule(TS_WXSS, '.ts-day-menu'), 'z-index');
  const dayOpenZ = num(rule(TS_WXSS, '.ts-day-menu.is-open'), 'z-index');
  const catchZ = num(rule(TS_WXSS, '.ts-day-catch'), 'z-index');
  const cardMenuZ = num(rule(TC_WXSS, '.tc-menu'), 'z-index');
  const cardOpenZ = num(rule(TC_WXSS, '.tc-menu.is-open'), 'z-index');

  eq(stickyZ > 0, true, '吸顶标题有 z-index（否则定位的卡片菜单图标会浮在标题上）');
  eq(stickyZ > cardMenuZ, true, '高于卡片菜单图标：卡片滑上去时图标也要藏到标题下面');
  eq(stickyZ > dayMenuZ, true, '高于日期菜单按钮本身（它就是标题行里的那个图标）');
  eq(stickyZ > catchZ, true, '高于菜单捕获层：捕获层是 fixed 全屏，不能盖住吸顶标题');
  eq(stickyZ < dayOpenZ, true, '低于日期菜单展开态：用户正在用的弹层不能被吸顶标题盖住');
  eq(stickyZ < cardOpenZ, true, '低于卡片菜单展开态：同上');
}

console.log('=== 3. 行程墙补位块：标题上外边距让出的那条带要填掉 ===');
{
  const head = rule(TS_WXSS, '.ts-day-head');
  const marginTop = /margin:\s*(-?[\d.]+rpx)/.exec(head);
  eq(marginTop !== null, true, '标题用 margin 做纵向节奏');
  /* 置顶条的高度就是这块的盒子高度：纯 margin 会让它只有一行字那么高，
     上面贴着导航栏、下面的卡片正好切在字的下沿（2026-10-12 用户口径：上下各加 8px） */
  const pad = /padding:\s*([\d.]+)rpx\s+\S+\s+([\d.]+)rpx/.exec(head);
  eq(pad !== null && Number.parseFloat(pad[1]) >= 16 && Number.parseFloat(pad[2]) >= 16, true,
    '置顶条上下各有 ≥16rpx(8px) 内边距');
  const band = rule(TS_WXSS, '.ts-day-head.is-pinned::before');
  eq(/position:\s*absolute/.test(band), true, '补位块是绝对定位（sticky 标题即其包含块）');
  eq(/background:\s*var\(--color-page\)/.test(band), true, '补位块与页面同色');
  eq(num(band, 'top'), -Number.parseFloat(marginTop[1]), '补位块上移一个外边距');
  eq(/height:\s*([\d.]+rpx)/.exec(band)[1], marginTop[1], '补位块高度 = 标题上外边距');
}

console.log('=== 4. 预约时间线：日期标题吸在「导航栏 + 吸顶面板」下面 ===');
{
  const base = rule(ADD_WXSS, '.timeline-day-head');
  const pinned = rule(ADD_WXSS, '.timeline-day-head.is-pinned');
  eq(/position:\s*sticky/.test(pinned), true, '吸顶用 position: sticky');
  eq(/(^|[;{\s])top\s*:/.test(pinned), false, 'wxss 不写 top（面板高度量出来才知道）');
  eq(/background:\s*var\(--color-surface\)/.test(pinned), true, '标题用时间线模块的白底，卡片才挡得住');
  eq(/margin-top/.test(base), false, '日期标题没有上外边距（有的话要照行程墙补一块同色底）');

  const stickyZ = num(pinned, 'z-index');
  const panelRule = rule(ADD_WXSS, '.timeline-panel');
  const panelZ = num(panelRule, 'z-index');
  eq(stickyZ > 0 && stickyZ < panelZ, true, 'z-index 在吸顶面板之下（面板要一直压着日期标题）');
  /* 面板与吸顶日期标题同色白底，夹在中间的 1rpx 分隔线吸顶后就是一条看着像镂空的缝 */
  eq(/border-bottom/.test(panelRule), false, '吸顶面板底部不画 1rpx 分隔线（分隔交给底部阴影）');

  eq(/timelineHeadTop:\s*0/.test(ADD_JS), true, 'data 里有吸顶偏移量，初值 0 = 未测量');
  eq(/class="timeline-day-head \{\{timelineHeadTop > 0 \? 'is-pinned' : ''\}\}"/.test(ADD_WXML), true,
    '没量到偏移量就不吸顶');
  eq(/style="top: \{\{timelineHeadTop\}\}px;"/.test(ADD_WXML), true, 'top 内联下发');

  /* 偏移量必须含面板高度：只给导航栏高度会让日期标题叠在吸顶面板上 */
  eq(/statusBarHeight \+ this\.data\.navBarHeight \+ panel\.height/.test(ADD_JS), true,
    '偏移量 = 导航栏下沿 + 面板高度');
  eq(/Math\.floor\(this\.data\.statusBarHeight \+ this\.data\.navBarHeight \+ panel\.height\)/.test(ADD_JS), true,
    '偏移量向下取整：宁可重叠不到 1px，也不在半像素上留缝');
  const calls = (ADD_JS.match(/this\.measureTimelineHeadTop\(\)/g) || []).length;
  eq(calls, 2, '生成时间线与重算预览后各量一次');
  eq(/#timeline-day-head-/.test(ADD_JS), true, '日期锚点仍按标题测量（吸顶后算式两边抵消，算法不变）');
}

if (fail) {
  console.log('\n共 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('\n全部通过');
