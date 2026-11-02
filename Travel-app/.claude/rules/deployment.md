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
- 会员 / 提醒名额上线需部署 `payment`。缺省通道仍是微信支付 API v3，环境变量见 `docs/engineering/payment-v3-runbook.md`；只有设置 `PAYMENT_PROVIDER=VIRTUAL_PAY` 才开放小程序虚拟支付。灰度联调必须同时设置 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS`，此时非白名单用户继续 API v3；删除该白名单才表示支付全量。变量、道具、消息推送和 iOS 限制见 `docs/engineering/payment-virtual-runbook.md`。旧 API v3 代码、配置说明和 Runbook 必须保留，不得在虚拟支付接入时删除。
- `payment` 的公网回调必须走 CloudBase HTTP 网关：`/payment/notify` 与 `/payment/refund-notify` 分别指向云函数 `payment`，关闭身份认证、跨域和路径透传，并保留原始 body；默认域名只能用于测试，正式回调使用备案自定义域名。
- 虚拟支付推荐使用云开发「设置 → 其他设置 → 消息推送 → 云函数」，分别把 `xpay_goods_deliver_notify`、`xpay_refund_notify`、`xpay_subscribe_ios_refund_query_notify` 推送到 `payment`。不要只配置 `/payment/virtual-notify` HTTP 兼容路由。
- `payment` 含每 2 分钟定时补偿触发器；部署前确认 `cloudfunctions/payment/config.json` 随函数生效，并先创建 `payment_reconcile_state` 及补偿游标索引。
- 使用微信开发者工具 CLI 整包部署 `payment` 会清空已有定时触发器；每次部署后必须用腾讯云 `ListTriggers` 核验并恢复 `paymentReconcileEveryTwoMinutes`，不得只凭 `config.json` 或部署成功回执认为触发器仍存在。
- 售后上线前必须创建 `after_sales_cases`、`admin_audit_logs` 及 `数据库索引.md` 第二节索引；管理员白名单变化后需重新部署或更新云函数环境变量。
- 会员购买断路器依赖 `payment_config` 集合中的确定性文档 `membership_sales`。首次部署前先创建集合；文档缺失时默认开放，集合读取失败时新购买失败关闭。`reminder` 与 `payment` 必须读取同一份文档，不得改成两个独立环境变量。
- 客服工作台订单查询部署前必须存在 `users(nickname)`、`orders(createdAt)`、`orders(status,createdAt)` 和 `after_sales_cases(caseNo)` 索引；缺索引时不得部署含 `adminOrders.*` 的 `payment`。
- 名额账本迁移固定在后端部署后执行：先全量分批 `dryRun=true` 保存差异，再从头以 `dryRun=false` 沿 `nextCursor` 迁移到 `hasMore=false`；迁移完成前只能保持 `MEMBERSHIP_ENFORCEMENT_MODE=test`。
- 上线前先分批迁移老用户 `protectedTaskQuota`，迁移完成前不得切全量；`reminder` 的会员限制由 `MEMBERSHIP_ENFORCEMENT_MODE` 控制：`off` 关闭、`test` 仅测试白名单、`all` 全量。默认 `test`，白名单在 `membership.js` 中，可用 `MEMBERSHIP_TEST_OPENIDS` 逗号分隔覆盖。审核与等待发布期间必须保持 `test`；`test` 非白名单 / `off` 期间新任务进入历史保护池，正式发布时才切 `all`，从切换后新建的任务才开始占新增额度。
- 只改小程序页面通常不需要部署云函数，但如果接口契约变化则必须部署。

## 状态纪律

测试通过、代码已提交、PR 已合并、已部署、真机已验证是不同状态，不能互相替代。无法验证时写 `pending`。
