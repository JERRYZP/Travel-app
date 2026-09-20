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

console.log('=== 1. 提醒开关用系统 ActionSheet，不做自绘浮层 ===');
{
  /* 这一条是被真机反复打回来的，改动前先读一下为什么：

     这个位置在 scroll-view 内。自绘浮层（position: fixed/absolute）在
     scroll-view 里会被裁切；修好裁切又要处理层级与遮罩拦截点击；
     遮罩调好又可能在别的机型上表现不同。每一层都要单独打补丁。

     系统 ActionSheet 是**原生层**的：不经过 WXML，天然不受
     scroll-view / 层级 / 遮罩影响，点选项与点取消的行为由微信保证。
     只有两项的选择，这本来就是最合适的控件。

     所以这里断言的是「**没有**自绘浮层」——不是断言某段 CSS 写对了。
     请不要再改回自绘。 */
  eq(/<view[^>]*cart-drop-pop/.test(WXML), false, '没有自绘浮层节点');
  eq(/cart-drop-mask/.test(WXML), false, '没有自绘遮罩');
  eq(/showActionSheet/.test(JS), true, '用系统 ActionSheet');
  eq(/itemList:/.test(JS), true, '候选通过 itemList 交给系统渲染');
  eq(/tapIndex/.test(JS), true, '用 tapIndex 判定选了哪一项');
  eq(/fail:\s*\(\)\s*=>\s*\{\}/.test(JS), true,
    'fail 回调留空 = 用户点取消/遮罩时什么都不做');
  eq(/cart-drop-mask|cart-drop-pop|cart-drop-opt/.test(WXSS), false, '样式里也没有浮层残留');

  /* 浮层没了，这些配套机制也该一起消失，否则是死代码 */
  eq(/openDropdown|dropStyle|dropItem/.test(JS), false, 'JS 里没有浮层状态残留');
  eq(/onListScroll/.test(WXML + JS), false, '不再需要「滚动收起浮层」');
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
