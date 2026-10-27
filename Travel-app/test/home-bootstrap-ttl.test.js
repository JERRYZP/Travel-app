/**
 * 首页 onShow 复用窗口的结构钉子（2026-10-13 调用量优化）。
 *
 * 起因：首页每次 onShow 都重跑一次 `home.bootstrap`，切出又切回来的重复请求占了
 * 客户端调用的一大块。加了 30 秒复用窗口后，**有一条安全性质绝不能破**：
 *
 *   ① 「跳过网络」必须只发生在**已经有本地缓存**的时候。没缓存还跳过，页面会永远
 *      停在骨架层 —— 这比多请求一次严重得多。
 *   ② 写入后的刷新（`loadHome({ silent: true })` 的 8 处）**永远**要发请求，
 *      它们是刷新后新状态的唯一来源，不能被复用窗口吞掉。
 *
 * 这两条是**结构**约束（分支位置），单测跑数据跑不出来 —— 与 home-emptystate.test.js
 * 同一套做法：读源码、剥掉注释、断言结构。
 *
 * ⚠️ 它不能替代真机验证：切 tab 出去再回首页应命中缓存、改一条提醒应发请求并刷新。
 *
 * 运行：node test/home-bootstrap-ttl.test.js
 */
const fs = require('fs');
const path = require('path');

const JS = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');

/** 剥掉注释再断言 —— 否则解释性注释里的 `ttlFresh` 等词会把断言喂成误报。 */
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = codeOf(JS);

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

console.log('=== 1. 复用窗口只由 onShow 显式开启 ===');
eq(/const HOME_BOOTSTRAP_TTL_MS = refreshWindow\.DEFAULT_TTL_MS;/.test(code), true,
  '兜底窗口取自 refreshWindow（不再写死 30 秒）');
eq(/require\('\.\.\/\.\.\/utils\/home-refresh-window\.js'\)/.test(code), true,
  'home.js 确实 require 了 refreshWindow');
eq(/onShow\(\) \{\s*this\.loadHome\(\{ allowTtlReuse: true \}\);/.test(code), true,
  'onShow 显式传 allowTtlReuse');
eq(/loadHome\(opts\) \{\s*const silent = opts && opts\.silent;/.test(code), true,
  'loadHome 仍以 silent 开头（未改调用契约）');

console.log('=== 2. 前置条件缺一不可，窗口按上次数据算出的长度 ===');
eq(/const ttl = this\._bootTtlMs > 0 \? this\._bootTtlMs : HOME_BOOTSTRAP_TTL_MS;/.test(code), true,
  '窗口 = 上次数据算出的 _bootTtlMs，缺失时兜底');
eq(/const ttlFresh = Boolean\(opts && opts\.allowTtlReuse\)\s*&& this\._lastBootOkAt > 0\s*&& \(Date\.now\(\) - this\._lastBootOkAt\) < ttl;/.test(code),
  true, 'ttlFresh = 显式允许 && 曾经成功过 && 未超出自适应窗口');
eq(/loadHome\(\(\{ allowTtlReuse/.test(code) || /allowTtlReuse: true/.test(code), true,
  'allowTtlReuse 只有 onShow 一处传（其余调用不带）');
eq((code.match(/allowTtlReuse/g) || []).length, 2, 'allowTtlReuse 只出现在声明与 onShow 两处');

console.log('=== 2b. 窗口由数据算出来、且只在成功回调里写 ===');
eq((code.match(/_bootTtlMs = refreshWindow\.ttlOf\(/g) || []).length, 1, '只算一次窗口');
{
  /* 顺序：_lastBootOkAt 必须先写，ttlOf 的 nowMs 才能用它 */
  const iOk = code.indexOf('this._lastBootOkAt = Date.now()');
  const iTtl = code.indexOf('_bootTtlMs = refreshWindow.ttlOf(');
  eq(iTtl > code.indexOf('api.reminder.home.bootstrap('), true, '算窗口写在 bootstrap 的成功回调内（失败不刷新窗口）');
  eq(iOk > 0 && iTtl > iOk, true, '_lastBootOkAt 先于 _bootTtlMs 赋值');
}
eq(/refreshWindow\.ttlOf\(patch, this\._lastBootOkAt\)/.test(code), true,
  '算窗口读的是本次 buildHomeData 的产物，页面不另外推导');

console.log('=== 3. ⚠️ 早退必须在「非 silent 且有缓存」的分支内 ===');
{
  /* 结构：if (!silent) { const cached = homeCache.read(); if (cached) { ... if (ttlFresh) { return; } } else { ... } }
     这条断言就是「没有缓存时永远不会跳过网络」—— 页面不会停在骨架层。 */
  const guard = /if \(!silent\) \{\s*const cached = homeCache\.read\(\);\s*if \(cached\) \{[\s\S]*?if \(ttlFresh\) \{\s*trace\.end\(\{ branch: 'ttl-reuse'[^}]*\}\);\s*return;\s*\}[\s\S]*?\} else \{/;
  eq(guard.test(code), true, '复用早退嵌在 cached 分支之后、else（无缓存）分支之前');
}

console.log('=== 4. 写入后的刷新不受影响 ===');
{
  const silentCalls = (code.match(/loadHome\(\{ silent: true \}\)/g) || []).length;
  eq(silentCalls, 8, '8 处写后刷新原样保留');
  eq(/silent: true[^)]*?\}/.test(code), true, 'silent 调用形态未变');
  eq(/allowTtlReuse[^;]*silent/.test(code) || /silent[^;]*allowTtlReuse/.test(code), false,
    '没有任何一处把 silent 与 allowTtlReuse 混在一起');
}

console.log('=== 5. 时刻只在成功回调里写一次 ===');
eq((code.match(/_lastBootOkAt = Date\.now\(\)/g) || []).length, 1, '_lastBootOkAt 只赋值一次');
eq(code.indexOf('_lastBootOkAt = Date.now()') > code.indexOf('api.reminder.home.bootstrap('),
  true, '写在 bootstrap 的成功回调内（失败不刷新窗口）');

if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
console.log('\nhome-bootstrap-ttl.test.js 全部通过');
