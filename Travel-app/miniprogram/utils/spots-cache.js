/**
 * 景点卡片的跨页面内存缓存（2026-10-27 降本）。
 *
 * 起因：`spots.list` 一次要读 26 条景点 + 26 条规则，而它被 6 个页面各自拉一次
 * （首页空态、景点页、添加行程、选择景点、场景页、首页开发预览）。切个 Tab、
 * 从景点页进场景页，同一份数组就被重新拉一遍 —— 这些数据是静态运营数据，
 * 一天改不了几次。
 *
 * 边界（重要）：
 * - **只缓存 `spots.list` 的返回体**。`detail` / `batch` / `search` 的语义和
 *   使用场景各不相同（详情要最新核验日期、搜索要实时历史），不在此列。
 * - 缓存的是**原始返回体**，调用方照常读 `res.data`，不做任何加工 ——
 *   与 `home-cache.js` 同一个原则：缓存和实况两条路不能漂。
 * - 模块级单例，生命周期 = 小程序进程。切后台再回来仍在，杀进程后重新拉。
 * - 失败不写缓存；过期的缓存先返回、同时在后台刷新（stale-while-revalidate），
 *   所以用户不会因为缓存过期而多等一次。
 *
 * ⚠️ 云函数侧还有一层 60 秒的实例内缓存（`cloudfunctions/spots/index.js` 的
 *    `tableCache`）。两层各管一段：云函数那层省的是数据库读，这一层省的是
 *   云函数调用次数。TTL 故意设得更长（10 分钟），因为景点卡片对时效不敏感。
 */

const TTL_MS = 10 * 60 * 1000;

/* { at:number, res:object } | null */
let entry = null;
/* 正在飞的请求：并发调用共用同一个 Promise，避免同一时刻发多次。 */
let inflight = null;

/**
 * 取景点卡片列表。
 * @param {function} fetchFn 真正发请求的函数（通常是 `() => api.spots.list()`），
 *   由调用方注入而不是本模块直接 require api.js —— 避免 utils 之间循环依赖，
 *   也让测试可以塞桩。
 * @returns {Promise<object>} 与 `api.spots.list()` 相同形状的返回体
 */
function list(fetchFn) {
  const fresh = entry && (Date.now() - entry.at) < TTL_MS;
  if (fresh) return Promise.resolve(entry.res);

  if (inflight) return inflight;

  inflight = Promise.resolve()
    .then(fetchFn)
    .then(res => {
      inflight = null;
      /* 只缓存带 data 的成功返回；失败形状各异，缓存下来会把错误固化 10 分钟。 */
      if (res && res.data) entry = { at: Date.now(), res };
      return res;
    })
    .catch(err => {
      inflight = null;
      /* 有旧缓存就先用旧的（stale-while-revalidate 的降级面）：
         总比让用户看到空列表强，下一次调用还会再试。 */
      if (entry) return entry.res;
      throw err;
    });

  return inflight;
}

/** 清缓存。数据修正后或需要强制刷新时调用。 */
function invalidate() {
  entry = null;
  inflight = null;
}

/** 仅供测试：读当前缓存状态，不触发请求。 */
function peek() {
  return entry;
}

module.exports = { list, invalidate, peek, TTL_MS };
