# Travel-app 前端接口契约 V1.2

> 面向：前端（微信小程序页面开发）
> 更新：2026-08-19（feedback 域新增管理端接口 adminList / adminUpdateStatus + 反馈管理页；此前 2026-08-14 去掉日历提醒通道 CALENDAR_ICS / ICS 同步；新增 feedback 域——意见反馈 / 信息纠错；对照 `reminder/lib/*` / `spots/index.js` / `notifier/index.js` / `feedback/lib/*` 源码提取）
> 调用方式：`wx.cloud.callFunction({ name: '<函数名>', data: { action: '<域>.<动作>', ...params } })`

---

## 0. 通用约定

### 0.1 响应格式

所有云函数（除 notifier 定时触发外）统一返回：

```javascript
// 成功
{ success: true, ...具体数据字段 }

// 失败
{ success: false, error: '人类可读错误消息', errorCode: 1001 }
```

### 0.2 错误码速查

| 错误码 | 含义 | 前端处理 |
|--------|------|---------|
| 1000 | 未登录 | 引导登录 |
| 1001 | 景点不存在 | Toast + 卡片隐藏 |
| 1002 | 提醒已存在（重复） | Toast「这条提醒已经在清单里啦」 |
| 1004 | 公众号授权失败 | 软引导弹窗，可跳过 |
| 1005 | 数据更新中 | 景点卡标注「数据更新中」 |
| 1006 | 行程日期非法 | Toast 校验提示 |
| 1007 | 小程序跳转失败 | 兜底复制链接 + 截图引导 |
| 1008 | 订阅消息配额不足 | 引导公众号通道兜底 |
| 1009 | 清单位空 | Toast「先添加至少一条提醒」 |
| 1010 | 参数不合法 | Toast 提示 |
| 1011 | 提交事务失败 | Toast「提交失败，请重试」 |
| 1012 | 非待提醒任务不可删 | Toast「仅待提醒的任务可以删除」 |
| 1020 | 反馈内容为空 | Toast「请填写反馈内容」 |
| 1099 | 未知 action | Toast |
| 1500 | 服务端异常 | Toast「服务异常，请稍后重试」 |

### 0.3 枚举常量

前端直接使用返回值中的字符串，**禁止自己按 difficultyScore 重算标签**。

```javascript
// ENUM-002 任务后台状态
ReminderBackendStatus: 'WAITING' | 'TRIGGERED' | 'MISSED' | 'CLOSED'

// ENUM-003 时间线事件按钮态
EventSelectStatus: 'SELECTABLE' | 'IN_CART' | 'WAITING' | 'REMINDERED' | 'BOOKABLE' | 'FULL'

// ENUM-004 提醒通道
ChannelType: 'OFFICIAL_ACCOUNT' | 'SMS'  // CALENDAR_ICS 已于 2026-08-14 移除

// ENUM-005 实时放票状态
ReleaseStatus: 'NOT_RELEASED' | 'BOOKABLE' | 'FULL'

// ENUM-006 难度标签（后端返回 difficultyLabel 对象，前端直接用）
DifficultyLabel: { key: 'EXTREME', text: '极难约' }
               | { key: 'NORMAL', text: '较难约' }
               | { key: 'EASY', text: '容易约' }
```

### 0.4 时间约定

- 全系统时间 = 北京时间（GMT+8），后端已统一处理。
- `releaseAt` 字段返回的是 ISO 日期字符串（Date 类型），前端直接 `new Date(releaseAt)` 即可。
- 前端本地倒计时以进入页面时从服务端校时一次为准。

---

## 1. spots（景点查询）

**云函数名：`spots`**

### 1.1 `list` — 热门景点列表

```
用途：PAGE-001 热门景点网格、PAGE-003 热门景点列表
调用：{ action: 'list' }
```

**返回：**
```javascript
{
  success: true,
  data: [{
    spotId: "gugong",
    name: "故宫博物院",
    category: "博物馆",
    district: "东城区",
    difficultyScore: 5,
    difficultyLabel: { key: "EXTREME", text: "极难约" },
    popularityScore: 95,
    reservationRequired: true,          // 2026 分层：是否需预约（false = 免预约，不进提醒流程）
    cardDesc: "随到随买，当前旺季门票10元，联票20元",  // 仅 B 层有值，按 GMT+8 季节生成（cloud cardDescOf）
    tags: ["提前7天放票", "20:00放票"],
    advanceDays: 7,
    releaseTime: "20:00",
    closedDays: ["monday"],
    releaseStatus: "NOT_RELEASED" | "BOOKABLE" | "FULL",
    earliestDate: "2026-08-12",       // 最早可约日期
    officialAppid: "wx...",            // 可直跳小程序
    officialPath: "pages/...",
    officialWebUrl: "https://...",
    stale: true                        // scraper 未上线时为 true，前端可选「数据仅供参考」提示
  }]
}
// 排序：popularityScore 降序；前端按 reservationRequired 分流：true → 难度/放票标签+选择按钮；false → 「无需预约」tag + cardDesc，不可选
```

### 1.2 `detail` — 景点详情弹窗

```
用途：PAGE-002 景点信息 BottomSheet
调用：{ action: 'detail', spotId: 'gugong' }
```

**返回（在 list 字段基础上增加）：**
```javascript
{
  success: true,
  data: {
    // ...所有 list 字段
    address: "北京市东城区...",
    location: { lat: 39.9, lng: 116.4 },
    entries: [                         // 预约方式列表，按直达率排；某渠道缺失则不出现
      { type: "MINIPROGRAM", label: "官方小程序", appid: "wx...", path: "pages/...", url: "https://...", hint: "点击直接跳转官方小程序预约" },
      { type: "OFFICIAL_ACCOUNT", label: "微信公众号", value: "故宫博物院", qrCode: "/images/qrcodes/gugong.png", hint: "点击查看二维码，长按识别关注" },
      { type: "WEB", label: "景区官网", url: "https://...", hint: "在浏览器中打开官网预约" }
    ],
    bookingTips: "请提前实名认证...",    // 预约注意事项（折叠展开）
    openTime: "08:30-17:00",
    ticketPrice: "旺季60元/淡季40元",
    idRequirement: "实名制，需身份证",
    ageLimit: "无"
  }
}
```

> 前端交互（PAGE-002）：MINIPROGRAM → `wx.navigateToMiniProgram` 直跳，失败兜底复制 `url`（官网链接）并 Toast「跳转失败，已复制官网链接」；WEB → `web-view` 打开（真机需在微信公众平台「开发管理 → 开发设置 → 业务域名」配置对应官网域名，否则打不开），弹窗内提供「复制链接」兜底；OFFICIAL_ACCOUNT → 有 `qrCode` 则弹二维码弹层（长按识别），无 `qrCode` 则 Toast 提示关注。`qrCode` 图片放 `miniprogram/images/qrcodes/`，用各公众号后台导出的真实二维码替换占位图。

### 1.3 `batch` — 批量取景点卡

```
用途：PAGE-003 已选景点缩略行、PAGE-005 行程摘要
调用：{ action: 'batch', spotIds: ['gugong', 'tiantan'] }
```

**返回：**
```javascript
{
  success: true,
  data: [ /* 与 list 每项结构相同 */ ]
}
```

### 1.4 `search` — 搜索景点

```
用途：PAGE-004 搜索态
调用：{ action: 'search', keyword: '故宫' }
匹配规则：名称 / 别名 / 拼音前缀本地模糊匹配
```

**返回：**
```javascript
{
  success: true,
  data: [ /* 命中景点卡，同 list 结构 */ ]
}
// 无结果时 data: []
// 搜索历史由服务端自动写入（去重、最多 10 条）
```

### 1.5 `searchHistory` — 获取搜索历史

```
用途：PAGE-003 搜索框下方历史 tag 行
调用：{ action: 'searchHistory' }
```

**返回：**
```javascript
{
  success: true,
  data: ["故宫", "颐和园"]   // 关键词数组，最新在前，最多 10 条
}
```

### 1.6 `clearSearchHistory` — 清空搜索历史

```
用途：SEARCH-RULE-002 整组清空
调用：{ action: 'clearSearchHistory' }
```

---

## 2. reminder（核心业务）

**云函数名：`reminder`**
**调用形状：`{ action: '<域>.<动作>', ...params }`**

---

### 2.1 行程域（trip.*）

#### `trip.create` — 创建/合并行程

```
用途：PAGE-001 首页形态1「生成预约时间线」→ 内部先创建行程
调用：{
  action: 'trip.create',
  startDate: '2026-05-31',    // YYYY-MM-DD
  endDate: '2026-06-04',
  spotIds: ['gugong', 'tiantan'],
  city: '北京'                 // 可选，默认 '北京'（V1 仅北京）
}
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  merged: false,                       // 是否与已有行程合并
  mergedFrom: [],                      // 被合并的行程 ID 列表
  trip: {
    _id: "abc123",
    city: "北京",
    startDate: "2026-05-31",
    endDate: "2026-06-04",
    name: "北京 5.31-6.4",            // TRIP-RULE-003 系统自动命名
    spotIds: ["gugong", "tiantan"],
    status: "ACTIVE"
  }
}
```

#### `trip.list` — 行程列表

```
用途：首页 Tab 行程分组、TRIP-RULE-006 判定是否显示分组行
调用：{ action: 'trip.list' }
```

**返回：**
```javascript
{
  success: true,
  trips: [{
    _id: "abc123",
    city: "北京",
    startDate: "2026-05-31",
    endDate: "2026-06-04",
    name: "北京 5.31-6.4",
    spotIds: ["gugong", "tiantan"],
    status: "ACTIVE",
    nextReminderAt: "2026-05-24T12:00:00.000Z"  // 最近待提醒时间，TRIP-RULE-005 排序用
  }],
  showGroupTabs: true                   // TRIP-RULE-006：≥2 个行程时 true
}
// 排序规则：TRIP-RULE-005，最近待提醒的排第一
```

#### `trip.updateSpots` — 更新想去景点

```
用途：PAGE-003 返回时带回已选景点
调用：{ action: 'trip.updateSpots', tripId: 'abc123', spotIds: ['gugong', 'yiheyuan'] }
```

**返回：**
```javascript
{ success: true, tripId: "abc123", spotIds: ["gugong", "yiheyuan"] }
```

#### `trip.updateRange` — 修改行程日期范围

```
用途：用户修改日期（触发时间线重算，前端调用后需重新 timeline.generate）
调用：{ action: 'trip.updateRange', tripId: 'abc123', startDate: '2026-06-01', endDate: '2026-06-05' }
```

**返回：**
```javascript
{ success: true, tripId: "abc123", startDate: "2026-06-01", endDate: "2026-06-05" }
```

---

### 2.2 时间线域（timeline.*）

#### `timeline.generate` — 生成时间线

```
用途：PAGE-005/006 核心数据，每次进入页面或行程变化时调用
调用：{
  action: 'timeline.generate',
  tripId: 'abc123',
  spotStatusMap: {}       // 可选，实时放票状态覆盖（scraper 未上线不传即可）
}
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  trip: {
    _id: "abc123",
    name: "北京 5.31-6.4",
    startDate: "2026-05-31",
    endDate: "2026-06-04",
    spotIds: ["gugong", "tiantan"]
  },
  events: [{                           // 全部事件（交叉积），扁平数组
    spotId: "gugong",
    spotName: "故宫博物院",
    difficulty: { key: "EXTREME", text: "极难约" },
    visitDate: "2026-06-01",           // 出行日
    releaseAt: "2026-05-25T12:00:00.000Z", // 放票时刻（Date）
    releaseDateStr: "2026-05-25",
    releaseTimeStr: "20:00",
    visitDateLabel: "6月1日 (周一)",    // 已格式化
    advanceDays: 7,
    officialAppid: "wx...",
    officialPath: "pages/...",
    officialWebUrl: "https://...",
    status: "SELECTABLE",              // ENUM-003 按钮态
    button: { text: "+ 添加提醒", enabled: true },  // 前端直接渲染
    stale: false                       // 已放票事件在 scraper 未上线时为 true
  }],
  byDeparture: [{                      // 按出发日视图 Tab（PAGE-005）
    key: "2026-06-01",                 // Tab key = visitDate
    label: "6月1日 (周一)",            // Tab 显示文案
    events: [ /* 该日各景点事件，按 releaseAt 升序 */ ],
    count: 2,
    scrollIndex: 0                     // UI-006 默认滚动位置
  }],
  bySpot: [{                           // 按景点视图 Tab（PAGE-006）
    key: "gugong",                     // Tab key = spotId
    label: "故宫博物院",               // Tab 显示文案
    events: [ /* 该景点各日出事件，按 releaseAt 升序 */ ],
    count: 5,
    scrollIndex: 2
  }],
  closedSpots: [{                      // TIMELINE-RULE-005 行程内全闭馆景点
    spotId: "...",
    spotName: "...",
    note: "行程期间闭馆"
  }],
  empty: false,                        // 事件为空时 true
  emptyReason: null                    // empty=true 时的原因文案
}
```

**按钮六态说明（前端直接渲染 `button.text`，按 `status` 控制可点性）：**

| status | button.text | button.enabled | 点击行为 |
|--------|-------------|----------------|---------|
| SELECTABLE | + 添加提醒 | true | `cart.add` |
| IN_CART | 已加清单 | true | 打开 PAGE-007 (button.openCart=true) |
| WAITING | 待提醒 | false | 无 |
| REMINDERED | 已提醒 | false | 无 |
| BOOKABLE | 立即预约 | true | FLOW-003 跳转 |
| FULL | 已约满 | false | 无 |

---

### 2.3 清单域（cart.*）

#### `cart.add` — 加入清单（单条）

```
用途：PAGE-005/006 事件卡「+ 添加提醒」
调用：{
  action: 'cart.add',
  tripId: 'abc123',
  spotId: 'gugong',
  visitDate: '2026-06-01',
  releaseAt: '2026-05-25T12:00:00.000Z'
}
```

**返回：**
```javascript
{ success: true, cartId: "xyz789" }
// 重复 → { success: false, error: "这条提醒已经在清单里啦", errorCode: 1002 }
```

#### `cart.addAll` — 一键批量添加（仅当前 Tab）

```
用途：PAGE-005/006「本日全部提醒」/「该景点全部提醒」(CART-RULE-004)
调用：{
  action: 'cart.addAll',
  tripId: 'abc123',
  scope: 'departure',       // 'departure'（出发日视图）| 'spot'（景点视图）
  scopeKey: '2026-06-01'    // 选中 Tab 的 key（visitDate 或 spotId）
}
```

**返回：**
```javascript
{
  success: true,
  added: 3,                            // 成功加入数
  skipped: [],                         // 跳过的（已在清单/已提交）
  total: 3,
  scope: "departure",
  scopeKey: "2026-06-01"
}
```

#### `cart.remove` — 删除清单单项

```
用途：PAGE-007 垃圾桶按钮
调用：{ action: 'cart.remove', cartId: 'xyz789' }
```

#### `cart.clear` — 清空清单

```
用途：PAGE-007「清空」（需前端 Dialog 确认后调用）
调用：{ action: 'cart.clear', tripId: 'abc123' }  // 不传 tripId 则清空该用户全部清单
```

#### `cart.list` — 列出清单

```
用途：PAGE-007 主数据 + PAGE-005/006 底部清单条
调用：{ action: 'cart.list', tripId: 'abc123' }  // 不传则查全部
```

**返回：**
```javascript
{
  success: true,
  items: [{
    _id: "xyz789",
    tripId: "abc123",
    spotId: "gugong",
    spotName: "故宫博物院",            // 已关联（PAGE-007 景点名为纯文本，不可点 UI-004 豁免）
    visitDate: "2026-06-01",
    releaseAt: "2026-05-25T12:00:00.000Z",
    createdAt: "..."
  }],
  groups: [{                           // 按放票日期分组
    key: "2026-05-24",
    label: "5月24日 (周六)",
    items: [{
      // ...item 字段
      releaseTimeLabel: "20:00",
      visitDateLabel: "约 6月1日 (周一) 门票",
      countdown: {
        hours: 23,
        minutes: 45,
        text: "还剩23h 45m",
        urgent: false,                 // <1h 为 true（前端变紧急色）
        expired: false                 // 已过期
      }
    }]
  }],
  summary: {
    count: 3,                          // CART-RULE-002
    spotCount: 2,
    text: "已选 3 项，覆盖 2 个景点"
  }
}
```

---

### 2.4 任务域（task.*）

#### `task.submit` — 提交提醒（清单 → 任务）

```
用途：PAGE-008「提交」按钮
调用：{
  action: 'task.submit',
  tripId: 'abc123',
  channels: ['OFFICIAL_ACCOUNT'],  // ENUM-004，至少 1 项
  offsets: [5, 2]                                   // 提前量（分钟），至少 1 项
}
```

**返回：**
```javascript
{
  success: true,
  created: 6,                          // 创建任务数（清单项数 × offsets 数）
  tasks: [{                            // 创建的任务列表
    _id: "...",
    tripId: "abc123",
    spotId: "gugong",
    visitDate: "2026-06-01",
    releaseAt: "...",
    offsets: [5, 2],
    channels: ["OFFICIAL_ACCOUNT"],
    backendStatus: "WAITING",
    sentOffsets: [],
    createdAt: "..."
  }],
  needsOaAuth: true                    // 前端据此决定是否弹公众号授权引导
}
// 失败：{ success: false, error: "...", errorCode: 1009/1010/1011 }
```

**前端提交后流程：**
1. `needsOaAuth` 为 true → 弹公众号授权引导（软引导，可跳过）

#### `task.list` — 任务列表

```
用途：PAGE-009 首页形态2 核心数据
调用：{
  action: 'task.list',
  tripId: 'abc123',         // 可选，不传则全部行程
  filter: 'active'          // 'active'（进行中，默认）| 'expired'（已过期）
}
```

**返回：**
```javascript
{
  success: true,
  groups: [{                           // 按放票日期分组
    key: "2026-05-24",
    label: "5月24日 (周六)",
    items: [{
      _id: "...",
      tripId: "abc123",
      spotId: "gugong",
      spotName: "故宫博物院",         // 已关联
      difficultyScore: 5,
      visitDate: "2026-06-01",
      releaseAt: "...",
      offsets: [5, 2],
      channels: ["OFFICIAL_ACCOUNT"],
      backendStatus: "WAITING",
      releaseTimeLabel: "20:00",
      releaseDateStr: "2026-05-24",
      grabLabel: "开抢 6月1日 (周一) 门票",
      statusLabel: "待提醒",          // STATE-002 映射：WAITING→待提醒，TRIGGERED/MISSED→已提醒
      countdown: {                    // <1h 时出现倒计时
        text: "还剩0h 45m",
        urgent: true
      },
      expired: false                  // filter='expired' 时为 true
    }]
  }],
  counts: { active: 5, expired: 2 },  // 筛选 chip 数字
  banner: {                            // REMINDER-RULE-008，null 时不显示
    type: "UPCOMING",
    text: "今天18:30开抢慕田峪长城5月31日的门票，还有20分钟",
    taskId: "...",
    minutesLeft: 20
  },
  badge: 3,                           // REMINDER-RULE-007 Tab 角标（为 0 不显示）
  homeMode: 2                         // HOME-RULE-001：1=形态1，2=形态2
}
```

#### `task.remove` — 删除任务

```
用途：PAGE-009 三点菜单 → 删除（REMINDER-RULE-005）
调用：{ action: 'task.remove', taskId: '...' }
```

**返回：**
```javascript
{
  success: true,
  taskId: "...",
  tripId: "abc123",
  tripRemoved: false                   // TRIP-RULE-004：任务删光后行程自动删除
}
```

#### `task.clear` — 清空全部提醒任务

```
用途：PAGE-009 顶部「清空任务」按钮（用户二次确认后调用）
调用：{ action: 'task.clear' }
说明：与 task.remove 的单条「仅待提醒可删」不同，这是显式批量清理，
     会删除该用户全部任务（含已提醒/过期的历史记录）
```

**返回：**
```javascript
{
  success: true,
  cleared: 8                // 实际删除条数
}
```

#### `task.badge` — 获取角标数

```
用途：TabBar 角标独立刷新（REMINDER-RULE-007）
调用：{ action: 'task.badge' }
```

**返回：**
```javascript
{ success: true, badge: 3 }   // 未来 24h 内 WAITING 任务数
```

---

### 2.5 用户域（user.*）

#### `user.profile` — 获取/创建用户

```
用途：PAGE-010 我的页
调用：{ action: 'user.profile' }
// 首次调用惰性创建（TABLE-005 默认值）
```

**返回：**
```javascript
{
  success: true,
  user: {
    _id: "...",
    openId: "...",
    nickname: "",
    avatarUrl: "",
    notifyPrefs: {
      officialAccount: false,
      sms: false,
      offsets: [5, 2]
    },
    memberLevel: "NORMAL",             // V1 固定
    points: 0
  }
}
```

#### `user.updateNotifyPrefs` — 更新通知设置

```
用途：PAGE-010 通知设置
调用：{
  action: 'user.updateNotifyPrefs',
  notifyPrefs: { officialAccount: true, sms: false, offsets: [5, 2] }
}
```

---

## 3. notifier（提醒推送）

**云函数名：`notifier`**
**说明：** 定时触发器（每分钟一次），前端不直接调用。

---

## 3.5 feedback（意见反馈 / 信息纠错）

**云函数名：`feedback`**
**说明：** 意见反馈 / 信息纠错 统一入口，共用 `feedbacks` 集合（TABLE-008），`type` 区分两类。页面：PAGE-010 我的 → 意见反馈 / 信息纠错。

### `feedback.submit` — 提交反馈 / 纠错

```
用途：意见反馈页（建议 / Bug）、信息纠错页（选景点 + 纠错类型）
调用：{ action: 'feedback.submit', type, category?, spotId?, spotName?, errorType?, content, contact? }
```

**入参：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | String | 是 | `feedback`（意见反馈）\| `correction`（信息纠错） |
| category | String | feedback 必填 | `suggestion`（建议）\| `bug`（Bug） |
| spotId | String | correction 必填 | 景点 spotId |
| spotName | String | correction 选填 | 景点名快照，便于运营查看 |
| errorType | String | correction 必填 | `RELEASE_TIME` 放票时间 / `RELEASE_RULE` 放票规则 / `OPEN_TIME` 开放时间 / `TICKET_PRICE` 票价 / `ADDRESS` 地址 / `CLOSED_DAYS` 闭馆日 / `OTHER` 其他 |
| content | String | 是 | 描述，非空，≤500 字 |
| contact | String | 否 | 联系方式（手机号 / 微信号） |

**返回：**

```javascript
{ success: true, id: "..." }
```

### `feedback.list` — 本人提交历史

```
调用：{ action: 'feedback.list' }
```

**返回：**

```javascript
{
  success: true,
  items: [{ _id, type, category, spotId, spotName, errorType, content, contact, status, createdAt }]
  // 按 createdAt 倒序，最多 50 条；status = OPEN 待处理 | PROCESSED 已处理 | IGNORED 已忽略
}
```

### `feedback.adminList` — 管理员查看全部（反馈管理页）

```
调用：{ action: 'feedback.adminList', type? }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| type | String | 可选，`feedback` \| `correction`，不传返回全部 |

**鉴权：** 调用者 openid 必须在 `feedback/lib/schema.js` 的 `ADMIN_OPENIDS` 白名单内，否则返回 `1040 无权限`。

**返回：**

```javascript
{
  success: true,
  items: [{ _id, userId, type, category, spotId, spotName, errorType, content, contact, status, createdAt }],
  total: 3
  // 不按 userId 过滤；按 createdAt 倒序，最多 100 条
}
```

### `feedback.adminUpdateStatus` — 管理员更新处理状态

```
调用：{ action: 'feedback.adminUpdateStatus', id, status }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| id | String | 记录 _id，必填 |
| status | String | `OPEN` \| `PROCESSED` \| `IGNORED` |

**鉴权：** 同 adminList，白名单外返回 `1040 无权限`。

**返回：** `{ success: true, updated: 1 }`；非法 status / 缺 id 返回 `1010 参数不合法`。

---

## 4. 页面 → API 映射速查

| 页面 | 需要调用的 API |
|------|---------------|
| **PAGE-001** 首页·创建态 | `spots.list`（热门景点卡）、`trip.create`（生成时间线时） |
| **PAGE-009** 首页·任务列表 | `task.list`、`trip.list`（分组 Tab）、`task.remove`（删除）、`task.badge` |
| **PAGE-002** 景点弹窗 | `spots.detail` |
| **PAGE-003** 想去景点 | `spots.list`、`spots.batch`（已选行）、`spots.searchHistory`、`spots.clearSearchHistory`、`trip.updateSpots` |
| **PAGE-004** 搜索态 | `spots.search` |
| **PAGE-005** 出发日视图 | `timeline.generate`、`cart.add`、`cart.addAll`、`cart.list`（底部条） |
| **PAGE-006** 景点视图 | 同 PAGE-005 |
| **PAGE-007** 清单弹窗 | `cart.list`、`cart.remove`、`cart.clear` |
| **PAGE-008** 设置提醒 | `task.submit`（提交前检测通知授权，未开启就地引导，不跳个人中心） |
| **PAGE-010** 我的 | `user.profile`、`task.badge`、通知设置三态（`wx.getAppAuthorizeSetting` / `wx.getSetting`，非云函数） |
| **PAGE-010-1** 通知设置 | 微信授权 API：`wx.getAppAuthorizeSetting` / `wx.openAppAuthorizeSetting` / `wx.getSetting` / `wx.requestSubscribeMessage` / `wx.openSetting`（模板未配置时「去授权」置灰） |
| **PAGE-010-2** 意见反馈 | `feedback.submit`（type=feedback，category=suggestion/bug） |
| **PAGE-010-3** 信息纠错 | `spots.search`（选景点）、`feedback.submit`（type=correction） |
| **隐藏管理页**（反馈管理） | `feedback.adminList`、`feedback.adminUpdateStatus`；入口 = 我的页长按用户信息卡；后端 openid 白名单鉴权 |

---

## 5. 页面间数据传递约定

```
PAGE-001 → PAGE-005:  带 tripId（trip.create 返回）
PAGE-001 → PAGE-003:  带 tripId + 已有 spotIds
PAGE-003 → PAGE-005:  带回新 spotIds（调 trip.updateSpots），然后重新 timeline.generate
PAGE-005 → PAGE-007:  不需要传参，PAGE-007 自己调 cart.list
PAGE-005 → PAGE-008:  不需要传参，PAGE-008 自己调 task.submit（读 cart）
PAGE-008 → PAGE-009:  提交成功后 wx.navigateBack 回到首页，首页 onShow 调 task.list
PAGE-009 → PAGE-005:  带 tripId（新增提醒入口）
```

---

## 6. 首页形态判定流程（形态1 ↔ 形态2）

```
App.onLaunch / 首页.onShow：
  1. 调 task.list（不传 tripId、filter='active'）
  2. 读 homeMode 字段：
     - homeMode === 1 → 渲染 PAGE-001（创建态）
     - homeMode === 2 → 渲染 PAGE-009（任务列表）
  3. 同时可能还需要调 trip.list 获取分组信息
```

---

## 7. 开发提示

1. **防重复提交**：所有提交流程（cart.add、task.submit）按钮点击后立即设为 loading，收到响应后恢复。
2. **按钮文案**：不要在前端自己算——`timeline.generate` 返回的每个 event 都带 `button.text`，直接渲染。
3. **难度标签**：用后端返回的 `difficultyLabel.text`，不要前端用 `difficultyScore` 重算。
4. **时间线 Tab 是单选筛选**：`byDeparture` / `bySpot` 已分组好，前端只需渲染当前选中 Tab 的 events。
5. **清单缓冲**：PAGE-007 关闭不清空，数据在云数据库持久化（跨设备不丢）。
7. **scraper 未上线**：已放票事件 `stale: true` 时前端可展示「数据仅供参考」的轻提示。
8. **导航实现**：V1 用页面内自绘 TabBar，暂不用 `app.json` 的 `tabBar`（见 `figma_design.md` §5）。
9. **视觉基准**：设计稿 402px 宽，非 750rpx。换算 rpx 时以 402px = 100% 宽。
