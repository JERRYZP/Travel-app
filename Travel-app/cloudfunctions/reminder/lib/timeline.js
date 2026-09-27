/**
 * 时间线生成规则 TIMELINE-RULE-001 ~ 005（产品文档 3.3）
 *
 * 关键：releaseAt 完全由静态规则推算（advanceDays / releaseTime / closedDays），
 * 不依赖抓取。时间线只展示「待开票 / 已开票」这个时间事实，不提供实时放票/预约动作。
 */

const {
  COLLECTIONS, EventSelectStatus, ERRORS, difficultyOf, ok, fail,
} = require('./schema');
const time = require('./time');
const trip = require('./trip');
const cart = require('./cart');
const { normalizeSpots } = trip;
const tripItem = require('./trip-item');

/* ============ 纯函数区 ============ */

/**
 * 被跳过的日期，用哪个词收尾。
 * 白名单景点（北大/清华「仅周末可约」）不是闭馆，说「不可约」才不误导用户。
 *
 * ⚠️ 2026-09-24 起这个 note **页面不再渲染**（底部提示块已按用户口径整块删除，
 *    见 `产品文档.md` 的 `PAGE-005-RULE-002`）。返回值照留：数据契约不缩水、
 *    测试继续钉住措辞，要恢复提示时不必回头改云函数。别顺手把它删了。
 */
function skipReasonOf(rule) {
  return (rule && rule.openDays && rule.openDays.length > 0) ? ' 不可约，已为你跳过' : ' 闭馆，已为你跳过';
}

/** 同理，「行程期间」那行标注也不能一律说闭馆（同样已不再渲染，见上） */
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
 * 时间线顶部的时间状态。它回答的是“票有没有到开售时刻”，不是首页的票务结果状态。
 * 因此已开票项仍然可以加入清单，后续在首页行程项里预约和标记结果。
 */
function releaseStateOf(event, nowTs = time.now()) {
  if (!event || event.reservationRequired === false) {
    return { key: 'NO_RESERVATION', label: '无需预约' };
  }
  const releaseAt = event.releaseAt instanceof Date ? event.releaseAt : new Date(event.releaseAt);
  if (!event.releaseAt || Number.isNaN(releaseAt.getTime()) || releaseAt.getTime() > nowTs.getTime()) {
    return { key: 'NOT_RELEASED', label: '待开票' };
  }
  return { key: 'RELEASED', label: '已开票' };
}

/**
 * TIMELINE-RULE-004 事件按钮态判定（STATE-003）
 *
 * 时间线只维护选择状态：未加入 → SELECTABLE，已暂存 → IN_CART，已提交 → COMMITTED。
 * 放票时刻是否已到只影响顶部展示，不影响按钮能力；预约入口不在这里出现。
 *
 * @param {object} ctx { inCart:boolean, committed:boolean }
 */
function resolveStatus(event, ctx = {}) {
  const { inCart = false, committed = false } = ctx || {};
  if (committed) return EventSelectStatus.COMMITTED;
  if (inCart) return EventSelectStatus.IN_CART;
  return EventSelectStatus.SELECTABLE;
}

/**
 * 按钮态 → 前端文案与可点性（TIMELINE-RULE-004 / STATE-003）
 *
 * ⚠️ **文案口径 2026-09-24 起统一为「清单」**（对齐 UI/V.0.2-0919 的 32.png）：
 *   SELECTABLE → 「加入清单」（免预约项仍为「加入行程」）
 *   IN_CART    → 「已加清单」（免预约项「已加入清单」）
 *   COMMITTED  → 「已加行程」
 *   旧值「+ 添加提醒」「已加入行程」作废。改这里必须同步 `miniprogram/utils/mock.js`
 *   的同名函数——两处漂移过好几次。
 *
 * ⚠️ `enabled` 只表达「点了会怎样」，**不表达「看起来像不像按钮」**：
 *   IN_CART 仍是 true（点它打开清单弹层，是条真动线），但它在 UI 上是**状态胶囊**——
 *   画成按钮还是状态由 `add-trip.wxml` 的 class 决定。别为「看着像状态」把 enabled
 *   改成 false，那会把「点开看清单」这条路一起堵死。
 */
function buttonOf(status, event = {}) {
  const noReservation = event.reservationRequired === false;
  switch (status) {
    case EventSelectStatus.SELECTABLE:
      return noReservation
        ? { text: '加入行程', enabled: true }
        : { text: '加入清单', enabled: true };
    case EventSelectStatus.IN_CART:
      return {
        text: noReservation ? '已加入清单' : '已加清单',
        enabled: true,
        openCart: true,
      };
    case EventSelectStatus.COMMITTED: return { text: '已加行程', enabled: false };
    default: return { text: '', enabled: false };
  }
}

/**
 * TIMELINE-RULE-002 纯预览（2026-09-20）
 *
 * 输入是**一个日期段 + 一批景点**，但它并不总是「新建行程」：
 * 用户从首页某趟进行中的行程带日期与景点进来接着补充时（页面顶部预填的就是那趟行程），
 * 本次的日期段往往与那趟行程重合，提交时按 TRIP-RULE-002 会合并回去而不是新建。
 * 所以这里的计算必须是「输入 = 日期段 × 景点」，**不依赖任何既成行程**——
 * 它既服务于「新建」，也服务于「往已有行程里补」。
 *
 * ⚠️ 仍然**不创建、不改写任何行程**，也**不读 reminder_cart / reminder_tasks**。
 *
 * 为什么除 `committedTripId` 外一律不读状态：旧实现拿 tripId 去查「已在行程 / 已加清单」，
 * 于是换一批日期或景点重新生成时，上一条时间线的状态会被带进来——用户看到「已在行程」的日期
 * 其实属于另一趟行程，或者刚清空的清单仍然显示已加。
 *
 * `committedTripId` 是**唯一**的状态输入，且语义被刻意收窄：它只回答「这条 (景点, 出行日)
 * 是不是已经躺在用户此刻正在编辑的那趟行程里」。用户要往这趟行程补景点，就必须看得见
 * 已经有的项（否则他无法判断该补哪个），故标成 COMMITTED「已加入行程」禁用，避免重复加。
 * 但**身份限定在这一趟**——属于别趟行程的同 (spotId, visitDate) 不标，仍显示为可选；
 * 真要重复加，由 cart.add 按 (userId, spotId, visitDate) 跨行程查重兜底。
 * 未传（新建行程、或不是从行程进来的）→ 与旧口径完全一致：committed 恒 false。
 *
 * 行程的创建与合并判定挪到 cart.commit（TRIP-RULE-002 合并规则本身不变）。
 * 老口径 adjustTripId（在当前行程上重新生成＝替换景点段）**废止**。
 *
 * @param {Array<{spotId,startDate,endDate}>} segments 每个景点自己的日期段
 * @param {string} committedTripId 仅当「从某趟行程进来接着补」时传，用于标出已在行程的项
 */
async function preview(db, userId, { startDate, endDate, spotIds = [], segments = null, committedTripId = '' }) {
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

  /**
   * ⚠️ 预览只读两样东西，各有各的界线，不能混为一谈：
   *
   * ① **当前暂存清单**（总是读）= 用户正在这一页做的、还没提交的工作。不反映它，
   *    用户点了「加入清单」按钮却看不到任何变化（按钮仍写「添加提醒」，再点一次提示
   *    「已经在清单里啦」），页面看起来就是坏的。
   *
   * ② **`committedTripId` 那一趟行程的 trip_items**（仅从行程进来时读）= 用户此刻
   *    正在编辑的那趟行程里已经有的项。只读这一趟，绝不读别趟：读别趟就会把历史状态
   *    带进预览——用户看到一条标着「已在行程」的日期，其实属于另一趟行程，这正是本次
   *    要修的问题。所以**没有**回退到「扫全部行程」的写法，传空就是恒 false。
   *
   * 去重兜底仍在 cart.add（跨行程按 (spotId, visitDate) 查 trip_items）——进了本趟的
   * 项在预览里禁选，属于别趟的则在预览里可选，真重复加时被它拦下。
   */
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: cart.cartTripIdOf(null) }).get();
  const cartKeys = new Set((cartRes.data || []).map(c => `${c.spotId}|${c.visitDate}`));

  const committedKeys = new Set();
  if (committedTripId) {
    const itemRes = await db.collection(COLLECTIONS.TRIP_ITEMS)
      .where({ userId, tripId: committedTripId }).get();
    (itemRes.data || []).forEach(it => committedKeys.add(`${it.spotId}|${it.visitDate}`));
  }

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
      /* inCart = 当前暂存清单；committed = 仅限 committedTripId 那一趟行程 */
      const key = `${event.spotId}|${event.visitDate}`;
      const status = resolveStatus(event, {
        inCart: cartKeys.has(key),
        committed: committedKeys.has(key),
      });
      const releaseState = releaseStateOf(event, nowTs);
      events.push({
        ...event,
        releaseState: releaseState.key,
        releaseStateLabel: releaseState.label,
        status,
        button: buttonOf(status, event),
        stale: false,
      });
    }
  }

  return ok({
    events,
    byDeparture: groupByDeparture(events, nowTs, startDate),
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
function groupByDeparture(events, nowTs = time.now(), tripStartDate = '') {
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
        /* 第几天必须相对用户选的行程首日，而不是分组里第一条实际有放票的日期。
           例如首日闭馆、次日起才有事件时，次日仍应显示「第2天」。 */
        dayLabel: tripStartDate ? `【第${time.diffDays(tripStartDate, visitDate) + 1}天】` : '',
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
 * 现有清单项与行程项实现——事件本身不落库，每次实时重算，
 * 因此不存在陈旧事件残留问题；被移除景点的清单项在此顺带清理。
 */
async function generate(db, userId, tripId) {
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

  const [spotsRes, rulesRes, cartRes, itemsRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: db.command.in(spotIds) }).get(),
    db.collection(COLLECTIONS.REMINDER_CART).where({ userId, tripId }).get(),
    db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId, tripId }).get(),
  ]);

  const ruleMap = {};
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
  const cartKeys = new Set((cartRes.data || []).map(c => `${c.spotId}|${c.visitDate}`));
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
        committed: itemKeys.has(key),
      });
      const releaseState = releaseStateOf(event, nowTs);

      events.push({
        ...event,
        releaseState: releaseState.key,
        releaseStateLabel: releaseState.label,
        status,
        button: buttonOf(status, event),
        stale: false,
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
    byDeparture: groupByDeparture(events, nowTs, trip.startDate),
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
  releaseStateOf,
  resolveStatus,
  buttonOf,
  groupByDeparture,
  groupBySpot,
  defaultScrollIndex,
  generate,
  preview,
};
