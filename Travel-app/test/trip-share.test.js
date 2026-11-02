/**
 * PAGE-018 行程只读分享回归。
 * 运行：node test/trip-share.test.js
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const { createDb } = require('./mock-db');
const time = require('../cloudfunctions/reminder/lib/time');

let CURRENT_OPENID = 'share_owner';
const CURRENT_DB = createDb();

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'cloud1-test',
      database() { return CURRENT_DB; },
      getWXContext() { return { OPENID: CURRENT_OPENID }; },
      callFunction() { return Promise.resolve({ result: { success: true, data: [] } }); },
    };
  }
  return origLoad.apply(this, arguments);
};

const reminder = require('../cloudfunctions/reminder/index.js');
const tripShare = require('../cloudfunctions/reminder/lib/trip-share.js');
Module._load = origLoad;

const COLLECTIONS = {
  TRIPS: 'trips',
  TRIP_ITEMS: 'trip_items',
  SPOTS: 'spots',
  RELEASE_RULES: 'release_rules',
  USERS: 'users',
};
const TODAY = time.todayStr();
const OWNER = CURRENT_OPENID;

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};
const call = data => reminder.main(data);

function collectKeys(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach(v => collectKeys(v, out));
    return out;
  }
  Object.keys(value).forEach(k => {
    out.add(k);
    collectKeys(value[k], out);
  });
  return out;
}

async function seedSpot(spotId, name) {
  await CURRENT_DB.collection(COLLECTIONS.SPOTS).add({
    data: {
      spotId,
      name,
      reservationRequired: true,
      difficultyScore: 4,
      popularityScore: 4,
    },
  });
  await CURRENT_DB.collection(COLLECTIONS.RELEASE_RULES).add({
    data: { spotId, advanceDays: 7, releaseTime: '20:00', closedDays: [] },
  });
}

async function seedTrip(id, opts = {}) {
  const startDate = opts.startDate || time.addDays(TODAY, -2);
  const endDate = opts.endDate || time.addDays(TODAY, 3);
  await CURRENT_DB.collection(COLLECTIONS.TRIPS).add({
    data: {
      _id: id,
      userId: opts.userId || OWNER,
      city: '北京',
      startDate,
      endDate,
      name: '北京测试行程',
      spotIds: [],
      spots: [],
      status: 'ACTIVE',
      createdAt: time.now(),
      updatedAt: time.now(),
      ...(opts.extra || {}),
    },
  });
}

async function seedItem(id, tripId, spotId, visitDate, userId = OWNER) {
  await CURRENT_DB.collection(COLLECTIONS.TRIP_ITEMS).add({
    data: {
      _id: id,
      userId,
      tripId,
      spotId,
      visitDate,
      backupGroupId: `${tripId}:${spotId}`,
      remindOn: true,
      result: 'FAILED',
      resultAt: time.now(),
      createdAt: time.now(),
      updatedAt: time.now(),
    },
  });
}

(async () => {
  await seedSpot('gugong', '故宫博物院');
  await seedSpot('guobo', '中国国家博物馆');
  await CURRENT_DB.collection(COLLECTIONS.USERS).add({
    data: {
      openId: OWNER,
      nickname: '小可爱',
      avatarUrl: '/images/avatars/default-1.png',
    },
  });

  console.log('=== 1. 创建权限与当前行程约束 ===');
  let res = await call({ action: 'tripShare.create', tripId: 'missing' });
  eq(res.success, false, '不存在行程拒绝创建');
  eq(res.errorCode, 1010, '不存在统一返回参数错误');

  await seedTrip('T_EMPTY');
  res = await call({ action: 'tripShare.create', tripId: 'T_EMPTY' });
  eq(res.errorCode, 1041, '无行程项不可分享');

  await seedTrip('T_ENDED', {
    startDate: time.addDays(TODAY, -8),
    endDate: time.addDays(TODAY, -1),
  });
  await seedItem('I_ENDED', 'T_ENDED', 'gugong', time.addDays(TODAY, -1));
  res = await call({ action: 'tripShare.create', tripId: 'T_ENDED' });
  eq(res.errorCode, 1041, '已结束行程不可新建分享');

  await seedTrip('T_OWNER');
  await seedItem('I_OWNER_1', 'T_OWNER', 'gugong', time.addDays(TODAY, -2));
  await seedItem('I_OWNER_2', 'T_OWNER', 'gugong', time.addDays(TODAY, 1));
  await seedItem('I_OWNER_3', 'T_OWNER', 'guobo', time.addDays(TODAY, 1));
  CURRENT_OPENID = 'someone_else';
  res = await call({ action: 'tripShare.create', tripId: 'T_OWNER' });
  eq(res.errorCode, 1010, '非主人不能创建分享');
  CURRENT_OPENID = OWNER;

  console.log('=== 2. 幂等令牌、状态与普通读取脱敏 ===');
  const created = await call({ action: 'tripShare.create', tripId: 'T_OWNER' });
  eq(created.success, true, '主人可为当前整趟行程创建分享');
  eq(created.ownerNickname, '小可爱', '主人接口返回应用内昵称用于会话标题');
  eq(/^[a-f0-9]{64}$/.test(created.token), true, '令牌为 32 字节随机数的 64 位十六进制');
  eq(created.expiresOn, time.addDays(TODAY, 10), '失效日 = endDate + 7 天');

  const reused = await call({ action: 'tripShare.create', tripId: 'T_OWNER' });
  eq(reused.token, created.token, '重复创建复用同一链接');
  eq(reused.reused, true, '复用状态明确返回');

  const status = await call({ action: 'tripShare.status', tripId: 'T_OWNER' });
  eq(status.status, 'ACTIVE', '主人可查询有效分享');
  eq(status.token, created.token, '有效状态返回令牌供浮层复用');
  eq(status.ownerNickname, '小可爱', '状态接口同样返回应用内昵称');

  const listed = await call({ action: 'trip.list' });
  const listedTrip = (listed.trips || []).find(t => t._id === 'T_OWNER');
  eq(listedTrip.shareActive, true, 'trip.list 只下发 shareActive');
  eq(Object.prototype.hasOwnProperty.call(listedTrip, 'shareToken'), false, 'trip.list 不下发原始令牌');

  const home = await call({ action: 'home.bootstrap' });
  const homeTrip = (home.trips || []).find(t => t._id === 'T_OWNER');
  eq(homeTrip.shareActive, true, 'home.bootstrap 下发有效分享状态');
  eq(Object.prototype.hasOwnProperty.call(homeTrip, 'shareToken'), false, 'home.bootstrap 不下发原始令牌');

  console.log('=== 3. 公开只读投影完整、有序且脱敏 ===');
  const opened = await call({ action: 'tripShare.open', token: created.token });
  eq(opened.success, true, '持链接用户可读取');
  eq(opened.trip.city, '北京', '返回城市');
  eq(opened.trip.dayCount, 6, '天数按整趟日期范围计算');
  eq(opened.trip.spotCount, 2, '景点数按 spotId 去重');
  eq(opened.trip.days.length, 2, '按全部已有行程项的日期分组');
  eq(opened.trip.days[0].visitDate, time.addDays(TODAY, -2), '过去日期完整保留');
  eq(opened.trip.days[1].visitDate, time.addDays(TODAY, 1), '未来日期完整保留');
  eq(opened.trip.days[1].items.length, 2, '同一日期全部景点保留');
  eq(opened.share.readOnly, true, '明确只读');
  eq(opened.share.expiresOn, time.addDays(TODAY, 10), '公开页返回失效日');

  const keys = collectKeys(opened);
  ['userId', 'openId', 'tripId', 'itemId', 'releaseAt', 'ticketState', 'result', 'reminder', 'shareToken', 'nickname', 'ownerNickname']
    .forEach(key => eq(keys.has(key), false, `公开投影不得包含 ${key}`));
  const adminSource = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/admin/lib/admin.js'), 'utf8');
  eq(/delete out\.shareToken;/.test(adminSource), true,
    '管理端普通用户详情同样剥离原始分享令牌');

  CURRENT_OPENID = 'recipient';
  const recipientOpened = await call({ action: 'tripShare.open', token: created.token });
  eq(recipientOpened.success, true, '非主人也可凭令牌只读查看');
  CURRENT_OPENID = OWNER;

  console.log('=== 4. 合并迁移、结束日加 7 天边界和公开错误 ===');
  const mergeRes = await call({
    action: 'trip.create',
    startDate: time.addDays(TODAY, 4),
    endDate: time.addDays(TODAY, 5),
    spotIds: ['guobo'],
  });
  const activeTripId = mergeRes.tripId;
  const mergedTrip = CURRENT_DB._dump(COLLECTIONS.TRIPS).find(t => t._id === activeTripId);
  eq(mergedTrip.shareToken, created.token, '同城行程合并后令牌迁到存续行程');
  const mergedEnd = mergedTrip.endDate;

  const validBoundary = await tripShare.open(CURRENT_DB, created.token, {
    nowTs: time.parseBeijing(time.addDays(mergedEnd, 7), '23:59'),
  });
  eq(validBoundary.success, true, 'endDate + 7 当天仍有效');

  const expired = await tripShare.open(CURRENT_DB, created.token, {
    nowTs: time.parseBeijing(time.addDays(mergedEnd, 8), '00:00'),
  });
  eq(expired.errorCode, 1042, 'endDate + 8 起失效');

  const invalid = await call({ action: 'tripShare.open', token: 'not-a-real-token' });
  eq(invalid.errorCode, 1042, '非法令牌统一返回不可查看');
  eq(expired.error, invalid.error, '过期与非法不泄露差异');

  console.log('=== 5. 停止分享与重新分享轮换 ===');
  const revoked = await call({ action: 'tripShare.revoke', tripId: activeTripId });
  eq(revoked.success, true, '停止分享成功');
  eq(revoked.status, 'REVOKED', '停止状态明确');
  const oldLink = await call({ action: 'tripShare.open', token: created.token });
  eq(oldLink.errorCode, 1042, '停止后旧链接立即失效');
  const revokedStatus = await call({ action: 'tripShare.status', tripId: activeTripId });
  eq(revokedStatus.status, 'REVOKED', '主人可看到已停止状态');

  const recreated = await call({ action: 'tripShare.create', tripId: activeTripId });
  eq(recreated.success, true, '停止后可重新分享');
  eq(recreated.token === created.token, false, '重新分享生成新令牌');

  console.log('=== 6. 并发创建幂等 ===');
  await call({ action: 'tripShare.revoke', tripId: activeTripId });
  const concurrent = await Promise.all([
    call({ action: 'tripShare.create', tripId: activeTripId }),
    call({ action: 'tripShare.create', tripId: activeTripId }),
  ]);
  eq(concurrent[0].token, concurrent[1].token, '并发创建最终拿到同一令牌');

  console.log('=== 7. 行程删除后链接失效 ===');
  const deleteToken = concurrent[0].token;
  await call({ action: 'trip.remove', tripId: activeTripId });
  const deleted = await call({ action: 'tripShare.open', token: deleteToken });
  eq(deleted.errorCode, 1042, '删除行程后链接失效');

  console.log('=== 8. 客户端不能伪造时间越过失效边界 ===');
  const oldToken = 'f'.repeat(64);
  const oldEnd = time.addDays(TODAY, -10);
  await seedTrip('T_OLD_SHARE', {
    startDate: time.addDays(TODAY, -12),
    endDate: oldEnd,
    extra: {
      shareToken: oldToken,
      shareCreatedAt: time.now(),
      shareUpdatedAt: time.now(),
    },
  });
  await seedItem('I_OLD_SHARE', 'T_OLD_SHARE', 'gugong', oldEnd);
  const forgedNow = await call({
    action: 'tripShare.open',
    token: oldToken,
    nowTs: time.parseBeijing(oldEnd, '12:00'),
  });
  eq(forgedNow.errorCode, 1042, 'action 入口忽略客户端 nowTs，已过期链接不能借时间参数复活');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : `FAIL ${fail}`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
