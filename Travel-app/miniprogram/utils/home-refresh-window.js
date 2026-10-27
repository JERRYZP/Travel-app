/**
 * 首页刷新的自适应窗口（2026-10-27 调用量降本）。
 *
 * 起因：`home.bootstrap` 每次执行固定 5 次数据库请求（行程 / 行程项 / 提醒任务 /
 * 清单 / 用户），带回来的文档条数随该用户自己的数据量增长 —— 实测老用户
 * 一次切屏 55 条、新用户 9 条。而首页 onShow 原先只要切出去超过 30 秒，
 * 回来就完整重读一次，于是成本挂在了「亮屏次数」上，而不是「用户干了什么」。
 * 微信的切屏频率由用户习惯决定，既不受用户控制也不受我们控制，没有上界。
 *
 * 判据：**成本应该跟着「数据可能变化的紧迫度」走，而不是跟着亮屏次数走。**
 * 首页上唯一会自己变的东西是放票时刻：
 *   - 最近一场放票在未来 1 小时内、或刚过去 10 分钟内 → 状态随时会翻，用 30 秒；
 *   - 今天还有更晚的放票 → 用 60 秒；
 *   - 今天已经没有要翻的状态、或压根没有放票时刻 → 用 180 秒。
 *
 * 三类动作**不走**这个窗口，永远即时：
 *   ① 所有写操作后的刷新（`loadHome({ silent: true })`）；
 *   ② 没有本地缓存的首次进入（跳过网络的早退只能发生在 cached 分支里）；
 *   ③ 任何不显式传 `allowTtlReuse` 的调用（目前只有 onShow 传）。
 * 窗口只影响「用户什么都没干、切出去又切回来」这一种情况。
 * ⚠️ 首页目前没有下拉刷新（`home.json` 未开 `enablePullDownRefresh`）。将来要加，
 *    它的 handler 也不要传 `allowTtlReuse` —— 用户主动下拉就必须真的去问一次。
 *
 * 边界：
 * - **只读服务端返回体里已经算好的放票时刻**（`stickyBanner.releaseAt`、
 *   `releasePills[].releaseAt`），传入的是 `buildHomeData()` 加工后的 patch。
 *   本模块不碰行程项、不推导任何业务状态 —— 它只回答「这次请求该不该发」，
 *   不参与「首页显示什么」，因此不与「首页状态不得由页面重新推导」的门禁冲突。
 * - 两个字段本身是**局部视图**（banner 只覆盖 1 小时内、pills 只取最近 2 组），
 *   但 pills 按时刻升序取前几个，所以「最近的那一场」一定在视图内 —— 判定够用。
 * - 取不到任何可解析的放票时刻（新用户空态、只有「无放票时刻」景点的老用户）
 *   → 按 180 秒处理：此刻没有会自己翻的状态，多问没有意义。
 * - 只有**意外异常**才回落到 30 秒（`DEFAULT_TTL_MS`）：宁可多问一次。
 */

const WINDOW_HOT_MS = 30 * 1000;
const WINDOW_WARM_MS = 60 * 1000;
const WINDOW_COLD_MS = 180 * 1000;

/* 放票刚过去这么久仍算「热」：放票后几分钟内状态还在翻（可约 / 已抢光），
   用户也常在这几分钟里反复切回来看。同时它保住了 `sweepOverdue` 的收敛节奏 ——
   任务过期后 10 分钟内仍是 30 秒一问，不会被窗口拖成 3 分钟。 */
const JUST_PASSED_MS = 10 * 60 * 1000;
const LATER_TODAY_MS = 60 * 60 * 1000;

/* 北京时间固定 +8，无夏令时。只用它给「今天」分组，不做任何业务日期计算 ——
   业务日期的唯一真身在 release-context.js / 云端 time.js。 */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

const DEFAULT_TTL_MS = WINDOW_HOT_MS;

function toMs(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** 从加工后的首页 patch 里取所有已知的放票时刻。解析不出来的值直接跳过。
    形状意外（例如某个字段的取值抛错）**不在这里吞掉** —— 交给 `ttlOf` 统一兜底，
    否则一次形状变化会被悄悄当成「没有放票时刻」而放宽到 180 秒。 */
function collectReleaseTimes(home) {
  const times = [];
  if (!home || typeof home !== 'object') return times;
  const push = (at) => { const t = toMs(at); if (Number.isFinite(t)) times.push(t); };
  if (home.banner) push(home.banner.releaseAt);
  (home.bannerPills || []).forEach(p => { if (p) push(p.releaseAt); });
  return times;
}

function beijingDayKey(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/**
 * 算这一次首页数据对应的复用窗口长度（毫秒）。
 *
 * @param {object} home  `buildHomeData()` 的产物（读 banner / bannerPills）
 * @param {number} nowMs 该次数据到达的本地时刻，默认现在
 * @returns {number} 30s | 60s | 180s，异常时 30s
 */
function ttlOf(home, nowMs) {
  try {
    return ttlOfUnsafe(home, nowMs);
  } catch (e) {
    return DEFAULT_TTL_MS;
  }
}

function ttlOfUnsafe(home, nowMs) {
  const times = collectReleaseTimes(home);
  if (!times.length) return WINDOW_COLD_MS;

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const todayKey = beijingDayKey(now);
  let laterToday = false;

  for (let i = 0; i < times.length; i += 1) {
    const diff = times[i] - now;
    /* 临近（未来 1 小时内）或刚过去：状态正在翻 */
    if (diff >= -JUST_PASSED_MS && diff <= LATER_TODAY_MS) return WINDOW_HOT_MS;
    if (diff > 0 && beijingDayKey(times[i]) === todayKey) laterToday = true;
  }

  return laterToday ? WINDOW_WARM_MS : WINDOW_COLD_MS;
}

module.exports = {
  ttlOf,
  collectReleaseTimes,
  WINDOW_HOT_MS,
  WINDOW_WARM_MS,
  WINDOW_COLD_MS,
  DEFAULT_TTL_MS,
  JUST_PASSED_MS,
  LATER_TODAY_MS,
};
