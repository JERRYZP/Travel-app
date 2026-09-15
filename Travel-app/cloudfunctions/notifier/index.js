/**
 * notifier 云函数 —— 提醒推送与任务状态机（FLOW-002 / REMINDER-RULE-003/004/006）
 *
 * 定时触发：每分钟一次（见 config.json）
 * 每次扫描「提醒时刻落在本分钟窗口内」的 WAITING 任务，
 * 30 秒内错峰发送，写 TRIGGERED；超过 releaseAt 仍未成功写 MISSED。
 *
 * 订阅消息：经微信服务端 HTTP 接口发送（不依赖小程序端触发，定时触发也能用）；
 * AppID/Secret 走环境变量 WX_APPID / WX_APPSECRET，模板 ID 走 SUBSCRIBE_TEMPLATE_ID（回退常量）。
 */

const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  REMINDER_TASKS: 'reminder_tasks',
  SPOTS: 'spots',
  TRIPS: 'trips',
  REMINDER_CART: 'reminder_cart',
  USERS: 'users',
};

const ReminderBackendStatus = {
  WAITING: 'WAITING',
  TRIGGERED: 'TRIGGERED',
  MISSED: 'MISSED',
  CLOSED: 'CLOSED',
};

const ChannelType = {
  OFFICIAL_ACCOUNT: 'OFFICIAL_ACCOUNT',
  SMS: 'SMS', // reserved, V1.1
};

const STAGGER_WINDOW_MS = 30 * 1000; // REMINDER-RULE-003
const CLEAN_AFTER_DAYS = 14;         // REMINDER-RULE-006
const SCAN_WINDOW_MS = 60 * 1000;    // 每分钟扫描一次
// 时间窗扫描上界 = 本分钟窗口 + 最大提前量（V1.ALLOWED_OFFSETS = [5,2]，取 5 分钟），
// 保证 releaseAt 落在窗口内的任务都能被 collectDue 命中，而不是全表拉前 500 条。
const MAX_ADVANCE_MS = 5 * 60 * 1000;
const SCAN_PAGE_SIZE = 100;          // 分页取数，避免 limit(500) 漏扫
const SCAN_MAX_ROWS = 800;           // 单次巡检安全上限（时间窗只有约 6 分钟，超出的靠下分钟重扫补齐）
const SEND_CONCURRENCY = 5;          // 同一时刻在途的微信请求数，错峰窗口内并发

/** 订阅消息模板 ID（微信公众平台「活动开始通知」公共模板；2026-09-13 换 appid 到 wx05c160a589b97d76 后重新申请）。
 *  环境变量优先；控制台未配 env 时用兜底常量，保证重新部署不丢配置。与 miniprogram/utils/notify.js 对齐。 */
const TEMPLATE_ID = process.env.SUBSCRIBE_TEMPLATE_ID || 'V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingHm(date) {
  const s = new Date(new Date(date).getTime() + BEIJING_OFFSET_MS).toISOString();
  return `${s.slice(11, 13)}:${s.slice(14, 16)}`;
}

function beijingMonthDay(dateStr) {
  // 兼容 ISO datetime（releaseAt）与 YYYY-MM-DD（visitDate）两种输入，都取北京时间月日
  const d = new Date(new Date(dateStr).getTime() + BEIJING_OFFSET_MS);
  const s = d.toISOString();
  return `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
}

function beijingDateTime(dateStr) {
  // date5 字段是 date 类型，要求「年月日 + 时刻」，如 2019-10-20 07:00（北京时区）
  const d = new Date(new Date(dateStr).getTime() + BEIJING_OFFSET_MS);
  const s = d.toISOString();
  return `${s.slice(0, 4)}-${s.slice(5, 7)}-${s.slice(8, 10)} ${s.slice(11, 13)}:${s.slice(14, 16)}`;
}

/**
 * REMINDER-RULE-003 错峰延迟：同一提醒时刻的批量任务在 30 秒窗口内均匀分布
 */
function staggerDelays(count) {
  if (count <= 1) return [0];
  const step = STAGGER_WINDOW_MS / count;
  return Array.from({ length: count }, (_v, i) => Math.floor(i * step));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 找出本次应触发的 (任务, offset) 组合。
 *
 * 一条任务有多个 offset（5 分钟 / 2 分钟各触发一次），
 * sentOffsets 记录已发送过的 offset，保证重复扫描不重发（幂等）。
 */
function collectDue(tasks, nowTs) {
  const due = [];
  for (const task of tasks) {
    const releaseAt = new Date(task.releaseAt).getTime();
    const sent = task.sentOffsets || [];
    for (const off of (task.offsets || [])) {
      if (sent.includes(off)) continue;
      const remindAt = releaseAt - off * 60 * 1000;
      // 提醒时刻已到（含补发窗口：错过的也应立即发，只要还没过放票时刻）
      if (remindAt <= nowTs + SCAN_WINDOW_MS && nowTs < releaseAt) {
        due.push({ task, offset: off, remindAt });
      }
    }
  }
  // 同一提醒时刻的排在一起，便于错峰
  return due.sort((a, b) => a.remindAt - b.remindAt);
}

/* ============ 微信服务端 HTTP 传输（不依赖小程序端触发） ============ */

const WX_BASE = 'https://api.weixin.qq.com';
const WX_APPID = process.env.WX_APPID || 'wx05c160a589b97d76';
const WX_APPSECRET = process.env.WX_APPSECRET || '';

let accessTokenCache = { token: null, expiresAt: 0 };
const TOKEN_SAFETY_MS = 60 * 1000; // 提前 1 分钟视为过期，避免踩线

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`WX HTTP ${res.statusCode} non-json: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAccessToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && accessTokenCache.token && accessTokenCache.expiresAt > now + TOKEN_SAFETY_MS) {
    return accessTokenCache.token;
  }
  const url = `${WX_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(WX_APPID)}&secret=${encodeURIComponent(WX_APPSECRET)}`;
  const res = await httpJson('GET', url);
  if (!res.access_token) {
    throw new Error(`获取 access_token 失败 errcode=${res.errcode} errmsg=${res.errmsg}`);
  }
  accessTokenCache = {
    token: res.access_token,
    expiresAt: now + (res.expires_in || 7200) * 1000,
  };
  return accessTokenCache.token;
}

async function sendSubscribeMessageHttp(payload, forceRefresh = false) {
  const token = await getAccessToken(forceRefresh);
  const url = `${WX_BASE}/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`;
  return httpJson('POST', url, payload);
}

/** 读取用户某个模板的本地额度；旧数据单模板回退到 subscribeQuota。 */
function subscribeQuotaOf(user, templateId) {
  const quotas = user.subscribeQuotas || {};
  if (Object.prototype.hasOwnProperty.call(quotas, templateId)) {
    return Number(quotas[templateId]) || 0;
  }
  const legacyTemplateId = user.subscribeTemplateId || TEMPLATE_ID;
  if (legacyTemplateId === templateId) return Number(user.subscribeQuota) || 0;
  return 0;
}

/** 各模板额度之和 */
function totalSubscribeQuota(quotas, fallback = 0) {
  const values = Object.values(quotas || {}).filter(v => typeof v === 'number' && v >= 0);
  if (!values.length) return Math.max(0, Number(fallback) || 0);
  return values.reduce((sum, v) => sum + v, 0);
}

/**
 * 一次性订阅额度核销：发送成功后指定 templateId -1（best-effort）。
 * 同时维护 subscribeQuota 总数，兼容旧页面。
 */
async function consumeSubscribeQuota(openid, templateId = TEMPLATE_ID) {
  try {
    const res = await db.collection(COLLECTIONS.USERS).where({ openId: openid }).get();
    const doc = (res.data || [])[0];
    if (!doc) return;
    const quota = subscribeQuotaOf(doc, templateId);
    if (quota <= 0) return;
    const quotas = Object.assign({}, doc.subscribeQuotas || {});
    quotas[templateId] = quota - 1;
    await db.collection(COLLECTIONS.USERS).doc(doc._id).update({
      data: {
        subscribeQuota: totalSubscribeQuota(quotas, doc.subscribeQuota),
        subscribeQuotas: quotas,
      },
    });
  } catch (e) {
    console.error('[notifier] consume-quota-failed', e.message);
  }
}

/**
 * 微信明确返回 43101 时，本地台账必然与微信侧不一致。
 * 清零对应模板额度，避免首页展示假“剩余次数”阻止重新授权。
 */
async function invalidateSubscribeQuota(openid, templateId, errCode, errMsg) {
  try {
    const res = await db.collection(COLLECTIONS.USERS).where({ openId: openid }).get();
    const doc = (res.data || [])[0];
    if (!doc) return;
    const quotas = Object.assign({}, doc.subscribeQuotas || {});
    quotas[templateId] = 0;
    await db.collection(COLLECTIONS.USERS).doc(doc._id).update({
      data: {
        subscribeQuota: totalSubscribeQuota(quotas, 0),
        subscribeQuotas: quotas,
        subscribeLastError: `errcode=${errCode} ${errMsg || ''}`.trim(),
        subscribeLastErrorAt: new Date(),
      },
    });
  } catch (e) {
    console.error('[notifier] invalidate-quota-failed', e.message);
  }
}

/**
 * 发送单条订阅消息。
 * 模板未配置时返回 skipped，不算失败（避免把任务错误标记为 MISSED）。
 */
async function sendOne(task, spot, offset) {
  if (!TEMPLATE_ID) {
    return { ok: false, skipped: true, reason: 'TEMPLATE_ID 未配置（附录 D 第 3 条待回填）' };
  }
  if (!(task.channels || []).includes(ChannelType.OFFICIAL_ACCOUNT)) {
    return { ok: false, skipped: true, reason: '用户未勾选公众号通道' };
  }
  if (!WX_APPID || !WX_APPSECRET) {
    console.error('[notifier] wx-config-missing', JSON.stringify({
      taskId: task._id, spotId: task.spotId, offset,
      hasAppid: Boolean(WX_APPID), hasAppsecret: Boolean(WX_APPSECRET),
    }));
    return { ok: false, skipped: false, reason: 'WX_APPID/WX_APPSECRET 未配置，订阅消息通道不可用' };
  }

  const spotName = spot ? spot.name : '景点';
  const payload = {
    touser: task.userId,
    template_id: TEMPLATE_ID,
    page: 'pages/home/home',
    miniprogram_state: 'formal',
    lang: 'zh_CN',
    data: {
      // 模板「活动开始通知」字段：thing4=活动名称 / date5=活动时间 / thing7=温馨提示（2026-08-21 对照公众平台修正）
      thing4: { value: spotName },
      date5: { value: beijingDateTime(task.releaseAt) },
      thing7: { value: `${offset} 分钟后放票，记得去抢票` },
    },
  };

  try {
    let res = await sendSubscribeMessageHttp(payload);
    // access_token 失效/过期（40001/42001）→ 强制刷新后重试一次
    if (res && Number(res.errcode) !== 0 && [40001, 42001].includes(Number(res.errcode))) {
      res = await sendSubscribeMessageHttp(payload, true);
    }

    // HTTP 接口成功时 errcode=0；微信侧错误统一为非 0 errcode
    if (res && Number(res.errcode) === 0) {
      // 发送成功 → 扣减一次性订阅额度（best-effort）
      await consumeSubscribeQuota(task.userId, TEMPLATE_ID);
      return { ok: true, res };
    }

    const errCode = res ? res.errcode : null;
    const errMsg = res ? res.errmsg : 'empty response';
    if (Number(errCode) === 43101) {
      await invalidateSubscribeQuota(task.userId, TEMPLATE_ID, errCode, errMsg);
    }
    console.error('[notifier] send-error-full', JSON.stringify({
      taskId: task._id, spotId: task.spotId, offset,
      errCode, errMsg, detail: res,
    }));
    return { ok: false, skipped: false, reason: errCode != null ? `errCode=${errCode} ${errMsg}` : errMsg };
  } catch (err) {
    // 只存 errCode 会丢掉微信返回的完整错误信息（errMsg 往往直接点名原因），这里全量打日志
    const errMsg = (err && (err.errMsg || err.message)) || String(err);
    console.error('[notifier] send-error-full', JSON.stringify({
      taskId: task._id, spotId: task.spotId, offset,
      errCode: err && err.errCode, errMsg,
      detail: err && err.detail,
    }));
    return { ok: false, skipped: false, reason: err && err.errCode ? `errCode=${err.errCode} ${errMsg}` : errMsg };
  }
}

/**
 * REMINDER-RULE-004 状态写入
 *
 * 发送失败（如 43101 配额不足）不把 offset 记入 sentOffsets：
 * 留待下一分钟扫描重试，用户在窗口期内补订阅授权即可救回；
 * 超过放票时刻仍未成功则判 MISSED。
 */
/**
 * REMINDER-RULE-004 状态写入
 *
 * 发送失败（如 43101 配额不足）不把 offset 记入 sentOffsets：
 * 留待下一分钟扫描重试，用户在窗口期内补订阅授权即可救回；
 * 超过放票时刻仍未成功则判 MISSED。
 *
 * @param {object} state 运行态 { sentOffsets, backendStatus }；并发下同一任务按组串行传入，避免多个 offset 互相覆盖。
 * @returns 更新后的运行态，供同一任务的下一个 offset 使用。
 */
async function markResult(task, offset, sendResult, nowTs, state = {}) {
  const releaseAt = new Date(task.releaseAt).getTime();
  const failed = !sendResult.ok && !sendResult.skipped;
  const base = state.sentOffsets || task.sentOffsets || [];
  const sent = (!failed && !base.includes(offset)) ? [...base, offset] : base;
  const allSent = (task.offsets || []).every(o => sent.includes(o));
  const data = { sentOffsets: sent };
  let backendStatus = state.backendStatus || task.backendStatus || ReminderBackendStatus.WAITING;

  if (sendResult.ok) {
    // 实际发送成功 → TRIGGERED
    if (allSent) {
      backendStatus = ReminderBackendStatus.TRIGGERED;
      data.backendStatus = backendStatus;
      data.triggeredAt = new Date(nowTs);
      data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    }
  } else if (failed) {
    // 无论是否已过放票时刻，都先把真实失败原因落库：
    // 过点后 sweepMissed 会用它当 missedReason，否则只剩笼统的「超过放票时间点未触发成功」，
    // 「WX_APPSECRET 未配置」「errCode=43101 配额不足」这类可行动信息会丢（2026-09-14 补）。
    data.lastSendError = sendResult.reason || '发送失败';
    data.lastSendErrorAt = new Date(nowTs);
    // 发送失败：若已过放票时刻则判 MISSED，否则留待下次扫描重试
    if (nowTs >= releaseAt) {
      backendStatus = ReminderBackendStatus.MISSED;
      data.backendStatus = backendStatus;
      data.missedReason = sendResult.reason;
      data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    }
  } else if (allSent) {
    // 全部通道被跳过（如用户未勾选公众号通道）：仍推进状态，避免任务永久滞留 WAITING
    backendStatus = ReminderBackendStatus.TRIGGERED;
    data.backendStatus = backendStatus;
    data.triggeredAt = new Date(nowTs);
    data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    data.missedReason = sendResult.reason;
  }

  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(task._id).update({ data });
  return { sentOffsets: sent, backendStatus };
}

/**
 * FLOW-002 主流程：扫描 → 错峰 → 发送 → 写状态
 */
async function scanAndSend() {
  const nowTs = Date.now();
  const scanWhere = {
    backendStatus: ReminderBackendStatus.WAITING,
    releaseAt: _.gt(new Date(nowTs))
      .and(_.lte(new Date(nowTs + SCAN_WINDOW_MS + MAX_ADVANCE_MS))),
  };
  const tasks = await fetchTasksPaged(scanWhere);

  const due = collectDue(tasks, nowTs);
  if (due.length === 0) {
    return { scanned: tasks.length, due: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const spotMap = await loadSpotMap(due);

  // 同一任务的多个 offset 归为一组：组内串行（保证 sentOffsets 递增不被并发覆盖），组间可并发。
  const groupMap = new Map();
  for (const d of due) {
    if (!groupMap.has(d.task._id)) groupMap.set(d.task._id, { task: d.task, offsets: [] });
    groupMap.get(d.task._id).offsets.push({ offset: d.offset, remindAt: d.remindAt });
  }
  const groups = [...groupMap.values()].map(g => ({
    task: g.task,
    offsets: g.offsets.slice().sort((a, b) => a.remindAt - b.remindAt),
    state: { sentOffsets: [...(g.task.sentOffsets || [])], backendStatus: g.task.backendStatus },
  }));

  const delays = staggerDelays(groups.length);
  const runStart = Date.now();
  let sent = 0; let failed = 0; let skipped = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < groups.length) {
      const i = cursor; cursor += 1;
      const g = groups[i];
      // 错峰：每个任务组在自己的 30s 时间片启动，不改动 REMINDER-RULE-003 的错峰语义
      const wait = Math.max(0, delays[i] - (Date.now() - runStart));
      if (wait > 0) await sleep(wait);

      for (const { offset } of g.offsets) {
        const result = await sendOne(g.task, spotMap[g.task.spotId], offset);
        g.state = await markResult(g.task, offset, result, Date.now(), g.state);

        if (!result.ok) {
          console.log('[notifier] send-fail', JSON.stringify({
            taskId: g.task._id, spotId: g.task.spotId, offset, reason: result.reason,
            templateConfigured: Boolean(TEMPLATE_ID),
          }));
        }

        if (result.ok) sent += 1;
        else if (result.skipped) skipped += 1;
        else failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, groups.length) }, () => worker()));
  return { scanned: tasks.length, due: due.length, sent, failed, skipped };
}

/**
 * 分页取回时间窗内的 WAITING 任务（orderBy releaseAt 依赖组合索引 backendStatus+releaseAt）。
 * 用 skip+limit 循环，避免 limit(500) 在第 500 条之后漏扫。
 */
async function fetchTasksPaged(where, { pageSize = SCAN_PAGE_SIZE, maxRows = SCAN_MAX_ROWS } = {}) {
  const rows = [];
  let skip = 0;
  while (rows.length < maxRows) {
    const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where(where)
      .orderBy('releaseAt', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return rows;
}

/** 按 due 涉及的 spotId 批量取景点名（发送消息需要） */
async function loadSpotMap(due) {
  const spotIds = [...new Set(due.map(d => d.task.spotId))];
  const spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: _.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }
  return spotMap;
}

/**
 * 把已过放票时刻却仍是 WAITING 的任务判为 MISSED（REMINDER-RULE-004）
 * 覆盖云函数中途失败、超时等情况。
 */
async function sweepMissed() {
  const nowTs = Date.now();
  const tasks = await fetchTasksPaged({
    backendStatus: ReminderBackendStatus.WAITING,
    releaseAt: _.lte(new Date(nowTs)),
  });

  let marked = 0;
  for (const t of tasks) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).update({
      data: {
        backendStatus: ReminderBackendStatus.MISSED,
        // 优先用 markResult 记下的真实发送失败原因（如「WX_APPID/WX_APPSECRET 未配置」），
        // 没有发送记录时才退回笼统文案
        missedReason: t.lastSendError || '超过放票时间点未触发成功',
        cleanAt: new Date(nowTs + CLEAN_AFTER_DAYS * 86400000),
      },
    });
    marked += 1;
  }
  return { marked };
}

/**
 * REMINDER-RULE-006 自动清理 + TRIP-RULE-004 级联删除空行程
 */
async function cleanup() {
  const nowTs = new Date();
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      backendStatus: _.in([ReminderBackendStatus.TRIGGERED, ReminderBackendStatus.MISSED]),
      cleanAt: _.lte(nowTs),
    })
    .limit(500)
    .get();

  const affected = [];
  for (const t of (res.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
    affected.push({ userId: t.userId, tripId: t.tripId });
  }

  // 级联：行程下任务与清单均空则删除行程
  let tripsRemoved = 0;
  const seen = new Set();
  for (const a of affected) {
    const key = `${a.userId}|${a.tripId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const taskCount = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId: a.userId, tripId: a.tripId }).count();
    if (taskCount.total > 0) continue;
    const cartCount = await db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId: a.userId, tripId: a.tripId }).count();
    if (cartCount.total > 0) continue;

    await db.collection(COLLECTIONS.TRIPS).doc(a.tripId).remove();
    tripsRemoved += 1;
  }

  return { tasksRemoved: affected.length, tripsRemoved };
}

exports.main = async (event) => {
  // 定时触发器不带 action，默认执行完整巡检
  const action = (event && event.action) || 'tick';

  try {
    switch (action) {
      case 'tick': {
        /* 三步彼此隔离：任何一步抛错（典型是缺 backendStatus+releaseAt 复合索引，
           `where + orderBy` 直接报错）都不能拖垮其余两步。
           以前三步串行，scanAndSend 一失败 sweepMissed 就永远不执行，
           结果「推送没发出」和「任务没被标 MISSED」同时发生，
           用户侧表现为任务永久卡在「待提醒」，且没有任何失败提示（2026-09-14 实际踩过）。 */
        const out = { send: null, missed: null, cleaned: null, errors: [] };
        const steps = [['send', scanAndSend], ['missed', sweepMissed], ['cleaned', cleanup]];
        for (const [key, fn] of steps) {
          try {
            out[key] = await fn();
          } catch (e) {
            out.errors.push(`${key}: ${e.message}`);
            console.error(`[notifier] tick step ${key} failed`, e);
          }
        }
        console.log('[notifier] tick', JSON.stringify(out));
        return { success: out.errors.length === 0, ...out, templateConfigured: Boolean(TEMPLATE_ID) };
      }
      case 'sendNow':
        return { success: true, ...(await scanAndSend()) };
      case 'testSend': {
        const { touser, miniprogramState = 'formal', lang = 'zh_CN', data, templateId } = event || {};
        if (!touser) return { success: false, error: 'testSend 需要 touser（已授权订阅的 openid）' };
        if (!WX_APPID || !WX_APPSECRET) return { success: false, error: 'WX_APPID/WX_APPSECRET 未配置' };
        const payload = {
          touser,
          template_id: templateId || TEMPLATE_ID,
          page: 'pages/home/home',
          miniprogram_state: miniprogramState,
          lang,
          data: data || {
            thing4: { value: '测试提醒' },
            date5: { value: '2026-08-21 18:30' },
            thing7: { value: '订阅消息通道验证（活动开始通知）' },
          },
        };
        try {
          const res = await sendSubscribeMessageHttp(payload);
          const ok = !!(res && Number(res.errcode) === 0);
          if (ok) {
            await consumeSubscribeQuota(touser, payload.template_id);
          } else if (Number(res && res.errcode) === 43101) {
            await invalidateSubscribeQuota(touser, payload.template_id, res.errcode, res.errmsg);
          }
          return { success: ok, res };
        } catch (err) {
          return { success: false, error: err.message, res: null };
        }
      }
      case 'whoami': {
        const ctx = cloud.getWXContext();
        return { success: true, openid: ctx.OPENID || null, appid: ctx.APPID || null };
      }
      case 'sweepMissed':
        return { success: true, ...(await sweepMissed()) };
      case 'cleanup':
        return { success: true, ...(await cleanup()) };
      default:
        return { success: false, error: `unknown action: ${action}` };
    }
  } catch (err) {
    console.error('[notifier] 执行失败', err);
    return { success: false, error: err.message };
  }
};

exports._internal = { collectDue, staggerDelays, beijingHm, beijingMonthDay, beijingDateTime, getAccessToken, sendSubscribeMessageHttp, httpJson, WX_APPID, WX_APPSECRET, TEMPLATE_ID };
