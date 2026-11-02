# 小程序虚拟支付接入 Runbook

> 2026-11-02 当前状态：`payment` / `reminder` 已部署，`payment_reconcile_state` 与关键索引已创建核验，生产数据已备份，名额账本 dry-run 与正式迁移均完成。客户端 `2.1.0` 已上传、审核通过并进入灰度；上午观察到 5 笔成功支付、2 笔退款，客服工作台正常，实际灰度包已用 `v2.1.0` tag 固化。**`payment` 支付白名单已删除，新版客户端新订单全量使用虚拟支付；`MEMBERSHIP_ENFORCEMENT_MODE=test` 保持不变，会员限制仍只对测试账号生效。尚未全量发布，也未切会员限制全量。** Apple 自主退款最终通知已实测；Android/iOS 其余支付场景、退款问询及真实签名回调证据仍需继续验收，测试通过不等于会员限制全量已经上线。
>
> 本文不记录实际 AppSecret、AppKey、商户号、公司开户行、管理员 OpenID 或其他敏感值。所有部署、环境变量修改、消息推送配置和渠道切换都必须取得用户当场明确授权。

## 1. 为什么保留两条通道

- 普通微信支付 API v3 已经在现网跑通，是当前缺省支付通道，方案与操作步骤完整保留在 `docs/engineering/payment-v3-runbook.md`，不得删除或覆盖。
- 会员扩容和提醒名额属于解锁型虚拟功能，正式合规通道是微信小程序虚拟支付。
- 当前代码用 `PAYMENT_PROVIDER` 显式切流：变量缺省或为 `WECHAT_PAY_V3` 时仍走 API v3；只有 `PAYMENT_PROVIDER=VIRTUAL_PAY` 时新发起支付才走虚拟支付。
- 新版客户端必须在 `payment.create` 传 `clientSupportsVirtualPay=true`；未传的旧客户端始终保留 API v3 通道。该兼容声明用于覆盖审核、发布和微信自动更新期间的版本并存窗口。
- 历史订单优先使用订单保存的 `paymentProvider`、`virtualEnv` 和 `virtualProductId`。已经进入支付流程的普通微信支付订单在首次拉起时固化 `WECHAT_PAY_V3`；虚拟支付订单固化创建时的沙箱/现网环境并使用对应 AppKey。切换环境变量不会把历史订单路由到另一渠道或另一套签名。
- 两条通道共用订单、售后、权益发放和权益快照回收逻辑；不得在虚拟支付里另写一套会员规则。

## 2. 微信硬性规则

官方文档：

- 虚拟支付总览：<https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.md>
- 客户端支付：<https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.md>
- 查单：<https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.md>
- 退款：<https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_refund_order.md>
- 云开发消息推送：<https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/wechatpay/virtual-payment-callback.md>

必须遵守：

- 小程序需为已认证企业、事业单位或个体工商户，先在 MP 后台「虚拟支付」完成协议、资料、账户验证和签约。
- 本功能使用固定价格道具直购，`mode=short_series_goods`；会员和名额包不需要代币系统。
- 客户端支付参数是 `signData`、`paySig`、`signature`。用户态 `signature` 依赖有效 `session_key`，所以客户端必须先 `wx.login`，服务端再用 `/sns/jscode2session` 换取；`session_key` 不落库、不返回客户端。
- `paySig = HMAC-SHA256(appKey, 'requestVirtualPayment&' + signData)`；服务端 API 的 `pay_sig` 使用实际 `/xpay/...` 路径和最终 POST body 计算。
- `wx.requestVirtualPayment.success` 可能丢失，不能据此发权益。可靠发货需要支付消息推送和主动查单，本仓库两者都已实现。
- 发货推送和退款推送必须先调用 `/xpay/query_order` 复核，不能直接信任客户端事件或推送正文。
- `/xpay/query_order` 官方返回字段只有订单状态、环境、金额等，不含 `productId/buyQuantity`。服务端必须在签名前校验订单 SKU 与道具配置，发放前再次校验订单已保存的 `virtualProductId`；不要伪造商品字段校验。存在可用 `biz_meta` 时可核对版本化附加标识，商品快照缺失或不一致时转人工核验。
- iOS 最终走 Apple 支付，不支持沙箱；正式测试需 iOS 15+、微信 8.0.68+、中国大陆 App Store 账号。Apple 退款只能由用户在 App Store 发起，服务端不能直接发起。
- Apple 退款问询 `xpay_subscribe_ios_refund_query_notify` 必须 3 秒内响应；连续 3 次超时后，微信会向 Apple 返回「不确定」。

## 3. MP 后台准备

### 3.1 账户与商品

1. 完成虚拟支付开通，确认状态为「已签约」并能进入虚拟支付商户管理。
2. 在「基础配置」取得 `offerId`、现网 AppKey、沙箱 AppKey；AppSecret 仍从小程序后台开发设置取得。
3. 在「道具管理」创建并发布两个固定价格道具，开发版和现网都要可用：

| 业务 SKU | 服务端套餐 | 道具价格 | 权益 |
|---|---|---:|---|
| 会员 30 天 | `member` | 300 分 | 30 天会员，最多 15 个提醒名额 |
| 加购 10 个名额 | `task_pack_5`（历史稳定 ID） | 300 分 | 会员期内增加 10 个提醒名额 |

4. 后台道具价格必须与 `cloudfunctions/reminder/lib/membership.js` 的订单金额一致；客户端传入的 `goodsPrice` 由服务端订单决定。
5. iOS 还需配置小程序简称，满足 Apple 支付展示名称要求。

### 3.2 公司资料

公司开户行、结算账户、营业执照、支付管理员等资料直接在 MP 虚拟支付开通页提交，不需要发送到代码仓库，也不需要写入云函数环境变量。资金进入虚拟支付开通的新商户账户，再按后台配置提现；结算周期与技术服务费以 MP 后台和微信当期协议为准。

## 4. 云函数环境变量

在 `payment` 云函数配置：

| 变量 | 必填 | 说明 |
|---|---|---|
| `PAYMENT_PROVIDER` | 切换时 | 缺省 `WECHAT_PAY_V3`；虚拟支付正式启用时设置为 `VIRTUAL_PAY` |
| `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS` | 灰度联调时 | 逗号分隔 OpenID；非空时仅这些用户走虚拟支付，其他用户继续 API v3。2026-11-01 已从 `cloud1` 删除，支付渠道进入新版客户端全量 |
| `WECHAT_APP_ID` | 是 | 当前为 `wx05c160a589b97d76` |
| `WECHAT_APP_SECRET` | 是 | 小程序 AppSecret，只放云函数环境变量 |
| `WECHAT_VIRTUAL_PAY_ENV` | 是 | `0` 现网，`1` 沙箱；iOS 只能 `0` |
| `WECHAT_VIRTUAL_PAY_OFFER_ID` | 是 | MP 虚拟支付基础配置中的 OfferId |
| `WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY` | 现网必填 | 现网 AppKey |
| `WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY` | 沙箱必填 | 沙箱 AppKey |
| `WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER` | 是 | 会员 30 天道具发布后的 ProductId |
| `WECHAT_VIRTUAL_PAY_PRODUCT_TASK_PACK` | 是 | 加购 10 个名额道具发布后的 ProductId |

`WECHAT_VIRTUAL_PAY_APP_KEY` 只作为单一 AppKey 的兼容回退，不建议正式环境依赖。

服务端查单和退款只依赖 AppID、AppSecret、OfferId 和对应环境 AppKey；商品 ID 在签名前校验对应订单的固定道具，并在发放前再次核对订单固化的 `virtualProductId`。若两个道具尚未同时发布，可先完成其中一个 SKU 的联调，但不能据此把另一个 SKU 标为可用。

API v3 原有 `WECHAT_PAY_*` 变量和 HTTP 网关继续保留，不需要删除。两项配置可同时存在；渠道由 `PAYMENT_PROVIDER` 控制。

## 5. 云开发消息推送

在云开发控制台进入「设置 → 其他设置 → 消息推送」，选择「云函数」，把以下事件推送到 `payment`：

| 事件 | 处理 |
|---|---|
| `xpay_goods_deliver_notify` | 查单确认支付、环境、实付金额和订单固化商品快照后发权益；重复推送幂等 |
| `xpay_refund_notify` | 查单确认退款完成或失败后更新售后状态；成功后按快照回收权益。若 Apple 自主退款没有用户售后单，自动补建一条按退款单号幂等的「平台退款」记录 |
| `xpay_subscribe_ios_refund_query_notify` | 仅响应 Apple 退款问询，不是最终退款结果，不创建售后单；根据订单是否已使用，3 秒内返回建议退款或拒绝退款及证据 |

云函数成功响应：

```json
{ "ErrCode": 0, "ErrMsg": "success" }
```

iOS 问询成功响应额外带：

```json
{
  "ErrCode": 0,
  "ErrMsg": "success",
  "IosRefundQueryResponse": {
    "result_code": 1,
    "result_info": "拒绝退款",
    "evidence": "用户已在本单支付后新增提醒，权益已实际使用。"
  }
}
```

`/payment/virtual-notify` 保留为 HTTP 兼容入口，但正式接入优先使用云开发消息推送，因为事件形态、重试和应答格式与云开发内置能力一致。

消息入口有两层边界：客户端来源（`SOURCE` 含 `wx_client`、`wx_devtools` 或 `wx_localdebug`）的 `xpay_*` 事件和伪装成 HTTP 的回调直接失败，不能进入查单；平台消息可能带事件里的 `OpenId`，对应上下文也会出现 `OPENID`，但仍必须由 `SOURCE=wx_paycallback` 放行后，再通过 `/xpay/query_order` 或退款查单确认状态。Apple 退款查单为 `status=5` 时先记录“退款处理中”，不得提前回收权益；到 `status=8` 才完成回收。正式上线不要额外暴露虚拟支付 HTTP 兼容路由。

## 6. 代码链路

客户端：

```text
membership.createOrder
→ wx.login
→ payment.create({ orderId, loginCode })
→ 服务端返回 paymentProvider + virtualPayment
→ wx.requestVirtualPayment
→ payment.query 轮询
```

服务端：

```text
payment.create
→ 校验客户端声明 clientSupportsVirtualPay
→ /sns/jscode2session 校验 OPENID 并取得 session_key
→ 生成 signData / paySig / signature
→ 订单写入 paymentProvider=VIRTUAL_PAY、virtualEnv、virtualProductId

xpay_goods_deliver_notify / payment.query
→ /cgi-bin/stable_token
→ /xpay/query_order
→ 校验 order_id、env_type、order_fee、支付状态和订单保存的 virtualProductId
→ fulfillOrder 事务发权益

退款
→ /xpay/refund_order
→ /xpay/query_order 查询退款单
→ xpay_refund_notify 或定时补偿
→ 校验最终状态后回收本单权益快照
```

Access Token 使用内存缓存并提前 5 分钟刷新；微信返回 `40001/40014/41001/42001` 时，单次强制刷新 token 后重试请求，避免把临时鉴权失败暴露成支付失败。

取消支付时先调用 `/xpay/query_order`：平台明确未支付或已关闭后才把本地订单置为 `CLOSED`，并向客户端返回新的购买需要重新生成 `requestId`。当前接入的虚拟支付官方接口没有独立关单 API，因此不能假装已经替微信关闭平台订单；若查单显示已支付，必须先发放权益，不能直接本地关闭。

## 7. 上线与迁移顺序

以下操作涉及生产数据和线上配置，每一步都必须单独取得用户当场明确授权：

1. 备份 `users`、`orders`、`reminder_tasks`、`after_sales_cases`、`admin_audit_logs`。
2. 创建 `payment_reconcile_state` 集合，并按 `数据库索引.md` 创建补偿和迁移游标索引；集合权限设为「仅管理端可读写」。
3. 部署 `payment` 和 `reminder` 后端，确认定时触发器与 `payment_reconcile_state` 可读写，但暂不切全量会员限制。
4. 分批调用 `{ action: 'afterSales.adminMigrateEntitlementLedger', dryRun: true, cursor? }`，直到 `hasMore=false`；保存差异报告，确认历史 5 个包与新 10 个包混算结果。
5. 以 `dryRun=false` 重新从头执行同一迁移。每批最多 50 人，必须沿返回的 `nextCursor` 继续到 `hasMore=false`；不可跳批，也不能把 dry-run 的游标当作已写入结果。
6. 保持 `MEMBERSHIP_ENFORCEMENT_MODE=test`，用白名单 OpenID 真机验证支付、权益到账、退款回收、并发提醒和恢复支付。
7. 上传体验版并提交审核；审核等待期和发布初期继续保持 `test`，非白名单任务进入历史保护池。
8. 支付白名单已于 2026-11-01 删除，新版客户端新订单全量使用虚拟支付；完成正式版覆盖与支付验收后，再另行评估切到 `MEMBERSHIP_ENFORCEMENT_MODE=all`。

## 8. 测试顺序

部署和切换都需要单独授权。建议顺序：

1. 本地执行 `npm test`、`npm run check`、`git diff --check`；确认包含账本混算、并发锁、订单幂等、售后唯一和 100 条以上补偿轮转测试。
2. MP 道具先在开发版发布，配置沙箱 `PAYMENT_PROVIDER=VIRTUAL_PAY`、`WECHAT_VIRTUAL_PAY_ENV=1`，并用 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS` 限定测试账号；其他线上用户继续走 API v3。
3. 用 Android 测试账号完成沙箱下单、支付、消息推送、主动查单、权益到账、重复推送、退款和退款推送。
4. 观察 `/xpay/query_order`、access token 刷新、消息推送回包和云函数重试日志。不得在日志输出 AppSecret、AppKey、session_key、完整 signData 之外的敏感凭据。
5. 发布现网道具，配置现网 AppKey 和 `WECHAT_VIRTUAL_PAY_ENV=0`，先在测试白名单验证。
6. iOS 使用真实现网环境、iOS 15+ 和微信 8.0.68+ 验证 Apple 支付、Apple 退款问询和最终退款推送；Apple 无沙箱。确认问询阶段不建单，最终 `xpay_refund_notify` 查单成功后售后工作台出现一条“平台退款 / 系统自动”记录，重复推送不新增第二条。
7. 验证 Android/iOS、首次购买、续费、加购、取消、支付成功回调丢失、重复推送、退款失败重试和权益回收；另用客户端调用伪造 `xpay_*` 事件和 HTTP 形态，确认均不会产生查单或权益变化。
8. 只有以上通过后，才删除 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS` 完成支付全量，并评估是否由 `MEMBERSHIP_ENFORCEMENT_MODE=test` 切到 `all`。

## 9. 回退

- 代码回退只切换 `PAYMENT_PROVIDER`，不要删除虚拟支付模块或 API v3 模块。
- 新支付回退到 API v3：设置 `PAYMENT_PROVIDER=WECHAT_PAY_V3` 或移除该变量，并保留 `WECHAT_PAY_*` 配置。
- 已处于 `PENDING/PAID/REFUNDED` 的虚拟支付订单仍按订单 `paymentProvider=VIRTUAL_PAY` 查单和退款，不能因为切回 API v3 而改走普通微信支付接口。
- 虚拟支付订单同时按订单保存的 `virtualEnv` 选择沙箱或现网 AppKey；切换 `WECHAT_VIRTUAL_PAY_ENV` 不会改变历史订单的查单、退款环境。
- 切换前先停止新支付入口或完成待支付订单收敛；不得直接关闭虚拟支付商户能力。

## 10. 需要用户提供或确认

开发联调前：

- MP 虚拟支付开通状态：资料审核、账户验证、签约是否完成。
- `offerId`。
- 现网 AppKey、沙箱 AppKey；只在云函数控制台配置，不贴进代码或文档。
- 小程序 AppSecret；只在云函数控制台配置。
- 两个道具发布后的 `ProductId`。
- 云开发消息推送配置权限，以及是否允许把三个事件都推送到 `payment`。
- 小程序简称是否已配置。
- 可用的 Android/鸿蒙沙箱测试账号 OpenID。
- 可用 iOS 真机（iOS 15+、微信 8.0.68+）和中国大陆 App Store 测试账号。

上线审核前：

- MP 虚拟支付商户主体、结算账户和支付管理员状态。
- 用户协议与隐私政策已补充微信虚拟支付、Apple 应用内购买、平台订单标识、iOS 退款边界、即时交付和售后审核记录；支付确认页已提供两份协议入口。上线前仍需运营/法务按最终商户主体和实际渠道复核。
- 客服退款口径、退款证据和 3 秒 iOS 问询策略是否由运营确认。

## 11. 当前待办

已完成：

- MP 虚拟支付审核、签约、两个固定道具、AppKey/AppSecret/OfferId/ProductId 与消息推送配置（以用户报告和现有云端配置为准，不在文档记录敏感值）。
- 创建并核验 `payment_reconcile_state`、`orders_status_id`、`orders_status_grant_id`、`orders_user_status_id`、`after_sales_status_id`。
- 完成生产备份后部署 `payment` / `reminder`，并通过 `membership.status`、`home.bootstrap` 云端只读冒烟。
- 名额账本 dry-run 133 批、扫描 6605 人；正式迁移 133 批、更新 6620 人，人工核查 0、历史补签 1，最终 `hasMore=false`。
- 客户端 `2.1.0` 已上传、审核通过并进入灰度；灰度观察到 5 笔成功支付、2 笔退款，客服工作台正常，`v2.1.0` tag 已固化实际灰度包。
- 2026-11-01 真实 Apple 自主退款最终通知已通过平台重试验证：`payment` 返回成功，售后工作台生成一条「平台退款 / 系统自动」记录，订单按权益快照完成回收。
- 2026-11-01 已从 `cloud1` 的 `payment` 删除 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS`；云端回读确认配置由 21 项变为 20 项，`PAYMENT_PROVIDER=VIRTUAL_PAY`、`WECHAT_VIRTUAL_PAY_ENV=0` 和其余配置保持不变。

待完成：

- Android 沙箱完成支付、权益到账、退款、并发提醒和恢复支付真机验收。
- iOS 现网继续完成 Apple 支付和 Apple 退款问询验收；最终平台退款通知、售后留痕与权益回收已于 2026-11-01 实测通过。
- 补齐其余真实消息推送、主动查单和退款证据，并确认真实签名 API v3 支付/退款回调。
- 在正式版覆盖稳定并完成支付验收后，另行授权将 `MEMBERSHIP_ENFORCEMENT_MODE` 从 `test` 切到 `all`。
