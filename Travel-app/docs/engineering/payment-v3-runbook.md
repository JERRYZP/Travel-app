# 微信支付 API v3 接入与售后 Runbook

> **保留通道：不要删除或覆盖本文。** API v3 是当前缺省支付通道，也是虚拟支付接入失败或回退时的既有方案。2026-10-31 已新增并行的小程序虚拟支付通道，配置、消息推送和验收见 `docs/engineering/payment-virtual-runbook.md`。只有设置 `PAYMENT_PROVIDER=VIRTUAL_PAY` 才切换到虚拟支付；历史订单按订单保存的渠道继续查单和退款。

> 2026-10-30 工作区状态：服务端基线提交为 `6fbeeaf`，页面自动刷新修复已提交到当前分支；`reminder`、`payment` 已部署到 `cloud1`，真实购买、退款驳回、真实成功退款、退款后权益回收和关闭小程序后查单到账均已验证；**真实签名支付/退款 HTTP 回调仍未证实**。
>
> 本文不记录商户号、私钥、APIv3 密钥、微信支付公钥或管理员 OpenID 的实际值。
> 所有部署、环境切换、环境变量修改和索引创建都必须取得用户当场明确授权。

## 1. 方案边界

- 小程序继续使用微信云开发作为后端和数据库。
- 支付直接调用微信支付 API v3，不使用 `cloud.cloudPay`，不要求商户号授权给云开发服务商。
- `payment` 云函数负责 JSAPI 下单、支付参数签名、主动查单、关单、支付回调、定时补偿、退款、退款查询、退款回调和权益发放。
- 金额、商品类型、会员时长和提醒名额只从服务端订单快照读取；客户端不能传价格。
- 支付成功唯一依据是服务端取得 `trade_state=SUCCESS`；`wx.requestPayment.success` 只代表客户端流程结束。

## 2. 商户平台前置条件

1. 小程序 AppID `wx05c160a589b97d76` 已与商户号绑定。
2. 商户平台已开通 JSAPI 支付。
3. 已开通 API 退款权限。
4. 已有商户 API 证书私钥和证书序列号。
5. 已设置 32 字节 APIv3 密钥。
6. 已取得微信支付公钥和公钥 ID；推荐公钥模式。
7. 支付与退款回调均为公网 HTTPS，路径不能带查询参数。

测试默认域名示例：

```text
https://unpay-d4gf8fyrt5523ca65-1487385918.ap-shanghai.app.tcloudbase.com
```

正式环境应使用备案自定义域名；`*.tcloudbase.com` 默认域名用于开发和测试。

## 3. 环境变量

在 `payment` 云函数中配置：

| 变量 | 必填 | 说明 |
|---|---|---|
| `WECHAT_PAY_MCH_ID` | 是 | 商户号 |
| `WECHAT_PAY_SERIAL_NO` | 是 | 商户 API 证书序列号 |
| `WECHAT_PAY_PRIVATE_KEY` | 是 | 商户私钥 PEM 或其 Base64 |
| `WECHAT_PAY_API_V3_KEY` | 是 | 32 字节 APIv3 密钥 |
| `WECHAT_PAY_NOTIFY_URL` | 是 | 支付回调，指向 `/payment/notify` |
| `WECHAT_PAY_REFUND_NOTIFY_URL` | 退款时必填 | 退款回调，指向 `/payment/refund-notify` |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY` | 是 | 微信支付公钥 PEM 或其 Base64 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID` | 是 | 微信支付公钥 ID |
| `WECHAT_PAY_PLATFORM_CERT` | 否 | 旧平台证书模式回退，不能与公钥模式隐式混用 |
| `WECHAT_PAY_PLATFORM_CERT_SERIAL` | 否 | 旧平台证书序列号 |
| `WECHAT_PAY_APP_ID` | 否 | 默认 `wx05c160a589b97d76` |
| `WECHAT_PAY_CALLBACK_MAX_SKEW_SECONDS` | 否 | 回调时间窗，默认 300 秒 |
| `AFTER_SALES_ADMIN_OPENIDS` | 售后工作台必填 | 逗号分隔；未配置时售后工作台关闭，不存在代码内置兜底账号 |

没有微信支付公钥或平台证书回退配置时，`hasApiConfig=false`；支付 API 不会跳过响应验签继续运行。

`reminder` 侧会员限制变量：

- `payment_config/membership_enforcement.mode=off|test|all` 是运行期真身，由客服工作台切换；后台切换不需要重新部署。
- `MEMBERSHIP_ENFORCEMENT_MODE=off|test|all` 仅作配置缺失、非法或读取失败时的兜底，默认 `test`。
- `MEMBERSHIP_TEST_OPENIDS=openid1,openid2`，可覆盖内置测试名单。
- 保护额度与权益账本迁移均完成前不得切 `all`。

## 4. HTTP 网关

支付回调：

- 路径：`/payment/notify`
- 资源类型：云函数
- 实例：`payment`
- 身份认证：关闭
- 跨域：关闭
- 路径透传：关闭
- 必须保留原始 HTTP body

退款回调：

- 路径：`/payment/refund-notify`
- 其余配置与支付回调相同

不建议把 `/payment/notify` 同时当退款回调。代码按精确路径区分；退款回调和支付回调都必须用 `/payment/refund-notify` 验签和路由。

## 5. 定时补偿

`cloudfunctions/payment/config.json` 配置每 2 分钟一次：

```text
0 */2 * * * * *
```

定时任务处理：

- `PENDING` 订单主动查单、关闭过期订单。
- `PAID_GRANT_FAILED` 订单重试发放；成功后自动解决权益未到账售后单。
- `AUTO_CHECKING` 售后单：补齐权益或自动处理符合证据的重复支付退款。
- `PROCESSING / REFUND_FAILED` 售后单主动查询退款结果。

定时任务只做补偿，不替代支付回调；两者都确认后才算真实链路完整。

## 5.1 退款备付金

- 微信退款从商户基本账户出款，退款单金额必须始终等于订单原金额；支付手续费按退款比例退补，不能把 `¥3` 改成扣除手续费后的金额。
- “一单进、一单出”不是按订单隔离的资金池。自动提现、手工提现、尚未结算、其他退款占用或账户限制都可能让基本账户没有足够的退款可用余额。
- 基本账户必须保留固定退款备付金，不能每收到一单就全额提走。至少按“待退款订单原金额 + 近期退款波动缓冲”保留；新业务建议最低保留 `¥500`，单量上升后按实际退款量滚动调整。
- 每日检查基本账户余额和 `REFUND_FAILED + fundingBlocked=true` 售后。出现余额不足时先充值，再打开原异常售后单点击「重新发起退款」；退款成功前不得手工标记退款完成，也不得提前回收权益。
- 后台会在「我的 → 售后管理」和售后工作台顶部持续显示资金阻断数量，避免错误只弹一次后丢失。

2026-10-30 已在 `cloud1` 控制台确认：微信云开发触发器名为 `paymentReconcileEveryTwoMinutes`，表达式为 `0 */2 * * * * *`，标准触发器为空属正常。函数日志会混入客户端 `payment.query`/售后调用，不能仅按日志条数判断定时器重复。

`cloud1` 支付与退款 HTTP 路由已用错误签名请求验证可达并返回 401；这只能证明请求能到函数，不能替代真实微信签名回调。真实签名回调未观察到前，支付结果仍由主动查单和定时补偿兜底。

## 6. 支付探针

免费测试环境 `unpay-d4gf8fyrt5523ca65` 只用 `payment-test` 探针验证支付协议：

- 不写会员、订单或提醒集合。
- 只验证 API v3 下单、真机拉起微信支付、回调验签/解密、主动查单。
- 探针通过不等于会员权益和退款链路通过。

探针配置与步骤：

1. 部署 `payment-test` 到 `unpay-d4gf8fyrt5523ca65`。
2. 配置商户 API 参数、`WECHAT_PAY_NOTIFY_URL=https://unpay-d4gf8fyrt5523ca65-1487385918.ap-shanghai.app.tcloudbase.com/payment/notify-test`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID` 和 `PAYMENT_PROBE_ALLOWED_OPENIDS`。
3. `PAYMENT_PROBE_AMOUNT_FEN=1`。
4. 在 HTTP 网关创建 `/payment/notify-test`，指向 `payment-test`，关闭身份认证、跨域和路径透传。
5. 真机支付 ¥0.01，确认日志出现验签成功、主动查单为 `SUCCESS`。

## 7. 部署顺序

1. 用户确认目标环境、集合与索引清单。
2. 在目标环境创建 `after_sales_cases`、`admin_audit_logs` 和 `数据库索引.md` 第二节要求的索引。
3. 配置 `payment` 环境变量，包括微信支付凭证、回调地址和 `AFTER_SALES_ADMIN_OPENIDS`。
4. 配置 `reminder` 的兜底 `MEMBERSHIP_ENFORCEMENT_MODE=test`（不是 `payment` 环境变量）及可选测试 OpenID；部署含后台开关的新版后，以 `payment_config/membership_enforcement` 接管运行模式。
5. 部署 `payment`。
6. 部署 `reminder`。
7. 上传体验版小程序端；2026-10-30 已上传 `1.0.10`，正式版仍为 `1.0.9`。
8. 老用户保护额度迁移已于上线前完成；正式工作台不再展示迁移入口，不要重复执行。服务端接口仅保留应急使用，若重新开启入口会按 50 人一批执行直到 `hasMore=false`，中途可停止并从本机游标继续。
9. 上传审核和等待发布期间保持 `test`；`off` / `test` 非白名单期间创建的任务会进入历史保护池。正式发布时通过客服工作台把 `membership_enforcement.mode` 切为 `all`，服务端必须已确认两项迁移完成，从切换后新建的任务才进入免费/会员新增池。

任何一步失败都停在该步，不能用测试通过替代部署或真机验证。

## 8. 验收清单

支付：

- 正确签名、错误签名、错误公钥 ID、过期时间戳、篡改 body、重复回调、金额不一致。
- 下单/查单/退款请求的微信响应签名校验失败时不得使用返回值。
- 15 分钟内复用待支付订单；过期后本地关闭并新建。
- 支付后立即关闭小程序，2 分钟内主动查单补偿能发权益。（2026-10-30 已在 `cloud1` 实测约 70 秒到账）
- 权益只发一次；回调失败但查单成功仍能到账。
- 查单成功但发放失败时，自动生成高优先级售后单，不重复扣款。

退款：

- 24 小时内且未新增提醒可申请；已使用、超 24 小时、正常权益驳回。
- 重复支付证据准确，退款单号确定且重试不重复退款。
- 退款回调失败后主动查询能收敛；重复退款回调不重复回收权益。
- 退款成功后不删除已有提醒，只回收本单新增会员时长和名额包。（2026-10-30 已在 `cloud1` 实测，退款到权益回收约 87 秒）
- 已使用权益导致额度超限时，只禁止继续新增，不删除既有提醒。

真机：

- `unpay` 完成真实签名回调样本或探针验证。
- `cloud1` 体验版 `1.0.10` 已完成 ¥2 会员购买、一次退款驳回、一次真实成功退款、退款后权益回收和关闭小程序后到账。
- 本轮支付/退款页面自动刷新修复尚未重新上传体验版；需重新验收“退款已到账、权益回收中”不再停留旧状态。
- 售后工作台已完成一次查看、同步支付结果与驳回；补发权益（模拟失败）、同意退款和审计核对仍需完成。

⚠️ 只有以上真实环境步骤完成，才能把状态写成“微信支付与退款已联调完成”。
