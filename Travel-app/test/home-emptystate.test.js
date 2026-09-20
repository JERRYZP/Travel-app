/**
 * 首页空态的入口唯一性
 *
 * 用户反馈：新用户首页出现了**两个一模一样的「新增提醒」**——
 * 空态自带一个居中的 CTA，右下角又有一个悬浮按钮。
 *
 * 这类问题单测跑不出来（数据是对的、方法也存在），只能靠断言结构：
 * 两个入口的显示条件必须互斥。
 *
 * 运行：node test/home-emptystate.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

console.log('=== 1. 空态只在「一个行程项都没有」时出现 ===');
{
  /* 空态判据用的是 trips/history 都为空，而不是 isBlank 这个布尔 ——
     两者语义一致，但模板里直接用数组长度更好读、也少一个同步点。
     ⚠️ 必须带 !loading：加载期间两个数组都还是初值 []，
     不带的话新用户一进页面会先闪一下空态再切走。 */
  const blankBlock = /<block wx:if="\{\{!loading && trips\.length === 0 && history\.length === 0\}\}">/;
  eq(blankBlock.test(WXML), true, '空态块带 !loading（防加载瞬间闪空态）');
  eq(/class="empty-cta" bindtap="onAddTrip"/.test(WXML), true, '空态里有一个「新增提醒」CTA');
}

console.log('=== 2. 悬浮按钮只在已有行程时出现 ===');
{
  eq(/<view wx:if="\{\{!loading && !isBlank\}\}" class="fab-btn"/.test(WXML), true,
    '悬浮按钮带 !loading && !isBlank');
  /* 没有 wx:if 就是无条件渲染 —— 那正是「同屏两个入口」的原因 */
  eq(/<view class="fab-btn"/.test(WXML), false, '悬浮按钮不是无条件渲染');
  eq(/isBlank: trips\.length === 0 && \(res\.history \|\| \[\]\)\.length === 0/.test(JS), true,
    'isBlank 的算法与空态判据一致');
  eq(/isBlank: false,/.test(JS), true, 'isBlank 有初值（且初值为 false，配合 !loading 使用）');
}

console.log('=== 3. 两个入口互斥 ===');
{
  /* 结构上：空态 CTA 在 wx:if 块内、悬浮按钮以 !isBlank 为条件。
     两者的触发条件互补 —— 要么「无事可做 → 居中 CTA」，
     要么「已有行程 → 右下悬浮」，不会同时出现。 */
  const blankAt = WXML.indexOf('class="empty-cta"');
  const elseAt = WXML.indexOf('<block wx:else>');
  const fabAt = WXML.indexOf('class="fab-btn"');
  eq(blankAt > 0 && blankAt < elseAt, true, '空态 CTA 在 wx:if 分支内（不在 else 分支）');
  eq(fabAt > elseAt, true, '悬浮按钮在 wx:else 分支之后，由 !isBlank 二次把关');
  eq((WXML.match(/bindtap="onAddTrip"/g) || []).length, 2, '全页只有这两个入口指向 onAddTrip');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
