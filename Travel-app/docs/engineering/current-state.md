# Travel-app 当前工程状态

> 更新时间：2026-11-24 23:05。
> 当前分支、HEAD、远端和 dirty 状态以 `git status` / `git log` 为准；本文只记录现役代码、运行态和未闭合风险。
> 历史版本过程进入 Git、验收单或事故文档，不在这里堆流水账。

## 当前定位

微信原生小程序，聚合北京热门景点的预约与放票规则，在放票前提醒用户去官方渠道手动抢票。产品不代抢、不代约，不承诺库存。

## 本地未发布

- 2026-11-24 清华抽签状态候选：抽签时段使用 `releaseSlots.statusOnly=true`，参与票务状态与“可预约至”窗口，但不创建提醒、不占授权或会员名额；即时预约仍是唯一提醒时段。`spots` 云函数、快照生成器、客户端静态镜像与 mock 共用同一过滤口径。景点详情和分享页文案由“最早可约”改为“可预约至”，场景卡去掉重复的“按规则推算”前缀，`earliestDate` 字段名保留兼容。新增清华专项回归覆盖抽签开放前后状态、人工 `SUCCESS` 和单任务/单名额；`npm test`、`npm run check`、`git diff --check` 已通过。**服务端已部署，用户确认真机验收通过；客户端未上传体验版。**

## 当前发布基线

### 客户端

- **最新正式版：`2.6.1`**（2026-11-20 10:01:56）。包含会员不限提醒能力门禁、反馈闭环、首页行程结果更正、清华 / 军博提醒时段收敛，以及客服工作台隐藏首页悬浮时钟横幅控制卡。
- **最新体验版：`2.6.2`**（2026-11-20 20:58）。对应 `codex/release-2.6.2-20261120@3c66d9e` / `v2.6.2-rc.1`；本版收口闭馆日提醒资格与顶部 Banner 放票状态：周一等闭馆日不可选，服务端以 `UNAVAILABLE / CLOSED_DAY` 二次拦截；Banner 按可约出行日反推真实放票时刻，避免“20:00 可约 11月29日”漏显示已放票。总包 `1,218,194` 字节，主包 `1,125,859` 字节。
- **下一候选：`2.7.0-rc.2`**（2026-11-24，待用户上传体验版）。候选分支 `codex/release-2.7.0-20261124`，合并首页品牌/横向锁、首页第 N 天、清华 status-only 与 `2.6.2` 闭馆日修复；自动验证、云函数部署、线上包哈希回读和提醒链路只读冒烟均通过。
- `2.6.2` **未提交审核、未发布正式版，真机验收 pending**。
- `2.4.3` 是 `2.4.4` 的合并前置候选，没有单独体验版记录；`2.4.4`、`2.5.0`、`2.6.0` 保留为体验版历史链路，`2.6.1` 已正式发布。

### 云函数

运行态于 2026-11-20 重新回读，以下业务函数均为 `Active`；`admin` 当前仍是旧版生产部署，仓库中的维护版待单独授权部署：

| 函数 | 最近修改 | 运行时 / 超时 | 当前作用 |
| --- | --- | --- | --- |
| `reminder` | 2026-11-24 15:43 | Nodejs16.13 / 60s | 首页聚合、行程、提醒、会员读取；抽签 status-only 与闭馆日拦截需由发布候选合并后统一校准 |
| `payment` | 2026-11-20 08:18:15 | Nodejs16.13 / 60s | 支付、权益、售后、提醒质量快照 |
| `notifier` | 2026-11-20 16:43:48 | Nodejs16.13 / 60s | 每分钟扫描并发送订阅消息 |
| `account` | 2026-11-19 18:14:20 | Nodejs16.13 / 60s | 账户注销预检与执行 |
| `feedback` | 2026-11-05 22:16:50 | Nodejs16.13 / 3s | 反馈、纠错与管理 |
| `spots` | 2026-11-24 15:38 | Nodejs16.13 / 3s | 景点列表、详情与规则；已部署 `54ddc5f`，线上包回读校验 3 个业务文件 |
| `admin` | 2026-11-20 19:57:41 | Nodejs20.19 / 60s | 仅清理过期事件；Web API 与日汇总已移除 |

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
| `2.6.1` | 正式版 | 隐藏首页悬浮时钟后台控制卡，推广默认 6 天 |
| `2.6.2-rc.1` | 体验版 | 闭馆日提醒资格、顶部 Banner 真实放票状态；服务端二次拦截闭馆日 |
| `2.7.0-rc.2` | 待上传 | 首页品牌与横向锁、首页第 N 天、清华 status-only、今日放票页英文装饰 |

版本级范围与上传记录以各 tag、`docs/engineering/acceptance-*.md` 和 Git 为准；本表只帮助识别现役基线。

## 最近已关闭事项

- **2026-11-24 `v2.7.0-rc.2` 服务端部署与提醒自测**：从 `main@5fb34f2` 整包部署最终 `reminder` / `spots` 并回读，线上包与 manifest 30 / 3 个业务文件哈希一致。只读冒烟确认：清华详情返回即时预约与抽签 `statusOnly`；`2026-11-26` 清单计划 `reminderTaskCount=1`，只含即时预约；故宫 `2026-12-14` 返回 `UNAVAILABLE / CLOSED_DAY`；`home.bootstrap` 成功；`task.list` 返回 `active=6 / expired=6`、6 条 `WAITING` 任务。未触发真实订阅消息发送。客户端体验版尚未上传。
- **2026-11-24 清华抽签状态服务端上线**：`reminder@87d93d7` 与 `spots@54ddc5f` 已整包部署并下载回读校验，均为 `Active` / Nodejs16.13。生产 `admin.seed` 先用 `dryRun` 备份 26 个景点与 26 条规则并输出逐字段差异；4 个无关景点的官网/抓取地址漂移未覆盖，只定向更新 `spotId=tsinghua`，随后 dry-run 为 0 差异。远程景点快照已更新为 `13d305867f72ab6521d9`，下载回读与本地 73,053 字节文件一致。云端冒烟确认清华详情 `earliestDate=2026-11-29`、抽签为 `statusOnly`，时间线仅返回即时预约 1 条提醒；开发者工具刷新后确认“可预约至”文案生效，用户已确认真机验收通过。**客户端未上传体验版。**
- **2026-11-20 修复版 `2.6.2` 收口**：闭馆日不再能通过日历或绕过页面创建提醒；顶部 Banner 按可约出行日反推真实放票时刻，恭王府 `11月29日` 正确显示“已放票”，`11月30日` 周一 `disabled=true`。体验版 `2.6.2` 已上传（总包 `1,218,194` 字节，主包 `1,125,859` 字节）；**未提交审核、未发布正式版、未做真机验收**。
- **2026-11-20 支付售后详情产物漂移**：`payment/index.js` 曾引用未导出的 `afterSales.refundEligibilityForOrder`，并缺少 `adminDirectory` 依赖，导致客服审核工单打开即返回 `1500`。已补齐售后资格聚合与依赖，新增真实 `afterSales.adminDetail` 入口契约、云函数拍平产物 manifest 校验和脏工作区发布门禁；生产 `payment` 已发布标准产物版本 4（`main@8ae725d`）并切 100% 流量，下载云端包与 manifest 的 27 个业务文件逐项一致，两分钟触发器核验存在。`npm test`、`npm run check`、`git diff --check` 通过。
- **2026-11-20 提醒发送全量中断**：`notifier` 的 `doc().get()` 形状判断错误，导致 223 个到期任务全量跳过并落为 `MISSED`。修复版已于 16:43:48 部署，`notifierEveryMinute` 保持启用；16:54:05 首个真实任务写入 `SEND_SUCCEEDED` / `TASK_TRIGGERED`。完整复盘见 `docs/engineering/reminder-outage-incident-20261120.md`。
- **2026-11-19 用户自助注销**：`account` 云函数、PAGE-012-1、支付/提醒竞态保护和隐私指引补充文档已落地并部署。
- **2026-11-19 首页摘要卡实际日期**：`home.bootstrap` 下发 `displayStartDate/displayEndDate`，服务端包含已过期日程；`user_runtime` 升级为 `/v2`。
- **2026-11-20 Web 管理后台生产退役**：删除 `admin-web/`、Web 登录/查询 API、测试和文档入口；`cloudfunctions/admin` 已部署为每日 180 天过期清理，不再生成 `reminder_daily_stats`。旧 `travel-admin-web/` 静态目录已删除，`admins` 集合已清空，历史凭据环境变量已移除。

## 当前风险与 pending

### 阻断发布或后续部署

- **本地 `main` 已领先远端**：`notifier` 修复与事故文档已 fast-forward 合并到本地 `main`（`f5b44ff`），但 `origin/main` 仍停在 `31c8dab`。推送前不要从远端或另一台机器重部署 `notifier`，否则可能回退故障。
- `2.6.2` 体验版尚未真机验收、未提交审核；正式版为 `2.6.1`。
- `2.7.0-rc.2` 已从 `main@5fb34f2` 部署最终 `reminder` / `spots` 产物并完成回读冒烟，等待用户上传体验版。`reminder`：30 个业务文件、135.9 KB、Active / Nodejs16.13 / 60s；`spots`：3 个业务文件、10.3 KB、Active / Nodejs16.13 / 3s；下载线上包后均与发布 manifest 逐文件哈希一致。
- 微信公众平台已提交的隐私保护指引仍引用注销旧路径，本地文档已改为「我的-编辑资料-注销账户」，平台更新 pending。

### 功能验收

- 用户自助注销：真实用户全流程、会员提示、阻塞项和注销后再次进入空账户仍待真机验收。
- 悬浮时钟激励视频：完整观看、中途关闭、跨设备和权益失效场景仍待真机验收。
- 提醒模板：线上真实发送已成功；旧/新模板任务分流和不同客户端授权路径仍需持续验证。
- 真实签名的微信支付 / 退款 HTTP 回调仍未观察到；现有查单、补偿和售后结果不能替代该证据。
- `cloudfunctions/admin` 清理版已部署；旧 `admin.login` 返回 `1099`，非定时内部调用返回 `1040`，`adminDailyCleanup` 已启用，手动清理演练 `success=true / removed=0`。小程序内客服工作台仍走 `payment` / `feedback`。

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
