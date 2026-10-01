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
- 代码质量包体积已收口：约 1.03MB 的景点图、二维码、提醒示例图与大背景已上传到 `cloud1-d9g9f4hja396d6e92/static/v0.3/images/`，代码包内只保留图标、默认头像与分享封面；当前 `miniprogram` 约 0.973MiB，本地图片/音频合计约 197.6KiB，距离微信 200KiB 硬线仅约 2.4KiB（2026-10-01 复核）。
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
- 小程序：未发布；新订阅模板真机已出现 `20001 No template data return`，当前正在按精确模板 ID 和控制台日志复核；`cart.commit` 写路径、完整真机交互和多机型视觉仍未 live verified。
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
