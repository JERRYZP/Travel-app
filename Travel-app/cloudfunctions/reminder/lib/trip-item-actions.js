/**
 * 行程项接口（API-契约 8.4，2026-09-16 首页行程化 P2）
 *
 * 这里只放「用户对一条行程项做了什么」：标记结果、撤销、改提醒、删除。
 * 状态怎么算在 `lib/item.js`，挽回建议怎么给在 `lib/recovery.js`。
 *
 * 贯穿全文的两条红线：
 *  ① **提醒额度不退还**：删任务时微信那边的授权次数已经花掉，账本不回调。
 *  ② **永不静默自动删除备选**：错误删除的代价（错过）远大于错误保留的代价。
 */

const {
  COLLECTIONS, ERRORS, ReminderBackendStatus, V1, ok, fail,
} = require('./schema');
const time = require('./time');
const item = require('./item');
const tripItem = require('./trip-item');

/* ============ 内部工具 ============ */

/** 取一条属于该用户的行程项；找不到返回 null */
async function findItem(db, userId, itemId) {
  if (!itemId) return null;
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ _id: itemId, userId }).get();
  return (res.data || [])[0] || null;
}

/** 取一条行程项的完整上下文（景点 + 规则 + 任务），供校验与返回 */
async function contextOf(db, userId, it) {
  const { spotMap, ruleMap } = await item.loadSpotContext(db, [it.spotId]);
  const taskRes = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, itemId: it._id }).get();
  const tasks = taskRes.data || [];
  const task = tasks.sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  return {
    spot: spotMap[it.spotId],
    rule: ruleMap[it.spotId],
    task,
    tasks,
  };
}

/** 删除某行程项名下的全部提醒任务，返回删除条数 */
async function removeTasksOf(db, userId, itemId) {
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ userId, itemId }).get();
  for (const t of (res.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
  }
  return (res.data || []).length;
}

/**
 * 行程下是否已无任何行程项 —— 行程是否为空**只看 trip_items**。
 *
 * 决策文档第六节：不能用「还有没有提醒任务」判定，否则只有免预约景点、
 * 没设提醒的行程会被误判成空的删掉。
 */
async function tripEmptyAfterChange(db, userId, tripId) {
  if (!tripId) return false;
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId }).count();
  return res.total === 0;
}

/** 某行程项删除后可能连带删行程：行程项清空 → 行程 + 遗留清单一起清掉 */
async function dropTripIfEmpty(db, userId, tripId) {
  if (!await tripEmptyAfterChange(db, userId, tripId)) return false;
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART)
    .where({ userId, tripId }).get();
  for (const c of (cartRes.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_CART).doc(c._id).remove();
  }
  await db.collection(COLLECTIONS.TRIPS).doc(tripId).remove();
  return true;
}

/* ============ 8.4 行程项接口 ============ */

/**
 * tripItem.markResult —— 用户标记「抢到了 / 没抢到」
 *
 * 规则（8.4）：
 * - 只能标记**已开票且尚未人工标记、日期未结束**的行程项（开票前不问结果）。
 * - 成功后返回 `backupPrompt`：同一备选组里其他还没处理的日期，
 *   前端据此在卡片旁出一条内联提示 `已确认 10月2日去故宫，10月3日的备选 [删掉] [保留]`。
 * - **永不静默自动删除备选**。用户点「保留」或不操作 → 备选照常抢票、照常发提醒。
 * - 提醒失败/未送达**不影响**标记结果——票是票、提醒是提醒。
 */
async function markResult(db, userId, { itemId, result }) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);
  if (result !== 'SUCCESS' && result !== 'FAILED') return fail(ERRORS.ITEM_RESULT_INVALID);

  const it = await findItem(db, userId, itemId);
  if (!it) return fail(ERRORS.ITEM_NOT_FOUND);

  const nowTs = time.now();
  const ctx = await contextOf(db, userId, it);
  const reservationRequired = !ctx.spot || ctx.spot.reservationRequired !== false;
  const releaseAt = item.deriveReleaseAt(ctx.spot, ctx.rule, it.visitDate);

  if (!item.canMarkResult({
    item: it, reservationRequired, releaseAt, visitDate: it.visitDate, nowTs,
  })) {
    // 已标记过 → 用「撤销窗口」的语义提示，而不是笼统的不可标记
    if (it.result) return fail(ERRORS.ITEM_RESULT_INVALID);
    if (item.isItemEnded(it.visitDate, nowTs)) return fail(ERRORS.ITEM_ENDED);
    return fail(ERRORS.ITEM_RESULT_INVALID);
  }

  await db.collection(COLLECTIONS.TRIP_ITEMS).doc(itemId).update({
    data: { result, resultAt: nowTs, updatedAt: nowTs },
  });

  const updated = { ...it, result, resultAt: nowTs };
  const decorated = item.decorateItem({
    item: updated, spot: ctx.spot, rule: ctx.rule, task: ctx.task, nowTs,
  });

  return ok({
    item: decorated,
    // 只有「抢到了」才追问备选：没抢到时该给的是挽回建议，不是收束提示
    backupPrompt: result === 'SUCCESS'
      ? await backupPromptOf(db, userId, it, nowTs)
      : null,
  });
}

/**
 * 备选收束提示（决策文档 4.2）。
 * 只在同一备选组里还有**未处理**日期时才返回；没有备选 → null（前端不渲染内联提示）。
 */
async function backupPromptOf(db, userId, target, nowTs) {
  const groupId = target.backupGroupId || tripItem.backupGroupIdOf(target.tripId, target.spotId);
  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, backupGroupId: groupId }).get();

  const others = (res.data || []).filter(i => i._id !== target._id);
  if (others.length === 0) return null;

  const { spotMap, ruleMap } = await item.loadSpotContext(db, [target.spotId]);
  const spot = spotMap[target.spotId];
  const rule = ruleMap[target.spotId];

  const pending = others
    .filter(i => !i.result && !item.isItemEnded(i.visitDate, nowTs))
    .map(i => item.decorateItem({ item: i, spot, rule, task: null, nowTs }));

  if (pending.length === 0) return null;

  const targetLabel = time.formatMonthDayWeekCn(target.visitDate);
  const spotName = spot ? spot.name : '该景点';
  return {
    groupId,
    spotName,
    confirmedLabel: targetLabel,
    // 前端直接用这句话，避免各页面自己拼文案拼出七八种说法
    text: `已确认${targetLabel}去${spotName}`,
    pending: pending.map(p => ({
      itemId: p.itemId,
      visitDate: p.visitDate,
      visitDateLabel: time.formatMonthDayWeekCn(p.visitDate),
      ticketState: p.ticketState,
    })),
  };
}

/**
 * tripItem.undoResult —— 4 秒内撤销误触
 *
 * `expectedResultAt` 必须匹配：防止用户 A 撤销时把用户 B 之后的另一次标记覆盖掉
 * （同一设备上快速连点两次标记 / 两个页面同时开着）。
 * 窗口常量在 schema.V1.RESULT_UNDO_SECONDS（2026-09-17 由 10 秒收紧为 4 秒）。
 */
async function undoResult(db, userId, { itemId, expectedResultAt }) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);
  const it = await findItem(db, userId, itemId);
  if (!it) return fail(ERRORS.ITEM_NOT_FOUND);
  if (!it.result || !it.resultAt) return fail(ERRORS.ITEM_RESULT_INVALID);

  const nowTs = time.now();
  if (expectedResultAt
    && new Date(expectedResultAt).getTime() !== new Date(it.resultAt).getTime()) {
    // 不是那一次标记了（已被后续操作覆盖）→ 拒绝，不做「撤销别的东西」
    return fail(ERRORS.ITEM_RESULT_INVALID);
  }
  const deadline = new Date(it.resultAt).getTime() + V1.RESULT_UNDO_SECONDS * 1000;
  if (nowTs.getTime() > deadline) return fail(ERRORS.ITEM_UNDO_EXPIRED);

  await db.collection(COLLECTIONS.TRIP_ITEMS).doc(itemId).update({
    data: { result: null, resultAt: null, updatedAt: nowTs },
  });

  const ctx = await contextOf(db, userId, it);
  return ok({
    item: item.decorateItem({
      item: { ...it, result: null, resultAt: null },
      spot: ctx.spot, rule: ctx.rule, task: ctx.task, nowTs,
    }),
  });
}

/**
 * tripItem.updateReminder —— 修改提醒设置（改提前量 / 取消提醒）
 *
 * - 免预约行程项**拒绝开启**提醒（不是静默忽略，否则前端会以为设上了）。
 * - `remindOn=false` → 关闭并删除**未触发**的任务；已触发的保留（它是历史记录，
 *   而且微信那次的额度已经花掉了，删掉也退不回来）。
 * - 改提前量 → 重建未触发任务（每条任务按 offsets 发多条消息，offset 变了必须重建）。
 */
async function updateReminder(db, userId, { itemId, remindOn, channels, offsets }) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);

  const it = await findItem(db, userId, itemId);
  if (!it) return fail(ERRORS.ITEM_NOT_FOUND);

  const nowTs = time.now();
  const ctx = await contextOf(db, userId, it);
  const reservationRequired = !ctx.spot || ctx.spot.reservationRequired !== false;
  const releaseAt = item.deriveReleaseAt(ctx.spot, ctx.rule, it.visitDate);

  // 免预约项没有提醒可言：明确拒绝，不静默忽略——否则前端会以为设上了
  if (remindOn === true && !reservationRequired) return fail(ERRORS.BAD_PARAM);
  // 无放票时刻（需预约但无固定规则，如环球影城）也设不了提醒
  if (remindOn === true && !releaseAt) return fail(ERRORS.BAD_PARAM);

  const nextRemindOn = remindOn === true;
  await db.collection(COLLECTIONS.TRIP_ITEMS).doc(itemId).update({
    data: { remindOn: nextRemindOn, updatedAt: nowTs },
  });

  const activeTasks = (ctx.tasks || []).filter(t =>
    t.backendStatus === ReminderBackendStatus.WAITING);

  if (!nextRemindOn) {
    // ⚠️ 只删未触发的。已触发的是历史记录，且微信额度不退。
    for (const t of activeTasks) {
      await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
    }
  } else {
    const nextChannels = Array.isArray(channels) && channels.length
      ? channels : (ctx.task && ctx.task.channels) || [];
    const nextOffsets = Array.isArray(offsets) && offsets.length
      ? offsets : (ctx.task && ctx.task.offsets) || [];
    if (nextChannels.length === 0 || nextOffsets.length === 0) return fail(ERRORS.BAD_PARAM);

    const changed = ctx.task
      && (String(ctx.task.offsets || []) !== String(nextOffsets)
        || String(ctx.task.channels || []) !== String(nextChannels));

    if (!ctx.task || changed) {
      // 提前量变了 → 旧任务已无意义，重建（不退还额度）
      for (const t of (ctx.tasks || [])) {
        await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
      }
      await db.collection(COLLECTIONS.REMINDER_TASKS).add({
        data: {
          userId,
          itemId,
          tripId: it.tripId,
          spotId: it.spotId,
          visitDate: it.visitDate,
          releaseAt,
          offsets: [...nextOffsets].sort((a, b) => b - a),
          channels: nextChannels,
          backendStatus: ReminderBackendStatus.WAITING,
          triggeredAt: null,
          missedReason: null,
          cleanAt: null,
          sentOffsets: [],
          createdAt: nowTs,
        },
      });
    }
  }

  const after = await contextOf(db, userId, { ...it, remindOn: nextRemindOn });
  return ok({
    item: item.decorateItem({
      item: { ...it, remindOn: nextRemindOn },
      spot: ctx.spot, rule: ctx.rule, task: after.task, nowTs,
    }),
    quotaRefunded: false, // 显式写明：微信侧额度已消耗，不退还
  });
}

/**
 * tripItem.remove —— 删单条行程项（连带其提醒任务）
 * @returns {removedTasks, tripRemoved}
 */
async function remove(db, userId, { itemId }) {
  if (!itemId) return fail(ERRORS.BAD_PARAM);
  const it = await findItem(db, userId, itemId);
  if (!it) return fail(ERRORS.ITEM_NOT_FOUND);

  const removedTasks = await removeTasksOf(db, userId, itemId);
  await db.collection(COLLECTIONS.TRIP_ITEMS).doc(itemId).remove();
  const tripRemoved = await dropTripIfEmpty(db, userId, it.tripId);

  return ok({ itemId, tripId: it.tripId, removedTasks, tripRemoved });
}

/**
 * tripItem.removeVisitDate —— 删某一天的全部行程项（连带其提醒任务）
 *
 * 前端**必须先明确提示**「该日期下的行程项和提醒会一并删除」（8.4）。
 * @returns {removedItems, removedTasks, tripRemoved}
 */
async function removeVisitDate(db, userId, { tripId, visitDate }) {
  if (!tripId || !visitDate) return fail(ERRORS.BAD_PARAM);

  const res = await db.collection(COLLECTIONS.TRIP_ITEMS)
    .where({ userId, tripId, visitDate }).get();
  const items = res.data || [];
  if (items.length === 0) return fail(ERRORS.ITEM_NOT_FOUND);

  let removedTasks = 0;
  for (const it of items) {
    removedTasks += await removeTasksOf(db, userId, it._id);
    await db.collection(COLLECTIONS.TRIP_ITEMS).doc(it._id).remove();
  }
  const tripRemoved = await dropTripIfEmpty(db, userId, tripId);

  return ok({
    tripId,
    visitDate,
    removedItems: items.length,
    removedTasks,
    tripRemoved,
  });
}

module.exports = {
  findItem,
  contextOf,
  removeTasksOf,
  tripEmptyAfterChange,
  dropTripIfEmpty,
  backupPromptOf,
  markResult,
  undoResult,
  updateReminder,
  remove,
  removeVisitDate,
};
