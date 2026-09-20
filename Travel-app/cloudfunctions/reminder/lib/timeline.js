/**
 * 时间线生成规则 TIMELINE-RULE-001 ~ 005（产品文档 3.3）
 *
 * 关键：releaseAt 完全由静态规则推算（advanceDays / releaseTime / closedDays），
 * 不依赖抓取。抓取只影响「已放票之后是否约满」这一个分支（ENUM-005）。
 */

const {
  COLLECTIONS, EventSelectStatus, ReleaseStatus, ReminderBackendStatus,
  ERRORS, difficultyOf, ok, fail,
} = require('./schema');
const time = require('./time');
const trip = require('./trip');
const { normalizeSpots } = trip;
const tripItem = require('./trip-item');

/* ============ 纯函数区 ============ */

/**
 * 被跳过的日期，用哪个词收尾。
 * 白名单景点（北大/清华「仅周末可约」）不是闭馆，说「不可约」才不误导用户。
 */
function skipReasonOf(rule) {
  return (rule && rule.openDays && rule.openDays.length > 0) ? ' 不可约，已为你跳过' : ' 闭馆，已为你跳过';
}

/** 同理，「行程期间」那行标注也不能一律说闭馆 */
function closedSpotNoteOf(rule) {
  return (rule && rule.openDays && rule.openDays.length > 0) ? '行程期间不可约' : '行程期间闭馆';
}

/**
 * TIMELINE-RULE-001 + 005 为单个景点生成事件（交叉积）
 *
 * 景点 × **该景点自己的日期段**内每个非闭馆日 = N 个事件。
 * visitDate = 该日；releaseAt = (visitDate − advanceDays) 当日 releaseTime（GMT+8）
 *
 * 注意第三参数是「段」而不是整个行程：2026-09-14 起行程支持合并（TRIP-RULE-002），
 * 但每个景点保留自己被选中时的日期段（`trip.spots`），所以这里按段生成，
 * 不会把时间线撑成「行程整段 × 全部景点」的交叉积。
 *
 * 不替用户推断出行日——用户通过 PAGE-005/006 的 Tab 选择实际要哪天的提醒。
 *
 * @param {{startDate:string,endDate:string}} seg 该景点的日期段
 * @returns {Array} 空数组表示该景点在段内每天都不可约（TIMELINE-RULE-005）
 */
function buildEvents(spot, rule, seg) {
  const base = {
    spotId: spot.spotId,
    spotName: spot.name,
    reservationRequired: spot.reservationRequired !== false,
    weak: tripItem.isWeakSpot(spot),
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
  };

  // 免预约景点不生成放票事件，但仍为每个行程日生成可加入行程的候选项。
  if (spot.reservationRequired === false) {
    return time.dateRange(seg.startDate, seg.endDate).map(visitDate => ({
      ...base,
      difficulty: null,
      visitDate,
      releaseAt: null,
      releaseDateStr: '',
      releaseTimeStr: '',
      visitDateLabel: time.formatMonthDayWeek(visitDate),
      advanceDays: null,
      remindOnDefault: false,
    }));
  }

  if (!rule || !rule.advanceDays || (!rule.releaseTime && !(rule.releaseTimes || []).length)) return [];

  const events = [];
  for (const visitDate of time.dateRange(seg.startDate, seg.endDate)) {
    // TIMELINE-RULE-005 按日判定：该日不可约则跳过这一天，其余日期照常生成
    // 判定统一走 time.isOpenOn —— openDays 白名单优先，用于北大/清华「仅周末可约」
    if (!time.isOpenOn(rule, time.dayNameOf(visitDate))) continue;

    const releaseDate = time.addDays(visitDate, -rule.advanceDays);
    events.push({
      ...base,
      difficulty: difficultyOf(spot.difficultyScore),
      visitDate,
      releaseAt: time.parseBeijing(releaseDate, rule.releaseTime),
      // 展示用（PAGE-005 事件卡左轴与文案）
      releaseDateStr: releaseDate,
      releaseTimeStr: rule.releaseTime,
      visitDateLabel: time.formatMonthDayWeek(visitDate),
      advanceDays: rule.advanceDays,
      remindOnDefault: tripItem.defaultRemindOn(spot),
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
  const { inCart = false, task = null, releaseStatus = null, committed = false } = ctx || {};

  // 免预约项没有放票时刻，只区分未加入、清单中、已加入行程。
  if (event.reservationRequired === false) {
    if (committed) return EventSelectStatus.COMMITTED;
    if (inCart) return EventSelectStatus.IN_CART;
    return EventSelectStatus.SELECTABLE;
  }

  if (event.releaseAt.getTime() > nowTs.getTime()) {
    if (task) {
      return task.backendStatus === ReminderBackendStatus.WAITING
        ? EventSelectStatus.WAITING
        : EventSelectStatus.REMINDERED;
    }
    if (committed) return EventSelectStatus.COMMITTED;
    if (inCart) return EventSelectStatus.IN_CART;
    return EventSelectStatus.SELECTABLE;
  }

  // 已过放票时刻：脱离清单体系，看实时可约状态
  if (releaseStatus === ReleaseStatus.FULL) return EventSelectStatus.FULL;
  return EventSelectStatus.BOOKABLE;
}

/** 按钮态 → 前端按钮文案与可点性 */
function buttonOf(status, event = {}) {
  const noReservation = event.reservationRequired === false;
  switch (status) {
    case EventSelectStatus.SELECTABLE:
      return noReservation
        ? { text: '加入行程', enabled: true }
        : { text: '+ 添加提醒', enabled: true };
    case EventSelectStatus.IN_CART:
      return {
        text: noReservation ? '已加入清单' : '已加清单',
        enabled: true,
        openCart: true,
      };
    case EventSelectStatus.WAITING: return { text: '待提醒', enabled: false };
    case EventSelectStatus.REMINDERED: return { text: '已提醒', enabled: false };
    case EventSelectStatus.BOOKABLE: return { text: '立即预约', enabled: true, booking: true };
    case EventSelectStatus.FULL: return { text: '已约满', enabled: false };
    case EventSelectStatus.COMMITTED: return { text: '已加入行程', enabled: false };
    default: return { text: '', enabled: false };
  }
}

/**
 * TIMELINE-RULE-002 纯预览（2026-09-20）
 *
 * 「生成专属放票时间线」按**当前所选日期段与景点**独立计算，**不创建、不改写任何行程**，
 * 也**不读任何已落库的状态**（trip_items / reminder_cart / reminder_tasks）。
 *
 * 为什么必须不读状态：旧实现拿 tripId 去查「已在行程 / 已加清单」，于是换一批日期或景点
 * 重新生成时，上一条时间线的状态会被带进来——用户看到「已在行程」的日期其实属于另一趟行程，
 * 或者刚清空的清单仍然显示已加。纯预览的语义是「这只是个预览」，历史状态一律不带入。
 *
 * 代价（已确认接受）：预览里看不到「已在行程」。同一 (spotId, visitDate) 重复加入由
 * cart.add 的去重拦截（它按 (userId, spotId, visitDate) 跨行程查）。
 *
 * 行程的创建与合并判定挪到 cart.commit（TRIP-RULE-002 合并规则本身不变）。
 * 老口径 adjustTripId（在当前行程上重新生成＝替换景点段）**废止**。
 *
 * @param {Array<{spotId,startDate,endDate}>} segments 每个景点自己的日期段
 */
async function preview(db, userId, { startDate, endDate, spotIds = [], segments = null }) {
  if (!trip.validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);

  const segs = (Array.isArray(segments) && segments.length > 0)
    ? segments.filter(sg => sg && sg.spotId && sg.startDate && sg.endDate)
    : trip.makeSpotSegments(spotIds, startDate, endDate);

  if (segs.length === 0) {
    return ok({
      events: [], byDeparture: [], bySpot: [], closedSpots: [], closedDaySkips: [],
      empty: true, emptyReason: '先选择想去的景点',
    });
  }

  const ids = segs.map(s => s.spotId);
  const segMap = {};
  segs.forEach(s => { segMap[s.spotId] = s; });

  const [spotsRes, rulesRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId: db.command.in(ids) }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: db.command.in(ids) }).get(),
  ]);
  const ruleMap = {};
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });

  const nowTs = time.now();
  const events = [];
  const closedSpots = [];
  const closedDaySkips = [];

  for (const spot of (spotsRes.data || [])) {
    const seg = segMap[spot.spotId];
    if (!seg) continue;
    const rule = ruleMap[spot.spotId];
    const built = buildEvents(spot, rule, seg);
    if (built.length === 0) {
      if (!rule || !rule.advanceDays || !rule.releaseTime) {
        closedSpots.push({ spotId: spot.spotId, spotName: spot.name, note: '无固定放票时刻，暂不生成提醒' });
      } else {
        closedSpots.push({ spotId: spot.spotId, spotName: spot.name, note: closedSpotNoteOf(rule) });
      }
      continue;
    }
    const skipped = rule
      ? time.dateRange(seg.startDate, seg.endDate).filter(d => !time.isOpenOn(rule, time.dayNameOf(d)))
      : [];
    if (skipped.length > 0) {
      closedDaySkips.push({
        spotId: spot.spotId,
        spotName: spot.name,
        note: skipped.map(d => time.formatMonthDayWeek(d)).join('、') + skipReasonOf(rule),
      });
    }
    for (const event of built) {
      /* ⚠️ 上下文一律为空：预览不知道也不关心任何已落库状态。
         这就是「历史行程与已提交项的状态不带入预览」的落点。 */
      const status = resolveStatus(event, {
        inCart: false, task: null, committed: false, releaseStatus: null,
      }, nowTs);
      events.push({
        ...event,
        status,
        button: buttonOf(status, event),
        stale: false,
      });
    }
  }

  return ok({
    events,
    byDeparture: groupByDeparture(events, nowTs),
    bySpot: groupBySpot(events, nowTs),
    closedSpots,
    closedDaySkips,
    empty: events.length === 0,
    emptyReason: events.length === 0
      ? (closedSpots.length > 0 ? '该日期段暂无可提醒的放票时间' : '先选择想去的景点')
      : null,
  });
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
      const sorted = list.sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
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
    const sorted = list.sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
    return {
      key: spotId,
      label: sorted[0].spotName,
      events: sorted,
      count: sorted.length,
      scrollIndex: defaultScrollIndex(sorted, nowTs),
    };
  }).sort((a, b) => (a.events[0].releaseAt ? a.events[0].releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.events[0].releaseAt ? b.events[0].releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
}

/**
 * UI-006 默认滚动位置 = 最近的未提醒事件在扁平序列中的下标
 */
function defaultScrollIndex(events, nowTs = time.now()) {
  const sorted = [...events].sort((a, b) => (a.releaseAt ? a.releaseAt.getTime() : Number.MAX_SAFE_INTEGER) - (b.releaseAt ? b.releaseAt.getTime() : Number.MAX_SAFE_INTEGER));
  const idx = sorted.findIndex(e => e.releaseAt && e.releaseAt.getTime() > nowTs.getTime());
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

  /* TRIP-RULE-002 合并后每个景点有自己的日期段；老数据（只有 spotIds）按行程整段回退 */
  const segs = normalizeSpots(trip);
  if (segs.length === 0) {
    return ok({
      tripId, events: [], byDeparture: [], bySpot: [], closedSpots: [],
      empty: true, emptyReason: '先选择想去的景点',
    });

  }
  const spotIds = segs.map(s => s.spotId);
  const segMap = {};
  segs.forEach(s => { segMap[s.spotId] = s; });

  const [spotsRes, rulesRes, cartRes, tasksRes, itemsRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.REMINDER_CART).where({ userId, tripId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId, tripId }).get(),
    db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId, tripId }).get(),
  ]);

  const ruleMap = {};
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
  const cartKeys = new Set((cartRes.data || []).map(c => `${c.spotId}|${c.visitDate}`));
  const taskMap = {};
  (tasksRes.data || []).forEach(t => { taskMap[`${t.spotId}|${t.visitDate}`] = t; });
  const itemKeys = new Set((itemsRes.data || []).map(i => `${i.spotId}|${i.visitDate}`));

  const nowTs = time.now();
  const events = [];
  const closedSpots = [];
  const closedDaySkips = [];

  for (const spot of (spotsRes.data || [])) {
    const seg = segMap[spot.spotId];
    if (!seg) continue;
    const rule = ruleMap[spot.spotId];
    const built = buildEvents(spot, rule, seg);
    if (built.length === 0) {
      // 区分两种「无事件」：规则不全（无放票时刻，如环球影城购票型）≠ 段内闭馆
      if (!rule || !rule.advanceDays || !rule.releaseTime) {
        closedSpots.push({ spotId: spot.spotId, spotName: spot.name, note: '无固定放票时刻，暂不生成提醒' });
      } else {
        // TIMELINE-RULE-005：段内每天都不可约 → 想去列表该行标注（闭馆 / 仅周末可约但段内不含周末）
        closedSpots.push({ spotId: spot.spotId, spotName: spot.name, note: closedSpotNoteOf(rule) });
      }
      continue;
    }
    // TIMELINE-RULE-005 补充：该景点在段内非每天不可约，但有若干天被跳过 → 记录这些日期供前端提示
    // 与 buildEvents 共用 time.isOpenOn，避免「生成事件用一套、提示用另一套」的口径漂移
    const skipped = rule
      ? time.dateRange(seg.startDate, seg.endDate).filter(d => !time.isOpenOn(rule, time.dayNameOf(d)))
      : [];
    if (skipped.length > 0) {
      closedDaySkips.push({
        spotId: spot.spotId,
        spotName: spot.name,
        // 北大/清华这类白名单景点：不是「闭馆」而是「该日不可约」，文案分开
        note: skipped.map(d => time.formatMonthDayWeek(d)).join('、') + skipReasonOf(rule),
      });
    }
    for (const event of built) {
      const key = `${event.spotId}|${event.visitDate}`;
      const status = resolveStatus(event, {
        inCart: cartKeys.has(key),
        task: taskMap[key] || null,
        committed: itemKeys.has(key),
        releaseStatus: spotStatusMap[event.spotId] || null,
      }, nowTs);

      events.push({
        ...event,
        status,
        button: buttonOf(status, event),
        // scraper 未上线：已放票事件的「已约满」判定缺失，标记 stale 供前端提示
        stale: !!event.releaseAt && event.releaseAt.getTime() <= nowTs.getTime() && !spotStatusMap[event.spotId],
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
    trip: { _id: trip._id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, spotIds, spots: segs },
    events,
    byDeparture: groupByDeparture(events, nowTs),
    bySpot: groupBySpot(events, nowTs),
    closedSpots,
    // 周一闭馆等：该景点部分日期被跳过（TIMELINE-RULE-005 补充），供前端提示「已为你跳过」
    closedDaySkips,
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
  preview,
};
