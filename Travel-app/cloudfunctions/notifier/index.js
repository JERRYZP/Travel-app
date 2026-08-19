/**
 * notifier 云函数 —— 提醒推送与任务状态机（FLOW-002 / REMINDER-RULE-003/004/006）
 *
 * 定时触发：每分钟一次（见 config.json）
 * 每次扫描「提醒时刻落在本分钟窗口内」的 WAITING 任务，
 * 30 秒内错峰发送，写 TRIGGERED；超过 releaseAt 仍未成功写 MISSED。
 *
 * 订阅消息模板 ID 尚未申请（产品文档附录 D 第 3 条）：
 * 未配置时不阻塞流程，跳过公众号通道并记 ERROR-1008，日历通道由 ICS 独立承担。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  REMINDER_TASKS: 'reminder_tasks',
  SPOTS: 'spots',
  TRIPS: 'trips',
  REMINDER_CART: 'reminder_cart',
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

/** 订阅消息模板 ID（微信公众平台「活动开始通知」公共模板，2026-08-19 申请）。
 *  环境变量优先；控制台未配 env 时用兜底常量，保证重新部署不丢配置。与 miniprogram/utils/notify.js 对齐。 */
const TEMPLATE_ID = process.env.SUBSCRIBE_TEMPLATE_ID || 'w5e9AIVe2oDidseGOX74CG2Z1-r0ikQTpUQAELcM1nk';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingHm(date) {
  const s = new Date(new Date(date).getTime() + BEIJING_OFFSET_MS).toISOString();
  return `${s.slice(11, 13)}:${s.slice(14, 16)}`;
}

function beijingMonthDay(dateStr) {
  const [, m, d] = String(dateStr).split('-').map(Number);
  return `${m}月${d}日`;
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

  const spotName = spot ? spot.name : '景点';
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: task.userId,
      templateId: TEMPLATE_ID,
      page: 'pages/index/index',
      miniprogramState: 'formal',
      lang: 'zh_CN',
      data: {
        thing1: { value: spotName },
        time2: { value: `${beijingMonthDay(task.visitDate)} ${beijingHm(task.releaseAt)}` },
        thing3: { value: `${offset} 分钟后放票` },
      },
    });
    return { ok: true, res };
  } catch (err) {
    // 43101 = 用户拒收 / 未授权；ERROR-1008 配额不足
    return { ok: false, skipped: false, reason: err.errCode ? `errCode=${err.errCode}` : err.message };
  }
}

/**
 * REMINDER-RULE-004 状态写入
 */
async function markResult(task, offset, sendResult, nowTs) {
  const sent = [...(task.sentOffsets || []), offset];
  const allSent = (task.offsets || []).every(o => sent.includes(o));
  const releaseAt = new Date(task.releaseAt).getTime();

  const data = { sentOffsets: sent };

  if (sendResult.ok) {
    // 实际发送成功 → TRIGGERED
    if (allSent) {
      data.backendStatus = ReminderBackendStatus.TRIGGERED;
      data.triggeredAt = new Date(nowTs);
      data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    }
  } else if (!sendResult.skipped) {
    // 发送失败：若已过放票时刻则判 MISSED，否则留待下次扫描重试
    if (nowTs >= releaseAt) {
      data.backendStatus = ReminderBackendStatus.MISSED;
      data.missedReason = sendResult.reason;
      data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    }
  } else if (allSent) {
    // 全部通道被跳过（如模板未配置）：仍推进状态，避免任务永久滞留 WAITING
    data.backendStatus = ReminderBackendStatus.TRIGGERED;
    data.triggeredAt = new Date(nowTs);
    data.cleanAt = new Date(nowTs + CLEAN_AFTER_DAYS * 86400000);
    data.missedReason = sendResult.reason;
  }

  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(task._id).update({ data });
  return data.backendStatus || ReminderBackendStatus.WAITING;
}

/**
 * FLOW-002 主流程：扫描 → 错峰 → 发送 → 写状态
 */
async function scanAndSend() {
  const nowTs = Date.now();

  // 只查 WAITING 且尚未过放票时刻的任务
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      backendStatus: ReminderBackendStatus.WAITING,
      releaseAt: _.gt(new Date(nowTs)),
    })
    .limit(500)
    .get();

  const due = collectDue(res.data || [], nowTs);
  if (due.length === 0) {
    return { scanned: (res.data || []).length, due: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const spotIds = [...new Set(due.map(d => d.task.spotId))];
  const spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: _.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }

  const delays = staggerDelays(due.length);
  let sent = 0; let failed = 0; let skipped = 0;

  for (let i = 0; i < due.length; i += 1) {
    const { task, offset } = due[i];
    if (delays[i] > 0) await sleep(delays[i] - (i > 0 ? delays[i - 1] : 0));

    const result = await sendOne(task, spotMap[task.spotId], offset);
    await markResult(task, offset, result, Date.now());

    if (!result.ok) {
      console.log('[notifier] send-fail', JSON.stringify({
        taskId: task._id, spotId: task.spotId, offset, reason: result.reason,
        templateConfigured: Boolean(TEMPLATE_ID),
      }));
    }

    if (result.ok) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }

  return { scanned: (res.data || []).length, due: due.length, sent, failed, skipped };
}

/**
 * 把已过放票时刻却仍是 WAITING 的任务判为 MISSED（REMINDER-RULE-004）
 * 覆盖云函数中途失败、超时等情况。
 */
async function sweepMissed() {
  const nowTs = Date.now();
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      backendStatus: ReminderBackendStatus.WAITING,
      releaseAt: _.lte(new Date(nowTs)),
    })
    .limit(500)
    .get();

  let marked = 0;
  for (const t of (res.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).update({
      data: {
        backendStatus: ReminderBackendStatus.MISSED,
        missedReason: '超过放票时间点未触发成功',
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
        const send = await scanAndSend();
        const missed = await sweepMissed();
        const cleaned = await cleanup();
        console.log('[notifier] tick', JSON.stringify({ send, missed, cleaned }));
        return { success: true, send, missed, cleaned, templateConfigured: Boolean(TEMPLATE_ID) };
      }
      case 'sendNow':
        return { success: true, ...(await scanAndSend()) };
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

exports._internal = { collectDue, staggerDelays, beijingHm, beijingMonthDay };
