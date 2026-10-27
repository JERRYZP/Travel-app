/**
 * 日期标题吸顶：预约时间线（PAGE-005）。
 *
 * 口径：`position: sticky` + 页面量出来下发的偏移量 + 不透明底 + 夹在中间的 z-index。
 * 这个测试只钉住**预约时间线**这一处。
 *
 * ⚠️ 首页行程墙的日期吸顶（`components/trip-section` 的 `.ts-day-head.is-pinned`）
 *    尚未合入 main，它只存在于 `codex/ux1012` 分支上。本轮只移植时间线这一处，
 *    所以这里不覆盖首页。等首页那套移植过来时，把分支版的第 1~3 组断言补回来。
 *
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

const ADD_WXML = read('miniprogram/pages/add-trip/add-trip.wxml');
const ADD_WXSS = read('miniprogram/pages/add-trip/add-trip.wxss');
const ADD_JS = read('miniprogram/pages/add-trip/add-trip.js');

console.log('=== 预约时间线：日期标题吸在「导航栏 + 吸顶面板」下面 ===');
{
  const base = rule(ADD_WXSS, '.timeline-day-head');
  const pinned = rule(ADD_WXSS, '.timeline-day-head.is-pinned');
  eq(/position:\s*sticky/.test(pinned), true, '吸顶用 position: sticky');
  /* top 由内联下发：面板高度随「出游日 Tab 行」在不在而变，wxss 写不出常量；
     写死 top:0 会让标题吸到状态栏底下 */
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
