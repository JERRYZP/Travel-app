# 会员支付、售后与提醒名额

> 2026-11-04 白名单灰度：新方案曾因先部署生产导致旧客户端显示 `11/10000`，已回滚且无新增订单或提醒任务。随后 `MEMBERSHIP_ENFORCEMENT_MODE` 设为 `test`，只有 `MEMBERSHIP_TEST_OPENIDS` 返回 ¥8 不限方案；非白名单完整保持旧 `¥3 / 15 / task_pack_5`。灰度 `payment` / `reminder` 已部署并通过白名单真实云冒烟；本轮只生成预览码，未上传体验版。
>
> 2026-11-02 当前状态：会员购买断路器为 `payment_config/membership_sales=OPEN`（集合权限 `ADMINONLY`），会员限制运行期为 `payment_config/membership_enforcement={mode:"all"}`。`payment` 与 `reminder` 已于 16:14 / 16:15 部署为 `Active`，`paymentReconcileEveryTwoMinutes` 保持启用；管理员接口返回配置来源 `DB`，`membership.status` 返回 `enforced=true`。客服工作台已部署当日统计、近 7 / 30 / 90 天 / 全部筛选和 Apple 超时待支付关闭，并通过云端冒烟。正式客户端 `2.1.1` 已从 `main@af05573` / `v2.1.1-rc.2` 完成体验验收、送审和全量发布，新功能已在正式版可见。累计观察到 8 笔已支付订单。真实停售切换未执行；保护额度完成标记当前缺失，后台从其他模式切回 `all` 前需单独治理。
>
> 权威业务口径以 `产品文档.md` 为准，接口以 `API-契约.md` 为准，索引以 `数据库索引.md` 为准。

## 1. 产品定义

- 会员不是抢票服务，而是 **30 天提醒名额扩容**。
- 免费版：5 个提醒名额。
- 会员：当前新订单为 ¥8 / 30 天，会员有效期内不限提醒名额，不自动续费。新购买或续费在原有效期末尾增加 30 天；已过期会员从支付成功时起算 30 天。
- 方案灰度复用 `MEMBERSHIP_ENFORCEMENT_MODE`：生产验收期间必须为 `test`，只有 `MEMBERSHIP_TEST_OPENIDS` 命中用户返回 ¥8 不限方案；非白名单继续完整旧契约 `¥3 / 15 个 / task_pack_5`。`all` 只在用户明确授权全量后切换，不能与数据库额度限制模式混为一谈。
- 当前有效老会员自动获得不限权益，`memberExpiresAt` 不变，不执行批量权益写入。
- 提醒加量包停止新售，`membership.createOrder` 只接受 `member`；历史 `task_pack_5` 待支付订单仍可按订单快照完成，历史包继续用于展示、对账和退款，但不再参与会员额度计算。
- 微信订阅消息仍需按条授权；“不限提醒名额”不替代订阅授权，会员到期不删除已有提醒；不保证景点有票，不代抢、不代约。
- 用户侧统一使用「提醒名额」，不再使用「任务位」。
- 老用户历史保护池：`max(5, 上线前当前未来 WAITING 提醒数)`。历史任务与免费/会员新增池独立，不挤占会员不限权益。创建任务时处于 `off` 或 `test` 非白名单的进入保护池；只有 `test` 白名单或 `all` 下创建的任务才计新增池，因此审核等待期不会提前收费。

## 2. 支付可靠性

支付协议有两套并行实现，缺省仍为已经跑通的微信支付 API v3；只有云函数设置 `PAYMENT_PROVIDER=VIRTUAL_PAY` 时才开放小程序虚拟支付。灰度联调可用 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS` 限定测试账号，非白名单用户继续 API v3；2026-11-01 已从 `cloud1` 删除该白名单，新版客户端新订单进入虚拟支付全量。两条链路共用订单、查单、售后和权益快照，不得复制第二套会员规则。

API v3 事实链：

```text
客户端创建服务端订单
→ 微信支付 API v3 JSAPI 下单
→ wx.requestPayment 只代表客户端流程结束
→ 回调验签 + 主动查单 / 2 分钟补偿
→ 服务端取得 trade_state=SUCCESS
→ 订单与权益在同一事务提交
→ payment.query 返回 PAID_GRANTED
```

虚拟支付事实链：

```text
客户端创建服务端订单
→ payment.create 换取 signData / paySig / signature
→ wx.requestVirtualPayment（Android 微信支付；iOS Apple 支付）
→ xpay_goods_deliver_notify 或 payment.query / 2 分钟补偿
→ 服务端再次调用 /xpay/query_order 校验订单、环境、实付金额和固化商品快照
→ 订单与权益在同一事务提交
→ payment.query 返回 PAID_GRANTED
```

iOS Apple 内购订单在订单展示接口中返回 `paymentChannel=APPLE`。会员页购买说明和支付确认层按设备区分文案：iOS 明确退款申请与审核由 Apple 独立处理，小程序客服无法决定结果，确认层只在条件句中提示可在 App Store 购买记录申请；Android 保留 24 小时未使用、客服核实口径。订单详情提供完整说明。Apple 审核期间会员与提醒名额继续有效，拒绝退款时不回收；只有 Apple 确认退款并推送退款结果、服务端再次查单确认后，才按订单权益快照回收，且不删除已有提醒。

### 支付窗口拉不起来怎么查

症状：用户点支付后没有出现微信 / Apple 支付面板，订单停在待支付。

先排除一个假线索：**后台「支付渠道」显示「微信虚拟支付」不能说明用户是 Android 还是 iOS。** 该标签由 `paymentProvider=VIRTUAL_PAY` 触发；能判定 Apple 的 `channelOrderType`（订单类型 7 / 8）只在查单成功后才写入，待支付订单还没查过单，必然显示「微信虚拟支付」。判定逻辑见 `after-sales.js` 的 `paymentChannelOf`。

真正的分界是订单的 `wxOrderId`：

- 为空：微信侧没有建单，客户端 `wx.requestVirtualPayment` 没拉起来，属设备侧问题。
- 有值：面板弹出过，卡在支付渠道侧或用户未完成。

设备侧条件分两类：

- **客户端读得到**：`wx.requestVirtualPayment` 是否存在（`virtualPayCapability`）、微信客户端版本（`getAppBaseInfo().version`）、系统版本（`getDeviceInfo().system`）。
- **客户端读不到**：Apple ID 地区、Apple ID 支付方式。微信不开放，只能由用户在 App Store 侧自查或客服询问。Apple 官方支持说明中国大陆 Apple 账户可使用微信支付，iPhone 路径为「设置 > 你的姓名 > 付款与配送 > 添加付款方式」；只有平台明确提示付款方式不可用时才展示该路径，不能把它写成所有 iOS 支付失败的通用解法。来源：<https://support.apple.com/zh-cn/111741>、<https://support.apple.com/zh-cn/118429>。

所以 iOS 支付失败**不可能全部自动归因**，能覆盖的只有版本类问题。

会员页在能力缺失时点支付只弹说明、不建单（`showPayUnsupported`）；拉起失败时失败卡按平台给出自查路径，并把当前微信版本与系统版本一起摊开（`payEnvTextOf`）——用户能对照自查，客服也不必再问一遍。设备条件文案的真身是 `payUnsupportedTipOf`（页面）和 `payHintOf`（支付确认组件），不要在别处复制第三份。

版本信息**只用于展示，不参与拦截**。版本门槛（iOS 15 / 微信 8.0.68）来自本文档第 2 节和 `payment-virtual-runbook.md`，没有和微信官方原文逐条复核过；拿没核实的阈值拦真实用户，可能把本来能付款的人挡在外面。拦截只用「`wx.requestVirtualPayment` 是否存在」这一条确定事实。

### 会员购买断路器

- `payment_config/membership_sales` 是唯一配置真身，`state=OPEN|PAUSED`。它独立于会员限制模式，不能拿限制模式代替停售。
- 暂停后，`membership.createOrder` 和待支付订单的 `payment.create` 返回 `1032`；不能创建新订单或从服务端新拉起支付。
- 已经进入微信/Apple 支付窗口的订单仍可能完成，必须继续接收回调、主动查单、发权益和自动补偿；不得因停售拒绝已付款订单。
- 已生效会员、提醒名额、订单列表、订单详情、退款和售后全部不受停售影响。待支付订单仍可查看、取消和同步，但 `canPay/canRebuy=false`。
- 配置文档缺失时默认开放；配置集合读取失败时新购买失败关闭，但会员状态与订单读取继续。上线前必须先创建 `payment_config` 集合。
- 管理切换仅 `AFTER_SALES_ADMIN_OPENIDS` 白名单可调用；暂停必须填写原因，切换写 `admin_audit_logs`。

### 会员限制模式开关

- `payment_config/membership_enforcement` 是运行期唯一真身，`mode=off|test|all`。`payment` 负责管理员写入，`reminder` 在额度状态和新建任务时读取。
- `off` 让新任务进入历史保护池；`test` 只限制 `MEMBERSHIP_TEST_OPENIDS`；`all` 让所有新任务按免费 5 个或会员不限规则校验。
- 切换只影响之后新建任务，已有任务保留原 `quotaPool`，不追溯重算。一次任务提交使用同一份模式快照，避免切换中途出现半旧半新。
- 切 `all` 前服务端强制检查保护额度迁移和权益账本迁移，任一未完成返回 `1033`。所有切换写 `SET_MEMBERSHIP_ENFORCEMENT` 审计。
- 配置缺失、非法或读取失败时，`reminder` 回退 `MEMBERSHIP_ENFORCEMENT_MODE`。后台显示“环境变量兜底”，不猜测当前有效模式。
- 客服工作台顺序固定为会员购买开关、会员限制模式、资金阻断、页签与列表；购买开关保持在页面最顶部。

- 支付回调与退款回调都使用微信支付公钥模式，校验 `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Signature`、`Wechatpay-Serial`。
- `cloud1` 的 HTTP 路由已用错误签名请求验证可达并返回 401；真实签名的支付/退款回调样本尚未观察到，因此回调代码路径存在不等于端到端已通过。当前真实支付与退款到账由客户端查单、定时补偿和主动退款查询完成。
- 验签必须使用 HTTP 网关提供的原始 body；不得 JSON 序列化后重新签名。
- 回调必须校验时间戳窗口、微信支付公钥 ID、AppID、商户号、商户订单号、金额、交易状态和资源解密结果。
- 下单、查单、关单、退款、退款查询的微信响应也必须验签；缺少响应验签公钥时 `hasApiConfig=false`，不允许静默跳过。
- 支付回调只有在订单与权益事务提交成功后才返回 200；验签失败返回 401，内部处理失败返回 5xx 让微信重试。
- 虚拟支付消息推送使用云函数事件而不是 API v3 验签；发货、退款事件仍必须先调用 `/xpay/query_order` 二次确认。云开发消息推送会把事件中的 `OpenId` 映射成调用上下文 `OPENID`，因此入口不能再按“有 OPENID 就是客户端”拒绝，而应按 `SOURCE` 拒绝 `wx_client`、`wx_devtools`、`wx_localdebug` 等客户端来源；平台 `wx_paycallback` 来源即使带 OPENID 也必须放行后再查单复核。客户端 HTTP 回调形态继续拒绝。
- `/xpay/query_order` 官方响应没有 `productId/buyQuantity`。下单签名前必须校验订单 SKU 与套餐配置，发放前必须校验订单保存的 `virtualProductId`；有可用 `biz_meta` 时再核对版本化附加标识。商品快照缺失或不一致时不得继续自动发权益，应落 `grantStatus=FAILED` 并转人工核验。
- 虚拟支付退款推送处理 `xpay_refund_notify`；iOS 退款问询处理 `xpay_subscribe_ios_refund_query_notify`，后者必须在 3 秒内返回。Apple 退款查单返回 `status=5`（商户侧扣款完成）时先幂等补建/更新“处理中”售后记录，不提前回收权益；只有查单到 `status=8`（用户侧收款完成）才标记已退款并按订单快照回收。
- 订单固化支付渠道与虚拟支付环境：API v3 在首次拉起支付前写入 `paymentProvider=WECHAT_PAY_V3`；虚拟支付写入 `paymentProvider=VIRTUAL_PAY`、`virtualEnv` 和 `virtualProductId`。历史订单查单、退款按订单快照选择渠道、环境和 AppKey。
- 日志记录路由、`outTradeNo` / `outRefundNo`、公钥 ID、时间戳、原始 body SHA-256、验签结果和失败原因；不记录私钥、APIv3 密钥或完整签名。
- 15 分钟未支付的本地订单会关闭；查单确认平台未支付且本地已过期时按 `VIRTUAL_PAY_EXPIRED_UNPAID` 关闭，后续若平台确认实际支付仍可从 `CLOSED` 收口为 `PAID`。判断不再要求平台明确返回 `INIT/CREATED`：排除“平台确认已支付”和“平台确认已关闭”之后，只要本地过期就收口，避免 5/7/8 等状态让订单永久停留在待支付。客户端确认取消后再次购买必须使用新的 `requestId`、订单 ID 和 `outTradeNo`。同一请求重试返回同一订单；不同请求只有在 `productType + specVersion + addedSlots + memberDays + amountFen` 全部一致且未过期时才复用待支付订单，旧规格订单条件关闭，不能按相同价格误复用。
- 虚拟支付查单抛异常（平台没有这笔订单、接口报错）时不能原地无限重试。补偿先写失败证据 `reconcileError` / `reconcileErrorAt` / `reconcileFailCount`；本地订单过期满 30 分钟仍拿不到平台结论，按 `VIRTUAL_PAY_QUERY_FAILED` 关闭。虚拟支付配置缺失同样走这条路径，关闭原因 `VIRTUAL_PAY_CONFIG_MISSING`，不得再静默返回成功。
- 关单不等于吞掉真实支付：已关闭且已过期的订单在任何一次查单或平台发货推送中都会重新核对，平台确认支付后从 `CLOSED` 收口为 `PAID` 并补发权益。已关闭订单不在待支付补偿队列里，收口依赖平台消息推送或一次主动查单，客服可用售后工作台的「同步支付结果」触发。
- 虚拟支付当前没有可调用的平台关单接口；取消时先查单，只有平台未支付或已关闭才关闭本地订单。API v3 仍在确认未支付后调用微信关单接口。
- 创建订单前使用 OpenID 确定性文档 ID 确保用户记录存在，避免并发首购生成重复用户后支付成功无法发放权益。
- 提醒提交、行程项重新开启提醒、创建订单、权益发放和退款回收共用用户文档上的短期额度锁；锁含所有者和过期时间，有限重试并在 `finally` 释放。提醒修改先完成全部字段校验，再在同一事务内修改 `remindOn`、删除旧任务、创建新任务和更新 `lastReminderCreatedAt`。
- 每 2 分钟定时扫描：`PENDING` 订单查单补偿、`PAID_GRANT_FAILED` 重试发放、自动售后核验、退款处理中/失败单同步。四类队列分别在 `payment_reconcile_state` 保存游标，每队列最多 50 条、10 秒，单次总预算 45 秒，超过 100 条时也能持续轮转到尾部。游标集合是可选加速能力：缺失时尝试自动创建；创建或读写仍失败时只降低轮转效率，必须继续扫描业务集合并推进退款，单队列异常也不能阻断后续退款队列。
- 每轮补偿结束都写 `payment_config/reconcile_health`：`lastRunAt`、`lastDurationMs`、`skipped`、`reason`、`errors`、`queues`、`error`。正常轮次、`NO_RECONCILE_WORK` 跳过、`PAYMENT_NOT_READY` 跳过和异常轮次都写。**`lastRunAt` 不再更新说明定时器没跑；`lastRunAt` 在更新但 `errors > 0` 说明补偿在跑但一直失败。** 这是区分这两种故障的唯一稳定信号，排障时先看它再翻日志。
- 查单成功但权益发放失败：订单保持 `PAID`，写 `grantStatus=FAILED`，自动生成高优先级 `RIGHTS_NOT_RECEIVED` 售后单，不要求用户重复支付。
- 同用户同商品 **1 分钟内**出现两笔已支付订单时，自动识别较新的订单并生成一条**只给客服看的核验工单**。窗口不能放大到分钟级之外，以免把正常续费误判成重复支付。
- 系统自查的重复单**不自动退款，也不写订单状态**：建单时不置 `refundStatus`、不占用 `activeAfterSalesCaseId`，自动核验后只会转 `UNDER_REVIEW` 等人工判断；客服驳回时也只关工单、不把订单写成 `REJECTED`。用户没有申请过售后，打开订单必须仍是正常的「权益已到账」。
- 系统自查单通过 `evidence.reviewOnly=true` 标记，并在 `afterSales.list` 里对用户隐藏；用户自己提交的售后单不受影响，照常可见可驳回。
- **Apple 订单不生成重复支付工单**：iOS 退款只能由用户在 App Store 发起，服务端不能代退，客服也没有可执行动作，建单只会产生一条处理不了的记录。跳过时打 `[payment] skip duplicate charge case for apple order` 日志保留观测。`RIGHTS_NOT_RECEIVED`（我们没发权益）和平台退款补建记录不受此限，Apple 订单照常处理。

支付主状态：

```text
PENDING -> PAID
PENDING -> CLOSED
PAID    -> 不回到 PENDING
```

退款生命周期独立：

```text
orders.refundStatus = NONE
  | REQUESTED | UNDER_REVIEW | PROCESSING
  | REFUNDED | REJECTED | FAILED
```

`orders.status=REFUNDED` 仅兼容历史数据；新流程不写这个主状态。

## 3. 售后与退款

用户资格：

- 支付后 24 小时内，且支付后没有新增任何提醒，可提交未使用退款申请。
- 提醒创建后即使被删除，仍算已使用；依据 `users.lastReminderCreatedAt`。
- 未到账、重复支付、系统故障优先自动查单、补发或核验退款。
- 售后提交必须带 `requestId`；同一用户、订单和请求号幂等。订单事务内维护唯一 `activeAfterSalesCaseId`，并发点击或重复消息只能存在一条活动售后，终态后清空指针。
- 已新增提醒、超过 24 小时、权益正常或无正当理由，原则上驳回；特殊情况由客服复核。
- 每个订单最多一次全额退款；V1 不做部分退款。

售后状态：

```text
AUTO_CHECKING -> UNDER_REVIEW -> APPROVED -> PROCESSING -> REFUNDED
UNDER_REVIEW -> REJECTED
PROCESSING   -> REFUND_FAILED -> UNDER_REVIEW
RIGHTS_NOT_RECEIVED 补发成功后 -> RESOLVED
```

- 退款调用 `POST /v3/refund/domestic/refunds`，`outRefundNo` 由原商户订单号确定性生成，网络重试不重复退款。
- 退款结果只认退款回调或主动退款查询；客户端操作成功不代表到账。
- 退款成功后按订单 `entitlementGrant` 快照回收本单新增会员时长和权益，不影响其他订单，不删除已有提醒。
- 发放失败的订单只更新退款结果，不修改用户权益。新会员订单以 `memberDaysAddedMs` 和 `unlimitedReminders=true` 快照记录权益；历史加量包继续按历史包数及名额快照回收。
- 用户额度被回收后若当前提醒数超过上限，只禁止继续新增，不删除既有提醒。
- 售后集合：`after_sales_cases`；审计集合：`admin_audit_logs`；补偿游标：`payment_reconcile_state`。
- 客服工作台只对显式配置的 `AFTER_SALES_ADMIN_OPENIDS` 开放；未配置时关闭，不存在代码内置兜底账号。所有查看敏感信息、同步、补发、同意、驳回、重试退款都必须在服务端二次鉴权并写审计日志。
- 老用户保护额度迁移曾在 2026-11-01 执行，但 2026-11-02 复核发现全局完成标记缺失，不能把当前 `migrationCompleted=false` 当成已完成。后端仍支持按 50 人一批应急迁移；最后一批完成后会在 `admin_audit_logs` 写入全局完成标记，所有管理员端隐藏迁移卡，重复调用直接返回；迁移永远不会删除或改写提醒任务。
- 本轮新增名额账本迁移 `afterSales.adminMigrateEntitlementLedger`：先分批执行 `dryRun=true` 输出差异，再按 `users._id` 游标每批 50 人正式迁移。历史包最低按 5 个、新包按权益快照累计；可确认的历史已发放订单标记 `legacyBackfill`，无法确认的订单标记人工核查并创建高优先级售后，不自动重复发放。

### 客服工作台

- 小程序客服工作台使用 `adminOrders.list/detail` 查询全部会员订单，使用 `afterSales.admin*` 管理售后；两端复用 `AFTER_SALES_ADMIN_OPENIDS` 白名单。
- 会员购买开关固定在工作台最顶部，下面为「会员订单 / 售后工单」双页签。
- 订单和售后均按 `userId -> users.openId` 关联当前昵称、完整 OpenID、会员到期和已购名额；订单不冗余保存昵称。
- 搜索支持订单号、订单 ID、售后单号、完整 OpenID 和昵称。前四类精确匹配，昵称部分匹配；搜索结果必须在服务端二次鉴权后才返回。
- 查看订单详情写 `VIEW_ADMIN_ORDER_DETAIL`，搜索订单和售后分别写 `SEARCH_ADMIN_ORDERS` / `SEARCH_ADMIN_AFTER_SALES`。审计不记录原始搜索词和交易号全文。

## 4. 代码边界

- 唯一提醒名额规则：`cloudfunctions/reminder/lib/membership.js`
- 会员购买开关：`cloudfunctions/{reminder,payment}/lib/membership-sales.js`
- 订单创建：`reminder.membership.createOrder`
- 权益硬闸门：`cart.commit`、`tripItem.updateReminder`
- 支付、查单、退款、定时补偿：`cloudfunctions/payment/index.js`
- 订单状态与权益发放：`cloudfunctions/payment/lib/order.js`
- 用户确定性创建与额度锁：`cloudfunctions/{reminder,payment}/lib/user.js`、`quota-lock.js`
- 售后资格、重复支付证据、管理员历史：`cloudfunctions/payment/lib/after-sales.js`
- 客服工作台订单查询：`cloudfunctions/payment/lib/admin-orders.js`
- 客服用户搜索与昵称补全：`cloudfunctions/payment/lib/admin-directory.js`
- 老用户迁移：`cloudfunctions/payment/lib/migration.js`
- 会员购买页：`miniprogram/pages/membership/`
- 设置提醒内付费入口：`miniprogram/pages/setup/`
- 订单列表与详情：`membership-orders`（`membership.orders`）、`membership-order-detail`（`membership.orderDetail`）
- 用户售后：`membership-after-sales`
- 售后工作台：`admin-after-sales`
- API v3 支付运行手册（保留，不删除）：`docs/engineering/payment-v3-runbook.md`
- 虚拟支付运行手册：`docs/engineering/payment-virtual-runbook.md`

## 5. 当前验证状态

本地已通过：

- 2026-11-04 会员不限权益候选：`npm test`、`npm run check`、`npm run test:admin-web` 与 `git diff --check` 通过；覆盖有效老会员超过旧 15 条上限仍可创建、到期时间不变、过期回免费 5 条、¥8 新订单、停售加量包拒绝新下单、旧价订单继续支付、退款快照和 mock 一致性。
- `test/payment-v3.test.js`
- `test/payment-virtual.test.js`
- `test/payment-order.test.js`
- `test/payment-callback.test.js`
- `test/payment-after-sales.test.js`
- `test/payment-reconcile.test.js`
- `test/payment-refund-callback.test.js`
- `test/membership.test.js`
- `test/membership-sales.test.js`
- `test/admin-orders.test.js`
- `test/membership-ux.test.js`
- `test/membership-pay.test.js`
- `test/order-refresh.test.js`
- `test/mock-mirror.test.js`

云端已验证：

- 2026-11-04 会员升级生产回滚：生产曾于 14:36 部署新方案并通过真实云模拟器冒烟，但旧线上客户端在“我的”页把兼容字段 `taskLimit=10000` 显示为 `11/10000`。14:48 已从 `e308752` 回滚 `payment` / `reminder`，均为 `Active`、Nodejs16.13、60 秒；`paymentReconcileEveryTwoMinutes` 与 20 个环境变量键保留。云端下载代码复核为 `MEMBER_PRICE_FEN=300`、`MEMBER_TASK_SLOTS=15`，且 `payment` 不再包含 `unlimitedReminders`。体验版 `2.3.0` 依赖新后端，当前不得用于验收。
- 2026-11-04 白名单灰度：`reminder` 环境变量拉取核验为 `MEMBERSHIP_ENFORCEMENT_MODE=test`、白名单 3 个 OpenID；数据库 `payment_config/membership_enforcement.mode=all` 继续负责额度限制。`payment` / `reminder` 于 14:59:47 / 15:02:14 部署为 `Active`、Nodejs16.13、60 秒，`paymentReconcileEveryTwoMinutes` 和 20 个支付环境变量保留。真实云白名单 `membership.status` 返回 `planVersion=unlimited-v3`、`taskLimitUnlimited=true`、唯一 `member` / ¥8；模拟器会员页显示“已开启 11 个提醒 / 不限名额”。本地回归覆盖非白名单保持 `legacy-v2` / ¥3 / 15 / task_pack_5。仅生成真机预览码，未上传体验版。
- 2026-11-04 00:05 已从 `codex/unify-reminder-payment-sheet@1f9cfc4` 上传体验版 `2.2.5`，包体 `1,127,622` 字节，tag 为 `v2.2.5-rc.1`。本版统一 PAGE-008、景点设提醒浮层与会员页的支付确认层，协议默认未勾选且未勾选不能支付；iOS / Android 渠道提示继续按设备区分。本轮只改小程序端，不部署云函数；未提交审核、未发布正式版。
- 2026-11-03 23:43 已将 `payment` 整包部署到 `cloud1`，保留 Nodejs16.13 与 60 秒超时；真实管理员 `adminOrders.stats` 已返回 `refundedOrders=8`。`paymentReconcileEveryTwoMinutes` 触发器保留，`payment_config/reconcile_health.lastRunAt` 于 23:44:01 刷新且 `errors=0`。
- 2026-11-03 23:45 已从 `main@aa1db3b` 上传体验版 `2.2.4`，包体 `1,129,989` 字节，tag 为 `v2.2.4-rc.1`。本版包含客服售后队列与退款统计、iOS 付款方式提示、反馈入口与未读角标；未提交审核、未发布正式版。
- 2026-11-02 客户端 `2.1.0` 已审核通过并全量发布；累计观察到 8 笔已支付订单，用户完成付费流程自测且客服工作台正常。`reminder` 的 `MEMBERSHIP_ENFORCEMENT_MODE` 已切换为 `all`，配置更新时间为 15:10:02。
- 2026-11-02 16:24 已将 `main` fast-forward 到 `af05573`、创建并推送 `v2.1.1-rc.2`，随后从该提交上传体验版 `2.1.1`；包体约 982.4 KB。体验验收通过后已送审并全量发布，正式版确认可见新功能。首次重新打开可能仍运行旧包，冷启动后微信会切换到新版本。
- 2026-11-02 16:15 已部署运行期会员限制开关：`payment_config/membership_enforcement={mode:"all"}` 由管理员 OpenID 写入并回读确认；`payment` / `reminder` 均为 `Active`，部署保留原环境变量键，`membership.status` 返回 `enforced=true`、购买状态 `OPEN`、免费/会员额度 5 / 15。开发者工具工作台已从“待部署”刷新为“全部用户”；16:18:10 的真实新任务写入 `quotaPool=ENTITLEMENT`，部署后 30 分钟日志中两函数均无非 202 失败状态码。
- 2026-11-02 客服工作台订单统计与时间筛选已通过云端冒烟：今日 36 单、已支付 23 单、支付 ¥69、退款 ¥6、净赚 ¥63；`adminOrders.list(timeRange=all)` 返回历史 70 单，并包含用户昵称、完整 OpenID 和分页字段。
- 2026-11-02 两笔历史 Apple 未支付订单已由部署后的定时补偿在 16:16:01 关闭，`closeReason=VIRTUAL_PAY_EXPIRED_UNPAID`；当前待支付订单为 0。
- 2026-11-02 部署后核验发现 `PROTECTION_MIGRATION_COMPLETE` 审计标记缺失，工作台返回 `migrationCompleted=false`；9419 个用户中 9361 个已有 `protectionMigratedAt`，权益账本迁移完成标记为 `true`。该问题不阻断当前数据库配置 `all` 生效，但会阻断后台后续切回 `all`。
- 2026-11-02 已将含会员购买断路器和客服工作台的 `payment`（18 个文件）部署到 `cloud1`；`payment` 为 `Active`，部署包包含 `adminOrders.list/detail`。真实管理员接口冒烟返回会员订单、当前昵称、完整 OpenID 和订单详情；售后昵称搜索可用；`membership.status` 返回 `sales.state=OPEN`。部署后 15 分钟无 `payment` 5xx，`paymentReconcileEveryTwoMinutes = 0 */2 * * * * *` 保持启用。
- 2026-11-01 已将 `payment`（15 个文件）与 `reminder`（19 个文件）部署到 `cloud1`；部署前已完整备份 `users`、`orders`、`reminder_tasks`、`after_sales_cases`、`admin_audit_logs`，备份清单包含文件 SHA-256。
- 2026-11-01 复核发现 `payment_reconcile_state` 实际不存在，定时补偿报 `-502005` 后中断，导致已到账退款仍停留“退款中”。工作区已补自动创建与无游标降级，并增加退款队列隔离与状态收口回归；新版 `payment` 部署前该问题仍存在于线上。
- 已创建、核验 `orders_status_id`、`orders_status_grant_id`、`orders_user_status_id`、`after_sales_status_id`；`orders` 共 9 个索引、`after_sales_cases` 共 8 个索引。
- 名额账本迁移 dry-run 共 133 批、扫描 6605 人、预计变更 6597 人、人工核查 0、历史补签 1；正式迁移共 133 批、扫描并更新 6620 人、人工核查 0、历史补签 1，最终 `hasMore=false`。再次执行已返回 `alreadyCompleted=true`，未产生新写入。
- `membership.status` 与 `home.bootstrap` 已完成云端只读冒烟。2026-11-01 当时白名单测试账号为免费 5 个 + 历史包 5 个 + 新名额包 10 个，合计最多 25 个提醒名额；该有限额度口径已被 2026-11-04 本地候选替换，生产仍以已部署版本为准。
- `cloud1` 完成一次 ¥2 真实购买，订单为 `PAID / PAID_GRANTED`。
- `cloud1` 完成一次“已使用权益”退款驳回，订单详情和售后详情均展示驳回原因。
- `cloud1` 完成一次 ¥2 真实成功退款：订单 `refundStatus=REFUNDED`、`refundedAmountFen=200`，随后 `grantStatus=REVERTED`，本单权益按快照回收。实测退款到账与权益回收完成相隔约 87 秒，因此页面必须支持该中间态，不能提前显示“权益已全部回收”。
- 关闭微信后的一笔真实订单在约 70 秒后由服务端主动查单/定时补偿确认：订单为 `PAID`，会员有效期与提醒名额已更新，未发生重复发放。
- 微信云开发定时触发器已部署为 `paymentReconcileEveryTwoMinutes`，表达式 `0 */2 * * * * *`。
- 历史记录：体验版 `1.1.1` 曾以“会员支付全链路加固；退款、名额账本与虚拟支付验证”上传；该版本未提交审核。
- 本轮新增 `utils/order-refresh.js`：仅对未过期待支付、权益补发、退款审核/处理中、以及“退款已到账但权益待回收”的状态每 5 秒静默刷新，最多 30 次；达到上限后保留“下拉刷新或稍后重新进入”提示，终态、`onHide` 和 `onUnload` 立即停止。会员页、订单列表和订单详情均接入，并支持下拉刷新。

仍未完成：

- `2.1.0` 的 Android/iOS 分渠道覆盖矩阵仍需补全；当前已有 8 笔支付样本，但不能替代沙箱异常场景验收。
- iOS 现网 Apple 支付、Apple 退款问询和最终平台退款售后记录真机验收。
- 微信支付真实签名回调、微信退款真实签名回调。
- 退款回调失败场景与重复回调的真实环境验证。
- `unpay` 环境真实退款回调端到端验证。
- 运行期配置 `membership_enforcement.mode=all` 已生效，需继续观察部署后真实新建提醒是否全部写入 `quotaPool=ENTITLEMENT`，并完成 `off/test/all` 真机切换、二次确认和边界提醒验证。
- 保护额度完成标记缺失：需先核验迁移覆盖与剩余 58 个缺少 `protectionMigratedAt` 的用户，再决定补写完成标记或重新执行迁移；完成后才能验证后台切回 `all` 的 1033 闸门。

⚠️ 测试通过、已提交、已部署、真机验证是不同状态，不能互相替代。
