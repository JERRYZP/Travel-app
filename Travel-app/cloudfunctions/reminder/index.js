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

const { COLLECTIONS, V1, ERRORS, ChannelType, ok, fail } = require('./lib/schema');
const time = require('./lib/time');
const trip = require('./lib/trip');
const timeline = require('./lib/timeline');
const cart = require('./lib/cart');
const task = require('./lib/task');

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
        return await timeline.generate(db, userId, event.tripId, {
          spotStatusMap: event.spotStatusMap || {},
        });

      /* ======== 首页聚合（一次调用返回全部，减少冷启动） ======== */
      case 'home.bootstrap':
        return await homeBootstrap(db, userId, event);

      /* ======== 提醒清单 ======== */
      case 'cart.add':
        return await cart.add(db, userId, event);
      case 'cart.addAll': {
        // CART-RULE-004 仅作用于当前 Tab：服务端重新生成时间线，避免信任前端传入的事件
        // scope: 'departure'（scopeKey = visitDate）| 'spot'（scopeKey = spotId）
        const tl = await timeline.generate(db, userId, event.tripId, {});
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
        // TRIP-RULE-004 级联（主动删除口径）：行程内已无任何任务 → 行程与提醒清单一并删除
        const tripRemoved = await trip.purgeIfNoTask(db, userId, res.tripId);
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
          if (await trip.purgeIfNoTask(db, userId, tid)) removedTripIds.push(tid);
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
          await trip.purgeIfNoTask(db, a.userId, a.tripId);
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
 * home.bootstrap —— 首页一次调用聚合，替代 3~5 次串行 callFunction。
 * 并行拉取：全部任务(算 homeMode/counts/banner)、选中行程分组、行程列表、内联清单、热门景点。
 * 热门景点内部复用 spots 云函数（难度标签/卡片逻辑单一真身留在 spots），失败不阻断整体，
 * 前端在 hotSpots 为空时回退 loadHotSpots()。
 */
async function homeBootstrap(db, userId, event = {}) {
  const filter = event.filter || 'active';
  const activeTripTab = event.activeTripTab || '';
  const tripId = event.tripId || '';       // 内联时间线的清单 tripId（keepInline 时）
  const includeSpots = event.includeSpots !== false;

  const tasksAllP = task.list(db, userId, { tripId: null, filter });
  const tripsP = trip.list(db, userId);
  const cartP = tripId ? cart.list(db, userId, tripId) : Promise.resolve(null);
  const tripTasksP = activeTripTab
    ? task.list(db, userId, { tripId: activeTripTab, filter })
    : Promise.resolve(null);
  const spotsP = includeSpots
    ? cloud.callFunction({ name: 'spots', data: { action: 'list' } }).catch(() => null)
    : Promise.resolve(null);

  const [tasksAll, trips, cart, tripTasks, spotsCall] = await Promise.all([
    tasksAllP, tripsP, cartP, tripTasksP, spotsP,
  ]);

  return ok({
    // 首页形态与任务主数据（未按行程筛选）
    homeMode: (tasksAll && tasksAll.homeMode) || 1,
    groups: (tasksAll && tasksAll.groups) || [],
    counts: (tasksAll && tasksAll.counts) || { active: 0, expired: 0 },
    banner: (tasksAll && tasksAll.banner) || null,
    // 选中行程 Tab 时的分组（可能为 null）
    tripTasks: tripTasks && tripTasks.success ? tripTasks : null,
    trips: (trips && trips.trips) || [],
    showGroupTabs: (trips && trips.showGroupTabs) || false,
    // 内联清单（形态1/2 保留时间线时）
    cart,
    // 热门景点（内部调用 spots 云函数，失败不阻断整体）
    hotSpots: spotsCall && spotsCall.result && Array.isArray(spotsCall.result.data) ? spotsCall.result.data : [],
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

/** 订阅消息模板 ID（与 miniprogram/utils/notify.js、cloudfunctions/notifier 兜底常量对齐；2026-09-13 随换 appid 更新） */
const DEFAULT_SUBSCRIBE_TEMPLATE_ID = 'V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q';

/**
 * 读取某个模板的本地额度。
 * 新数据用 subscribeQuotas[templateId]；旧数据单模板回退到 subscribeQuota。
 */
function subscribeQuotaOf(user, templateId) {
  const quotas = user.subscribeQuotas || {};
  if (Object.prototype.hasOwnProperty.call(quotas, templateId)) {
    return Number(quotas[templateId]) || 0;
  }
  const legacyTemplateId = user.subscribeTemplateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  if (legacyTemplateId === templateId) return Number(user.subscribeQuota) || 0;
  return 0;
}

/** 各模板额度之和；无模板 map 时回退旧总数 */
function totalSubscribeQuota(quotas, fallback = 0) {
  const values = Object.values(quotas || {}).filter(v => typeof v === 'number' && v >= 0);
  if (!values.length) return Math.max(0, Number(fallback) || 0);
  return values.reduce((sum, v) => sum + v, 0);
}

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
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) return ok({ quota: 0, totalQuota: 0, quotas: {}, templateId: tpl });
  const u = res.data[0];
  const quotas = u.subscribeQuotas || {};
  return ok({
    quota: subscribeQuotaOf(u, tpl),
    totalQuota: totalSubscribeQuota(quotas, u.subscribeQuota),
    quotas,
    templateId: tpl,
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
