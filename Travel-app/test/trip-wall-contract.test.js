/**
 * 首页行程状态墙契约冻结测试（2026-09-16 P0）
 *
 * 本测试只锁定开发前不得再漂移的枚举名、集合名和状态窗口，
 * 不验证尚未实现的业务逻辑。
 */
const {
  COLLECTIONS,
  TicketState,
  TicketResult,
  ReminderDeliveryState,
  V1,
  ERRORS,
} = require('../cloudfunctions/reminder/lib/schema');

let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

console.log('=== 首页行程状态墙契约 ===');
eq(COLLECTIONS.TRIP_ITEMS, 'trip_items', 'trip_items 集合名');
eq(Object.values(TicketState).join(','), 'PENDING,BOOKABLE,SUCCESS,FAILED,UNMARKED,NO_RESERVATION', '六个票务展示状态');
eq(Object.values(TicketResult).join(','), 'SUCCESS,FAILED', '人工结果仅 SUCCESS/FAILED');
eq(Object.values(ReminderDeliveryState).join(','), 'NOT_SET,WAITING,TRIGGERED,MISSED', '提醒送达状态独立');
eq(V1.RESULT_UNDO_SECONDS, 4, '人工结果撤销窗口为 4 秒（2026-09-17 由 10 秒收紧）');
eq(V1.UNMARKED_AFTER_HOURS, 24, '未标记中性态在放票 24 小时后');
eq(ERRORS.ITEM_NOT_FOUND.code, 1013, '行程项不存在错误码');
eq(ERRORS.ITEM_RESULT_INVALID.code, 1014, '结果标记非法错误码');
eq(ERRORS.ITEM_UNDO_EXPIRED.code, 1015, '撤销过期错误码');
eq(ERRORS.ITEM_ENDED.code, 1016, '行程项结束错误码');

if (fail) {
  console.log(`\nFAILED: ${fail}`);
  process.exit(1);
}
console.log('\nALL PASS');
