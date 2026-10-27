/**
 * 景点卡片跨页缓存的回归（2026-10-27 调用量降本）。
 *
 * 起因：`spots.list` 一次要读 26 条景点 + 26 条规则，被 6 个页面各拉一次。
 * 加缓存后有三条性质绝不能破：
 *
 *   ① 并发调用必须共用一个请求 —— 否则同一时刻开两个页面仍然发两次。
 *   ② 失败不能把错误固化进缓存 —— 否则一次网络抖动会让页面空 10 分钟。
 *   ③ 有旧缓存时失败要降级返回旧的，而不是把错误抛给调用方 ——
 *      空列表比「稍旧的数据」更糟。
 *
 * 运行：node test/spots-cache.test.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* 每个用例前清模块缓存，拿一份干净的缓存状态 */
function freshCache() {
  const p = path.join(ROOT, 'miniprogram/utils/spots-cache.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== 1. 命中缓存不再发请求 ===');
  {
    const cache = freshCache();
    let calls = 0;
    const fetchFn = () => { calls += 1; return Promise.resolve({ data: [{ spotId: 'gugong' }] }); };
    const r1 = await cache.list(fetchFn);
    const r2 = await cache.list(fetchFn);
    eq(calls, 1, '连续两次调用只发一次请求');
    eq(r1.data[0].spotId, 'gugong', '返回体形状不变（调用方照常读 res.data）');
    eq(r1, r2, '两次拿到同一个对象引用');
  }

  console.log('=== 2. 并发调用共用一个 in-flight 请求 ===');
  {
    const cache = freshCache();
    let calls = 0;
    const fetchFn = () => { calls += 1; return Promise.resolve({ data: [] }); };
    await Promise.all([cache.list(fetchFn), cache.list(fetchFn), cache.list(fetchFn)]);
    eq(calls, 1, '三个并发调用只发一次请求');
  }

  console.log('=== 3. 失败不写缓存，下次仍会重试 ===');
  {
    const cache = freshCache();
    let calls = 0;
    const fetchFn = () => { calls += 1; return Promise.reject(new Error('boom')); };
    const err1 = await cache.list(fetchFn).catch(e => e.message);
    eq(err1, 'boom', '无缓存时失败照常抛出');
    eq(cache.peek(), null, '失败不写缓存');
    await cache.list(fetchFn).catch(() => {});
    eq(calls, 2, '下一次调用仍会重试');
  }

  console.log('=== 4. 有旧缓存时失败降级为旧数据 ===');
  {
    const cache = freshCache();
    await cache.list(() => Promise.resolve({ data: [{ spotId: 'old' }] }));
    cache.invalidate();
    /* invalidate 清空后重新灌一份，再让后续请求失败 */
    await cache.list(() => Promise.resolve({ data: [{ spotId: 'cached' }] }));
    const stale = await cache.list(() => Promise.reject(new Error('net')));
    eq(stale.data[0].spotId, 'cached', '失败时返回已缓存的旧数据而不是抛错');
  }

  console.log('=== 5. invalidate 清空后确实重新请求 ===');
  {
    const cache = freshCache();
    let calls = 0;
    const fetchFn = () => { calls += 1; return Promise.resolve({ data: [] }); };
    await cache.list(fetchFn);
    cache.invalidate();
    eq(cache.peek(), null, 'invalidate 后缓存为空');
    await cache.list(fetchFn);
    eq(calls, 2, '清空后重新发请求');
  }

  console.log('=== 6. 没有 data 的返回不入缓存 ===');
  {
    const cache = freshCache();
    let calls = 0;
    const fetchFn = () => { calls += 1; return Promise.resolve({ success: false }); };
    await cache.list(fetchFn);
    await cache.list(fetchFn);
    eq(calls, 2, '异常形状不被固化（否则错误会挂 10 分钟）');
  }

  if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
  console.log('\nspots-cache.test.js 全部通过');
  await wait(0);
})();
