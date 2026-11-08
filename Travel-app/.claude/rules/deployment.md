---
paths:
  - "cloudfunctions/**"
  - "miniprogram/app.js"
  - "project.config.json"
---

# 部署规则

## 授权边界

没有用户当场明确确认，不部署云函数、不切环境、不修改生产配置、不执行清场。

任何新功能都不得先影响线上全量用户。用户可见行为、接口返回、价格或权益变更必须先通过显式测试白名单验证；若没有安全灰度手段，或解决阻塞必须改变生产行为，立即停止并等待用户明确授权。预览码、体验版上传、审核和正式发布是四种不同授权，不得互相替代。

会员改版必须复用现有 `MEMBERSHIP_ENFORCEMENT_MODE` 白名单机制：

- 客户端必须在 `reminder` 请求中显式声明 `membershipCapabilities: ['unlimited-v3', 'two-tier-v5']`；未声明 `unlimited-v3` 的旧客户端永久继续 `legacy-v2`。
- `test`：只有 `MEMBERSHIP_TEST_OPENIDS` 命中且声明能力的请求返回新会员方案；其他请求必须继续旧价格、旧额度和旧加量包契约。
- `all`：仅在用户明确授权后使用，只对所有声明能力的新客户端开放；不再依赖旧包覆盖率归零。
- `two-tier-v5` 是独立定价契约，由 `payment_config/membership_pricing` 的 `mode=test|all` 控制。`test` 必须同时声明能力且 OpenID 命中 `MEMBERSHIP_TEST_OPENIDS`；`all` 对所有声明能力的新客户端开放。配置缺失、非法或读取失败必须回退 `test`。即使额度模式为 `all`，也不得用 `membership_enforcement` 代替定价开关。
- `taskLimit=10000` 只能作为新方案内部兼容投影，禁止让未声明能力的旧客户端消费或展示。
- 部署前先确认 `membership_pricing` 为 `test`（或配置缺失）且白名单包含验收账号；部署后分别验证新能力白名单命中、新能力普通账号未命中、旧客户端无能力声明三种响应。全量定价必须通过后台独立开关切换。
- 任何 API 契约、价格权益、默认值或字段语义变更，先按 `docs/engineering/client-version-compatibility.md` 写出旧契约、新契约、能力门禁和发布矩阵；不得依赖等待旧客户端覆盖率归零。
多放票时段能力必须保留 `supportsMultiRelease` 请求级能力门禁：旧客户端不传时，`reminder` 继续使用顶层 `advanceDays + releaseTime` 创建单任务；新客户端传 `true` 后才读取 `releaseSlots`。当前清华、军博的规则已收敛为每个出行日一条任务，部署时必须一并更新 `data/rules.json`、函数内规则副本和静态快照。更新数据库规则前必须先备份并逐字段比较线上 `release_rules` 与 `spots`：`admin.seed` 会同时 upsert 全部景点和规则，只有两张表都与种子一致或差异均经明确确认时才可执行；存在无关漂移时，只对目标 `spotId` 做精确更新。上线顺序为部署带门禁的 `reminder`、更新规则与快照、核验数据库仅目标数据变化，再发布新客户端；不得只发客户端或只上传函数代码而漏掉规则数据。

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
5. 景点静态快照先运行 `npm run build:spots-snapshot`，再通过 `scripts/upload-cloud-assets.sh` 上传 `static/v1/data/`；包内快照始终作为回退，不得只发布远程文件。

## 部署顺序

- 先数据与索引，再业务云函数。
- 同时影响 `reminder` 与 `notifier` 的改动必须分别确认。
- 会员 / 提醒名额上线需部署 `payment`。缺省通道仍是微信支付 API v3，环境变量见 `docs/engineering/payment-v3-runbook.md`；只有设置 `PAYMENT_PROVIDER=VIRTUAL_PAY` 才开放小程序虚拟支付。灰度联调必须同时设置 `PAYMENT_VIRTUAL_PAY_TEST_OPENIDS`，此时非白名单用户继续 API v3；删除该白名单才表示支付全量。两档候选另需 `WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_QUOTA_10`、`WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_TWO_TIER_UNLIMITED`、`WECHAT_VIRTUAL_PAY_PRODUCT_MEMBER_UNLIMITED_UPGRADE`。变量、道具、消息推送和 iOS 限制见 `docs/engineering/payment-virtual-runbook.md`。旧 API v3 代码、配置说明和 Runbook 必须保留，不得在虚拟支付接入时删除。
- `payment` 的公网回调必须走 CloudBase HTTP 网关：`/payment/notify` 与 `/payment/refund-notify` 分别指向云函数 `payment`，关闭身份认证、跨域和路径透传，并保留原始 body；默认域名只能用于测试，正式回调使用备案自定义域名。
- 虚拟支付推荐使用云开发「设置 → 其他设置 → 消息推送 → 云函数」，分别把 `xpay_goods_deliver_notify`、`xpay_refund_notify`、`xpay_subscribe_ios_refund_query_notify` 推送到 `payment`。不要只配置 `/payment/virtual-notify` HTTP 兼容路由。
- `payment` 含每 2 分钟定时补偿触发器；部署前确认 `cloudfunctions/payment/config.json` 随函数生效，并先创建 `payment_reconcile_state` 及补偿游标索引。
- 使用微信开发者工具 CLI 整包部署 `payment` 会清空已有定时触发器；每次部署后必须用腾讯云 `ListTriggers` 核验并恢复 `paymentReconcileEveryTwoMinutes`，不得只凭 `config.json` 或部署成功回执认为触发器仍存在。
- 售后上线前必须创建 `after_sales_cases`、`admin_audit_logs` 及 `数据库索引.md` 第二节索引；管理员白名单变化后需重新部署或更新云函数环境变量。
- 客服工作台提醒质量快照由 `payment` 的现有 `paymentReconcileEveryTwoMinutes` 定时器生成并写入 `payment_config/reminder_quality_latest`；工作台接口只读快照。上线前必须核验 `reminder_events.releaseAt` 与 `reminder_tasks.releaseAt` 索引，并在部署 `payment` 后确认定时触发器仍存在、首个窗口快照可回读；不改 `reminder` / `notifier`，不代表已配置主动告警或半日定时统计。
- 会员购买断路器依赖 `payment_config` 集合中的确定性文档 `membership_sales`。首次部署前先创建集合；文档缺失时默认开放，集合读取失败时新购买失败关闭。`reminder` 与 `payment` 必须读取同一份文档，不得改成两个独立环境变量。
- 客服工作台订单查询部署前必须存在 `users(nickname)`、`orders(createdAt)`、`orders(status,createdAt)` 和 `after_sales_cases(caseNo)` 索引；时间范围查询复用 `orders(createdAt)` 与 `orders(status,createdAt)`，缺索引时不得部署含 `adminOrders.*` 的 `payment`。
- 名额账本迁移固定在后端部署后执行：先全量分批 `dryRun=true` 保存差异，再从头以 `dryRun=false` 沿 `nextCursor` 迁移到 `hasMore=false`；迁移完成前会员限制只能保持 `test`。
- 会员限制运行期真身为 `payment_config/membership_enforcement`，`mode=off|test|all`。管理端切换写该文档并立即对新任务生效，不重新部署；已有任务保留原 `quotaPool`。配置缺失、非法或读取失败时，`reminder` 回退 `MEMBERSHIP_ENFORCEMENT_MODE`，白名单仍由 `MEMBERSHIP_TEST_OPENIDS` 控制。
- 会员升级临时公告真身为 `payment_config/membership_upgrade_notice`，固定字段 `noticeId / enabled / startsAt / endsAt`。公开展示必须同时满足 `unlimited-v3` 命中、当前有效会员、`memberSince < startsAt`、`enabled=true` 和在有效期内；非白名单、免费用户及公告上线后新开通会员不得返回公告字段。
- 公告默认只跑 72 小时。上线顺序为先部署 `payment`（后台写开关与审计），再部署 `reminder`（公开读取与会员状态注入），最后由管理员把配置切为 `enabled=true`；下架由客服工作台直接切 `enabled=false`，不需要重新部署。`payment` 写后失效本函数实例缓存，`reminder` 读取缓存最多 45 秒，用户下次进入“我的”页时隐藏。
- 上线前先分批迁移老用户 `protectedTaskQuota`；保护额度迁移和权益账本迁移任一未完成时，后台切 `all` 必须返回 `1033`。审核与等待发布期间保持 `test`；`test` 非白名单 / `off` 期间新任务进入历史保护池，切 `all` 后新建的任务才占新增额度。
- 只改小程序页面通常不需要部署云函数，但如果接口契约变化则必须部署。
- 首页读模型运行期为 `HOME_RUNTIME_MODE=off|shadow|on`，默认 `off`。启用前必须创建 `user_runtime` 集合；先跑 `shadow`，连续 24 小时结构化比对零差异后再切 `on`。`HOME_RUNTIME_MAX_AGE_MS` 只控制派生文档的最长复用时间，不能替代写后失效。
- 批量预建使用 `reminder.action='admin.runtimeBackfill'`，必须配置 `RUNTIME_BACKFILL_TOKEN` 并在请求中携带同值；未配置时动作始终拒绝。按 `limit <= 50` 和 `nextCursor` 重跑，直到 `hasMore=false`。
- `reminder`、`spots`、`payment`、`notifier` 的资源日志可通过 `RESOURCE_METRICS_LOG=off` 关闭；生产默认开启，日志不得加入 OpenID 或业务内容。

## 状态纪律

测试通过、代码已提交、PR 已合并、已部署、真机已验证是不同状态，不能互相替代。无法验证时写 `pending`。
