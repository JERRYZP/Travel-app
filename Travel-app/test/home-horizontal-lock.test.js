/**
 * 首页横向拖动锁回归。
 *
 * 首页只做纵向滚动：根节点锁横向溢出，正文宽度不得超过视口。
 * `overflow-x` 不能加在 `.page-body`，否则会破坏日期分段标题的 sticky。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');

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

const pageRule = (/page\s*\{([^}]*)\}/.exec(wxss) || [])[1] || '';
const bodyRule = (/\.page-body\s*\{([^}]*)\}/.exec(wxss) || [])[1] || '';
const canvasRule = (/\.trip-share-cover-canvas\s*\{([^}]*)\}/.exec(wxss) || [])[1] || '';

console.log('=== 首页横向滚动锁 ===');
eq(wxml.startsWith('<page-meta page-style="overflow-x: hidden;"></page-meta>'), true,
  'page-meta 作为首节点锁定根页横向溢出');
eq(/overflow-x:\s*hidden/.test(pageRule), true, '根节点锁横向溢出');
eq(/width:\s*100%/.test(pageRule), true, '根节点宽度为 100%');
eq(/max-width:\s*100%/.test(pageRule), true, '根节点最大宽度为 100%');
eq(/width:\s*100%/.test(bodyRule), true, '正文宽度为 100%');
eq(/max-width:\s*100%/.test(bodyRule), true, '正文最大宽度为 100%');
eq(/touch-action:\s*pan-y/.test(bodyRule), true, '正文只接受纵向手势');
eq(/overscroll-behavior-x:\s*none/.test(bodyRule), true, '正文禁用横向越界滚动');
eq(/overflow-x:\s*hidden/.test(bodyRule), false, '正文不加 overflow-x，保护 sticky');
eq(/left:\s*0/.test(canvasRule), true, '分享画布不向左侧离屏撑开');
eq(/left:\s*-2000px/.test(canvasRule), false, '分享画布不使用大额负 left');
eq(/z-index:\s*-1/.test(canvasRule), true, '分享画布在页面内容背后');

if (fail) {
  console.error(`\n${fail} assertion(s) failed`);
  process.exit(1);
}
console.log('\nALL PASS');
