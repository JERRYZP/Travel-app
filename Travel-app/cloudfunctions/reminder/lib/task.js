/**
 * 提醒任务规则 REMINDER-RULE-001 ~ 008 + STATE-001/002（产品文档 3.5）
 *
 * 行程项是最小业务单元；提醒任务是行程项下的一条后台执行记录。
 * 一个清单项按用户勾选的提前量集合展开为多条任务（每个 offset 各一条）。
 */

const {
  COLLECTIONS, ReminderBackendStatus, ChannelType, V1, ERRORS, ok, fail,
} = require('./schema');
const time = require('./time');
const tripItem = require('./trip-item');
const cart = require('./cart');
const trip = require('./trip');
const {
  shouldHealQuota, healSubscribeQuota, DEFAULT_SUBSCRIBE_TEMPLATE_ID,
} = require('./quota');

/* ============ 纯函数区 ============ */

/**
 * REMINDER-RULE-001 提醒时间点 = releaseAt − offset
 */
function remindAtOf(releaseAt, offsetMinutes) {
  return time.addMinutes(new Date(releaseAt), -offsetMinutes);
}

/**
 * REMINDER-RULE-004 生效状态（读取时口径）
 *
 * 「已过 releaseAt 而 backendStatus 仍是 WAITING」在语义上就是 MISSED
 * （超过放票时刻仍未送达）。notifier 的 sweepMissed 是常规落库路径，
 * 但它依赖「每分钟定时触发 + backendStatus+releaseAt 复合索引 + WX_APPSECRET 环境变量」
 * 三者同时正常；任一处出问题，任务就会永久卡在 WAITING，前端只能显示成「待提醒」，
 * 用户既收不到推送、也看不到任何失败提示（2026-09-14 实际踩过）。
 * 因此这里在读取时再做一次兜底判定，让状态口径收敛到 backendStatus 一处。
 */
function effectiveStatusOf(backendStatus, releaseAt, nowTs = time.now()) {
  const passed = new Date(releaseAt).getTime() <= nowTs.getTime();
  if (backendStatus === ReminderBackendStatus.WAITING && passed) {
    return ReminderBackendStatus.MISSED;
  }
  return backendStatus;
}

/**
 * STATE-002 UI 状态映射
 * WAITING → 「待提醒」；TRIGGERED → 「已提醒」；MISSED → 「未送达」（不伪装成功，供前端附原因解释）；CLOSED → 不展示
 */
function uiLabelOf(backendStatus) {
  switch (backendStatus) {
    case ReminderBackendStatus.WAITING: return '待提醒';
    case ReminderBackendStatus.TRIGGERED: return '已提醒';
    case ReminderBackendStatus.MISSED: return '未送达';
    default: return null; // CLOSED 不展示
  }
}

/** 提交前校验：方式与提前量至少各选 1 项（PAGE-008 交互） */
function validateSubmit(channels, offsets) {
  if (!Array.isArray(channels) || channels.length === 0) return false;
  if (!Array.isArray(offsets) || offsets.length === 0) return false;
  // 通道只允许 ENUM-004 里列出的；提前量 V1 只允许 5 / 2 分钟
  if (!channels.every(c => Object.values(ChannelType).includes(c))) return false;
  return offsets.every(o => V1.ALLOWED_OFFSETS.includes(o));
}

/**
 * REMINDER-RULE-003 错峰推送：同一放票时间点的批量任务在 30 秒窗口内错峰
 * 返回每条任务应延迟的毫秒数（稳定分布，同一入参恒定）
 */
function staggerDelays(count, windowSeconds = V1.STAGGER_WINDOW_SECONDS) {
  if (count <= 1) return [0];
  const step = (windowSeconds * 1000) / count;
  return Array.from({ length: count }, (_, i) => Math.floor(i * step));
}

/**
 * REMINDER-RULE-008 Banner 文案（PAGE-009 旧任务列表口径，保留兼容）
 * 优先级 ① 即将开始提醒（1 小时内）② 系统公告 ③ 活动公告，一次仅一条
 * 文档示例：「今天18:30开抢慕田峪长城5月31日的门票，还有20分钟」
 *
 * V2 首页的吸顶横幅改用 buildReleaseBanner（按行程项算），本函数只服务旧任务列表。
 */
function buildBanner(tasks, nowTs = time.now()) {
  const soon = tasks
    .filter(t => t.backendStatus === ReminderBackendStatus.WAITING)
    .map(t => ({ ...t, releaseAtTs: new Date(t.releaseAt).getTime() }))
    .filter(t => {
      const diff = t.releaseAtTs - nowTs.getTime();
      return diff > 0 && diff <= V1.BANNER_WINDOW_HOURS * 3600 * 1000;
    })
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];

  if (!soon) return null;

  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - nowTs.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  // 「今天」以传入的 nowTs 为基准判定，不读系统时间，保证可测试
  const isToday = time.toDateStr(releaseAt) === time.toDateStr(nowTs);
  const isTomorrow = time.toDateStr(releaseAt) === time.addDays(time.toDateStr(nowTs), 1);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${time.beijingParts(releaseAt).month}月${time.beijingParts(releaseAt).day}日`);
  // 文档示例：「今天18:30开抢慕田峪长城5月31日的门票，还有20分钟」——出行日不带星期
  const vp = time.beijingParts(time.parseBeijing(soon.visitDate, '12:00'));
  const visitLabel = `${vp.month}月${vp.day}日`;

  return {
    type: 'UPCOMING',
    text: `${dayWord}${time.formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${visitLabel}的门票，还有${minutesLeft}分钟`,
    taskId: soon._id,
    minutesLeft,
  };
}

/**
 * REMINDER-RULE-008 吸顶放票横幅文案（2026-09-16 V2 改按行程项）
 *
 * 旧版按提醒任务算，只有「设了提醒」的项才可能出现——没设提醒的项永远不进横幅，
 * 但用户照样得知道「下一张该抢什么票」。V2 改按行程项算，跨全部当前/未来行程取全局最近一条。
 *
 * 措辞刻意避开「还有 N 分钟」：提醒是在开票**前 N 分钟**发的，而横幅讲的是**开票时刻本身**。
 * 写「还有30分钟」会和推送文案混为一谈，用户会以为「是不是已经提醒过我了」。
 * 决策文档 2026-09-20 条目 2 对提醒开关文案立了同一条规矩（用「开票前提醒我」而非「放票了提醒我」）。
 *
 * 超过 BANNER_WINDOW_HOURS 的项不进横幅（与旧口径一致，横幅只承载「眼下要发生的事」）。
 *
 * @param {Array} decorated item.loadDecoratedItems 的结果，需含 releaseAt/spotName/visitDate/itemId
 */
function buildReleaseBanner(decorated, nowTs = time.now()) {
  const soon = (decorated || [])
    .filter(d => d.releaseAt)
    .map(d => ({ ...d, releaseAtTs: new Date(d.releaseAt).getTime() }))
    .filter(d => {
      const diff = d.releaseAtTs - nowTs.getTime();
      return diff > 0 && diff <= V1.BANNER_WINDOW_HOURS * 3600 * 1000;
    })
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];

  if (!soon) return null;

  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - nowTs.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  // 「今天」以传入的 nowTs 为基准判定，不读系统时间，保证可测试
  const isToday = time.toDateStr(releaseAt) === time.toDateStr(nowTs);
  const isTomorrow = time.toDateStr(releaseAt) === time.addDays(time.toDateStr(nowTs), 1);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${time.beijingParts(releaseAt).month}月${time.beijingParts(releaseAt).day}日`);
  // 出行日不带星期（与设计稿「5月31日的门票」一致）
  const vp = time.beijingParts(time.parseBeijing(soon.visitDate, '12:00'));
  const visitLabel = `${vp.month}月${vp.day}日`;

  return {
    type: 'UPCOMING',
    text: `${dayWord}${time.formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${visitLabel}的门票，还有${minutesLeft}分钟`,
    itemId: soon.itemId,
    spotId: soon.spotId,
    visitDate: soon.visitDate,
    releaseAt: soon.releaseAt,
    minutesLeft,
  };
}

/**
 * 开场前等待文案（推送落地浮窗顶部）。
 *
 * 推送是**提前 N 分钟**发的，用户点进来时票还没开抢——必须明确告诉他
 * 「现在还不能抢，等到几点」，否则用户会反复下拉刷新并以为产品坏了。
 */
function buildStandbyText(releaseAt, nowTs = time.now()) {
  if (!releaseAt) return '';
  const diff = new Date(releaseAt).getTime() - nowTs.getTime();
  if (diff <= 0) return '已开抢，去官方渠道预约';
  const totalMin = Math.ceil(diff / 60000);
  if (totalMin < 60) return `距开抢还有 ${totalMin} 分钟，请在此等待`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `距开抢还有 ${h} 小时 ${m} 分，请在此等待`;
}

/* ============ 数据库操作区 ============ */

/**
 * REMINDER-RULE-004 读取时兜底补判（幂等，就地写库）
 *
 * 把「已过 releaseAt 仍是 WAITING」的任务补判为 MISSED，理由优先取 notifier 发送失败时
 * 记下的真实原因（lastSendError），避免笼统文案把「WX_APPSECRET 未配置」「43101 配额不足」
 * 这类可行动信息盖掉。写库失败也不影响本次响应——内存里的状态照样收敛，
 * 保证 UI 不会出现「已过期却显示待提醒、且毫无提示」的静默状态。
 *
 * 顺带做一次**台账自愈**（2026-09-16）：补判出 MISSED 且该用户本地台账仍记有额度时，
 * 说明台账在骗人（页面写「已授权 N 次」、任务却条条 MISSED），清零让 UI 诚实、
 * 并让下次提交重新走授权。判定条件见 `lib/quota.js` 的 shouldHealQuota——
 * ⚠️ 必须带 lastSendError 前置条件，链路故障（从未尝试发送）不能清零，否则白丢用户额度。
 *
 * @param {string} [userId] 可选；缺省时从 tasks 里推断（list 已按用户过滤，同批任务必属同一人）
 * @returns {number} 本次补判条数
 */
async function sweepOverdue(db, tasks, nowTs = time.now(), userId, resolveReleaseAt = null) {
  const overdue = (tasks || []).filter(t => {
    if (t.backendStatus !== ReminderBackendStatus.WAITING) return false;
    // releaseAt 缺失（行程合并改挂、老数据）→ 用回调按 (spotId, visitDate) 现算，
    // 算不出来就当作「还没有可抢的时间点」，既不补判也不清零额度。
    let releaseAt = t.releaseAt;
    if (!releaseAt && resolveReleaseAt) releaseAt = resolveReleaseAt(t);
    t._resolvedReleaseAt = releaseAt || null;
    if (!releaseAt) return false;
    return new Date(releaseAt).getTime() <= nowTs.getTime();
  });

  const healCandidates = new Set();
  for (const t of overdue) {
    const patch = {
      backendStatus: ReminderBackendStatus.MISSED,
      missedReason: t.missedReason || t.lastSendError || '超过放票时间点未触发成功',
      cleanAt: new Date(nowTs.getTime() + V1.CLEAN_AFTER_DAYS * 86400000),
    };
    try {
      await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).update({ data: patch });
    } catch (e) {
      console.error('[reminder] sweepOverdue 写库失败', t._id, e.message);
    }
    Object.assign(t, patch);
    /* 台账自愈候选：确实发过（lastSendError 非空）且失败原因不是本地配置/链路问题 */
    if (t.userId && shouldHealQuota(t.lastSendError)) healCandidates.add(t.userId);
  }

  const owner = userId || (overdue[0] && overdue[0].userId);
  if (owner && healCandidates.has(owner)) {
    await healSubscribeQuota(db, owner, DEFAULT_SUBSCRIBE_TEMPLATE_ID);
  }
  return overdue.length;
}

/**
 * FLOW-001 最后一步：清单 → 行程项 + 任务（提交行程清单）
 *
 * 2026-09-20 起这是**唯一**创建行程的地方（「生成时间线」已改为纯预览）。
 * 因此这里要按顺序做三件事：
 *   ① 由清单内容推导行程的日期段与各景点自己的段；
 *   ② 调 trip.create 建/合并行程（TRIP-RULE-002 的合并判定挪到这里）；
 *   ③ 把清单行挂到真实行程上、写行程项、为勾了提醒的项建任务、清空清单。
 *
 * 一个清单项 × N 个 offset = N 条任务（REMINDER-RULE-001）
 * **清单为一次性缓冲区：提交即消费**（CART-RULE-003）。
 *
 * 云开发事务要求所有读写都在事务内，且不支持 where 批量删除，
 * 因此这里逐条 doc() 操作。
 */
async function submit(db, userId, event) {
  const tripId = event.tripId || '';
  const channels = event.channels || [];
  const offsets = event.offsets || [];

  /* 读清单：不传 tripId = 读暂存区（纯预览化后的常规路径）；
     传了真实 tripId = 读那一个行程的清单（老链路兼容）。 */
  const cartWhere = { userId, tripId: cart.cartTripIdOf(tripId) };
  const cartRes = await db.collection(COLLECTIONS.REMINDER_CART).where(cartWhere).get();
  const cartItems = cartRes.data || [];
  if (cartItems.length === 0) return fail(ERRORS.CART_EMPTY);

  const reminderItems = cartItems.filter(i =>
    i.reservationRequired !== false && i.remindOn === true);
  if (reminderItems.length > 0 && !validateSubmit(channels, offsets)) return fail(ERRORS.BAD_PARAM);
  if (reminderItems.some(i => !i.releaseAt)) return fail(ERRORS.BAD_PARAM);

  const nowTs = time.now();

  /* ① + ② 建/合并行程。日期段 = 清单里各项 visitDate 的并集，
     各景点保留自己的段（故宫 10.2-10.3 / 国博 10.4，合并成一个行程但不互相膨胀）。 */
  const targetTripId = await resolveTripForCart(db, userId, tripId, cartItems);

  const itemMap = await tripItem.existingItemMap(db, userId, targetTripId);
  const createdTasks = [];
  const createdItems = [];
  const transaction = await db.startTransaction();

  try {
    for (const cartItem of cartItems) {
      const remindOn = cartItem.reservationRequired !== false && cartItem.remindOn === true;
      const key = `${targetTripId}|${cartItem.spotId}|${cartItem.visitDate}`;
      const existing = itemMap[key];
      let itemId = existing && existing._id;

      if (existing) {
        if (existing.remindOn !== remindOn) {
          await transaction.collection(COLLECTIONS.TRIP_ITEMS).doc(itemId).update({
            data: { remindOn, updatedAt: nowTs },
          });
        }
      } else {
        const itemData = tripItem.makeItemData({
          userId,
          tripId: targetTripId,
          spotId: cartItem.spotId,
          visitDate: cartItem.visitDate,
          remindOn,
          nowTs,
        });
        const itemRes = await transaction.collection(COLLECTIONS.TRIP_ITEMS).add({ data: itemData });
        itemId = itemRes._id;
        createdItems.push({ _id: itemId, ...itemData });
      }

      // 免预约项只落行程项；仅需预约且勾选提醒的项生成任务。
      if (remindOn) {
        const taskData = {
          userId,
          itemId,
          tripId: targetTripId,
          spotId: cartItem.spotId,
          visitDate: cartItem.visitDate,
          releaseAt: new Date(cartItem.releaseAt),
          offsets: [...offsets].sort((a, b) => b - a),
          channels,
          backendStatus: ReminderBackendStatus.WAITING,
          triggeredAt: null,
          missedReason: null,
          cleanAt: null,
          sentOffsets: [],
          createdAt: nowTs,
        };
        const taskRes = await transaction.collection(COLLECTIONS.REMINDER_TASKS).add({ data: taskData });
        createdTasks.push({ _id: taskRes._id, ...taskData });
      }

      await transaction.collection(COLLECTIONS.REMINDER_CART).doc(cartItem._id).remove();
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    return fail({ code: 1011, message: `提交失败：${err.message}` });
  }

  const noReminder = cartItems.length - reminderItems.length;
  return ok({
    created: createdTasks.length,
    createdItems: createdItems.length,
    createdTasks: createdTasks.length,
    noReminder,
    // 契约 8.5 要求回传 tripId：前端据此把首页切到这个行程、并写 globalData.currentTripId
    tripId: targetTripId,
    items: createdItems,
    tasks: createdTasks,
    toast: createdTasks.length > 0
      ? `已加入行程 · 其中 ${createdTasks.length} 个已设提醒`
      : `已加入行程 · ${createdItems.length} 项`,
    needsOaAuth: channels.includes(ChannelType.OFFICIAL_ACCOUNT),
  });
}

/**
 * 提交时解析目标行程：纯预览化后行程是**提交时才创建**的。
 *
 * - 清单是暂存区（tripId 为占位值 / 空）→ 按清单内容建/合并行程；
 * - 清单已挂真实行程（老链路）→ 直接用那个行程，不再新建。
 *
 * 各景点的日期段由它自己的 visitDate 集合推导（min/max），
 * 这样合并后「故宫 10.2-10.3 + 国博 10.4」不会互相膨胀成 10.2-10.4。
 */
async function resolveTripForCart(db, userId, tripId, cartItems) {
  if (tripId && tripId !== require('./schema').PENDING_CART_TRIP_ID) return tripId;

  const segMap = new Map();
  for (const c of cartItems) {
    const cur = segMap.get(c.spotId);
    if (!cur) segMap.set(c.spotId, { spotId: c.spotId, startDate: c.visitDate, endDate: c.visitDate });
    else {
      if (c.visitDate < cur.startDate) cur.startDate = c.visitDate;
      if (c.visitDate > cur.endDate) cur.endDate = c.visitDate;
    }
  }
  const segs = [...segMap.values()];
  const startDate = segs.reduce((m, s) => (s.startDate < m ? s.startDate : m), segs[0].startDate);
  const endDate = segs.reduce((m, s) => (s.endDate > m ? s.endDate : m), segs[0].endDate);

  const res = await trip.create(db, userId, {
    startDate,
    endDate,
    spotIds: segs.map(s => s.spotId),
    spotSegments: segs,
  });
  return res.success ? res.tripId : '';
}

/**
 * PAGE-009 任务列表（首页形态2）
 * 行程分组 + 进行中/已过期筛选 + 状态标签
 */
async function list(db, userId, { tripId = null, filter = 'active' } = {}) {
  const where = { userId };
  if (tripId) where.tripId = tripId;

  const res = await db.collection(COLLECTIONS.REMINDER_TASKS).where(where).get();
  const all = (res.data || []).filter(t => t.backendStatus !== ReminderBackendStatus.CLOSED);

  const nowTs = time.now();
  /* 读取时兜底补判（见 sweepOverdue）：notifier 的 sweepMissed 没跑成功时，
     用户一进首页也能看到真实状态，而不是「已过期 + 待提醒 + 无提示」。
     传入 userId 以便顺带做台账自愈（同批任务必属同一用户）。 */
  await sweepOverdue(db, all, nowTs, userId);

  const spotIds = [...new Set(all.map(t => t.spotId))];
  let spotMap = {};
  if (spotIds.length) {
    const spotsRes = await db.collection(COLLECTIONS.SPOTS)
      .where({ spotId: db.command.in(spotIds) }).get();
    (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
  }

  const enriched = all.map(t => {
    const releaseAt = new Date(t.releaseAt);
    const msLeft = releaseAt.getTime() - nowTs.getTime();
    const totalMin = Math.max(0, Math.floor(msLeft / 60000));
    // 生效状态 = 落库状态收敛后的结果（已过放票时刻的 WAITING 视为 MISSED）
    const status = effectiveStatusOf(t.backendStatus, t.releaseAt, nowTs);
    // 「已过期」= MISSED 或已过放票时间点（PAGE-009 筛选定义）
    const expired = status === ReminderBackendStatus.MISSED || msLeft <= 0;
    return {
      ...t,
      backendStatus: status,
      spotName: spotMap[t.spotId] ? spotMap[t.spotId].name : '未知景点',
      difficultyScore: spotMap[t.spotId] ? spotMap[t.spotId].difficultyScore : null,
      releaseTimeLabel: time.formatHourMinute(releaseAt),
      releaseDateStr: time.toDateStr(releaseAt),
      grabLabel: `开抢${time.formatMonthDayWeekCn(t.visitDate)}门票`,
      statusLabel: uiLabelOf(status),
      countdown: msLeft > 0 && msLeft < 3 * 3600 * 1000
        ? { text: `还剩${String(Math.floor(totalMin / 60)).padStart(2, '0')}h ${String(totalMin % 60).padStart(2, '0')}m`, urgent: true }
        : null,
      expired,
    };
  });

  const active = enriched.filter(t => !t.expired);
  const past = enriched.filter(t => t.expired);
  const shown = filter === 'expired' ? past : active;

  // 按放票日期分组（PAGE-009 时间线列表）
  const map = new Map();
  for (const t of shown) {
    if (!map.has(t.releaseDateStr)) map.set(t.releaseDateStr, []);
    map.get(t.releaseDateStr).push(t);
  }
  const groups = [...map.entries()]
    .sort((a, b) => (filter === 'expired' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([dateStr, items]) => ({
      key: dateStr,
      label: time.formatMonthDay(dateStr),
      items: items.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    }));

  return ok({
    groups,
    counts: { active: active.length, expired: past.length },
    banner: buildBanner(enriched, nowTs),
    // HOME-RULE-001 首页形态判定：无任何任务 → 形态1
    homeMode: enriched.length === 0 ? 1 : 2,
  });
}

/**
 * REMINDER-RULE-005 单条删除任务
 *
 * 2026-09-14 放宽：**WAITING 与 MISSED 均可单条删除**。
 * 原口径「仅 WAITING 可删」在「过期任务读取时收敛为 MISSED」上线后会变成死结——
 * 一条已经失败的任务反而删不掉，只能靠「清空任务」连带清掉别的记录。
 * 现在只有 TRIGGERED（已成功送达）保留为历史记录，不允许单删，走「清空任务」批量清理。
 */
const DELETABLE_STATUS = [ReminderBackendStatus.WAITING, ReminderBackendStatus.MISSED];

async function remove(db, userId, taskId) {
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({ _id: taskId, userId }).get();
  const task = (res.data || [])[0];
  if (!task) return fail(ERRORS.BAD_PARAM);
  if (!DELETABLE_STATUS.includes(task.backendStatus)) {
    return fail({ code: 1012, message: '已提醒的任务不可单条删除，可在「清空任务」中批量清理' });
  }

  await db.collection(COLLECTIONS.REMINDER_TASKS).doc(taskId).remove();
  return ok({ taskId, tripId: task.tripId });
}

/**
 * PAGE-009 清空任务：用户确认后清空提醒任务（含已提醒/过期的历史记录）
 * 与 task.remove 的单条「仅待提醒可删」不同，这是显式批量清理操作。
 * 传 filter/tripId 时只清空当前 tab 范围（与 task.list 的过期判定一致），
 * 不传则清空该用户全部任务。
 */
async function clear(db, userId, { filter = null, tripId = null } = {}) {
  const where = { userId };
  if (tripId) where.tripId = tripId;

  const res = await db.collection(COLLECTIONS.REMINDER_TASKS).where(where).get();
  let targets = res.data || [];
  if (filter) {
    const nowTs = time.now();
    targets = targets.filter(t => {
      if (t.backendStatus === ReminderBackendStatus.CLOSED) return false;
      const msLeft = new Date(t.releaseAt).getTime() - nowTs.getTime();
      const expired = t.backendStatus === ReminderBackendStatus.MISSED || msLeft <= 0;
      return filter === 'expired' ? expired : !expired;
    });
  }

  const affectedTripIds = [...new Set(targets.map(t => t.tripId).filter(Boolean))];
  for (const t of targets) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
  }
  return ok({ cleared: targets.length, affectedTripIds });
}

/**
 * REMINDER-RULE-006 自动清理：TRIGGERED/MISSED 后 14 天 → CLOSED 并物理删除
 * 由 notifier 定时任务调用，返回受影响的 tripId 供级联检查（TRIP-RULE-004）
 */
async function cleanup(db) {
  const nowTs = time.now();
  const res = await db.collection(COLLECTIONS.REMINDER_TASKS)
    .where({
      backendStatus: db.command.in([
        ReminderBackendStatus.TRIGGERED, ReminderBackendStatus.MISSED,
      ]),
      cleanAt: db.command.lte(nowTs),
    })
    .get();

  const affected = [];
  for (const t of (res.data || [])) {
    await db.collection(COLLECTIONS.REMINDER_TASKS).doc(t._id).remove();
    affected.push({ userId: t.userId, tripId: t.tripId });
  }
  return { removed: affected.length, affected };
}

module.exports = {
  remindAtOf,
  uiLabelOf,
  effectiveStatusOf,
  validateSubmit,
  staggerDelays,
  buildBanner,
  buildReleaseBanner,
  buildStandbyText,
  sweepOverdue,
  submit,
  list,
  remove,
  clear,
  cleanup,
};
