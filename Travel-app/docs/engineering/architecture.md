# Travel-app 工程架构

> 本文只记录工程结构和数据流。产品行为以 `产品文档.md` 为准，接口字段以 `API-契约.md` 为准。

## 技术栈

- 前端：微信原生小程序 + Vant Weapp + 自绘组件。
- 后端：微信云开发，云函数按独立部署单元打包。
- 数据：`data/` 为业务数据真身，云函数部署副本和 `miniprogram/utils/mock.js` 是必要镜像。
- 时间：所有业务日期、放票时刻和核验日期均按北京时间 GMT+8。

## 云函数

| 云函数 | 职责 |
|---|---|
| `reminder` | 行程、行程项、清单、提醒任务、用户与首页聚合，核心业务函数 |
| `spots` | 景点查询、规则卡片和放票状态推导 |
| `notifier` | 到期提醒发送、MISSED 收敛、清理 |
| `payment` | 会员 / 提醒名额订单、支付与退款回调、主动查单、售后、权益发放与 2 分钟补偿 |
| `feedback` | 意见反馈与信息纠错 |
| `admin` | 只读 Web 管理后台 API：管理员鉴权、用户/任务查询、事件汇总 |
| `scraper` | 抓取与规则推算，未完成线上闭环 |
| `ics-generator` | `.ics` 生成，日历通道已下线但函数保留 |

## 主要页面

| 页面 | 当前职责 |
|---|---|
| `pages/home` | 行程状态墙；新用户时显示创建与内容引导 |
| `pages/add-trip` | 行程输入、纯预览时间线、加入清单 |
| `pages/spot-hub` | 景点 Tab、今日放票 Banner、景点列表与详情入口 |
| `pages/setup` | PAGE-008 设置提醒；V0.3 授权硬闸门 |
| `pages/notify-settings` | 系统通知权限与提醒额度设置 |
| `pages/profile` | 我的；帮助与反馈统一入口 |
| `pages/membership` | 会员与提醒名额；权益解释、支付前确认、持久支付状态 |
| `pages/membership-orders` | 当前用户最近 50 笔订单，点击通过本人单笔接口进入订单详情 |
| `pages/membership-order-detail` | 订单主状态、独立退款状态、权益快照和可执行动作 |
| `pages/membership-after-sales` | 用户提交未到账、重复支付、未使用退款等售后申请 |
| `pages/admin-after-sales` | 管理员客服工作台：提醒质量、会员购买开关、会员限制、会员订单查询、售后工单、审计操作与老用户保护额度迁移 |
| `pages/help-feedback` | 帮助与反馈二级入口：在线客服、意见反馈、信息纠错、我的反馈 |
| `pages/my-feedback` | 当前用户最近 50 条反馈/纠错记录，只读 |
| `pages/legal` | 隐私政策与用户服务协议 |
| `pages/feedback` | 意见反馈 |
| `pages/spot-correction` | 景点信息纠错 |
| `pages/share-scene` | 今日/国庆公开场景页 |
| `pages/trip-share` | PAGE-018 行程只读分享落地页；凭令牌读取脱敏投影，不提供任何写操作或二次转发 |

`pages/spot-rule` 与 `pages/spots` 文件仍存在，但入口和历史定位需以当前路由审计为准，不能仅凭旧文档恢复旧动线。

## 首页数据流

1. 小程序调用 `reminder.home.bootstrap`。
2. 默认旧链路并行读取行程、行程项、提醒任务、用户和公开景点卡；`HOME_RUNTIME_MODE=on` 时优先读取 `user_runtime` 的单用户派生快照，缺失、失效或过期再从源集合重建。
3. 服务端完成行程拆分、状态推导、提醒状态装饰、可挽回候选和额度预警。
4. 前端只渲染服务端结果；票务状态和提醒送达状态不得在页面侧重新推导。
5. `trip_items` 是首页、票务结果、提醒关联和删除动线的事实来源。
6. `user_runtime` 是可丢弃、可重建的读模型，不是事实来源；所有用户写操作成功后标记失效，`notifier` 的状态转换和支付权益变更也负责标记失效。

## 景点静态快照

- `data/spots.json` 与 `data/rules.json` 仍是唯一数据真身。
- `scripts/build-spots-snapshot.js` 生成 `miniprogram/data/spots-snapshot.js`、`cloud-assets/data/spots-snapshot.json` 和 manifest。
- 小程序列表、搜索、详情、批量和搜索历史优先读取包内快照；启动后每天最多检查一次 `static/v1/data/` 的新版快照。
- 远程快照不可用时继续使用包内版本，`spots` 云函数只保留旧客户端兼容和紧急回退。
- 修改景点规则后必须重新生成快照；`npm test` 会用 `--check` 阻止提交过期产物。

## 分享与深链

- 景点分享统一落 `pages/spot-hub?spotId=...`。
- 今日放票和国庆场景统一落 `pages/share-scene?sceneId=...`。
- 公开分享链接不携带昵称、OpenID、行程 ID、票务结果或提醒状态。
- 行程只读分享走 `pages/trip-share?token=...`。令牌是唯一授权凭证，服务端按 `trips.shareToken` 查询后输出城市、日期和景点白名单；普通行程接口只暴露 `shareActive`。
- 行程分享在 `endDate + 7 天` 当天仍有效，接收方不可转发到会话或朋友圈；首页右上角菜单仍只分享原公开首页。

## 行程与提醒模型

```text
trips
  └── trip_items
        └── reminder_tasks

reminder_cart 只承载主流程“生成时间线 → 确认行程清单”的提交前暂存区，不属于正式行程。
景点页/详情/分享/首页“约其他日”的快捷入口先由 `cart.planQuickDates` 只读预检，授权与提醒名额通过后由 `cart.quickCommit` 一次性创建行程项与任务，全程不写 reminder_cart。旧版遗留的 pending 同景点日期行由 quickCommit 续用并消费。
```

- `trip_items`：行程 + 景点 + 出行日的最小执行单元。
- `reminder_tasks`：由明确开启提醒且存在 `releaseAt` 的行程项派生，挂 `itemId`；新任务写入 `templateId`，旧任务缺字段时发送侧回退旧订阅模板。无固定放票时刻的行程项只落 `trip_items`，不创建任务。
- `reminder_cart`：主流程提交前清单；提交成功后才创建/合并正式行程并清空。快捷设提醒不进入此暂存区。

## 会员、支付与售后

```text
reminder.membership.createOrder
  -> orders (PENDING)
  -> payment.create
  -> PAYMENT_PROVIDER 选择渠道
     -> 缺省：微信支付 API v3
     -> 显式：小程序虚拟支付
  -> 对应支付回调/查单/2 分钟补偿
  -> 订单与 users 权益事务提交
  -> orders (PAID, entitlementGrant 快照)

用户售后
  -> after_sales_cases
  -> 自动核验 / 客服审核
  -> 原订单所属渠道的退款 API
  -> 对应退款回调或退款查询
  -> 按本单快照回收权益
```

- 免费用户 5 个提醒名额；当前新订单为会员 ¥3/30 天上限 15；有效会员可 ¥3 加购 10 个提醒名额。历史名额包永久按每包 5 个保护，新包按每包 10 个记录，可混合累计；历史订单金额也按快照处理。
- 用户权益账本保存 `taskPackCount` 与 `taskPackSlots`；创建订单、提醒提交、行程项重新开启提醒、权益发放和退款回收共用用户级短期额度锁，锁内重读容量后事务提交。
- 唯一规则在 `cloudfunctions/reminder/lib/membership.js`；`cart.commit` 与 `tripItem.updateReminder` 都必须过同一服务端闸门。
- 老用户历史保护池 `protectedTaskQuota=max(5, 迁移时未来 WAITING 提醒数)`，迁移由管理员分批触发。是否占用新增池由任务创建时的会员灰度决定：`off` / `test` 非白名单写入保护池，`test` 白名单 / `all` 才写新增池。
- 支付渠道按环境开关选择；缺省为微信支付 API v3，`PAYMENT_PROVIDER=VIRTUAL_PAY` 才启用虚拟支付。历史订单保存渠道后继续走原渠道，避免切环境后错误查单或退款。订单展示接口返回派生后的 `paymentChannel=APPLE|WECHAT_VIRTUAL|WECHAT_PAY`，供客户端稳定识别 iOS 退款路径，不暴露原始支付结果。
- 订单只由 `payment` 云函数在渠道回调或主动查单确认后置为 `PAID`；客户端不能自行改会员。虚拟支付发货和退款推送必须再次查询微信订单，不信任客户端或推送正文直接发权益。
- 会员购买总开关存于 `payment_config/membership_sales`，由 `reminder` 与 `payment` 共同读取。暂停只阻止新订单和待支付订单新发起支付；已支付查单、回调发权益、退款和售后不经过该闸门。
- 会员限制模式存于 `payment_config/membership_enforcement`，由 `payment` 管理端写入、`reminder` 每次创建或展示额度时读取。配置缺失或读取失败才回退环境变量；后台切换不需要重新部署，已有任务保留原 `quotaPool`。
- 订单创建必须带 `requestId`，以 OpenID + 请求号生成确定性订单 ID；待支付复用严格匹配完整规格，同请求改商品拒绝。售后同样以请求号幂等，并在订单上维护唯一 `activeAfterSalesCaseId`。
- API v3 回调必须校验微信支付公钥 ID 和原始 body 签名并解密；虚拟支付使用云开发消息推送事件，回包使用 `ErrCode/ErrMsg`，iOS 退款问询额外返回 `IosRefundQueryResponse`。
- `orders.status` 保持 `PENDING/PAID/CLOSED`；退款生命周期独立写入 `refundStatus`，历史 `REFUNDED` 只兼容展示。
- 每笔订单保存权益发放快照；退款成功只回收本单确认发放过的时长和名额包，不删除已有提醒。发放失败订单只记录退款结果，不修改用户权益。
- 虚拟支付 `/xpay/query_order` 没有商品 ID/数量字段；商品身份在下单签名前按套餐配置校验，发放前按订单固化 `virtualProductId` 复核。
- 2 分钟补偿使用 `payment_reconcile_state` 的 `failedGrants / pendingPayments / refundProcessing / autoChecking` 四条独立游标，每队列有批量与时间预算，避免固定前 100 条造成尾部饥饿。
- 售后证据、审核结果和退款单号存 `after_sales_cases`；敏感查看与审核操作写 `admin_audit_logs`。
- 客服工作台通过 `adminOrders.list/detail` 查询全部会员订单，并在读取时按 `orders.userId -> users.openId` 补全昵称、会员状态和已购名额；订单不冗余保存昵称。售后列表同样按 `userId` 补全用户信息。
- 客服工作台通过 `adminOrders.stats` 读取北京时间当日统计：当日创建订单数、已支付数、已退款订单数、已支付金额、已完成退款金额和净赚金额。净赚按当日创建订单的 `paidAmountFen - refundedAmountFen` 计算；退款优先使用订单快照，历史单缺失快照时按原金额，处理中退款不扣。统计不受搜索、筛选和分页影响。
- 客服工作台通过 `adminReminderQuality.stats` 读取 `payment_config/reminder_quality_latest` 的最近一个完整 8 小时时段快照。快照由现有 `paymentReconcileEveryTwoMinutes` 定时器在每日 `13:00 / 21:00` 后的首个 tick 生成；同一窗口重复触发只读取不重算。工作台接口不直接扫 `reminder_events` / `reminder_tasks`，页面优先使用本地缓存，服务端新窗口尚未生成时保留旧值并重试。快照按任务聚合全部 offset 的实际发送延迟、未送达、跳过与证据缺失；前 5 日加权基线不包含昨日。页面只展示当前送达率和前 5 日均值，不在客户端重算 99% 或 120 秒阈值。
- 客服工作台订单列表用 `timeRange=7d|30d|90d|all` 按北京时间订单创建时间过滤，默认 `30d`；搜索、状态和分页共用同一时间窗口，全部历史通过 `all` 显式读取。
- 售后工作台仅对 `AFTER_SALES_ADMIN_OPENIDS` 开放，所有操作服务端二次鉴权。

## 数据真身与镜像

| 数据 | 真身 | 镜像/派生物 |
|---|---|---|
| 景点 | `data/spots.json` | 云函数部署副本、`miniprogram/utils/mock.js`、运营 skill 参考数据 |
| 规则 | `data/rules.json` | 云函数部署副本、`miniprogram/utils/mock.js` |
| seed | `data/seed/*.seed.json` | 测试夹具，不是第四份业务真身 |

任何业务规则出现第二份独立实现都视为高风险，必须通过测试或生成脚本锁定一致性。

## 部署单元

- 小程序：微信开发者工具重新编译。
- 云函数：逐个右键部署，部署顺序和范围见 `.claude/rules/deployment.md`。
- 数据：先确认规则真身，再同步部署副本、mock 和 seed 派生夹具。

## 身份与反馈

- 登录为无感登录，首次调用用户接口时惰性创建资料。
- 昵称和头像只能来自用户主动选择或系统生成占位，不能读取真实微信资料冒充。
- 反馈分建议/Bug；信息纠错必须附景点、纠错类型和描述。
- 反馈管理页只对白名单管理员开放。管理员可对单条反馈写一次回复（就地覆盖，不做多轮对话）：写 `adminReply / adminReplyAt / adminReplyBy` 并同时把状态置为 `PROCESSED`。回复正文与时间对提交者可见，回复人 OpenID 只在管理端返回。
- “我的”页管理员入口位于用户信息卡右侧，不依赖长按。`feedback.entrySummary` 汇总管理员待处理数和当前用户未查看的处理数，客户端缓存 5 分钟。
- 管理员回复或改状态时写 `feedbacks.handledAt`；用户成功打开「我的反馈」后，用 `feedback.list.asOf` 调用 `feedback.markSeen` 推进 `users.feedbackSeenAt`。未读按反馈条数去重，不按操作次数累加。

## 只读 Web 管理后台

- `admin-web/` 是独立桌面端 Vue 3 + Element Plus 应用，部署到 CloudBase 静态托管；第一版使用默认域名，仅用于内部测试。
- Web 端不直连数据库，所有请求都调用 `cloudfunctions/admin/`。
- `admins` 保存独立管理员账号；不和小程序用户 `users` 混用。
- `reminder_events` 是追加式事件账本，任务创建、重建、取消、发送成功/失败/跳过、触发和未送达都会写事件。
- `reminder_daily_stats` 保存永久日汇总；`admin_audit_logs` 保存登录与敏感字段查看审计。
- 事件写入采用 best-effort：统计写失败不得阻断用户创建任务或 notifier 发送提醒。
