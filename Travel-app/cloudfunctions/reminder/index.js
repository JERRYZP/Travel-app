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
