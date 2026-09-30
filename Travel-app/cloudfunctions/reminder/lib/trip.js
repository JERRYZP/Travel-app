/**
 * 行程规则 TRIP-RULE-001 ~ 006（产品文档 3.2）
 *
 * 纯函数部分（合并判定、命名、排序）不依赖数据库，便于本地断言测试。
 */

const { COLLECTIONS, TripStatus, V1, ERRORS, ok, fail } = require('./schema');
const time = require('./time');
const tripItem = require('./trip-item');
const item = require('./item');
const cart = require('./cart');

/* ============ 纯函数区：可脱离云环境测试 ============ */

/* ---------- 合并判定与景点段（TRIP-RULE-002） ---------- */

/**
 * TRIP-RULE-002 合并判定（2026-09-23 收敛：同城即合并，不再按日期间隔拆分）
 *
 * 背景：主客群是外地游客，单次出行基本连续。日期间隔自动拆分导致：
 *   - 首页出现多个"北京 X.X-X.X" Section，用户困惑为什么分开
 *   - 合并逻辑复杂（canMerge + collapse + gap），bug 率高
 *   - 北京本地用户/多次访客场景频率极低，不值得为它维护这套逻辑
 *
 * 当前规则：同城市即合并，日期段取并集。
 * 进行中/历史的划分由 endDate >= today 在读取时计算，与本规则独立。
 *
 * --- 旧逻辑（如需恢复间隔拆分，取消下面注释并删去 return true）---
 * function canMerge(a, b) {
 *   if ((a.city || '') !== (b.city || '')) return false;
 *   if (a.startDate <= b.endDate && b.startDate <= a.endDate) return true;
 *   return time.addDays(a.endDate, 1) === b.startDate
 *     || time.addDays(b.endDate, 1) === a.startDate;
 * }
 * 正例：北京 5.31-6.4 + 6.5-6.8 → 可合并（相接）
 * 反例：北京 5.31-6.4 + 6.6-6.8 → 不可合并（隔了 6.5）
 * --------------------------------------------------------------------
 */
function canMerge(a, b) {
  return (a.city || '') === (b.city || '');
}

/** 日期段取并集 */
function mergeRange(a, b) {
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

/**
 * 把一批「景点 × 日期段」摊平成行程的 spots 字段
 * @returns {Array<{spotId, startDate, endDate}>}
 */
function makeSpotSegments(spotIds, startDate, endDate) {
  return [...new Set(spotIds || [])].map(spotId => ({ spotId, startDate, endDate }));
}

/**
 * 行程的景点段归一化（2026-09-14 A 方案：合并行程，但景点各留自己的日期段）
 *
 * 新数据用 `spots: [{spotId, startDate, endDate}]`；
 * 老数据（只存 spotIds）按行程整段回退 —— 与合并前的旧口径完全等价，
 * 所以线上已有行程不需要数据迁移，也不会因为缺字段而生成空时间线。
 */
function normalizeSpots(trip) {
  const segs = Array.isArray(trip.spots)
    ? trip.spots.filter(s => s && s.spotId)
    : [];
  if (segs.length > 0) {
    return segs.map(s => ({ spotId: s.spotId, startDate: s.startDate, endDate: s.endDate }));
  }
  return makeSpotSegments(trip.spotIds || [], trip.startDate, trip.endDate);
}

/**
 * 景点段合并：同 spotId 的段取并集
 * （跨段选了同一景点时，把它自己的日期接起来：故宫 9.23-9.24 + 9.25-9.26 → 9.23-9.26）
 */
function mergeSpots(a, b) {
  const map = new Map();
  for (const s of [...(a || []), ...(b || [])]) {
    if (!s || !s.spotId) continue;
    const cur = map.get(s.spotId);
    // 注意：mergeRange 只回日期，spotId 必须在这里补回去，否则段会丢景点标识
    map.set(s.spotId, cur
      ? { spotId: s.spotId, ...mergeRange(cur, s) }
      : { spotId: s.spotId, startDate: s.startDate, endDate: s.endDate });
  }
  return [...map.values()];
}

/**
 * 把一批待合并行程滚雪球式合并到一起。
 * 新行程可能同时与多个既有行程相接，需反复合并直到不再变化。
 * @returns {{range: {city,startDate,endDate}, mergedIds: string[]}}
 */
function collapse(incoming, existing) {
  let range = { city: incoming.city, startDate: incoming.startDate, endDate: incoming.endDate };
  const mergedIds = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of existing) {
      if (mergedIds.includes(t._id)) continue;
      if (canMerge(range, t)) {
        range = { city: range.city, ...mergeRange(range, t) };
        mergedIds.push(t._id);
        changed = true;
      }
    }
  }
  return { range, mergedIds };
}

/**
 * TRIP-RULE-003 系统命名「北京 5.31-6.4」，用户不可编辑
 */
function buildName(city, startDate, endDate) {
  const short = (d) => {
    const p = time.beijingParts(time.parseBeijing(d, '12:00'));
    return `${p.month}.${p.day}`;
  };
  return `${city} ${short(startDate)}-${short(endDate)}`;
}

/** ERROR-1006 行程日期合法性 */
function validateRange(startDate, endDate) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startDate || '') || !re.test(endDate || '')) return false;
  return startDate <= endDate;
}

/**
 * TRIP-RULE-005 行程按开始日期升序（从左到右按时间顺序）
 * @param {Array} trips 行程数组
 */
function sortTrips(trips) {
  return [...trips].sort((x, y) => String(x.startDate).localeCompare(String(y.startDate)));
}

/* ============ 数据库操作区 ============ */

/**
 * TRIP-RULE-002 创建**或合并**行程（2026-09-14 恢复自动合并，撤销 2026-08-31 的「取消自动合并」）
 *
 * 同城市 且（日期有交集 或 首尾相接）→ 合并成一个行程（= 一个任务分组 Tab），
 * 日期取并集。这与「任务分组第一性原则」一致：时间上连续/重叠的一段出行就是一次行程。
 *
 * 与 08-31 旧实现的**唯一区别**：合并时不再把景点也取并集，
 * 而是让**每个景点保留自己被选中时的日期段**（`spots: [{spotId, startDate, endDate}]`）。
 * 所以「北京 9.23-9.24 选故宫 + 北京 9.25-9.26 选国博」合并后：
 *   - 行程 = 北京 9.23-9.26（一个 Tab）
 *   - 时间线 = 故宫 9.23/9.24 + 国博 9.25/9.26，**不会**冒出「故宫 9.25」「国博 9.23」
 * 这就是当初取消合并想避免的问题（时间线被撑成「整段 × 全部景点」的交叉积），
 * 现在靠 spots 段解决，不需要再牺牲分组。
 *
 * @param {string} adjustTripId 「在某个已生成行程上重新生成」时传入：该行程的景点段
 *   按本次输入**替换**（而不是并集），其余被并进来的行程段保留。
 *   它仍会与其它日期相交/相接的行程继续合并。
 * @returns {{tripId, merged: boolean, mergedFrom: string[], trip}}
 */
async function create(db, userId, {
  startDate, endDate, spotIds = [], city = V1.CITY, adjustTripId = '', spotSegments = null,
}) {
  if (!validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);

  const incomingRange = { city, startDate, endDate };
  /* spotSegments：提交清单时由每个景点自己的 visitDate 集合推导出的段
     （故宫 10月2日+10月3日 → 故宫 10.2-10.3）。不传时回退成「整段 × 全部景点」，
     与老调用方口径一致。 */
  const incomingSpots = (Array.isArray(spotSegments) && spotSegments.length > 0)
    ? spotSegments.filter(sg => sg && sg.spotId && sg.startDate && sg.endDate)
      .map(sg => ({ spotId: sg.spotId, startDate: sg.startDate, endDate: sg.endDate }))
    : makeSpotSegments(spotIds, startDate, endDate);

  const existRes = await db.collection(COLLECTIONS.TRIPS)
    .where({ userId, city, status: TripStatus.ACTIVE }).get();
  const existing = existRes.data || [];

  /* 调整目标：日期与本次输入相交/相接才认（否则按「新建行程」处理，旧行程留原样，
     空的话由 trip.list 的孤儿清理收走） */
  const adjust = adjustTripId ? existing.find(t => t._id === adjustTripId) : null;
  const adjustMerges = Boolean(adjust && canMerge(incomingRange, adjust));
  const pool = adjustMerges ? existing.filter(t => t._id !== adjust._id) : existing;

  const { range, mergedIds } = collapse(incomingRange, pool);

  /* 景点段：被并进来的行程各自的段（同景点取并集）+ 本次输入的段。
     - 调整模式：本次输入**替换**该行程原有的段 → 本次输入在前
     - 新建/合并模式：既有行程段在前、本次输入追加在后，保证想去列表顺序稳定 */
  const mergedTrips = pool.filter(t => mergedIds.includes(t._id));
  const otherSpots = mergedTrips.reduce((acc, t) => acc.concat(normalizeSpots(t)), []);
  const finalSpots = adjustMerges
    ? mergeSpots(incomingSpots, otherSpots)
    : mergeSpots(otherSpots, incomingSpots);
  const finalSpotIds = finalSpots.map(s => s.spotId);
  const name = buildName(city, range.startDate, range.endDate);
  const nowTs = time.now();

  /* 存续行程：调整目标优先（保持 tripId 不变，任务/清单无需改挂），
     其次复用第一个被合并的行程，都没有则新建 */
  const keepId = adjustMerges ? adjust._id : (mergedIds[0] || '');

  if (!keepId) {
    const res = await db.collection(COLLECTIONS.TRIPS).add({
      data: {
        userId,
        city,
        startDate: range.startDate,
        endDate: range.endDate,
        name,
        spotIds: finalSpotIds,
        spots: finalSpots,
        status: TripStatus.ACTIVE,
        createdAt: nowTs,
        updatedAt: nowTs,
      },
    });
    return ok({
      tripId: res._id,
      merged: false,
      mergedFrom: [],
      trip: {
        _id: res._id, city, ...range, name,
        spotIds: finalSpotIds, spots: finalSpots, status: TripStatus.ACTIVE,
      },
    });
  }

  const dropIds = mergedIds.filter(id => id !== keepId);
  await db.collection(COLLECTIONS.TRIPS).doc(keepId).update({
    data: {
      startDate: range.startDate,
      endDate: range.endDate,
      name,
      spotIds: finalSpotIds,
      spots: finalSpots,
      updatedAt: nowTs,
    },
  });

  for (const id of dropIds) {
    // 被吞并行程的任务与清单改挂到存续行程（提醒本身不受影响）
    await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId, tripId: id })
      .update({ data: { tripId: keepId } });
    await db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId, tripId: id })
      .update({ data: { tripId: keepId } });
    const movedItems = await db.collection(COLLECTIONS.TRIP_ITEMS)
      .where({ userId, tripId: id }).get();
    for (const moved of (movedItems.data || [])) {
      await db.collection(COLLECTIONS.TRIP_ITEMS).doc(moved._id).update({
        data: {
          tripId: keepId,
          backupGroupId: tripItem.backupGroupIdOf(keepId, moved.spotId),
          updatedAt: nowTs,
        },
      });
      /* ⚠️ 行程项 _id 不变，所以任务上的 itemId 仍然有效——但任务的冗余字段
         tripId/visitDate/releaseAt 会跟着行程范围一起过期（releaseAt 依赖 visitDate
         与规则推算）。这里同步 tripId 并**按新行程段重算 releaseAt**，
         否则合并后的行程在首页会显示错误的放票时间。
         itemId 保持不动，是 V2 里 tasks join items 的唯一键。 */
      const itemTasks = await db.collection(COLLECTIONS.REMINDER_TASKS)
        .where({ userId, itemId: moved._id }).get();
      if ((itemTasks.data || []).length > 0) {
        const { spotMap, ruleMap } = await item.loadSpotContext(db, [moved.spotId]);
        const releaseAt = item.deriveReleaseAt(spotMap[moved.spotId], ruleMap[moved.spotId], moved.visitDate);
        const patch = { tripId: keepId };
        if (releaseAt) patch.releaseAt = releaseAt;
        await db.collection(COLLECTIONS.REMINDER_TASKS)
          .where({ userId, itemId: moved._id })
          .update({ data: patch });
      }
    }
    await db.collection(COLLECTIONS.TRIPS).doc(id).remove();
  }

  return ok({
    tripId: keepId,
    merged: mergedIds.length > 0,
    mergedFrom: mergedIds,
    trip: {
      _id: keepId, city, ...range, name,
      spotIds: finalSpotIds, spots: finalSpots, status: TripStatus.ACTIVE,
    },
  });
}

/**
 * 更新想去景点列表（PAGE-003 带回结果）
 *
 * 已在行程里的景点**保留自己的日期段**（不因为一次增删被拉回整段）；
 * 新加入的景点沿用行程当前范围（传 opts 时用 opts 的段）。
 */
async function updateSpots(db, userId, tripId, spotIds, opts = {}) {
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ _id: tripId, userId })
    .get();
  const trip = (res.data || [])[0];
  if (!trip) return fail(ERRORS.BAD_PARAM);

  const startDate = opts.startDate || trip.startDate;
  const endDate = opts.endDate || trip.endDate;
  const next = [...new Set(spotIds || [])];
  const prevMap = new Map(normalizeSpots(trip).map(s => [s.spotId, s]));
  const spots = next.map(spotId => prevMap.get(spotId) || { spotId, startDate, endDate });

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).update({
    data: { spotIds: next, spots, updatedAt: time.now() },
  });
  return ok({ tripId, spotIds: next, spots });
}

/**
 * 修改行程日期范围（会触发时间线重算，由调用方负责）
 *
 * 行程总范围变了 → 各景点的段裁剪到新范围内（无交集时收敛到新范围），
 * 保证「景点段 ⊄ 行程范围」这种非法状态不出现。
 */
async function updateRange(db, userId, tripId, startDate, endDate) {
  if (!validateRange(startDate, endDate)) return fail(ERRORS.TRIP_DATE_INVALID);
  const res = await db.collection(COLLECTIONS.TRIPS).where({ _id: tripId, userId }).get();
  const trip = (res.data || [])[0];
  if (!trip) return fail(ERRORS.BAD_PARAM);

  const spots = normalizeSpots(trip).map(s => {
    const seg = {
      spotId: s.spotId,
      startDate: s.startDate > startDate ? s.startDate : startDate,
      endDate: s.endDate < endDate ? s.endDate : endDate,
    };
    return seg.startDate > seg.endDate ? { spotId: s.spotId, startDate, endDate } : seg;
  });

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).update({
    data: {
      startDate,
      endDate,
      name: buildName(trip.city, startDate, endDate),
      spotIds: spots.map(s => s.spotId),
      spots,
      updatedAt: time.now(),
    },
  });
  return ok({ tripId, startDate, endDate, spots });
}

/**
 * TRIP-RULE-004 级联删除：行程下任务、行程项与清单均空 → 行程自动删除
 * @returns {boolean} 是否发生了删除
 */
async function removeIfEmpty(db, userId, tripId) {
  const taskCount = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, tripId }).count();
  if (taskCount.total > 0) return false;

  const itemCount = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId }).count();
  if (itemCount.total > 0) return false;

  const cartCount = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId }).count();
  if (cartCount.total > 0) return false;

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  return true;
}

/**
 * 清理「已无任何行程项、也没任务」的行程（V2 主动删除口径）。
 *
 * 与 removeIfEmpty 的区别：**不看提醒清单**。
 * V2 里清单是「提交前的暂存区」，不再挂在行程上；行程是否为空**只看 trip_items**
 * （决策文档第六节：不能用「还有没有提醒任务」判定，否则只有免预约景点、
 * 没设提醒的行程会被误判成空的删掉）。
 *
 * 行程下遗留的清单草稿不再作为「行程非空」的保留条件：用户显式删掉最后一笔
 * 行程项时，真实 tripId 下的残留清单会一并清掉；无主暂存草稿则由显式删除动线
 * 调用 cart.clearPendingIfNoItems 清理。
 */
async function purgeIfNoItem(db, userId, tripId) {
  if (!tripId) return false;

  const taskCount = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, tripId }).count();
  if (taskCount.total > 0) return false;

  const itemCount = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId }).count();
  if (itemCount.total > 0) return false;

  /* 行程已被删除后，挂在这个真实 tripId 下的遗留清单也必须一起清掉。
     暂存区（__pending__）是否清理由显式删除动线单独判断，读取侧清理不碰它。 */
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId }).get();
  for (const c of (cartRes.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_CART).doc(c._id).remove();
  }

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  return true;
}

/**
 * TRIP-RULE-004：主动删除提醒后的空行程清理。
 * 2026-09-16 行程项成为事实来源后，只有“无任务且无行程项”才允许删除；
 * 此时提醒清单作为未提交草稿一并清掉。
 *
 * 与 removeIfEmpty 的分工：
 *  - removeIfEmpty = 读取时孤儿清理，任务、行程项、清单都空才删除；
 *  - purgeIfNoTask = 用户主动删除提醒后的级联，任务和行程项都空才删除，
 *    再连提醒清单一并清掉。
 * 函数名保留以兼容旧调用；判断条件已补上 trip_items。
 *
 * @returns {boolean} 是否发生了删除
 */
async function purgeIfNoTask(db, userId, tripId) {
  if (!tripId) return false;

  const taskCount = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, tripId }).count();
  if (taskCount.total > 0) return false;

  // 行程项是 V2 的事实来源；即使没有任务（例如只加入免预约景点），行程也不能删。
  const itemCount = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId }).count();
  if (itemCount.total > 0) return false;

  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId }).get();
  for (const c of (cartRes.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_CART).doc(c._id).remove();
  }

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  await cart.clearPendingIfNoItems(db, userId);
  return true;
}

/**
 * 用户显式删除行程：行程 + 该行程下的提醒任务 + 提醒清单一并物理删除。
 *
 * 用于首页「进行中 0 / 已过期 0」的空壳行程——这类行程已经没有任务，
 * 却因为清单里还留着未提交的提醒而被 removeIfEmpty 判为「非空」永久残留。
 * 清空任务路径会自动触发（purgeIfNoTask），这里是用户手动兜底入口。
 */
async function remove(db, userId, tripId) {
  if (!tripId) return fail(ERRORS.BAD_PARAM);
  const res = await db.collection(COLLECTIONS.TRIPS).where({ _id: tripId, userId }).get();
  if (!(res.data || []).length) return fail(ERRORS.BAD_PARAM);

  const taskRes = await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId, tripId }).get();
  for (const t of (taskRes.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
  }
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART).where({ userId, tripId }).get();
  for (const c of (cartRes.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_CART).doc(c._id).remove();
  }
  const itemRes = await db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId, tripId }).get();
  for (const item of (itemRes.data || [])) {
    await db.collection(COLLECTIONS.TRIP_ITEMS).doc(item._id).remove();
  }

  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  await cart.clearPendingIfNoItems(db, userId);
  return ok({
    tripId,
    removedTasks: (taskRes.data || []).length,
    removedCartItems: (cartRes.data || []).length,
    removedItems: (itemRes.data || []).length,
  });
}

/**
 * 列出行程，附带 TRIP-RULE-005 排序所需的 nextReminderAt 与 TRIP-RULE-006 分组信息。
 * 读取时兜底清理孤儿行程：任务与清单均空的行程（如生成了时间线但从未提交提醒）
 * 自动删除（TRIP-RULE-004），保证返回的行程都有内容，避免空行程 tab 残留。
 */
async function list(db, userId) {
  const res = await db.collection(COLLECTIONS.TRIPS)
    .where({ userId })
    .get();
  const kept = [];
  for (const t of (res.data || [])) {
    const removed = await removeIfEmpty(db, userId, t._id);
    if (!removed) kept.push(t);
  }
  const trips = kept;

  const { ReminderBackendStatus } = require('./schema');
  for (const t of trips) {
    // 老数据只有 spotIds → 统一补出 spots 段（按行程整段），前端/时间线可放心依赖
    t.spots = normalizeSpots(t);
    const waiting = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId, tripId: t._id, backendStatus: ReminderBackendStatus.WAITING })
      .orderBy('releaseAt', 'asc')
      .limit(1)
      .get();
    t.nextReminderAt = (waiting.data || []).length ? waiting.data[0].releaseAt : null;
  }

  const sorted = sortTrips(trips);
  return ok({
    trips: sorted,
    // TRIP-RULE-006：仅 ≥2 个行程时前端显示分组 Tab 行
    showGroupTabs: sorted.length >= 2,
  });
}

module.exports = {
  // 纯函数
  buildName,
  validateRange,
  sortTrips,
  canMerge,
  mergeRange,
  makeSpotSegments,
  normalizeSpots,
  mergeSpots,
  collapse,
  // DB
  create,
  updateSpots,
  updateRange,
  removeIfEmpty,
  purgeIfNoItem,
  purgeIfNoTask,
  remove,
  list,
};
