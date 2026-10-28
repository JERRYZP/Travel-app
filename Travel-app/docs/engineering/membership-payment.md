# 会员与任务位支付

> 2026-10-27 首次实现，未部署、未真机验证。

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
- 会员页：`miniprogram/pages/membership/`
- 订单页：`miniprogram/pages/membership-orders/`
- 提醒页内升级入口：`miniprogram/pages/setup/`

## 上线前置

1. 小程序已开通微信支付并绑定公司商户号。
2. 商户号超级管理员在“微信支付商家助手”中授权服务商 `1800008281 小程序云开发`。
3. 在微信支付商户平台确认账号绑定、JSAPI 支付和 API 退款权限。
4. 建索引 `reminder_tasks.userId+backendStatus+releaseAt`、`orders.outTradeNo`、`orders.userId+createdAt`。
5. 云函数 `payment` 配置环境变量：
   - `WECHAT_PAY_SUB_MCH_ID`
   - `WECHAT_PAY_CALLBACK_FUNCTION=payment`
   - `TCB_ENV=cloud1-d9g9f4hja396d6e92`
6. 测试阶段 `reminder` 配置：
   - `MEMBERSHIP_ENFORCEMENT_MODE=test`
   - 如需临时换测试账号，再配置 `MEMBERSHIP_TEST_OPENIDS=openid1,openid2`
7. 部署 `reminder` 与 `payment`，再发布小程序端。
8. 新版客户端确认覆盖后，才可把 `MEMBERSHIP_ENFORCEMENT_MODE` 切为 `all`。

## 验证清单

- 免费用户 1–5 条任务时页面无会员入口。
- 第 6 条或单批超额时提醒页出现入口。
- 支付取消后清单、金额、会员状态均未变化。
- 支付成功后权益到账，并自动继续原提交。
- 重复支付回调只发一次权益；金额不一致拒绝发放。
- 会员到期后已有提醒继续发送，新增强制走免费额度。
- 会员过期后重新续费，已购任务包恢复。
- 会员详情页可进入订单信息，只显示当前用户订单；点击订单可复制订单号。
- 自动广告仍然展示，页面和协议均无误导性“免广告”承诺。
