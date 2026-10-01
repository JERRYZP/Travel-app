/**
 * 订阅消息额度台账（2026-09-16 抽出的唯一真身）
 *
 * 背景：微信不提供「一次性订阅剩余额度」查询接口，本地台账只能靠三个回调推测：
 *   授权成功 +1（`reminder` 的 subscribe.add）、发送成功 -1（`notifier` 的 consumeSubscribeQuota）、
 *   微信返回 43101 清零（`notifier` 的 invalidateSubscribeQuota）。
 * 既然是推测，就必然漂移 —— 本模块负责「漂移的自愈」。
 *
 * ⚠️ 本文件是 `reminder` 云函数内的唯一真身。`cloudfunctions/notifier/index.js` 是**独立部署单元**，
 * 无法 require 本文件，故按部署需要保留了一份同规则的副本；两份必须保持行为一致，
 * 由 `test/quota-heal.test.js` 对同一组输入交叉断言（两边结果不一致即失败）。
 */

/** 订阅消息模板 ID（与 miniprogram/utils/notify.js、cloudfunctions/notifier 兜底常量对齐；2026-10-01 切换为「预约开始提醒」） */
const LEGACY_SUBSCRIBE_TEMPLATE_ID = 'V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q';
const DEFAULT_SUBSCRIBE_TEMPLATE_ID = '_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA';

/** 旧任务没有 templateId，按旧模板记账；新任务由 task.submit 写入新模板。 */
function taskTemplateIdOf(task) {
  return (task && task.templateId) || LEGACY_SUBSCRIBE_TEMPLATE_ID;
}

/**
 * 读取某个模板的本地额度。
 * 新数据用 subscribeQuotas[templateId]；旧数据单模板回退到 subscribeQuota。
 */
function subscribeQuotaOf(user, templateId) {
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  const quotas = user.subscribeQuotas || {};
  if (Object.prototype.hasOwnProperty.call(quotas, tpl)) {
    return Number(quotas[tpl]) || 0;
  }
  const legacyTemplateId = user.subscribeTemplateId || LEGACY_SUBSCRIBE_TEMPLATE_ID;
  if (legacyTemplateId === tpl) return Number(user.subscribeQuota) || 0;
  return 0;
}

/** 各模板额度之和；无模板 map 时回退旧总数 */
function totalSubscribeQuota(quotas, fallback = 0) {
  const values = Object.values(quotas || {}).filter(v => typeof v === 'number' && v >= 0);
  if (!values.length) return Math.max(0, Number(fallback) || 0);
  return values.reduce((sum, v) => sum + v, 0);
}

/**
 * 本地配置 / 链路类失败关键词 —— 命中则说明「发不出去」与额度无关，**不能清零额度**。
 * 这些情况下微信侧额度依然有效，清零等于白白丢掉用户已经授权过的条数。
 */
const LOCAL_FAILURE_HINTS = Object.freeze([
  '未配置', '未设置',           // WX_APPID/WX_APPSECRET/TEMPLATE_ID 未配
  'access_token', 'accesstoken', // 拿不到 token
  '网络', 'timeout', '超时',     // 传输层问题
  'empty response',             // 微信返回空包
]);

/**
 * 台账自愈判定：任务已判 MISSED、且本地台账仍记有额度时，是否该把额度清零。
 *
 * 清零的语义 = 「本地记着有额度，实际却发不出去」→ 台账在骗人。清零是为了让
 * 提醒设置页诚实显示（否则页面一直写「已授权 N 次」，用户以为覆盖到了，任务却条条 MISSED），
 * 并让下次提交重新走一次授权。
 *
 * ⚠️ 必须带 `lastSendError` 前置条件，否则会误伤两类「额度其实还在」的情况：
 *   ① **从未尝试发送**（`lastSendError` 为空）—— 定时触发器没建、索引缺失、云函数没重新部署，
 *      都属链路故障；额度在微信侧照样有效，清零是纯粹的损失。
 *   ② **失败原因是本地配置/网络** —— 与额度无关，修好配置后额度照样能用。
 *
 * 只有「确实发过、且失败原因不是本地配置/链路问题」才清零（如微信侧 47003/40037 等拒绝）。
 *
 * @param {string} lastSendError 任务上记录的最近一次发送失败原因（由 notifier 的 markResult 写入）
 * @returns {boolean} 是否应该清零台账
 */
function shouldHealQuota(lastSendError) {
  const reason = String(lastSendError == null ? '' : lastSendError).trim();
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return !LOCAL_FAILURE_HINTS.some(hint => lower.includes(hint.toLowerCase()));
}

/**
 * 执行台账自愈清零：把该用户指定模板的本地额度归零，并记录原因与累计次数。
 * 只在「台账确实 > 0」时才写库（避免无谓写），返回是否真的清零了。
 *
 * 连续清零 ≥ `AUTO_ZERO_WARN_THRESHOLD` 次说明自愈在反复触发 —— 大概率是模板/发送链路
 * 有系统性问题，打告警日志便于排障（不要静默）。
 *
 * @returns {Promise<boolean>} 是否清零
 */
const AUTO_ZERO_WARN_THRESHOLD = 3;

async function healSubscribeQuota(db, openid, templateId) {
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  try {
    const res = await db.collection('users').where({ openId: openid }).get();
    const doc = (res.data || [])[0];
    if (!doc) return false;
    const quota = subscribeQuotaOf(doc, tpl);
    if (quota <= 0) return false;

    const quotas = Object.assign({}, doc.subscribeQuotas || {});
    quotas[tpl] = 0;
    const zeroCount = (Number(doc.subscribeAutoZeroCount) || 0) + 1;
    await db.collection('users').doc(doc._id).update({
      data: {
        subscribeQuota: totalSubscribeQuota(quotas, 0),
        subscribeQuotas: quotas,
        subscribeLastError: `台账自愈清零：任务已过期未送达，但本地仍记 ${quota} 次授权`,
        subscribeLastErrorAt: new Date(),
        subscribeAutoZeroCount: zeroCount,
      },
    });
    if (zeroCount >= AUTO_ZERO_WARN_THRESHOLD) {
      console.warn('[quota] auto-zero-repeated', JSON.stringify({ openid, templateId: tpl, zeroCount, quota }));
    }
    return true;
  } catch (e) {
    console.error('[quota] heal-failed', e.message);
    return false;
  }
}

module.exports = {
  LEGACY_SUBSCRIBE_TEMPLATE_ID,
  DEFAULT_SUBSCRIBE_TEMPLATE_ID,
  taskTemplateIdOf,
  subscribeQuotaOf,
  totalSubscribeQuota,
  shouldHealQuota,
  healSubscribeQuota,
  LOCAL_FAILURE_HINTS,
  AUTO_ZERO_WARN_THRESHOLD,
};
