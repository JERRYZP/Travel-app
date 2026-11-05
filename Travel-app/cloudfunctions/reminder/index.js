/**
 * reminder 云函数 —— 行程 / 时间线 / 清单 / 任务 四域统一入口
 *
 * 前端调用形状：
 *   wx.cloud.callFunction({ name: 'reminder', data: { action: 'timeline.generate', tripId } })
 *
 * action 命名规则：<域>.<动作>，域 = trip | timeline | cart | task | user | admin
 * 完整契约见 Travel-app/CLAUDE.md「后端 action 契约」。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const rawDb = cloud.database();

const {
  COLLECTIONS, V1, ERRORS, ChannelType, PENDING_CART_TRIP_ID,
  ReminderBackendStatus, EventSelectStatus, ok, fail,
} = require('./lib/schema');
const time = require('./lib/time');
const trip = require('./lib/trip');
const tripShare = require('./lib/trip-share');
const tripWindow = require('./lib/trip-window');
const timeline = require('./lib/timeline');
const cart = require('./lib/cart');
const task = require('./lib/task');
const item = require('./lib/item');
const itemActions = require('./lib/trip-item-actions');
const recovery = require('./lib/recovery');
const membership = require('./lib/membership');
const userDomain = require('./lib/user');
const userRuntime = require('./lib/user-runtime');
const {
  DEFAULT_SUBSCRIBE_TEMPLATE_ID,
  subscribeQuotaOf,
  totalSubscribeQuota,
} = require('./lib/quota');
const { createResourceMonitor } = require('./lib/resource-metrics');

const resource = createResourceMonitor('reminder', rawDb);
const db = resource.db;
const USER_RUNTIME_MUTATIONS = new Set([
  'trip.create', 'trip.updateSpots', 'trip.updateRange', 'trip.updateWindow', 'trip.remove',
  'timeline.generate',
  'tripItem.markResult', 'tripItem.undoResult', 'tripItem.updateReminder',
  'tripItem.remove', 'tripItem.removeVisitDate',
  'cart.addDates', 'cart.add', 'cart.addAll',
  'cart.updateRemindOn', 'cart.commit', 'cart.quickCommit', 'cart.remove', 'cart.clear',
  'cart.pruneScope',
  'task.submit', 'task.list', 'task.remove', 'task.clear',
  'user.updateProfile', 'user.updateNotifyPrefs', 'subscribe.add',
]);

/* home.bootstrap 分段计时用（见 homeBootstrap）：
   标记「本实例是否还没处理过任何请求」。这个模块在云函数冷启动时求值一次，
   所以第一次调用打 true 就是新实例的首个请求。 */
let moduleFirstCall = true;

async function main(event) {
  const { action } = event || {};
  const { OPENID } = cloud.getWXContext();

  // admin.seed 允许在无登录态的控制台调试中执行
  if (!OPENID && action !== 'admin.seed' && action !== 'admin.runtimeBackfill') {
    return fail(ERRORS.UNAUTHORIZED);
  }
  const userId = OPENID;

  try {
    switch (action) {
      /* ======== 行程 ======== */
      case 'trip.create':
        // TRIP-RULE-002：同城市 + 日期相交/相接 → 自动合并成一个行程（任务分组）；
        // event.adjustTripId 存在时表示「在该行程上重新生成」，其景点段按本次输入替换
        return await trip.create(db, userId, event);
      case 'trip.list':
        return await trip.list(db, userId);
      case 'trip.updateSpots':
        return await trip.updateSpots(db, userId, event.tripId, event.spotIds || [], {
          startDate: event.startDate,
          endDate: event.endDate,
        });
      case 'trip.updateRange':
        return await trip.updateRange(db, userId, event.tripId, event.startDate, event.endDate);
      case 'trip.updateWindow':
        return await trip.updateWindow(db, userId, event.tripId, {
          startDate: event.startDate,
          endDate: event.endDate,
          expectedWindowUpdatedAt: event.expectedWindowUpdatedAt,
        });
      case 'trip.remove':
        // 显式删除行程（含其任务与提醒清单）：清理「进行中 0 / 已过期 0」的空壳行程
        return await trip.remove(db, userId, event.tripId);

      /* ======== 行程只读分享（PAGE-018） ======== */
      case 'tripShare.create':
        return await tripShare.create(db, userId, { tripId: event.tripId });
      case 'tripShare.status':
        return await tripShare.status(db, userId, { tripId: event.tripId });
      case 'tripShare.revoke':
        return await tripShare.revoke(db, userId, { tripId: event.tripId });
      case 'tripShare.open':
        return await tripShare.open(db, event.token);

      /* ======== 时间线 ======== */
      case 'timeline.generate':
        // 旧口径：按已落库的行程算。首页改纯预览后已无调用方，保留兼容。
        return await timeline.generate(db, userId, event.tripId, {
          spotStatusMap: event.spotStatusMap || {},
        });
      case 'timeline.preview':
        // 2026-09-20：按当前所选日期段与景点独立计算，不创建/改写行程，不带入任何已落库状态
        return await timeline.preview(db, userId, event);

      /* ======== 行程项（API-契约 8.4） ======== */
      case 'tripItem.markResult':
        return await itemActions.markResult(db, userId, event);
      case 'tripItem.undoResult':
        return await itemActions.undoResult(db, userId, event);
      case 'tripItem.updateReminder':
        return await itemActions.updateReminder(db, userId, { ...event, requireSubscription: true });
      case 'tripItem.remove':
        return await itemActions.remove(db, userId, event);
      case 'tripItem.removeVisitDate':
        return await itemActions.removeVisitDate(db, userId, event);
      case 'tripItem.recoveryCandidates':
        return await recovery.candidates(db, userId, event);

      /* ======== 首页聚合（一次调用返回全部，减少冷启动） ======== */
      case 'home.bootstrap':
        return await homeBootstrap(db, userId, event);

      /* ======== 提醒清单 ======== */
      case 'cart.planDates':
        return await cart.planDates(db, userId, event);
      case 'cart.planQuickDates':
        return await cart.planQuickDates(db, userId, event);
      case 'cart.addDates': {
        const result = await cart.addDates(db, userId, event);
        if (!result.success) return result;
        return ok({
          ...result,
          statusPatches: (result.items || []).map(row => ({
            cartId: row.cartId,
            spotId: result.spotId,
            visitDate: row.visitDate,
            status: EventSelectStatus.IN_CART,
            button: timeline.buttonOf(EventSelectStatus.IN_CART, {
              reservationRequired: row.reservationRequired !== false,
              remindable: !!row.releaseAt,
            }),
          })),
        });
      }
      case 'cart.add': {
        const result = await cart.add(db, userId, event);
        if (!result.success) return result;
        const previewEvent = {
          reservationRequired: result.reservationRequired !== false,
          remindable: !!result.releaseAt,
        };
        return ok({
          ...result,
          statusPatches: [{
            cartId: result.cartId,
            spotId: result.spotId,
            visitDate: result.visitDate,
            status: EventSelectStatus.IN_CART,
            button: timeline.buttonOf(EventSelectStatus.IN_CART, previewEvent),
          }],
        });
      }
      case 'cart.addAll': {
        // CART-RULE-004「一键加入清单」：仅作用于当前 Tab。
        // 服务端按同一份输入重新算一遍预览事件，避免信任前端传来的事件与状态。
        // scope: 'departure'（scopeKey = visitDate）| 'spot'（scopeKey = spotId）
        const tl = await timeline.preview(db, userId, event);
        if (!tl.success) return tl;
        const result = await cart.addBatch(
          db, userId, event.tripId, tl.events, event.scope, event.scopeKey,
          { supportsMultiRelease: event.supportsMultiRelease === true }
        );
        if (!result.success) return result;
        const eventMap = new Map((tl.events || []).map(ev => [
          `${ev.spotId}|${ev.visitDate}`,
          ev,
        ]));
        const statusPatches = (result.affectedKeys || []).map(row => {
          const event = eventMap.get(`${row.spotId}|${row.visitDate}`) || {};
          return {
            ...row,
            status: EventSelectStatus.IN_CART,
            button: timeline.buttonOf(EventSelectStatus.IN_CART, event),
          };
        });
        return ok({ ...result, statusPatches });
      }
      case 'cart.remove': {
        const result = await cart.remove(db, userId, event.cartId);
        if (!result.success) return result;
        return ok({
          ...result,
          statusPatches: [{
            spotId: result.spotId,
            visitDate: result.visitDate,
            status: EventSelectStatus.SELECTABLE,
            button: timeline.buttonOf(EventSelectStatus.SELECTABLE, {
              reservationRequired: result.reservationRequired !== false,
              remindable: !!result.releaseAt,
            }),
          }],
        });
      }
      case 'cart.clear': {
        const result = await cart.clear(db, userId, event.tripId || null);
        if (!result.success) return result;
        return ok({
          ...result,
          statusPatches: (result.removedRows || []).map(row => ({
            spotId: row.spotId,
            visitDate: row.visitDate,
            status: EventSelectStatus.SELECTABLE,
            button: timeline.buttonOf(EventSelectStatus.SELECTABLE, {
              reservationRequired: row.reservationRequired !== false,
              remindable: !!row.releaseAt,
            }),
          })),
        });
      }
      case 'cart.pruneScope':
        // CART-RULE-007：生成时间线成功后，把暂存区收敛到本次日期段 × 景点集合
        return await cart.pruneScope(db, userId, event);
      case 'cart.list':
        return await cart.list(db, userId, event.tripId || null, {
          includeMembership: event.includeMembership === true,
          membershipCapabilities: event.membershipCapabilities,
          supportsMultiRelease: event.supportsMultiRelease === true,
        });
      case 'cart.bootstrap':
        return await cartBootstrap(userId, event);
      case 'cart.updateRemindOn':
        return await cart.updateRemindOn(
          db,
          userId,
          event.cartId,
          event.remindOn === true,
          { supportsMultiRelease: event.supportsMultiRelease === true }
        );
      case 'cart.commit': {
        const res = await task.submit(db, userId, { ...event, requireSubscription: true });
        if (!res.success) return res;
        return ok(res);
      }
      case 'cart.quickCommit': {
        const res = await task.submitQuick(db, userId, { ...event, requireSubscription: true });
        if (!res.success) return res;
        return ok(res);
      }

      /* ======== 提醒任务 ======== */
      case 'task.submit': {
        // 兼容旧页面；语义已与 cart.commit 相同。
        const res = await task.submit(db, userId, event);
        if (!res.success) return res;
        return ok(res);
      }
      case 'task.list':
        return await task.list(db, userId, {
          tripId: event.tripId || null,
          filter: event.filter || 'active',
        });
      case 'task.remove': {
        const res = await task.remove(db, userId, event.taskId);
        if (!res.success) return res;
        // TRIP-RULE-004 级联：行程是否为空**只看 trip_items**，
        // 否则只有免预约景点、没设提醒的行程会被误判成空的删掉（决策文档第六节）
        const tripRemoved = await trip.purgeIfNoItem(db, userId, res.tripId);
        if (tripRemoved) await cart.clearPendingIfNoItems(db, userId);
        return ok({ ...res, tripRemoved });
      }
      case 'task.clear': {
        const res = await task.clear(db, userId, {
          filter: event.filter || null,
          tripId: event.tripId || null,
        });
        if (!res.success) return res;
        // TRIP-RULE-004 级联（主动删除口径）：清空后行程内已无任何任务
        // → 行程与提醒清单一并删除（前端弹窗已明确告知该结果）
        const removedTripIds = [];
        for (const tid of (res.affectedTripIds || [])) {
          if (await trip.purgeIfNoItem(db, userId, tid)) removedTripIds.push(tid);
        }
        if (removedTripIds.length > 0) await cart.clearPendingIfNoItems(db, userId);
        return ok({ ...res, removedTripIds });
      }

      /* ======== 用户 ======== */
      case 'user.profile': {
        const profile = await getOrCreateUser(userId);
        const current = await membership.status(db, userId, undefined, {
          includeUpgradeNotice: true,
          membershipCapabilities: event.membershipCapabilities,
        });
        return ok({
          user: {
            ...profile.user,
            membership: current.membership,
            membershipSales: current.sales,
          },
          ...(current.upgradeNotice
            ? { membershipUpgradeNotice: current.upgradeNotice }
            : {}),
        });
      }
      case 'user.bootstrap':
        return await userBootstrap(userId, event);
      case 'user.updateProfile':
        return await updateUserProfile(userId, event);
      case 'user.updateNotifyPrefs':
        return await updateNotifyPrefs(userId, event.notifyPrefs || {});

      /* ======== 会员 / 提醒名额 ======== */
      case 'membership.status':
        return await membership.status(db, userId, undefined, {
          membershipCapabilities: event.membershipCapabilities,
        });
      case 'membership.createOrder':
        return await membership.createOrder(db, userId, event);
      case 'membership.orders':
        return await membership.listOrders(db, userId);
      case 'membership.orderDetail':
        return await membership.orderDetail(db, userId, event.orderId);

      /* ======== 订阅消息额度（一次性订阅） ======== */
      case 'subscribe.add':
        return await addSubscribe(userId, event.templateId);
      case 'subscribe.get':
        return await getSubscribe(userId, event.templateId);

      /* ======== 运维 ======== */
      case 'admin.seed':
        return await seed();
      case 'admin.runtimeBackfill':
        return await backfillRuntime(event);
      case 'admin.cleanup': {
        const r = await task.cleanup(db);
        // 14 天前的历史任务被物理删除后，行程同样按「无任务即作废」口径清理
        for (const a of r.affected) {
          await trip.purgeIfNoItem(db, a.userId, a.tripId);
        }
        return ok(r);
      }

      default:
        return fail(ERRORS.UNKNOWN_ACTION);
    }
  } catch (err) {
    console.error(`[reminder] action=${action} failed`, err);
    return fail({ code: 1500, message: err.message });
  }
}

exports.main = event => {
  const action = String((event && event.action) || 'unknown');
  return resource.run(action, rawDb, async () => {
    const result = await main(event);
    if (userRuntime.modeOf() !== userRuntime.RuntimeMode.OFF
      && result && result.success !== false
      && USER_RUNTIME_MUTATIONS.has(action)) {
      const userId = cloud.getWXContext().OPENID;
      if (userId) await userRuntime.invalidate(rawDb, userId);
    }
    return result;
  });
};

/**
 * home.bootstrap V2 —— 首页行程状态墙一次调用聚合（API-契约 8.2）
 *
 * 并行拉取：行程项（含派生状态）、行程列表、全部任务（算送达状态与兜底收敛）、热门景点。
 *
 * 与 V1 的三点结构差异：
 *  ① 主数据从「提醒任务」换成「行程项」——首页的主体是「这趟成了没」，不是「什么时候动手」；
 *  ② 行程按 endDate 在**读取时**拆成进行中 / 历史，不依赖任何定时任务落状态；
 *  ③ 吸顶横幅跨全部当前/未来行程取全局最近，不按行程分开算。
 *
 * 热门景点内部复用 spots 云函数（难度标签/卡片逻辑的单一真身留在 spots），
 * 失败不阻断整体——首页少几个推荐卡片不该白屏。
 *
 * @returns 8.2 的返回体 + 一个版本兼容期的 homeMode
 */
async function homeBootstrap(db, userId, event = {}) {
  const mode = userRuntime.modeOf();
  const includeSpots = event.includeSpots === true;
  const t0 = Date.now();
  const timing = { firstCallInInstance: moduleFirstCall, includeSpots };
  moduleFirstCall = false;

  if (mode === userRuntime.RuntimeMode.ON) {
    try {
      return await runtimeHomeBootstrap(db, userId, event, t0, timing);
    } catch (err) {
      console.error('[home-runtime] read-failed; fallback legacy', err && err.message);
    }
  }
  if (mode === userRuntime.RuntimeMode.SHADOW) {
    const legacyPromise = legacyHomeBootstrap(db, userId, event, t0, timing);
    const shadowPromise = runtimeHomeBootstrap(
      db, userId, { ...event, __shadow: true }, t0, { ...timing }
    )
      .catch(err => ({ success: false, error: err && err.message }));
    const [legacy, shadow] = await Promise.all([legacyPromise, shadowPromise]);
    if (shadow && shadow.success !== false) {
      const comparableShadow = { ...shadow, serverNow: legacy.serverNow };
      const legacyHash = userRuntime.normalizedHash(userRuntime.comparisonShape(legacy));
      const shadowHash = userRuntime.normalizedHash(userRuntime.comparisonShape(comparableShadow));
      console.log('[home-runtime-shadow]', JSON.stringify({
        match: legacyHash === shadowHash,
        legacyHash,
        shadowHash,
      }));
    }
    return legacy;
  }
  return legacyHomeBootstrap(db, userId, event, t0, timing);
}

async function runtimeHomeBootstrap(db, userId, event, t0, timing) {
  let doc = event.runtimeBypass === true ? null : await userRuntime.read(db, userId);
  if (!userRuntime.isUsable(doc)) {
    const sources = await loadHomeSources(db, userId);
    const initial = await composeHomeBootstrap(db, userId, sources, event, t0, timing, {
      runtimeVersion: 'runtime:rebuilding',
    });
    const builtAt = time.now();
    const compact = compactRuntimeSources(sources, initial.history, builtAt);
    doc = await userRuntime.write(db, userId, compact, builtAt);
    return {
      ...initial,
      runtimeVersion: `runtime:${builtAt.getTime()}`,
    };
  }
  return composeHomeBootstrap(db, userId, doc.sources, event, t0, timing, {
    runtimeVersion: `runtime:${new Date(doc.builtAt).getTime()}`,
  });
}

function compactRuntimeSources(sources, history, nowTs) {
  const today = time.todayStr(nowTs);
  const trips = (sources.trips || []).filter(
    tripRow => tripWindow.effectiveEndDateOf(tripRow) >= today
  );
  const tripIds = new Set(trips.map(tripRow => tripRow._id));
  const items = (sources.items || []).filter(row => tripIds.has(row.tripId));
  const itemIds = new Set(items.map(row => row._id));
  const allTasks = (sources.allTasks || []).filter(row => itemIds.has(row.itemId));
  const carts = (sources.carts || []).filter(row =>
    row.tripId === PENDING_CART_TRIP_ID || tripIds.has(row.tripId));
  return {
    user: sources.user || {},
    items,
    allTasks,
    carts,
    trips,
    history: history || [],
  };
}

async function legacyHomeBootstrap(db, userId, event, t0, timing) {
  const sourceStartedAt = Date.now();
  const sources = await loadHomeSources(db, userId);
  timing.parallelMs = Date.now() - sourceStartedAt;
  return composeHomeBootstrap(db, userId, sources, event, t0, timing, {
    runtimeVersion: 'legacy',
  });
}

async function loadHomeSources(db, userId) {
  const [items, carts, userRes, taskRes] = await Promise.all([
    item.listItemsByUser(db, userId),
    db.collection(COLLECTIONS.REMINDER_CART)
      .where({ userId }).get()
      .then(r => r.data || [])
      .catch(() => []),
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId }).get(),
  ]);
  const allTasks = taskRes.data || [];
  const tripsRes = await trip.list(db, userId, { items, tasks: allTasks, carts });
  return {
    items,
    carts,
    user: (userRes.data || [])[0] || {},
    allTasks,
    trips: (tripsRes && tripsRes.trips) || [],
  };
}

async function composeHomeBootstrap(db, userId, sources, event, t0, timing, options = {}) {
  const includeSpots = event.includeSpots === true;
  const nowTs = time.now();
  const today = time.todayStr(nowTs);
  const items = sources.items || [];
  const allTasks = sources.allTasks || [];
  const trips = sources.trips || [];
  const user = sources.user || {};
  const hasStoredHistory = Object.prototype.hasOwnProperty.call(sources, 'history');
  const tSpotCtx = Date.now();
  const spotsPromise = includeSpots
    ? (resource.childCall(), cloud.callFunction({ name: 'spots', data: { action: 'list' } }).catch(() => null))
    : Promise.resolve(null);
  const [{ spotMap, ruleMap }, spotsCall] = await Promise.all([
    item.loadSpotContext(db, items.map(row => row.spotId)),
    spotsPromise,
  ]);
  timing.spotCtxMs = Date.now() - tSpotCtx;

  const tSweep = Date.now();
  const swept = event.__shadow ? 0 : await task.sweepOverdue(
    db, allTasks, nowTs, userId, taskRow => {
      const spot = spotMap[taskRow.spotId];
      return spot
        ? item.releaseAtForTask(spot, ruleMap[taskRow.spotId], taskRow)
        : null;
    }
  );
  timing.sweepMs = Date.now() - tSweep;
  if (swept > 0 && options.runtimeVersion) {
    await userRuntime.invalidate(db, userId, nowTs);
  }
  timing.trips = trips.length;
  timing.items = items.length;
  timing.tasks = allTasks.length;
  timing.totalMs = Date.now() - t0;
  console.log('[bootstrap-timing]', JSON.stringify(timing));

  const quotaHealth = task.worstReminderHealthOf(
    allTasks,
    templateId => subscribeQuotaOf(user, templateId),
    nowTs
  );
  const taskMap = item.tasksMapByItemId(allTasks);
  const decorated = items.map(row => item.decorateItem({
    item: row,
    spot: spotMap[row.spotId],
    rule: ruleMap[row.spotId],
    tasks: taskMap[row._id] || [],
    nowTs,
    supportsMultiRelease: event.supportsMultiRelease === true,
  }));
  const recoverableIds = Object.keys(recovery.recoverableMapOf({
    decorated,
    trips,
    spotMap,
    ruleMap,
    nowTs,
    supportsMultiRelease: event.supportsMultiRelease === true,
  }));

  const activeTrips = [];
  const historyTrips = hasStoredHistory ? [...(sources.history || [])] : [];
  for (const tripRow of trips) {
    const mine = decorated.filter(row => row.tripId === tripRow._id);
    const window = tripWindow.windowOf(tripRow);
    const windowItems = mine.filter(row => tripWindow.inWindow(row.visitDate, window));
    const entry = {
      _id: tripRow._id,
      city: tripRow.city,
      startDate: tripRow.startDate,
      endDate: tripRow.endDate,
      windowStartDate: window.startDate,
      windowEndDate: window.endDate,
      windowUpdatedAt: tripRow.windowUpdatedAt || null,
      windowVersion: tripWindow.versionOfTrip(tripRow),
      name: tripRow.name,
      progress: item.backupGroupProgress(mine),
      windowProgress: item.backupGroupProgress(windowItems),
      itemCount: mine.length,
      windowItemCount: windowItems.length,
      outsideItemCount: mine.length - windowItems.length,
      shareActive: tripShare.isShareActive(tripRow, today),
      /* 2026-09-21：首页「+ 新增提醒」要拿它预填 add-trip 的景点标签。
         只给 id，页面再走 spots.batch 取名字——这里多查一次会让 bootstrap 变重，
         而预填只发生在用户点按钮之后，没有必要让每次首页加载都背上它。 */
      spotIds: [...new Set(mine.map(row => row.spotId))],
    };
    const sortedItems = item.sortItems(mine).map(row => ({
      ...row,
      windowPosition: tripWindow.positionOf(row.visitDate, window),
    }));
    if (tripWindow.effectiveEndDateOf(tripRow) >= today) {
      activeTrips.push({ ...entry, items: sortedItems });
    }
    else if (!hasStoredHistory) historyTrips.push(entry);
  }
  activeTrips.sort((a, b) => String(a.windowStartDate || a.startDate)
    .localeCompare(String(b.windowStartDate || b.startDate)));
  historyTrips.sort((a, b) => String(b.windowStartDate || b.startDate)
    .localeCompare(String(a.windowStartDate || a.startDate)));
  historyTrips.forEach((entry) => {
    entry.shareActive = entry.shareActive === true;
    if (!entry.windowStartDate || !entry.windowEndDate) {
      const window = tripWindow.windowOf(entry);
      entry.windowStartDate = window.startDate;
      entry.windowEndDate = window.endDate;
    }
    if (!entry.windowProgress) entry.windowProgress = entry.progress;
  });
  const primaryTripId = activeTrips.length ? activeTrips[0]._id : '';
  const primaryTripRow = trips.find(row => row._id === primaryTripId) || null;
  const primaryWindow = tripWindow.windowOf(primaryTripRow);
  const primaryWindowItems = primaryTripId
    ? decorated.filter(row => row.tripId === primaryTripId
      && tripWindow.inWindow(row.visitDate, primaryWindow))
    : [];

  return ok({
    serverNow: nowTs,
    runtimeVersion: options.runtimeVersion || 'legacy',
    primaryTripId,
    scrollTargetId: item.scrollTargetOf(decorated, nowTs),
    trips: activeTrips,
    history: historyTrips,
    stickyBanner: task.buildReleaseBanner(decorated, nowTs),
    releasePills: task.buildReleasePills(decorated, nowTs, 2),
    windowReleasePills: task.buildReleasePills(primaryWindowItems, nowTs, 2),
    reminderQuotaWarning: task.buildReminderQuotaWarning(quotaHealth, nowTs),
    membership: membership.snapshotFromTasks(user, allTasks, nowTs, {
      newPlan: membership.isNewPlanEnabledFor(userId, event),
    }),
    recoverableIds,
    homeMode: decorated.length === 0 ? 1 : 2,
    hotSpots: spotsCall && spotsCall.result && Array.isArray(spotsCall.result.data)
      ? spotsCall.result.data : [],
    groups: [],
    counts: { active: 0, expired: 0 },
    banner: null,
    cart: null,
    tripTasks: null,
    showGroupTabs: false,
  });
}

/**
 * 用户页一次初始化：资料、会员、名额和订阅健康共享同一批用户 / 任务读取。
 */
async function userBootstrap(userId, event = {}) {
  const nowTs = time.now();
  const profile = await getOrCreateUser(userId);
  if (profile.success === false) return profile;
  const rawUser = profile.user;
  const [activeTaskRes, latestTaskRes] = await Promise.all([
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({
        userId,
        backendStatus: ReminderBackendStatus.WAITING,
        releaseAt: db.command.gt(nowTs),
      })
      .get(),
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  ]);
  const activeTasks = activeTaskRes.data || [];
  const latestTask = (latestTaskRes.data || [])[0] || null;
  const [current, subscription] = await Promise.all([
    membership.status(db, userId, nowTs, {
      user: rawUser,
      activeTasks,
      latestTask,
      configCache: true,
      includeUpgradeNotice: true,
      membershipCapabilities: event.membershipCapabilities,
    }),
    task.subscriptionStatus(db, userId, DEFAULT_SUBSCRIBE_TEMPLATE_ID, {
      user: rawUser,
      activeTasks,
    }),
  ]);
  if (current.success === false) return current;
  return ok({
    user: {
      ...rawUser,
      membership: current.membership,
      membershipSales: current.sales,
    },
    membership: current.membership,
    packages: current.packages,
    sales: current.sales,
    ...(current.upgradeNotice
      ? { membershipUpgradeNotice: current.upgradeNotice }
      : {}),
    subscription,
    capabilities: {
      /* 管理端白名单分属 payment / feedback 部署单元，客户端可缓存一次能力探测。 */
      adminStatusKnown: false,
    },
    runtimeVersion: `legacy:${nowTs.getTime()}`,
  });
}

/**
 * 设置提醒页一次初始化：清单、会员与订阅授权合并在同一个云函数调用内。
 */
async function cartBootstrap(userId, event = {}) {
  const [cartResult, subscription] = await Promise.all([
    cart.list(db, userId, null, {
      includeMembership: true,
      membershipCapabilities: event.membershipCapabilities,
      supportsMultiRelease: event.supportsMultiRelease === true,
    }),
    task.subscriptionStatus(db, userId, DEFAULT_SUBSCRIBE_TEMPLATE_ID),
  ]);
  if (cartResult.success === false) return cartResult;
  return ok({
    ...cartResult,
    subscription,
    runtimeVersion: `legacy:${Date.now()}`,
  });
}

/** TABLE-005 用户表：首次调用时惰性创建（无感登录：自动生成昵称+随机默认头像，无任何弹窗） */
async function getOrCreateUser(userId) {
  const existing = await userDomain.findUser(db, userId);
  if (existing) {
    const u = existing;
    /* 惰性迁移旧数据：昵称为空或「游客」-> 补自动资料，用户无感知 */
    if (!u.nickname || u.nickname === '游客') {
      const patch = genAutoProfile();
      patch.profileUpdatedAt = time.now();
      await db.collection(COLLECTIONS.USERS).doc(u._id).update({ data: patch });
      return ok({ user: { ...u, ...patch } });
    }
    return ok({ user: u });
  }
  const u = await userDomain.ensureUser(db, userId, { nowTs: time.now() });
  return ok({ user: u });
}

/**
 * 无感登录自动资料：昵称 = 「用户」+ 6 位随机字符（小写字母+数字，去易混淆 0/o/1/l），
 * 头像 = 随机默认占位图（主包内本地路径 /images/avatars/default-{1..6}.png，前端 <image> 直接渲染）。
 * 昵称允许重复（无唯一约束）；用户可在「编辑资料」页自行修改头像/昵称/手机号。
 */
async function updateNotifyPrefs(userId, prefs) {
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) await getOrCreateUser(userId);

  const target = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  await db.collection(COLLECTIONS.USERS).doc(target.data[0]._id).update({
    data: { notifyPrefs: prefs },
  });
  return ok({ notifyPrefs: prefs });
}

/**
 * user.updateProfile —— 保存头像/昵称/手机号（「编辑资料」页）
 * 昵称必填且允许重复；头像为云存储 fileID 或主包默认占位图路径，可空（空则前端显示占位）；
 * 手机号选填，填了须为大陆 11 位手机号格式。
 */
async function updateUserProfile(userId, data = {}) {
  const nickname = (data.nickname || '').trim().slice(0, 32);
  if (!nickname) return fail({ code: ERRORS.BAD_PARAM.code, message: '昵称不能为空' });
  const avatarUrl = typeof data.avatarUrl === 'string' ? data.avatarUrl.slice(0, 512) : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    return fail({ code: ERRORS.BAD_PARAM.code, message: '手机号格式不正确' });
  }

  let res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) await getOrCreateUser(userId);
  const target = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  const u = target.data[0];
  await db.collection(COLLECTIONS.USERS).doc(u._id).update({
    data: {
      nickname,
      avatarUrl,
      phone,
      profileUpdatedAt: time.now(),
    },
  });
  return ok({ user: { ...u, nickname, avatarUrl, phone } });
}

/* 订阅消息额度台账的唯一真身（2026-09-16 从本文件内联抽出到 lib/quota.js，
   因为 lib/task.js 的读取时兜底 sweepOverdue 也需要同一套判定） */
/**
 * subscribe.add —— 用户授权某个模板后 +1 一次性额度。
 * 同时维护旧 subscribeQuota 总数，兼容现有页面和旧数据。
 */
async function addSubscribe(userId, templateId) {
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  let res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) await getOrCreateUser(userId);
  const target = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  const u = target.data[0];
  const quotas = Object.assign({}, u.subscribeQuotas || {});
  const quota = subscribeQuotaOf(u, tpl) + 1;
  quotas[tpl] = quota;
  const totalQuota = totalSubscribeQuota(quotas, u.subscribeQuota);
  await db.collection(COLLECTIONS.USERS).doc(u._id).update({
    data: {
      subscribeQuota: totalQuota,
      subscribeQuotas: quotas,
      subscribeTemplateId: tpl,
      subscribeUpdatedAt: time.now(),
    },
  });
  return ok({ quota, totalQuota, quotas, templateId: tpl });
}

/** subscribe.get —— 查询当前用户某个模板的本地额度 */
async function getSubscribe(userId, templateId) {
  return task.subscriptionStatus(db, userId, templateId);
}

/**
 * admin.seed —— 幂等导入初始数据
 * 读随函数打包的 data/*.json，按 spotId upsert 到 spots / release_rules。
 * 重跑不产生重复，可安全用于数据修正后的重新导入。
 */
async function seed() {
  const spotsJson = require('./data/spots.json');
  const rulesJson = require('./data/rules.json');

  const report = { spots: { inserted: 0, updated: 0 }, rules: { inserted: 0, updated: 0 } };

  for (const s of spotsJson.spots) {
    const exist = await db.collection(COLLECTIONS.SPOTS).where({ spotId: s.spotId }).get();
    if ((exist.data || []).length) {
      await db.collection(COLLECTIONS.SPOTS).doc(exist.data[0]._id).update({ data: s });
      report.spots.updated += 1;
    } else {
      await db.collection(COLLECTIONS.SPOTS).add({ data: s });
      report.spots.inserted += 1;
    }
  }

  for (const r of rulesJson.rules) {
    const exist = await db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: r.spotId }).get();
    if ((exist.data || []).length) {
      await db.collection(COLLECTIONS.RELEASE_RULES).doc(exist.data[0]._id).update({ data: r });
      report.rules.updated += 1;
    } else {
      await db.collection(COLLECTIONS.RELEASE_RULES).add({ data: r });
      report.rules.inserted += 1;
    }
  }

  return ok({ report, message: `seed 完成：${report.spots.inserted + report.spots.updated} 景点 / ${report.rules.inserted + report.rules.updated} 规则` });
}

/**
 * 受环境 token 保护的首页读模型分批预建。
 * 客户端不可用；用于 shadow 前给老用户预热，按系统 _id 游标幂等推进。
 */
async function backfillRuntime(event = {}) {
  const expected = String(process.env.RUNTIME_BACKFILL_TOKEN || '');
  if (!expected || String(event.token || '') !== expected) return fail(ERRORS.FORBIDDEN);
  const limit = Math.max(1, Math.min(50, Number(event.limit) || 20));
  let query = db.collection(COLLECTIONS.USERS);
  if (event.cursor) query = query.where({ _id: db.command.gt(String(event.cursor)) });
  const res = await query.orderBy('_id', 'asc').limit(limit).get();
  const users = res.data || [];
  let built = 0;
  const errors = [];
  for (const stored of users) {
    if (!stored.openId) continue;
    try {
      const result = await runtimeHomeBootstrap(
        db,
        stored.openId,
        { runtimeBypass: true, __shadow: true },
        Date.now(),
        { firstCallInInstance: false, includeSpots: false }
      );
      if (result && result.success !== false) built += 1;
    } catch (err) {
      errors.push({ userId: stored._id, message: err && err.message });
    }
  }
  return ok({
    scanned: users.length,
    built,
    errors,
    nextCursor: users.length ? users[users.length - 1]._id : null,
    hasMore: users.length === limit,
  });
}
