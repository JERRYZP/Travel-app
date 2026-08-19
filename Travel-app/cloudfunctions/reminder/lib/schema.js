/**
 * 集合名、字段枚举与错误码常量（产品文档第四册）
 *
 * 所有集合名与枚举值只在此定义一次，业务代码禁止内联字符串字面量，
 * 避免出现 'rules' / 'release_rules' 这类新旧混用。
 */

/** TABLE-001~007 集合名 */
const COLLECTIONS = {
  TRIPS: 'trips',                   // TABLE-001
  REMINDER_TASKS: 'reminder_tasks', // TABLE-002
  SPOTS: 'spots',                   // TABLE-003
  RELEASE_RULES: 'release_rules',   // TABLE-004（原 rules）
  USERS: 'users',                   // TABLE-005
  SEARCH_HISTORY: 'search_history', // TABLE-006
  REMINDER_CART: 'reminder_cart',   // TABLE-007
};

/** ENUM-001 行程状态 */
const TripStatus = {
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED',
};

/** ENUM-002 提醒任务后台真实状态（STATE-001 状态机） */
const ReminderBackendStatus = {
  WAITING: 'WAITING',
  TRIGGERED: 'TRIGGERED',
  MISSED: 'MISSED',
  CLOSED: 'CLOSED',
};

/** ENUM-003 时间线事件按钮态（STATE-003 选择状态机） */
const EventSelectStatus = {
  SELECTABLE: 'SELECTABLE',   // 「+ 添加提醒」
  IN_CART: 'IN_CART',         // 「已加清单」
  WAITING: 'WAITING',         // 「待提醒」
  REMINDERED: 'REMINDERED',   // 已提醒
  BOOKABLE: 'BOOKABLE',       // 「立即预约」
  FULL: 'FULL',               // 置灰「已约满」
};

/** ENUM-004 提醒通道 */
const ChannelType = {
  OFFICIAL_ACCOUNT: 'OFFICIAL_ACCOUNT',
  SMS: 'SMS', // reserved, V1.1
};

/** ENUM-005 实时放票状态 */
const ReleaseStatus = {
  NOT_RELEASED: 'NOT_RELEASED',
  BOOKABLE: 'BOOKABLE',
  FULL: 'FULL',
};

/** ENUM-006 难度标签（阈值与 TAG-RULE-001 一致：≥4 极难 / =3 较难 / ≤2 容易） */
const DifficultyLabel = {
  EXTREME: { key: 'EXTREME', text: '极难约' },
  NORMAL: { key: 'NORMAL', text: '较难约' },
  EASY: { key: 'EASY', text: '容易约' },
};

/**
 * 难度标签的唯一真身。前端直接渲染返回的 text，不要自己按 difficultyScore 再算一遍。
 */
function difficultyOf(score) {
  if (score >= 4) return DifficultyLabel.EXTREME;
  if (score === 3) return DifficultyLabel.NORMAL;
  return DifficultyLabel.EASY;
}

/** 3.9 错误码 */
const ERRORS = {
  SPOT_NOT_FOUND: { code: 1001, message: '景点不存在' },
  REMINDER_EXISTS: { code: 1002, message: '这条提醒已经在清单里啦' },
  OA_AUTH_FAILED: { code: 1004, message: '公众号授权失败' },
  SCRAPE_STALE: { code: 1005, message: '数据更新中' },
  TRIP_DATE_INVALID: { code: 1006, message: '行程日期不合法' },
  MINIPROGRAM_JUMP_FAILED: { code: 1007, message: '官方小程序跳转失败' },
  SUBSCRIBE_QUOTA: { code: 1008, message: '订阅消息配额不足' },
  // 非文档编号的通用错误
  UNAUTHORIZED: { code: 1000, message: '未登录' },
  CART_EMPTY: { code: 1009, message: '先添加至少一条提醒' },
  BAD_PARAM: { code: 1010, message: '参数不合法' },
  UNKNOWN_ACTION: { code: 1099, message: 'unknown action' },
};

/** 3.10 埋点事件名（EVENT-001~013） */
const EVENTS = {
  TRIP_CREATE: 'trip_create',
  TRIP_MERGE: 'trip_merge',
  TIMELINE_GENERATE: 'timeline_generate',
  CART_ADD: 'cart_add',
  CART_REMOVE: 'cart_remove',
  REMINDER_SUBMIT: 'reminder_submit',
  REMINDER_TRIGGER: 'reminder_trigger',
  REMINDER_MISS: 'reminder_miss',
  BOOKING_ENTRY_CLICK: 'booking_entry_click',
  SPOT_POPUP_VIEW: 'spot_popup_view',
  SPOT_SEARCH: 'spot_search',
  TASK_DELETE: 'task_delete',
  CHANNEL_AUTH_RESULT: 'channel_auth_result',
};

/** V1 固定值 */
const V1 = {
  CITY: '北京',                 // UI-003 仅北京
  ALLOWED_OFFSETS: [5, 2],      // REMINDER-RULE-001 提前量（分钟）
  CLEAN_AFTER_DAYS: 14,         // REMINDER-RULE-006
  SEARCH_HISTORY_MAX: 10,       // SEARCH-RULE-002
  BADGE_WINDOW_HOURS: 24,       // REMINDER-RULE-007
  BANNER_WINDOW_HOURS: 1,       // REMINDER-RULE-008
  STAGGER_WINDOW_SECONDS: 30,   // REMINDER-RULE-003
  MEMBER_LEVEL_DEFAULT: 'NORMAL',
};

/** 统一响应包装 */
function ok(data = {}) {
  return { success: true, ...data };
}

function fail(err, extra = {}) {
  const e = typeof err === 'string' ? { code: ERRORS.BAD_PARAM.code, message: err } : err;
  return { success: false, error: e.message, errorCode: e.code, ...extra };
}

module.exports = {
  COLLECTIONS,
  TripStatus,
  ReminderBackendStatus,
  EventSelectStatus,
  ChannelType,
  ReleaseStatus,
  DifficultyLabel,
  difficultyOf,
  ERRORS,
  EVENTS,
  V1,
  ok,
  fail,
};
