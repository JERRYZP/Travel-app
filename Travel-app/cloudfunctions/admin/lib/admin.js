/** admin 云函数业务逻辑：只读查询、管理员鉴权和每日统计汇总。 */
const {
  COLLECTIONS, ROLES, ADMIN_STATUS, METRIC_TYPES, EVENT_TYPES, ERRORS, ok, fail,
} = require('./schema');
const auth = require('./auth');
const time = require('./time');
const analytics = require('./analytics');
const privacy = require('./privacy');

const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const QUERY_PAGE_SIZE = 100;
const QUERY_MAX_ROWS = 10000;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTimerInvocation(event = {}, env = process.env) {
  return env.TRIGGER_SRC === 'timer'
    || event.Type === 'Timer'
    || event.type === 'timer'
    || event.TriggerName === 'adminDailyRollup';
}

function normalizePage(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(params.pageSize) || PAGE_SIZE_DEFAULT));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function parseDateParam(value, endOfDay = false) {
  if (!value) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return endOfDay ? time.nextDayStart(text) : time.dayStart(text);
}

function rangeParam(params = {}) {
  if (params.startDate && params.endDate) {
    return { startDate: String(params.startDate), endDate: String(params.endDate) };
  }
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 7;
  const r = time.lastNDates(days);
  return { startDate: r.start, endDate: r.end };
}

async function safeCount(query) {
  try {
    const res = await query.count();
    return Number(res.total) || 0;
  } catch (e) {
    return 0;
  }
}

async function fetchAll(query, maxRows = QUERY_MAX_ROWS) {
  const rows = [];
  let skip = 0;
  while (rows.length < maxRows) {
    const res = await query.skip(skip).limit(QUERY_PAGE_SIZE).get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < QUERY_PAGE_SIZE) break;
    skip += QUERY_PAGE_SIZE;
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length >= maxRows };
}

function mergeUniqueRows(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row._id || row.eventKey, row);
  return [...map.values()];
}

async function loadEventsForRange(db, startDate, endDate) {
  const _ = db.command;
  const start = time.dayStart(startDate);
  const end = time.nextDayStart(endDate);
  const byEventAt = db.collection(COLLECTIONS.REMINDER_EVENTS)
    .where({ eventAt: _.gte(start).and(_.lt(end)) })
    .orderBy('eventAt', 'desc');
  const byReleaseAt = db.collection(COLLECTIONS.REMINDER_EVENTS)
    .where({ releaseAt: _.gte(start).and(_.lt(end)) })
    .orderBy('releaseAt', 'desc');
  const results = await Promise.all([
    fetchAll(byEventAt).catch(() => ({ rows: [], truncated: false })),
    fetchAll(byReleaseAt).catch(() => ({ rows: [], truncated: false })),
  ]);
  return {
    rows: mergeUniqueRows(results[0].rows.concat(results[1].rows)),
    truncated: results.some(r => r.truncated),
  };
}

async function loadDailyStats(db, startDate, endDate) {
  const _ = db.command;
  try {
    const res = await fetchAll(
      db.collection(COLLECTIONS.DAILY_STATS)
        .where({ dateKey: _.gte(startDate).and(_.lte(endDate)) })
        .orderBy('dateKey', 'asc'),
      5000
    );
    return res.rows;
  } catch (e) {
    return [];
  }
}

async function writeAudit(db, entry) {
  try {
    const nowTs = entry.createdAt || new Date();
    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      data: Object.assign({
        adminId: null,
        adminUsername: null,
        action: 'UNKNOWN',
        targetType: null,
        targetId: null,
        field: null,
        result: 'SUCCESS',
        detail: null,
        createdAt: nowTs,
        expireAt: new Date(nowTs.getTime() + RETENTION_DAYS * DAY_MS),
      }, entry, { createdAt: nowTs }),
    });
  } catch (e) {
    console.error('[admin] audit-write-failed', e.message);
  }
}

async function findAdminByUsername(db, username) {
  const res = await db.collection(COLLECTIONS.ADMINS).where({ username }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function findAdminById(db, id) {
  if (!id) return null;
  const res = await db.collection(COLLECTIONS.ADMINS).where({ _id: id }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function login(db, params = {}, env = process.env, nowMs = Date.now()) {
  const username = String(params.username || '').trim();
  const password = String(params.password || '');
  const nowTs = new Date(nowMs);
  if (!username || !password) return fail(ERRORS.BAD_PARAM);

  let admin = await findAdminByUsername(db, username);
  if (!admin) {
    const total = await safeCount(db.collection(COLLECTIONS.ADMINS));
    const bootstrapUsername = String(env.ADMIN_BOOTSTRAP_USERNAME || '').trim();
    const bootstrapHash = String(env.ADMIN_BOOTSTRAP_PASSWORD_HASH || '');
    const bootstrapSalt = String(env.ADMIN_BOOTSTRAP_PASSWORD_SALT || '');
    if (total === 0 && bootstrapUsername === username && bootstrapHash && bootstrapSalt
      && auth.verifyPassword(password, bootstrapSalt, bootstrapHash)) {
      const doc = {
        username,
        passwordHash: bootstrapHash,
        passwordSalt: bootstrapSalt,
        role: ROLES.SUPER_ADMIN,
        status: ADMIN_STATUS.ACTIVE,
        tokenVersion: 0,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
      };
      const added = await db.collection(COLLECTIONS.ADMINS).add({ data: doc });
      admin = Object.assign({ _id: added._id }, doc);
    } else {
      await writeAudit(db, {
        adminUsername: username,
        action: 'LOGIN',
        result: 'FAILED',
        detail: 'unknown-admin',
      });
      return fail(ERRORS.LOGIN_FAILED);
    }
  }

  if (admin.status !== ADMIN_STATUS.ACTIVE) {
    await writeAudit(db, { adminId: admin._id, adminUsername: username, action: 'LOGIN', result: 'FAILED', detail: 'disabled' });
    return fail(ERRORS.FORBIDDEN);
  }
  if (admin.lockedUntil && new Date(admin.lockedUntil).getTime() > nowMs) {
    await writeAudit(db, { adminId: admin._id, adminUsername: username, action: 'LOGIN', result: 'FAILED', detail: 'locked' });
    return fail(ERRORS.ACCOUNT_LOCKED);
  }

  const passwordOk = auth.verifyPassword(password, admin.passwordSalt, admin.passwordHash);
  if (!passwordOk) {
    const failed = (Number(admin.failedLoginCount) || 0) + 1;
    const patch = {
      failedLoginCount: failed,
      lockedUntil: failed >= LOCK_AFTER_FAILURES ? new Date(nowMs + LOCK_MS) : null,
      updatedAt: nowTs,
    };
    await db.collection(COLLECTIONS.ADMINS).doc(admin._id).update({ data: patch });
    await writeAudit(db, { adminId: admin._id, adminUsername: username, action: 'LOGIN', result: 'FAILED', detail: 'bad-password' });
    return fail(failed >= LOCK_AFTER_FAILURES ? ERRORS.ACCOUNT_LOCKED : ERRORS.LOGIN_FAILED);
  }

  await db.collection(COLLECTIONS.ADMINS).doc(admin._id).update({
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: nowTs,
      updatedAt: nowTs,
    },
  });
  await writeAudit(db, { adminId: admin._id, adminUsername: username, action: 'LOGIN', result: 'SUCCESS' });
  const token = auth.createToken(admin, env.ADMIN_SESSION_SECRET, nowMs);
  return ok({
    token,
    expiresIn: Math.floor(auth.SESSION_TTL_MS / 1000),
    admin: { id: admin._id, username: admin.username, role: admin.role },
  });
}

async function authenticate(db, token, env = process.env, nowMs = Date.now()) {
  const payload = auth.verifyToken(token, env.ADMIN_SESSION_SECRET, nowMs);
  if (!payload) return { ok: false, response: fail(ERRORS.UNAUTHORIZED) };
  const admin = await findAdminById(db, payload.sub);
  if (!auth.isActiveAdmin(admin)) return { ok: false, response: fail(ERRORS.FORBIDDEN) };
  if ((Number(admin.tokenVersion) || 0) !== (Number(payload.tokenVersion) || 0)) {
    return { ok: false, response: fail(ERRORS.UNAUTHORIZED) };
  }
  return { ok: true, admin, payload };
}

async function loadSpotMap(db, spotIds) {
  const ids = analytics.unique(spotIds);
  if (!ids.length) return {};
  const _ = db.command;
  const map = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await db.collection(COLLECTIONS.SPOTS).where({ spotId: _.in(chunk) }).get();
    (res.data || []).forEach(spot => { map[spot.spotId] = spot; });
  }
  return map;
}

function decorateSpot(stat, spotMap) {
  const spot = spotMap[stat.spotId] || {};
  return Object.assign({}, stat, {
    spotName: spot.name || stat.spotId,
    shortName: spot.shortName || spot.name || stat.spotId,
  });
}

async function overview(db, params = {}) {
  const range = rangeParam(params);
  const _ = db.command;
  const start = time.dayStart(range.startDate);
  const end = time.nextDayStart(range.endDate);
  const [userTotal, newUserCount, eventsResult, spotsRes] = await Promise.all([
    safeCount(db.collection(COLLECTIONS.USERS)),
    safeCount(db.collection(COLLECTIONS.USERS).where({ createdAt: _.gte(start).and(_.lt(end)) })),
    loadEventsForRange(db, range.startDate, range.endDate),
    db.collection(COLLECTIONS.SPOTS).get().catch(() => ({ data: [] })),
  ]);
  const spotMap = {};
  (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  const metrics = analytics.summarizeEvents(eventsResult.rows, range);
  const topSpots = analytics.groupSpotEvents(eventsResult.rows, range).slice(0, 10).map(s => decorateSpot(s, spotMap));

  const trend = time.dateRange(range.startDate, range.endDate).map(dateKey => Object.assign({
    dateKey,
  }, analytics.summarizeEvents(eventsResult.rows, { startDate: dateKey, endDate: dateKey })));

  return ok({
    range,
    userTotal,
    newUserCount,
    metrics,
    topSpots,
    trend,
    dataTruncated: eventsResult.truncated,
  });
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadUserRelatedMaps(db, userIds) {
  const ids = analytics.unique(userIds);
  if (!ids.length) return { taskMap: {}, eventMap: {}, tripMap: {}, itemMap: {} };
  const _ = db.command;

  async function fetchIn(collection, field, extraWhere = {}) {
    const rows = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const where = Object.assign({}, extraWhere);
      where[field] = _.in(chunk);
      const res = await fetchAll(db.collection(collection).where(where), QUERY_MAX_ROWS);
      rows.push(...res.rows);
    }
    return rows;
  }

  const [tasks, events, trips, items] = await Promise.all([
    fetchIn(COLLECTIONS.REMINDER_TASKS, 'userId'),
    fetchIn(COLLECTIONS.REMINDER_EVENTS, 'userId', { eventType: _.in([EVENT_TYPES.TASK_CREATED, EVENT_TYPES.TASK_TRIGGERED, EVENT_TYPES.TASK_MISSED]) }),
    fetchIn(COLLECTIONS.TRIPS, 'userId'),
    fetchIn(COLLECTIONS.TRIP_ITEMS, 'userId'),
  ]);

  const taskMap = {};
  tasks.forEach(t => { taskMap[t.userId] = taskMap[t.userId] || []; taskMap[t.userId].push(t); });
  const eventMap = {};
  events.forEach(e => {
    const cur = eventMap[e.userId];
    if (!cur || new Date(e.eventAt).getTime() > new Date(cur.eventAt).getTime()) eventMap[e.userId] = e;
  });
  const tripMap = {};
  trips.forEach(t => { tripMap[t.userId] = (tripMap[t.userId] || 0) + 1; });
  const itemMap = {};
  items.forEach(i => { itemMap[i.userId] = (itemMap[i.userId] || 0) + 1; });
  return { taskMap, eventMap, tripMap, itemMap };
}

function decoratedTaskCounts(tasks) {
  const out = { total: tasks.length, WAITING: 0, TRIGGERED: 0, MISSED: 0, CLOSED: 0 };
  tasks.forEach(t => { if (out[t.backendStatus] !== undefined) out[t.backendStatus] += 1; });
  return out;
}

/** 普通只读响应永远不带原始 userId/openId/nickname/phone。 */
function stripSensitiveDoc(doc) {
  const out = Object.assign({}, doc || {});
  delete out.userId;
  delete out.openId;
  delete out.nickname;
  delete out.phone;
  return out;
}

function safeTask(task, extra = {}) {
  return Object.assign({
    id: task._id,
    userIdMasked: privacy.maskId(task.userId),
    userLabel: privacy.maskId(task.userId),
    spotId: task.spotId || null,
    spotName: task.spotId || null,
    visitDate: task.visitDate || null,
    releaseAt: task.releaseAt || null,
    offsets: task.offsets || [],
    sentOffsets: task.sentOffsets || [],
    channels: task.channels || [],
    backendStatus: task.backendStatus || null,
    triggeredAt: task.triggeredAt || null,
    missedReason: task.missedReason || null,
    lastSendError: task.lastSendError || null,
    createdAt: task.createdAt || null,
  }, extra);
}

async function usersList(db, params = {}) {
  const { page, pageSize, skip } = normalizePage(params);
  const keyword = String(params.keyword || '').trim();
  const where = {};
  if (keyword) {
    if (/^o[A-Za-z0-9_-]{20,}$/.test(keyword)) where.openId = keyword;
    else where.nickname = db.RegExp({ regexp: escapeRegex(keyword), options: 'i' });
  }
  const query = db.collection(COLLECTIONS.USERS).where(where);
  const total = await safeCount(query);
  const res = await query.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
  const users = res.data || [];
  const maps = await loadUserRelatedMaps(db, users.map(u => u.openId));

  return ok({
    page,
    pageSize,
    total,
    items: users.map(u => {
      const tasks = maps.taskMap[u.openId] || [];
      return {
        id: u._id,
        userIdMasked: privacy.maskId(u.openId),
        nicknameMasked: privacy.maskNickname(u.nickname),
        avatarUrl: u.avatarUrl || '',
        phoneMasked: privacy.maskPhone(u.phone),
        createdAt: u.createdAt || null,
        lastActiveAt: maps.eventMap[u.openId] ? maps.eventMap[u.openId].eventAt : null,
        tripCount: maps.tripMap[u.openId] || 0,
        itemCount: maps.itemMap[u.openId] || 0,
        taskCounts: decoratedTaskCounts(tasks),
        subscribeQuota: Number(u.subscribeQuota) || 0,
      };
    }),
  });
}

async function userDetail(db, params = {}) {
  const id = String(params.id || '');
  if (!id) return fail(ERRORS.BAD_PARAM);
  const userRes = await db.collection(COLLECTIONS.USERS).where({ _id: id }).limit(1).get();
  const user = (userRes.data || [])[0];
  if (!user) return fail('用户不存在');
  const _ = db.command;
  const [trips, items, tasks, events] = await Promise.all([
    db.collection(COLLECTIONS.TRIPS).where({ userId: user.openId }).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ data: [] })),
    db.collection(COLLECTIONS.TRIP_ITEMS).where({ userId: user.openId }).orderBy('visitDate', 'desc').limit(100).get().catch(() => ({ data: [] })),
    db.collection(COLLECTIONS.REMINDER_TASKS).where({ userId: user.openId }).orderBy('releaseAt', 'desc').limit(100).get().catch(() => ({ data: [] })),
    db.collection(COLLECTIONS.REMINDER_EVENTS).where({ userId: user.openId, eventType: _.in([EVENT_TYPES.TASK_CREATED, EVENT_TYPES.TASK_TRIGGERED, EVENT_TYPES.TASK_MISSED]) }).orderBy('eventAt', 'desc').limit(1).get().catch(() => ({ data: [] })),
  ]);
  const taskRows = tasks.data || [];
  return ok({
    user: {
      id: user._id,
      userIdMasked: privacy.maskId(user.openId),
      nicknameMasked: privacy.maskNickname(user.nickname),
      avatarUrl: user.avatarUrl || '',
      phoneMasked: privacy.maskPhone(user.phone),
      memberLevel: user.memberLevel || 'NORMAL',
      points: Number(user.points) || 0,
      subscribeQuota: Number(user.subscribeQuota) || 0,
      createdAt: user.createdAt || null,
      lastActiveAt: (events.data || [])[0] ? events.data[0].eventAt : null,
    },
    trips: (trips.data || []).map(stripSensitiveDoc),
    items: (items.data || []).map(stripSensitiveDoc),
    taskCounts: decoratedTaskCounts(taskRows),
    tasks: taskRows.slice(0, 20).map(t => safeTask(t)),
  });
}

async function loadUserLabels(db, userIds) {
  const ids = analytics.unique(userIds);
  if (!ids.length) return {};
  const _ = db.command;
  const map = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await db.collection(COLLECTIONS.USERS).where({ openId: _.in(chunk) }).get();
    (res.data || []).forEach(u => {
      map[u.openId] = privacy.maskNickname(u.nickname) || privacy.maskId(u.openId);
    });
  }
  return map;
}

async function tasksList(db, params = {}) {
  const { page, pageSize, skip } = normalizePage(params);
  const _ = db.command;
  const where = {};
  if (params.status) where.backendStatus = String(params.status);
  if (params.spotId) where.spotId = String(params.spotId);
  if (params.userId) where.userId = String(params.userId);
  const releaseFrom = parseDateParam(params.releaseFrom);
  const releaseTo = parseDateParam(params.releaseTo, true);
  if (releaseFrom && releaseTo) where.releaseAt = _.gte(releaseFrom).and(_.lt(releaseTo));
  else if (releaseFrom) where.releaseAt = _.gte(releaseFrom);
  else if (releaseTo) where.releaseAt = _.lt(releaseTo);
  const createdFrom = parseDateParam(params.createdFrom);
  const createdTo = parseDateParam(params.createdTo, true);
  if (createdFrom && createdTo) where.createdAt = _.gte(createdFrom).and(_.lt(createdTo));
  else if (createdFrom) where.createdAt = _.gte(createdFrom);
  else if (createdTo) where.createdAt = _.lt(createdTo);

  const query = db.collection(COLLECTIONS.REMINDER_TASKS).where(where);
  const total = await safeCount(query);
  const res = await query.orderBy('releaseAt', 'desc').skip(skip).limit(pageSize).get();
  const rows = res.data || [];
  const [spotMap, userMap] = await Promise.all([
    loadSpotMap(db, rows.map(t => t.spotId)),
    loadUserLabels(db, rows.map(t => t.userId)),
  ]);
  return ok({
    page,
    pageSize,
    total,
    items: rows.map(t => ({
      id: t._id,
      userIdMasked: privacy.maskId(t.userId),
      userLabel: userMap[t.userId] || privacy.maskId(t.userId),
      spotId: t.spotId,
      spotName: (spotMap[t.spotId] || {}).name || t.spotId,
      visitDate: t.visitDate || null,
      releaseAt: t.releaseAt || null,
      offsets: t.offsets || [],
      sentOffsets: t.sentOffsets || [],
      channels: t.channels || [],
      backendStatus: t.backendStatus || null,
      triggeredAt: t.triggeredAt || null,
      missedReason: t.missedReason || null,
      lastSendError: t.lastSendError || null,
      createdAt: t.createdAt || null,
    })),
  });
}

async function taskDetail(db, params = {}) {
  const id = String(params.id || '');
  if (!id) return fail(ERRORS.BAD_PARAM);
  const taskRes = await db.collection(COLLECTIONS.REMINDER_TASKS).where({ _id: id }).limit(1).get();
  const task = (taskRes.data || [])[0];
  if (!task) return fail('任务不存在');
  const [spotMap, userMap, itemRes, eventsRes] = await Promise.all([
    loadSpotMap(db, [task.spotId]),
    loadUserLabels(db, [task.userId]),
    task.itemId
      ? db.collection(COLLECTIONS.TRIP_ITEMS).where({ _id: task.itemId }).limit(1).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    db.collection(COLLECTIONS.REMINDER_EVENTS).where({ taskId: task._id }).orderBy('eventAt', 'desc').limit(100).get().catch(() => ({ data: [] })),
  ]);
  return ok({
    task: safeTask(task, {
      userLabel: userMap[task.userId] || privacy.maskId(task.userId),
      spotName: (spotMap[task.spotId] || {}).name || task.spotId,
    }),
    item: stripSensitiveDoc((itemRes.data || [])[0] || null),
    events: eventsRes.data || [],
  });
}

async function spotsStats(db, params = {}) {
  const range = rangeParam(params);
  const [eventsResult, spotsRes] = await Promise.all([
    loadEventsForRange(db, range.startDate, range.endDate),
    db.collection(COLLECTIONS.SPOTS).get().catch(() => ({ data: [] })),
  ]);
  const spotMap = {};
  (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  const summary = analytics.summarizeEvents(eventsResult.rows, range);
  const items = analytics.groupSpotEvents(eventsResult.rows, range).map(s => decorateSpot(s, spotMap));
  const trend = time.dateRange(range.startDate, range.endDate).map(dateKey => Object.assign({
    dateKey,
  }, analytics.summarizeEvents(eventsResult.rows, { startDate: dateKey, endDate: dateKey })));
  return ok({ range, summary, items, trend, dataTruncated: eventsResult.truncated });
}

async function viewSensitive(db, admin, params = {}) {
  if (admin.role !== ROLES.SUPER_ADMIN) return fail(ERRORS.FORBIDDEN);
  const id = String(params.id || '');
  const field = String(params.field || '');
  if (!id || !['openId', 'phone', 'nickname'].includes(field)) return fail(ERRORS.BAD_PARAM);
  const res = await db.collection(COLLECTIONS.USERS).where({ _id: id }).limit(1).get();
  const user = (res.data || [])[0];
  if (!user) return fail('用户不存在');
  await writeAudit(db, {
    adminId: admin._id,
    adminUsername: admin.username,
    action: 'VIEW_SENSITIVE',
    targetType: 'user',
    targetId: id,
    field,
    result: 'SUCCESS',
  });
  return ok({ field, value: user[field] == null ? '' : user[field] });
}

async function upsertDailyStat(db, doc) {
  const _ = db.command;
  const exist = await db.collection(COLLECTIONS.DAILY_STATS)
    .where({ dateKey: doc.dateKey, metricType: doc.metricType, spotId: doc.spotId })
    .limit(1)
    .get();
  const data = Object.assign({}, doc, { refreshedAt: new Date() });
  if ((exist.data || []).length) {
    await db.collection(COLLECTIONS.DAILY_STATS).doc(exist.data[0]._id).update({ data });
  } else {
    await db.collection(COLLECTIONS.DAILY_STATS).add({ data });
  }
  return 1;
}

function taskEventSnapshot(task, eventType, eventAt) {
  return {
    eventKey: `${task._id}:${eventType}`,
    eventType,
    eventAt,
    taskId: task._id,
    userId: task.userId || null,
    itemId: task.itemId || null,
    tripId: task.tripId || null,
    spotId: task.spotId || null,
    templateId: task.templateId || null,
    channel: (task.channels || [])[0] || null,
    offset: null,
    releaseAt: task.releaseAt || null,
    visitDate: task.visitDate || null,
    scheduledAt: null,
    result: eventType === EVENT_TYPES.TASK_TRIGGERED ? 'SUCCESS'
      : (eventType === EVENT_TYPES.TASK_MISSED ? 'FAILED' : null),
    errorCode: null,
    errorMessage: task.missedReason || task.lastSendError || null,
    source: 'admin.reconcile',
    expireAt: new Date(new Date(eventAt).getTime() + RETENTION_DAYS * DAY_MS),
  };
}

async function reconcileTaskEvents(db, startDate, endDate) {
  const _ = db.command;
  const start = time.dayStart(startDate);
  const end = time.nextDayStart(endDate);
  const taskRes = await fetchAll(
    db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ createdAt: _.gte(start).and(_.lt(end)) })
      .orderBy('createdAt', 'asc'),
    2000
  );
  const tasks = taskRes.rows;
  if (!tasks.length) return 0;

  const keys = [];
  tasks.forEach(t => {
    keys.push(`${t._id}:${EVENT_TYPES.TASK_CREATED}`);
    if (t.backendStatus === 'TRIGGERED') keys.push(`${t._id}:${EVENT_TYPES.TASK_TRIGGERED}`);
    if (t.backendStatus === 'MISSED') keys.push(`${t._id}:${EVENT_TYPES.TASK_MISSED}`);
  });
  const existing = new Set();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await db.collection(COLLECTIONS.REMINDER_EVENTS).where({ eventKey: _.in(chunk) }).get();
    (res.data || []).forEach(e => existing.add(e.eventKey));
  }

  let added = 0;
  for (const task of tasks) {
    const createdKey = `${task._id}:${EVENT_TYPES.TASK_CREATED}`;
    if (!existing.has(createdKey)) {
      await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
        data: taskEventSnapshot(task, EVENT_TYPES.TASK_CREATED, task.createdAt || new Date()),
      });
      added += 1;
    }
    if (task.backendStatus === 'TRIGGERED') {
      const key = `${task._id}:${EVENT_TYPES.TASK_TRIGGERED}`;
      if (!existing.has(key)) {
        await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
          data: taskEventSnapshot(task, EVENT_TYPES.TASK_TRIGGERED, task.triggeredAt || task.releaseAt || new Date()),
        });
        added += 1;
      }
    }
    if (task.backendStatus === 'MISSED') {
      const key = `${task._id}:${EVENT_TYPES.TASK_MISSED}`;
      if (!existing.has(key)) {
        const eventAt = task.lastSendErrorAt || task.releaseAt || task.createdAt || new Date();
        await db.collection(COLLECTIONS.REMINDER_EVENTS).add({
          data: taskEventSnapshot(task, EVENT_TYPES.TASK_MISSED, eventAt),
        });
        added += 1;
      }
    }
  }
  return added;
}

async function cleanupExpired(db, nowTs = new Date()) {
  let removed = 0;
  for (const collection of [COLLECTIONS.REMINDER_EVENTS, COLLECTIONS.AUDIT_LOGS]) {
    try {
      const res = await db.collection(collection).where({ expireAt: db.command.lte(nowTs) }).limit(200).get();
      for (const doc of (res.data || [])) {
        await db.collection(collection).doc(doc._id).remove();
        removed += 1;
      }
    } catch (e) {
      console.error('[admin] cleanup-failed', collection, e.message);
    }
  }
  return removed;
}

async function rollupDaily(db, params = {}, nowTs = new Date()) {
  const days = Math.min(30, Math.max(1, Number(params.days) || 7));
  const range = time.lastNDates(days, nowTs);
  let statDocs = 0;

  for (const dateKey of range.dates) {
    const loaded = await loadEventsForRange(db, dateKey, dateKey);
    const docs = analytics.buildDailyStatDocs(loaded.rows, dateKey);
    for (const doc of docs) statDocs += await upsertDailyStat(db, doc);
  }

  const reconciled = await reconcileTaskEvents(db, range.start, range.end);
  const cleaned = await cleanupExpired(db, nowTs);
  return ok({ range, statDocs, reconciled, cleaned });
}

module.exports = {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  isTimerInvocation,
  normalizePage,
  parseDateParam,
  rangeParam,
  loadEventsForRange,
  loadDailyStats,
  writeAudit,
  login,
  authenticate,
  overview,
  usersList,
  userDetail,
  tasksList,
  taskDetail,
  spotsStats,
  viewSensitive,
  buildDailyStatDocs: analytics.buildDailyStatDocs,
  rollupDaily,
  cleanupExpired,
};
