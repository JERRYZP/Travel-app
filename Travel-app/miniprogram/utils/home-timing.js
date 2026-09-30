/**
 * 首页加载耗时打点（2026-09-30）。
 *
 * 起因：真机首页冷启动约 5 秒。要定位是「云函数冷启动」「云端串行查询」还是
 * 「前端解析 + 首屏等待」，必须先有分段数字，否则所有优化都是猜。
 *
 * 约束：
 * - **只打毫秒、层名和计数**，不含 openid、昵称、行程内容、票务结果；
 * - `wx.reportEvent` 未配置或 API 不可用时静默降级，不新增依赖；
 * - 与 `analytics.js` 分开：那边是分享转化的业务埋点，这里是排障用的性能打点，
 *   混在一起会让两者的生命周期互相牵制（排障完就可以整份删掉）。
 */

const EVENT = 'home_load_timing';

/* 一次首页加载的分段计时。时间基准用 Date.now() —— 小程序基础库不全支持
   performance.now()，而这里只需要毫秒级相对差值。 */
function createTrace(phase) {
  const t0 = Date.now();
  const marks = {};
  let last = t0;

  return {
    /* 打一个分段点：记录「距上一次 mark 的耗时」和「距开始的总耗时」 */
    mark(name) {
      const now = Date.now();
      marks[name] = now - last;
      last = now;
      return marks[name];
    },
    /* 收尾并上报。extra 只允许放数字/短字符串（cleanParams 口径） */
    end(extra) {
      const totalMs = Date.now() - t0;
      const payload = Object.assign({ phase, totalMs }, marks, extra || {});
      report(payload);
      return payload;
    },
  };
}

function report(payload) {
  const data = {};
  Object.keys(payload || {}).forEach(k => {
    const v = payload[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v === 'number' && Number.isFinite(v)) data[k] = v;
    else data[k] = String(v).slice(0, 64);
  });
  try {
    if (typeof wx !== 'undefined' && typeof wx.reportEvent === 'function') {
      wx.reportEvent(EVENT, data);
    }
    /* 开发者工具/云开发日志里立刻可见，不需要等自定义分析配置 */
    if (typeof console !== 'undefined' && console.info) {
      console.info('[home-timing]', data);
    }
  } catch (e) {}
  return data;
}

module.exports = { EVENT, createTrace, report };
