# 微信支付 API v3 接入 Runbook

> 状态：本地代码和协议测试已完成；未部署、未发起真实支付、未真机验证。
>
> 本文只描述操作步骤，不记录商户号、私钥、APIv3 密钥或微信支付公钥。

## 1. 方案边界

- 小程序继续使用微信云开发作为后端和数据库。
- 支付直接调用微信支付 API v3，不使用 `cloud.cloudPay`，不要求把商户号授权给云开发服务商。
- `payment` 云函数负责：
  - JSAPI 统一下单；
  - `wx.requestPayment` 参数签名；
  - 主动查单；
  - HTTP 回调验签、APIv3 资源解密、订单发放。
- 订单金额、商品类型和会员权益只从服务端订单快照读取，客户端不能传价格。

## 2. 商户平台准备

确认以下条件：

1. 小程序 AppID `wx05c160a589b97d76` 已绑定商户号。
2. 商户平台已开通 JSAPI 支付。
3. 已取得商户 API 证书私钥和证书序列号。
4. 已设置 32 字节 APIv3 密钥。
5. 已取得微信支付公钥和公钥 ID。推荐使用公钥模式，避免平台证书轮换导致回调验签失败。
6. 回调地址为公网 HTTPS，路径不能带查询参数。

测试环境回调地址：

```text
https://unpay-d4gf8fyrt5523ca65-1487385918.ap-shanghai.app.tcloudbase.com/payment/notify
```

正式环境建议使用备案自定义域名；`*.tcloudbase.com` 默认域名用于开发和测试。

## 3. 云函数环境变量

在 `payment` 云函数配置中设置：

| 变量 | 必填 | 说明 |
|---|---|---|
| `WECHAT_PAY_MCH_ID` | 是 | 商户号 |
| `WECHAT_PAY_SERIAL_NO` | 是 | 商户 API 证书序列号 |
| `WECHAT_PAY_PRIVATE_KEY` | 是 | 商户私钥 PEM 或其 Base64 |
| `WECHAT_PAY_API_V3_KEY` | 是 | 32 字节 APIv3 密钥 |
| `WECHAT_PAY_NOTIFY_URL` | 是 | 公网 HTTPS 回调地址 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY` | 是* | 微信支付公钥 PEM 或其 Base64 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID` | 是* | 微信支付公钥 ID |
| `WECHAT_PAY_PLATFORM_CERT` | 否 | 未使用公钥模式时的平台证书回退 |
| `WECHAT_PAY_PLATFORM_CERT_SERIAL` | 否 | 平台证书序列号回退 |
| `WECHAT_PAY_APP_ID` | 否 | 默认 `wx05c160a589b97d76` |
| `WECHAT_PAY_CALLBACK_MAX_SKEW_SECONDS` | 否 | 回调时间窗，默认 300 秒 |

\* 公钥模式必填；若使用平台证书回退，则改为配置平台证书和序列号。

密钥只录入云函数环境变量，不写入 `project.config.json`、代码或 Git。录入密钥前必须再次确认目标环境和用途。

## 4. 只验证支付：CloudBase 免费环境探针

免费体验版环境 `unpay-d4gf8fyrt5523ca65` 不支持项目使用的文档型数据库，因此这里**只部署 `payment-test` 支付探针**：

- 不创建 `users`、`orders`、`reminder_tasks` 集合；
- 不部署 `reminder` 或正式 `payment` 云函数；
- 不创建会员、不写订单、不发权益；
- 只验证 API v3 下单、真机拉起微信支付、微信服务器回调验签/解密和主动查单。

1. 部署 `payment-test` 云函数到 `unpay-d4gf8fyrt5523ca65`。
2. 在 `payment-test` 环境变量中配置：
   - `WECHAT_PAY_MCH_ID`
   - `WECHAT_PAY_SERIAL_NO`
   - `WECHAT_PAY_PRIVATE_KEY`
   - `WECHAT_PAY_API_V3_KEY`
   - `WECHAT_PAY_NOTIFY_URL=https://unpay-d4gf8fyrt5523ca65-1487385918.ap-shanghai.app.tcloudbase.com/payment/notify-test`
   - `WECHAT_PAY_PLATFORM_PUBLIC_KEY`
   - `WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID`
   - `PAYMENT_PROBE_ALLOWED_OPENIDS`（逗号分隔；不配则使用代码内白名单）
   - `PAYMENT_PROBE_AMOUNT_FEN=1`
3. 在 HTTP 网关创建路由：
   - 域名：`unpay-d4gf8fyrt5523ca65-1487385918.ap-shanghai.app.tcloudbase.com`
   - 路径：`/payment/notify-test`
   - 资源类型：云函数
   - 资源实例：`payment-test`
   - 版本：`$DEFAULT`
   - 跨域：关闭
   - 路径透传：关闭
   - 身份认证：关闭
4. 在微信开发者工具把编译模式设为 `pages/payment-probe/payment-probe`，使用真机调试启动。该页面只允许开发版/真机调试，体验版和正式版会拒绝执行。
5. 支付 ¥0.01 后同时确认：
   - `payment-test` 日志出现 `[payment-test] callback verified`；
   - 页面主动查单显示 `SUCCESS` 和微信交易号。

这一步通过只代表“真实微信支付链路可用”，不代表会员订单、权益发放和完整提交流程已通过。

## 5. CloudBase 完整业务测试环境步骤

测试环境 ID：

```text
unpay-d4gf8fyrt5523ca65
```

1. 创建集合：
   - `users`
   - `orders`
   - `reminder_tasks`
2. 建立索引：
   - `orders.outTradeNo`
   - `orders.userId + createdAt`
   - `reminder_tasks.userId + backendStatus + releaseAt`
3. 部署测试环境所需的 `reminder`、`payment` 云函数。不要部署到 `cloud1`。
4. 配置 `payment` 环境变量。
5. 在 HTTP 网关创建路由：
   - 域名：测试环境默认域名；
   - 路径：`/payment/notify`；
   - 资源类型：云函数；
   - 资源实例：`payment`；
   - 版本：`$DEFAULT`；
   - 跨域：关闭；
   - 路径透传：关闭；
   - 身份认证：关闭。
6. 保留 `payment-notify-probe` 直到真实回调验签通过，确认后再由用户授权删除。

## 6. 端到端验收

1. 用开发版或真机调试打开会员页。
2. 创建会员或任务位订单。
3. 确认 `orders` 中出现 `PENDING` 订单。
4. 拉起真实 `wx.requestPayment`。
5. 支付成功后确认：
   - 回调 HTTP 请求进入 `payment`；
   - 签名、时间窗、公钥 ID 校验通过；
   - APIv3 资源解密成功；
   - `orders.status=PAID`；
   - 用户会员有效期或任务位正确增加。
6. 再验证：
   - 取消支付不发权益；
   - 主动查单可在回调丢失时补发；
   - 重复回调不重复发放；
   - 金额不一致、商户号不一致、AppID 不一致均拒绝。

只有真实支付和真实回调都通过，才能把状态写成“微信支付已联调完成”。
