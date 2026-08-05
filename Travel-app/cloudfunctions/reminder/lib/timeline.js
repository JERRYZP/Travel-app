/**
 * 时间线生成规则 TIMELINE-RULE-001 ~ 005（产品文档 3.3）
 *
 * 关键：releaseAt 完全由静态规则推算（advanceDays / releaseTime / closedDays），
 * 不依赖抓取。抓取只影响「已放票之后是否约满」这一个分支（ENUM-005）。
 */

const {
  COLLECTIONS, EventSelectStatus, ReleaseStatus, ReminderBackendStatus,
  difficultyOf, ok,
} = require('./schema');
const time = require('./time');

/* ============ 纯函数区 ============ */

/**
 * TIMELINE-RULE-001 + 005 为单个景点生成事件（交叉积）
 *
 * 景点 × 行程内每个非闭馆日 = N 个事件。
 * visitDate = 该日；releaseAt = (visitDate − advanceDays) 当日 releaseTime（GMT+8）
 *
 * 不替用户推断出行日——用户通过 PAGE-005/006 的 Tab 选择实际要哪天的提醒。
 *
 * @returns {Array} 空数组表示该景点在行程内每天都闭馆（TIMELINE-RULE-005）
 */
function buildEvents(spot, rule, trip) {
  if (!rule || !rule.advanceDays || !rule.releaseTime) return [];

  const closed = rule.closedDays || [];
  const events = [];

  for (const visitDate of time.dateRange(trip.startDate, trip.endDate)) {
    // TIMELINE-RULE-005 按日判定：该日闭馆则跳过这一天，其余日期照常生成
    if (closed.includes(time.dayNameOf(visitDate))) continue;

    const releaseDate = time.addDays(visitDate, -rule.advanceDays);
    events.push({
      spotId: spot.spotId,
      spotName: spot.name,
      difficulty: difficultyOf(spot.difficultyScore),
      visitDate,
      releaseAt: time.parseBeijing(releaseDate, rule.releaseTime),
      // 展示用（PAGE-005 事件卡左轴与文案）
      releaseDateStr: releaseDate,
      releaseTimeStr: rule.releaseTime,
      visitDateLabel: time.formatMonthDayWeek(visitDate),
      advanceDays: rule.advanceDays,
      officialAppid: spot.officialAppid || '',
      officialPath: spot.officialPath || '',
      officialWebUrl: spot.officialWebUrl || '',
    });
  }

  return events;
}

/**
 * TIMELINE-RULE-004 事件按钮态判定（STATE-003）
 *
 * releaseAt > now：不在清单且未提交 → SELECTABLE；在清单 → IN_CART；已提交 → WAITING
 * releaseAt ≤ now：查实时放票状态 → BOOKABLE（立即预约）/ FULL（置灰已约满）
 *
 * @param {object} ctx { inCart:boolean, task:object|null, releaseStatus:string|null }
 */
function resolveStatus(event, ctx, nowTs = time.now()) {
  const { inCart = false, task = null, releaseStatus = null } = ctx || {};

  if (event.releaseAt.getTime() > nowTs.getTime()) {
    if (task) {
      return task.backendStatus === ReminderBackendStatus.WAITING
        ? EventSelectStatus.WAITING
        : EventSelectStatus.REMINDERED;
    }
    if (inCart) return EventSelectStatus.IN_CART;
    return EventSelectStatus.SELECTABLE;
  }

  // 已过放票时刻：脱离清单体系，看实时可约状态
  if (releaseStatus === ReleaseStatus.FULL) return EventSelectStatus.FULL;
  return EventSelectStatus.BOOKABLE;
}

/** 按钮态 → 前端按钮文案与可点性 */
function buttonOf(status) {
  switch (status) {
    case EventSelectStatus.SELECTABLE: return { text: '+ 添加提醒', enabled: true };
    case EventSelectStatus.IN_CART: return { text: '已加清单', enabled: true, openCart: true };
    case EventSelectStatus.WAITING: return { text: '待提醒', enabled: false };
    case EventSelectStatus.REMINDERED: return { text: '已提醒', enabled: false };
    case EventSelectStatus.BOOKABLE: return { text: '立即预约', enabled: true, booking: true };
    case EventSelectStatus.FULL: return { text: '已约满', enabled: false };
    default: return { text: '', enabled: false };
  }
}

/**
 * TIMELINE-RULE-003 视图组装（均为单选筛选，前端一次只渲染一个 Tab 的 events）
 * byDeparture：以 visitDate 为 Tab，组内按 releaseAt 升序
 * bySpot：以 spot 为 Tab，组内按 releaseAt 升序
 *
 * 每个 Tab 自带 scrollIndex（UI-006 默认滚动位置按 Tab 独立计算）。
 */
function groupByDeparture(events, nowTs = time.now()) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.visitDate)) map.set(e.visitDate, []);
    map.get(e.visitDate).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([visitDate, list]) => {
      const sorted = list.sort((a, b) => a.releaseAt - b.releaseAt);
      return {
        key: visitDate,
        label: time.formatMonthDayWeek(visitDate),
        events: sorted,
        count: sorted.length,
        scrollIndex: defaultScrollIndex(sorted, nowTs),
      };
    });
}

function groupBySpot(events, nowTs = time.now()) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.spotId)) map.set(e.spotId, []);
    map.get(e.spotId).push(e);
  }
  return [...map.entries()].map(([spotId, list]) => {
    const sorted = list.sort((a, b) => a.releaseAt - b.releaseAt);
    return {
      key: spotId,
      label: sorted[0].spotName,
      events: sorted,
      count: sorted.length,
      scrollIndex: defaultScrollIndex(sorted, nowTs),
    };
  }).sort((a, b) => a.events[0].releaseAt - b.events[0].releaseAt);
}

/**
 * UI-006 默认滚动位置 = 最近的未提醒事件在扁平序列中的下标
 */
function defaultScrollIndex(events, nowTs = time.now()) {
  const sorted = [...events].sort((a, b) => a.releaseAt - b.releaseAt);
  const idx = sorted.findIndex(e => e.releaseAt.getTime() > nowTs.getTime());
  return idx === -1 ? Math.max(0, sorted.length - 1) : idx;
}

/* ============ 数据库操作区 ============ */

/**
 * 生成整条时间线（PAGE-005/006 主数据）
 *
 * TIMELINE-RULE-002 的「保留已有状态」通过按 (spotId+visitDate) 关联
 * 现有清单项与任务实现——事件本身不落库，每次实时重算，
 * 因此不存在陈旧事件残留问题；被移除景点的清单项在此顺带清理。
 */
async function generate(db, userId, tripId, { spotStatusMap = {} } = {}) {
  const tripRes = await db.collection(COLLECTIONS.TRIPS)
    .where({ _id: tripId, userId }).get();
  const trip = (tripRes.data || [])[0];
  if (!trip) return { success: false, error: '行程不存在' };

  const spotIds = trip.spotIds || [];
  if (spotIds.length === 0) {
    return ok({
      tripId, events: [], byDeparture: [], bySpot: [], closedSpots: [],
      empty: true, emptyReason: '先选择想去的景点',
    });

  }

  const [spotsRes, rulesRes, cartRes, tasksRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.REMINDER_CART).where({ userId, tripId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId, tripId }).get(),
  ]);

  const ruleMap = {};
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
  const cartKeys = new Set((cartRes.data || []).map(c => `${c.spotId}|${c.visitDate}`));
  const taskMap = {};
  (tasksRes.data || []).forEach(t => { taskMap[`${t.spotId}|${t.visitDate}`] = t; });

  const nowTs = time.now();
  const events = [];
  const closedSpots = [];

  for (const spot of (spotsRes.data || [])) {
    const built = buildEvents(spot, ruleMap[spot.spotId], trip);
    if (built.length === 0) {
      // TIMELINE-RULE-005：行程内每天都闭馆 → 想去列表该行标注「行程期间闭馆」
      closedSpots.push({ spotId: spot.spotId, spotName: spot.name, note: '行程期间闭馆' });
      continue;
    }
    for (const event of built) {
      const key = `${event.spotId}|${event.visitDate}`;
      const status = resolveStatus(event, {
        inCart: cartKeys.has(key),
        task: taskMap[key] || null,
        releaseStatus: spotStatusMap[event.spotId] || null,
      }, nowTs);

      events.push({
        ...event,
        status,
        button: buttonOf(status),
        // scraper 未上线：已放票事件的「已约满」判定缺失，标记 stale 供前端提示
        stale: event.releaseAt.getTime() <= nowTs.getTime() && !spotStatusMap[event.spotId],
      });
    }
  }

  // 清理已移除景点的清单残留（TIMELINE-RULE-002 末句）
  const validKeys = new Set(events.map(e => `${e.spotId}|${e.visitDate}`));
  for (const c of (cartRes.data || [])) {
    if (!validKeys.has(`${c.spotId}|${c.visitDate}`)) {
      await db.collection(COLLECTIONS.REMINDER_CART).doc(c._id).remove();
    }
  }

  return ok({
    tripId,
    trip: { _id: trip._id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, spotIds },
    events,
    byDeparture: groupByDeparture(events, nowTs),
    bySpot: groupBySpot(events, nowTs),
    closedSpots,
    // 空状态判定（PAGE-005 异常分支）
    empty: events.length === 0,
    emptyReason: events.length === 0
      ? (closedSpots.length > 0 ? '该行程暂无可提醒的放票时间' : '先选择想去的景点')
      : null,
  });
}

module.exports = {
  buildEvents,
  resolveStatus,
  buttonOf,
  groupByDeparture,
  groupBySpot,
  defaultScrollIndex,
  generate,
};
