# 会员支付、售后与提醒名额

> 2026-11-01 当前状态：会员支付全链路加固代码已完成并部署 `payment` / `reminder`；生产集合、补偿游标和关键索引已创建并核验，名额账本备份、dry-run 与正式迁移均已完成；体验版 `1.1.4` 已上传，**尚未提交审核，也尚未切到会员限制全量**。`payment` 支付白名单已删除，新版客户端新订单全量使用虚拟支付；`MEMBERSHIP_ENFORCEMENT_MODE=test` 保持不变。Android 沙箱、iOS 现网 Apple 支付/平台退款记录仍待真机验收，**微信支付与退款的真实签名 HTTP 回调仍未证实**。新订单价格已于 2026-10-30 调整为 ¥3，文末 ¥2 购买/退款记录仅为调价前历史证据。
>
> 权威业务口径以 `产品文档.md` 为准，接口以 `API-契约.md` 为准，索引以 `数据库索引.md` 为准。

## 1. 产品定义

- 会员不是抢票服务，而是 **30 天提醒名额扩容**。
- 免费版：5 个提醒名额。
- 会员：当前新订单为 ¥3 / 30 天，会员有效期内最多 15 个提醒名额，不自动续费。
- 提醒名额包：当前新订单为 ¥3，每个名额包记录 10 个提醒名额；仅在会员有效期内生效，续费后自动恢复。内部 `task_pack_5` 标识为兼容保留，不代表当前套餐数量。历史包永久按每包 5 个保护，新包按每包 10 个记录，二者允许混合累计。
- 加购名额包时，会员有效期至少延长到支付成功后 30 天。
- 会员到期不删除已有提醒；不保证景点有票，不代抢、不代约。
- 用户侧统一使用「提醒名额」，不再使用「任务位」。
- 老用户历史保护池：`max(5, 上线前当前未来 WAITING 提醒数)`。历史任务与免费/会员/加购新增池独立，不挤占会员新增名额。创建任务时处于 `off` 或 `test` 非白名单的进入保护池；只有 `test` 白名单或 `all` 下创建的任务才计新增池，因此审核等待期不会提前收费。

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
- 15 分钟未支付的本地订单会关闭；客户端确认取消后再次购买必须使用新的 `requestId`、订单 ID 和 `outTradeNo`。同一请求重试返回同一订单；不同请求只有在 `productType + specVersion + addedSlots + memberDays + amountFen` 全部一致且未过期时才复用待支付订单，旧规格订单条件关闭，不能按相同价格误复用。
- 虚拟支付当前没有可调用的平台关单接口；取消时先查单，只有平台未支付或已关闭才关闭本地订单。API v3 仍在确认未支付后调用微信关单接口。
- 创建订单前使用 OpenID 确定性文档 ID 确保用户记录存在，避免并发首购生成重复用户后支付成功无法发放权益。
- 提醒提交、行程项重新开启提醒、创建订单、权益发放和退款回收共用用户文档上的短期额度锁；锁含所有者和过期时间，有限重试并在 `finally` 释放。提醒修改先完成全部字段校验，再在同一事务内修改 `remindOn`、删除旧任务、创建新任务和更新 `lastReminderCreatedAt`。
- 每 2 分钟定时扫描：`PENDING` 订单查单补偿、`PAID_GRANT_FAILED` 重试发放、自动售后核验、退款处理中/失败单同步。四类队列分别在 `payment_reconcile_state` 保存游标，每队列最多 50 条、10 秒，单次总预算 45 秒，超过 100 条时也能持续轮转到尾部。游标集合是可选加速能力：缺失时尝试自动创建；创建或读写仍失败时只降低轮转效率，必须继续扫描业务集合并推进退款，单队列异常也不能阻断后续退款队列。
- 查单成功但权益发放失败：订单保持 `PAID`，写 `grantStatus=FAILED`，自动生成高优先级 `RIGHTS_NOT_RECEIVED` 售后单，不要求用户重复支付。
- 同用户同商品 10 分钟内出现两笔已支付订单时，自动识别较新的订单并进入售后队列；本单未新增提醒时由定时任务自动发起全额退款，已使用则转客服审核。

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
- 退款成功后按订单 `entitlementGrant` 快照回收本单新增会员时长和名额包，不影响其他订单，不删除已有提醒。
- 发放失败的订单只更新退款结果，不修改用户权益。历史订单缺少 `taskPackCountAdded` 时按 1 包兼容、缺少 `taskPackSlotsAdded` 时按本单 `addedSlots`（再缺省为 5）回收；新订单严格以 10 个名额快照为准。
- 用户额度被回收后若当前提醒数超过上限，只禁止继续新增，不删除既有提醒。
- 售后集合：`after_sales_cases`；审计集合：`admin_audit_logs`；补偿游标：`payment_reconcile_state`。
- 客服工作台只对显式配置的 `AFTER_SALES_ADMIN_OPENIDS` 开放；未配置时关闭，不存在代码内置兜底账号。所有查看敏感信息、同步、补发、同意、驳回、重试退款都必须在服务端二次鉴权并写审计日志。
- 老用户保护额度迁移已完成，正式工作台关闭迁移卡；后端仍支持按 50 人一批应急迁移。若未来重新开启入口，最后一批完成后会在 `admin_audit_logs` 写入全局完成标记，所有管理员端隐藏迁移卡，重复调用直接返回；迁移永远不会删除或改写提醒任务。
- 本轮新增名额账本迁移 `afterSales.adminMigrateEntitlementLedger`：先分批执行 `dryRun=true` 输出差异，再按 `users._id` 游标每批 50 人正式迁移。历史包最低按 5 个、新包按权益快照累计；可确认的历史已发放订单标记 `legacyBackfill`，无法确认的订单标记人工核查并创建高优先级售后，不自动重复发放。

## 4. 代码边界

- 唯一提醒名额规则：`cloudfunctions/reminder/lib/membership.js`
- 订单创建：`reminder.membership.createOrder`
- 权益硬闸门：`cart.commit`、`tripItem.updateReminder`
- 支付、查单、退款、定时补偿：`cloudfunctions/payment/index.js`
- 订单状态与权益发放：`cloudfunctions/payment/lib/order.js`
- 用户确定性创建与额度锁：`cloudfunctions/{reminder,payment}/lib/user.js`、`quota-lock.js`
- 售后资格、重复支付证据、管理员历史：`cloudfunctions/payment/lib/after-sales.js`
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

- `test/payment-v3.test.js`
- `test/payment-virtual.test.js`
- `test/payment-order.test.js`
- `test/payment-callback.test.js`
- `test/payment-after-sales.test.js`
- `test/payment-reconcile.test.js`
- `test/payment-refund-callback.test.js`
- `test/membership.test.js`
- `test/membership-ux.test.js`
- `test/membership-pay.test.js`
- `test/order-refresh.test.js`
- `test/mock-mirror.test.js`

云端已验证：

- 2026-11-01 已将 `payment`（15 个文件）与 `reminder`（19 个文件）部署到 `cloud1`；部署前已完整备份 `users`、`orders`、`reminder_tasks`、`after_sales_cases`、`admin_audit_logs`，备份清单包含文件 SHA-256。
- 2026-11-01 复核发现 `payment_reconcile_state` 实际不存在，定时补偿报 `-502005` 后中断，导致已到账退款仍停留“退款中”。工作区已补自动创建与无游标降级，并增加退款队列隔离与状态收口回归；新版 `payment` 部署前该问题仍存在于线上。
- 已创建、核验 `orders_status_id`、`orders_status_grant_id`、`orders_user_status_id`、`after_sales_status_id`；`orders` 共 9 个索引、`after_sales_cases` 共 8 个索引。
- 名额账本迁移 dry-run 共 133 批、扫描 6605 人、预计变更 6597 人、人工核查 0、历史补签 1；正式迁移共 133 批、扫描并更新 6620 人、人工核查 0、历史补签 1，最终 `hasMore=false`。再次执行已返回 `alreadyCompleted=true`，未产生新写入。
- `membership.status` 与 `home.bootstrap` 已完成云端只读冒烟。白名单测试账号处于强制校验状态，会员有效期已到账，当前为免费 5 个 + 历史包 5 个 + 新名额包 10 个，合计最多 25 个提醒名额；订单快照 `taskPackCountAdded=1`、`taskPackSlotsAdded=10`、`grantStatus=GRANTED`。
- `cloud1` 完成一次 ¥2 真实购买，订单为 `PAID / PAID_GRANTED`。
- `cloud1` 完成一次“已使用权益”退款驳回，订单详情和售后详情均展示驳回原因。
- `cloud1` 完成一次 ¥2 真实成功退款：订单 `refundStatus=REFUNDED`、`refundedAmountFen=200`，随后 `grantStatus=REVERTED`，本单权益按快照回收。实测退款到账与权益回收完成相隔约 87 秒，因此页面必须支持该中间态，不能提前显示“权益已全部回收”。
- 关闭微信后的一笔真实订单在约 70 秒后由服务端主动查单/定时补偿确认：订单为 `PAID`，会员有效期与提醒名额已更新，未发生重复发放。
- 微信云开发定时触发器已部署为 `paymentReconcileEveryTwoMinutes`，表达式 `0 */2 * * * * *`。
- 体验版 `1.1.1` 已上传，版本描述为“会员支付全链路加固；退款、名额账本与虚拟支付验证”；本次未提交审核，正式版尚未发布。
- 本轮新增 `utils/order-refresh.js`：仅对未过期待支付、权益补发、退款审核/处理中、以及“退款已到账但权益待回收”的状态每 5 秒静默刷新，最多 30 次；达到上限后保留“下拉刷新或稍后重新进入”提示，终态、`onHide` 和 `onUnload` 立即停止。会员页、订单列表和订单详情均接入，并支持下拉刷新。

仍未完成：

- 体验版 `1.1.1` 的 Android 沙箱支付、权益到账、退款、并发提醒与恢复支付真机验收。
- iOS 现网 Apple 支付、Apple 退款问询和最终平台退款售后记录真机验收。
- 微信支付真实签名回调、微信退款真实签名回调。
- 退款回调失败场景与重复回调的真实环境验证。
- `unpay` 环境真实退款回调端到端验证。
- 正式环境 `MEMBERSHIP_ENFORCEMENT_MODE=all` 切换须在正式版覆盖稳定并完成验收后另行取得明确授权。

⚠️ 测试通过、已提交、已部署、真机验证是不同状态，不能互相替代。
