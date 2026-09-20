/**
 * 行程清单 BottomSheet 的两处布局约定
 *
 * 这两条都是**用户实测报上来的**，单看代码看不出来：
 *  ① 动作下拉的浮层必须渲染在最外层。它曾经 `position:absolute` 挂在行内，
 *     而行在 scroll-view 里 → 溢出部分被裁掉，用户看到的是「选项被遮住了」。
 *  ② 底部条不能再加 env(safe-area-inset-bottom)。本 sheet 通过 bottomOffset
 *     整体坐在 TabBar 之上，TabBar 自己已经吃掉了安全区，再加一次就多出一整条。
 *
 * 运行：node test/cart-popup.test.js
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

const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.wxss'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.js'), 'utf8');

console.log('=== 1. 下拉浮层在最外层，不在 scroll-view 内 ===');
{
  const listStart = WXML.indexOf('<scroll-view');
  const listEnd = WXML.indexOf('</scroll-view>');
  const popAt = WXML.indexOf('class="cart-drop-pop"');
  eq(popAt > listEnd, true, '浮层渲染在 </scroll-view> 之后（在最外层）');
  eq(WXML.slice(listStart, listEnd).indexOf('cart-drop-pop'), -1, 'scroll-view 内没有浮层');

  /* sheet 有入场动画（transform），会让 fixed 后代以它为包含块 —— 浮层也不能放 sheet 里 */
  const sheetStart = WXML.indexOf('class="cart-sheet"');
  const sheetEnd = WXML.lastIndexOf('</view>\n</view>');
  const afterSheet = WXML.slice(WXML.lastIndexOf('</scroll-view>'), popAt);
  eq(afterSheet.indexOf('</view>') >= 0, true,
    '浮层在 .cart-sheet 闭合之后（不受 sheet 的 transform 影响）');
  eq(/\.cart-drop-pop\s*\{[^}]*position:\s*fixed/.test(WXSS), true, '浮层用 position: fixed');
  eq(/\.cart-drop-pop\s*\{[^}]*position:\s*absolute/.test(WXSS), false, '浮层不再用 position: absolute');
}

console.log('=== 2. 浮层坐标由 JS 按触发按钮算 ===');
{
  eq(/id="drop-\{\{item\._id\}\}"/.test(WXML), true, '触发按钮带 id 供测量');
  eq(/boundingClientRect/.test(JS), true, '按触发按钮的位置测量');
  eq(/windowWidth/.test(JS), true, '右边界按视口宽度换算');
  eq(/bindscroll="onListScroll"/.test(WXML), true, '列表滚动时收起浮层（固定定位不会跟着走）');
  eq(/onListScroll\(\)\s*\{\s*this\.closeDropdown\(\)/.test(JS), true, 'onListScroll 收起浮层');
}

console.log('=== 3. 底部条不再重复叠加安全区 ===');
{
  const foot = /\.cart-foot\s*\{[^}]*\}/.exec(WXSS);
  eq(Boolean(foot), true, '找到 .cart-foot 样式');
  /* 先剥掉注释再断言：注释里为说明原因也提到了 env(...)，不剥会误报 */
  const decl = foot[0].replace(/\/\*[\s\S]*?\*\//g, '');
  eq(/env\(safe-area-inset-bottom\)/.test(decl), false,
    '底部条不含 env(safe-area-inset-bottom)（TabBar 已经吃掉了）');
  eq(/\.tabbar\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/.test(
    fs.readFileSync(path.join(ROOT, 'miniprogram/components/tabbar/tabbar.wxss'), 'utf8')), true,
    'TabBar 自己确实含安全区（所以这里不能再加）');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
