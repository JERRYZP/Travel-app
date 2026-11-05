/**
 * 行程清单规则（CART-RULE，2026-09-16 行程化 P1；2026-09-20 改为「提交前暂存区」）
 *
 * 清单是**提交至行程的前一个步骤**：
 *   - 没提交之前，它就暂存在清单页里（跟着用户走，下次进来还在）；
 *   - 提交（cart.commit）之后立即清空。
 *
 * ⚠️ 2026-09-20 起「生成预约时间线」是**纯预览**，不加行程、不落库。
 * 所以用户点「加入清单」时**还没有行程**——清单行统一挂占位 tripId
 * （PENDING_CART_TRIP_ID），提交时才由 trip.create 建/合并行程并整批改挂。
 *
 * ⚠️ 2026-11-02 起景点页/详情/分享/首页“约其他日”的快捷入口**不走本清单写路径**：
 * 它们调用 planQuickDates + task.submitQuick 一次性提交，新日期不会出现在主流程清单里。
 * 本文件的 planDates/addDates/add 只服务主流程和旧客户端兼容。
 *
 * 清单同时承载需预约项和免预约项：
 * - 需预约项：releaseAt 必有，remindOn 可勾选；
 * - 免预约项：releaseAt=null，remindOn 恒 false；
 * - 需预约但无固定放票时刻（如环球影城）：releaseAt=null，remindOn 恒 false，仅进行程；
 * - 弱提醒景点默认不勾提醒，用户可在清单里手动改。
 */

const { COLLECTIONS, ERRORS, PENDING_CART_TRIP_ID, ok, fail, difficultyOf } = require('./schema');
const time = require('./time');
const item = require('./item');
const releaseSchedule = require('./release-schedule');
const tripItem = require('./trip-item');
const membership = require('./membership');
const datePlan = require('./date-plan');


/**
 * 清单归属的 tripId 归一化。
 *
 * 不传 = 操作「当前暂存清单」。纯预览化之后前端没有真实 tripId 可传，
 * 但老调用方（以及已提交过行程的老数据）仍会传真实 tripId —— 两种都要能用，
 * 否则升级瞬间正在填写中的清单会凭空消失。
 */
function cartTripIdOf(tripId) {
  return tripId || PENDING_CART_TRIP_ID;
}

function supportsMultiReleaseOf(payload) {
  return !!(payload && payload.supportsMultiRelease === true);
}

/** 清单是否属于暂存区（未提交） */
function isPending(tripId) {
  return !tripId || tripId === PENDING_CART_TRIP_ID;
}

/** CART-RULE-002 聚合展示：项数、景点数、将设提醒数 */
function summarize(items) {
  const spotCount = new Set(items.map(i => i.spotId)).size;
  const reminderCount = items.filter(i => i.remindOn === true).length;
  const reminderTaskCount = items.reduce((sum, row) => {
    if (row.remindOn !== true) return sum;
    const count = Number(row.releaseTaskCount);
    return sum + (Number.isFinite(count) ? Math.max(0, count) : 1);
  }, 0);
  return {
    count: items.length,
    spotCount,
    reminderCount,
    reminderTaskCount,
    noReminderCount: items.length - reminderCount,
    text: reminderCount > 0
      ? `已选 ${items.length} 项，其中 ${reminderCount} 个将设提醒`
      : `已选 ${items.length} 项，均无需提醒`,
  };
}

function cartVersionOf(items) {
  const rows = items || [];
  let latest = 0;
  rows.forEach(row => {
    const ms = new Date(row && (row.updatedAt || row.createdAt) || 0).getTime();
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  });
  return `cart:${rows.length}:${latest}`;
}

/** 清单分组标题用「M月D日 · 周X」。 */
function formatVisitDateLabel(visitDate) {
  return time.formatMonthDayWeek(visitDate).replace(' (', ' · ').replace(')', '');
}

/** 放票副行用「MM月DD日 HH:mm 放票」，月/日保留前导零。 */
function formatReleaseDateLabel(releaseAt) {
  const p = time.beijingParts(new Date(releaseAt));
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${mm}月${dd}日`;
}

/**
 * 清单按**出行日**分组，而不是按放票日。
 *
 * 用户在这一页管理的是“哪天去哪些地方”；放票时间只作为该行程项的属性。
 * 免预约项与需预约项共用同一个出行日分组，不再单列“无需预约”块。
 */
function groupByVisitDate(items) {
  const dates = [...new Set(items.map(i => i.visitDate).filter(Boolean))].sort();
  const firstDate = dates[0];
  return dates.map(visitDate => ({
    key: visitDate,
    label: formatVisitDateLabel(visitDate),
    dayLabel: firstDate ? `【第${time.diffDays(firstDate, visitDate) + 1}天】` : '',
    items: items
      .filter(i => i.visitDate === visitDate)
      .sort((a, b) => {
        const af = a.reservationRequired === false ? 1 : 0;
        const bf = b.reservationRequired === false ? 1 : 0;
        if (af !== bf) return af - bf;
        const at = a.releaseAt ? new Date(a.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.releaseAt ? new Date(b.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (at !== bt) return at - bt;
        return String(a.spotName || '').localeCompare(String(b.spotName || ''), 'zh-CN');
      }),
  }));
}

function validVisitDates(values) {
  const dates = datePlan.normalizeVisitDates(values);
  if (!dates.length || dates.length > 31) return [];
  return dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? dates : [];
}

async function loadDatePlanContext(db, userId, { spotId, visitDates, supportsMultiRelease }) {
  const dates = validVisitDates(visitDates);
  if (!spotId || !dates.length) return fail(ERRORS.BAD_PARAM);

  const [spotRes, ruleRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId }).get(),
  ]);
  const spot = (spotRes.data || [])[0];
  if (!spot) return fail(ERRORS.SPOT_NOT_FOUND);
  const rule = (ruleRes.data || [])[0] || null;

  const [cartRes, itemRes] = await Promise.all([
    db.collection(COLLECTIONS.REMINDER_CART).where({
      userId,
      spotId,
      visitDate: db.command.in(dates),
    }).get(),
    db.collection(COLLECTIONS.TRIP_ITEMS).where({
      userId,
      spotId,
      visitDate: db.command.in(dates),
    }).get(),
  ]);
  const cartDates = new Set((cartRes.data || []).map(row => row.visitDate));
  const tripDates = new Set((itemRes.data || []).map(row => row.visitDate));
  const plan = datePlan.build({
    spot,
    rule,
    visitDates: dates,
    nowTs: time.now(),
    cartDates,
    tripDates,
    supportsMultiRelease: supportsMultiRelease === true,
  });
  return {
    spot,
    rule,
    dates,
    plan,
    cartRows: cartRes.data || [],
    tripRows: itemRes.data || [],
  };
}

/** 只读预检：一次返回所有日期的提醒资格、重复项和汇总。 */
async function planDates(db, userId, payload) {
  const context = await loadDatePlanContext(db, userId, payload || {});
  if (context.success === false) return context;
  return ok({
    spotId: context.spot.spotId,
    spotName: context.spot.name,
    dates: context.plan.dates,
    summary: context.plan.summary,
  });
}

/**
 * 景点页快捷设提醒的只读预检。
 *
 * 与 cart.planDates 不同：已有暂存清单行不视为最终冲突，而是由 quickCommit
 * 在同一个提交中直接消费。这样景点快捷入口不需要先把数据写进主流程清单。
 * 真正已落成 trip_items 的日期仍必须拦截。
 */
async function planQuickDates(db, userId, payload) {
  const context = await loadDatePlanContext(db, userId, payload || {});
  if (context.success === false) return context;

  const base = datePlan.build({
    spot: context.spot,
    rule: context.rule,
    visitDates: context.dates,
    nowTs: time.now(),
    cartDates: new Set(),
    tripDates: new Set(),
    supportsMultiRelease: supportsMultiReleaseOf(payload),
  });
  const tripDates = new Set((context.tripRows || []).map(row => row.visitDate));
  const cartByDate = new Map();
  const legacyCartDates = new Set();
  (context.cartRows || []).forEach(row => {
    if (row.tripId && row.tripId !== PENDING_CART_TRIP_ID) {
      legacyCartDates.add(row.visitDate);
    } else if (!cartByDate.has(row.visitDate)) {
      cartByDate.set(row.visitDate, row);
    }
  });
  const dates = base.dates.map(row => {
    const resumeCart = cartByDate.get(row.visitDate);
    if (tripDates.has(row.visitDate)) {
      return {
        ...row,
        status: datePlan.DATE_PLAN_STATUS.IN_TRIP,
        reason: datePlan.DATE_PLAN_REASON.IN_TRIP,
        addable: false,
        reminderAllowed: false,
      };
    }
    if (legacyCartDates.has(row.visitDate)) {
      return {
        ...row,
        status: datePlan.DATE_PLAN_STATUS.IN_CART,
        reason: datePlan.DATE_PLAN_REASON.IN_CART,
        addable: false,
        reminderAllowed: false,
      };
    }
    return {
      ...row,
      resumeCartId: resumeCart ? resumeCart._id : '',
      resumeCart: !!resumeCart,
    };
  });
  const summary = datePlan.summarize(dates);
  return ok({
    spotId: context.spot.spotId,
    spotName: context.spot.name,
    reservationRequired: context.spot.reservationRequired !== false,
    dates,
    summary,
    resumeCartCount: dates.filter(row => !!row.resumeCartId).length,
  });
}

/**
 * 景点页多日期原子入清单。
 *
 * 先完整查重和资格判断，再只写 addable 项；任何写入失败都会清理本批新增，
 * 不再让客户端逐条 cart.add 后遇到重复项再猜哪些成功了。
 */
async function addDates(db, userId, payload) {
  const context = await loadDatePlanContext(db, userId, payload || {});
  if (context.success === false) return context;
  const { spot, plan } = context;
  const addable = plan.dates.filter(row => row.addable);
  const added = [];
  const transaction = await db.startTransaction();
  try {
    for (const row of addable) {
      const res = await transaction.collection(COLLECTIONS.REMINDER_CART).add({
        data: {
          userId,
          tripId: PENDING_CART_TRIP_ID,
          spotId: spot.spotId,
          visitDate: row.visitDate,
          releaseAt: row.releaseAt,
          remindOn: row.reminderAllowed,
          releaseTaskCount: row.reminderAllowed
            ? Math.max(0, Number(row.reminderTaskCount) || 0)
            : 0,
          reservationRequired: spot.reservationRequired !== false,
          createdAt: time.now(),
        },
      });
      added.push({
        cartId: res._id,
        visitDate: row.visitDate,
        releaseAt: row.releaseAt,
        releaseTaskCount: row.reminderAllowed
          ? Math.max(0, Number(row.reminderTaskCount) || 0)
          : 0,
        reservationRequired: spot.reservationRequired !== false,
        remindOn: row.reminderAllowed,
        status: row.status,
        reason: row.reason,
      });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  const current = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: PENDING_CART_TRIP_ID }).get();
  const currentItems = current.data || [];

  return ok({
    spotId: spot.spotId,
    spotName: spot.name,
    dates: plan.dates,
    summary: plan.summary,
    items: added,
    addedCartIds: added.map(row => row.cartId),
    added: added.length,
    addedReminders: added.filter(row => row.remindOn).length,
    addedTripOnly: added.filter(row => !row.remindOn).length,
    cartSummary: summarize(currentItems),
    cartVersion: cartVersionOf(currentItems),
  });
}

/** CART-RULE-001 加入清单（单条） */
async function add(db, userId, {
  tripId, spotId, visitDate, releaseAt, remindOn, supportsMultiRelease,
}) {
  if (!spotId || !visitDate) return fail(ERRORS.BAD_PARAM);
  const targetTripId = cartTripIdOf(tripId);
  const nowTs = time.now();

  const [spotRes, ruleRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).where({ spotId }).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId }).get(),
  ]);
  const spot = (spotRes.data || [])[0];
  if (!spot) return fail(ERRORS.SPOT_NOT_FOUND);
  const rule = (ruleRes.data || [])[0] || null;
  const reservationRequired = spot.reservationRequired !== false;

  let resolvedReleaseAt = null;
  let resolvedRemindOn = false;
  let taskSlots = [];
  let remindBlockedReason = '';
  if (reservationRequired) {
    /* ⚠️ **放票时刻服务端自己推**，不信任调用方传的那个（2026-09-24）：
       它由 `visitDate − advanceDays` 在 `lib/item.js` 里唯一推出，调用方再传一遍
       就是第二套口径，迟早对不上。

       ⚠️ 更要紧的是：**「约其他日」这条动线根本没有 releaseAt 可传**。
       它拿到的是用户从日历里选的一个日期（`date-picker-sheet` 只回 visitDate），
       以前这里直接 `!releaseAt → BAD_PARAM`，用户点「确定」只会看到
       「请检查输入」——挽回线点得开、走不通。别把这道校验改回去：
       用户要的是「换一天再抢」，页面不该为了凑一个参数去重算放票时刻。 */
    const releaseSlots = releaseSchedule.slotsForRequest(
      spot,
      rule,
      visitDate,
      supportsMultiRelease === true
    );
    taskSlots = releaseSchedule.taskSlotsForRequest(
      spot,
      rule,
      visitDate,
      nowTs,
      supportsMultiRelease === true
    );
    if (releaseSlots.length > 0) {
      resolvedReleaseAt = taskSlots.length > 0
        ? taskSlots[0].releaseAt
        : releaseSlots[releaseSlots.length - 1].releaseAt;
      /* 已过放票时刻的项只能“仅加行程”：此时提醒已经不可能送达，
         不能再让用户在清单里切换成一个最终必然失败的开关。 */
      const releasePassed = taskSlots.length === 0;
      resolvedRemindOn = releasePassed
        ? false
        : (typeof remindOn === 'boolean' ? remindOn : tripItem.defaultRemindOn(spot));
      if (releasePassed) remindBlockedReason = datePlan.DATE_PLAN_REASON.RELEASE_PASSED;
    }
    /* derived=null = 需预约但没有固定放票时刻（如环球影城）。
       这类景点仍可加入行程管理安排，只是永远不设提醒。 */
    if (!resolvedReleaseAt) remindBlockedReason = datePlan.DATE_PLAN_REASON.NO_FIXED_RELEASE;
  } else {
    remindBlockedReason = datePlan.DATE_PLAN_REASON.NO_RESERVATION;
  }

  // 逻辑唯一约束 (userId, tripId, spotId, visitDate) —— 在暂存区里就是 (userId, spotId, visitDate)
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: targetTripId }).get();
  const currentItems = cartRes.data || [];
  if (currentItems.some(row => row.spotId === spotId && row.visitDate === visitDate)) {
    return fail(ERRORS.REMINDER_EXISTS);
  }

  /* 已落为行程项的不再进入清单 —— 按 (userId, spotId, visitDate) 跨行程查。
     纯预览态下预览本身看不到「已在行程」（预览不查已落库数据），
     所以这道去重必须在这里拦住，否则用户会重复提交同一天同一景点。 */
  const itemRes = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, spotId, visitDate }).get();
  if ((itemRes.data || []).length > 0) return fail(ERRORS.REMINDER_EXISTS);

  const row = {
    userId,
    tripId: targetTripId,
    spotId,
    visitDate,
    releaseAt: resolvedReleaseAt,
    remindOn: resolvedRemindOn,
    releaseTaskCount: resolvedRemindOn ? taskSlots.length : 0,
    reservationRequired,
    createdAt: nowTs,
  };
  const res = await db.collection(COLLECTIONS.REMINDER_CART).add({ data: row });
  const nextItems = currentItems.concat(row);
  return ok({
    cartId: res._id,
    spotId,
    visitDate,
    releaseAt: resolvedReleaseAt,
    releaseTaskCount: resolvedRemindOn ? taskSlots.length : 0,
    reservationRequired,
    remindOn: resolvedRemindOn,
    remindBlockedReason,
    cartSummary: summarize(nextItems),
    cartVersion: cartVersionOf(nextItems),
  });
}

/** CART-RULE-004 批量加入：仅作用于当前选中的 Tab */
async function addBatch(db, userId, tripId, events, scope, scopeKey, options = {}) {
  const { EventSelectStatus } = require('./schema');
  if (!scope || !scopeKey) return fail(ERRORS.BAD_PARAM);
  const inScope = scope === 'departure'
    ? (e) => e.visitDate === scopeKey
    : (e) => e.spotId === scopeKey;

  const selectable = events
    .filter(e => e.status === EventSelectStatus.SELECTABLE && inScope(e))
    .filter((event, index, list) => list.findIndex(other =>
      other.spotId === event.spotId && other.visitDate === event.visitDate) === index);
  let added = 0;
  let addedReminders = 0;
  let addedTripOnly = 0;
  const skipped = [];
  const affectedKeys = [];
  const targetTripId = cartTripIdOf(tripId);
  if (selectable.length === 0) {
    const current = await db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId, tripId: targetTripId }).get();
    const currentItems = current.data || [];
    return ok({
      added,
      addedReminders,
      addedTripOnly,
      skipped,
      total: 0,
      scope,
      scopeKey,
      affectedKeys,
      cartSummary: summarize(currentItems),
      cartVersion: cartVersionOf(currentItems),
    });
  }

  const spotIds = [...new Set(selectable.map(event => event.spotId).filter(Boolean))];
  const visitDates = [...new Set(selectable.map(event => event.visitDate).filter(Boolean))];
  const [{ spotMap, ruleMap }, cartRes, itemRes] = await Promise.all([
    item.loadSpotContext(db, spotIds),
    db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId, tripId: targetTripId }).get(),
    db.collection(COLLECTIONS.TRIP_ITEMS)
      .where({
        userId,
        spotId: db.command.in(spotIds),
        visitDate: db.command.in(visitDates),
      })
      .get(),
  ]);
  const currentItems = cartRes.data || [];
  const cartKeys = new Set(currentItems.map(row => `${row.spotId}|${row.visitDate}`));
  const itemKeys = new Set((itemRes.data || []).map(row => `${row.spotId}|${row.visitDate}`));
  const nowTs = time.now();
  const toWrite = [];

  selectable.forEach(event => {
    const key = `${event.spotId}|${event.visitDate}`;
    const spot = spotMap[event.spotId];
    if (!spot) {
      skipped.push({ spotId: event.spotId, visitDate: event.visitDate, reason: ERRORS.SPOT_NOT_FOUND.message });
      return;
    }
    if (cartKeys.has(key) || itemKeys.has(key)) {
      skipped.push({ spotId: event.spotId, visitDate: event.visitDate, reason: ERRORS.REMINDER_EXISTS.message });
      return;
    }
    const rule = ruleMap[event.spotId] || null;
    const reservationRequired = spot.reservationRequired !== false;
    let releaseAt = null;
    let releaseTaskCount = 0;
    let remindOn = false;
    if (reservationRequired) {
      const releaseSlots = releaseSchedule.slotsForRequest(
        spot,
        rule,
        event.visitDate,
        options.supportsMultiRelease === true
      );
      const taskSlots = releaseSchedule.taskSlotsForRequest(
        spot,
        rule,
        event.visitDate,
        nowTs,
        options.supportsMultiRelease === true
      );
      releaseAt = taskSlots.length > 0
        ? taskSlots[0].releaseAt
        : (releaseSlots.length ? releaseSlots[releaseSlots.length - 1].releaseAt : null);
      const releasePassed = releaseSlots.length > 0 && taskSlots.length === 0;
      releaseTaskCount = taskSlots.length;
      remindOn = taskSlots.length > 0
        && !releasePassed
        && (typeof event.remindOnDefault === 'boolean'
          ? event.remindOnDefault
          : tripItem.defaultRemindOn(spot));
    }
    toWrite.push({
      userId,
      tripId: targetTripId,
      spotId: event.spotId,
      visitDate: event.visitDate,
      releaseAt,
      remindOn,
      releaseTaskCount: remindOn ? releaseTaskCount : 0,
      reservationRequired,
      createdAt: nowTs,
    });
    cartKeys.add(key);
  });

  if (toWrite.length > 0) {
    const transaction = await db.startTransaction();
    try {
      for (const row of toWrite) {
        const result = await transaction.collection(COLLECTIONS.REMINDER_CART).add({ data: row });
        added += 1;
        if (row.remindOn) addedReminders += 1;
        else addedTripOnly += 1;
        affectedKeys.push({
          cartId: result && result._id,
          spotId: row.spotId,
          visitDate: row.visitDate,
        });
      }
      await transaction.commit();
    } catch (err) {
      try { await transaction.rollback(); } catch (rollbackErr) { /* transaction may be closed */ }
      throw err;
    }
  }
  const nextItems = currentItems.concat(toWrite);
  return ok({
    added,
    addedReminders,
    addedTripOnly,
    skipped,
    total: selectable.length,
    scope,
    scopeKey,
    affectedKeys,
    cartSummary: summarize(nextItems),
    cartVersion: cartVersionOf(nextItems),
  });
}

/** 修改某项是否设置提醒 */
async function updateRemindOn(db, userId, cartId, remindOn, options = {}) {
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ _id: cartId, userId }).get();
  const row = (res.data || [])[0];
  if (!row) return fail(ERRORS.BAD_PARAM);
  const { spotMap, ruleMap } = await item.loadSpotContext(db, [row.spotId]);
  const spot = spotMap[row.spotId];
  const rule = ruleMap[row.spotId] || null;
  const nowTs = time.now();
  const allSlots = releaseSchedule.slotsForRequest(
    spot,
    rule,
    row.visitDate,
    options.supportsMultiRelease === true
  );
  const taskSlots = releaseSchedule.taskSlotsForRequest(
    spot,
    rule,
    row.visitDate,
    nowTs,
    options.supportsMultiRelease === true
  );
  if (remindOn && row.reservationRequired === false) return fail(ERRORS.BAD_PARAM);
  if (remindOn && allSlots.length === 0) return fail(ERRORS.BAD_PARAM);
  const releasePassed = row.reservationRequired !== false
    && allSlots.length > 0
    && taskSlots.length === 0;
  if (releasePassed) return fail(ERRORS.REMINDER_WINDOW_CLOSED);
  const patch = {
    remindOn: remindOn === true,
    releaseAt: taskSlots.length ? taskSlots[0].releaseAt : row.releaseAt,
    releaseTaskCount: remindOn === true ? taskSlots.length : 0,
  };
  await db.collection(COLLECTIONS.REMINDER_CART).doc(cartId).update({
    data: patch,
  });
  const all = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: row.tripId }).get();
  const items = (all.data || []).map(current =>
    current._id === cartId ? { ...current, ...patch } : current);
  return ok({
    cartId,
    remindOn: patch.remindOn,
    releaseAt: patch.releaseAt,
    releaseTaskCount: patch.releaseTaskCount,
    cartSummary: summarize(items),
    cartVersion: cartVersionOf(items),
  });
}

/** 删除单条 */
async function remove(db, userId, cartId) {
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ _id: cartId, userId }).get();
  const item = (res.data || [])[0];
  if (!item) return fail(ERRORS.BAD_PARAM);
  await db.collection(COLLECTIONS.REMINDER_CART).doc(cartId).remove();
  const all = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: item.tripId }).get();
  const items = all.data || [];
  return ok({
    cartId,
    spotId: item.spotId,
    visitDate: item.visitDate,
    releaseAt: item.releaseAt || null,
    reservationRequired: item.reservationRequired !== false,
    cartSummary: summarize(items),
    cartVersion: cartVersionOf(items),
  });
}

/**
 * 清空清单。
 *
 * 默认只清**暂存区**（不传 tripId）。传了真实 tripId 时清那一个行程的清单
 * （老调用方兼容）；显式传 all=true 才清该用户全部清单。
 *
 * ⚠️ 不要退回「不传就清全部」——那会连带清掉正在填写中的其他草稿。
 */
async function clear(db, userId, tripId = null) {
  const where = tripId === null
    ? { userId, tripId: PENDING_CART_TRIP_ID }
    : { userId, tripId };
  const beforeRes = await db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const removedRows = beforeRes.data || [];
  const res = await db.collection(COLLECTIONS.REMINDER_CART).where(where).remove();
  const remainingRes = await db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const remaining = remainingRes.data || [];
  return ok({
    removed: res.stats ? res.stats.removed : 0,
    removedRows,
    cartSummary: summarize(remaining),
    cartVersion: cartVersionOf(remaining),
  });
}

/**
 * CART-RULE-007 清单收敛到本次生成的时间线范围。
 *
 * 清单是跨页面/重启保留的暂存区，但用户每次重新生成时间线时，上一批已经不在
 * 本次日期段或景点集合里的草稿不能继续带进清单——那会让用户以为这次生成
 * 也包含了旧行程，并在提交时把旧项一起落库。
 *
 * 只清理暂存区；真实 tripId 下的清单是旧链路数据，不在这里处理。
 */
async function pruneScope(db, userId, { startDate, endDate, spotIds } = {}) {
  if (!startDate || !endDate || startDate > endDate) return fail(ERRORS.TRIP_DATE_INVALID);
  if (!Array.isArray(spotIds) || spotIds.length === 0) return fail(ERRORS.BAD_PARAM);

  const keepSpots = new Set(spotIds.map(String));
  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: PENDING_CART_TRIP_ID }).get();
  const stale = (res.data || []).filter(i => (
    !keepSpots.has(String(i.spotId || ''))
    || !i.visitDate
    || i.visitDate < startDate
    || i.visitDate > endDate
  ));

  await Promise.all(stale.map(i => db.collection(COLLECTIONS.REMINDER_CART).doc(i._id).remove()));
  const remaining = (res.data || []).filter(row => !stale.some(itemRow => itemRow._id === row._id));
  return ok({
    removed: stale.length,
    cartSummary: summarize(remaining),
    cartVersion: cartVersionOf(remaining),
  });
}

/**
 * 用户显式删掉最后一笔行程项后，清掉已经失去归属的暂存清单。
 *
 * 普通未提交清单必须跨退出/重启保留；这里只在「账号下已无任何 trip_items」
 * 且由删除动线主动调用时执行，避免把用户正在新建的第一趟行程草稿误删。
 */
async function clearPendingIfNoItems(db, userId) {
  const itemCount = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId }).count();
  if (itemCount.total > 0) return ok({ removed: 0 });

  const res = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId: PENDING_CART_TRIP_ID }).remove();
  return ok({ removed: res.stats ? res.stats.removed : 0 });
}

/**
 * 列出清单，关联景点名并分组。
 *
 * 不传 tripId = 读**暂存区**（这正是「添加提醒」页要的：用户挑完日期先放这里，
 * 提交时才建行程）。传真实 tripId 则读那个行程的清单（老链路兼容）。
 */
async function list(db, userId, tripId = null, {
  includeMembership = false,
  membershipCapabilities = null,
  supportsMultiRelease = false,
} = {}) {
  const where = { userId, tripId: cartTripIdOf(tripId) };
  const nowTs = time.now();
  const cartPromise = db.collection(COLLECTIONS.REMINDER_CART).where(where).get();
  const membershipPromise = includeMembership
    ? membership.status(db, userId, nowTs, {
      configCache: true,
      membershipCapabilities,
    }).catch(() => null)
    : Promise.resolve(null);
  const [res, membershipRes] = await Promise.all([cartPromise, membershipPromise]);
  const items = res.data || [];

  const { spotMap, ruleMap } = await item.loadSpotContext(db, items.map(i => i.spotId));

  const enriched = items.map(i => {
    const spot = spotMap[i.spotId];
    const rule = ruleMap[i.spotId] || null;
    const reservationRequired = i.reservationRequired !== false && (!spot || spot.reservationRequired !== false);
    const releaseSlots = releaseSchedule.slotsForRequest(
      spot,
      rule,
      i.visitDate,
      supportsMultiRelease === true
    );
    const taskSlots = releaseSchedule.taskSlotsForRequest(
      spot,
      rule,
      i.visitDate,
      nowTs,
      supportsMultiRelease === true
    );
    const noFixedRelease = reservationRequired && releaseSlots.length === 0;
    const releasePassed = reservationRequired && releaseSlots.length > 0 && taskSlots.length === 0;
    const releaseAt = reservationRequired
      ? (taskSlots.length ? taskSlots[0].releaseAt
        : (releaseSlots.length ? releaseSlots[releaseSlots.length - 1].releaseAt : null))
      : null;
    const msLeft = releaseAt ? releaseAt.getTime() - nowTs.getTime() : 0;
    const totalMin = Math.max(0, Math.floor(msLeft / 60000));
    return {
      ...i,
      reservationRequired,
      remindOn: reservationRequired && !noFixedRelease && !releasePassed && i.remindOn === true,
      releaseTaskCount: reservationRequired && !noFixedRelease && !releasePassed && i.remindOn === true
        ? taskSlots.length
        : 0,
      releaseSlots,
      remindLocked: !!(noFixedRelease || releasePassed),
      noFixedRelease,
      spotName: spot ? spot.name : '未知景点',
      difficulty: spot ? difficultyOf(spot.difficultyScore) : null,
      weak: reservationRequired && !!spot
        && spot.strongReminder !== true
        && (spot.difficultyScore || 0) <= 2,
      releaseDateLabel: releaseAt
        ? formatReleaseDateLabel(releaseAt)
        : '',
      releaseLabel: releaseAt
        ? `${formatReleaseDateLabel(releaseAt)} ${time.formatHourMinute(releaseAt)} 放票`
        : '',
      releaseTimeLabel: reservationRequired
        ? (releaseAt ? time.formatHourMinute(releaseAt) : '随买随用')
        : '无需预约',
      visitDateLabel: reservationRequired
        ? (noFixedRelease
          ? `${time.formatMonthDayWeek(i.visitDate)} · 随买随用`
          : `约 ${time.formatMonthDayWeek(i.visitDate)} 门票`)
        : `${time.formatMonthDayWeek(i.visitDate)} · 随到随玩`,
      countdown: releaseAt
        ? {
          hours: Math.floor(totalMin / 60),
          minutes: totalMin % 60,
          text: `还剩${Math.floor(totalMin / 60)}h ${totalMin % 60}m`,
          urgent: msLeft > 0 && msLeft < 3600 * 1000,
          expired: msLeft <= 0,
        }
        : null,
    };
  });

  return ok({
    items: enriched,
    groups: groupByVisitDate(enriched),
    summary: summarize(enriched),
    cartSummary: summarize(enriched),
    cartVersion: cartVersionOf(items),
    membership: membershipRes ? membershipRes.membership : null,
    packages: membershipRes && Array.isArray(membershipRes.packages) ? membershipRes.packages : [],
    sales: membershipRes ? membershipRes.sales : null,
  });
}

module.exports = {
  cartTripIdOf,
  isPending,
  summarize,
  cartVersionOf,
  groupByVisitDate,
  loadDatePlanContext,
  planQuickDates,
  add,
  planDates,
  addDates,
  addBatch,
  updateRemindOn,
  remove,
  clear,
  pruneScope,
  clearPendingIfNoItems,
  list,
};
