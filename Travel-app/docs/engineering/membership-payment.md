# 会员与任务位支付

> 2026-10-27 首次实现。
> 2026-10-30 支付通道切换为微信支付 API v3 直连；用户已在体验版完成真实支付，权益通过主动查单确认。HTTP 回调端到端、完整真机流程和退款售后仍未闭环。

## 业务口径

- 免费用户最多保留 5 个未来 `WAITING` 提醒任务。
- 会员 2 元 / 30 天，有效期内最多 10 个任务位，不自动续费。
- 会员可加购 2 元任务包，每包永久保留 5 个任务位；只在会员有效期内生效，续费后恢复。
- 加购任务包时，会员有效期至少延长到支付成功后 30 天。
- 提醒页仅在本次提交导致任务位不足时出现支付入口；“我的”常驻会员状态入口。
- 微信后台智能自动广告没有按会员关闭能力，本功能不提供“免广告”承诺。
- 服务端限制支持灰度：`MEMBERSHIP_ENFORCEMENT_MODE=off|test|all`。默认 `test`，只限制 `membership.js` 内置的内部测试 OpenID；其他线上用户保持旧版免费行为。
- `MEMBERSHIP_TEST_OPENIDS` 可用逗号分隔覆盖内置测试白名单。正式小程序全量发布前，禁止切换为 `all`。

## 代码边界

- 规则唯一真身：`cloudfunctions/reminder/lib/membership.js`
- 订单创建：`reminder.membership.createOrder`
- 任务位硬闸门：`cart.commit`、`tripItem.updateReminder`
- 微信支付与权益发放：`cloudfunctions/payment/`
- 支付回调和部署说明：`docs/engineering/payment-v3-runbook.md`
- 会员页：`miniprogram/pages/membership/`
- 订单页：`miniprogram/pages/membership-orders/`
- 提醒页内升级入口：`miniprogram/pages/setup/`

## 上线前置

1. 小程序已开通微信支付，并把当前 AppID 与公司商户号绑定。
2. 在微信支付商户平台开通 JSAPI 支付；退款功能后续单独开通 API 退款权限。
3. 在 CloudBase HTTP 网关新增支付回调路由，指向云函数 `payment`，关闭身份认证、跨域和路径透传，并保留原始请求体。默认域名只用于开发和测试，正式回调使用备案 HTTPS 域名。
4. 建索引 `reminder_tasks.userId+backendStatus+releaseAt`、`orders.outTradeNo`、`orders.userId+createdAt`。
5. 云函数 `payment` 配置环境变量：
   - `WECHAT_PAY_MCH_ID`
   - `WECHAT_PAY_SERIAL_NO`
   - `WECHAT_PAY_PRIVATE_KEY`
   - `WECHAT_PAY_API_V3_KEY`
   - `WECHAT_PAY_NOTIFY_URL`
   - `WECHAT_PAY_PLATFORM_PUBLIC_KEY`
   - `WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID`
   - 可选：`WECHAT_PAY_APP_ID`、`WECHAT_PAY_PLATFORM_CERT`、`WECHAT_PAY_PLATFORM_CERT_SERIAL`、`WECHAT_PAY_CALLBACK_MAX_SKEW_SECONDS`
6. 测试阶段 `reminder` 配置：
   - `MEMBERSHIP_ENFORCEMENT_MODE=test`
   - 如需临时换测试账号，再配置 `MEMBERSHIP_TEST_OPENIDS=openid1,openid2`
7. 部署 `reminder` 与 `payment`，再发布小程序端。
8. 新版客户端确认覆盖后，才可把 `MEMBERSHIP_ENFORCEMENT_MODE` 切为 `all`。

## 当前未实现：退款与售后

- 当前没有用户退款申请入口、客服审核后台、管理员退款接口、微信退款调用、退款回调和权益回收。
- `orders.status=REFUNDED` 目前只是展示枚举，系统不会自动进入退款状态或收回会员/任务包权益。
- 在微信支付商户平台手工退款不会自动同步小程序订单和权益，不能当作完整退款流程。
- 在上述能力闭环前，不得向用户展示“申请退款”或宣称支持在线退款。退款规则、客服权限和审核流程待产品方案确认后再实现。

## 验证清单

- 免费用户 1–5 条任务时页面无会员入口。
- 第 6 条或单批超额时提醒页出现入口。
- 支付取消后清单、金额、会员状态均未变化。
- 支付成功后权益到账，并自动继续原提交；用户确认的 cloud1 体验版真实支付已通过主动查单发放权益。
- HTTP 回调验签、解密和原始请求体透传完成端到端验证前，客户端主动查单仍是补偿路径。
- 重复支付回调只发一次权益；金额不一致拒绝发放。
- 会员到期后已有提醒继续发送，新增强制走免费额度。
- 会员过期后重新续费，已购任务包恢复。
- 会员详情页可进入订单信息，只显示当前用户订单；点击订单可复制订单号。
- 自动广告仍然展示，页面和协议均无误导性“免广告”承诺。
