/**
 * 提醒任务规则 REMINDER-RULE-001 ~ 008 + STATE-001/002（产品文档 3.5）
 *
 * 任务是最小执行单元：一条任务 = 某日某时对某景点的一次提醒。
 * 一个清单项按用户勾选的提前量集合展开为多条任务（每个 offset 各一条）。
 */

const {
  COLLECTIONS, ReminderBackendStatus, ChannelType, V1, ERRORS, ok, fail,
} = require('./schema');
const time = require('./time');

/* ============ 纯函数区 ============ */

/**
 * REMINDER-RULE-001 提醒时间点 = releaseAt − offset
 */
function remindAtOf(releaseAt, offsetMinutes) {
  return time.addMinutes(new Date(releaseAt), -offsetMinutes);
}

/**
 * STATE-002 UI 状态映射
 * WAITING → 「待提醒」；TRIGGERED / MISSED → 「已提醒」；CLOSED → 不展示
 */
function uiLabelOf(backendStatus) {
  switch (backendStatus) {
    case ReminderBackendStatus.WAITING: return '待提醒';
    case ReminderBackendStatus.TRIGGERED:
    case ReminderBackendStatus.MISSED: return '已提醒';
    default: return null; // CLOSED 不展示
  }
}

/** 提交前校验：方式与提前量至少各选 1 项（PAGE-008 交互） */
function validateSubmit(channels, offsets) {
  if (!Array.isArray(channels) || channels.length === 0) return false;
  if (!Array.isArray(offsets) || offsets.length === 0) return false;
  // V1 只允许 5 / 2 分钟
  return offsets.every(o => V1.ALLOWED_OFFSETS.includes(o));
}

/**
 * REMINDER-RULE-003 错峰推送：同一放票时间点的批量任务在 30 秒窗口内错峰
 * 返回每条任务应延迟的毫秒数（稳定分布，同一入参恒定）
 */
function staggerDelays(count, windowSeconds = V1.STAGGER_WINDOW_SECONDS) {
  if (count <= 1) return [0];
  const step = (windowSeconds * 1000) / count;
  return Array.from({ length: count }, (_, i) => Math.floor(i * step));
}

/**
 * REMINDER-RULE-008 Banner 文案
 * 优先级 ① 即将开始提醒（1 小时内）② 系统公告 ③ 活动公告，一次仅一条
 * 文档示例：「今天18:30开抢慕田峪长城5月31日的门票，还有20分钟」
 */
function buildBanner(tasks, nowTs = time.now()) {
  const soon = tasks
    .filter(t => t.backendStatus === ReminderBackendStatus.WAITING)
    .map(t => ({ ...t, releaseAtTs: new Date(t.releaseAt).getTime() }))
    .filter(t => {
      const diff = t.releaseAtTs - nowTs.getTime();
      return diff > 0 && diff <= V1.BANNER_WINDOW_HOURS * 3600 * 1000;
    })
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];

  if (!soon) return null;

  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - nowTs.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  // 「今天」以传入的 nowTs 为基准判定，不读系统时间，保证可测试
  const isToday = time.toDateStr(releaseAt) === time.toDateStr(nowTs);
  const isTomorrow = time.toDateStr(releaseAt) === time.addDays(time.toDateStr(nowTs), 1);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${time.beijingParts(releaseAt).month}月${time.beijingParts(releaseAt).day}日`);
  // 文档示例：「今天18:30开抢慕田峪长城5月31日的门票，还有20分钟」——出行日不带星期
  const vp = time.beijingParts(time.parseBeijing(soon.visitDate, '12:00'));
  const visitLabel = `${vp.month}月${vp.day}日`;

  return {
    type: 'UPCOMING',
    text: `${dayWord}${time.formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${visitLabel}的门票，还有${minutesLeft}分钟`,
    taskId: soon._id,
    minutesLeft,
  };
}

/* ============ 数据库操作区 ============ */

/**
 * FLOW-001 最后一步：清单 → 任务（PAGE-008 提交）
 *
 * 一个清单项 × N 个 offset = N 条任务（REMINDER-RULE-001）
 * 提交成功后对应清单条目清除（CART-RULE-003）
 *
 * 云开发事务要求所有读写都在事务内，且不支持 where 批量删除，
 * 因此这里逐条 doc() 操作。
 */
async function submit(db, userId, { tripId, channels, offsets }) {
  if (!validateSubmit(channels, offsets)) return fail(ERRORS.BAD_PARAM);

  const cartWhere = tripId ? { userId, tripId } : { userId };
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART).where(cartWhere).get();
  const cartItems = cartRes.data || [];
  if (cartItems.length === 0) return fail(ERRORS.CART_EMPTY);

  const nowTs = time.now();
  const created = [];
  const transaction = await db.startTransaction();

  try {
    for (const item of cartItems) {
      // 同一 (spotId, visitDate) 只建一条任务，offsets 存数组（TABLE-002 结构）
      const taskData = {
        userId,
        tripId: item.tripId,
        spotId: item.spotId,
        visitDate: item.visitDate,
        releaseAt: new Date(item.releaseAt),
        offsets: [...offsets].sort((a, b) => b - a), // 大在前：5 分钟先于 2 分钟触发
        channels,
        backendStatus: ReminderBackendStatus.WAITING,
        triggeredAt: null,
        missedReason: null,
        cleanAt: null,
        // 记录每个 offset 的发送情况，供 notifier 幂等判断
        sentOffsets: [],
        createdAt: nowTs,
      };
      const res = await transaction.collection(COLLECTIONS.REMINDER_TASKS).add({ data: taskData });
      created.push({ _id: res._id, ...taskData });
      await transaction.collection(COLLECTIONS.REMINDER_CART).doc(item._id).remove();
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    return fail({ code: 1011, message: `提交失败：${err.message}` });
  }

  return ok({
    created: created.length,
    tasks: created,
    // ICS 由调用方（index.js）在提交成功后触发生成，失败不阻塞（ICS-RULE-002）
    needsIcsSync: channels.includes(ChannelType.CALENDAR_ICS),
    needsOaAuth: channels.includes(ChannelType.OFFICIAL_ACCOUNT),
  });
}

/**
 * PAGE-009 任务列表（首页形态2）
 * 行程分组 + 进行中/已过期筛选 + 状态标签
 */
async function list(db, userId, { tripId = null, filter = 'active' } = {}) {
  const where = { userId };
  if (tripId) where.tripId = tripId;

  const res = await db.collection(COLLECTIONS.REMINDER_TASKS).where(where).get();
  const all = (res.data || []).filter(t => t.backendStatus !== ReminderBackendStatus.CLOSED);

  const spotIds = [...new Set(all.map(t => t.spotId))];
  let spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: db.command.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }

  const nowTs = time.now();
  const enriched = all.map(t => {
    const releaseAt = new Date(t.releaseAt);
    const msLeft = releaseAt.getTime() - nowTs.getTime();
    const totalMin = Math.max(0, Math.floor(msLeft / 60000));
    // 「已过期」= MISSED 或已过放票时间点（PAGE-009 筛选定义）
    const expired = t.backendStatus === ReminderBackendStatus.MISSED || msLeft <= 0;
    return {
      ...t,
      spotName: spotMap[t.spotId] ? spotMap[t.spotId].name : '未知景点',
      difficultyScore: spotMap[t.spotId] ? spotMap[t.spotId].difficultyScore : null,
      releaseTimeLabel: time.formatHourMinute(releaseAt),
      releaseDateStr: time.toDateStr(releaseAt),
      grabLabel: `开抢 ${time.formatMonthDayWeek(t.visitDate)} 门票`,
      statusLabel: uiLabelOf(t.backendStatus),
      countdown: msLeft > 0 && msLeft < 3600 * 1000
        ? { text: `还剩${Math.floor(totalMin / 60)}h ${totalMin % 60}m`, urgent: true }
        : null,
      expired,
    };
  });

  const active = enriched.filter(t => !t.expired);
  const past = enriched.filter(t => t.expired);
  const shown = filter === 'expired' ? past : active;

  // 按放票日期分组（PAGE-009 时间线列表）
  const map = new Map();
  for (const t of shown) {
    if (!map.has(t.releaseDateStr)) map.set(t.releaseDateStr, []);
    map.get(t.releaseDateStr).push(t);
  }
  const groups = [...map.entries()]
    .sort((a, b) => (filter === 'expired' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([dateStr, items]) => ({
      key: dateStr,
      label: time.formatMonthDayWeek(dateStr),
      items: items.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    }));

  return ok({
    groups,
    counts: { active: active.length, expired: past.length },
    banner: buildBanner(enriched, nowTs),
    badge: await badgeCount(db, userId),
    // HOME-RULE-001 首页形态判定：无任何任务 → 形态1
    homeMode: enriched.length === 0 ? 1 : 2,
  });
}

/**
 * REMINDER-RULE-005 删除任务：仅 WAITING 可删
 * 删除后同步删除未触发的 ICS 事件（由调用方重新生成 ICS 文件）
 */
async function remove(db, userId, taskId) {
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ _id: taskId, userId }).get();
  const task = (res.data || [])[0];
  if (!task) return fail(ERRORS.BAD_PARAM);
  if (task.backendStatus !== ReminderBackendStatus.WAITING) {
    return fail({ code: 1012, message: '仅待提醒的任务可以删除' });
  }

  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(taskId).remove();
  return ok({ taskId, tripId: task.tripId, needsIcsSync: true });
}

/**
 * REMINDER-RULE-007 Tab 角标 = 未来 24 小时内 WAITING 任务数
 */
async function badgeCount(db, userId) {
  const nowTs = time.now();
  const until = new Date(nowTs.getTime() + V1.BADGE_WINDOW_HOURS * 3600 * 1000);
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      userId,
      backendStatus: ReminderBackendStatus.WAITING,
      releaseAt: db.command.gt(nowTs).and(db.command.lte(until)),
    })
    .count();
  return res.total || 0;
}

/**
 * REMINDER-RULE-006 自动清理：TRIGGERED/MISSED 后 14 天 → CLOSED 并物理删除
 * 由 notifier 定时任务调用，返回受影响的 tripId 供级联检查（TRIP-RULE-004）
 */
async function cleanup(db) {
  const nowTs = time.now();
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      backendStatus: db.command.in([
        ReminderBackendStatus.TRIGGERED, ReminderBackendStatus.MISSED,
      ]),
      cleanAt: db.command.lte(nowTs),
    })
    .get();

  const affected = [];
  for (const t of (res.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
    affected.push({ userId: t.userId, tripId: t.tripId });
  }
  return { removed: affected.length, affected };
}

module.exports = {
  remindAtOf,
  uiLabelOf,
  validateSubmit,
  staggerDelays,
  buildBanner,
  submit,
  list,
  remove,
  badgeCount,
  cleanup,
};
