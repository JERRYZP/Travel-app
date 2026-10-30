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
- 会员 / 提醒名额上线还需部署 `payment`，并使用微信支付 API v3 直连。云函数环境变量必须配置 `WECHAT_PAY_MCH_ID`、`WECHAT_PAY_SERIAL_NO`、`WECHAT_PAY_PRIVATE_KEY`、`WECHAT_PAY_API_V3_KEY`、`WECHAT_PAY_NOTIFY_URL`、`WECHAT_PAY_REFUND_NOTIFY_URL`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY_ID`、`AFTER_SALES_ADMIN_OPENIDS`；商户号只需绑定当前小程序并开通 JSAPI 与 API 退款权限，不再要求云开发服务商授权。
- `payment` 的公网回调必须走 CloudBase HTTP 网关：`/payment/notify` 与 `/payment/refund-notify` 分别指向云函数 `payment`，关闭身份认证、跨域和路径透传，并保留原始 body；默认域名只能用于测试，正式回调使用备案自定义域名。
- `payment` 含每 2 分钟定时补偿触发器；部署前确认 `cloudfunctions/payment/config.json` 随函数生效。
- 售后上线前必须创建 `after_sales_cases`、`admin_audit_logs` 及 `数据库索引.md` 第二节索引；管理员白名单变化后需重新部署或更新云函数环境变量。
- 上线前先分批迁移老用户 `protectedTaskQuota`，迁移完成前不得切全量；`reminder` 的会员限制由 `MEMBERSHIP_ENFORCEMENT_MODE` 控制：`off` 关闭、`test` 仅测试白名单、`all` 全量。默认 `test`，白名单在 `membership.js` 中，可用 `MEMBERSHIP_TEST_OPENIDS` 逗号分隔覆盖。审核与等待发布期间必须保持 `test`；`test` 非白名单 / `off` 期间新任务进入历史保护池，正式发布时才切 `all`，从切换后新建的任务才开始占新增额度。
- 只改小程序页面通常不需要部署云函数，但如果接口契约变化则必须部署。

## 状态纪律

测试通过、代码已提交、PR 已合并、已部署、真机已验证是不同状态，不能互相替代。无法验证时写 `pending`。
