# Travel-app 当前工程状态

> 更新时间：2026-11-20。
> 当前分支、HEAD、远端和 dirty 状态以 `git status` / `git log` 为准；本文只记录现役代码、运行态和未闭合风险。
> 历史版本过程进入 Git、验收单或事故文档，不在这里堆流水账。

## 当前定位

微信原生小程序，聚合北京热门景点的预约与放票规则，在放票前提醒用户去官方渠道手动抢票。产品不代抢、不代约，不承诺库存。

## 当前发布基线

### 客户端

- **最新正式版：`2.3.7`**（2026-11-06）。包含会员不限提醒能力门禁、反馈闭环、首页行程结果更正，以及清华 / 军博提醒时段收敛。
- **最新体验版：`2.6.1`**（2026-11-20 08:26）。对应 `codex/experience-2.6.1-20261120@4ba0b33` / `v2.6.1-rc.1`；在 `2.6.0rc.2` 基础上隐藏客服工作台的首页悬浮时钟控制卡，并把推广默认窗口改为 6 天。
- `2.6.1` **未提交审核、未发布正式版，真机验收 pending**。
- `2.4.3` 是 `2.4.4` 的合并前置候选，没有单独体验版记录；`2.4.4`、`2.5.0`、`2.6.0`、`2.6.1` 均为体验版链路，不能写成正式发布。

### 云函数

运行态于 2026-11-20 重新回读，以下业务函数均为 `Active`；`admin` 当前仍是旧版生产部署，仓库中的维护版待单独授权部署：

| 函数 | 最近修改 | 运行时 / 超时 | 当前作用 |
| --- | --- | --- | --- |
| `reminder` | 2026-11-19 18:03:53 | Nodejs16.13 / 60s | 首页聚合、行程、提醒、会员读取 |
| `payment` | 2026-11-20 08:18:15 | Nodejs16.13 / 60s | 支付、权益、售后、提醒质量快照 |
| `notifier` | 2026-11-20 16:43:48 | Nodejs16.13 / 60s | 每分钟扫描并发送订阅消息 |
| `account` | 2026-11-19 18:14:20 | Nodejs16.13 / 60s | 账户注销预检与执行 |
| `feedback` | 2026-11-05 22:16:50 | Nodejs16.13 / 3s | 反馈、纠错与管理 |
| `spots` | 2026-11-03 16:33:35 | Nodejs16.13 / 3s | 景点列表、详情与规则 |
| `admin` | 待部署 | Nodejs20.19 / 60s | 仓库已改为过期事件清理；Web API 与日汇总已移除 |

- `notifierEveryMinute`：存在、启用，`0 * * * * * *`。
- `paymentReconcileEveryTwoMinutes`：存在、启用，`0 */2 * * * * *`；`payment_config/reconcile_health.lastRunAt` 持续刷新。
- `scraper`、`ics-generator` 保持现役，但不属于本次客户端版本主链路。

### 运行期配置

- `payment_config/membership_sales.state=OPEN`。
- `payment_config/membership_enforcement.mode=all`。
- `payment_config/membership_pricing.mode=all`。
- `payment_config/home_clock_promo.enabled=true`，截止 `2026-11-23 19:41:19`（北京时间）；到期后首页横幅自动返回空。
- `payment_config/reminder_quality_latest` 当前为 `schemaVersion=2`；2026-11-20 13:00 窗口捕获了提醒中断事故，后续窗口按 13:00 / 21:00 定时刷新，事故数值以复盘文档为准。

## 最近版本范围

| 版本 | 状态 | 主要范围 |
| --- | --- | --- |
| `2.3.7` | 正式版 | 会员 ¥6 不限提醒、反馈闭环、首页结果更正、提醒时段收敛 |
| `2.4.3` | 已并入 `2.4.4` | 首页提醒入口与景点浮层按钮、今日放票页、提醒质量 schema v2 |
| `2.4.4` | 体验版 | 未送达原因点击守卫、用户协议入口合并 |
| `2.5.0-rc.6` | 体验版 | 悬浮抢票时钟、会员三档/升级 CTA、激励视频震动解锁、3 元档快照修复 |
| `2.6.0rc.2` | 体验版 | 用户自助注销、摘要卡实际日期范围、景点限购提示、会员 CTA 调整 |
| `2.6.1` | 体验版 | 隐藏首页悬浮时钟后台控制卡，推广默认 6 天 |

版本级范围与上传记录以各 tag、`docs/engineering/acceptance-*.md` 和 Git 为准；本表只帮助识别现役基线。

## 最近已关闭事项

- **2026-11-20 提醒发送全量中断**：`notifier` 的 `doc().get()` 形状判断错误，导致 223 个到期任务全量跳过并落为 `MISSED`。修复版已于 16:43:48 部署，`notifierEveryMinute` 保持启用；16:54:05 首个真实任务写入 `SEND_SUCCEEDED` / `TASK_TRIGGERED`。完整复盘见 `docs/engineering/reminder-outage-incident-20261120.md`。
- **2026-11-19 用户自助注销**：`account` 云函数、PAGE-012-1、支付/提醒竞态保护和隐私指引补充文档已落地并部署。
- **2026-11-19 首页摘要卡实际日期**：`home.bootstrap` 下发 `displayStartDate/displayEndDate`，服务端包含已过期日程；`user_runtime` 升级为 `/v2`。
- **2026-11-20 Web 管理后台退役**：删除 `admin-web/`、Web 登录/查询 API、测试和文档入口；`cloudfunctions/admin` 只保留每日 180 天过期清理，不再生成 `reminder_daily_stats`。生产云函数尚未重新部署。

## 当前风险与 pending

### 阻断发布或后续部署

- **本地 `main` 已领先远端**：`notifier` 修复与事故文档已 fast-forward 合并到本地 `main`（`f5b44ff`），但 `origin/main` 仍停在 `31c8dab`。推送前不要从远端或另一台机器重部署 `notifier`，否则可能回退故障。
- `2.6.1` 体验版尚未真机验收、未提交审核；正式版仍是 `2.3.7`。
- 微信公众平台已提交的隐私保护指引仍引用注销旧路径，本地文档已改为「我的-编辑资料-注销账户」，平台更新 pending。

### 功能验收

- 用户自助注销：真实用户全流程、会员提示、阻塞项和注销后再次进入空账户仍待真机验收。
- 悬浮时钟激励视频：完整观看、中途关闭、跨设备和权益失效场景仍待真机验收。
- 提醒模板：线上真实发送已成功；旧/新模板任务分流和不同客户端授权路径仍需持续验证。
- 真实签名的微信支付 / 退款 HTTP 回调仍未观察到；现有查单、补偿和售后结果不能替代该证据。
- `cloudfunctions/admin` 的清理版代码尚未部署；生产仍运行旧 Web 管理 API，直到单独授权部署后才会关闭公开入口。小程序内客服工作台仍走 `payment` / `feedback`。

### 运维与成本

- `notifier` 的 `scanAndSend` / `sweepMissed` 仍每分钟扫描，固定调用成本未降频；降频需避免 `MISSED` 卡单。
- 尚未配置 `notifier` 全量跳过、连续无成功发送或失败率突增的主动告警；当前依赖质量快照、日志巡检和用户反馈。

## 当前配置

- `USE_MOCK=false`，默认走腾讯云开发。
- appid：`wx05c160a589b97d76`。
- cloudEnv：`cloud1-d9g9f4hja396d6e92`。
- appid 与 cloudEnv 必须成对更换。
- 只有支付探针页在 `envVersion=develop` 时临时路由到 `unpay-d4gf8fyrt5523ca65`；体验版和正式版使用 `cloud1`。

## 数据库与索引

- 新环境需要 17 个现役集合；已有环境的 `admins`、`reminder_daily_stats` 仅作为历史数据保留，不再被代码使用。
- `数据库索引.md` 第二节「必须」索引是现役基线；管理后台与注销相关索引已创建并回读。
- `payment_reconcile_state` 以确定性文档 ID 工作，不依赖自定义索引。
- 用户注销新增的 `admin_audit_logs(targetType,targetId)`、`search_history(userId,searchedAt)`、`rewarded_ad_attempts(userId)` 已创建并回读。

## 权威文档

- 产品行为与页面规则：`产品文档.md`
- API 与错误码：`API-契约.md`
- 数据库集合与索引：`数据库索引.md`
- 工程结构：`docs/engineering/architecture.md`
- 提醒故障与部署验收：`docs/engineering/reminder-troubleshooting.md`
- 提醒中断事故：`docs/engineering/reminder-outage-incident-20261120.md`
- 会员支付与售后：`docs/engineering/membership-payment.md`
- 新旧客户端兼容：`docs/engineering/client-version-compatibility.md`
- 规则迁移索引：`docs/engineering/rule-index.md`
