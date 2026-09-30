# Travel-app 前端接口契约 V1.3

> 面向：前端（微信小程序页面开发）
> 更新：2026-09-29 明确微信一次性订阅每次用户点击最多增加 1 条额度，禁止异步连发伪装批量授权。2026-09-25 `cart.commit` 新增 `cartId`（补录只提交本次项）与 `disableReminders`（仅加行程不提醒）；此前 2026-09-16 首页行程化 V2 契约定稿，新增 `trip_items`、`tripItem.*`、`cart.commit` 与新版 `home.bootstrap`；旧第 2.0 / 2.1 / 2.3 / 2.4 中面向“提醒任务列表 / 双 Tab 首页”的接口在 V2 实现时由第 8 节取代。此前 2026-08-26 spots `remindable` / `weak`、2026-08-19 feedback 管理端、2026-08-14 日历通道下线等变更继续有效。
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
| 1002 | 已存在（重复加入） | Toast「这条已经在清单里啦」 |
| 1004 | 公众号授权失败 | 软引导弹窗，可跳过 |
| 1005 | 数据更新中 | 景点卡标注「数据更新中」 |
| 1006 | 行程日期非法 | Toast 校验提示 |
| 1007 | 小程序跳转失败 | 兜底复制链接 + 截图引导 |
| 1008 | 订阅消息配额不足 | 引导公众号通道兜底 |
| 1009 | 清单位空 | Toast「先添加至少一条提醒」 |
| 1010 | 参数不合法 | Toast 提示 |
| 1011 | 提交事务失败 | Toast「提交失败，请重试」 |
| 1012 | 非待提醒任务不可删 | 旧任务接口兼容；V2 用户入口改用行程项删除 |
| 1013 | 行程项不存在 | Toast「这条行程项已不存在」并刷新首页 |
| 1014 | 当前行程项不可标记结果 | Toast「现在还不能标记结果」 |
| 1015 | 撤销时间已过 | Toast「已超过撤销时间」并刷新状态 |
| 1016 | 行程项所在日期已结束 | 关闭操作入口并刷新首页 |
| 1017 | 已过放票时间，提醒无法开启或取消 | Toast 同文案（菜单此时已不渲染该入口，兜底旧版本小程序） |
| 1020 | 反馈内容为空 | Toast「请填写反馈内容」 |
| 1099 | 未知 action | Toast |
| 1500 | 服务端异常 | Toast「服务异常，请稍后重试」 |

### 0.3 枚举常量

前端直接使用返回值中的字符串，**禁止自己按 difficultyScore 重算标签**。

```javascript
// ENUM-002 任务后台状态
ReminderBackendStatus: 'WAITING' | 'TRIGGERED' | 'MISSED' | 'CLOSED'

// ENUM-003 时间线事件按钮态（只表达加入清单的选择状态）
EventSelectStatus: 'SELECTABLE' | 'IN_CART' | 'COMMITTED'

// ENUM-004 提醒通道
ChannelType: 'OFFICIAL_ACCOUNT' | 'SMS'  // CALENDAR_ICS 已于 2026-08-14 移除

// ENUM-005 实时放票状态
ReleaseStatus: 'NOT_RELEASED' | 'BOOKABLE' | 'FULL'

// ENUM-007 行程项票务展示状态（读取时推导，前端直接渲染）
TicketState: 'PENDING' | 'BOOKABLE' | 'SUCCESS' | 'FAILED' | 'UNMARKED' | 'NO_RESERVATION'

// ENUM-008 行程项人工结果（仅这两种会持久化；null = 未人工标记）
TicketResult: 'SUCCESS' | 'FAILED'

// ENUM-009 提醒送达状态（与票务状态分离）
ReminderDeliveryState: 'NOT_SET' | 'WAITING' | 'TRIGGERED' | 'MISSED'

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
    shortName: "故宫",                  // 窄容器专用简称；无值时前端回退 name
    category: "博物馆",
    district: "东城区",
    audienceTags: ["family", "elder"],  // 2026-09-06 景点聚合页：人群标签（family=亲子 / elder=带父母），无标注为 []
    difficultyScore: 5,
    difficultyLabel: { key: "EXTREME", text: "极难约" },
    popularityScore: 95,
    reservationRequired: true,          // 2026 分层：是否需预约（false = 免预约，不进提醒流程）
    remindable: true,                   // 2026-08-26：需预约且有放票时刻 → 可进时间线/清单/任务
    addable: true,                      // 2026-09-16：可加入行程（可提醒项或免预约项）
    weak: false,                        // 需预约且 difficultyScore≤2 → 弱提醒，标签行显示「票量充足，无需卡点」
    cardDesc: "随到随买，当前旺季门票10元，联票20元",  // 免预约 B 层：「随到随买…」；弱提醒可提醒景点：「提前N天 HH:MM放票 · 票量充足，无需卡点」；需预约但无放票时刻：「无固定放票时刻，随买随用」
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
// 排序：popularityScore 降序；前端按 addable 分流：可提醒项显示「选择」，免预约项显示「加入行程」；无固定放票时刻的需预约项显示「随买随用」且不可选
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

> 前端交互（PAGE-002）：MINIPROGRAM → `wx.navigateToMiniProgram` 直跳，失败兜底复制 `url`（官网链接）并 Toast「跳转失败，已复制官网链接」；WEB → `web-view` 打开（真机需在微信公众平台「开发管理 → 开发设置 → 业务域名」配置对应官网域名，否则打不开），弹窗内提供「复制链接」兜底；OFFICIAL_ACCOUNT → 有 `qrCode` 则弹二维码弹层（长按识别），无 `qrCode` 则 Toast 提示关注。`qrCode` 字段保留 `/images/qrcodes/...` 逻辑路径，源图放 `cloud-assets/images/qrcodes/` 并上传到 `static/v0.3/images/qrcodes/`；前端通过 `utils/assets.js` 转成云文件 ID，不把二维码打进代码包。

### 1.3 `batch` — 批量取景点卡

```
用途：PAGE-003 已选景点缩略行、首页内联时间线行程摘要
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

### 2.0 首页聚合（home.*）

> ⚠️ **2026-09-20：本节的 `home.bootstrap` 返回体已被第 8.2 节的 V2 取代**，下面是旧结构，仅作对照。

> 以下旧返回结构只描述当前未迁移代码；首页改版实现后由第 8.2 节取代。

#### `home.bootstrap` — 首页一次性聚合

```
用途：PAGE-001 首页 onShow 一次请求拿回任务/行程/清单/热门景点，替代 3~5 次串行 callFunction，
      削减免费版冷启动次数（2026-08-30 新增）。
调用：{
  action: 'home.bootstrap',
  filter: 'active',                 // 任务筛选：active | expired
  activeTripTab: 'abc123' | '',     // 当前选中的行程 Tab；为空则只返回全量分组
  tripId: 'abc123' | '',            // 内联时间线的清单 tripId（keepInline 时传，用于返回 cart）
  includeSpots: true                // 是否返回热门景点（内部调 spots 云函数；false 时 hotSpots=[]）
}

返回（success=true，字段均为扁平顶层）：
{
  // ⚠️ 以下为**旧结构（V1）**，2026-09-20 起已被第 8.2 节的 V2 返回体取代。
  // 保留仅为对照；新首页不消费 groups / counts / banner / tripTasks。
  homeMode: 1 | 2,               // 旧首页形态判定，已废止（语义降级为 0 项=1 / 否则=2）
  groups: [...],                 // 全量任务分组（未按行程筛选）
  counts: { active, expired },
  banner: {...} | null,
  tripTasks: { groups, counts } | null,  // activeTripTab 非空时返回该行程分组
  trips: [...],                  // 行程列表
  showGroupTabs: boolean,
  cart: { summary, groups, items } | null, // tripId 非空时返回内联清单
  hotSpots: [...]                // 热门景点卡（来自 spots.list）
}

错误码：1500（服务异常）。热路径依赖组合索引 reminder_tasks{backendStatus, releaseAt}，
      且内部调用 spots 云函数（失败时 hotSpots=[]，前端回退 spots.list）。
```

### 2.1 行程域（trip.*）

#### `trip.create` — 创建或合并行程（2026-09-14 恢复自动合并）

```
用途：PAGE-001 首页形态1「生成预约时间线」→ 内部先创建行程
说明：TRIP-RULE-002 —— 同城市 且（日期有交集 或 首尾相接）→ 合并成一个行程（= 一个任务分组 Tab），
     日期取并集；新行程可能同时与多个既有行程相接，滚雪球式反复合并。
     **合并的是行程，不是景点**：各景点保留自己被选中时的日期段（spots），
     时间线不会冒出用户没选过的 (景点 × 日期) 组合。
     被吞并行程的任务与提醒清单自动改挂到存续行程，存续行程复用第一个被合并行程的 tripId。
调用：{
  action: 'trip.create',
  startDate: '2026-05-31',    // YYYY-MM-DD
  endDate: '2026-06-04',
  spotIds: ['gugong', 'tiantan'],
  city: '北京',                // 可选，默认 '北京'（V1 仅北京）
  adjustTripId: ''            // 可选：「在当前内联时间线的行程上重新生成」时传该 tripId
                              //   → 该行程景点段按本次输入**替换**（而非并集），其余并入段保留；
                              //     仍会与其它日期相交/相接的行程继续合并
}
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  merged: true,                        // 是否发生了合并（合并时复用存续行程的 tripId）
  mergedFrom: ["old1", "old2"],        // 被并进来的行程 ID 列表（未合并时为空数组）
  trip: {
    _id: "abc123",
    city: "北京",
    startDate: "2026-05-31",           // 并集
    endDate: "2026-06-08",
    name: "北京 5.31-6.8",            // TRIP-RULE-003 系统自动命名（按并集重算）
    spotIds: ["gugong", "badaling", "guobo"],   // spots 的去重派生字段
    spots: [                          // 各景点自己的日期段（时间线按此生成）
      { spotId: "gugong",   startDate: "2026-05-31", endDate: "2026-06-04" },
      { spotId: "badaling", startDate: "2026-05-31", endDate: "2026-06-04" },
      { spotId: "guobo",    startDate: "2026-06-05", endDate: "2026-06-08" }
    ],
    status: "ACTIVE"
  }
}
// 失败：{ success: false, error: "行程日期不合法", errorCode: 1006 }
```

#### `trip.list` — 行程列表

```
用途：首页 Tab 行程分组、TRIP-RULE-006 判定是否显示分组行
调用：{ action: 'trip.list' }
说明：读取时兜底执行 TRIP-RULE-004 级联——任务与清单均空的孤儿行程
     （如生成了时间线但从未提交提醒）会被自动删除，返回的行程都有内容。
     老数据（只有 spotIds）会统一补出 spots 段（按行程整段回退），前端可放心依赖 spots。
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
    spots: [                            // 2026-09-14 起：各景点自己的日期段
      { spotId: "gugong",  startDate: "2026-05-31", endDate: "2026-06-04" },
      { spotId: "tiantan", startDate: "2026-05-31", endDate: "2026-06-04" }
    ],
    status: "ACTIVE",
    nextReminderAt: "2026-05-24T12:00:00.000Z"  // 最近待提醒时间
  }],
  showGroupTabs: true                   // TRIP-RULE-006：≥2 个行程时 true
}
// 排序规则：TRIP-RULE-005，按 startDate 升序
```

#### `trip.updateSpots` — 更新想去景点

```
用途：PAGE-003 返回时带回已选景点
调用：{
  action: 'trip.updateSpots',
  tripId: 'abc123',
  spotIds: ['gugong', 'yiheyuan'],
  startDate: '2026-06-01',   // 可选：新加入景点的日期段（缺省用行程当前范围）
  endDate: '2026-06-05'
}
说明：已在行程里的景点**保留自己的日期段**（不因一次增删被拉回整段）；
     新加入的景点用传入的段，缺省则用行程当前范围。
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  spotIds: ["gugong", "yiheyuan"],
  spots: [
    { spotId: "gugong",   startDate: "2026-05-31", endDate: "2026-06-04" },  // 保留原段
    { spotId: "yiheyuan", startDate: "2026-06-01", endDate: "2026-06-05" }   // 新段
  ]
}
```

#### `trip.updateRange` — 修改行程日期范围

```
用途：用户修改日期（触发时间线重算，前端调用后需重新 timeline.generate）
调用：{ action: 'trip.updateRange', tripId: 'abc123', startDate: '2026-06-01', endDate: '2026-06-05' }
说明：行程总范围变化 → 各景点段裁剪到新范围内（无交集时收敛到新范围），
     保证「景点段 ⊄ 行程范围」这种非法状态不出现。
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  spots: [
    { spotId: "gugong", startDate: "2026-06-01", endDate: "2026-06-04" }   // 裁剪后
  ]
}
```

#### `trip.remove` — 显式删除行程（含其任务与提醒清单）

```
用途：删除「进行中 0 / 已过期 0」的空壳行程（TRIP-RULE-004，2026-09-14）。
      这类行程已无任务，却因清单里还留着未提交的提醒而被读取时兜底清理判为「非空」，
      会一直占着首页行程 Tab。首页「清空任务」按钮在该行程 0/0 时转为「删除这个空行程？」确认。
调用：{ action: 'trip.remove', tripId: 'abc123' }
说明：物理删除行程 + 该行程下全部提醒任务 + 全部提醒清单条目 + 全部行程项（不可恢复）。
```

**返回：**
```javascript
{
  success: true,
  tripId: "abc123",
  removedTasks: 1,                     // 连带删除的任务数
  removedCartItems: 2,                 // 连带删除的未提交清单条数
  removedItems: 2                      // 连带删除的行程项数（2026-09-16）
}
// 失败：{ success: false, error: "参数不合法", errorCode: 1010 }（行程不存在或不属于该用户）
```

---

### 2.2 时间线域（timeline.*）

#### `timeline.generate` — 生成时间线

```
用途：PAGE-005/006（首页内联）核心数据，每次进入页面或行程变化时调用
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
    spotIds: ["gugong", "tiantan"],
    spots: [                           // 2026-09-14 起：各景点自己的日期段（事件按此生成）
      { spotId: "gugong",  startDate: "2026-05-31", endDate: "2026-06-04" },
      { spotId: "tiantan", startDate: "2026-05-31", endDate: "2026-06-04" }
    ]
  },
  events: [{                           // 全部事件（各景点 × 自己段内的非闭馆日），扁平数组
    spotId: "gugong",
    spotName: "故宫博物院",
    difficulty: { key: "EXTREME", text: "极难约" },
    visitDate: "2026-06-01",           // 出行日
    releaseAt: "2026-05-25T12:00:00.000Z", // 放票时刻（Date）
    releaseDateStr: "2026-05-25",
    releaseTimeStr: "20:00",
    visitDateLabel: "6月1日 (周一)",    // 已格式化
    advanceDays: 7,
    releaseState: "RELEASED",          // NOT_RELEASED / RELEASED / NO_RESERVATION
    releaseStateLabel: "已开票",       // 待开票 / 已开票 / 无需预约
    officialAppid: "wx...",
    officialPath: "pages/...",
    officialWebUrl: "https://...",
    status: "SELECTABLE",              // ENUM-003 按钮态
    button: { text: "加入清单", enabled: true },     // 前端直接渲染
    stale: false                       // 已放票事件在 scraper 未上线时为 true
  }],
  byDeparture: [{                      // 按出发日视图 Tab（PAGE-005，首页内联）
    key: "2026-06-01",                 // Tab key = visitDate
    label: "6月1日 (周一)",            // Tab 显示文案
    events: [ /* 该日各景点事件，按 releaseAt 升序 */ ],
    count: 2,
    scrollIndex: 0                     // UI-006 默认滚动位置
  }],
  bySpot: [{                           // 按景点视图 Tab（PAGE-006，首页内联）
    key: "gugong",                     // Tab key = spotId
    label: "故宫博物院",               // Tab 显示文案
    events: [ /* 该景点各日出事件，按 releaseAt 升序 */ ],
    count: 5,
    scrollIndex: 2
  }],
  closedSpots: [{                      // 行程内全闭馆 / 无固定放票时刻的景点（⚠️ 页面已不渲染，见下方注）
    spotId: "...",
    spotName: "...",
    note: "行程期间闭馆"
  }],
  closedDaySkips: [{                    // 部分日期被闭馆跳过（非全闭馆）（⚠️ 页面已不渲染）
    spotId: "tsinghua",
    spotName: "清华大学",
    note: "6月1日 (周一) 闭馆，已为你跳过"
  }],
  empty: false,                        // 事件为空时 true
  emptyReason: null                    // empty=true 时的原因文案
}
```

⚠️（2026-09-24）`closedSpots` / `closedDaySkips` **照常返回，但页面不再渲染**——底部那块「闭馆/已为你跳过」提示已按用户口径整块删除，理由见 `产品文档.md` 的 `PAGE-005-RULE-002`。契约不缩水、已有测试继续钉住这两个字段，要恢复提示时不必改云函数。

**按钮三态说明（前端直接渲染 `button.text`，按 `status` 控制可点性）：**

| status | button.text | button.enabled | 点击行为 |
|--------|-------------|----------------|---------|
| SELECTABLE | 加入清单（免预约项「加入行程」） | true | `cart.add` |
| IN_CART | 已加清单（免预约项「已加入清单」） | true | 打开 PAGE-007 (button.openCart=true) |
| COMMITTED | 已加行程 | false | 无（纯状态标签） |

⚠️（2026-09-24）文案统一为「清单」并去掉全部图标，对齐 `UI/V.0.2-0919首页行程化改版-UI/32.png`：旧值 `+ 添加提醒` → `加入清单`、`已加待选` → `已加清单`、`已在行程` → `已加行程`。
⚠️ `enabled` 表达的是**能不能点**，不是**看起来像不像按钮**：`IN_CART` 为 true（点它打开清单弹层），UI 上却是中性色状态胶囊。别为了「看着像状态」把它改成 false。
⚠️（2026-09-25）时间线不再返回 `WAITING / REMINDERED / BOOKABLE / FULL`。`releaseAt ≤ now` 只把顶部 `releaseStateLabel` 变为「已开票」并渲染绿色文字，按钮仍是 `SELECTABLE → 加入清单`；已开票项入清单后固定 `remindOn=false`、`remindLocked=true`，清单行显示「仅加行程·不提醒」且不可修改。预约入口只保留在首页行程项和推送详情。

---

### 2.3 清单域（cart.*）

#### `cart.add` — 加入清单（单条）

```
用途：PAGE-005/006（首页内联）事件卡「加入清单」
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
{ success: true, cartId: "xyz789", remindOn: false }
// remindOn：放票前按用户选择/强弱默认；放票时刻已过时由服务端强制 false
// 重复 → { success: false, error: "这条提醒已经在清单里啦", errorCode: 1002 }
```

#### `cart.addAll` — 一键批量添加（仅当前 Tab）

```
用途：PAGE-005/006（首页内联）「本日全部提醒」/「该景点全部提醒」(CART-RULE-004)
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
用途：PAGE-007 主数据 + PAGE-005/006（首页内联）底部清单条
调用：{ action: 'cart.list', tripId: 'abc123' }  // 不传则查当前暂存清单
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
    difficulty: { key: "EXTREME", text: "极难约" }, // V0.3 清单难度标签
    weak: false,                       // 需预约且 difficultyScore≤2
    visitDate: "2026-06-01",
    releaseAt: "2026-05-25T12:00:00.000Z",
    releaseDateLabel: "05月25日",
    releaseTimeLabel: "20:00",
    remindOn: true,                     // 已开票项恒为 false
    remindLocked: false,                // true = 已开票，提醒固定为「仅加行程·不提醒」
    createdAt: "..."
  }],
  groups: [{                           // 按出行日分组
    key: "2026-06-01",
    label: "6月1日 · 周一",
    dayLabel: "【第1天】",              // 相对清单最早出行日；样式同首页日期标题
    items: [{
      // ...item 字段
      releaseDateLabel: "05月25日",
      releaseLabel: "05月25日 20:00 放票",
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
    reminderCount: 2,                  // V0.3：将设提醒条数
    noReminderCount: 1,
    text: "已选 3 项，其中 2 个将设提醒"
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
  offsets: [5]                                      // 提前量（分钟），前端单选，一次只传 1 项（V1.2）
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
  needsOaAuth: true                    // 预留：公众号渠道接入后用于前端关注引导
}
// 失败：{ success: false, error: "...", errorCode: 1009/1010/1011 }
```

**前端提交后流程：**
1. `needsOaAuth` 字段暂不触发 UI。公众号渠道尚未打通，提交成功后直接 Toast 并回首页。

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
      backendStatus: "WAITING",       // 读取时已收敛：已过 releaseAt 的 WAITING 会返回 MISSED 并落库
      missedReason: null,             // MISSED 时的原因；优先取 notifier 记下的真实失败原因（lastSendError）
      releaseTimeLabel: "20:00",
      releaseDateStr: "2026-05-24",
      grabLabel: "开抢 6月1日 (周一) 门票",
      statusLabel: "待提醒",          // STATE-002 映射：WAITING→待提醒，TRIGGERED→已提醒，MISSED→未送达
      countdown: {                    // <1h 时出现倒计时（已过期任务恒为 null）
        text: "还剩0h 45m",
        urgent: true
      },
      expired: false                  // 已过 releaseAt 或 MISSED 时为 true
    }]
  }],
  counts: { active: 5, expired: 2 },  // 筛选 chip 数字
  banner: {                            // REMINDER-RULE-008，null 时不显示
    type: "UPCOMING",
    text: "今天18:30开抢慕田峪长城5月31日的门票，还有20分钟",
    taskId: "...",
    minutesLeft: 20
  },
  homeMode: 2                         // 旧首页形态判定，已废止（见第 6 节）
}
```
> ⚠️ 整个 `task.*` 域自 2026-09-20 起为**兼容代码**：首页与新流程均不再调用，
> 行程项管理改用 `tripItem.*`（第 8.4 节）。保留是因为云函数删除有部署次序风险，
> 不代表它还在业务路径上。

#### `task.remove` — 删除任务

```
用途：PAGE-009 三点菜单 → 删除（REMINDER-RULE-005）
调用：{ action: 'task.remove', taskId: '...' }
说明：WAITING / MISSED 均可单条删除（2026-09-14 放宽）；TRIGGERED 不可单删
     （前端此时不显示「删除」项，改为提示走「清空任务」），
     否则返回 1012「已提醒的任务不可单条删除，可在「清空任务」中批量清理」。
```

**返回：**
```javascript
{
  success: true,
  taskId: "...",
  tripId: "abc123",
  tripRemoved: false                   // TRIP-RULE-004 主动删除级联：行程内已无任务 → 行程 + 提醒清单一并删除
}
// 失败：{ success: false, error: "...", errorCode: 1010（任务不存在）/ 1012（状态不可删） }
```

#### `task.clear` — 清空提醒任务（可按当前 tab 范围）

```
用途：PAGE-009 顶部「清空任务」按钮（用户二次确认后调用）
调用：{ action: 'task.clear', filter: 'active'|'expired'|null, tripId: 'abc123'|null }
说明：与 task.remove 的单条「仅待提醒可删」不同，这是显式批量清理。
     filter/tripId 都不传 → 清空该用户全部任务（含已提醒/过期的历史记录）；
     传 filter → 只清空该状态 tab 的任务（过期判定与 task.list 一致：MISSED 或已过放票时间点）；
     传 tripId → 只清空该行程下的任务。两者可叠加，对应前端「只清空当前 tab」。
     清空后对受影响的行程执行 TRIP-RULE-004 主动删除级联：行程内**已无任何提醒任务**
     → 行程连同其提醒清单一并删除（purgeIfNoTask，不再以清单作为保留条件），
     避免留下「进行中 0 / 已过期 0」却仍占着 Tab 的空壳行程。
     前端调用前的二次确认弹窗必须把「行程也会被删」讲清楚（见 产品文档 PAGE-009）。
```

**返回：**
```javascript
{
  success: true,
  cleared: 3,                          // 本次清掉的任务数
  affectedTripIds: ["abc123"],         // 受影响的行程（含未被删除的）
  removedTripIds: ["abc123"]           // 实际被级联删除的行程
}
```

**返回：**
```javascript
{
  success: true,
  cleared: 8,               // 实际删除条数
  affectedTripIds: [...]    // 本次清空涉及到的行程，服务端已对其执行空行程级联删除
}
```

---

### 2.5 用户域（user.*）

#### `user.profile` — 获取/创建用户（无感登录）

```
用途：PAGE-010 我的页、PAGE-profile-edit 编辑资料页
调用：{ action: 'user.profile' }
// 首次调用惰性创建（TABLE-005 默认值），并自动生成资料：
//   昵称 = 「用户」+ 6 位随机字符（小写字母+数字，去 0/o/1/l，允许重复）
//   头像 = 随机默认占位图 /images/avatars/default-{1..6}.png（主包本地路径）
// 旧数据（昵称为空或「游客」）惰性迁移补齐，用户无感知
```

**返回：**
```javascript
{
  success: true,
  user: {
    _id: "...",
    openId: "...",
    nickname: "用户a8x2kq",          // 无感登录自动生成，可重复
    avatarUrl: "/images/avatars/default-3.png",  // 本地默认图，或用户上传后的 cloud:// fileID
    phone: "",                       // 选填，大陆 11 位手机号（未填为空串）
    notifyPrefs: {
      officialAccount: false,
      sms: false,
      offsets: [5, 2]
    },
    memberLevel: "NORMAL",           // V1 固定
    points: 0
  }
}
```

#### `user.updateProfile` — 保存头像/昵称/手机号（编辑资料页）

```
用途：PAGE-profile-edit 编辑资料页（无感登录后的资料修改）
调用：{ action: 'user.updateProfile', nickname, avatarUrl, phone }
// avatarUrl 由前端先用 wx.cloud.uploadFile 上传云存储后传 fileID（cloud://...）；
// 未换头像时原样回传原 avatarUrl（cloud:// 或 /images/... 均可）；可空，空则前端显示默认占位。
```

| 入参 | 类型 | 说明 |
|------|------|------|
| nickname | String | 必填。trim 后取前 32 字符；空 → 1010 参数不合法。**允许与他人重复** |
| avatarUrl | String | 选填。云存储 fileID 或主包默认图路径，最长 512 字符 |
| phone | String | 选填。大陆 11 位手机号；非空且格式不合法（非 `1[3-9]` 开头 11 位）→ 1010 参数不合法 |

**返回：**
```javascript
{ success: true, user: { _id, openId, nickname, avatarUrl, phone, notifyPrefs, memberLevel, points, profileUpdatedAt } }
```

> 说明：无感登录 = 首次 `user.profile` 即自动建号并生成昵称/默认头像，全程无弹窗。微信**不开放**程序化读取真实头像/昵称（`wx.getUserProfile` 已回收），故默认头像为主包占位图、默认昵称为系统生成；用户可进编辑资料页自行修改。编辑资料页头像为整行 `button open-type="chooseAvatar"` 调微信原生头像选择（2026-08-26 起不再自绘选择面板），昵称输入框 `type="nickname"` 聚焦时键盘上方展示微信昵称可一键填入。

#### `user.updateNotifyPrefs` — 更新提醒偏好

```
用途：PAGE-010 提醒设置
调用：{
  action: 'user.updateNotifyPrefs',
  notifyPrefs: { officialAccount: true, sms: false, offsets: [5, 2] }
}
```

#### `subscribe.add` / `subscribe.get` — 一次性订阅消息额度

`wx.requestSubscribeMessage` 每次授权 = 可发 1 条订阅消息。额度按模板存入 `users.subscribeQuotas[templateId]`，同时维护旧字段 `users.subscribeQuota` 作为总数；授权成功 +1、notifier 发送成功 -1、微信返回 `43101` 时对应模板清零。当前业务只有「放票提醒」一个模板，但协议按 templateId 设计，后续可直接扩展多模板。

> ⚠️ 微信限制：一次用户点击只能触发一次同模板授权申请，最多增加 1 条额度。“总是保持以上选择”只免去后续弹窗，不允许在一次点击后的异步链里连续申请 N 条；客户端必须按“一次点击 → 最多 +1”展示和上报缺口。

**`subscribe.add`**（用户授权后前端调用，云端按当前 openid 记 +1）：

```
调用：{ action: 'subscribe.add', templateId? }
```

**返回：**

```javascript
{ success: true, quota: 3, totalQuota: 3, quotas: { "V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q": 3 }, templateId: "V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q" }
```

**`subscribe.get`**（查询剩余额度与提醒健康度，提醒设置页展示）：

```
调用：{ action: 'subscribe.get', templateId? }
```

**返回：**

```javascript
{
  success: true,
  quota: 3,
  totalQuota: 3,
  quotas: { "V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q": 3 },
  templateId: "V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q",
  pendingMessageCount: 4,      // 未来 WAITING 任务中尚未发送的 offset 总数
  nearestRemindAt: "2026-09-27T...",
  level: "short",              // idle | ready | low | short | exhausted
  shortfall: 1,                // max(0, pendingMessageCount - quota)
  replenishNeeded: 2           // 补到 pendingMessageCount + 1 缓冲的目标次数；客户端仍需一次点击补 1 条
}
```

> 未授权/未落库时 quota 为 0，发送侧仍会尝试（微信侧按真实授权校验，返回 43101 即表示无额度/未订阅）。

---

## 3. notifier（提醒推送）

**云函数名：`notifier`**
**说明：** 定时触发器（每分钟一次），前端不直接调用。走**微信服务端 HTTP 接口**发送订阅消息（不依赖小程序端触发，定时触发可用）。

**环境变量（云函数配置）**：`WX_APPID`（小程序 AppID，缺省回退 `wx05c160a589b97d76`）、`WX_APPSECRET`（必填，小程序密钥）、`SUBSCRIBE_TEMPLATE_ID`（订阅模板 ID，缺省回退内置常量）。三者由 `sendOne` 读取，未配置时该任务记 `failed`（不会误标为 MISSED）。

### `notifier.testSend` — 发送测试订阅消息（排查/验证通道）

```
调用：{ action: 'testSend', touser, miniprogramState?, lang?, data?, templateId? }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| touser | String | 是 | 已授权订阅该模板的 openid |
| miniprogramState | String | 否 | 默认 `formal`（正式版） |
| lang | String | 否 | 默认 `zh_CN` |
| data | Object | 否 | 不传用内置测试数据（thing4/date5/thing7，对应「活动开始通知」模板：活动名称/活动时间/温馨提示） |
| templateId | String | 否 | 默认用 `TEMPLATE_ID` |

**返回：**

```javascript
{ success: true, res: { errcode: 0, errmsg: 'ok' } }
// 失败时 success=false，res 为微信错误（如 43101 未订阅 / 47003 参数错 / 40037 template_id 无效）
```

**错误码要点**：`40001/42001` 会自动强制刷新 access_token 并重试一次；`43101` = 用户未订阅、已拒收或一次性配额已用完，notifier 会立即把本地对应 `users.subscribeQuotas[templateId]` 清零并同步总数、记录 `subscribeLastError/At`（本地次数不是微信真实剩余额度）；`40037` = template_id 不属于该 AppID；`43107` = 订阅消息能力被封禁。

### `notifier.whoami` — 获取调用者 openid（测试用）

```
调用：{ action: 'whoami' }
```
**说明：** 必须从小程序端调用（`wx.cloud.callFunction`），返回当前用户的真实 openid，便于 `testSend` 复用。

**返回：**

```javascript
{ success: true, openid: "<真实openid>", appid: "wx05c160a589b97d76" }
```

---

## 3.5 feedback（意见反馈 / 信息纠错）

**云函数名：`feedback`**
**说明：** 意见反馈 / 信息纠错 统一入口，共用 `feedbacks` 集合（TABLE-008），`type` 区分两类。页面：PAGE-010 我的 → PAGE-010-4 帮助与反馈 → 意见反馈 / 信息纠错。

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

### `feedback.list` — 本人提交历史（我的反馈页）

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

### `feedback.adminStatus` — 管理员入口校验

```
调用：{ action: 'feedback.adminStatus' }
```

**用途：** “我的”页长按用户信息卡时，先由服务端判断当前 openid 是否在 `ADMIN_OPENIDS` 白名单内；只有 `isAdmin=true` 才进入反馈管理页。失败或非管理员均不跳转。

**返回：**

```javascript
{ success: true, isAdmin: true | false }
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
| **PAGE-001** 首页·行程状态墙 | `home.bootstrap` V2；`tripItem.markResult` / `undoResult` / `updateReminder` / `remove` / `removeVisitDate` / `recoveryCandidates` |
| **PAGE-009** 旧任务列表 | V2 已废弃。`task.*` 云函数保留为兼容代码，**首页与新流程均不再调用** |
| **PAGE-002** 景点弹窗 | `spots.detail` |
| **PAGE-003** 想去景点 | `spots.list`、`spots.batch`（已选行）、`spots.searchHistory`、`spots.clearSearchHistory`、`trip.updateSpots` |
| **PAGE-004** 搜索态 | `spots.search` |
| **PAGE-005** 新增提醒（独立页） | `timeline.preview`（纯预览，不建行程）、`cart.add`、`cart.addAll`、`cart.list`（暂存清单） |
| **PAGE-006** 景点视图 | 搁置中，不实现 |
| **PAGE-007** 行程清单弹窗 | `cart.list`、`cart.remove`、`cart.clear`、`cart.updateRemindOn`、`cart.commit` |
| **PAGE-008** 设置提醒 | V0.3 主流程：`cart.list`、`subscribe.get`（`cart.list` 算待设提醒条数，`subscribe.get` 算当前额度）、用户主动点击「点击补授权次数」（每次最多 +1）、`cart.commit`（额度或系统权限未满足时主按钮禁用；不提供仅加行程旁路） |
| **PAGE-010** 我的 | `user.profile`、提醒设置权限/额度健康度（`notify.getReminderHealth`，服务端额度 + 客户端权限） |
| **PAGE-012** 编辑资料 | `user.profile`、`user.updateProfile`（头像走 `open-type="chooseAvatar"` + `wx.cloud.uploadFile` 上传） |
| **PAGE-013** 分享场景页 | `spots.list`（today）、`spots.batch`（national-day-2026）；点击景点后 `spots.detail` |
| **PAGE-010-1** 提醒设置 | `subscribe.get` + 微信授权 API：`wx.getAppAuthorizeSetting` / `wx.openAppAuthorizeSetting` / `wx.getSetting` / `wx.requestSubscribeMessage` / `wx.openSetting`；缺口按钮为「补授权次数+1」，点击一次最多申请 1 条（模板未配置时「去授权」置灰） |
| **PAGE-010-4** 帮助与反馈 | 微信原生客服 `button open-type="contact"`；无云函数调用 |
| **PAGE-010-2** 意见反馈 | `feedback.submit`（type=feedback，category=suggestion/bug） |
| **PAGE-010-3** 信息纠错 | `spots.search`（选景点）、`feedback.submit`（type=correction） |
| **PAGE-010-5** 我的反馈 | `feedback.list`（本人历史，最多 50 条，倒序） |
| **隐藏管理页**（反馈管理） | `feedback.adminStatus`、`feedback.adminList`、`feedback.adminUpdateStatus`；入口 = 我的页长按用户信息卡，服务端确认管理员后才跳转；后端 openid 白名单鉴权 |

---

## 5. 页面间数据传递约定（2026-09-20 重写）

```
PAGE-001 → PAGE-005:  不传参。PAGE-005 自己从零开始填表单
PAGE-001 → PAGE-002:  景点名点击弹浮窗（spotId），show-actions=false（首页即提醒动线起点）
PAGE-001 → PAGE-003:  不经过；想去景点只在 PAGE-005 内可达（带当前 spotIds）
PAGE-003 → PAGE-005:  返回时直接 setData 回 prev 页（spots.js onBack），点「生成」重新 preview
PAGE-005 → PAGE-007:  不传参。清单是「提交前的暂存区」，PAGE-007 自己调 cart.list（不传 tripId）
PAGE-007 → PAGE-008:  不传参。PAGE-007 提交时判断：全不提醒 → 直接 cart.commit；有提醒项 → 跳 PAGE-008
PAGE-008 → PAGE-001:  cart.commit 成功 → 回首页。⚠️ tripId 在这一刻才产生，写入
                      app.globalData.currentTripId 供首页定位新行程
```

`PAGE-008`（V0.3 硬闸门）不使用 `confirmReminderAccess()`：额度不足时主按钮禁用，只允许用户主动点击「点击补授权次数」，微信一次性订阅每次点击最多增加 1 条；仍不足时继续保留缺口，不用异步连发伪装补齐。全部满足后才走 `cart.commit`，不提供 `trip-only` 旁路。首页“约其他日”和景点页直设提醒等轻量入口仍共用 `notify.getReminderQuotaNeeded()` / `confirmReminderAccess()`；订阅不足时先就地说明缺口，用户主动选择「补授权并继续」后才调用微信授权，成功后沿当前动线继续，只有 `action = ready` 才走普通 `cart.commit`，`trip-only` 走 `disableReminders: true`，`settings/cancelled` 不提交（详见 `REMINDER-RULE-009`）。

⚠️ **不再传 tripId**：纯预览化后「生成时间线」不建行程，清单也不挂在行程上。
任何页面都不应缓存或透传 tripId —— 提交返回的那个才是唯一可信的。

### 5.1 分享页面参数契约（2026-09-25）

```text
景点深链：
/pages/spot-hub/spot-hub?spotId=<id>&source=share|search|direct

场景页：
/pages/share-scene/share-scene?sceneId=today|national-day-2026
                                      &source=share|timeline|home_share|search|direct
```

- `spotId` / `sceneId` 均做 URL 编码；无效景点显示明确失败态，无效场景回退 `today`。
- 链接只允许公开参数，不得出现昵称、OpenID、行程 ID、票务结果或提醒状态。
- `today` 使用 `spots.list` 后按北京时间过滤；`national-day-2026` 使用 `spots.batch`，景点 ID 顺序以 `share-scenes.js` 配置为准。
- 国庆场景有效期 2026-09-25 至 2026-10-08；过期后页面和分享路径回退 `today`。

### 5.2 分享事件契约（2026-09-25）

使用 `wx.reportEvent`，没有后端接口：

| 事件 | 参数 |
|---|---|
| `share_intent` | `entry_type`、`entry_id` |
| `share_landing_view` | `entry_type`、`entry_id`、`source` |
| `share_first_action` | `entry_type`、`entry_id`、`source`、`share_action_type` |
| `share_revisit` | `entry_type`、`entry_id`、`source`、`day_offset` |

- `entry_type`: `spot | scene | list | home`
- `source`: `share | timeline | home_share | search | direct`
- `share_action_type`: `reminder | trip_only`
- 微信后台未注册事件或 API 不可用时，客户端静默降级；不得因此阻断提醒提交。

---

## 6. 首页形态判定（2026-09-20 重写：单形态）

```
首页 onShow：
  1. 调 home.bootstrap（无参数）
  2. 读返回体：
     - trips.length === 0 且 history.length === 0 → 渲染创建引导空态
     - 否则渲染行程状态墙（摘要卡 + 纵向分段墙 + 历史折叠）
  3. 若返回 scrollTargetId → 滚到该行程项所在分段（24h 内刚开抢且未标记的项）
```

旧「形态1 / 形态2 双 Tab」判定（`homeMode` 读 `task.list`）**已废止**。
`home.bootstrap` 仍返回一个 `homeMode` 字段供旧调用方兜底读，语义已降级为
「0 个行程项 = 1（创建引导）/ 否则 = 2」，**新首页不消费它**。

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

---

## 8. 首页行程化 V2 契约（2026-09-16 冻结 · **2026-09-20 全部实现**）

> 本节是本次开发的唯一契约，现已全部落地：P1（2026-09-16）`trip_items`、免预约加入、`remindOn` 分流、`cart.commit`、任务挂 `itemId`；P2/P3（2026-09-20）状态推导、六个 `tripItem.*` 接口、`home.bootstrap` V2 与首页行程状态墙。
> 2026-09-20 的两处口径变更见 8.7；实现真身：状态推导 `cloudfunctions/reminder/lib/item.js`、用户操作 `lib/trip-item-actions.js`、挽回 `lib/recovery.js`。

### 8.1 数据模型

#### TABLE-008 `trip_items`

```javascript
{
  _id,
  userId,
  tripId,
  spotId,
  visitDate: 'YYYY-MM-DD',       // 北京日期
  backupGroupId: String,         // 同一 trip + 同一景点的备选日期组
  remindOn: Boolean,             // 免预约景点恒 false
  result: 'SUCCESS' | 'FAILED' | null,
  resultAt: Date | null,
  createdAt,
  updatedAt
}
```

约束与派生规则：

- 逻辑唯一键：`(userId, tripId, spotId, visitDate)`，云函数查重，不做老数据合成迁移。
- `releaseAt / reservationRequired / ticketState / reminderState` 均为读取时派生，不持久化到行程项。
- `result` 只能从 `null` 写成 `SUCCESS/FAILED`；写入后仅允许 `resultAt + 4s` 内调用 `tripItem.undoResult`。（变更：2026-09-17 由 10 秒收紧为 4 秒，常量 `V1.RESULT_UNDO_SECONDS`）
- `backupGroupId` 由服务端按“同一行程 + 同一景点”生成，用于备选收束、进度分组和挽回建议。
- 六个展示态的计算顺序：免预约 → 人工结果 → 放票时间前 → 放票后 24 小时内 → 待确认。
- 放票后官方预约入口持续可点，直到 `visitDate` 北京时间 23:59；不因进入 `UNMARKED` 或写成 `FAILED` 而消失。

#### 其他表变更

- `reminder_tasks` 新增必填 `itemId`；`tripId / spotId / visitDate / releaseAt` 保留为通知扫描所需的冗余字段。
- `reminder_cart` 新增 `remindOn` 与 `reservationRequired`；`releaseAt` 对免预约项为 `null`；逻辑唯一键为 `(userId, tripId, spotId, visitDate)`。
- `trips` 继续保存城市和日期范围；行程项是首页状态墙的事实来源，行程是否为空改看 `trip_items`，不再看提醒任务。
- 不做旧数据合成兼容；开发环境可以直接清空测试集合并重新 seed。

### 8.2 `home.bootstrap` V2

```javascript
调用：{
  action: 'home.bootstrap',
  includeSpots: true
}

返回：{
  success: true,
  serverNow: '2026-09-16T...',
  primaryTripId: 'trip_a',
  trips: [{
    _id, city, startDate, endDate, name,
    progress: {
      done: 2,                    // 已成的预约需求组数
      total: 3,                   // 需预约的需求组总数，免预约不计
      noReservationCount: 1       // 另有 X 处随到随玩
    },
    items: [/* 见 8.3 item 结构 */]
  }],
  history: [{
    _id, city, startDate, endDate, name,
    progress: { done, total, noReservationCount }
  }],
  stickyBanner: {
    releaseAt, spotName, visitDate, itemId, countdownText
  } | null,
  releasePills: [/* 摘要卡底部「即将提醒」胶囊，按放票时刻合并 */],
  reminderQuotaWarning: {         // 仅 48 小时内有提醒且授权 low/short/exhausted 时返回
    level, pendingMessageCount, remainingQuota, shortfall, replenishNeeded,
    nearestRemindAt, text
  } | null,
  recoverableIds: ['item_2'],     // 2026-09-24：这些行程项「没抢到」但还有可换的日期
  hotSpots: [/* spots.list */]
}
```

- `trips` 只包含未结束行程，按 `startDate` 升序。
- `history` 只包含 `endDate` 次日起的历史行程，按 `startDate` 降序。
- 一个行程结束后仍在 `endDate` 当天保留在主墙；次日按北京时间读取时归入历史，不依赖定时任务。
- 首页结构：一张 `primaryTripId` 全局摘要卡 + 纵向分段墙；其他行程只显示紧凑分段标题，不用横向 Tab。
- 顶部吸顶 Banner 跨全部当前/未来行程取全局最近 1–2 个放票项。
- ⚠️ **`recoverableIds` 必须随这一次响应给**（决策文档 4.3 的三层规则，真身 `lib/recovery.js` 的
  `recoverableMapOf`）。前端据此渲染「还有其他日期可约」气泡与菜单里的「约其他日」；
  **页面不得另开一次请求去算候选**——那条独立往返与这份返回体之间没有顺序保证，
  返回体已经带着 `result = FAILED` 而候选还在路上时，卡片会按「FAILED 但不可挽回」渲染，
  挽回线永远不出现（2026-09-24 修的正是这个）。数组只含**有候选**的 itemId；
  空数组 = 三层规则判定「不打扰」（已设备选未开票 / 没有可用日期），前端保持静默。

### 8.3 行程项返回结构

```javascript
{
  itemId: 'item_1',
  tripId: 'trip_a',
  spotId: 'gugong',
  spotName: '故宫博物院',
  visitDate: '2026-10-02',
  backupGroupId: 'trip_a:gugong',
  reservationRequired: true,
  remindOn: true,
  releaseAt: '2026-09-25T12:00:00.000Z',
  ticketState: 'BOOKABLE',
  ticketStateLabel: '可抢票',
  canSetReminder: false,           // 放票时刻已过 → 卡片不再提供提醒开关（2026-09-23）
  bookingEntryEnabled: true,       // 免预约或其他不可预约景点为 false
  result: null,
  resultAt: null,
  undoUntil: null,
  reminder: {
    state: 'WAITING',
    stateLabel: '待提醒',
    reason: null,
    channels: ['OFFICIAL_ACCOUNT'],
    offsets: [5]
  } | null
}
```

状态文案固定为：`待抢票 / 可抢票 / 已约到 / 未抢到 / 待确认 / 免预约`。`UNMARKED` 的 `ticketStateLabel` 为“待确认”，**语义为中性态，不叫“未抢到”**。（变更：2026-09-28 用户可见文案由“未标记”改为“待确认”，枚举与判定不变；2026-09-22 按设计稿整体换词，旧值为 `待抢 / 可抢 / 已成 / 未成 / 开过票了`。真身在 `cloudfunctions/reminder/lib/item.js` 的 `TICKET_STATE_LABEL`，含未知态兜底值 `待抢票`）

`reminder.state` 为 `ENUM-009` 四态，文案固定为 `未设提醒 / 待提醒 / 已提醒 / 未送达`（`lib/item.js` 的 `REMINDER_STATE_LABEL` 为唯一口径）。

`canSetReminder` = **现在还能不能开启/取消提醒**（需预约 && 有放票时刻 && 放票时刻还没到，真身 `lib/item.js` 的 `canSetReminder`）。⚠️ 它**与 `ticketState === 'PENDING'` 不等价**：清单先加、放票之后才提交的项是可抢票态，但同样没有提醒入口。页面一律读这个字段，**不得自行按 `ticketState` 或时间重推**。放票一过两个动作都没有意义（开启会即刻 `MISSED`、取消是空转），所以它们由同一条判据同生共死。

> ⚠️ **勿在 UI 文案里使用「已设提醒」**：它同时指 `WAITING` 与 `TRIGGERED`，歧义。四态在行程项卡上的呈现（位置、图标形状、可点性、菜单分支）见 `产品文档.md` 1.6 / `HOME-RULE-006` 与 `产品分析/2026-09-14-首页行程化改版决策.md` 3.4 / 3.5。
>
> ⚠️ **`reminder` 字段不得因为「卡上暂时不渲染」而从返回体里删掉**：`MISSED` 的原因（`reason`）是唯一的静默失败出口，卡上未送达状态的可点弹窗直接消费它。

### 8.4 行程项接口

#### `tripItem.markResult`

```javascript
调用：{ action: 'tripItem.markResult', itemId, result: 'SUCCESS' | 'FAILED' }
返回：{
  success: true,
  item,                         // 更新后的 item
  backupPrompt: [{ itemId, visitDate, ticketState }] | null
}
```

规则：

- 只能标记出票后且尚未人工标记、日期未结束的行程项。
- 标记成功返回 `backupPrompt`，前端用内联提示询问删除或保留备选；没有备选时为 `null`。
- 保留备选后继续按原提醒配置抢票。
- 提醒失败/未送达不影响 `tripItem.markResult`。

#### `tripItem.undoResult`

```javascript
调用：{ action: 'tripItem.undoResult', itemId, expectedResultAt }
返回：{ success: true, item }
```

- 仅 `resultAt + 4s` 内允许，且 `expectedResultAt` 必须匹配，防止覆盖后续操作。
- 前端用页面底部 Snackbar `已标记为抢到了 [撤销]`，不使用系统 Toast。

#### `tripItem.updateReminder`

```javascript
调用：{
  action: 'tripItem.updateReminder',
  itemId,
  remindOn,
  channels: ['OFFICIAL_ACCOUNT'],
  offsets: [5]
}
返回：{ success: true, item, quotaRefunded: false, missedKept }
```

- 免预约行程项拒绝开启提醒。
- 已有任务时更新相关任务；`remindOn=false` 时关闭/删除**未触发**任务（`WAITING`），已触发/已失败的保留为历史。
- **放票时刻已过 → 开启与取消一并拒绝**，错误码 `1017`（2026-09-23）。开启会即刻被判 `MISSED`（用户刚点完就看见「未送达」，因果反了）；取消则没有待发任务可取消，是空转入口。判据 = `lib/item.js` 的 `canSetReminder`，与 `decorateItem` 下发的同名字段**同源**（前端菜单据此渲染「开启提醒 / 取消提醒」）。
- ⚠️ **放票前取消提醒时，若该行程项还留有终态任务（`TRIGGERED`/`MISSED`），`remindOn` **不**被落成 `false`**（2026-09-23 修）。原实现无条件落 false，会把 chip 从「未送达」洗成「未设提醒」——失败信号当场消失而任务仍在库里，属决策文档 §五禁止的静默失败。返回值里 `missedKept: true` 表示「有未送达记录被保留」，前端据此给一句说明。
- 已发送任务的微信授权额度不退还（`quotaRefunded` 恒为 `false`，显式写明）。

#### `tripItem.remove`

```javascript
调用：{ action: 'tripItem.remove', itemId }
返回：{ success: true, itemId, tripId, removedTasks, tripRemoved }
```

#### `tripItem.removeVisitDate`

```javascript
调用：{ action: 'tripItem.removeVisitDate', tripId, visitDate, itemIds }
返回：{ success: true, tripId, visitDate, removedItems, removedTasks, tripRemoved }
```

- `itemIds` 可选；前端传该日期分组内可见的全部行程项 ID。云端以 `tripId + visitDate` 查询结果和这批 ID 取并集后整组删除，避免漏删。
- 前端必须先明确提示“该日期下的行程项和提醒会一并删除”。
- `tripRemoved=true` 表示行程下已无任何行程项，行程随之删除。

#### `tripItem.recoveryCandidates`

```javascript
调用：{ action: 'tripItem.recoveryCandidates', itemId }
返回：{
  success: true,
  candidates: [{
    visitDate,
    releaseAt: Date | null,
    action: 'BOOK_NOW' | 'SET_REMINDER',
    label
  }]
}
```

- 只返回目的地开放且可行动的日期。
- `BOOK_NOW` 文案为“已开票，去官方渠道预约”，不承诺实时有余票。
- 没有可靠余票数据时不返回“约满”结论。
- 已过、闭馆、无固定放票规则不返回。
- ⚠️ **首页不再调这个 action**（2026-09-24）：候选改由 `home.bootstrap` 的
  `recoverableIds` 一次性下发，避免两次往返错序。本接口保留给「重新打开挽回浮层」
  这类按需入口（决策文档 4.3 要求挽回入口是三层的固定入口，不因一次划掉就找不回来）。

### 8.5 购物车 V2

#### `cart.add`

```javascript
调用：{
  action: 'cart.add',
  tripId,                       // 可省 = 当前暂存清单（8.7）
  spotId,
  visitDate,
  releaseAt: Date | null,       // ⚠️ 2026-09-24 起**服务端忽略并自行推导**，免预约为 null
  remindOn: Boolean             // 免预约必须 false
}
```

- ⚠️ **`releaseAt` 由服务端按 `visitDate − advanceDays` 推导**（`lib/item.deriveReleaseAt`，与
  行程项、时间线同一真身），调用方传什么都会被覆盖；**不传也合法**。
  「约其他日」这条动线只有用户选的 `visitDate`（`date-picker-sheet` 只回 visitDate），
  原先强制要求 `releaseAt` 会让它稳定回 1010 —— 挽回线点得开、走不通。
  推不出放票时刻（无 `advanceDays` 的景点）仍然 `BAD_PARAM`。

#### `cart.updateRemindOn`

```javascript
调用：{ action: 'cart.updateRemindOn', cartId, remindOn: Boolean }
返回：{ success: true, cartId, remindOn }
```

- 仅需预约项可切换；免预约项强制 `false`。

#### `cart.commit`

```javascript
调用：{
  action: 'cart.commit',
  tripId,
  cartId,                           // 可选；只提交本次补录的一条，不消费其他暂存草稿
  channels: ['OFFICIAL_ACCOUNT'],   // 有 remindOn=true 项时必填
  offsets: [5],                     // 有 remindOn=true 项时必填
  disableReminders: false           // 可选；true = 仅把暂存清单落成行程项，不创建提醒
}
返回：{
  success: true,
  createdItems: N,
  createdTasks: M,
  addedReminderCount: M,       // 本次提交实际新增的提醒数
  addedTripItemCount: T,       // 本次提交进行程的清单项数（含合并进既有行程的项）
  noReminder,
  expiredReminder,
  disableReminders,
  tripId,
  toast: '已加入行程 · 已设置 M 个提醒'
}
```

- 购物车中 `remindOn=true` 的需预约项进入设置提醒页；如果全部 `remindOn=false`，直接提交并创建行程项。
- 首页“约其他日”和景点页补录必须传本次 `cartId`，只提交该条并保留其他暂存清单；设置提醒页保持不传 `cartId`，代表整单提交。
- `disableReminders=true` 是“仅加行程不提醒”的降级提交：忽略 `channels/offsets`，本次提交的清单项均以 `remindOn=false` 落成行程项，不创建 `reminder_tasks`，且不返回公众号关注引导。该模式只允许提交暂存清单，不允许同时传真实 `tripId`。
- 服务端在一次提交中创建全部 `trip_items`；仅为 `remindOn=true` 且可提醒的项创建 `reminder_tasks`。
- 旧 `task.submit` 在 V2 实现完成后只作为内部兼容代码，不再由首页/设置页调用。

### 8.6 不可漂移的实现约束

1. 状态在读取时推导，`UNMARKED` 不落库，不依赖定时任务。
2. 票务结果与提醒送达状态必须分字段、分 UI 展示。
3. 进度分母按 `backupGroupId` 去重，免预约项不计入分母。
4. 一行程项一个 `itemId`；任务、删除、提醒状态和推送落地全部按 `itemId` 关联。
5. 首页不出现提醒任务一级 Tab；旧任务列表仅保留代码兼容期，不进入新 UI。

### 8.7 2026-09-20 口径变更

1. **`timeline.generate` → `timeline.preview`**（8.5 之外的新接口）
```
调用：{ action: 'timeline.preview', startDate, endDate, spotIds, city, segments?, committedTripId? }
返回：{ success: true, events, byDeparture, bySpot, closedSpots, closedDaySkips, empty, emptyReason }
```
   - 按当前所选日期段与景点**独立计算**，不创建/改写任何行程。
   - 每个 event 带 `releaseState / releaseStateLabel`：`NOT_RELEASED / 待开票`、`RELEASED / 已开票`、`NO_RESERVATION / 无需预约`；已开票只影响展示，status 仍为 `SELECTABLE`。
   - **读**当前用户的暂存清单（`reminder_cart` 的 `PENDING_CART_TRIP_ID` 那批）→ 清单里的项返回 `IN_CART`；
     清单是「用户正在这一页做的事」，不反映它按钮就像坏的。
   - `segments` 可选：`[{spotId, startDate, endDate}]`，不传则按 `spotIds × [startDate,endDate]`。
   - 旧 `timeline.generate({tripId})` 保留为兼容代码，新流程不再调用。
   - **2026-09-21 增补 `committedTripId`（可选）**：从首页某趟进行中行程进来接着补景点时，
     前端把该行程 id 传进来，预览会把**这一趟**已有的 `trip_items` 标成 `COMMITTED`
     「已加入行程」禁选——用户要往这趟补，就必须看得见已经有的项，否则不知道该补哪个。
     ⚠️ 语义被刻意收窄为**只读这一趟**，绝不回退到「扫全部行程」：读别趟会把属于另一趟
     行程的状态带进预览（换一批日期重新生成时看到不属于本次的「已在行程」），正是本接口
     纯预览化要修掉的问题。属于别趟的同 `(spotId, visitDate)` 仍显示为可选，真重复加时
     由 `cart.add` 按 `(userId, spotId, visitDate)` 跨行程查重兜底。
     不传 → 与旧口径完全一致（`committed` 恒 false）。仍**不读** `reminder_tasks`。

2. **清单改「提交前的暂存区」**：`cart.add` / `cart.list` / `cart.clear` 的 `tripId` **可省**，
   不传 = 操作「当前暂存清单」（服务端用占位 `PENDING_CART_TRIP_ID = '__pending__'` 存行）。
   提交前没有行程，行程在 `cart.commit` 时才创建/合并，清单行整批改挂过去。

3. **`cart.commit` 回传 `tripId`**（8.5 已列，此前实现漏了）；同时补通道合法性校验。

4. **行程是否为空改看 `trip_items`**：`trip.removeIfEmpty` / `purgeIfNoItem` /
   `notifier.cleanup` 三处均以「还有没有行程项」为准，不再看提醒任务——
   否则只有免预约景点、没设提醒的行程会被误判成空壳删掉。

5. **撤销窗口 10 秒 → 4 秒**（见 8.1）。

6. **行程合并时同步任务的 `releaseAt` 与 `tripId`**：放票时刻由 `visitDate` 推导，
   合并后行程段变了就会过期；`itemId` 保持不动，它是 tasks join items 的键。
