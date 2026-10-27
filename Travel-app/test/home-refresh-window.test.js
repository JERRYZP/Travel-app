/**
 * 首页自适应复用窗口（2026-10-27 调用量降本）的纯函数钉子。
 *
 * 背景：`home.bootstrap` 每次执行固定 5 次数据库请求，带回来的文档条数随用户
 * 自己的数据量增长（实测老用户一次切屏 55 条）。原来的 30 秒固定窗口意味着
 * 切出去超过半分钟回来就是一次完整重读 —— 成本挂在亮屏次数上。
 *
 * 现在窗口跟着「最近一场放票离现在多远」走。这条规则值钱的地方全在边界上：
 *   - 把放票窗口判成「冷」= 用户在两场放票之间看到过期状态；
 *   - 把平时判成「热」= 白付一次全量读。
 * 所以这里逐个钉住边界，而不是只测「有放票就 30 秒」。
 *
 * ⚠️ 本文件只测判定函数。它不证明窗口接对了地方 —— 那由
 * `test/home-bootstrap-ttl.test.js` 的结构断言守住，两者缺一不可。
 *
 * 运行：node test/home-refresh-window.test.js
 */
const path = require('path');
const w = require(path.join(__dirname, '../miniprogram/utils/home-refresh-window.js'));

let fail = 0;
const eq = (got, want, msg) => {
  const ok = String(got) === String(want);
  if (!ok) { fail += 1; console.log('FAIL', msg, '\n  got :', got, '\n  want:', want); }
  else console.log('ok  ', msg, '=', got);
};

/* 北京时间 2026-10-27 18:00（UTC 10:00）—— 不跨午夜，日期分组判定才看得出差别 */
const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);
const at = (utcOffsetMinutes) => new Date(NOW + utcOffsetMinutes * 60000).toISOString();
const homeWith = (releaseAts) => ({
  banner: releaseAts.length ? { releaseAt: releaseAts[0] } : null,
  bannerPills: releaseAts.slice(1).map(t => ({ releaseAt: t })),
});
const ttl = (releaseAts) => w.ttlOf(homeWith(releaseAts), NOW);

console.log('=== 1. 窗口常量就是三个档位 ===');
eq(w.WINDOW_HOT_MS, 30 * 1000, '热 = 30 秒');
eq(w.WINDOW_WARM_MS, 60 * 1000, '温 = 60 秒');
eq(w.WINDOW_COLD_MS, 180 * 1000, '冷 = 180 秒');
eq(w.DEFAULT_TTL_MS, w.WINDOW_HOT_MS, '异常兜底 = 30 秒（宁可多问）');

console.log('=== 2. 放票窗口内 → 30 秒 ===');
eq(ttl([at(20)]), w.WINDOW_HOT_MS, '20 分钟后放票 → 热');
eq(ttl([at(60)]), w.WINDOW_HOT_MS, '恰好 60 分钟后放票 → 热（含边界）');
eq(ttl([at(-5)]), w.WINDOW_HOT_MS, '5 分钟前刚放票 → 热（状态还在翻）');
eq(ttl([at(-10)]), w.WINDOW_HOT_MS, '恰好 10 分钟前放票 → 热（含边界）');

console.log('=== 3. 今天稍晚还有票 → 60 秒 ===');
eq(ttl([at(61)]), w.WINDOW_WARM_MS, '61 分钟后放票（今天）→ 温');
eq(ttl([at(300)]), w.WINDOW_WARM_MS, '5 小时后放票（今天）→ 温');

console.log('=== 4. 今天已经没有要翻的状态 → 180 秒 ===');
eq(ttl([at(-30)]), w.WINDOW_COLD_MS, '30 分钟前放完、今天没有下一场 → 冷');
eq(ttl([at(1200)]), w.WINDOW_COLD_MS, '明天以后的放票（不在今天）→ 冷');
eq(ttl([]), w.WINDOW_COLD_MS, '一个放票时刻都没有 → 冷');

console.log('=== 5. 多场放票取最近的一场定档 ===');
eq(ttl([at(-60), at(15)]), w.WINDOW_HOT_MS, '已放完一场 + 15 分钟后一场 → 热');
eq(ttl([at(-60), at(240)]), w.WINDOW_WARM_MS, '已放完一场 + 今天 4 小时后一场 → 温');
eq(ttl([at(90), at(30)]), w.WINDOW_HOT_MS, '顺序无关：30 分钟和 90 分钟各一场 → 热');

console.log('=== 6. 脏数据不炸、不误判 ===');
eq(ttl(['', null, undefined]), w.WINDOW_COLD_MS, '空值当作「没有放票时刻」');
eq(ttl(['not-a-date', at(20)]), w.WINDOW_HOT_MS, '坏字符串被忽略，好数据仍生效');
{
  const boom = { get banner() { throw new Error('boom'); }, bannerPills: [] };
  eq(w.ttlOf(boom, NOW), w.DEFAULT_TTL_MS, '取值抛异常 → 兜底 30 秒');
  eq(w.ttlOf(null, NOW), w.WINDOW_COLD_MS, 'null → 当作没有放票时刻');
}

console.log('=== 7. 只读取放票时刻，不碰其他字段 ===');
{
  /* 传入一个刻意「不像 patch」的对象：只要没有 banner/bannerPills，就必须判冷。
     这条防的是有人日后把行程项、canMark 之类的业务字段接进来做判定。 */
  const noisy = { trips: [{ itemCount: 9 }], history: [], releasePills: [] };
  eq(w.ttlOf(noisy, NOW), w.WINDOW_COLD_MS, '没有 banner / bannerPills 的返回体 → 冷');
}

if (fail) { console.log(`\n${fail} 项失败`); process.exit(1); }
console.log('\nhome-refresh-window.test.js 全部通过');
