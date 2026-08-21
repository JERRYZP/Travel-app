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
        return await trip.createOrMerge(db, userId, event);
      case 'trip.list':
        return await trip.list(db, userId);
      case 'trip.updateSpots':
        return await trip.updateSpots(db, userId, event.tripId, event.spotIds || []);
      case 'trip.updateRange':
        return await trip.updateRange(db, userId, event.tripId, event.startDate, event.endDate);

      /* ======== 时间线 ======== */
      case 'timeline.generate':
        return await timeline.generate(db, userId, event.tripId, {
          spotStatusMap: event.spotStatusMap || {},
        });

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

      /* ======== 提醒任务 ======== */
      case 'task.submit': {
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
        // TRIP-RULE-004 级联：行程内任务与清单均空则删除行程
        const tripRemoved = await trip.removeIfEmpty(db, userId, res.tripId);
        return ok({ ...res, tripRemoved });
      }
      case 'task.clear': {
        const res = await task.clear(db, userId, {
          filter: event.filter || null,
          tripId: event.tripId || null,
        });
        if (!res.success) return res;
        // TRIP-RULE-004 级联：清空后行程内任务与清单均空则删除行程
        for (const tid of (res.affectedTripIds || [])) {
          await trip.removeIfEmpty(db, userId, tid);
        }
        return ok(res);
      }

      /* ======== 用户 ======== */
      case 'user.profile':
        return await getOrCreateUser(userId);
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
        for (const a of r.affected) {
          await trip.removeIfEmpty(db, a.userId, a.tripId);
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

/** TABLE-005 用户表：首次调用时惰性创建 */
async function getOrCreateUser(userId) {
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if ((res.data || []).length > 0) {
    return ok({ user: res.data[0] });
  }
  const data = {
    openId: userId,
    nickname: '',
    avatarUrl: '',
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

async function updateNotifyPrefs(userId, prefs) {
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) await getOrCreateUser(userId);

  const target = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  await db.collection(COLLECTIONS.USERS).doc(target.data[0]._id).update({
    data: { notifyPrefs: prefs },
  });
  return ok({ notifyPrefs: prefs });
}

/** 订阅消息模板 ID（与 miniprogram/utils/notify.js、cloudfunctions/notifier 兜底常量对齐） */
const DEFAULT_SUBSCRIBE_TEMPLATE_ID = 'w5e9AIVe2oDidseGOX74CG2Z1-r0ikQTpUQAELcM1nk';

/**
 * subscribe.add —— 用户授权订阅消息后 +1 一次性额度（微信每次授权=可发 1 条）
 * 落库到 users.subscribeQuota（TABLE-005），便于前端展示「剩余可提醒次数」。
 */
async function addSubscribe(userId, templateId) {
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  let res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) await getOrCreateUser(userId);
  const target = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  const u = target.data[0];
  await db.collection(COLLECTIONS.USERS).doc(u._id).update({
    data: {
      subscribeQuota: _.inc(1),
      subscribeTemplateId: tpl,
      subscribeUpdatedAt: time.now(),
    },
  });
  return ok({ quota: (u.subscribeQuota || 0) + 1, templateId: tpl });
}

/** subscribe.get —— 查询当前用户剩余一次性订阅额度 */
async function getSubscribe(userId, templateId) {
  const tpl = templateId || DEFAULT_SUBSCRIBE_TEMPLATE_ID;
  const res = await db.collection(COLLECTIONS.USERS).where({ openId: userId }).get();
  if (!(res.data || []).length) return ok({ quota: 0, templateId: tpl });
  const u = res.data[0];
  return ok({ quota: u.subscribeQuota || 0, templateId: u.subscribeTemplateId || tpl });
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
