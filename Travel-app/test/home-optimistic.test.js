/**
 * 首页三层渲染的防漂移测试（2026-09-30）。
 *
 * 背景：首页真机冷启动要等云函数，期间是白屏。`pages/home/home.js` 现在先用
 * `utils/empty-preview.js` 的本地切片画出「案例展示 + 近期热门景点」，
 * 云端返回后再原地替换。`utils/home-cache.js` 则回放上一次的返回体。
 *
 * 这两条兜底路径引入的风险只有一个：**它们和云端算出来的东西不一致，
 * 于是用户会看到画面跳变**。这个文件就是钉住「不一致」的钉子。
 *
 * 核心一条：用本地切片算出的预览，必须与用**全量 26 条真实数据**算出的逐字节相同。
 * 它同时覆盖了闭馆顺延、今天已放票、跨零点等所有文案分支 —— 只要这条绿，
 * 「先画兜底再替换」就不可能被用户看见。
 *
 * 切片数据变了怎么办：跑 `node test/home-optimistic.test.js`，按失败信息里
 * 打印的期望值更新 `utils/empty-preview.js`。**不要**为了让测试过而改断言。
 *
 * 运行：node test/home-optimistic.test.js
 */
const path = require('path');

// spots 云函数顶层 require wx-server-sdk（云端依赖），本地用桩顶上
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return require.resolve('./stubs/wx-server-sdk.js');
  return origResolve.call(this, request, ...rest);
};

const spotsFn = require('../cloudfunctions/spots/index.js');
const { buildCard } = spotsFn._internal;
const release = require('../miniprogram/utils/release-context.js');
const { LOCAL_SLICE, LOCAL_SLICE_IDS } = require('../miniprogram/utils/empty-preview.js');

const spotsAll = require('../data/spots.json').spots;
const rulesAll = require('../data/rules.json').rules;
const spotMap = {}; spotsAll.forEach(s => { spotMap[s.spotId] = s; });
const ruleMap = {}; rulesAll.forEach(r => { ruleMap[r.spotId] = r; });

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* 首页空态口径：热度 ≥ 4 且难度 ≥ 4（与 release-context.js 的 filter 同一条件） */
const S_TIER = s => (s.popularityScore || 0) >= 4 && (s.difficultyScore || 0) >= 4;

/* 预览里**真正被渲染**的部分：派生字段 + 示例行。
   卡片原始字段不参与比较 —— 它们在两张卡上本来就不同，比不出漂移。 */
function renderedShape(preview) {
  return JSON.stringify({
    derived: preview.rows.map(r => ({
      spotId: r.spotId,
      _nextRelease: r._nextRelease,
      _releaseStatusText: r._releaseStatusText,
      _releaseTone: r._releaseTone,
      _difficultyText: r._difficultyText,
      _difficultyKey: r._difficultyKey,
    })),
    sample: preview.sample,
  });
}

/* 用真身算出「云端会返回的那批卡片」—— 与 home.bootstrap 背后同一条链路
   （reminder 只是把 spots 云函数的输出原样透传，建卡逻辑的真身在 spots）。 */
function fullCards(now) {
  return spotsAll
    .map(s => buildCard(s, ruleMap[s.spotId], now))
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
}

const PROBE_NOW = new Date(Date.UTC(2026, 8, 30, 2, 0)); // 北京 9/30 周三 10:00

console.log('=== 1. 本地切片是 data/ 真身的忠实投影 ===');
{
  const expectedIds = spotsAll.filter(S_TIER).map(s => s.spotId).sort();
  const actualIds = LOCAL_SLICE_IDS.slice().sort();
  eq(actualIds.join(','), expectedIds.join(','),
    '切片的 spotId 集合 == 全量跑 S 级 filter 的集合（热度/难度跨线即红）');

  /* 逐字段与 buildCard 的输出比对。切片里的值必须能在真身上找到，
     不允许手写一个「差不多的」数字。 */
  const full = fullCards(PROBE_NOW);
  const byId = {};
  full.forEach(c => { byId[c.spotId] = c; });
  let mismatch = 0;
  LOCAL_SLICE.forEach(s => {
    const card = byId[s.spotId];
    if (!card) { mismatch += 1; console.log('  切片里有真身不存在的景点:', s.spotId); return; }
    Object.keys(s).forEach(k => {
      const a = JSON.stringify(s[k]);
      const b = JSON.stringify(card[k]);
      if (a !== b) {
        mismatch += 1;
        console.log(`  字段漂移 ${s.spotId}.${k}: 切片=${a} 真身=${b}`);
      }
    });
  });
  eq(mismatch, 0, '切片每个字段都与 buildCard(真身) 的输出一致');
}

console.log('=== 1b. 切片覆盖了所有「会影响渲染」的字段（自动推导，不手列）===');
{
  /* 做法：把卡片上的每个字段逐个删掉，看渲染结果变不变。
     变了 → 这个字段在语义上必需 → 切片里必须有它。
     这样以后有人给 buildHomeReleasePreview 加一个字段读取，
     只要它真的影响输出，本断言就会自己变成红色，不需要人来维护清单。 */
  const full = fullCards(PROBE_NOW);
  const baseline = renderedShape(release.buildHomeReleasePreview(full, PROBE_NOW, 3));
  const sliceFields = new Set(Object.keys(LOCAL_SLICE[0]));

  const required = [];
  Object.keys(full[0] || {}).forEach(field => {
    const without = full.map(c => {
      const copy = Object.assign({}, c);
      delete copy[field];
      return copy;
    });
    const shape = renderedShape(release.buildHomeReleasePreview(without, PROBE_NOW, 3));
    if (shape !== baseline) required.push(field);
  });

  eq(required.length > 0, true, '推导出了影响渲染的字段集合（非空即探针有效）');
  const missing = required.filter(f => !sliceFields.has(f));
  eq(missing.join(','), '', `切片覆盖了全部 ${required.length} 个影响渲染的字段`);
  console.log('     必需字段:', required.join(', '));
}

console.log('=== 2. 切片算出的预览 == 全量算出的预览（逐字节）===');
{
  /* 多组 now 覆盖：工作日白天 / 深夜（当天放票时刻已过）/ 周日（次日周一闭馆）/
     跨零点前后。任一组不等，就说明「先画兜底再替换」会让用户看到跳变。 */
  const CASES = [
    ['工作日 10:00', new Date(Date.UTC(2026, 8, 30, 2, 0))],   // 北京 9/30 周三 10:00
    ['工作日 23:50', new Date(Date.UTC(2026, 8, 30, 15, 50))], // 北京 9/30 周三 23:50
    ['周日 12:00', new Date(Date.UTC(2026, 9, 4, 4, 0))],      // 北京 10/4 周日
    ['跨零点前', new Date(Date.UTC(2026, 8, 30, 15, 59))],     // 北京 9/30 23:59
    ['跨零点后', new Date(Date.UTC(2026, 8, 30, 16, 1))],      // 北京 10/1 00:01
  ];
  CASES.forEach(([label, now]) => {
    const fromSlice = renderedShape(release.buildHomeReleasePreview(LOCAL_SLICE, now, 3));
    const fromFull = renderedShape(release.buildHomeReleasePreview(fullCards(now), now, 3));
    eq(fromSlice === fromFull, true, `${label}：切片预览与全量预览逐字节相同`);
    if (fromSlice !== fromFull) {
      console.log('   got :', fromSlice);
      console.log('   want:', fromFull);
    }
  });

  const rows = release.buildHomeReleasePreview(LOCAL_SLICE, PROBE_NOW, 3).rows;
  eq(rows.length, 3, '切片足以填满 limit=3 的预览行');
  eq(rows.some(r => r.spotId === 'guobo'), true, '示例优先用国博（release-context 的口径）');
}

console.log('=== 3. 兜底路径与实况路径共用同一个加工函数 ===');
{
  const JS = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');

  /* 这是「不跳变」的结构性保证：两条路走同一个 buildHomeData，
     同一份返回体必然产出同一个补丁。为缓存另写一条加工路径 = 必然漂。 */
  eq(/const cachedServerMs = parseTimeMs\(cached\.serverNow\)/.test(JS), true,
    '缓存路径优先使用缓存返回体的 serverNow');
  eq(/buildHomeData\(cached, cachedNow, \{ silent: true \}\)/.test(JS), true,
    '缓存路径走 buildHomeData（静默态，不抹掉菜单与已忽略气泡）');
  eq(/buildHomeData\(res, resolveNow\(\), \{ silent \}\)/.test(JS), true,
    '实况路径走同一个 buildHomeData');
  eq(/^function buildHomeData\(res, now, opts\)/m.test(JS), true,
    'buildHomeData 是模块级纯函数（不依赖 this，两条路都能调）');

  /* 差异 setData：相同值不写，节点不重绘、动画不重播 */
  eq(/JSON\.stringify\(this\.data\[k\]\) === JSON\.stringify\(patch\[k\]\)/.test(JS), true,
    'applyHomeData 逐键比对，只写真正变化的字段');
  eq(/if \(patch\[k\] === undefined\) return;/.test(JS), true,
    'undefined 表示「保留现有值」，后台刷新不抹掉当次会话状态');

  /* 竞态守卫：onShow 无条件重载 + 8 处静默重载，没有它旧响应会覆盖新状态。
     三处：bootstrap 的 then / bootstrap 的 catch / 延后的 spots.list 的 then。
     将来再加异步分支时这条会红，提醒补守卫。 */
  eq(/const seq = \(this\._loadSeq = \(this\._loadSeq \|\| 0\) \+ 1\)/.test(JS), true,
    'loadHome 有递增的请求序号');
  eq((JS.match(/if \(seq !== this\._loadSeq\) return;/g) || []).length, 3,
    'bootstrap(then/catch) 与延后拉取的热门景点都做了过期响应拦截');
}

console.log('=== 3b. 空态 / 骨架 / 行程墙是同一条 wx:if 链 ===');
{
  const WXML = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');

  /* ⚠️ 骨架块必须是 `wx:elif`，不能是 `wx:if`。
     WXML 的 `wx:else` 绑定的是**紧邻的上一个 wx:if/wx:elif**：
     中间插一个独立 `wx:if`，下面的行程墙 `wx:else` 就会改绑到骨架块上 ——
     结果是空态和行程墙**同时渲染**，而且不报错。写这里时真踩过一次。 */
  const iBlank = WXML.indexOf('wx:if="{{!loading && trips.length === 0');
  const iSkel = WXML.indexOf('wx:elif="{{loading && !previewNewUser}}"');
  const iElse = WXML.indexOf('<block wx:else>', iSkel);
  eq(iBlank >= 0, true, '空态块仍是链首（wx:if）');
  eq(iSkel >= 0, true, '骨架层用 wx:elif 接入同一条链');
  eq(iBlank < iSkel && iSkel < iElse, true, '顺序是 空态 → 骨架 → 行程墙(wx:else)');

  /* 骨架块里不能出现第二个 wx:if 抢走 wx:else —— 它内部只用 wx:if 控制
     自身的子块（empty-hot），所以这里只确保 `wx:else` 紧跟骨架块收尾。 */
  eq(/wx:elif="\{\{loading && !previewNewUser\}\}"[\s\S]*?<\/block>\s*\n\s*<block wx:else>/.test(WXML),
    true, '骨架块收尾后立刻是 wx:else，中间没有别的 wx:if 插入');

  /* 骨架期不能谎称「你没有行程」—— 空态块自带 !loading，骨架块必须保持 loading:true */
  eq(/wx:elif="\{\{loading/.test(WXML), true, '骨架块的条件含 loading，即只在等待期间出现');
}

console.log('=== 4. 缓存层与空态判定的边界 ===');
{
  const JS = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');
  const CACHE = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/utils/home-cache.js'), 'utf8');

  /* 缓存命中时 loading 必须变 false（走 wx:else 画状态墙）；
     没有缓存时必须**保持** loading:true —— 那是「尚未确认」，
     过早置 false 会让返回用户先看到「你还没有行程」再跳变。 */
  eq(/this\.applyHomeData\(buildHomeData\(cached/.test(JS), true,
    '缓存命中直接画完整状态墙（loading 由 buildHomeData 置 false）');
  eq(/loading: true,\n\s+emptyReleaseSample: boot\.sample,/.test(JS), true,
    '无缓存时保持 loading:true，只画骨架层的真实内容');

  /* 缓存只做首屏填充，不参与判定 */
  eq(/只用于首屏填充/.test(CACHE), true, '缓存文件的边界写明了「只用于首屏填充」');
  eq(/const MAX_AGE_MS = 24 \* 60 \* 60 \* 1000;/.test(CACHE), true, '缓存有 24 小时有效期');
  eq(/if \(Date\.now\(\) - entry\.savedAt > MAX_AGE_MS\)/.test(CACHE), true,
    '过期缓存被丢弃（不放票状态跨天会翻）');
}

console.log('=== 5. 端到端：缓存绘制 → 实况接管，setData 载荷必须为空 ===');
{
  /* 这是「不跳变」的**实测**，不是结构推断：真的把页面跑起来，
     先让它用缓存画一帧，再让云端返回同一份数据，数一数第二次 setData
     到底写了几个字段。真实场景里「什么都没变」是绝大多数情况
     （两次打开首页之间用户没操作），此时载荷必须为空 —— 空载荷 =
     节点不重绘 = 入场动画不重播 = 用户看不见任何切换。 */
  const HOME = path.join(__dirname, '../miniprogram/pages/home/home.js');
  const CACHE_KEY = 'homeBootstrapCacheV1';

  /* 一份「云端真实会返回」的返回体：空态 + 3 个热门景点 */
  const now = Date.UTC(2026, 8, 30, 2, 0); // 北京 9/30 周三 10:00
  const hotSpots = fullCards(new Date(now));
  const RES = {
    serverNow: now,
    primaryTripId: '',
    scrollTargetId: '',
    trips: [],
    history: [],
    stickyBanner: null,
    releasePills: [],
    reminderQuotaWarning: null,
    recoverableIds: [],
    homeMode: 1,
    hotSpots,
  };

  const store = {};
  store[CACHE_KEY] = { savedAt: Date.now(), res: RES };
  global.wx = {
    getStorageSync: k => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: k => { delete store[k]; },
    reportEvent: () => {},
    cloud: {
      callFunction: (o) => {
        /* 异步返回，与真实云调用一致 */
        setTimeout(() => o.success({ result: RES }), 0);
      },
    },
  };
  global.getApp = () => ({ globalData: { statusBarHeight: 44, navBarHeight: 44, envVersion: '', serverSkewMs: 0 } });

  let pageDef = null;
  global.Page = def => { pageDef = def; };
  delete require.cache[require.resolve(HOME)];
  require(HOME);

  const page = Object.assign({}, pageDef);
  page.data = JSON.parse(JSON.stringify(pageDef.data));
  const calls = [];
  page.setData = (patch, cb) => {
    calls.push(Object.keys(patch));
    Object.assign(page.data, patch);
    if (typeof cb === 'function') cb();
  };

  page.loadHome();
  eq(calls.length, 1, '缓存命中：同步画出第一帧（且只有这一帧，没有多余的 loading 切换）');
  eq(page.data.loading, false, '缓存帧不是 loading 态（走行程墙/空态分支，而非骨架）');
  eq(page.data.trips.length, 0, '缓存帧的行程来自缓存返回体');

  /* 等云端返回（setTimeout 0）*/
  setTimeout(() => {
    /* 这一条就是「不跳变」的充分证据：applyHomeData 逐键比对后认为无事可做。
       如果实况与缓存有任何一处不同，它必然写一次 setData —— 次数就会是 2。 */
    eq(calls.length, 1,
      '云端返回时**没有再写 setData** —— 实况补丁与缓存帧逐键相同，载荷为空');

    eq(page.data.loading, false, '实况接管后仍是 loading:false');
    eq(page.data.isBlank, true, '实况接管后空态判定正确');
    eq(page.data.emptyReleaseRows.length, 3, '缓存帧的预览行仍是完整 3 条（没被清掉）');

    console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
    process.exit(fail === 0 ? 0 : 1);
  }, 20);
}
