/**
 * 多放票时段提醒回归：一个行程项可以对应多条 reminder_tasks。
 *
 * 覆盖：
 * - 清华按出行日分别计算工作日/周末/法定节假日的即时与抽签提前天数；
 * - 军博一个出行日创建 08:00 / 17:00 / 20:00 三条任务；
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
  console.log('=== 1. 清华工作日/周末/法定节假日双轨提前天数 ===');
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-11'
    )),
    '2026-11-09 17:00,2026-11-10 08:00',
    '工作日：抽签提前 2 天 17:00，即时提前 1 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-11-14'
    )),
    '2026-11-06 17:00,2026-11-07 08:00',
    '周末：抽签提前 8 天 17:00，即时提前 7 天 08:00'
  );
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.tsinghua,
      ruleMap.tsinghua,
      '2026-10-01'
    )),
    '2026-09-23 17:00,2026-09-24 08:00',
    '法定节假日（国庆周四）：抽签提前 8 天，即时提前 7 天'
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

  console.log('\n=== 2. 军博同一出行日展开 3 个时段 ===');
  eq(
    slotLabels(releaseSchedule.slotsForVisitDate(
      spotMap.junbo,
      ruleMap.junbo,
      '2026-11-15'
    )),
    '2026-11-08 08:00,2026-11-08 17:00,2026-11-08 20:00',
    '军博三条任务时间完整'
  );

  console.log('\n=== 3. 提交军博一天：1 个行程项 + 3 条任务 ===');
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
    eq(added.releaseTaskCount, 3, '加入清单即按 3 条提醒计');
    const listed = await cart.list(db, user, tripRes.tripId, { supportsMultiRelease: true });
    eq(listed.summary.reminderCount, 1, '清单仍是 1 个日期项');
    eq(listed.summary.reminderTaskCount, 3, '授权/名额需求按 3 条任务计');

    const committed = await task.submit(db, user, {
      tripId: tripRes.tripId,
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(committed.success, true, '提交成功');
    eq(committed.createdItems, 1, '只创建一个行程项');
    eq(committed.createdTasks, 3, '创建三条提醒任务');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .filter(row => row.itemId === committed.tasks[0].itemId)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows.length, 3, '数据库中存在三条任务');
    eq(taskRows.map(row => row.releaseTime).join(','), '08:00,17:00,20:00', '三个放票时刻齐全');
    eq(
      new Set(taskRows.map(row => row.releaseKey)).size,
      3,
      '三条任务使用不同 releaseKey'
    );
    eq(
      taskRows.every(row => row.backendStatus === ReminderBackendStatus.WAITING),
      true,
      '三条任务均可发送'
    );

    const decorated = await itemDomain.loadDecoratedItems(db, user, {
      tripId: tripRes.tripId,
      nowTs: time.now(),
      supportsMultiRelease: true,
    });
    eq(decorated[0].reminder.taskCount, 3, '行程项聚合全部任务');
    eq(decorated[0].reminder.waitingCount, 3, '三条任务均为待提醒');
    eq(decorated[0].reminder.state, 'WAITING', '聚合提醒态为待提醒');
  }

  console.log('\n=== 4. 提交清华工作日一天：同一行程项创建即时 + 抽签两条任务 ===');
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
    eq(committed.createdTasks, 2, '即时与抽签各一条任务');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows.map(row => row.releaseKey).join(','), 'tsinghua-lottery,tsinghua-instant', '任务按实际放票先后排序');
    eq(
      taskRows.map(row => `${time.toDateStr(row.releaseAt)} ${time.formatHourMinute(row.releaseAt)}`).join(','),
      `${time.addDays(visitDate, -2)} 17:00,${time.addDays(visitDate, -1)} 08:00`,
      '工作日提前 2 天抽签、提前 1 天即时'
    );
  }

  console.log('\n=== 5. updateReminder 从零重建军博三条任务 ===');
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
    eq(updated.item.reminder.taskCount, 3, '返回聚合任务数 3');
    const taskRows = db._dump(COLLECTIONS.REMINDER_TASKS)
      .filter(row => row.itemId === itemId)
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
    eq(taskRows.map(row => row.releaseTime).join(','), '08:00,17:00,20:00', '重建三条完整时段');
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

  console.log('\n=== 7. mock 镜像：军博一天也创建 3 条任务 ===');
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
      '2026-09-23 17:00,2026-09-24 08:00',
      'mock 同样把法定节假日按周末高需求规则计算'
    );
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
    eq(added.releaseTaskCount, 3, 'mock 清单项要求 3 条任务');
    const committed = await mock.mockCall('cart.commit', {
      channels: [ChannelType.OFFICIAL_ACCOUNT],
      offsets: [5],
      supportsMultiRelease: true,
    });
    eq(committed.createdItems, 1, 'mock 创建一个行程项');
    eq(committed.createdTasks, 3, 'mock 创建三条提醒任务');
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
