/**
 * 放票时段收敛回归：当前清华、军博每个出行日只创建一条 reminder_task。
 *
 * 覆盖：
 * - 清华抽签 statusOnly 只参与状态和窗口，不创建提醒；即时预约仍按工作日/周末/法定节假日计算；
 * - 军博只保留最早的 08:00 放票，不因官方另外两个场次重复占用提醒额度；
 * - 清单/提交按任务数，而非日期数，计算授权与名额需求；
 * - tripItem.updateReminder 重建完整时段集合。
 *
 * 运行：node test/multi-release.test.js
 */

const { createDb } = require('./mock-db');
const fs = require('fs');
const {
  COLLECTIONS,
  ChannelType,
  ReminderBackendStatus,
} = require('../cloudfunctions/reminder/lib/schema');
const releaseSchedule = require('../cloudfunctions/reminder/lib/release-schedule');
const task = require('../cloudfunctions/reminder/lib/task');
const trip = require('../cloudfunctions/reminder/lib/trip');
const cart = require('../cloudfunctions/reminder/lib/cart');
const itemDomain = require('../cloudfunctions/reminder/lib/item');
const actions = require('../cloudfunctions/reminder/lib/trip-item-actions');
const time = require('../cloudfunctions/reminder/lib/time');

const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;
const spotMap = Object.fromEntries(spots.map(spot => [spot.spotId, spot]));
const ruleMap = Object.fromEntries(rules.map(rule => [rule.spotId, rule]));

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

function freshDb() {
  const db = createDb();
  db._seed(COLLECTIONS.SPOTS, spots);
  db._seed(COLLECTIONS.RELEASE_RULES, rules);
  return db;
}

function nextDateWhere(predicate, minOffset = 10) {
  for (let offset = minOffset; offset < minOffset + 21; offset += 1) {
    const date = time.addDays(time.todayStr(), offset);
    if (predicate(date)) return date;
  }
  throw new Error('找不到符合条件的测试日期');
}

function slotLabels(slots) {
  return slots.map(slot => `${slot.releaseDateStr} ${slot.releaseTime}`).join(',');
}

(async () => {
  console.log('=== 1. 清华状态时段与提醒时段分离 ===');
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-11'
    )),
    '2026-11-09 17:00,2026-11-10 08:00',
    '工作日状态：抽签提前 2 天 17:00，即时提前 1 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.reminderSlotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-11'
    )),
    '2026-11-10 08:00',
    '工作日提醒：只保留即时预约，提前 1 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-14'
    )),
    '2026-11-06 17:00,2026-11-07 08:00',
    '周末状态：抽签提前 8 天 17:00，即时提前 7 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.reminderSlotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-14'
    )),
    '2026-11-07 08:00',
    '周末提醒：只保留即时预约，提前 7 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-10-01'
    )),
    '2026-09-23 17:00,2026-09-24 08:00',
    '法定节假日状态：抽签提前 8 天，即时提前 7 天'
  );
  eq(
    slotLabels(releaseSchedule.reminderSlotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-10-01'
    )),
    '2026-09-24 08:00',
    '法定节假日提醒：只保留即时预约'
  );
  eq(
    releaseSchedule.isHoliday(ruleMap.tsinghua, '2026-10-07'),
    true,
    '节假日范围包含结束日'
  );
  eq(
    releaseSchedule.isHoliday(ruleMap.tsinghua, '2026-10-08'),
    false,
    '节假日范围外按工作日'
  );

  console.log('\n=== 2. 军博同一出行日只保留最早放票时段 ===');
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.junbo,
      ruleMap.junbo,
      '2026-11-15'
    )),
    '2026-11-08 08:00',
    '军博只计算最早 08:00 这一场'
  );

  console.log('\n=== 2.1 清华抽签开放后状态可抢，但提醒仍只有即时预约 ===');
  {
    const item = {
      _id: 'tsinghua_state_item',
      tripId: 'trip_tsinghua_state',
      spotId: 'tsinghua',
      visitDate: '2026-11-26',
      result: null,
      resultAt: null,
      remindOn: true,
    };
    const before = itemDomain.decorateItem({
      item,
      spot: spotMap.tsinghua,
      rule: ruleMap.tsinghua,
      tasks: [],
      nowTs: new Date('2026-11-24T16:59:00+08:00'),
      supportsMultiRelease: true,
    });
    eq(before.ticketState, 'PENDING', '抽签开放前仍是待抢票');
    eq(before.canMark, false, '抽签开放前不显示结果标记');
    eq(slotLabels(before.releaseSlots), '2026-11-25 08:00', '首页提醒时段仍只有即时预约');
    eq(before.reminderTaskCount, 1, '状态时段不增加提醒任务数');

    const after = itemDomain.decorateItem({
      item,
      spot: spotMap.tsinghua,
      rule: ruleMap.tsinghua,
      tasks: [],
      nowTs: new Date('2026-11-24T17:01:00+08:00'),
      supportsMultiRelease: true,
    });
    eq(after.ticketState, 'BOOKABLE', '抽签开放后立即变为可抢票');
    eq(after.canMark, true, '抽签开放后允许标记抢到了');
    eq(slotLabels(after.releaseSlots), '2026-11-25 08:00', '状态变化不把抽签塞进提醒时段');
    eq(after.reminderTaskCount, 1, '抽签状态不占提醒名额');

    const success = itemDomain.decorateItem({
      item: { ...item, result: 'SUCCESS', resultAt: new Date('2026-11-24T22:01:00+08:00') },
      spot: spotMap.tsinghua,
      rule: ruleMap.tsinghua,
      tasks: [],
      nowTs: new Date('2026-11-24T16:59:00+08:00'),
      supportsMultiRelease: true,
    });
    eq(success.ticketState, 'SUCCESS', '人工已约到永远优先于时间态');
  }

  console.log('\n=== 3. 提交军博一天：1 个行程项 + 1 条任务 ===');
  {
    const db = freshDb();
    const user = 'openid_multi_junbo';
    const visitDate = nextDateWhere(
      date => ['saturday', 'sunday'].includes(time.dayNameOf(date)),
      12
    );
    const tripRes = await trip.create(db, user, {
      startDate: visitDate,
      endDate: visitDate,
      spotIds: ['junbo'],
    });
    const added = await cart.add(db, user, {
      tripId: tripRes.tripId,
      spotId: 'junbo',
      visitDate,
      remindOn: true,
      supportsMultiRelease: true,
    });
    eq(added.releaseTaskCount, 1, '加入清单只计 1 条提醒');
    const listed = await cart.list(db, user, tripRes.tripId, { supportsMultiRelease: true });
    eq(listed.summary.reminderCount, 1, '清单仍是 1 个日期项');
    eq(listed.summary.reminderTaskCount, 1, '授权/名额需求只按 1 条任务计');

    const committed = await task.submit(db, user, {
      tripId: tripRes.tripId,
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(committed.success, true, '提交成功');
    eq(committed.createdItems, 1, '只创建一个行程项');
    eq(committed.createdTasks, 1, '只创建一条提醒任务');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .filter(row => row.itemId === committed.tasks[0].itemId)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows.length, 1, '数据库中只有一条任务');
    eq(taskRows[0].releaseTime, '08:00', '任务固定为最早 08:00 放票');
    eq(taskRows[0].releaseKey, 'junbo-0800', '只保留最早时段的稳定 releaseKey');
    eq(
      taskRows.every(row => row.backendStatus === ReminderBackendStatus.WAITING),
      true,
      '唯一任务可发送'
    );

    const decorated = await itemDomain.loadDecoratedItems(db, user, {
      tripId: tripRes.tripId,
      nowTs: time.now(),
      supportsMultiRelease: true,
    });
    eq(decorated[0].reminder.taskCount, 1, '行程项只聚合一个任务');
    eq(decorated[0].reminder.waitingCount, 1, '唯一任务待提醒');
    eq(decorated[0].reminder.state, 'WAITING', '聚合提醒态为待提醒');
  }

  console.log('\n=== 4. 提交清华工作日一天：只创建即时预约任务 ===');
  {
    const db = freshDb();
    const user = 'openid_multi_tsinghua';
    const visitDate = nextDateWhere(
      date => !['monday', 'saturday', 'sunday'].includes(time.dayNameOf(date)),
      12
    );
    const tripRes = await trip.create(db, user, {
      startDate: visitDate,
      endDate: visitDate,
      spotIds: ['tsinghua'],
    });
    await cart.add(db, user, {
      tripId: tripRes.tripId,
      spotId: 'tsinghua',
      visitDate,
      remindOn: true,
      supportsMultiRelease: true,
    });
    const committed = await task.submit(db, user, {
      tripId: tripRes.tripId,
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(committed.createdItems, 1, '只创建一个行程项');
    eq(committed.createdTasks, 1, '不再创建抽签任务');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows[0].releaseKey, 'tsinghua-instant', '只保留即时预约任务');
    eq(
      taskRows.map(row => `${time.toDateStr(row.releaseAt)} ${time.formatHourMinute(row.releaseAt)}`).join(','),
      `${time.addDays(visitDate, -1)} 08:00`,
      '工作日只提前 1 天 08:00 提醒即时预约'
    );
  }

  console.log('\n=== 5. updateReminder 从零重建时军博仍只有一条任务 ===');
  {
    const db = freshDb();
    const user = 'openid_multi_rebuild';
    const visitDate = nextDateWhere(
      date => ['saturday', 'sunday'].includes(time.dayNameOf(date)),
      12
    );
    const tripRes = await trip.create(db, user, {
      startDate: visitDate,
      endDate: visitDate,
      spotIds: ['junbo'],
    });
    const itemId = 'item_multi_rebuild';
    await db.collection(COLLECTIONS.TRIP_ITEMS).add({
      data: {
        _id: itemId,
        userId: user,
        tripId: tripRes.tripId,
        spotId: 'junbo',
        visitDate,
        backupGroupId: `${tripRes.tripId}:junbo`,
        remindOn: false,
        result: null,
        resultAt: null,
        createdAt: time.now(),
        updatedAt: time.now(),
      },
    });
    const updated = await actions.updateReminder(db, user, {
      itemId,
      remindOn: true,
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(updated.success, true, '开启提醒成功');
    eq(updated.item.reminder.taskCount, 1, '返回聚合任务数 1');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .filter(row => row.itemId === itemId)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows.map(row => row.releaseTime).join(','), '08:00', '重建后只保留最早时段');
  }

  console.log('\n=== 6. 未声明能力的旧客户端仍只创建一条旧契约任务 ===');
  {
    const db = freshDb();
    const user = 'openid_multi_legacy';
    const visitDate = nextDateWhere(
      date => ['saturday', 'sunday'].includes(time.dayNameOf(date)),
      12
    );
    const tripRes = await trip.create(db, user, {
      startDate: visitDate,
      endDate: visitDate,
      spotIds: ['junbo'],
    });
    const added = await cart.add(db, user, {
      tripId: tripRes.tripId,
      spotId: 'junbo',
      visitDate,
      remindOn: true,
    });
    eq(added.releaseTaskCount, 1, '旧请求只计一条任务');
    const committed = await task.submit(db, user, {
      tripId: tripRes.tripId,
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
    });
    eq(committed.createdTasks, 1, '旧请求只创建一条任务');
    eq(
      time.formatHourMinute(db._dump(COLLECTIONS.REMINDER_TASKS)[0].releaseAt),
      '08:00',
      '旧请求继续使用顶层 advanceDays + releaseTime'
    );
  }

  console.log('\n=== 7. mock 镜像：清华与军博都只创建一条任务 ===');
  {
    delete require.cache[require.resolve('../miniprogram/utils/mock.js')];
    const mock = require('../miniprogram/utils/mock.js');
    const holidayPreview = await mock.mockCall('timeline.preview', {
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      spotIds: ['tsinghua'],
      supportsMultiRelease: true,
    });
    eq(
      slotLabels(holidayPreview.events[0].releaseSlots),
      '2026-09-24 08:00',
      'mock 法定节假日只保留即时预约提前 7 天'
    );
    const mockItem = {
      _id: 'mock_tsinghua_state_item',
      tripId: 'mock_trip_tsinghua_state',
      spotId: 'tsinghua',
      visitDate: '2026-11-26',
      result: null,
      resultAt: null,
      remindOn: true,
    };
    const mockBefore = mock.__internals.decorateItem(
      mockItem,
      new Date('2026-11-24T16:59:00+08:00'),
      true
    );
    const mockAfter = mock.__internals.decorateItem(
      mockItem,
      new Date('2026-11-24T17:01:00+08:00'),
      true
    );
    eq(mockBefore.ticketState, 'PENDING', 'mock 抽签开放前待抢票');
    eq(mockAfter.ticketState, 'BOOKABLE', 'mock 抽签开放后可抢票');
    eq(slotLabels(mockAfter.releaseSlots), '2026-11-25 08:00', 'mock 状态变化不增加提醒时段');
    eq(mockAfter.reminderTaskCount, 1, 'mock 抽签不占提醒名额');
    const visitDate = nextDateWhere(
      date => ['saturday', 'sunday'].includes(time.dayNameOf(date)),
      12
    );
    const added = await mock.mockCall('cart.add', {
      spotId: 'junbo',
      visitDate,
      remindOn: true,
      supportsMultiRelease: true,
    });
    eq(added.releaseTaskCount, 1, 'mock 清单项只要求 1 条任务');
    const committed = await mock.mockCall('cart.commit', {
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(committed.createdItems, 1, 'mock 创建一个行程项');
    eq(committed.createdTasks, 1, 'mock 只创建一条提醒任务');
    const apiSource = fs.readFileSync(
      require.resolve('../miniprogram/utils/api.js'),
      'utf8'
    );
    eq(
      /supportsMultiRelease:\s*true/.test(apiSource),
      true,
      '新客户端对所有 reminder 请求统一声明多任务能力'
    );
  }

  console.log('\n' + (fail ? `${fail} FAILED` : 'ALL PASS'));
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
