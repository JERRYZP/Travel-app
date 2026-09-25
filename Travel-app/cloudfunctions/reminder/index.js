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
const db = cloud.database();
const _ = db.command;

const { COLLECTIONS, V1, ERRORS, ChannelType, PENDING_CART_TRIP_ID, ok, fail } = require('./lib/schema');
const time = require('./lib/time');
const trip = require('./lib/trip');
const timeline = require('./lib/timeline');
const cart = require('./lib/cart');
const task = require('./lib/task');
const item = require('./lib/item');
const itemActions = require('./lib/trip-item-actions');
const recovery = require('./lib/recovery');
const {
  DEFAULT_SUBSCRIBE_TEMPLATE_ID,
  subscribeQuotaOf,
  totalSubscribeQuota,
} = require('./lib/quota');

exports.main = async (event) => {
  const { action } = event || {};
  const { OPENID } = cloud.getWXContext();

  // admin.seed 允许在无登录态的控制台调试中执行
  if (!OPENID && action !== 'admin.seed') return fail(ERRORS.UNAUTHORIZED);
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
      case 'trip.remove':
        // 显式删除行程（含其任务与提醒清单）：清理「进行中 0 / 已过期 0」的空壳行程
        return await trip.remove(db, userId, event.tripId);

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
        return await itemActions.updateReminder(db, userId, event);
      case 'tripItem.remove':
        return await itemActions.remove(db, userId, event);
      case 'tripItem.removeVisitDate':
        return await itemActions.removeVisitDate(db, userId, event);
      case 'tripItem.recoveryCandidates':
        return await recovery.candidates(db, userId, event.itemId);

      /* ======== 首页聚合（一次调用返回全部，减少冷启动） ======== */
      case 'home.bootstrap':
        return await homeBootstrap(db, userId, event);

      /* ======== 提醒清单 ======== */
      case 'cart.add':
        return await cart.add(db, userId, event);
      case 'cart.addAll': {
        // CART-RULE-004「一键加入清单」：仅作用于当前 Tab。
        // 服务端按同一份输入重新算一遍预览事件，避免信任前端传来的事件与状态。
        // scope: 'departure'（scopeKey = visitDate）| 'spot'（scopeKey = spotId）
        const tl = await timeline.preview(db, userId, event);
        if (!tl.success) return tl;
        return await cart.addBatch(db, userId, event.tripId, tl.events, event.scope, event.scopeKey);
      }
      case 'cart.remove':
        return await cart.remove(db, userId, event.cartId);
      case 'cart.clear':
        return await cart.clear(db, userId, event.tripId || null);
      case 'cart.list':
        return await cart.list(db, userId, event.tripId || null);
      case 'cart.updateRemindOn':
        return await cart.updateRemindOn(db, userId, event.cartId, event.remindOn === true);
      case 'cart.commit': {
        const res = await task.submit(db, userId, event);
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
        return ok({ ...res, removedTripIds });
      }

      /* ======== 用户 ======== */
      case 'user.profile':
        return await getOrCreateUser(userId);
      case 'user.updateProfile':
        return await updateUserProfile(userId, event);
      case 'user.updateNotifyPrefs':
        return await updateNotifyPrefs(userId, event.notifyPrefs || {});

      /* ======== 订阅消息额度（一次性订阅） ======== */
      case 'subscribe.add':
        return await addSubscribe(userId, event.templateId);
      case 'subscribe.get':
        return await getSubscribe(userId, event.templateId);

      /* ======== 运维 ======== */
      case 'admin.seed':
        return await seed();
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
  const includeSpots = event.includeSpots !== false;
  const nowTs = time.now();
  const today = time.todayStr();

  const [tripsRes, items, spotsCall, userRes] = await Promise.all([
    trip.list(db, userId),
    item.listItemsByUser(db, userId),
    includeSpots
      ? cloud.callFunction({ name: 'spots', data: { action: 'list' } }).catch(() => null)
      : Promise.resolve(null),
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
  ]);

  const trips = (tripsRes && tripsRes.trips) || [];

  /* 读取时兜底收敛（REMINDER-RULE-004）：
     V2 首页不再调 task.list，而 task.list 原本是 sweepOverdue 的唯一读取侧调用方。
     少了这一步，一旦 notifier 的定时链路出问题（缺索引 / 缺环境变量 / 触发器停用），
     过期任务会静默显示成「待提醒」且毫无提示 —— 正是 2026-09-14 踩过的坑。
     幂等，写库失败也不影响本次响应。 */
  const taskRes = await db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId }).get();
  const allTasks = taskRes.data || [];
  const { spotMap, ruleMap } = await item.loadSpotContext(db, items.map(i => i.spotId));
  await task.sweepOverdue(db, allTasks, nowTs, userId, (t) => {
    const spot = spotMap[t.spotId];
    return spot ? item.deriveReleaseAt(spot, ruleMap[t.spotId], t.visitDate) : null;
  });
  const user = (userRes.data || [])[0] || {};
  const quotaHealth = task.reminderHealthOf(
    allTasks,
    subscribeQuotaOf(user, DEFAULT_SUBSCRIBE_TEMPLATE_ID),
    nowTs
  );

  const taskMap = item.taskMapByItemId(allTasks);
  const decorated = items.map(it => item.decorateItem({
    item: it,
    spot: spotMap[it.spotId],
    rule: ruleMap[it.spotId],
    task: taskMap[it._id] || null,
    nowTs,
  }));

  /* 「还有别的日期可约」——候选与它要解释的那条行程项**同一次响应**到达
     （`lib/recovery.js` 的 `recoverableMapOf`，那里记着为什么不能挪回页面侧）。
     算在这里的另一个好处：bootstrap 已经把 spot/rule 上下文和全部行程项读齐了，
     逐条走 `tripItem.recoveryCandidates` 会把同一批数据重复查 N 遍。 */
  const recoverableIds = Object.keys(recovery.recoverableMapOf({
    decorated, trips, spotMap, ruleMap, nowTs,
  }));

  // 行程按结束日拆进行中 / 历史（读取时计算，不落库、不依赖定时任务）
  const activeTrips = [];
  const historyTrips = [];
  for (const t of trips) {
    const mine = decorated.filter(d => d.tripId === t._id);
    const progress = item.backupGroupProgress(mine);
    const entry = {
      _id: t._id,
      city: t.city,
      startDate: t.startDate,
      endDate: t.endDate,
      name: t.name,
      progress,
      itemCount: mine.length,
      /* 2026-09-21：首页「+ 新增提醒」要拿它预填 add-trip 的景点标签。
         只给 id，页面再走 spots.batch 取名字——这里多查一次会让 bootstrap 变重，
         而预填只发生在用户点按钮之后，没有必要让每次首页加载都背上它。 */
      spotIds: [...new Set(mine.map(i => i.spotId))],
    };
    // 结束日**当天仍属于进行中**，用户还能回看和补标；次日才归入历史
    if (t.endDate >= today) activeTrips.push({ ...entry, items: item.sortItems(mine) });
    else historyTrips.push(entry);
  }
  activeTrips.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  historyTrips.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

  // 全局摘要卡用最近的一趟；历史区只给统计，不重复整张卡
  const primaryTripId = activeTrips.length ? activeTrips[0]._id : '';
  const scrollTargetId = item.scrollTargetOf(decorated, nowTs);

  return ok({
    serverNow: nowTs,
    primaryTripId,
    scrollTargetId,
    trips: activeTrips,
    history: historyTrips,
    stickyBanner: task.buildReleaseBanner(decorated, nowTs),
    /* 摘要卡底部的「即将提醒」胶囊（设计稿 UI/V.0.2-0919）。
       ⚠️ 与 stickyBanner **平级、独立**：横幅受 BANNER_WINDOW_HOURS(1h) 限制只覆盖眼下，
       胶囊不限窗口，回答的是「后面还有哪几场」。塞进 stickyBanner 会让没有 1h 内放票
       的行程一颗胶囊都不显示——那正是设计稿上要展示的情况。 */
    releasePills: task.buildReleasePills(decorated, nowTs, 2),
    reminderQuotaWarning: task.buildReminderQuotaWarning(quotaHealth, nowTs),
    /* 「没抢到」之后还能换哪些日期（决策文档 4.3）。
       ⚠️ **必须在这一次响应里给**：页面侧另开一次请求去算候选，会与已经带着
       `result = FAILED` 的这份返回体错序——卡片先按「不可挽回」渲染，挽回线
       （气泡 + 菜单项）就永远不出现。真身 `lib/recovery.js` 的 `recoverableMapOf`。 */
    recoverableIds,
    // 兼容期：新首页靠 trips.length 判断要不要出创建引导，旧前端仍读 homeMode
    homeMode: decorated.length === 0 ? 1 : 2,
    hotSpots: spotsCall && spotsCall.result && Array.isArray(spotsCall.result.data)
      ? spotsCall.result.data : [],
    // 旧字段保留一个版本，避免未升级的调用方读不到东西；新首页不消费
    groups: [],
    counts: { active: 0, expired: 0 },
    banner: null,
    cart: null,
    tripTasks: null,
    showGroupTabs: false,
  });
}

/** TABLE-005 用户表：首次调用时惰性创建（无感登录：自动生成昵称+随机默认头像，无任何弹窗） */
async function getOrCreateUser(userId) {
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if ((res.data || []).length > 0) {
    const u = res.data[0];
    /* 惰性迁移旧数据：昵称为空或「游客」-> 补自动资料，用户无感知 */
    if (!u.nickname || u.nickname === '游客') {
      const patch = genAutoProfile();
      patch.profileUpdatedAt = time.now();
      await db.collection(COLLECTIONS.USERS).doc(u._id).update({ data: patch });
      return ok({ user: { ...u, ...patch } });
    }
    return ok({ user: u });
  }
  const data = {
    openId: userId,
    ...genAutoProfile(),
    phone: '',
    notifyPrefs: {
      officialAccount: false,
      sms: false,
      offsets: [...V1.ALLOWED_OFFSETS],
    },
    subscribeQuota: 0,
    memberLevel: V1.MEMBER_LEVEL_DEFAULT, // V1 固定 NORMAL
    points: 0,                            // V1 固定 0
    createdAt: time.now(),
  };
  const add = await db.collection(COLLECTIONS.USERS).add({ data });
  return ok({ user: { _id: add._id, ...data } });
}

/**
 * 无感登录自动资料：昵称 = 「用户」+ 6 位随机字符（小写字母+数字，去易混淆 0/o/1/l），
 * 头像 = 随机默认占位图（主包内本地路径 /images/avatars/default-{1..6}.png，前端 <image> 直接渲染）。
 * 昵称允许重复（无唯一约束）；用户可在「编辑资料」页自行修改头像/昵称/手机号。
 */
function genAutoProfile() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return {
    nickname: '用户' + suffix,
    avatarUrl: '/images/avatars/default-' + (1 + Math.floor(Math.random() * 6)) + '.png',
  };
}

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
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  const [res, taskRes] = await Promise.all([
    db.collection(COLLECTIONS.USERS).where({ openId: userId }).get(),
    db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId }).get(),
  ]);
  const u = (res.data || [])[0] || {};
  const quotas = u.subscribeQuotas || {};
  const quota = subscribeQuotaOf(u, tpl);
  const health = task.reminderHealthOf(taskRes.data || [], quota, time.now());
  return ok({
    quota,
    totalQuota: totalSubscribeQuota(quotas, u.subscribeQuota),
    quotas,
    templateId: tpl,
    pendingMessageCount: health.pendingMessageCount,
    nearestRemindAt: health.nearestRemindAt,
    level: health.level,
    shortfall: health.shortfall,
    replenishNeeded: health.replenishNeeded,
  });
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
