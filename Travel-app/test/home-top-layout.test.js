/**
 * 首页顶部布局锁定回归。
 *
 * 用户确认值：胶囊实际 bottom 优先，下方保留 8rpx + 2 CSS px；
 * 固定导航块的透明下半段不能把正文继续往下推。
 */
const fs = require('fs');
const path = require('path');
const layout = require('../miniprogram/utils/home-layout.js');

const ROOT = path.join(__dirname, '..');
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

console.log('=== 顶部布局冻结值 ===');
eq(layout.NAV_BAR_RPX, 88, '导航块高度锁定为 88rpx');
eq(layout.PAGE_GAP_RPX, 8, '胶囊下方呼吸位锁定为 8rpx');
eq(layout.EXTRA_TOP_PX, 2, '额外下移锁定为 2 CSS px');
eq(layout.pageTopOf(20, { bottom: 60 }, 320), 154,
  '320px 开发工具：胶囊 bottom=60px 时正文顶为 154rpx');
eq(layout.pageTopOf(24, { bottom: 60 }, 402), 124,
  '402px 设计基准：正文顶为 124rpx');
eq(layout.pageTopOf(54, { bottom: 100 }, 440), 182,
  'iPhone 大屏：只跟随胶囊 bottom，不被固定导航块撑到 192rpx');
eq(layout.pageTopOf(20, null, 320), 148,
  '拿不到胶囊信息时才回退导航块底边');

const homeJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
const homeWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');

eq(/homeLayout\.pageTopOf\(g\.statusBarHeight, g\.menuButton, g\.windowWidth\)/.test(homeJs), true,
  '首页只消费锁定模块的 pageTopOf');
eq(/function pageTopOf\(/.test(homeJs), false,
  '首页不得重新维护第二份顶部计算公式');
eq(/class="page-body" style="padding-top: \{\{pageTop\}\}rpx;"/.test(homeWxml), true,
  '所有首页内容共用 page-body 的唯一顶部 padding');
eq(/\.sticky-banner \{[^}]*margin-top:\s*0/.test(homeWxss), true,
  '放票横幅不添加额外顶部偏移');
eq(/\.quota-warning-banner \{[^}]*margin-top:\s*0/.test(homeWxss), true,
  '额度提示不添加额外顶部偏移');
eq(/\.empty-onboard \{[^}]*margin-top:\s*0/.test(homeWxss), true,
  '空态不添加额外顶部偏移');
eq(/\.home-skeleton \{[^}]*margin-top:\s*0/.test(homeWxss), true,
  '骨架层不添加额外顶部偏移');

if (fail) {
  console.error(`\n${fail} assertion(s) failed`);
  process.exit(1);
}
console.log('\nALL PASS');
