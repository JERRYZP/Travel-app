/**
 * 行程项展示态推导（TABLE-008 / ENUM-007~009，2026-09-16 首页行程状态墙 P2）
 *
 * 行程项 = 哪个行程 + 哪个景点 + 哪一天。它是首页状态墙、票务结果、
 * 提醒关联和删除动线的事实来源。
 *
 * ⚠️ 本模块是六个展示态的**唯一真身**。
 * 页面与云函数入口都不得自行按时间重新推导一遍——那必然漂移。
 * 派生字段（releaseAt / reservationRequired / ticketState / reminderState）
 * 一律读取时计算，**不落库到 trip_items**。
 *
 * 持久化的只有人工结果：result = SUCCESS | FAILED | null。
 */

const {
  COLLECTIONS, TicketState, TicketResult, ReminderDeliveryState,
  ReminderBackendStatus, V1, difficultyOf,
} = require('./schema');
const time = require('./time');
const tripItem = require('./trip-item');

/** 六个展示态 → 用户可见文案（8.3 固定口径） */
const TICKET_STATE_LABEL = {
  [TicketState.PENDING]: '待抢',
  [TicketState.BOOKABLE]: '可抢',
  [TicketState.SUCCESS]: '已成',
  [TicketState.FAILED]: '未成',
  // UNMARKED 是中性态，不是「未成」。放票过了 24 小时没标记不代表没抢到。
  [TicketState.UNMARKED]: '开过票了',
  [TicketState.NO_RESERVATION]: '免预约',
};

/** 提醒送达态 → 文案（STATE-002 / ENUM-009） */
const REMINDER_STATE_LABEL = {
  [ReminderDeliveryState.NOT_SET]: '未设提醒',
  [ReminderDeliveryState.WAITING]: '待提醒',
  [ReminderDeliveryState.TRIGGERED]: '已提醒',
  [ReminderDeliveryState.MISSED]: '未送达',
};

/* ============ 纯函数区 ============ */

/**
 * ENUM-007 票务展示状态推导。
 *
 * 计算顺序**严格固定**（API-契约 8.1 / STATE-004），顺序错了语义就反了：
 *   免预约 → 人工结果 → 放票时间前 → 放票后 24 小时内 → 未标记
 *
 * 为什么「人工结果」排在「放票前」之前：改成 SUCCESS/FAILED 之后不该再被
 * 时间条件翻回 PENDING——结果一旦落库就是事实，只有 undoResult 能撤销。
 *
 * @param {object} p
 * @param {object} p.item   trip_items 记录（读 result / resultAt）
 * @param {boolean} p.reservationRequired 该景点是否需预约
 * @param {Date|string|null} p.releaseAt   放票时刻（免预约为 null）
 * @param {Date} [p.nowTs]
 */
function ticketStateOf({ item, reservationRequired, releaseAt, nowTs = time.now() }) {
  if (reservationRequired === false) return TicketState.NO_RESERVATION;

  if (item && item.result === TicketResult.SUCCESS) return TicketState.SUCCESS;
  if (item && item.result === TicketResult.FAILED) return TicketState.FAILED;

  // 无放票时刻（需预约但无固定规则）按「还没有可抢的时间点」处理
  if (!releaseAt) return TicketState.PENDING;

  const passedMs = nowTs.getTime() - new Date(releaseAt).getTime();
  if (passedMs < 0) return TicketState.PENDING;

  const windowMs = V1.UNMARKED_AFTER_HOURS * 3600 * 1000;
  return passedMs <= windowMs ? TicketState.BOOKABLE : TicketState.UNMARKED;
}

/** 展示态 → 文案；未知态兜底成中性文案，绝不返回 undefined 给前端渲染 */
function ticketStateLabelOf(state) {
  return TICKET_STATE_LABEL[state] || '待抢';
}

/**
 * 由展示态推出这一条卡片当前能做什么。
 *
 * bookingEntryEnabled：官方预约入口**不因进入「开过票了」或标记失败而消失**，
 * 一直保留到 visitDate 当天 23:59（北京时间）。只有免预约/无放票规则才关。
 * 这是决策文档 3.2 明确写下的口径——预约入口的消失会让用户以为「没救了」。
 */
function bookingEntryEnabledOf({ ticketState, reservationRequired, visitDate, nowTs = time.now() }) {
  if (reservationRequired === false) return false;
  if (!visitDate) return false;
  // 出行日本身结束后才关；当天 23:59 之前都还能点
  return time.todayStr() <= visitDate;
}

/** 该行程项是否已过（visitDate 的次日 0 点起算，北京时间） */
function isItemEnded(visitDate, nowTs = time.now()) {
  return time.todayStr() > visitDate;
}

/**
 * 现在能不能手动标记结果。
 *
 * 三个条件缺一不可（8.4）：
 *  ① 免预约项没有票务结果可言；
 *  ② 必须已经开票——**开票前不问结果**（决策文档 4.1）；
 *  ③ 还没标记过、且 visitDate 当天 23:59 之前。
 */
function canMarkResult({ item, reservationRequired, releaseAt, visitDate, nowTs = time.now() }) {
  if (reservationRequired === false) return false;
  if (!releaseAt) return false;
  if (nowTs.getTime() < new Date(releaseAt).getTime()) return false;
  if (item && (item.result === TicketResult.SUCCESS || item.result === TicketResult.FAILED)) return false;
  return !isItemEnded(visitDate, nowTs);
}

/** 撤销截止时刻；未标记过则 null */
function undoUntilOf(item) {
  if (!item || !item.resultAt) return null;
  return new Date(new Date(item.resultAt).getTime() + V1.RESULT_UNDO_SECONDS * 1000);
}

/**
 * ENUM-009 提醒送达状态推导。
 *
 * **与票务状态完全分离**：票是票、提醒是提醒。抢票失败不影响提醒记录，
 * 提醒没送达也不代表用户没抢到。前端必须分两处展示。
 *
 * `lastSendError` 优先作为原因——它由 notifier 的 markResult / sweepMissed 写入真实失败原因
 * （43101 配额不足、WX_APPSECRET 未配置…），比笼统文案可行动得多。
 * 「已过 releaseAt 仍是 WAITING」在读取时收敛为 MISSED，与 task.effectiveStatusOf 同口径，
 * 不依赖 notifier 定时链路必须成功（2026-09-14 定规）。
 */
function reminderStateOf(task, { remindOn = false, nowTs = time.now() } = {}) {
  if (!remindOn || !task) {
    return { state: ReminderDeliveryState.NOT_SET, stateLabel: REMINDER_STATE_LABEL[ReminderDeliveryState.NOT_SET], reason: null };
  }

  let status = task.backendStatus;
  const passed = task.releaseAt && new Date(task.releaseAt).getTime() <= nowTs.getTime();
  if (status === ReminderBackendStatus.WAITING && passed) status = ReminderBackendStatus.MISSED;

  let state = ReminderDeliveryState.WAITING;
  if (status === ReminderBackendStatus.TRIGGERED) state = ReminderDeliveryState.TRIGGERED;
  else if (status === ReminderBackendStatus.MISSED) state = ReminderDeliveryState.MISSED;
  else if (status === ReminderBackendStatus.CLOSED) state = ReminderDeliveryState.NOT_SET;

  const reason = state === ReminderDeliveryState.MISSED
    ? (task.missedReason || task.lastSendError || '超过放票时间点未触发成功')
    : null;

  return {
    state,
    stateLabel: REMINDER_STATE_LABEL[state],
    reason,
    channels: task.channels || [],
    offsets: task.offsets || [],
  };
}

/**
 * 门票进度（8.2 / STATE-004）。
 *
 * 分母 = 去重后的**预约需求组**（backupGroupId），不是提醒条数，也不是行程项条数：
 * 同一景点的多个备选日期只算一个需求，否则「故宫 10月2日 + 10月3日」会显示成 0/2，
 * 用户抢到一天仍看到没做完，进度就变成噪音。
 *
 * 免预约项**不进分母**，单独统计成 noReservationCount（另起一行「另有 X 处随到随玩」）。
 * 未设提醒但确实需要预约的景点**仍进分母**——否则进度会伪装成已完成。
 */
function backupGroupProgress(items) {
  const groups = new Map();
  let noReservationCount = 0;

  for (const it of (items || [])) {
    if (it.reservationRequired === false) {
      noReservationCount += 1;
      continue;
    }
    const key = it.backupGroupId || `${it.tripId}:${it.spotId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  let done = 0;
  for (const list of groups.values()) {
    // 任意一个备选日期抢到 = 这个需求搞定了
    if (list.some(i => i.result === TicketResult.SUCCESS)) done += 1;
  }

  return { done, total: groups.size, noReservationCount };
}

/**
 * 组装 8.3 的行程项返回结构。
 *
 * itemId（不是 _id）是对外主键：任务、删除、提醒状态和推送落地全部按 itemId 关联。
 */
function decorateItem({ item, spot, rule, task, nowTs = time.now() }) {
  const reservationRequired = !spot || spot.reservationRequired !== false;
  const releaseAt = deriveReleaseAt(spot, rule, item.visitDate);
  const ticketState = ticketStateOf({ item, reservationRequired, releaseAt, nowTs });

  return {
    itemId: item._id,
    tripId: item.tripId,
    spotId: item.spotId,
    spotName: spot ? spot.name : '未知景点',
    visitDate: item.visitDate,
    backupGroupId: item.backupGroupId || tripItem.backupGroupIdOf(item.tripId, item.spotId),
    reservationRequired,
    remindOn: reservationRequired && item.remindOn === true,
    releaseAt,
    difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
    ticketState,
    ticketStateLabel: ticketStateLabelOf(ticketState),
    bookingEntryEnabled: bookingEntryEnabledOf({ ticketState, reservationRequired, visitDate: item.visitDate, nowTs }),
    canMark: canMarkResult({ item, reservationRequired, releaseAt, visitDate: item.visitDate, nowTs }),
    result: item.result || null,
    resultAt: item.resultAt || null,
    undoUntil: undoUntilOf(item),
    ended: isItemEnded(item.visitDate, nowTs),
    reminder: reminderStateOf(task, { remindOn: item.remindOn === true && reservationRequired, nowTs }),
  };
}

/**
 * 行程项的放票时刻（读取时派生，不落库）。
 *
 * 复刻 timeline.buildEvents 的口径：releaseAt = (visitDate − advanceDays) 当日 releaseTime。
 * 必须走同一条推算，否则首页显示的放票时间会和「添加提醒」页的时间线对不上。
 */
function deriveReleaseAt(spot, rule, visitDate) {
  if (!spot || spot.reservationRequired === false) return null;
  if (!rule || !rule.advanceDays) return null;
  const releaseTime = rule.releaseTime || (rule.releaseTimes || [])[0];
  if (!releaseTime) return null;
  return time.parseBeijing(time.addDays(visitDate, -rule.advanceDays), releaseTime);
}

/** 拜访日升序；同日按放票时刻升序，无放票时刻（免预约）排当天最后 */
function sortItems(items) {
  return [...(items || [])].sort((a, b) => {
    const d = String(a.visitDate).localeCompare(String(b.visitDate));
    if (d !== 0) return d;
    const ra = a.releaseAt ? new Date(a.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rb = b.releaseAt ? new Date(b.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/**
 * 全局最近的放票项（吸顶横幅用）。
 *
 * 跨**全部当前/未来行程**取，不按行程分开算——用户不关心「哪个行程的提醒最近」，
 * 只关心「接下来该抢哪张票」。只取还没开票的（已开票的该去抢，不该占着倒计时位）。
 */
function nextReleases(decorated, nowTs = time.now(), limit = 2) {
  return decorated
    .filter(d => d.releaseAt)
    .map(d => ({ ...d, releaseTs: new Date(d.releaseAt).getTime() }))
    .filter(d => d.releaseTs > nowTs.getTime())
    .sort((a, b) => a.releaseTs - b.releaseTs)
    .slice(0, limit);
}

/**
 * 首页进页面时的自动定位目标（决策文档 4.1）：
 * 24 小时内已开票、还没标记结果的那一条，优先 BOOKABLE（还来得及救）。
 * 过时的不滚——用户不需要被已经无法挽回的事打断。
 */
function scrollTargetOf(decorated, nowTs = time.now()) {
  const candidates = decorated
    .filter(d => d.canMark)
    .map(d => ({ ...d, releaseTs: d.releaseAt ? new Date(d.releaseAt).getTime() : 0 }))
    .sort((a, b) => {
      // BOOKABLE 优先：还来得及救
      const pa = a.ticketState === TicketState.BOOKABLE ? 0 : 1;
      const pb = b.ticketState === TicketState.BOOKABLE ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.releaseTs - a.releaseTs; // 都是同一优先级时取最近开票的
    });
  return candidates.length ? candidates[0].itemId : null;
}

/* ============ 数据库读取区 ============ */

/** 按用户读取全部行程项（跨行程：吸顶横幅与自动定位需要） */
async function listItemsByUser(db, userId) {
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId }).get();
  return res.data || [];
}

/** 按行程读取行程项 */
async function listItemsByTrip(db, userId, tripId) {
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId, tripId }).get();
  return res.data || [];
}

/**
 * 批量取景点与规则（状态推导的两份输入）。
 * 返回普通对象映射，避免调用方各自再查一遍导致口径分叉。
 */
async function loadSpotContext(db, spotIds) {
  const ids = [...new Set((spotIds || []).filter(Boolean))];
  const spotMap = {};
  const ruleMap = {};
  if (ids.length === 0) return { spotMap, ruleMap };

  const [spotsRes, rulesRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId: db.command.in(ids) }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: db.command.in(ids) }).get(),
  ]);
  (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
  return { spotMap, ruleMap };
}

/** 按 itemId 建立任务映射（一个行程项可能有多条任务，保留最新的那条做展示） */
function taskMapByItemId(tasks) {
  const map = {};
  for (const t of (tasks || [])) {
    if (!t.itemId) continue;
    const cur = map[t.itemId];
    if (!cur || new Date(t.createdAt || 0) >= new Date(cur.createdAt || 0)) map[t.itemId] = t;
  }
  return map;
}

/**
 * 读取某用户全部行程项并装饰好（首页/自动定位/横幅的公共入口）。
 * @returns {Promise<Array>} decorateItem 结果数组
 */
async function loadDecoratedItems(db, userId, { tripId = null, nowTs = time.now() } = {}) {
  const items = tripId
    ? await listItemsByTrip(db, userId, tripId)
    : await listItemsByUser(db, userId);
  if (items.length === 0) return [];

  const { spotMap, ruleMap } = await loadSpotContext(db, items.map(i => i.spotId));
  const taskRes = tripId
    ? await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId, tripId }).get()
    : await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId }).get();
  const taskMap = taskMapByItemId(taskRes.data || []);

  return items.map(item => decorateItem({
    item,
    spot: spotMap[item.spotId],
    rule: ruleMap[item.spotId],
    task: taskMap[item._id] || null,
    nowTs,
  }));
}

module.exports = {
  TICKET_STATE_LABEL,
  REMINDER_STATE_LABEL,
  ticketStateOf,
  ticketStateLabelOf,
  bookingEntryEnabledOf,
  isItemEnded,
  canMarkResult,
  undoUntilOf,
  reminderStateOf,
  backupGroupProgress,
  decorateItem,
  deriveReleaseAt,
  sortItems,
  nextReleases,
  scrollTargetOf,
  listItemsByUser,
  listItemsByTrip,
  loadSpotContext,
  taskMapByItemId,
  loadDecoratedItems,
};
