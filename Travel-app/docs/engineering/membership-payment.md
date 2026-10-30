# 会员支付、售后与提醒名额

> 2026-10-30 工作区状态：服务端基线提交为 `6fbeeaf`，支付/退款页面有界自动刷新已提交到当前分支；`reminder`、`payment` 已部署到 `cloud1`，真实购买、退款驳回、一次真实成功退款、退款后权益回收和关闭小程序后查单到账均已验证；**微信支付与退款的真实签名 HTTP 回调仍未证实**。新订单价格已于 2026-10-30 调整为 ¥3，文末 ¥2 购买/退款记录仅为调价前历史证据。
>
> 权威业务口径以 `产品文档.md` 为准，接口以 `API-契约.md` 为准，索引以 `数据库索引.md` 为准。

## 1. 产品定义

- 会员不是抢票服务，而是 **30 天提醒名额扩容**。
- 免费版：5 个提醒名额。
- 会员：当前新订单为 ¥3 / 30 天，会员有效期内最多 10 个提醒名额，不自动续费。
- 提醒名额包：当前新订单为 ¥3，每个名额包记录 5 个提醒名额；仅在会员有效期内生效，续费后自动恢复。
- 加购名额包时，会员有效期至少延长到支付成功后 30 天。
- 会员到期不删除已有提醒；不保证景点有票，不代抢、不代约。
- 用户侧统一使用「提醒名额」，不再使用「任务位」。
- 老用户历史保护池：`max(5, 上线前当前未来 WAITING 提醒数)`。历史任务与免费/会员/加购新增池独立，不挤占会员新增名额。创建任务时处于 `off` 或 `test` 非白名单的进入保护池；只有 `test` 白名单或 `all` 下创建的任务才计新增池，因此审核等待期不会提前收费。

## 2. 支付可靠性

唯一事实链：

```text
客户端创建服务端订单
→ 微信支付 API v3 JSAPI 下单
→ wx.requestPayment 只代表客户端流程结束
→ 回调验签 + 主动查单 / 2 分钟补偿
→ 服务端取得 trade_state=SUCCESS
→ 订单与权益在同一事务提交
→ payment.query 返回 PAID_GRANTED
```

- 支付回调与退款回调都使用微信支付公钥模式，校验 `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Signature`、`Wechatpay-Serial`。
- `cloud1` 的 HTTP 路由已用错误签名请求验证可达并返回 401；真实签名的支付/退款回调样本尚未观察到，因此回调代码路径存在不等于端到端已通过。当前真实支付与退款到账由客户端查单、定时补偿和主动退款查询完成。
- 验签必须使用 HTTP 网关提供的原始 body；不得 JSON 序列化后重新签名。
- 回调必须校验时间戳窗口、微信支付公钥 ID、AppID、商户号、商户订单号、金额、交易状态和资源解密结果。
- 下单、查单、关单、退款、退款查询的微信响应也必须验签；缺少响应验签公钥时 `hasApiConfig=false`，不允许静默跳过。
- 支付回调只有在订单与权益事务提交成功后才返回 200；验签失败返回 401，内部处理失败返回 5xx 让微信重试。
- 日志记录路由、`outTradeNo` / `outRefundNo`、公钥 ID、时间戳、原始 body SHA-256、验签结果和失败原因；不记录私钥、APIv3 密钥或完整签名。
- 15 分钟未支付的本地订单会关闭；再次购买创建新订单。同一商品存在未过期 `PENDING` 订单时复用。
- 每 2 分钟定时扫描：`PENDING` 订单查单补偿、`PAID_GRANT_FAILED` 重试发放、自动售后核验、退款处理中/失败单同步。
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
- 用户额度被回收后若当前提醒数超过上限，只禁止继续新增，不删除既有提醒。
- 售后集合：`after_sales_cases`；审计集合：`admin_audit_logs`。
- 客服工作台只对显式配置的 `AFTER_SALES_ADMIN_OPENIDS` 开放；未配置时关闭，不存在代码内置兜底账号。所有查看敏感信息、同步、补发、同意、驳回、重试退款都必须在服务端二次鉴权并写审计日志。
- 老用户保护额度迁移已完成，正式工作台关闭迁移卡；后端仍支持按 50 人一批应急迁移。若未来重新开启入口，最后一批完成后会在 `admin_audit_logs` 写入全局完成标记，所有管理员端隐藏迁移卡，重复调用直接返回；迁移永远不会删除或改写提醒任务。

## 4. 代码边界

- 唯一提醒名额规则：`cloudfunctions/reminder/lib/membership.js`
- 订单创建：`reminder.membership.createOrder`
- 权益硬闸门：`cart.commit`、`tripItem.updateReminder`
- 支付、查单、退款、定时补偿：`cloudfunctions/payment/index.js`
- 订单状态与权益发放：`cloudfunctions/payment/lib/order.js`
- 售后资格、重复支付证据、管理员历史：`cloudfunctions/payment/lib/after-sales.js`
- 老用户迁移：`cloudfunctions/payment/lib/migration.js`
- 会员购买页：`miniprogram/pages/membership/`
- 设置提醒内付费入口：`miniprogram/pages/setup/`
- 订单列表与详情：`membership-orders`（`membership.orders`）、`membership-order-detail`（`membership.orderDetail`）
- 用户售后：`membership-after-sales`
- 售后工作台：`admin-after-sales`
- 支付运行手册：`docs/engineering/payment-v3-runbook.md`

## 5. 当前验证状态

本地已通过：

- `test/payment-v3.test.js`
- `test/payment-order.test.js`
- `test/payment-callback.test.js`
- `test/payment-after-sales.test.js`
- `test/payment-refund-callback.test.js`
- `test/membership.test.js`
- `test/membership-ux.test.js`
- `test/membership-pay.test.js`
- `test/order-refresh.test.js`
- `test/mock-mirror.test.js`

云端已验证：

- `reminder`、`payment` 已部署到 `cloud1`，会员状态、订单查询、售后申请、客服工作台、驳回和审计入口可执行。
- `cloud1` 完成一次 ¥2 真实购买，订单为 `PAID / PAID_GRANTED`。
- `cloud1` 完成一次“已使用权益”退款驳回，订单详情和售后详情均展示驳回原因。
- `cloud1` 完成一次 ¥2 真实成功退款：订单 `refundStatus=REFUNDED`、`refundedAmountFen=200`，随后 `grantStatus=REVERTED`，本单权益按快照回收。实测退款到账与权益回收完成相隔约 87 秒，因此页面必须支持该中间态，不能提前显示“权益已全部回收”。
- 关闭微信后的一笔真实订单在约 70 秒后由服务端主动查单/定时补偿确认：订单为 `PAID`，会员有效期与提醒名额已更新，未发生重复发放。
- 微信云开发定时触发器已部署为 `paymentReconcileEveryTwoMinutes`，表达式 `0 */2 * * * * *`。
- 体验版 `1.0.10` 已上传并覆盖上一体验版；正式版仍为 `1.0.9`，未提交审核。
- 本轮新增 `utils/order-refresh.js`：仅对未过期待支付、权益补发、退款审核/处理中、以及“退款已到账但权益待回收”的状态每 5 秒静默刷新，最多 30 次；达到上限后保留“下拉刷新或稍后重新进入”提示，终态、`onHide` 和 `onUnload` 立即停止。会员页、订单列表和订单详情均接入，并支持下拉刷新。

仍未完成：

- 本轮本地 UX 修复尚未重新上传体验版验收。
- 微信支付真实签名回调、微信退款真实签名回调。
- 退款回调失败场景与重复回调的真实环境验证。
- `unpay` 环境真实退款回调端到端验证。
- 正式环境 `MEMBERSHIP_ENFORCEMENT_MODE=all` 切换。

⚠️ 测试通过、已提交、已部署、真机验证是不同状态，不能互相替代。
