# Travel-app 当前工程状态

> 当前分支：`codex/v0.3-main-flow-ux`
> 当前 HEAD：`e321a5e perf(home): 修复首页冷启动白屏，砍掉云端串行查询与嵌套冷启动`
> 远端：`origin/codex/v0.3-main-flow-ux` 仍为 `6324517`；本地分支领先远端 3 个提交，另有未提交工作区改动
> 更新时间：2026-10-01

## 当前定位

微信原生小程序，聚合北京热门景点的预约与放票规则，在放票前提醒用户去官方渠道手动抢票。产品不代抢、不代约，不承诺库存。

## 已实现

- 首页已收敛为“行程状态墙”；新用户空态展示动态结果预览、提醒样式入口和高热度 S 级景点的「近期热门景点放票」。
- 创建行程到设置提醒的主流程已按 V0.3 落地：四步流程、日期锚点、清单提醒策略、PAGE-008 授权硬闸门。
- 行程项、票务结果、提醒送达状态、提醒任务已拆分建模；首页事实来源是 `trip_items`。
- 分享、深链、今日放票、国庆场景页与埋点已实现。
- 提醒额度的五态健康度、48 小时预警和用户主动补齐流程已实现；“提醒设置”入口按钮为「补授权次数+1」，微信一次性订阅每次点击最多增加 1 条。
- “我的”页已增加隐私政策与用户服务协议入口；应用内协议由 `docs/legal/` 生成，等待微信后台隐私指引填报与真机授权验证。
- “我的”页的反馈与纠错入口已收口为“帮助与反馈”，并新增“我的反馈”本人记录页（当前工作区已实现，未提交）。
- 首页进行中行程内的已结束日期组已默认折叠，入口位于该趟内容顶部、今天/未来日期之前（当前工作区已实现，未提交）。
- 自有公众号「智序准点游」有两处入口：「我的」页底部独立一张「关注公众号」卡，以及 PAGE-008 提交成功卡片底部一行攻略入口；两者共用 `components/oa-follow-sheet` 浮层，文案与二维码统一取自 `utils/official-account.js`。
  - 这两处入口最初在分支 `codex/ux1012` 的 `5834cbb`（2026-10-15）实现，但该分支一直没合入 main；2026-10-22 工作区从该分支切回 main 后，入口从界面上消失。2026-10-27 从该分支精准移植回来（只取公众号相关文件；该分支上的首页摘要卡、日期吸顶、管理后台与删除 webview 页仍未跟进）。
  - PAGE-008 的成功反馈随之由 Toast 改为轻量成功卡片（4 秒自动返回、可主动关闭）——Toast 上放不了可点的公众号入口。
  - 二维码走云存储 `static/v0.3/images/qrcodes/zhundianyou-oa.jpg`，源文件在 `cloud-assets/images/qrcodes/`；**该图是否已上传到当前云环境需真机确认**，未上传时浮层降级为「搜一搜」文案，入口仍可用。
- 代码质量包体积已收口：约 1.03MB 的景点图、二维码、提醒示例图与大背景已上传到 `cloud1-d9g9f4hja396d6e92/static/v0.3/images/`，代码包内只保留图标、默认头像与分享封面；当前 `miniprogram` 约 0.969MiB，本地图片/音频合计约 191.3KiB，距离微信 200KiB 硬线还有约 8.7KiB（2026-10-26 复核）。
- 2026-10-01 工作区已实现：景点详情「今日最早可约」规则行、景点 Tab 难度角标与直接「设提醒」、订阅模板双轨兼容（旧任务旧模板、新任务新模板）、提醒设置页新版机制说明；均未提交、未部署、未真机完整验收。

## 当前配置

- `USE_MOCK=false`，默认走腾讯云开发。
- 当前 cloudEnv：`cloud1-d9g9f4hja396d6e92`。
- 当前 appid：`wx05c160a589b97d76`。
- appid 与 cloudEnv 必须成对更换。

## 发布状态

- 代码：本地 HEAD `e321a5e`；`origin/codex/v0.3-main-flow-ux` 停在 `6324517`，本地领先 3 个提交。工作区仍有 30+ 个未提交改动，尚未进入远端。最近一轮云端状态记录见 `docs/engineering/archive/launch-test-report-v0.3-20260928-review.md` §九。
- 构建：2026-10-01 当前工作区 `npm test`（27 套）、`npm run check`、`git diff --check` 均通过。首页缓存/实况重复 `setData` 已修复：缓存帧改用缓存返回体自带的 `serverNow` 计算，避免设备时间与云端时间被解释成不同日期。
- 云函数：`reminder` 已于 2026-09-28 部署，并通过真实云环境只读 `home.bootstrap` 冒烟；当前未提交的 `reminder`、`spots`、`feedback`、`notifier` 改动尚未部署。
- 小程序：**2026-10-27 已发布**（用户上传工作区代码并提交发布，含当日三项客户端降本改动）。发布前的待办仍未闭环：新订阅模板真机曾出现 `20001 No template data return`；`cart.commit` 写路径、完整真机交互和多机型视觉仍未 live verified。**当前线上客户端与 git 任何提交都不严格对应**（发布源是未提交工作区），需要尽快补一个 tag 对齐。
- 因此不得把“测试通过”“部分云函数已部署”写成“整体已上线”或“用户已看到新版本”。

## 当前需要部署的范围

- `reminder`：**2026-09-30 首页冷启动优化有多处改动，必须重新部署**（`index.js` 的
  `homeBootstrap` 并行化 + `includeSpots` 默认值翻转、`lib/trip.js` 的 `list`/`removeIfEmpty`
  并行化、`lib/task.js` 的 `sweepOverdue` 并发写）。另有未提交的额度预警文案改动。
  ⚠️ **`includeSpots` 默认值由 `true` 改为 `false` 是契约变更**（`API-契约.md` 8.2）：
  未部署时前端拿不到 `hotSpots`，但前端已有本地切片兜底，不会白屏。
- `spots`：当前未提交的景点卡新增 `shortName` 透传需要部署；首页空态示例有全名回退，但未部署时拿不到简称。
- `feedback`：当前未提交的管理员 openid 白名单与 `feedback.adminStatus` 入口校验需要部署；帮助与反馈、我的反馈页面依赖现有 `feedback.list` 契约。
- `notifier`：已兼容旧任务走旧「活动开始通知」、新任务走新「预约开始提醒」；按任务实际模板发送和核销额度。应先部署，使旧任务和随后产生的新模板任务都有正确分流；当前已确认 `status_release_idx = backendStatus + releaseAt` 已存在，但云端触发器、测试发送和真机模板授权仍未完成闭环核对。
- `reminder`：新提醒任务会写入当前模板 `_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA`；`lib/quota.js` 已兼容旧任务按旧模板记账。应在 notifier 之后部署，最后再发布小程序端。
- 小程序端：提交后重新编译；仅部署云函数不能替代小程序端发布。

## 数据库索引待补（控制台操作，非部署）

2026-09-30 新增三条「必须」索引，缺了会让首页冷启动退化。2026-10-01 真机控制台截图已确认 `reminder_tasks.status_release_idx`（`backendStatus + releaseAt`）已存在；以下三条仍待逐项核对：

- `reminder_tasks` 单字段 `userId`（此前误归在「建议」）—— `home.bootstrap` 每次按
  `userId` 全量取任务，无 limit。
- `reminder_tasks` 的 `userId + tripId + backendStatus + releaseAt`（此前误归在「建议」）——
  `trip.list` 每趟取最近一个 WAITING 任务算 `nextReminderAt`；文档原先写的
  「新版首页由 trip_items 聚合」在 V2 首页改调 `trip.list` 之后已经过时。
- `reminder_cart` 单字段 `userId` —— bootstrap 为 `trip.list` 的 `removeIfEmpty`
  预取全量清单（一次读换掉原本每趟行程 3 次 count）。

⚠️ **复查方式**：把 `cloudfunctions/**` 里所有 `.where({...})` 组合列出来，与本文档
两张表逐条对照，而不是只信文档自己的描述 —— 上面两条「建议」项的描述就是这么过期的。
详见 `数据库索引.md` 第二节。

### 2026-10-27 新增待建（访问量暴涨后的降本复核）

- `users` 单字段 `openId` —— **优先级最高**。`home.bootstrap` / `user.profile` /
  `subscribe.get` / notifier 扣额度全走它，`users` 是全项目唯一「行数 = 用户数」的集合，
  无索引时成本随用户数平方级上涨。原先误归在「建议」节。
- `spots` 单字段 `spotId`、`release_rules` 单字段 `spotId` —— 文档此前完全没有这两条。
- `reminder_tasks` 的 `backendStatus + cleanAt` —— notifier cleanup 每轮都扫。
  在补建之前，cleanup 已先从每分钟降到每小时一次（见下）。

## 2026-10-27 调用量降本

背景：小程序访问量从每天 20–30 涨到半天 1200+，云函数调用次数与数据库读操作同步暴涨。

**云端（改完需部署才生效）**

- `trip.js` 的 `nextReminderAt`：传了 `prefetched.tasks` 时改用内存归并，消掉「每趟行程一次查询」的 N+1。不传时仍走原查询，`trip.list` 独立 action 行为不变。
- `spots/index.js` 的 `loadAll` 与 `reminder/lib/item.js` 的 `loadSpotContext`：加 60 秒实例内整表缓存（空表不缓存）。
- `subscribe.get`：查询从「该用户全部历史任务」收窄为 `WAITING + releaseAt > now`，并在内存里兜一次非有限时间戳。
- `notifier`：`cleanup` 从每分钟降到每小时（`shouldRunCleanup`），`scanAndSend` / `sweepMissed` 仍是每分钟；cleanup 的三次 `count()` 改成 `hasAny()` 判空查询。

**客户端（第一批已发版；第二、三批待发版）**

- 首页 `onShow` 加 30 秒复用窗口（`HOME_BOOTSTRAP_TTL_MS`，原先只写在 `codex/ux1012` 分支上，本次回收），配 `test/home-bootstrap-ttl.test.js`。**2026-10-27 已发版。**
- 新增 `utils/spots-cache.js`：`spots.list` 的 10 分钟跨页内存缓存，6 个调用方共用。**2026-10-27 已发版。**
- `add-trip`：`onShow` 首次跳过 `loadCart`，消除与 `onLoad` 的重复 `cart.list`。**2026-10-27 已发版。**

**2026-10-27 第二批（未发版）：首页窗口改自适应**

背景：第一批发版后调用量仍在涨。用 `test/mock-db.js` 实测（探针不入库），`spots.list` 在云端 60 秒缓存命中后是 **0 次数据库请求**，静态化已经拿不回东西；真正的大头是 `home.bootstrap`——每次执行固定 **5 次数据库请求**（行程 / 行程项 / 提醒任务 / 清单 / 用户），带回的**文档条数随用户自己的数据量涨**（新用户 3 项 9 条、老用户 23 项 55 条）。而固定 30 秒窗口意味着「切出去超过半分钟回来」就是一次完整重读，成本挂在亮屏次数上。

- 新增 `utils/home-refresh-window.js`：按「最近一场放票离现在多远」定窗口——放票窗口内（前 60 分钟～后 10 分钟）30 秒，今天稍晚还有票 60 秒，其余 180 秒；无放票时刻按 180 秒，形状意外兜底 30 秒。
- `home.js`：`_bootTtlMs` 在 bootstrap 成功回调里由 `buildHomeData` 的产物算一次，`loadHome` 只做减法。只读服务端已算好的 `banner.releaseAt` / `bannerPills[].releaseAt`，页面不重新推导业务状态。写后刷新、无缓存首次进入、不传 `allowTtlReuse` 的调用一律即时，行为不变。
- 发版后从 `home_load_timing` 的 `branch` 区分 `reuse-30` / `reuse-60` / `reuse-180`，可直接看出省掉的请求量。
- 配 `test/home-refresh-window.test.js`（边界）+ 更新 `test/home-bootstrap-ttl.test.js`（结构钉子）。
- **未做**：首页没有下拉刷新（`home.json` 未开 `enablePullDownRefresh`），将来加时其 handler 不得传 `allowTtlReuse`。

## 部署与生效状态

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 云函数 `reminder` / `spots` / `notifier` | **已部署**（2026-10-27，用户操作） | 尚未真机验证；见下方复查项 |
| 索引 `spots.spotId` / `release_rules.spotId` / `reminder_tasks.userId+itemId` | **已建**（2026-10-27，用户操作） | 控制台操作，即时生效 |
| 客户端第一批（固定 30s TTL、spots 缓存、add-trip 去重） | **已发版**（2026-10-27，用户操作） | 发布源为未提交工作区，与 git 无对应提交；需补 tag 对齐 |
| 客户端第二批（首页自适应窗口 `home-refresh-window.js`） | **未发版**（本地工作区） | 纯客户端改动，不涉及云函数部署 |

⚠️ **测试通过、已部署、真机已验证是三个不同状态，不能互相替代。** 以上部署项仍为 `pending` 真机验证。

**部署后要盯的三件事：**

1. `notifier` 的 `tick` 日志里 `cleaned` 应大部分时间是 `"skipped"`（每小时才真正执行一次）。若仍每分钟返回清理结果，说明节流失效。
2. `reminder_tasks` 的 `status_release_idx` 命中次数增速 —— notifier 是**固定成本**（每分钟一次，与用户量无关），按 146,892 次 / 约 51 天倒推约 2,880 次/天，符合预期。若部署后仍快速上涨，说明有别的查询也在用它。
3. `spots` / `release_rules` 的 `spotId` 索引命中应从 0 开始增长 —— 增长即说明查询已走索引。

**尚未处理（下一轮）**：`notifier` 的 `scanAndSend` / `sweepMissed` 仍每分钟各扫一次（约 2,880 次索引命中/天，固定成本）。降频需单独评估，因为 `sweepMissed` 漏跑会让任务卡在「待提醒」。

## 待验证

- V0.3 主流程真机交互。
- 帮助与反馈、我的反馈页面的真机跳转、空态、失败重试与在线客服。
- 首页已过去日期折叠的展开/收起、滚动位置与不同机型视觉。
- 提醒授权补齐、系统通知授权和「补授权次数+1」（每次点击最多 +1）。
- 新模板 `_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA` 的真机授权、旧模板任务分流和新模板任务分流。
- 新用户首页空态的视觉间距和不同机型适配。
- 分享、深链与场景页的真实微信环境行为。
- 微信隐私授权弹窗、拒绝路径、`wx.openPrivacyContract` 与协议页面真机验证。

## 权威文档

- 产品状态与行为：`产品文档.md`
- API 契约：`API-契约.md`
- 数据库索引：`数据库索引.md`
- 视觉规范：`figma_design.md`
- 提醒故障处理：`docs/engineering/reminder-troubleshooting.md`
- 工程迁移索引：`docs/engineering/rule-index.md`
- 上线前结论（归档）：`docs/engineering/archive/launch-test-report-v0.3-20260928-review.md`
