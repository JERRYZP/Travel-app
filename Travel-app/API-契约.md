# Travel-app 前端接口契约 V1.4

> 面向：前端（微信小程序页面开发）
> 2026-11-05 更新：反馈支持管理员追加多条单向回复、逐条修改，用户端展示完整回复线程和「已修改」标记；新增反馈采纳奖励 `payment.feedbackReward.adminStatus/adminGrant/adminRevoke`，每次奖励 30 天会员，可按反馈叠加。新反馈与历史反馈均可奖励，历史反馈标记为「补发」。用户端通过 `feedback.list.rewardNotices` 查看补发和撤回通知；通知按 `rewardUpdatedAt` 独立分页读取，不受最近 50 条反馈限制。
> 2026-11-06 更新：提醒时段按额度成本收敛。清华只保留即时预约，工作日提前 1 天 `08:00`、周末及法定节假日提前 7 天 `08:00`，抽签预约不创建任务；军博只保留最早 `08:00`。当前两个景点每个出行日都只创建 1 条 `reminder_task`。底层仍保留 `releaseSlots` 与 `supportsMultiRelease` 请求级能力门禁，旧客户端继续使用单任务旧契约；`cart.list` 与 `cart.planDates` 继续返回 `reminderTaskCount`，当前值按单任务计算，未来重新启用多时段时仍按实际任务数校验授权与提醒名额。
> 2026-11-02 更新：新增 `tripShare.create/status/revoke/open` 与 PAGE-018 行程只读分享。分享令牌只从公开路径传入，普通行程接口仅返回 `shareActive`；主人接口可通过 `ownerNickname` 读取应用内昵称用于会话标题，接收方数据只含城市、日期、天数和景点名称。
> 2026-11-03 更新：客服工作台 `adminReminderQuality.stats` 改为读取由 `payment` 两分钟定时器在北京时间 `13:00 / 21:00` 后首个 tick 持久化的质量快照；工作台打开和刷新不再扫描 `reminder_events` / `reminder_tasks`。仅 `AFTER_SALES_ADMIN_OPENIDS` 白名单可调用。
> 2026-11-05 更新：会员新契约增加客户端能力门禁。新客户端在 `reminder` 请求中显式传 `membershipCapabilities: ['unlimited-v3']`；只有同时声明能力且命中 `MEMBERSHIP_ENFORCEMENT_MODE` 灰度时才返回 `¥6 / 30 天 / 不限`。未声明能力的旧客户端永久继续 `legacy-v2` 的 `¥3 / 15 个 / task_pack_5`，即使方案开关已切 `all`。
> 2026-11-04 更新：会员升级通过 `MEMBERSHIP_ENFORCEMENT_MODE` 做方案灰度。仅 `test` 且命中 `MEMBERSHIP_TEST_OPENIDS` 的新能力客户端返回不限会员方案；非白名单继续旧契约。`all` 仅供用户明确授权的全量切换。`taskLimitUnlimited` 是新方案权益标志；禁止让旧客户端消费 `taskLimit=10000` 兼容投影。
>
> 2026-11-05 更新：当前不限会员价格由 ¥8 调整为 ¥6 / 30 天，规格版本升级为 `member-unlimited-30d-v4`。历史 `member-unlimited-30d-v3` / 800 分订单继续按订单快照支付、查单、发放和退款。
> 2026-11-08 更新：新增 `two-tier-v5` 候选契约：¥3 / 30 天 / 10 个提醒名额、¥4.9 / 30 天 / 不限额度、¥1.9 补差升级。定价由独立 `membership_pricing` 开关控制，默认只对 `MEMBERSHIP_TEST_OPENIDS` 生效。升级包依赖 3 元会员单，先退会员返回 `1034`；平台强制先退会员时，未过期升级包转一次性升级权益券，仅随下一笔 3 元会员单原子消费。非命中用户继续现有 `unlimited-v3` 或 `legacy-v2`。
> 2026-11-08 更新：两档定价新增独立运行期开关 `payment_config/membership_pricing`，`mode=test|all`，默认且读取失败时回退 `test`。`test` 只对 `MEMBERSHIP_TEST_OPENIDS` 开放；`all` 对声明 `two-tier-v5` 的新客户端全量开放。该配置与 `membership_enforcement` 的额度限制模式完全独立。
> 2026-11-02 更新：客服工作台新增会员限制模式切换。运行期真身为 `payment_config/membership_enforcement`，管理员可切 `off/test/all` 并即时生效；切 `all` 前服务端强制核验两项上线迁移。
> 2026-11-02 更新：新增客服工作台。管理员可通过 `adminOrders.list/detail` 查询全部会员订单，售后列表补全昵称、完整 OpenID 与关键词搜索；会员购买总开关保留在页面顶部。
> 2026-11-02 更新：新增会员购买总开关 `payment_config/membership_sales`。暂停只阻止新订单和新发起支付；已支付订单继续查单与发权益，会员状态、订单、退款和售后不受影响。
> 2026-10-30 更新：会员支付新增独立退款生命周期、订单详情、用户售后申请和小程序售后工作台；`membership.orders` 返回当前用户最近 50 笔会员 / 提醒名额订单及可执行动作，退款结果以微信支付回调或主动查单为准。
> 2026-10-28 更新：`spots.list` / `detail` / `batch` 的景点卡新增 `aliases`，供 PAGE-003 在页面内做名称 / 简称 / 别名 / spotId 的本地模糊过滤。PAGE-003 与 PAGE-004 已合并为单页，页面不再调用 `spots.search`、`spots.searchHistory`、`spots.clearSearchHistory`；这三个接口保留兼容。
> 2026-10-27 更新：新增会员与提醒名额 `membership.*`、`payment.*`；该功能初始价格为会员 ¥2/30 天提升至 10 个，加购 ¥2 记录 5 个名额并在会员有效期内生效；2026-10-30 新订单价格调整为 ¥3，历史订单继续按原金额处理。支付与权益只由服务端订单确认后发放，不承诺平台自动广告可被关闭。
> 2026-10-31 更新：免费门槛保持 5 个；会员权益调整为总计 15 个（净增 10 个），每次加购调整为 10 个，价格仍为 ¥3。`task_pack_5` 为兼容保留的稳定 SKU 标识，不再表示套餐数量。
> 2026-10-31 更新：`cart.commit` 支持 `cartIds`，保留兼容旧版景点快捷入口和主流程定向提交；只消费指定暂存项，并在同一次服务端提交中完成提醒名额校验、行程合并和任务创建。
> 2026-11-02 更新：景点页/详情/首页“约其他日”改为 `cart.planQuickDates` + `cart.quickCommit` 一次性提交，不再把快捷入口的日期写进主流程 `reminder_cart`。旧版本遗留的同景点日期暂存行由 `quickCommit` 直接消费；已落成真实行程的日期继续拦截。
> 2026-10-31 更新：新增 `cart.planDates` 与 `cart.addDates`，保留给主流程清单预检和原子写入；`cart.commit` 在任务落库前再次校验订阅授权余额，客户端预检后发生额度竞态时返回 `1008`。
> 更新：2026-10-28 新增景点字段 `strongReminder`；弱提醒口径改为“需预约、难度 ≤2 且未显式提升”，强提醒（含 `strongReminder=true`）在时间线与清单默认开启提醒。同日，无固定放票时刻的需预约景点（如环球影城）可加入行程和暂存清单，但不创建提醒任务；`timeline.preview` 增加 `NO_FIXED_RELEASE / 随买随用`，`cart.list` 增加 `noFixedRelease`；新增 `cart.pruneScope`，生成时间线后把暂存清单收敛到本次日期段 × 景点集合。2026-09-29 明确微信一次性订阅每次用户点击最多增加 1 条额度，禁止异步连发伪装批量授权。2026-09-25 `cart.commit` 新增 `cartId`（补录只提交本次项）与 `disableReminders`（仅加行程不提醒）；此前 2026-09-16 首页行程化 V2 契约定稿，新增 `trip_items`、`tripItem.*`、`cart.commit` 与新版 `home.bootstrap`；旧第 2.0 / 2.1 / 2.3 / 2.4 中面向“提醒任务列表 / 双 Tab 首页”的接口在 V2 实现时由第 8 节取代。此前 2026-08-26 spots `remindable` / `weak`、2026-08-19 feedback 管理端、2026-08-14 日历通道下线等变更继续有效。
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
| 1008 | 订阅消息授权次数不足 | 保留原清单，回到授权卡逐次补齐后重试 |
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
| 1026 | 提醒名额不足 | 进入会员页或提醒页内付费入口；保留原清单并展示真实缺口 |
| 1032 | 会员购买暂停中 | 关闭支付入口；保留清单和会员/订单/售后状态，稍后由服务端恢复 |
| 1033 | 上线迁移未完成，不能切全量 | 保持原会员限制模式；先完成对应迁移 |
| 1034 | 升级包依赖会员主订单 | 停止退款并引导先查看/退款升级包；平台强制先退会员时由服务端转权益券 |
| 1041 | 当前行程暂不可分享 | 分享浮层保留可见错误，不创建令牌 |
| 1042 | 分享行程不可查看 | 只读页统一显示失效态，不区分停止、过期、删除或非法令牌 |
| 1043 | 反馈不存在 | Toast「反馈不存在」并刷新列表 |
| 1044 | 回复内容为空 | 保持编辑框，提示填写回复 |
| 1045 | 回复条数已达上限 | 保留已有回复，关闭新增入口 |
| 1046 | 回复不存在 | 提示回复已被更新，刷新列表 |
| 1047 | 反馈奖励已撤回 | 不允许同一反馈再次赠送 |
| 1048 | 奖励后已有新的会员权益 | 不自动撤回，保留当前权益并提示人工核验 |
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

### 1.1 `list` — 景点列表

```
用途：PAGE-001 热门景点网格、PAGE-003 全部景点列表
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
    aliases: ["军博", "军事博物馆"],     // 搜索别名；随卡下发，供 PAGE-003 本地过滤，前端不维护第二套数据
    category: "博物馆",
    district: "东城区",
    audienceTags: ["family", "elder"],  // 2026-09-06 景点聚合页：人群标签（family=亲子 / elder=带父母），无标注为 []
    difficultyScore: 5,
    difficultyLabel: { key: "EXTREME", text: "极难约" },
    popularityScore: 95,
    reservationRequired: true,          // 2026 分层：是否需预约（false = 免预约，不进提醒流程）
    remindable: true,                   // 2026-08-26：需预约且有放票时刻 → 可设提醒并创建提醒任务
    addable: true,                      // 所有景点均可加入行程；remindable 只决定能否设提醒
    weak: false,                        // 需预约、difficultyScore≤2 且 strongReminder!==true → 弱提醒；标签行显示「票量充足，无需卡点」
    cardDesc: "随到随买，当前旺季门票10元，联票20元",  // 免预约 B 层：「随到随买…」；弱提醒可提醒景点：「提前N天 HH:MM放票 · 票量充足，无需卡点」；需预约但无放票时刻：「无固定放票时刻，随买随用」
    tags: ["提前7天放票", "20:00放票"],
    advanceDays: 7,
    releaseTime: "20:00",
    releaseTimes: ["08:00"],            // 当前只记录提供提醒的最早时刻
    releaseSlots: [{                    // 可选；工作日/周末不同提前天数的权威结构
      key: "junbo-0800",
      label: "第1场",
      releaseTime: "08:00",
      advanceDays: 7,
      weekendAdvanceDays: null          // 可选；周末及法定节假日覆盖 advanceDays
    }],
    holidayRanges: [["2026-10-01", "2026-10-07"]], // 已确认/官方公布的法定节假日范围
    closedDays: ["monday"],
    releaseStatus: "NOT_RELEASED" | "BOOKABLE" | "FULL",
    earliestDate: "2026-08-12",       // 最早可约日期 = 今天 + advanceDays；该日闭馆则向前回退到最近可约日，不向后顺延
    officialAppid: "wx...",            // 可直跳小程序
    officialPath: "pages/...",
    officialWebUrl: "https://...",
    stale: true                        // scraper 未上线时为 true，前端可选「数据仅供参考」提示
  }]
}
// 排序：popularityScore 降序；前端按 addable 分流：可提醒项显示「选择 / 已选」；免预约或无固定放票时刻的需预约项也可选择，前者显示「无需预约」、后者显示「随买随用」，均不创建提醒任务
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

> 前端交互（PAGE-002，2026-10-12 修订）：MINIPROGRAM → `wx.navigateToMiniProgram` 直跳，失败兜底复制 `url`（官网链接）并 Toast「跳转失败，已复制官网链接」；**WEB → 直接复制链接**：`wx.setClipboardData({ data: entry.url })` + Toast「链接已复制，请在手机浏览器打开」。**不进 `web-view`** —— 微信 `web-view` 只认公众平台「业务域名」白名单，而官网都是第三方域名（故宫 / 天安门 / 清华…），配置白名单要把校验文件放到对方域名根目录，做不到；且 `wx.navigateTo` 本身会成功，「跳转失败再复制」的兜底永远不触发，用户只会看到打不开的白页。承载页 `pages/webview/webview` 已随本次改动删除，不要再新增第二套官网跳转实现；OFFICIAL_ACCOUNT → 有 `qrCode` 则弹二维码弹层（长按识别），无 `qrCode` 则 Toast 提示关注。二维码弹层必须渲染在 `scroll-view` 与 `.popup-sheet`（`overflow:hidden`）之外：真机上 `position:fixed` 一旦落进滚动容器，包含块会退化成滚动容器、再被 sheet 裁掉，折叠态下二维码只露上半截（回归断言见 `test/cart-popup.test.js` §9）。`qrCode` 字段保留 `/images/qrcodes/...` 逻辑路径，源图放 `cloud-assets/images/qrcodes/` 并上传到 `static/v0.3/images/qrcodes/`；前端通过 `utils/assets.js` 转成云文件 ID，不把二维码打进代码包。

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
用途：原 PAGE-004 搜索态；2026-10-28 起 PAGE-003 改用本地过滤，本接口保留兼容
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
用途：历史搜索 tag 行；2026-10-28 起 PAGE-003 不再展示，接口保留兼容
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
  includeSpots: false               // 是否返回热门景点；默认 false。true 时内部调 spots 云函数
                                    // （多一次冷启动），否则 hotSpots 恒为 []
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
  hotSpots: [...]                // 热门景点卡（来自 spots.list；includeSpots 为 true 时才有内容）
}

错误码：1500（服务异常）。热路径依赖组合索引 reminder_tasks{backendStatus, releaseAt}。
      `includeSpots: true` 时内部调用 spots 云函数（失败时 hotSpots=[]，前端回退 spots.list）。
```

### 2.1 行程域（trip.*）

#### `trip.create` — 创建或合并行程（2026-09-14 恢复自动合并）

```
用途：PAGE-001 首页形态1「生成预约时间线」→ 内部先创建行程
说明：TRIP-RULE-002 —— 同城市即合并成一个行程（= 一个任务分组 Tab），
     日期取并集；新行程可能同时与多个既有行程合并，滚雪球式反复合并。
     不存在“一个月没有新行程”的冷却期，也不按日期间隔拆分。
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
    nextReminderAt: "2026-05-24T12:00:00.000Z", // 最近待提醒时间
    shareActive: true                    // 只下发布尔值，shareToken 永不进入普通返回体
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

### 2.1.1 行程只读分享（`tripShare.*`，2026-11-02）

#### `tripShare.create`

```
调用：{ action: 'tripShare.create', tripId }
说明：幂等创建或读取当前整趟行程的只读分享令牌。
     只允许行程属于当前调用者、endDate >= 北京今天，且至少有一个 trip_item。
     已有效时复用原令牌；停止后再次调用生成新令牌。
返回：{
  success: true,
  tripId,
  ownerNickname,         // 仅主人接口返回的应用内昵称，用于会话分享标题，不回传微信昵称
  token,                 // 64 位十六进制安全随机令牌，仅主人接口返回
  expiresOn,             // endDate + 7 天，YYYY-MM-DD
  reused                 // true = 复用旧链接
}
失败：1041 当前行程不可分享；1010 行程不存在或不属于调用者
```

#### `tripShare.status`

```
调用：{ action: 'tripShare.status', tripId }
返回：{
  success: true,
  tripId,
  ownerNickname,         // 仅主人接口返回，读取当前应用内资料昵称
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'NONE',
  shareActive,
  token,                 // 仅 ACTIVE 时返回，供分享浮层复用
  expiresOn,             // 仅 ACTIVE 时返回
  canCreate              // 行程未结束时为 true
}
```

#### `tripShare.revoke`

```
调用：{ action: 'tripShare.revoke', tripId }
说明：幂等停止分享。成功后立即清空 shareToken，旧链接失效。
返回：{ success: true, tripId, revoked: Boolean, status: 'REVOKED' | 'NONE' }
```

#### `tripShare.open`

```
调用：{ action: 'tripShare.open', token }
说明：任意获得链接的微信用户均可读取。token 是唯一授权凭证，
     不接受 tripId、userId 或 OpenID 作为辅助授权。
返回：{
  success: true,
  share: { readOnly: true, expiresOn },
  trip: {
    city, startDate, endDate, dayCount, spotCount,
    days: [{
      visitDate, dayNumber,
      items: [{ spotId, spotName }]
    }]
  }
}
失败：1042。无效、停止、过期、行程删除与无行程项统一使用该错误。
```

安全约束：

- 公开投影是白名单，不得包含 `userId/openId/tripId/itemId/shareToken/releaseAt/result/ticketState/reminder`。
- `ownerNickname` 只用于主人侧会话分享标题，只出现在 `tripShare.create/status`；不属于公开只读投影。
- `trips` 文档内字段：`shareToken/shareCreatedAt/shareUpdatedAt`。普通 `trip.list` 和 `home.bootstrap` 只返回 `shareActive`。
- 行程同城合并时，有效令牌迁到存续行程；多个候选冲突时保留存续行程自身令牌，否则取确定的首个候选。被合并或删除的行程旧令牌失效。

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
    releaseAt: "2026-05-25T12:00:00.000Z", // 放票时刻（Date）；免预约/无固定放票时刻为 null
    releaseDateStr: "2026-05-25",
    releaseTimeStr: "20:00",           // 无固定放票时刻为「随买随用」
    releaseTimesStr: "08:00、17:00、20:00", // 同日全部时段，供多时段景点展示
    releaseSlots: [{                   // 一个事件对应多个待建任务时返回完整时段
      key: "junbo-0800",
      label: "第1场",
      releaseTime: "08:00",
      advanceDays: 7,
      releaseDateStr: "2026-05-25",
      releaseAt: "2026-05-24T16:00:00.000Z"
    }],
    reminderTaskCount: 3,              // 当前时刻起仍可创建的提醒任务数
    visitDateLabel: "6月1日 (周一)",    // 已格式化
    advanceDays: 7,
    releaseState: "RELEASED",          // NOT_RELEASED / RELEASED / NO_RESERVATION / NO_FIXED_RELEASE
    releaseStateLabel: "已开票",       // 待开票 / 已开票 / 无需预约 / 随买随用
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
  closedSpots: [{                      // 行程内全闭馆、段内没有可用出行日的景点（⚠️ 页面已不渲染，见下方注）
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
| SELECTABLE | 加入清单（免预约或无固定放票时刻项「加入行程」） | true | `cart.add` |
| IN_CART | 已加清单（免预约或无固定放票时刻项「已加入清单」） | true | 打开 PAGE-007 (button.openCart=true) |
| COMMITTED | 已加行程 | false | 无（纯状态标签） |

⚠️（2026-09-24）文案统一为「清单」并去掉全部图标，对齐 `UI/V.0.2-0919首页行程化改版-UI/32.png`：旧值 `+ 添加提醒` → `加入清单`、`已加待选` → `已加清单`、`已在行程` → `已加行程`。
⚠️ `enabled` 表达的是**能不能点**，不是**看起来像不像按钮**：`IN_CART` 为 true（点它打开清单弹层），UI 上却是中性色状态胶囊。别为了「看着像状态」把它改成 false。
⚠️（2026-09-25）时间线不再返回 `WAITING / REMINDERED / BOOKABLE / FULL`。`releaseAt ≤ now` 只把顶部 `releaseStateLabel` 变为「已开票」并渲染绿色文字，按钮仍是 `SELECTABLE → 加入清单`；已开票项入清单后固定 `remindOn=false`、`remindLocked=true`，清单行显示「仅加行程·不提醒」且不可修改。无固定放票时刻项同样固定不提醒，但它是可正常加入行程的候选项。预约入口只保留在首页行程项和推送详情。

---

### 2.3 清单域（cart.*）

#### `cart.add` — 加入清单（单条）

```
用途：PAGE-005/006（首页内联）事件卡「加入清单 / 加入行程」
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
// remindOn：放票前按用户选择/强弱默认；免预约、无固定放票时刻、放票时刻已过时由服务端强制 false
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
  addedReminders: 2,                   // 其中真正进入提醒流程的项数
  addedTripOnly: 1,                    // 已过放票/无固定时刻等仅行程项数
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
调用：{ action: 'cart.clear', tripId: 'abc123' }  // 不传 tripId 则清空当前暂存清单
```

#### `cart.list` — 列出清单

```
用途：PAGE-007 主数据 + PAGE-005/006（首页内联）底部清单条
调用：{
  action: 'cart.list',
  tripId: 'abc123',          // 不传则查当前暂存清单
  includeMembership: false   // PAGE-008 传 true，顺带返回会员额度；其他页面不传，避免额外读
}
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
    weak: false,                       // 需预约、difficultyScore≤2 且 strongReminder!==true
    visitDate: "2026-06-01",
    releaseAt: "2026-05-25T12:00:00.000Z",
    releaseSlots: [{ key, label, releaseTime, advanceDays, releaseDateStr, releaseAt }],
    releaseTaskCount: 1,                // 当前清华、军博每个日期实际只创建 1 条任务
    releaseDateLabel: "05月25日",
    releaseTimeLabel: "20:00",
    remindOn: true,                     // 已开票项恒为 false
    noFixedRelease: false,              // true = 需预约但没有固定放票时刻，仅加入行程
    remindLocked: false,                // true = 已开票或无固定放票时刻，提醒固定为「仅加行程·不提醒」
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
    reminderTaskCount: 4,              // 按放票时段展开后的真实任务数；授权/名额按此计算
    noReminderCount: 1,
    text: "已选 3 项，其中 2 个将设提醒"
  },
  membership: null              // includeMembership=true 时为 membership.status 同口径快照
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
  created: 1,                          // 创建任务数（当前每个可提醒清单项只创建 1 条）
  tasks: [{                            // 创建的任务列表
    _id: "...",
    tripId: "abc123",
    spotId: "gugong",
    visitDate: "2026-06-01",
    releaseAt: "...",
    releaseKey: "junbo-0800",          // 对应规则时段；旧任务可缺省
    releaseLabel: "第1场",
    releaseTime: "08:00",
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
调用：{ action: 'user.profile', membershipCapabilities: ['unlimited-v3'] }
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
    memberLevel: "NORMAL",
    memberSince: null,
    memberExpiresAt: null,
    taskPackCount: 0,
    taskPackSlots: 0,
    points: 0,
    membership: {
      member: false,
      memberExpiresAtText: "",
      planVersion: "legacy-v2",
      taskLimitUnlimited: false,
      taskLimit: 5,
      taskUsed: 2,
      taskRemaining: 3,
      ownedTaskPackCount: 0,
      ownedTaskPackSlots: 0
    },
    membershipSales: {
      state: "OPEN",
      purchaseEnabled: true,
      message: ""
    }
  },
  membershipUpgradeNotice: {
    id: "membership-unlimited-upgrade",
    endsAt: "2026-11-07T12:00:00.000Z"
  } // 可选；仅公告前已开通的 unlimited-v3 白名单有效会员且公告有效时返回
}
```

- `membershipSales` 与 `membership.status.sales` 同口径，供 PAGE-010 在不增加额外请求时把“开通/升级”降级为“查看”；不能由客户端自行推断。
- `membershipUpgradeNotice` 只用于“我的”页临时一次性横幅，且只面向公告开始前已成为会员的当前有效会员。服务端比较 `users.memberSince < payment_config.membership_upgrade_notice.startsAt`；公告上线后新开通、缺少 `memberSince`、免费、`legacy-v2`、非白名单、公告停用或过期时字段整体省略，不返回 `null` 占位。

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

`wx.requestSubscribeMessage` 每次授权 = 可发 1 条订阅消息。额度按模板存入 `users.subscribeQuotas[templateId]`，同时维护旧字段 `users.subscribeQuota` 作为总数；授权成功 +1、notifier 发送成功 -1、微信返回 `43101` 时对应模板清零。发送侧兼容旧「活动开始通知」与新「预约开始提醒」两个模板：任务有 `templateId` 时按其发送，旧任务没有该字段时回退旧模板；额度也按任务实际模板核销。后续可直接扩展更多模板。

> ⚠️ 微信限制：一次用户点击只能触发一次同模板授权申请，最多增加 1 条额度。“总是保持以上选择”只免去后续弹窗，不允许在一次点击后的异步链里连续申请 N 条；客户端必须按“一次点击 → 最多 +1”展示和上报缺口。
> ⚠️ 客户端 `wx.requestSubscribeMessage` 返回 `20001`（`No template data return, verify the template id exist`）时，表示当前 AppID 查不到该模板：优先核对模板 ID 逐字符一致，以及模板是否创建在当前小程序 AppID 下。该错误发生在 `subscribe.add` 之前，不要误判为双模板发送分流或额度台账问题。

**`subscribe.add`**（用户授权后前端调用，云端按当前 openid 记 +1）：

```
调用：{ action: 'subscribe.add', templateId? }
```

**返回：**

```javascript
{ success: true, quota: 3, totalQuota: 3, quotas: { "_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA": 3 }, templateId: "_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA" }
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
  quotas: { "_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA": 3 },
  templateId: "_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA",
  pendingMessageCount: 4,      // 未来 WAITING 任务中尚未发送的 offset 总数
  nearestRemindAt: "2026-09-27T...",
  level: "short",              // idle | ready | low | short | exhausted
  shortfall: 1,                // max(0, pendingMessageCount - quota)
  replenishNeeded: 2           // 补到 pendingMessageCount + 1 缓冲的目标次数；客户端仍需一次点击补 1 条
}
```

> 未授权/未落库时 quota 为 0，发送侧仍会尝试（微信侧按真实授权校验，返回 43101 即表示无额度/未订阅）。
> 客户端判断新提醒能否设置时使用 `availableQuota = max(0, quota - pendingMessageCount)`；`quota` 是台账剩余总量，不是可再次分配的数量。

> 客户端在设置新提醒前必须按**可用额度**判断：`quota - pendingMessageCount`。`quota` 是本地台账剩余授权总数，`pendingMessageCount` 是未来 `WAITING` 任务尚未发送的消息数（每条任务每个未发送 offset 计 1）。只看 `quota` 会把已经预留给待发送提醒的次数重复承诺给新提醒。

### 2.6 会员、提醒名额、支付与售后（2026-11-08）

唯一额度口径在 `cloudfunctions/reminder/lib/membership.js`，唯一支付/退款状态机在 `cloudfunctions/payment/lib/order.js` 与 `cloudfunctions/payment/lib/after-sales.js`。客户端只消费服务端返回的额度、价格、有效期、退款资格和可执行动作。

- 用户侧统一使用「提醒名额」。免费版 5 个。现有 `unlimited-v3` 契约保持 `¥6 / 30 天 / 不限`；候选 `two-tier-v5` 为 `member_quota_10`（¥3 / 30 天 / 总额度 10）和 `member_unlimited`（¥4.9 / 30 天 / 不限）。每条微信订阅消息仍需按条授权，不自动续费。
- 方案路由顺序固定：先判断 `two-tier-v5`，再判断现有 `unlimited-v3`，最后回退 `legacy-v2`。`two-tier-v5` 必须声明能力；`membership_pricing=test` 时还要求 OpenID 命中 `MEMBERSHIP_TEST_OPENIDS`，`all` 时对新客户端全量开放。该判定不受额度模式 `all` 影响；未命中且声明 `unlimited-v3` 的客户端继续当前 ¥6 契约，旧客户端仍返回旧价格、旧额度和旧加量包。
- 3 元档超过 10 个时只允许 `member_unlimited_upgrade` 补 ¥1.9 升级；订单保存 `upgradeExpiresAt`，只换档、不增加会员时长。剩余不足 15 分钟时服务端拒绝创单。升级单是 3 元会员单的子权益，有有效升级单时先退主会员单返回 `1034`。
- 外部平台强制先退 3 元会员单时，退款状态机必须把仍有效且绑定本单的升级单转为一次性升级权益券，不能留下“无会员但升级包有效”的非法状态。权益券只允许绑定下一笔 `member_quota_10` 订单；该 3 元订单支付后直接发放 `UNLIMITED`，不再另收 ¥1.9。3 元订单退款时恢复权益券。已转权益券的 1.9 元订单不再进入普通售后；若平台仍强制退款该升级单，权益券原地转为 `REVOKED`，已拉起支付的 3 元单按普通 `QUOTA_10` 发放。
- 当前有效老会员自动获得不限权益，`memberExpiresAt` 不变。`two-tier-v5` 旧会员没有 `memberTier` 时按 `LEGACY_UNLIMITED` 保护，到期后才恢复两档价格。历史 `taskPackCount/taskPackSlots` 继续按订单/用户账本兼容。
- 老用户保护池与新增池彼此独立：任务创建时若用户尚未进入会员限制（`off`，或 `test` 模式下不在白名单），任务进入历史保护池；只有 `test` 白名单或 `all` 模式下新建的任务进入免费/会员新增池。无 `quotaPool` 字段的旧任务一律兼容为保护池。`taskLimit / taskUsed / taskRemaining` 只描述新增池，`protectedTaskUsed` 单独返回保护池占用。
- `reminder` 的会员限制运行期唯一真身为 `payment_config/membership_enforcement`，文档字段 `mode=off|test|all`。管理端切换后立即影响新任务；已有任务继续按原 `quotaPool` 计数。`MEMBERSHIP_ENFORCEMENT_MODE` 只在配置缺失、非法或读取失败时兜底，`MEMBERSHIP_TEST_OPENIDS` 继续控制 `test` 白名单。
- 两档定价运行期唯一真身为 `payment_config/membership_pricing`，`mode=test|all`。`test` 只对 `MEMBERSHIP_TEST_OPENIDS` 且声明 `two-tier-v5` 的客户端开放；`all` 对所有声明 `two-tier-v5` 的新客户端开放。配置缺失、非法或读取失败时安全回退 `test`，不得影响 `membership_enforcement` 的额度模式。
- 切 `all` 前服务端必须同时确认保护额度迁移和权益账本迁移完成标记；任一缺失返回 `1033`，不得写入新模式。
- 会员购买开关独立于会员限制灰度。唯一真身是 `payment_config/membership_sales`；`state=OPEN|PAUSED`。暂停后 `membership.createOrder` 与待支付订单的 `payment.create` 返回 `1032`，但 `payment.query`、支付回调、权益发放、退款和售后继续执行。配置读取失败时新购买按暂停处理。
- 支付成功唯一依据是服务端取得微信支付 `trade_state=SUCCESS`；`wx.requestPayment.success` 只代表客户端流程结束。
- 主订单状态固定 `PENDING / PAID / CLOSED`；退款生命周期独立存于 `refundStatus`，不混入主状态。

#### `membership.status`

```javascript
调用：{ action: 'membership.status', membershipCapabilities: ['unlimited-v3', 'two-tier-v5'] }
返回：{
  success: true,
  enforced: Boolean, // 当前 OpenID 是否受提醒名额限制
  sales: {
    state: 'OPEN' | 'PAUSED',
    purchaseEnabled: Boolean,
    message: String
  },
  membership: {
    member: Boolean,
    memberLevel: 'NORMAL' | 'MEMBER',
    memberTier: '' | 'QUOTA_10' | 'UNLIMITED' | 'LEGACY_UNLIMITED',
    memberExpiresAt: Date | null,
    memberExpiresAtText: '2026年11月26日' | '',
    memberDaysRemaining: Number,
    planVersion: 'legacy-v2' | 'unlimited-v3' | 'two-tier-v5',
    unlimited: Boolean,
    pricingVisible: Boolean,
    upgradeAvailable: Boolean,
    upgradeShortWindow: Boolean,
    upgradeWindowClosed: Boolean,
    upgradeCreditAvailable: Boolean,
    upgradeCreditPending: Boolean,
    upgradeCreditText: String,
    upgradeCreditSourceOrderId: String,
    upgradeCreditPendingOrderId: String,
    taskLimitUnlimited: Boolean, // true 时客户端必须按不限展示并跳过名额拦截
    taskLimit: Number | null,
    taskUsed: Number,
    taskRemaining: Number | null,
    entitlementTaskLimit: Number | null,
    protectedTaskQuota: Number,
    protectedTaskUsed: Number,
    entitlementTaskUsed: Number,
    taskPackCount: Number,
    taskPackSlots: Number,
    ownedTaskPackCount: Number,
    ownedTaskPackSlots: Number,
    memberDurationDays: Number,
    freeTaskSlots: 5,
    memberTaskSlots: Number, // two-tier-v5 为 10；unlimited-v3 为兼容投影 10000；legacy-v2 为 15
    taskPackSize: Number // 候选两档为 0；legacy-v2 为 10
  },
  packages: [{
    id: 'member' | 'task_pack_5' | 'member_quota_10' | 'member_unlimited' | 'member_unlimited_upgrade',
    type: 'MEMBER' | 'TASK_PACK',
    title, priceFen, priceText, description,
    membershipTier, unlimited, upgrade, upgradeCreditApplied,
    unlimitedReminders, memberDays, addedSlots, specVersion, available, actionText
  }]
}
```

- 停售期间套餐仍可展示价格和权益，但 `available=false`；客户端不得从 `sales.state` 自行推导订单或权益状态。
- `unlimited-v3` 有效会员继续返回 `taskLimit/taskRemaining/memberTaskSlots=10000` 兼容投影，额度判断先读 `taskLimitUnlimited=true`。`two-tier-v5` 的不限会员返回 `taskLimit/taskRemaining=null`、`pricingVisible=false`、`packages=[]`；3 元档返回 `memberTier=QUOTA_10` 且只带升级包。`legacy-v2` 保持旧 `15 + 加量包` 契约。
- 存在可用升级权益券且当前不是会员时，`packages` 只返回 `member_quota_10`，并标记 `upgradeCreditApplied=true`；此时禁止直接购买 `member_unlimited`。权益券被待支付订单预留时 `upgradeCreditPending=true`，`upgradeCreditPendingOrderId` 指向占用订单。

#### `membership.createOrder`

```javascript
调用：{
  action: 'membership.createOrder',
  packageId: 'member' | 'task_pack_5' | 'member_quota_10' | 'member_unlimited' | 'member_unlimited_upgrade',
  requestId: String,
  membershipCapabilities: ['unlimited-v3', 'two-tier-v5']
}
返回：{
  success: true,
  orderId, outTradeNo, amountFen, packageId, productType,
  specVersion, addedSlots, unlimitedReminders, memberDays, title,
  planVersion, membershipTier, unlimited, upgrade, upgradeExpiresAt,
  upgradeCreditApplied, upgradeCreditId,
  reused?: true
}
```

- 金额、商品类型和权益只从服务端套餐表读取，客户端不能传价格。
- `requestId` 必填，8-80 位，只允许字母、数字、下划线和短横线。服务端用 `OpenID + requestId` 生成确定性订单 ID；同一请求重试返回同一订单，同一 `requestId` 改商品或规格必须拒绝。
- `two-tier-v5` 三个订单规格固定为：`member_quota_10` 300 分 / 30 天 / `QUOTA_10`；`member_unlimited` 490 分 / 30 天 / `UNLIMITED`；`member_unlimited_upgrade` 190 分 / 0 天 / 升级并冻结 `upgradeExpiresAt`。非白名单或未声明能力继续按 `unlimited-v3` / `legacy-v2` 原契约下单。
- 使用升级权益券创建 3 元订单时，订单固化 `upgradeCreditApplied=true` 与 `upgradeCreditId`，并在创建后预留该券；关单释放预留，支付时原子消费。同一权益券只能被一笔有效待支付或已支付订单占用。
- 只有 `productType + specVersion + addedSlots + unlimitedReminders + memberDays + amountFen` 以及 `two-tier-v5` 的 `planVersion + membershipTier + unlimited + upgrade + upgradeExpiresAt` 全部一致且未过期的 `PENDING` 订单才可复用；旧规格订单只按 `status=PENDING` 条件关闭，不能覆盖并发回调已经置为 `PAID` 的订单。
- 新会员订单权益快照保存 `beforeTier / afterTier / beforeTierOrderId / memberDaysAddedMs`；升级单保持原到期时间并为 `memberDaysAddedMs=0`。历史会员订单和加量包缺少新字段时继续按原订单快照兼容，不回写历史金额或权益。
- 提醒名额不足统一返回错误码 `1026`，携带 `taskLimit`、`membership` 和 `packages`；失败时不得创建行程、任务或清空清单。
- 会员购买暂停时返回 `1032` 和 `sales`，不得创建订单。停售只阻止新交易，不得关闭、删除或回收既有订单和权益。

#### `membership.orders`

```javascript
调用：{ action: 'membership.orders' }
返回：{
  success: true,
  count: 2,
  sales: { state, purchaseEnabled, message },
  items: [{
    _id, outTradeNo, packageId, productType, title,
    amountFen, amountText, addedSlots, unlimitedReminders, memberDays,
    status: 'PENDING' | 'PAID' | 'CLOSED' | 'REFUNDED', // REFUNDED 仅兼容历史数据
    statusLabel,
    refundStatus: 'NONE' | 'REQUESTED' | 'UNDER_REVIEW' | 'PROCESSING' | 'REFUNDED' | 'REJECTED' | 'FAILED',
    refundStatusLabel, refundAmountFen, refundedAtText,
    paymentChannel: 'APPLE' | 'WECHAT_VIRTUAL' | 'WECHAT_PAY',
    grantStatus: 'NONE' | 'GRANTED' | 'FAILED' | 'REVERTED',
    entitlementStatus: 'PENDING' | 'PAID_GRANT_UNKNOWN' | 'PAID_GRANTED' | 'PAID_GRANT_FAILED' | 'CLOSED' | 'REFUNDED' | 'CREDITED',
    upgradeCreditApplied: Boolean,
    upgradeCreditId: String,
    entitlementGrant: {
      beforeExpiresAt, afterExpiresAt, memberDaysAddedMs,
      taskPackDelta, taskPackCountAdded, taskPackSlotsAdded, unlimitedReminders,
      specVersion, upgradeCreditApplied, upgradeCreditId,
      creditConverted, creditId, appliedAt, revertedAt
    } | null,
    canRequestRefund: Boolean,
    refundEligibility: {
      withinWindow, usedAfterPurchase, alreadyRefunded, refundInProgress,
      hoursSincePaid, eligible, convertedToCredit
    },
    isExpired: Boolean,
    actions: [{ key: 'PAY' | 'CANCEL' | 'SYNC' | 'AFTER_SALES' | 'REBUY', label }],
    actionFlags: { canPay, canCancel, canSync, canAfterSales, canRebuy, afterSalesLabel },
    createdAt, createdAtText, expiresAt, paidAt, paidAtText
  }]
}
```

- 只允许查询当前 OpenID 的订单，最多 50 条，按 `createdAt` 倒序。
- `sales.purchaseEnabled=false` 时，待支付订单的 `canPay/canRebuy=false`，`canCancel/canSync/canAfterSales` 保持按订单状态计算。
- 不返回 `paymentResult`、微信交易号、密钥或其他支付内部字段。
- `paymentChannel` 由服务端根据订单固化的 `paymentProvider` 和虚拟支付 `channelOrderType` 派生；iOS Apple 内购为 `APPLE`，安卓虚拟支付为 `WECHAT_VIRTUAL`，旧微信支付为 `WECHAT_PAY`。客户端不得用当前设备平台推断历史订单渠道。
- 退款资格以 `users.lastReminderCreatedAt` 为主，并从 `reminder_tasks.createdAt` 复核；提醒创建后即使被删除仍算已使用。

#### `membership.orderDetail`

```javascript
调用：{ action: 'membership.orderDetail', orderId }
返回：{ success: true, item: { ...与 membership.orders 单条同构 } }
```

- 只允许读取当前 OpenID 本人订单；不存在或不属于本人统一返回 `1024`，避免泄露订单归属。
- 详情页和售后申请页使用单笔接口，不再由客户端拉取最近 50 条后自行筛选。

#### `payment.create` / `payment.query` / `payment.cancel`

```javascript
{ action: 'create', orderId, loginCode?, clientSupportsVirtualPay? } // 已支付订单返回已发放状态；新版虚拟支付客户端传 true 和 wx.login 一次性 code
{ action: 'query', orderId }  // 主动查单并返回 entitlementStatus
{ action: 'cancel', orderId } // 先查单；API v3 在确认未支付后向微信关单，虚拟支付无外部关单 API 时只关闭本地订单
```

- `payment.create` 只有在待支付订单准备发起新支付时才读取会员购买开关。`state=PAUSED` 返回 `1032`；已经进入微信/Apple 支付窗口后完成的支付、支付回调、`payment.query` 和权益补偿不受阻断。

```javascript
返回：{
  success: true,
  orderId,
  status: 'PENDING' | 'PAID' | 'CLOSED',
  entitlementStatus: 'PENDING' | 'PAID_GRANT_UNKNOWN' | 'PAID_GRANTED' | 'PAID_GRANT_FAILED' | 'CLOSED' | 'REFUNDED',
  refundStatus,
  isExpired,
  memberExpiresAt,
  taskPackCount,
  taskPackSlots,
  unlimitedReminders,
  paymentProvider?: 'WECHAT_PAY_V3' | 'VIRTUAL_PAY',
  payment?: Object, // API v3：wx.requestPayment 参数
  virtualPayment?: Object, // 虚拟支付：mode/signData/paySig/signature
  expiresAt?: Date
}
```

- 支付协议保留两条并行通道：缺省为微信支付 **API v3 直连**；只有云函数设置 `PAYMENT_PROVIDER=VIRTUAL_PAY` 才使用小程序虚拟支付。历史订单按订单保存的渠道继续查单和退款。
- 虚拟支付还要求客户端在 `payment.create` 显式传 `clientSupportsVirtualPay: true`。未传该字段的旧版客户端继续走 API v3，避免小程序发布过渡期因云端切流导致旧版本无法拉起支付；该字段只决定支付渠道，不参与权益判定。
- 渠道与环境按订单固化：API v3 在首次拉起支付前保存 `paymentProvider=WECHAT_PAY_V3`；虚拟支付保存 `paymentProvider=VIRTUAL_PAY`、`virtualEnv` 和 `virtualProductId`。历史订单不会因后续切换 `PAYMENT_PROVIDER` 或 `WECHAT_VIRTUAL_PAY_ENV` 而改用另一渠道/AppKey。
- API v3 不调用 `cloud.cloudPay`，也不要求把商户号授权给云开发服务商。虚拟支付在 MP 后台开通独立商户号，使用 `offerId`、环境 AppKey 和已发布固定道具。
- 虚拟支付的 `/xpay/query_order` 不返回 `productId` 或 `buyQuantity`，服务端不得伪造这两项校验。下单签名前必须校验订单 SKU 与服务端套餐、金额和道具配置；发放前必须再次校验订单保存的 `virtualProductId`。查单结果或 `biz_meta` 可用时，再核对版本化附加标识；缺失 `biz_meta` 不能单独判失败，但商品快照缺失或不一致必须停止自动发权益并转人工核验。
- 虚拟支付客户端调用 `wx.requestVirtualPayment`，服务端只返回 `mode: short_series_goods`、`signData`、`paySig`、`signature`；用户 `session_key` 只能由服务端用 `wx.login` code 换取，不能落库或下发客户端。
- 下单、查单、关单、退款和退款查询的微信响应都必须校验签名；验签失败不得使用响应内容。
- API v3 支付回调与退款回调分别由 CloudBase HTTP 网关 `/payment/notify`、`/payment/refund-notify` 转发到 `payment` 云函数。
- 回调先校验 `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Signature`、`Wechatpay-Serial`，再用 APIv3 密钥解密 `resource`；原始 body 必须原样参与验签。
- AppID、商户号、订单号、金额、交易状态和资源解密结果任一不匹配都不得发放权益。
- 虚拟支付通过云开发消息推送进入 `payment`：`xpay_goods_deliver_notify`、`xpay_refund_notify`、`xpay_subscribe_ios_refund_query_notify`。发货和退款必须先调用 `/xpay/query_order` 复核订单、环境、实付金额和退款结果；商品身份以服务端订单 SKU 和固化的 `virtualProductId` 为准，不能用查单响应中不存在的商品字段假装校验。
- `xpay_subscribe_ios_refund_query_notify` 仅是 Apple 退款问询，不是最终结果，不得据此创建退款售后记录。服务端收到 `xpay_refund_notify` 并查单确认后，若该退款单尚无售后记录，自动补建一条 `reasonCode=PLATFORM_REFUND_NOTIFY`、`systemGenerated=true` 的售后记录；记录按退款单号幂等，重复推送不新增第二条。
- 虚拟支付成功回包为 `{ ErrCode: 0, ErrMsg: 'success' }`；iOS 退款问询额外返回 `IosRefundQueryResponse`，必须在 3 秒内完成。Apple 支付不支持沙箱，用户需 iOS 15+、微信 8.0.68+，退款由用户在 App Store 发起。
- 金额不一致拒绝发放；重复回调幂等，不重复增加会员时长或权益。退款完成后的重复支付回调也不得重新发放权益。
- 15 分钟未支付订单自动关闭；2 分钟定时任务主动查单、重试权益发放、自动核验售后和同步退款结果。补偿使用 `payment_reconcile_state` 中 `failedGrants / pendingPayments / refundProcessing / autoChecking` 四条独立游标，每队列最多 50 条、10 秒，单次总预算 45 秒；游标到尾部后回到队首，不能固定只处理前 100 条。
- API v3 环境变量：`WECHAT_PAY_MCH_ID`、`WECHAT_PAY_SERIAL_NO`、`WECHAT_PAY_PRIVATE_KEY`、`WECHAT_PAY_API_V3_KEY`、`WECHAT_PAY_NOTIFY_URL`、`WECHAT_PAY_REFUND_NOTIFY_URL`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID`；`WECHAT_PAY_PLATFORM_CERT` / `WECHAT_PAY_PLATFORM_CERT_SERIAL` 只作旧平台证书兼容，不能与公钥模式隐式混用。`AFTER_SALES_ADMIN_OPENIDS` 为售后管理员白名单。
- 虚拟支付环境变量：`PAYMENT_PROVIDER=VIRTUAL_PAY`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_VIRTUAL_PAY_ENV`、`WECHAT_VIRTUAL_PAY_OFFER_ID`、`WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY`、`WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY`、`WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER`、`WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED_V6`、`WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED`、`WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK`。`..._V6` 只用于当前 600 分新订单，`..._UNLIMITED` 保留给历史 800 分订单。

#### 支付与退款回调

- 验签失败返回 401；订单或售后记录不存在、内部事务失败返回 5xx，让微信继续重试。
- 支付回调只在订单和权益事务提交成功后返回 200。
- 退款回调只在退款状态更新和权益快照回收成功后返回 200；重复回调幂等。
- 日志只记录路由、`outTradeNo` / `outRefundNo`、公钥 ID、时间戳、原始 body SHA-256、验签结果和失败原因；不记录私钥、APIv3 密钥或完整签名。

#### `payment.afterSales.*`（用户）

```javascript
{ action: 'afterSales.submit', orderId, type, requestId, reasonCode?, description? }
{ action: 'afterSales.cancel', caseId }
{ action: 'afterSales.list' }
{ action: 'afterSales.detail', caseId }
{ action: 'afterSales.syncRights', orderId }
```

- 有有效升级单且退款会移除当前会员时，`afterSales.submit` 在创建售后前返回 `1034` 和 `dependentUpgradeOrderId`；客服批准退款前再次执行同一服务端拦截，不能只依赖页面按钮。
- `entitlementGrant.creditConverted=true` 的升级单不进入普通售后；直接调用接口返回 `1029`。平台强制退款仍通过退款状态机把权益券置为 `REVOKED`，不能只依赖客户端隐藏按钮。

- `type`: `RIGHTS_NOT_RECEIVED | DUPLICATE_CHARGE | UNUSED_REFUND | ENTITLEMENT_MISMATCH | OTHER`。
- `requestId` 必填，8-80 位，只允许字母、数字、下划线和短横线。同一用户、订单和 `requestId` 的重试返回同一售后单；同一订单事务内只允许一条活动售后，终态后清空订单的 `activeAfterSalesCaseId`。
- `RIGHTS_NOT_RECEIVED` 先自动查单并补发；补发成功直接返回 `resolved=true`，不创建无意义售后单。
- `DUPLICATE_CHARGE` 先核验同用户、同商品、10 分钟内重复支付；证据明确且未新增提醒时自动发起较新订单的全额退款，否则转客服审核。
- 重复支付识别只纳入 `PAID + GRANTED` 且未退款、未回收的有效权益订单。退款失败、退款驳回但仍有效的订单继续计入；已退款或已回收订单不得再次触发重复支付。
- `UNUSED_REFUND` 仅在支付后 24 小时内且支付后未新增任何提醒时可提交，进入客服审核。
- 已使用、超过 24 小时、权益正常或无正当理由的申请原则上驳回；每个订单最多一次全额退款，V1 不做部分退款。
- 售后状态：`SUBMITTED | AUTO_CHECKING | UNDER_REVIEW | APPROVED | PROCESSING | REFUNDED | REJECTED | REFUND_FAILED | CANCELLED | RESOLVED | CLOSED`。
- 用户可取消 `SUBMITTED`、`AUTO_CHECKING`、`UNDER_REVIEW`、`APPROVED` 和尚未实际发起退款的 `REFUND_FAILED` 售后。`PROCESSING`、`REFUNDED` 等已进入退款处理的状态不可取消。
- 取消成功后售后单进入 `CANCELLED` 终态，记录 `cancelledAt/cancelledBy=USER`；仅当订单活动售后指向该单时清空 `activeAfterSalesCaseId`，订单 `refundStatus` 恢复为 `NONE`，不回收权益，用户可重新申请。
- 取消 `REFUND_FAILED` 前必须按订单固化支付渠道查询远端退款单。只有明确返回退款单不存在时才允许取消；远端已有退款记录、查询超时、网络错误或配置缺失时失败关闭，保持异常状态，避免与管理员重试退款竞争。

#### `payment.afterSales.admin*`（管理员）

```javascript
{ action: 'afterSales.adminStatus' }
{ action: 'afterSales.adminSetMembershipSales', state: 'OPEN' | 'PAUSED', reason }
{ action: 'afterSales.adminSetMembershipEnforcement', mode: 'off' | 'test' | 'all' }
{ action: 'afterSales.adminSetMembershipPricing', mode: 'test' | 'all' }
{ action: 'afterSales.adminSetMembershipUpgradeNotice', enabled: Boolean }
{ action: 'afterSales.adminList', status?, keyword?, page?, pageSize? }
{ action: 'afterSales.adminDetail', caseId }
{ action: 'afterSales.adminApproveRefund', caseId }
{ action: 'afterSales.adminReject', caseId, decisionNote }
{ action: 'afterSales.adminSyncPayment', caseId }
{ action: 'afterSales.adminRetryGrant', caseId }
{ action: 'afterSales.adminSyncRefund', caseId }
{ action: 'afterSales.adminMigrateProtection', cursor? }
{ action: 'afterSales.adminMigrateEntitlementLedger', cursor?, dryRun? }
{ action: 'adminOrders.list', keyword?, status?, timeRange?, page?, pageSize? }
{ action: 'adminOrders.stats' }
{ action: 'adminReminderQuality.stats' }
{ action: 'adminOrders.detail', orderId }
```

- 仅 `AFTER_SALES_ADMIN_OPENIDS` 白名单可调用；未配置时工作台关闭，不存在代码内置兜底账号。
- `adminOrders.list` 返回订单、当前昵称、完整 OpenID、支付渠道、权益状态和关联售后摘要。`keyword` 支持商户订单号、订单 ID、完整 OpenID、售后单号和昵称；只有昵称允许部分匹配。`timeRange=7d|30d|90d|all` 按北京时间自然日过滤订单创建时间，缺省或非法值按 `30d`；时间范围在数据库查询阶段生效，同时作用于搜索、状态筛选和分页。分页参数默认 `page=1&pageSize=20`，单页最大 50。
- `adminOrders.stats` 返回北京时间当日的 `{ dateKey, totalOrders, paidOrders, paidAmountFen, paidAmountText, refundedOrders, refundedAmountFen, refundedAmountText, netAmountFen, netAmountText }`。`totalOrders` 统计当日创建的全部订单；`paidOrders / paidAmountFen` 统计这些订单中已写入 `paidAt` 的订单及支付金额；`refundedOrders` 统计这些已支付订单中退款已完成的数量；`refundedAmountFen` 只汇总已完成退款，优先读取 `refundedAmountFen`，历史单缺失时按订单金额；`netAmountFen = paidAmountFen - refundedAmountFen`。统计独立于列表搜索和筛选。
- `adminReminderQuality.stats` 返回：
  ```javascript
  {
    pending: false,
    stale: false,
    expectedWindowKey: "2026-11-02T05:00:00.000Z",
    snapshot: {
      windowKey: "2026-11-02T05:00:00.000Z",
      generatedAt: "2026-11-02T05:02:00.000Z"
    },
    quality: {
      timezone: 'Asia/Shanghai',
      threshold: { onTimeRate: 99, delayToleranceSeconds: 120 },
      currentWindow: {
        startAt, endAt, nextUpdateAt, label, updatedLabel, durationHours,
        expectedCount, onTimeCount, lateCount, missedCount,
        skippedCount, unknownCount, onTimeRate,
        status, reasonCodes
      },
      baseline5d: {
        startDate, endDate, daysWithData, expectedCount,
        onTimeRate
      },
      dataTruncated,
      generatedAt
    }
  }
  ```
- `pending=true` 表示当前统计窗口的快照尚未由定时器写入。首次部署或新窗口尚未生成时 `quality=null`、`snapshot=null`；已有旧窗口快照时仍返回 `quality`，同时 `pending=true`、`stale=true`，让工作台保留上一份可用数据而不是清空或重新扫表。`expectedWindowKey` 是当前应读取的 `currentWindow.endAt`。
- 质量快照由现有 `paymentReconcileEveryTwoMinutes` 定时器负责生成：北京时间 `13:00 / 21:00` 后的首个 tick 计算并写入 `payment_config/reminder_quality_latest`，同一 `windowKey` 且同一 `schemaVersion` 后续 tick 直接跳过重算。当前快照 schema 为 `2`：当前窗口与 5 日基线分开查询，避免基线占满行数上限后把当前窗口错误洗成“无数据”；旧 schema 的同窗口快照必须重算一次。工作台接口只读取该确定性文档，不读 `reminder_events`、`reminder_tasks`，不临时计算。首次快照上线前可能短暂返回 `pending=true`。
- 质量快照计算只读 `reminder_events` 与仍在保留期内的 `reminder_tasks`，按任务而不是发送尝试计数。优先使用逐 offset 的 `SEND_SUCCEEDED.scheduledAt/eventAt`；事件缺失时，已 `TRIGGERED` 且 `sentOffsets` 覆盖全部计划 offset 的任务可用 `triggeredAt` 与最后一次计划发送时间回退计算。一个任务的全部 offset 都在各自计划时间后 120 秒内发送成功，才算 `onTime`；多 offset 任务只要一项失败或证据不完整，整项不能计入准时。
- `currentWindow` 固定选择最近一个已完成的 8 小时时段：`13:00` 选择 `05:00-13:00`，`21:00` 选择 `13:00-21:00`；13 点前继续选择前一日 `13:00-21:00`。`nextUpdateAt` 是下一个北京时间 `13:00 / 21:00` 边界，页面在保持可见时据此刷新。
- `status` 只有三种业务结果：当前时段没有任务为 `EMPTY`；`currentWindow.onTimeRate < 99` 为 `ALERT`；其余为 `HEALTHY`。不再返回“关注”状态。未送达、跳过和证据缺失只通过计算送达率进入结果，不得在页面额外增加与阈值无关的红色条件。
- `baseline5d` 固定为昨日之前的 5 个北京时间自然日，不包含昨日；`onTimeRate` 按任务数加权，`daysWithData` 只计算存在到期任务的日期。昨日未送达数、P95 延迟、任务数和固定阈值均不进入页面展示契约。
- 响应只包含聚合值，不返回 OpenID、userId、taskId、单任务明细或错误原文。工作台读取接口不写库；快照由现有两分钟定时器写入，不新增第二套定时任务。部署含定时快照计算的 `payment` 前必须核验 `reminder_events.releaseAt` 与 `reminder_tasks.releaseAt` 索引。
- `adminOrders.detail` 返回本人订单管理详情，包括用户会员状态、支付渠道、微信交易号、权益发放快照和关联售后记录。订单不存在统一返回 `1024`。
- `afterSales.adminList` 的 `items[].user` 返回当前昵称、完整 OpenID、会员到期和已购名额；同样支持分页与关键词搜索。
- 管理员搜索订单写 `SEARCH_ADMIN_ORDERS`，搜索售后写 `SEARCH_ADMIN_AFTER_SALES`，查看订单详情写 `VIEW_ADMIN_ORDER_DETAIL`。审计只记录关键词类型和状态，不记录原始搜索词；订单详情审计只记录交易号是否存在，不记录交易号全文。
- `adminStatus` 返回 `{ isAdmin, migrationCompleted, entitlementMigrationCompleted, pendingCount, fundingBlockedCount, membershipSales, membershipEnforcement, membershipPricing, membershipUpgradeNotice }`。`pendingCount` 是未结束售后单数量，用户已取消的单不计入；`fundingBlockedCount` 是其中因商户基本账户余额不足而未能发起退款的数量；`membershipSales` 含当前购买状态、暂停原因、更新时间和配置读取失败标记；`membershipEnforcement` 返回当前额度限制模式；`membershipPricing` 返回当前两档定价范围、模式文案、说明、来源、更新时间和读取失败标记。非管理员不返回购买、限制、定价或公告配置。
- `membershipUpgradeNotice` 返回公告配置状态：`configured / enabled / active / noticeId / startsAt / endsAt / endsAtText / updatedAt / updatedBy / readError / statusLabel / description / actionText / toggleToEnabled / unavailable`。全局唯一真身为 `payment_config/membership_upgrade_notice`；`active` 同时校验开关和北京时间有效期。
- `adminSetMembershipSales` 仅管理员可调用。暂停时必须填写原因；恢复时清空暂停原因。切换写 `admin_audit_logs`，不得依赖客户端隐藏按钮。
- `adminSetMembershipEnforcement` 仅管理员可调用，只接受 `off / test / all`。切换写 `SET_MEMBERSHIP_ENFORCEMENT` 审计，记录前后模式；切 `all` 时两项迁移未完成返回 `1033`。配置文档缺失时提醒链路继续使用环境变量兜底，后台显式展示该来源，不猜测运行模式。
- `adminSetMembershipPricing` 仅管理员可调用，只接受 `test / all`。切换写 `SET_MEMBERSHIP_PRICING` 审计并立即失效服务端缓存；不写 `membership_enforcement`，不重算已有提醒任务。配置缺失或读取失败时默认只开放测试名单。
- `adminSetMembershipUpgradeNotice` 仅管理员可调用，写 `SET_MEMBERSHIP_UPGRADE_NOTICE` 审计。`enabled=false` 立即停止向白名单用户返回公告；重新开启且原截止时间已过时，默认从当前时间延长 72 小时。公告开关只影响“我的”页横幅，不影响会员权益、订单、退款或提醒任务。
- 管理员可从「全部」列表查看“用户已取消”、取消时间和取消前异常原因；取消单不显示同意退款、驳回或重试退款操作。
- 上线前迁移完成后正式工作台已关闭迁移入口；若未来重新开启，工作台可据 `migrationCompleted=true` 自动隐藏。
- `adminDetail` 返回订单、用户权益、支付渠道、支付查单结果、权益发放快照、支付后新增提醒数、重复支付证据和历史售后记录。系统自动补建的平台退款记录会返回 `systemGenerated=true`、退款单号和退款金额。
- 查看敏感信息、同步支付结果、补发权益、同意退款、驳回和同步退款均写 `admin_audit_logs`。
- 驳回必须填写用户可见原因。退款使用确定性 `outRefundNo`，网络重试不会重复退款；退款结果只认微信回调或主动退款查询。
- 发起退款返回余额不足时，售后单持久保存 `failureReason`、`failureCode=BASIC_ACCOUNT_INSUFFICIENT`、`fundingBlocked=true` 和 `fundingBlockedAt`。管理员补足基本账户后可在原售后单重新发起；重试开始或退款成功后清除阻断字段。不得把退款金额改成扣除手续费后的金额。
- 退款成功后按本订单 `entitlementGrant` 快照回收本单新增会员时长和权益，不影响其他订单，也不删除用户已有提醒；历史加量包继续按历史快照回收。
- 权益发放失败的订单收到退款结果时只记录订单和售后退款状态，不修改用户会员期限、包数或名额总数；只有确认曾成功发放的订单才允许按快照回收。
- `adminMigrateProtection` 按默认 `_id` 游标每批最多处理 50 位用户；最后一批完成后写入全局完成标记，之后重复调用返回 `alreadyCompleted=true` 且不再更新用户。迁移未完成前不得把会员限制切到 `all`。
- `adminMigrateEntitlementLedger` 同样按 `users._id` 每批最多 50 人。必须先以 `dryRun=true` 分批读取差异；正式迁移把历史包最低按 5 个、新包按订单快照累计到 `taskPackCount/taskPackSlots`。可确认的历史已发放订单标记 `legacyBackfill`，无法确认发放状态的订单标记人工核查并创建高优先级售后，不得自动重复发放。

---

## 3. notifier（提醒推送）

**云函数名：`notifier`**
**说明：** 定时触发器（每分钟一次），前端不直接调用。走**微信服务端 HTTP 接口**发送订阅消息（不依赖小程序端触发，定时触发可用）。

**环境变量（云函数配置）**：`WX_APPID`（小程序 AppID，缺省回退 `wx05c160a589b97d76`）、`WX_APPSECRET`（必填，小程序密钥）、`SUBSCRIBE_TEMPLATE_ID`（仅作为 `testSend` 的默认订阅模板 ID，缺省回退内置常量 `_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA`）。正常定时发送不从环境变量取模板：`reminder_tasks.templateId` 优先，旧任务缺省回退 `V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q`。

### `notifier.testSend` — 发送测试订阅消息（排查/验证通道）

```
调用：{ action: 'testSend', touser, miniprogramState?, lang?, data?, templateId? }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| touser | String | 是 | 已授权订阅该模板的 openid |
| miniprogramState | String | 否 | 默认 `formal`（正式版） |
| lang | String | 否 | 默认 `zh_CN` |
| data | Object | 否 | 不传用内置测试数据（thing1/time2/thing3/time5，对应「预约开始提醒」模板：预约门票/开始时间/温馨提示/预约日期） |
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
  items: [{
    _id, type, category, spotId, spotName, errorType, content, contact, status,
    replies: [{
      replyId, content, createdAt, updatedAt, edited
    }],
    adminReply, adminReplyAt,
    reward: {
      status: 'NONE' | 'GRANTED' | 'REVOKED',
      days, backfill, grantedAt, revokedAt, memberExpiresAt, updatedAt
    },
    createdAt
  }],
  rewardNotices: [{
    feedbackId, type, category, spotName, content,
    reward: { status, days, backfill, grantedAt, revokedAt, memberExpiresAt, updatedAt }
  }],
  asOf: Date
  // 按 createdAt 倒序，最多 50 条；status = OPEN 待处理 | PROCESSED 已处理 | IGNORED 已忽略
  // replies 是完整的管理员单向回复线程；edited=true 表示该条回复被修改过
  // adminReply / adminReplyAt 继续返回最新一条，供旧客户端兼容
  // rewardNotices 独立读取 users.feedbackSeenAt 之后的所有奖励、补发和撤回通知，不占最近 50 条反馈名额
  // asOf 是本次列表查询的已读水位快照；客户端用它调用 feedback.markSeen
  // 不返回 userId、createdBy、updatedBy 或 adminReplyBy（管理员 OpenID 属管理端信息）
}
```

### `feedback.entrySummary` — PAGE-010 入口统计

```
调用：{ action: 'feedback.entrySummary' }
```

**用途：** “我的”页渲染「反馈管理」按钮和「帮助与反馈」数字；PAGE-010-4「我的反馈」行复用同一个未读数。客户端用旧缓存先渲染，每次 `onShow` 后台刷新一次，不轮询。

**返回：**

```javascript
{
  success: true,
  isAdmin: true | false,
  handledUnreadCount: 3, // 管理员回复、改状态或奖励变化后，用户尚未查看的本人反馈数
  rewardUnreadCount: 1,  // 其中由奖励发放/撤回产生的未读数
  adminPendingCount: 7   // 仅管理员：status=OPEN 的待处理反馈数；普通用户恒为 0
}
```

**口径：**

- `adminAddReply` / `adminUpdateReply` / `adminUpdateStatus` 以及奖励发放或撤回都会写内部字段 `handledAt`；奖励事件同时按 `userId + rewardUpdatedAt > users.feedbackSeenAt` 单独计数。入口数字取两类未读的较大值，避免同一反馈被重复计数。`asOf` 在列表查询前生成，查询开始后的新操作会留在水位之后。
- 用户成功打开「我的反馈」后调用 `feedback.markSeen`；未成功加载列表时不清未读。
- 同一反馈被多次回复或改状态，仍只计 1 条。

### `feedback.markSeen` — 推进本人反馈已读水位

```
调用：{ action: 'feedback.markSeen', through: Date }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| through | Date | `feedback.list` 返回的 `asOf`，必填 |

**返回：** `{ success: true, feedbackSeenAt: Date, updated: 1 | 0 }`

只允许水位向前推进；旧快照或非法时间不会回退。该动作只更新当前登录用户 `users.feedbackSeenAt`，不改反馈正文、回复或状态。

### `feedback.adminStatus` — 管理员身份兼容校验

```
调用：{ action: 'feedback.adminStatus' }
```

**用途：** 保留给旧客户端确认当前 openid 是否在 `ADMIN_OPENIDS` 白名单内。当前 PAGE-010 已改用 `feedback.entrySummary`，不再通过长按头像调用本接口。

**返回：**

```javascript
{ success: true, isAdmin: true | false }
```

### `feedback.adminList` — 管理员分页查看全部（反馈管理页）

```
调用：{ action: 'feedback.adminList', type?, category?, page?, pageSize? }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| type | String | 可选，`feedback` \| `correction`，不传返回全部 |
| category | String | 可选，`suggestion` \| `bug`；纠错的 category 恒为 null，天然被排除 |
| page | Number | 可选，默认 1，非法值回退 1 |
| pageSize | Number | 可选，默认 20，上限 50 |

非法的 type / category 一律忽略按无筛选处理，不报错。

**鉴权：** 调用者 openid 必须在 `feedback/lib/schema.js` 的 `ADMIN_OPENIDS` 白名单内，否则返回 `1040 无权限`。

**返回：**

```javascript
{
  success: true,
  items: [{
    _id, userId, type, category, spotId, spotName, errorType, content, contact,
    status, adminReply, adminReplyAt, adminReplyBy,
    replies: [{ replyId, content, createdAt, createdBy, updatedAt, updatedBy, editCount, legacy }],
    reward: {
      status, days, backfill, grantedAt, revokedAt, memberExpiresAt, updatedAt,
      grantedBy, revokedBy, memberExpiresBefore, memberExpiresAfter, backfillable
    },
    createdAt,
    user: {
      openId, nickname, avatarUrl,
      member,                 // users.memberExpiresAt > 当前时间
      memberExpiresAt,        // 原始到期时间；无记录为 null
      memberExpiresAtText     // 北京时间的 YYYY-MM-DD；无到期时间为空串
    }  // users 集合按 userId 关联；无文档时 nickname 为空串、member=false
  }],
  count: 20,        // 本页条数
  total: 137,       // 符合条件的总条数（真实 count，不是本页条数）
  page: 1,
  pageSize: 20,
  hasMore: true
  // 不按 userId 过滤；按 createdAt 倒序
  // replies 保留完整管理线程；adminReply 仍是其中最新一条的兼容镜像
  // reward.backfillable=true 表示该反馈创建于奖励活动上线前且尚未发放，管理页显示「可补发」
}
```

### `feedback.adminAddReply` — 管理员追加一条回复

```
调用：{ action: 'feedback.adminAddReply', id, reply }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| id | String | 记录 _id，必填 |
| reply | String | 回复正文，trim 后 1–300 字 |

**鉴权：** 同 adminList，白名单外返回 `1040 无权限`。

每条反馈最多保留 100 条管理员回复。追加不会覆盖已有回复；用户端只能阅读，不能回复。写入时状态一律置为 `PROCESSED`，并写入内部 `handledAt` 供用户端未读标识统计。

**返回：**

```javascript
{
  success: true, updated: 1,
  reply: { replyId, content, createdAt, createdBy, updatedAt, updatedBy, editCount, legacy },
  replies: [...],
  adminReply: "...", adminReplyAt: Date, status: "PROCESSED"
}
```

**错误码：** `1010` 缺 id / reply 非字符串 / 超 300 字；`1043` 反馈不存在；`1044` 回复内容为空；`1045` 回复条数已达上限。

### `feedback.adminUpdateReply` — 管理员修改指定回复

```
调用：{ action: 'feedback.adminUpdateReply', id, replyId, reply }
```

管理员可在任意日期修改任一已有回复。修改保留原 `createdAt`，更新 `updatedAt / updatedBy` 并递增 `editCount`；用户端据此显示「已修改」。写入时状态置为 `PROCESSED`，同时推进 `handledAt`。

返回结构同 `adminAddReply`，其中 `reply` 为本次修改后的回复。错误码在追加接口基础上增加 `1046`（指定回复不存在）。

### `feedback.adminReply` — 旧客户端兼容入口

```
调用：{ action: 'feedback.adminReply', id, reply }
```

旧客户端兼容：没有回复时创建第一条，已有回复时修改最新一条。新客户端必须使用 `adminAddReply` / `adminUpdateReply` 明确区分追加和修改，不得再把该接口作为多回复实现。

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
写入状态时同时写入内部 `handledAt`，供用户端未读标识统计。

### `payment.feedbackReward.*` — 反馈采纳奖励（2026-11-05）

**云函数名：`payment`**

反馈正文与回复仍由 `feedback` 云函数管理；会员权益只能通过 `payment` 的事务账本发放和撤回，避免页面直接修改 `users.memberExpiresAt`。

| action | 调用 | 成功返回 |
|---|---|---|
| `feedbackReward.adminStatus` | `{}` | `{ success: true, isAdmin }` |
| `feedbackReward.adminGrant` | `{ feedbackId }` | `{ success: true, feedbackId, alreadyGranted, reward, memberExpiresAt }` |
| `feedbackReward.adminRevoke` | `{ feedbackId }` | `{ success: true, feedbackId, alreadyRevoked, reward, memberExpiresAt }` |

- 奖励接口由 `payment` 云函数按 `AFTER_SALES_ADMIN_OPENIDS` 二次鉴权；PAGE-017-2 还需通过 `feedback.adminList` 的反馈管理员鉴权。页面仅在两个权限都满足时展示奖励操作。
- `adminGrant` 每次增加 30 天会员，从当前有效到期日继续顺延；同一反馈只发放一次，不同反馈可以叠加。重复提交同一反馈按幂等成功返回，不重复增加时长。
- 新反馈写入 `rewardProgramVersion=feedback-member-30d-v1`；没有该版本的历史反馈首次奖励时返回 `reward.backfill=true`，管理页显示「补发」。
- `adminRevoke` 只允许在该奖励仍是用户最后一次会员权益发放时执行。撤回按 30 天扣回，最低保留到当前时间，不产生负时长；成功后恢复上一笔权益发放指针，并通知用户。
- 奖励和撤回都在同一事务内更新 `users`、`feedbacks` 与 `admin_audit_logs`。错误码：`1040` 无权限、`1043` 反馈不存在、`1047` 已撤回不能再发放、`1048` 奖励后已有新的会员权益不能自动撤回、`1031` 名额账本忙碌。

---

## 4. 页面 → API 映射速查

| 页面 | 需要调用的 API |
|------|---------------|
| **PAGE-001** 首页·行程状态墙 | `home.bootstrap` V2；`tripItem.markResult` / `undoResult` / `updateReminder` / `remove` / `removeVisitDate` / `recoveryCandidates`；「约其他日」快捷入口用 `cart.planQuickDates` + `cart.quickCommit` |
| **PAGE-009** 旧任务列表 | V2 已废弃。`task.*` 云函数保留为兼容代码，**首页与新流程均不再调用** |
| **PAGE-002 / SPOT-HUB 快捷入口** | `spots.detail`；「设置提醒 / 加入行程」用 `cart.planQuickDates` + `cart.quickCommit`，不写主流程 `reminder_cart` |
| **PAGE-003** 想去景点（含搜索） | `spots.list`、`spots.batch`（已选行）、`trip.updateSpots` |
| **PAGE-004** 搜索态 | 2026-10-28 已合并回 PAGE-003，不再单独调用接口 |
| **PAGE-005** 新增提醒（独立页） | `timeline.preview`（纯预览，不建行程）、`cart.pruneScope`（生成成功后收敛暂存清单）、`cart.add`、`cart.addAll`、`cart.list`（暂存清单） |
| **PAGE-006** 景点视图 | 搁置中，不实现 |
| **PAGE-007** 行程清单弹窗 | `cart.list`、`cart.remove`、`cart.clear`、`cart.updateRemindOn`、`cart.commit` |
| **PAGE-008** 设置提醒 | V0.3 主流程：`cart.bootstrap`（清单 + 会员 + 订阅授权一次取回）、`membership.createOrder` + `payment.*`（仅提醒名额不足时）、用户主动点击「点击补授权次数」、`cart.commit`（授权、系统权限或提醒名额未满足时主按钮禁用；不提供仅加行程旁路） |
| **PAGE-010** 我的 | `user.bootstrap`（资料 + 会员 + 订阅健康一次取回）；`feedback.entrySummary`（反馈入口身份与数字，旧缓存先渲染、`onShow` 刷新）；能力探测按本地短缓存降频 |
| **PAGE-012** 编辑资料 | `user.profile`、`user.updateProfile`（头像走 `open-type="chooseAvatar"` + `wx.cloud.uploadFile` 上传） |
| **PAGE-014** 会员与提醒名额 | `membership.status`、`membership.createOrder`、`membership.orders`、`payment.create/query/cancel`；支付前确认、持久支付状态和订单入口；“我的”页常驻会员状态卡 |
| **PAGE-015** 订单与退款详情 | `membership.orders`、`membership.orderDetail`；列表最多 50 笔，详情按本人单笔读取，主订单状态与退款状态分离，支持继续支付、取消、同步、申请售后和重新购买 |
| **PAGE-016** 用户售后申请 | `membership.orderDetail`、`payment.afterSales.submit/cancel/list/detail/syncRights`；未到账、重复支付、未使用退款、权益不符和其他问题，未处理与无远端退款记录的异常单可取消 |
| **PAGE-017** 客服工作台 | `payment.adminReminderQuality.stats`、`payment.adminOrders.list/detail`、`payment.afterSales.admin*`；仅 `AFTER_SALES_ADMIN_OPENIDS` 可见，服务端二次鉴权，敏感操作写审计日志 |
| **PAGE-018** 行程只读分享 | 主人：`tripShare.create/status/revoke`；接收方：`tripShare.open` |
| **PAGE-013** 分享场景页 | `spots.list`（today）、`spots.batch`（national-day-2026）；点击景点后 `spots.detail` |
| **PAGE-010-1** 提醒设置 | `subscribe.get` + 微信授权 API：`wx.getAppAuthorizeSetting` / `wx.openAppAuthorizeSetting` / `wx.getSetting` / `wx.requestSubscribeMessage` / `wx.openSetting`；缺口按钮为「补授权次数+1」，点击一次最多申请 1 条（模板未配置时「去授权」置灰） |
| **PAGE-010-4** 帮助与反馈 | 微信原生客服 `button open-type="contact"`；`feedback.entrySummary`（「我的反馈」未读数字，旧缓存先渲染、`onShow` 刷新）；顶部展示带礼品图标的反馈奖励活动说明 |
| **PAGE-010-2** 意见反馈 | `feedback.submit`（type=feedback，category=suggestion/bug）；顶部展示同一份反馈奖励活动说明 |
| **PAGE-010-3** 信息纠错 | `spots.search`（选景点）、`feedback.submit`（type=correction）；顶部展示同一份反馈奖励活动说明 |
| **PAGE-010-5** 我的反馈 | `feedback.list`（本人历史最多 50 条、完整回复线程、奖励快照与独立 `rewardNotices`、`asOf`）、`feedback.markSeen`（成功后推进已读水位） |
| **PAGE-017-2** 反馈管理（隐藏管理页，`/admin/feedback/feedback`） | `feedback.entrySummary`、`feedback.adminList`（分页 + 类型/分类筛选 + 提交人昵称与 OpenID + 回复线程 + 奖励快照）、`feedback.adminAddReply`、`feedback.adminUpdateReply`、`feedback.adminUpdateStatus`、`payment.feedbackReward.adminStatus/adminGrant/adminRevoke`；反馈入口按 `ADMIN_OPENIDS` 鉴权，奖励操作另按 `AFTER_SALES_ADMIN_OPENIDS` 鉴权 |

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

`PAGE-008`（V0.3 硬闸门）不使用 `confirmReminderAccess()`：额度不足时主按钮禁用，只允许用户主动点击「点击补授权次数」，微信一次性订阅每次点击最多增加 1 条；仍不足时继续保留缺口，不用异步连发伪装补齐。全部满足后才走 `cart.commit`，不提供 `trip-only` 旁路。首页“约其他日”继续使用 `notify.confirmReminderAccess()`；景点卡片、景点详情和分享场景改用统一的「提醒授权与名额」浮层，同时消费 `subscribe.get` 的 `quota / pendingMessageCount / availableQuota` 与 `membership.status.enforced / membership / packages`。授权每次点击只补 1 条；`enforced=true` 且免费名额不足时在同一浮层展示唯一会员套餐；`taskLimitUnlimited=true` 时不展示名额付费卡。两闸门均满足后才提交，`trip-only` 走 `disableReminders: true`，关闭或设置引导不提交（详见 `REMINDER-RULE-009`）。

⚠️ **不再传 tripId**：纯预览化后「生成时间线」不建行程，清单也不挂在行程上。
任何页面都不应缓存或透传 tripId —— 提交返回的那个才是唯一可信的。

### 5.1 分享页面参数契约（2026-09-25）

```text
景点深链：
/pages/spot-hub/spot-hub?spotId=<id>&source=share|search|direct

场景页：
/pages/share-scene/share-scene?sceneId=today|national-day-2026
                                      &source=share|timeline|home_share|search|direct

行程只读分享：
/pages/trip-share/trip-share?token=<token>&source=share
```

- `spotId` / `sceneId` / `token` 均做 URL 编码；无效景点显示明确失败态，无效场景回退 `today`，无效令牌统一显示不可查看。
- 链接只允许公开参数，不得出现昵称、OpenID、行程 ID、票务结果或提醒状态；行程分享令牌是唯一私有内容凭证。
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

- `entry_type`: `spot | scene | list | home | trip`
- `source`: `share | timeline | home_share | search | direct | trip_share`
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
  previousResult: 'SUCCESS' | 'FAILED' | null, // 仅双向更正时暂存，供 4 秒撤销
  previousResultAt: Date | null,
  createdAt,
  updatedAt
}
```

约束与派生规则：

- 逻辑唯一键：`(userId, tripId, spotId, visitDate)`，云函数查重，不做老数据合成迁移。
- `releaseAt / reservationRequired / ticketState / reminderState` 均为读取时派生，不持久化到行程项。
- `result` 首次只能从 `null` 写成 `SUCCESS/FAILED`；写入后仅允许 `resultAt + 4s` 内调用 `tripItem.undoResult`。出行日结束前允许 `FAILED ↔ SUCCESS` 双向更正，撤销时恢复修改前结果。（变更：2026-09-17 由 10 秒收紧为 4 秒，常量 `V1.RESULT_UNDO_SECONDS`）
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
  includeSpots: false            // 可选，默认 false
}

返回：{
  success: true,
  serverNow: '2026-09-16T...',
  primaryTripId: 'trip_a',
  trips: [{
    _id, city, startDate, endDate, name,
    shareActive: true,              // 只读分享是否有效；不下发 shareToken
    progress: {
      done: 2,                    // 已成的预约需求组数
      total: 3,                   // 需预约的需求组总数，免预约不计
      noReservationCount: 1       // 另有 X 处随到随玩
    },
    items: [/* 见 8.3 item 结构 */]
  }],
  history: [{
    _id, city, startDate, endDate, name,
    shareActive: false,             // 历史行程在 endDate + 7 天内仍可能为 true
    progress: { done, total, noReservationCount }
  }],
  stickyBanner: {
    releaseAt, spotName, visitDate, itemId, countdownText
  } | null,
  releasePills: [/* 摘要卡底部「即将提醒」胶囊，按放票时刻合并 */],
  reminderQuotaWarning: {         // 授权 short/exhausted 时返回；low 仅限 48 小时内
    level, pendingMessageCount, remainingQuota, shortfall, replenishNeeded,
    nearestRemindAt, text
  } | null,
  recoverableIds: ['item_2'],     // 2026-09-24：这些行程项「没抢到」但还有可换的日期
  hotSpots: [/* spots.list；includeSpots 为 true 时才有内容，否则为 [] */]
}
```

- `reminderQuotaWarning` 的窗口规则：真实缺口 `short / exhausted` 不受 48 小时限制；只有 `low`（额度刚好够、仅缺 1 次缓冲）限制在最近一条提醒进入 48 小时内，避免远期行程过早制造焦虑。

- **`includeSpots` 默认 `false`**（2026-09-30 改，此前默认 `true`）。理由是性能：
  取热门景点要**在本次请求里再调一次 `spots` 云函数**，等于一次用户请求串两个云函数的
  冷启动，而 `hotSpots` 的唯一消费方是首页空态的三行预览 —— 已有行程的用户（绝大多数）
  从来不会渲染它。现在改由前端在**首屏渲染之后**、且**已知是空态**时单独调 `spots.list`
  （见 `pages/home/home.js` 的 `loadHotSpots`），让两次冷启动从「相加」变成「取最大」。
  首屏期间空态预览由包内本地切片兜住（`miniprogram/utils/empty-preview.js`）。
  ⚠️ 调用方若确实需要 `hotSpots`，必须显式传 `includeSpots: true`。

- `trips` 只包含未结束行程，按 `startDate` 升序。
- `history` 只包含 `endDate` 次日起的历史行程，按 `startDate` 降序。
- 一个行程结束后仍在 `endDate` 当天保留在主墙；次日按北京时间读取时归入历史，不依赖定时任务。
- 首页结构：一张 `primaryTripId` 全局摘要卡 + 纵向分段墙；其他行程只显示紧凑分段标题，不用横向 Tab。
- ⚠️ `primaryTripId` 的语义**只是「最近未结束行程」**（没有则为空串）：全部行程都结束时，客户端摘要卡会退化展示 `history[0]`（最近一段过往行程，副标题「已结束」），**不**把 `primaryTripId` 指到历史行程上——那个字段同时被「新增提醒」预填当成「还能继续加项的行程」（见 `PAGE-005-RULE-001`），指错了会把过去的时间范围预填进 PAGE-005。退化只发生在渲染层，本文契约字段不变（`HOME-RULE-008`）。
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
  canChangeToSuccess: false,       // 仅 FAILED 且出行日未结束时为 true
  canChangeToFailed: false,        // 仅 SUCCESS 且出行日未结束时为 true
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

`canChangeToSuccess` = **现在能否把“未抢到”更正为“已约到”**（真身 `lib/item.js` 的 `canChangeToSuccess`）。只有 `result === FAILED`、需预约、已开票且 `visitDate` 未结束时为 true；首页据此在右侧三点菜单显示「已抢到」。页面必须读该字段，不得自行按 `ticketState` 推导。

`canChangeToFailed` = **现在能否把“已约到”反向更正为“未抢到”**（真身 `lib/item.js` 的 `canChangeToFailed`）。只有 `result === SUCCESS`、需预约、已开票且 `visitDate` 未结束时为 true；首页据此在右侧三点菜单显示「未约到」。页面同样不得自行推导。

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

- 首次只能标记出票后且尚未人工标记、日期未结束的行程项。
- 已有人工结果的行程项可在出行日结束前再次调用并改传另一终态：`FAILED → SUCCESS` 的入口为「已抢到」，`SUCCESS → FAILED` 的入口为「未约到」。服务端暂存修改前结果与时刻，供 4 秒撤销恢复。
- 标记成功返回 `backupPrompt`，前端用内联提示询问删除或保留备选；没有备选时为 `null`。
- 保留备选后继续按原提醒配置抢票。
- 提醒失败/未送达不影响 `tripItem.markResult`。

#### `tripItem.undoResult`

```javascript
调用：{ action: 'tripItem.undoResult', itemId, expectedResultAt }
返回：{ success: true, item }
```

- 仅 `resultAt + 4s` 内允许，且 `expectedResultAt` 必须匹配，防止覆盖后续操作。
- 首次标记撤销回 `null`；双向更正撤销回修改前结果，并恢复修改前的结果时刻。
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
- 开启提醒时必须与 `cart.commit` 使用同一套服务端订阅额度二次校验；不足返回结构化
  `1008`，不得先写 `remindOn` 或创建任务。用户重新点击开启时继续走客户端授权闸门。
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
  releaseAt: Date | null,       // ⚠️ 服务端忽略并自行推导；多时段时返回当前最近的未来时段
  remindOn: Boolean             // 免预约或无固定放票时刻必须 false
}
```

- ⚠️ **`releaseAt` 由服务端按 `releaseSlots` / `visitDate` 推导**（与行程项、时间线同一真身），调用方传什么都会被覆盖；**不传也合法**。没有 `releaseSlots` 的旧规则继续按 `visitDate − advanceDays + releaseTime/releaseTimes` 兼容。
  「约其他日」这条动线只有用户选的 `visitDate`（`date-picker-sheet` 只回 visitDate），
  原先强制要求 `releaseAt` 会让它稳定回 1010 —— 挽回线点得开、走不通。
  推不出放票时刻（无固定放票规则的景点，如环球影城）仍可加入清单，服务端固定 `remindOn=false`；
  该清单项只会在 `cart.commit` 时落成行程项，不创建提醒任务。

- 返回补充 `remindBlockedReason`：仅当 `remindOn=false` 且确实由服务端降级时返回
  `RELEASE_PASSED / NO_FIXED_RELEASE / NO_RESERVATION`；用户主动选择不提醒时为空。
- 返回 `releaseTaskCount`：本次日期实际会创建的未来任务数（军博为 3，普通单时段景点为 1）。

#### `cart.planDates`

```javascript
调用：{
  action: 'cart.planDates',
  spotId,
  visitDates: ['2026-11-04', '2026-11-10']
}
返回：{
  success: true,
  spotId,
  spotName,
  dates: [{
    visitDate,
    status: 'REMINDABLE' | 'TRIP_ONLY' | 'IN_CART' | 'IN_TRIP',
    reason: '' | 'RELEASE_PASSED' | 'NO_FIXED_RELEASE' | 'NO_RESERVATION' | 'IN_CART' | 'IN_TRIP',
    releaseAt: Date | null,
    releaseSlots: [{ key, label, releaseTime, advanceDays, releaseDateStr, releaseAt }],
    reminderTaskCount: Number,       // 该日期当前会创建的提醒任务数
    addable: Boolean,
    reminderAllowed: Boolean
  }],
  summary: {
    requested, addable, reminder, reminderTaskCount, tripOnly, existing,
    releasePassed, noFixedRelease, noReservation
  }
}
```

- 只读接口，是景点页日期资格的权威来源。客户端不得用 `advanceDays/releaseTime` 自行重推。
- 单次最多 31 个日期；重复日期先去重排序。
- 已在暂存清单或任一真实行程中的日期不重复加入。

#### `cart.planQuickDates`

```javascript
调用：{
  action: 'cart.planQuickDates',
  spotId,
  visitDates: ['2026-11-04', '2026-11-10']
}
返回：{
  success: true,
  spotId,
  spotName,
  reservationRequired: Boolean,
  dates: [{
    visitDate,
    status: 'REMINDABLE' | 'TRIP_ONLY' | 'IN_CART' | 'IN_TRIP',
    reason: '' | 'RELEASE_PASSED' | 'NO_FIXED_RELEASE' | 'NO_RESERVATION' | 'IN_CART' | 'IN_TRIP',
    releaseAt: Date | null,
    releaseSlots: [{ key, label, releaseTime, advanceDays, releaseDateStr, releaseAt }],
    reminderTaskCount: Number,
    addable: Boolean,
    reminderAllowed: Boolean,
    resumeCart: Boolean,      // 仅旧版 pending 草稿可续用时为 true
    resumeCartId: String      // 可选；服务端内部续用标识
  }],
  summary: {
    requested, addable, reminder, reminderTaskCount, tripOnly, existing,
    releasePassed, noFixedRelease, noReservation
  },
  resumeCartCount: Number
}
```

- 景点页、景点详情、分享场景和首页「约其他日」的唯一日期资格预检入口。
- 与 `cart.planDates` 的区别：旧版留在 pending `reminder_cart` 的同景点日期视为可续用，不把用户引回主流程清单；已落成 `trip_items` 的日期仍返回 `IN_TRIP`。
- 只读，不创建、消费或清理任何数据。

#### `cart.quickCommit`

```javascript
调用：{
  action: 'cart.quickCommit',
  spotId,
  visitDates,
  channels: ['OFFICIAL_ACCOUNT'],   // 存在可提醒日期时必填
  offsets: [5],                     // 存在可提醒日期时必填
  supportsMultiRelease: true,       // 新客户端能力声明
  disableReminders: false           // true = 本次仅创建行程项
}
返回：与 `cart.commit` 相同
```

- 授权与提醒名额闸门通过后由服务端一次性创建/合并行程、写 `trip_items`、创建提醒任务并返回 `tripId`。
- 全新快捷日期**不得写入** `reminder_cart`；历史 pending 同景点日期行可在同一事务中续用并消费，其他暂存草稿不受影响。
- 服务端在提交前重新运行快速日期资格并二次校验订阅授权与提醒名额，禁止信任客户端预检；已存在真实行程时返回 `1002`。
- `disableReminders=true` 只创建行程项，不创建提醒任务，不返回公众号关注引导。

#### `cart.addDates`

```javascript
调用：{ action: 'cart.addDates', spotId, visitDates }
返回：{
  success: true,
  dates,
  summary,
  items: [{ cartId, visitDate, remindOn, status, reason }],
  addedCartIds: [],
  added,
  addedReminders,
  addedTripOnly
}
```

- 先完整预检、再写入全部可新增日期；写入异常时清理本批新增，不留下半成品。
- `REMINDABLE` 写 `remindOn=true`；`TRIP_ONLY` 写 `remindOn=false`。
- `IN_CART / IN_TRIP` 返回在 `dates` 中但不重复写入。

#### `cart.pruneScope`

```javascript
调用：{
  action: 'cart.pruneScope',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  spotIds: ['gugong', 'guobo']
}
返回：{ success: true, removed: 2 }
```

- PAGE-005 在 `timeline.preview` 成功后调用，把暂存清单收敛到本次日期段 × 景点集合（CART-RULE-007）。
- 只处理暂存区（`PENDING_CART_TRIP_ID`）；真实 `tripId` 下的旧链路清单不受影响。
- 保留 `(spotId ∈ spotIds) && (visitDate ∈ [startDate, endDate])` 的项，其余移除。
- 清理失败不得阻断预览展示；页面仍应刷新清单条。

#### `cart.updateRemindOn`

```javascript
调用：{ action: 'cart.updateRemindOn', cartId, remindOn: Boolean }
返回：{ success: true, cartId, remindOn }
```

- 仅需预约且有 `releaseAt` 的项可切换；免预约、无固定放票时刻项强制 `false`。

#### `cart.commit`

```javascript
调用：{
  action: 'cart.commit',
  tripId,
  cartId,                           // 可选；只提交本次补录的一条，不消费其他暂存草稿
  cartIds,                          // 可选；景点页多日期补录，只提交本次选中的多条
  channels: ['OFFICIAL_ACCOUNT'],   // 有 remindOn=true 项时必填
  offsets: [5],                     // 有 remindOn=true 项时必填
  supportsMultiRelease: true,       // 新客户端能力声明；缺省按旧单任务契约
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
- 旧版首页“约其他日”和景点页快捷入口可能传单个 `cartId` / `cartIds`；新版快捷入口改用 `cart.quickCommit`，不再写或提交主流程暂存清单。兼容调用只消费指定项，且不得同时传 `cartId` 与 `cartIds`。
- `cartIds` 必须在一次提交中消费：服务端按本次集合校验提醒名额，在同一个事务中创建/合并行程、写行程项和提醒任务；不得由客户端循环提交出多趟行程。
- 设置提醒页保持不传 `cartId` / `cartIds`，代表整单提交。
- `disableReminders=true` 是“仅加行程不提醒”的降级提交：忽略 `channels/offsets`，本次提交的清单项均以 `remindOn=false` 落成行程项，不创建 `reminder_tasks`，且不返回公众号关注引导。该模式只允许提交暂存清单，不允许同时传真实 `tripId`。
- 服务端在一次提交中创建全部 `trip_items`；仅为 `remindOn=true` 且可提醒的项创建 `reminder_tasks`。当前清华只保留即时预约、军博只保留最早 `08:00`，每个行程项只创建 1 条任务。底层 `supportsMultiRelease=true` 仍可按未来扩展的 `releaseSlots` 展开多条任务，任务均挂同一个 `itemId`；旧客户端缺省时继续按顶层 `advanceDays + releaseTime` 创建单条任务。
- 提交前必须校验提醒名额。本次会创建的未来 `WAITING` 任务数超过当前可用额度时，返回 `1026`，请求整体失败；不得先创建行程、消费部分清单，也不能只提示前端而绕过服务端。
- `cart.commit` 在任务落库前还必须按当前模板重新校验订阅授权：
  `可用授权 = 台账授权 − 未来待发送消息数`。本次新增消息数为
  `Σ(每个可提醒清单项的 releaseSlots 未来时段数) × offsets.length`；不足时返回 `1008` 和
  `subscription: { required, quota, pendingMessageCount, availableQuota, shortfall }`，
  清单、行程项和任务均不得部分写入。
- 旧 `task.submit` 在 V2 实现完成后只作为内部兼容代码，不再由首页/设置页调用。

### 8.6 不可漂移的实现约束

1. 状态在读取时推导，`UNMARKED` 不落库，不依赖定时任务。
2. 票务结果与提醒送达状态必须分字段、分 UI 展示。
3. 进度分母按 `backupGroupId` 去重，免预约项不计入分母。
4. 一行程项一个 `itemId`。当前清华、军博均只配置一个提醒时段，因此一个行程项只对应一条提醒任务；底层仍允许未来场景按 `releaseSlots` 扩展多条任务，任务、删除、提醒状态和推送落地全部按 `itemId` 关联，`releaseKey` 只用于稳定识别同一行程项内的不同放票时段。
5. 首页不出现提醒任务一级 Tab；旧任务列表仅保留代码兼容期，不进入新 UI。

### 8.7 2026-09-20 口径变更

1. **`timeline.generate` → `timeline.preview`**（8.5 之外的新接口）
```
调用：{ action: 'timeline.preview', startDate, endDate, spotIds, city, segments?, committedTripId? }
返回：{ success: true, events, byDeparture, bySpot, closedSpots, closedDaySkips, empty, emptyReason }
```
   - 按当前所选日期段与景点**独立计算**，不创建/改写任何行程。
   - 每个 event 带 `releaseState / releaseStateLabel`：`NOT_RELEASED / 待开票`、`RELEASED / 已开票`、`NO_RESERVATION / 无需预约`、`NO_FIXED_RELEASE / 随买随用`；已开票只影响展示，status 仍为 `SELECTABLE`。
   - 无固定放票时刻的需预约景点（如环球影城）按每个非闭馆出行日返回候选项：`releaseAt=null`、`releaseTimeStr='随买随用'`、按钮为「加入行程」；可加入清单和行程，但不创建提醒任务。
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

6. **行程合并时同步任务的 `releaseAt` 与 `tripId`**：放票时刻由 `visitDate + releaseKey` 推导，
   合并后行程段变了就会过期；`itemId` 保持不动，它是 tasks join items 的键。

### 8.8 2026-11-02 调用量结构性优化

1. **页面级 bootstrap**

```javascript
调用：{ action: 'user.bootstrap', membershipCapabilities: ['unlimited-v3'] }
返回：{
  success: true,
  user: { /* users 文档 + membership + membershipSales */ },
  membership, packages, sales,
  subscription: { quota, totalQuota, availableQuota, pendingMessageCount, level, shortfall },
  capabilities: { adminStatusKnown: false },
  runtimeVersion: 'legacy:<ts>',
  membershipUpgradeNotice: { id, endsAt } // 可选；仅公告前已开通的 unlimited-v3 白名单有效会员且公告有效
}

调用：{ action: 'cart.bootstrap', membershipCapabilities: ['unlimited-v3'] }
返回：{ success: true, items, groups, summary, membership, packages, sales, subscription, runtimeVersion }
```

- `user.bootstrap` 共享一次用户与任务读取，替代个人页顺序调用 `user.profile + subscribe.get`；管理端能力标记仍由对应部署单元鉴权。
- `membershipUpgradeNotice` 是可省略字段。服务端先判断请求是否声明 `unlimited-v3`、当前 OpenID 是否命中方案灰度、当前会员有效，且 `memberSince` 早于公告 `startsAt`，再校验公告有效期；旧客户端、新会员、非白名单或免费用户响应不得增加该字段。
- `cart.bootstrap` 替代设置提醒页的 `cart.list(includeMembership=true) + subscribe.get` 两个云函数往返。

2. **清单命令返回规范视图**

- `timeline.preview` 追加 `cartSummary` 与 `cartVersion`。
- `cart.addAll` 一次加载景点、规则、清单和已有行程项，在一个事务内批量写入；不再逐项调用单条 `cart.add`。
- `cart.addAll` / `cart.addDates` / `cart.add` 追加 `statusPatches: [{ cartId?, spotId, visitDate, status:'IN_CART', button }]`；批量命令同时返回 `cartSummary` 与 `cartVersion`。
- `cart.updateRemindOn` / `cart.remove` 追加 `cartSummary` 与 `cartVersion`。客户端据此原地更新，不再自动追加 `timeline.preview + cart.list` 两次读回。

3. **首页读模型**

- `home.bootstrap` 响应保持原外形并追加 `runtimeVersion`：`legacy` 或 `runtime:<builtAtMs>`。
- 写操作后的刷新和用户主动下拉可传 `runtimeBypass: true`，强制跳过派生文档并立即从源集合重建。
- 运行开关 `HOME_RUNTIME_MODE=off|shadow|on` 默认 `off`；`shadow` 只返回旧链路结果并打印规范化差异，`on` 才优先读取 `user_runtime`。
- `user_runtime` 是可重建派生集合，文档固定含 `schemaVersion='user_runtime/v1'`、`builtAt`、`stale` 和 `sources`。源集合仍是业务真身。
- 运维预建调用 `{ action:'admin.runtimeBackfill', token, cursor?, limit? }`；`limit` 最大 50，按系统 `_id` 游标返回 `nextCursor/hasMore`。`RUNTIME_BACKFILL_TOKEN` 未配置时始终拒绝。

4. **景点静态快照**

- `spots-snapshot/v1` 固定含 `schemaVersion`、`contentVersion`、`generatedAt` 和 `cards`。
- 快照由 `data/spots.json` + `data/rules.json` 生成；包内快照是首屏兜底，远程版本通过 `static/v1/data/` 每天最多检查一次。
- 客户端 `spots.list/detail/batch/search/searchHistory/clearSearchHistory` 在快照可用时不再调用 `spots` 云函数。

---

## 9. admin（只读 Web 管理后台，2026-10-06 新增）

**云函数名：`admin`**

> Web 端通过 CloudBase Web SDK 登录匿名身份后调用本函数；管理员业务会话由 `admin.login` 单独签发。
> 除 `admin.login` 和定时器 `internal.rollupDaily` 外，所有 action 都必须携带 `token`。
> CloudBase 云函数安全规则必须单独放行 `admin` 的匿名调用，但不能开放整个环境；`internal.rollupDaily` 只接受定时触发器调用。

### 9.1 `admin.login`

```javascript
调用：{ action: 'admin.login', username, password }
返回（success=true）：
{
  success: true,
  token: '<8 小时 HS256 会话 token>',
  expiresIn: 28800,
  admin: { id, username, role }
}
```

- 密码使用 `scrypt` + 随机盐保存在 `admins` 集合。
- 首次登录时，若 `admins` 为空且传入账号匹配 `ADMIN_BOOTSTRAP_*` 环境变量，则创建首个 `SUPER_ADMIN`。
- 连续 5 次密码错误锁定 15 分钟；成功登录清零失败计数并写审计日志。

### 9.2 只读查询 actions

```text
admin.overview
admin.users.list
admin.user.detail
admin.tasks.list
admin.task.detail
admin.spots.stats
```

统一调用：`{ action, token, ...params }`

- `admin.overview`：`{ days: 7|30|90 }`，返回用户总数、新增用户、创建任务、到期任务、已触发、未送达、处理率、Top 10 景点和趋势。
- `admin.users.list`：`{ page, pageSize, keyword? }`，默认每页 20，列表只返回脱敏字段。
- `admin.user.detail`：`{ id }`，返回用户、行程、行程项、任务摘要和最近任务。
- `admin.tasks.list`：`{ page, pageSize, status?, spotId?, userId?, releaseFrom?, releaseTo?, createdFrom?, createdTo? }`。
- `admin.task.detail`：`{ id }`，返回任务、行程项和最近 100 条事件时间线。
- `admin.spots.stats`：`{ days: 7|30|90 }`，按 `TASK_CREATED` 统计景点任务频率，并返回处理率和发送成功率。

### 9.3 敏感字段查看

```javascript
调用：{ action: 'admin.audit.viewSensitive', token, id, field }
field: 'openId' | 'phone' | 'nickname'
返回：{ success: true, field, value }
```

- 仅 `SUPER_ADMIN` 可调用。
- 每次成功查看都会向 `admin_audit_logs` 写入审计日志。
- 列表接口永远返回脱敏值，只有这个 action 能返回完整值。

### 9.4 `internal.rollupDaily`

- 由 `admin` 云函数每天北京时间 01:00 的定时触发器执行；无 action 调用也默认进入此动作。
- 重算最近 7 天事件，写入永久 `reminder_daily_stats`。
- 对最近 7 天缺少的 `TASK_CREATED` / 终态事件做幂等补录。
- 分批删除超过 180 天的 `reminder_events` 和 `admin_audit_logs`。
