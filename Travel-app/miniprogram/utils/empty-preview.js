/**
 * 首页空态「案例展示」的本地切片（2026-09-30）。
 *
 * 存在的理由：首页冷启动要等云函数返回才画第一帧，真机冷启动约 5 秒 —— 这期间
 * 用户看的是白屏。有了这份切片，**第一帧就能画出「案例展示」和近期热门景点**，
 * 云端返回后再原地替换。详见 `pages/home/home.js` 的三层渲染。
 *
 * ⚠️ **这不是第四套业务真身**。它是 `data/spots.json` + `data/rules.json` 经过
 * `spots` 云函数的 `buildCard()` 得出的**只读投影切片**：只保留「热度 ≥ 4 且难度 ≥ 4」
 * 的景点，并裁到首页空态真正读取的字段。
 *
 * 漂移由 `test/home-optimistic.test.js` 钉死，三条断言缺一不可：
 *   1. 入选集合 == 全量跑同一个 filter 的集合（热度/难度跨线即红）；
 *   2. 每个字段与 `buildCard()` 对真身的输出逐字段相等；
 *   3. 用本切片算出的预览与用全量 26 条算出的**逐字节相同**。
 *
 * 第 3 条是「不跳变」的证据，它同时覆盖闭馆顺延、今天已放票、跨零点等所有文案分支。
 * 改 `data/spots.json` / `data/rules.json` 后测试若变红，重跑切片生成逻辑
 * （见测试文件顶部说明），**不要为了让测试过而改断言**。
 *
 * 字段为什么是这几个：
 *   - `difficultyLabel` 与 `_difficultyText` 相关 —— 少了它，骨架层画不出难度标签，
 *     云端返回后标签会突然冒出来（写这个文件时测试抓到过一次）；
 *   - `advanceDays` 决定示例里的出行日期 —— 少了它示例会显示「今天」，云端算出
 *     一周后，日期当场跳变；
 *   - `openDays` / `closedDays` 决定闭馆顺延，少一个就会算出不同的放票日。
 */

/* 字段裁到 `release-context.js` 的 buildHomeReleasePreview / nextReleaseOf /
   isOpenOnDate / releaseTimesOf 真正读取的那些。加字段前先确认有人读。 */
const LOCAL_SLICE = [
  {
    spotId: 'gugong',
    name: '故宫博物院',
    shortName: '故宫',
    popularityScore: 5,
    difficultyScore: 5,
    difficultyLabel: { key: 'EXTREME', text: '极难约', color: 'red' },
    remindable: true,
    releaseTime: '20:00',
    openDays: [],
    closedDays: ['monday'],
    advanceDays: 7,
  },
  {
    spotId: 'tiananmen-chenglou',
    name: '天安门城楼',
    shortName: '天安门城楼',
    popularityScore: 5,
    difficultyScore: 5,
    difficultyLabel: { key: 'EXTREME', text: '极难约', color: 'red' },
    remindable: true,
    releaseTime: '17:00',
    openDays: [],
    closedDays: ['monday'],
    advanceDays: 7,
  },
  {
    spotId: 'guobo',
    name: '中国国家博物馆',
    shortName: '国博',
    popularityScore: 5,
    difficultyScore: 5,
    difficultyLabel: { key: 'EXTREME', text: '极难约', color: 'red' },
    remindable: true,
    releaseTime: '17:00',
    openDays: [],
    closedDays: ['monday'],
    advanceDays: 7,
  },
];

/** 本切片包含的 spotId，供测试断言集合一致。 */
const LOCAL_SLICE_IDS = LOCAL_SLICE.map(s => s.spotId);

module.exports = { LOCAL_SLICE, LOCAL_SLICE_IDS };
