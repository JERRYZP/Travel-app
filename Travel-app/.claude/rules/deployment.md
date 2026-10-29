---
paths:
  - "cloudfunctions/**"
  - "miniprogram/app.js"
  - "project.config.json"
---

# 部署规则

## 授权边界

没有用户当场明确确认，不部署云函数、不切环境、不修改生产配置、不执行清场。

## 配置一致性

- appid 与 `cloudEnv` 必须成对更换。
- 当前 appid：`wx05c160a589b97d76`
- 当前 cloudEnv：`cloud1-d9g9f4hja396d6e92`
- 只改 appid 会导致所有 `wx.cloud.callFunction` 失败。

## 部署前

1. 阅读 `docs/engineering/current-state.md` 和 `数据库索引.md`。
2. 确认集合和索引已创建。
3. 确认要部署的云函数及其依赖文件。
4. 运行 `npm test`、`npm run check` 和 `git diff --check`。

## 部署顺序

- 先数据与索引，再业务云函数。
- 同时影响 `reminder` 与 `notifier` 的改动必须分别确认。
- 会员 / 任务位上线还需部署 `payment`，并使用微信支付 API v3 直连。云函数环境变量必须配置 `WECHAT_PAY_MCH_ID`、`WECHAT_PAY_SERIAL_NO`、`WECHAT_PAY_PRIVATE_KEY`、`WECHAT_PAY_API_V3_KEY`、`WECHAT_PAY_NOTIFY_URL`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID`；商户号只需绑定当前小程序并开通 JSAPI 支付，不再要求云开发服务商授权。
- `payment` 的公网回调必须走 CloudBase HTTP 网关：路由指向云函数 `payment`，关闭身份认证、跨域和路径透传，并配置独立 HTTPS 域名；默认域名只能用于测试，正式回调使用备案自定义域名。
- `reminder` 的会员限制由 `MEMBERSHIP_ENFORCEMENT_MODE` 控制：`off` 关闭、`test` 仅测试白名单、`all` 全量。默认 `test`，白名单在 `membership.js` 中，可用 `MEMBERSHIP_TEST_OPENIDS` 逗号分隔覆盖。正式发布前不得切 `all`。
- 只改小程序页面通常不需要部署云函数，但如果接口契约变化则必须部署。

## 状态纪律

测试通过、代码已提交、PR 已合并、已部署、真机已验证是不同状态，不能互相替代。无法验证时写 `pending`。
