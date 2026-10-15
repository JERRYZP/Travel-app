# Travel-app 当前工程状态

> 当前分支：`codex/ux1012`
> 当前 HEAD：`5834cbb`（工作区改动的汇总提交；本文件的状态更新提交在它之后）
> 远端：尚未推送
> 更新时间：2026-10-15
>
> ⚠️ **2026-10-15 提交**：工作区改动已随 `5834cbb`
> （feat(v0.3): 汇总近期工作区改动）提交到 `codex/ux1012`，下面各条里原先写的「未提交」
> 一律按此为准；**仍未推送、未部署、未真机验收**（三者互不替代）。
> 2026-10-15 新增的一条（全部行程结束后摘要卡不退场）已含在该提交里；
> `Travel-app/参赛材料/`（含身份证人像面）**未提交**，按隐私考虑留在本地。

## 当前定位

微信原生小程序，聚合北京热门景点的预约与放票规则，在放票前提醒用户去官方渠道手动抢票。产品不代抢、不代约，不承诺库存。

## 已实现

- 首页已收敛为“行程状态墙”；新用户空态展示动态结果预览、提醒样式入口和高热度 S 级景点的「近期热门景点放票」。
- 创建行程到设置提醒的主流程已按 V0.3 落地：四步流程、日期锚点、清单提醒策略、PAGE-008 授权硬闸门。
- 行程项、票务结果、提醒送达状态、提醒任务已拆分建模；首页事实来源是 `trip_items`。
- 分享、深链、今日放票、国庆场景页与埋点已实现。
- 提醒额度的五态健康度、48 小时预警和用户主动补齐流程已实现；“提醒设置”入口按钮为「补授权次数+1」，微信一次性订阅每次点击最多增加 1 条。
- “我的”页已增加隐私政策与用户服务协议入口；应用内协议由 `docs/legal/` 生成，等待微信后台隐私指引填报与真机授权验证。
- “我的”页的反馈与纠错入口已收口为“帮助与反馈”，并新增“我的反馈”本人记录页（已实现并提交 5834cbb）。
- 首页进行中行程内的已结束日期组已默认折叠，入口位于该趟内容顶部、今天/未来日期之前（已实现并提交 5834cbb）。
- 2026-10-15 工作区已实现（已提交 5834cbb、未真机验收）：**行程全部结束后首页摘要卡不退场**——之前只剩一条「过往行程 (N)」折叠条、一屏空白，现在摘要卡继续展示最近一段过往行程（`history[0]`），那行小字显示「已结束」（`util.tripCountdownTextOf` 的末档，此前没有任何界面露出）。
  - **纯小程序端改动，不需要部署云函数**：`home.bootstrap` 的 `primaryTripId` 语义（最近**未结束**行程，无则空串）与历史行程不下发 `items` 的契约都没动，退化只发生在页面渲染层（`buildHomeData` 里的 `summaryTrip = trips[0] || history[0]`）。
  - 摘要卡（`summaryTrip`）与新增提醒预填（`primaryTrip`）拆成两个字段：前者可以是已结束行程，后者只允许未结束行程——混用会把过去的时间范围预填进 PAGE-005（提交即 1016）。
  - 历史折叠区保持不变（仍列出全部历史行程），`HOME-RULE-008` + `产品文档.md` / `domain-rules.md` / `frontend-pitfalls.md` 已同步；回归见 `test/home-past-trip-card.test.js`。
- 代码质量包体积已收口：约 1.03MB 的景点图、二维码、提醒示例图与大背景已上传到 `cloud1-d9g9f4hja396d6e92/static/v0.3/images/`，代码包内只保留图标、默认头像与分享封面；当前 `miniprogram` 约 0.973MiB，本地图片/音频合计约 197.6KiB，距离微信 200KiB 硬线仅约 2.4KiB（2026-10-01 复核）。
- 2026-10-01 工作区已实现：景点详情「今日最早可约」规则行、景点 Tab 难度角标与直接「设提醒」、订阅模板双轨兼容（旧任务旧模板、新任务新模板）、提醒设置页新版机制说明；均已提交（5834cbb）、未部署、未真机完整验收。
- 2026-10-12 工作区已实现（已提交 5834cbb、未部署、未真机验收）：自有公众号「智序准点游」（用户确认名称）入口，只留入口不做强引流。
  - 单一出处：新增 `miniprogram/utils/official-account.js`，集中存放公众号名称、二维码云路径与全部文案，页面不写死公众号信息。
  - 共用组件：新增 `miniprogram/components/oa-follow-sheet/`，二维码 `show-menu-by-longpress` 可长按识别；云图缺失/加载失败时降级为「搜一搜公众号名」文案，不留白图框。
  - 挂载点一（PAGE-008 提交成功态）：原 Toast 改为轻量成功卡片，卡片内一行「关注「智序准点游」，看每日放票攻略」；默认 4 秒自动回首页，底部弱化倒计时「N 秒后自动返回首页」，卡片右上角关闭与点卡片外都是立即返回，展开二维码时取消自动返回与倒计时。
  - 挂载点二（PAGE-010「我的」）：入口独立一张卡放在整页最下面、与其他设置项隔开，右侧「攻略 · 小程序入口」。两处都只在用户点击时才打开弹层。
  - 回归：新增 `test/oa-follow-entry.test.js`（单一出处、弹层结构、只留入口、成功反馈只有一份、4 秒倒计时与主动关闭）。
  - 二维码源文件已放入 `cloud-assets/images/qrcodes/zhundianyou-oa.jpg`（430×430 JPEG，41KB，用户提供），配置指向 `/images/qrcodes/zhundianyou-oa.jpg`。
  - 该二维码已于 2026-10-12 通过 `scripts/upload-cloud-assets.sh`（用户在微信开发者工具确认）上传到 `static/v0.3/images/qrcodes/zhundianyou-oa.jpg`；已用 `cloud_manage_storage --action download` 回读校验，与本地源文件 sha256 一致（`e4f3184f…`），小程序端可直接取到云图。
- 2026-10-12 工作区已实现（已提交 5834cbb、未部署、未真机验收）：日期分段标题吸顶。
  - 预约时间线（`pages/add-trip`）：日期标题行在滚动当天内容时吸在「第二步」面板下方，偏移量 = 导航栏下沿 + `.timeline-panel` 实测高度（页面新增 `measureTimelineHeadTop()`，生成时间线与重算预览后各量一次）；量不到就不吸顶。
  - 首页行程墙（`components/trip-section`）：日期分段标题吸在导航栏下方，偏移量由首页下发 `day-sticky-top`（= `statusBarHeight + navBarHeight`），历史分段同样下发。
  - 两处都用 `position: sticky`（项目为 WebView 渲染），配不透明底；`trip-section` 的标题用 `::before` 补掉自己 32rpx 上外边距让出的那条透明带，z-index 取 35（卡片菜单图标 31 之下滑过、展开态 40 之上可点）。
  - 2026-10-12 同日按用户口径修的两处视觉：① 首页置顶条太矮（日期贴导航栏、下面滑上来的卡片切在字的下沿）——把上下呼吸位从 `margin` 挪进 `padding`（各 16rpx = 8px），总间距不变，`::before` 补位块高度同步改为 16rpx；② 时间线吸顶面板底部那条 1rpx 分隔线夹在两块同色白底之间，看着像镂空的缝——去掉 `border-bottom`（分隔交给底部阴影），并把吸顶偏移量从 `Math.round` 改为 `Math.floor`，避免向上取到半像素再留一条缝。
  - 回归：新增 `test/sticky-day-head.test.js`（偏移量来源、不透明底、z-index 区间、补位块高度 = 上外边距、日期锚点算法不变）；实现口径与坑已写入 `docs/engineering/frontend-pitfalls.md`。
- 2026-10-12 工作区已修复（已提交 5834cbb、未部署、未真机验收）：
  - 景点详情二维码弹层被裁切：`.qr-mask` 原本嵌在 `scroll-view` 内，真机上 `position:fixed` 包含块退化成滚动容器、再被 `.popup-sheet` 的 `overflow:hidden` 裁掉，折叠态只露上半截、识别不了。已把弹层移到 `.popup-mask` 直接子节点（与 `.popup-sheet` 同级），并补 `test/cart-popup.test.js` §9 回归断言。
  - 官网入口不再走 `web-view`：第三方域名进不了微信「业务域名」白名单，且 `wx.navigateTo` 本身会成功导致 fail 兜底永不触发，用户只看到白页。改为直接复制链接 + 指引到手机浏览器；`miniprogram/pages/webview/` 及其路由已删除。
  - 数据：`tiananmen-chenglou.officialWebUrl` 由 PC 站 `https://www.tiananmenchenglou.com` 改为**官方移动端 H5** `https://wap.tiananmenchenglou.com/h5/`——PC 站 CSS 是 `min-width:1200px` 的桌面布局（媒体查询只有 ≥768px 一档），复制到手机浏览器是「PC 版样式」，这正是原始反馈的第 2 个问题。H5 实测：200、标题「天安门城楼参观预约」、移动端 viewport 正确、根路径 302 到 `/h5/`（用带 `/h5/` 的 https 直连可避开那次 http 降级）；查 1.1MB 前端包确认**没有 `MicroMessenger` 之类的微信内限制**，自带 `/login` `/register` `/select-date` `/pay` 完整预约流程，普通手机浏览器可用。`scrapingUrl` 同步改为该 H5 地址（用户确认）。
  - 数据：`tiananmen-square.officialWebUrl` 由 `http://yuyue.tamgw.beijing.gov.cn` 改为 `https://yuyue2026.tamgw.beijing.gov.cn/web/index.html#/index`（依据 2026-08-24 交叉验证审计报告 + 实测 200，`#/index` 取自管委会门户自身的外链原文）。**云端数据库尚未重新 seed，线上 URL 未变。**
  - 数据：另有两条已失效官网按 `产品运营/北京景点预约通道总表` 的更正表回写（`officialWebUrl` 与 `scrapingUrl` 同步，四处镜像一致）：颐和园 `summerpalace-china.com → summerpalace.net.cn`、天坛公园 `tiantanpark.com → tiantanpark.cn`。两个新域名实测 200 且带 viewport。
    - 天安门广场**未**采用该表给的 `tamgw.beijing.gov.cn`：那是管委会门户首页，不是预约入口；门户自身把「预约参观服务平台」链到 `https://yuyue2026.tamgw.beijing.gov.cn/web/index.html#/index`，本仓库采用后者（含 `#/index`，与官方门户的链接逐字一致，避免 SPA 默认路由落空）。该表 README 已加注这条例外，避免将来「照表回改」。
    - 仍待真机复核：本机对部分官网域名有网络干扰（军博、首都博物馆、中国考古博物馆等直连失败但 DNS/TCP 通），不能据此判定失效。
- 2026-10-13 工作区已实现、`notifier` 与 `reminder` **已部署**（已提交 5834cbb、未真机验收）：腾讯云调用量优化。
  - **先记一条口径**：云开发套餐页的「调用次数」= **云函数调用次数 + 数据库调用次数合计**，不是单指云函数调用。依据：控制台 `云函数调用次数` 的静默基线是每分钟 1 次（只有 notifier 在跑），全天满打满算两三千次，远低于观测到的「半天 1.12 万」；而 `数据库调用次数` 静默基线每 5 分钟约 15 次，量级才对得上。**以后排查调用量要两条曲线分别看，别只看云函数那一条。** 另外「计算资源使用量」不随数据库调用增长，所以它也不能用来判断数据库开销。
  - `notifier`：原来每分钟串行跑三步、每步各一次数据库读。改为 ① `cleanup` 只在整点那一分钟跑（`CLEAN_AFTER_DAYS = 14`，晚一小时无影响；**不能降到每天**，单次 `.limit(500)` 会积压）；② `scanAndSend` 的「待发段」与 `sweepMissed` 的「过期段」合成一次查询、在内存里切分（`fetchWaitingUpTo` / `splitWaiting`）；③ `SCAN_MAX_ROWS` 800 → 1000，命中上限时打 `scan-truncated` 日志，不让「待发段被过期段挤掉」变成静默行为。空转分钟从 3 次读降到 1 次。**提醒频率与时效完全不变**（仍是每分钟、仍是 ±1 分钟窗口）。
    - 真机控制台实测（`notifier` 监控图表，切换发生在 2026-10-13 14:05 前后）：单次运行时间约 230ms → 约 60ms，资源使用量约 300K → 120K MBms，错误次数 0、外网出流量 0。
    - **明确不做**：不把 cron 改成每 2/5 分钟。`buildSubscribeData` 把 `${offset}分钟后放票` 写死在推送文案里，降频要么让提醒迟到、要么让文案说谎；而且做完上面两条之后，降频没有任何额外收益（1 分钟 × 1 次空转查询 = 2 分钟 × 2 次，前者零精度损失）。
  - `reminder`（`lib/trip.js`）：首页 bootstrap 已把该用户全部任务读回来，`trip.list` 不再对每趟行程各查一次 `nextReminderAt`，改为内存分组取最小值。⚠️ 设了一道守卫：预取任务数触及云函数端 `.get()` 的 100 条默认上限时**退回逐趟查询**，宁可多查几次，也不让排序键拿到一份被截断的数据。
  - 小程序端（**未真机验证**）：首页 `onShow` 加 30 秒复用窗口（只在「有本地缓存」且「用户只是切出去又切回来」时跳过网络；8 处写操作后的 `loadHome({silent:true})` 刷新永远走网络，它们是刷新后新状态的唯一来源）；`spots.list` 加 3 分钟内存缓存。
  - 刻意**没做** `profile` / `setup` / `notify-settings` 的 onShow 去重：那几页的刷新语义是「从内页返回看到最新订阅授权次数与清单」，加 TTL 会真让用户看到过期数据，而收益只有 1~2 次调用，不划算。
  - 回归：新增 `test/notifier-scan.test.js`（空转分钟 1 次读、整点必跑 cleanup、合并后 due 集合逐字段不变、扫描截断告警）与 `test/home-bootstrap-ttl.test.js`（复用早退必须嵌在「有缓存」分支内，否则页面会停在骨架层）；`test/trip-list-parallel.test.js` 补「预取路径零查询」与「触及上限退回」两条断言。


## 只读管理后台（2026-10-06 工作区实现；`admin` 云函数 2026-10-13 起已在云端运行）

- 新增 `admin-web/`：Vue 3 + Vite + TypeScript + Element Plus + ECharts，提供登录、概览、用户、任务、景点统计页面。
- 新增 `cloudfunctions/admin/`：独立管理员账号密码鉴权、只读查询、敏感字段查看审计、每日汇总和 180 天清理。
- 新增事件账本接入：`reminder` 写任务生命周期事件，`notifier` 写发送与终态事件；原始事件 180 天，永久保留 `reminder_daily_stats`。
- 新增测试：`test/admin-core.test.js`、`test/event-ledger.test.js`、`test/notifier-event-bridge.test.js`；Web 后台测试与构建使用 `npm run test:admin-web`。
- **2026-10-13 复核更新**：`admin` 云函数**已在云端运行** —— 控制台「配置信息」里能看到环境变量 `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD_HASH` / `ADMIN_BOOTSTRAP_PASSWORD_SALT` / `ADMIN_SESSION_SECRET`，日志里也有调用记录；它读取的集合（至少 `reminder_events`）已存在。上述「尚未部署」的旧描述已过期。
- ⚠️ **`admin` 没有定时触发器**：控制台「触发器配置 → 标准触发器」为空，与 `cloudfunctions/admin/config.json` 里那条每日 01:00 的 `adminDailyRollup` 不一致。**以控制台为准 —— 本地 `config.json` 的 triggers 段不等于云端存在该触发器，改本地文件也不会改线上频率。**
- ⚠️ **`admin` 白天的调用来自 `admin-web` 自己**，不是定时器，也不是小程序：全仓只有 `admin-web/src/api/client.ts` 会带 `action` 调 `admin`，日志里的返回体是 `admin.users.list` 的分页用户列表。**性质是内部工具流量，不是产品流量** —— 上线后不会随用户数增长，本地后台页面开着就会产生，关掉即止。排查调用量时把它和产品流量分开算。
- 第一版使用 CloudBase 默认域名，仅作为内部测试工具，不视为生产发布。

## 当前配置

- `USE_MOCK=false`，默认走腾讯云开发。
- 当前 cloudEnv：`cloud1-d9g9f4hja396d6e92`。
- 当前 appid：`wx05c160a589b97d76`。
- appid 与 cloudEnv 必须成对更换。

## 发布状态

- 代码：当前 `codex/ux1012` 分支，管理后台、事件账本和文档改动已提交（`5834cbb`）、尚未推送。V0.3 云端状态记录见 `docs/engineering/archive/launch-test-report-v0.3-20260928-review.md` §九。
- 构建：2026-10-13 当前工作区 `npm test`（34 套）、`npm run check`、`git diff --check` 通过；2026-10-06 的 `npm run test:admin-web` 与 Web 后台生产构建同样通过。
- 云函数：`reminder` 曾于 2026-09-28 部署并通过只读 `home.bootstrap` 冒烟；**2026-10-13 已由用户当场授权重新部署 `reminder` 与 `notifier`**（含当日调用量优化，见「已实现」段的 2026-10-13 条目）。`spots`、`feedback` 的当前工作区改动**仍未部署**。
- 小程序：未发布；新订阅模板真机已出现 `20001 No template data return`，当前正在按精确模板 ID 和控制台日志复核；`cart.commit` 写路径、完整真机交互和多机型视觉仍未 live verified。
- 因此不得把“测试通过”“部分云函数已部署”写成“整体已上线”或“用户已看到新版本”。

## 当前需要部署的范围

> **2026-10-13 更新**：`notifier`、`reminder` 已部署（含当日调用量优化），`admin` 也已在云端运行。**仍未部署**的是：`spots`、`feedback` 的工作区改动；`admin-web` 未上传静态托管；小程序端未发布。下面各条保留原始口径，已部署的不必再做。

- `admin`：**已在云端运行**（2026-10-13 复核，见「只读管理后台」段）；依赖 `admins`、`reminder_events`、`reminder_daily_stats`、`admin_audit_logs` 四个集合及索引，目前**未配置定时触发器**。
- `reminder`：新增任务创建、重建、取消和读取时 MISSED 的事件写入；必须在集合与索引完成后部署。**✅ 2026-10-13 已部署。**
- `notifier`：新增发送成功、失败、跳过、任务已处理和未送达事件；不得在事件集合缺失时部署。**✅ 2026-10-13 已部署。**
- `admin-web`：Web 后台生产构建已完成，尚未上传 CloudBase 静态托管。
- `reminder`：**2026-09-30 首页冷启动优化有多处改动，必须重新部署**（`index.js` 的
  `homeBootstrap` 并行化 + `includeSpots` 默认值翻转、`lib/trip.js` 的 `list`/`removeIfEmpty`
  并行化、`lib/task.js` 的 `sweepOverdue` 并发写）。另有已提交、未部署的额度预警文案改动。
  ⚠️ **`includeSpots` 默认值由 `true` 改为 `false` 是契约变更**（`API-契约.md` 8.2）：
  未部署时前端拿不到 `hotSpots`，但前端已有本地切片兜底，不会白屏。**✅ 2026-10-13 已重新部署（并叠加当日调用量优化）。**
- `spots`：当前已提交但未部署的景点卡新增 `shortName` 透传需要部署；首页空态示例有全名回退，但未部署时拿不到简称。
- `feedback`：当前已提交但未部署的管理员 openid 白名单与 `feedback.adminStatus` 入口校验需要部署；帮助与反馈、我的反馈页面依赖现有 `feedback.list` 契约。
- `notifier`：已兼容旧任务走旧「活动开始通知」、新任务走新「预约开始提醒」；按任务实际模板发送和核销额度。应先部署，使旧任务和随后产生的新模板任务都有正确分流；当前已确认 `status_release_idx = backendStatus + releaseAt` 已存在，但云端触发器、测试发送和真机模板授权仍未完成闭环核对。**✅ 2026-10-13 已部署；`notifier` 的每分钟触发器经日志确认在跑（`admin` 则确认没有触发器，两者处理方式不同，见「只读管理后台」段）。真机模板授权仍未闭环。**
- `reminder`：新提醒任务会写入当前模板 `_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA`；`lib/quota.js` 已兼容旧任务按旧模板记账。应在 notifier 之后部署，最后再发布小程序端。**✅ 2026-10-13 已部署；小程序端仍未发布。**
- 小程序端：提交后重新编译；仅部署云函数不能替代小程序端发布。

## 数据库索引（2026-10-13：三条「必须」索引已建）

2026-09-30 记的三条「必须」索引，用户已于 **2026-10-13 在控制台建好**：

- `reminder_tasks` 单字段 `userId` —— `home.bootstrap` 每次按 `userId` 全量取任务。
- `reminder_tasks` 的 `userId + tripId + backendStatus + releaseAt` —— `trip.list` 每趟取最近一个 WAITING 任务算 `nextReminderAt`。**本条此前已存在**（控制台提示不能重复添加）；2026-10-13 起该查询只在「预取触及 100 条上限」或独立调 `trip.list` action 时才跑，但索引仍必须保留。
- `reminder_cart` 单字段 `userId` —— bootstrap 为 `trip.list` 的 `removeIfEmpty` 预取全量清单（一次读换掉原本每趟行程 3 次 count）。

`reminder_tasks.status_release_idx`（`backendStatus + releaseAt`）已于 2026-10-01 确认存在。

⚠️ **复核方式**：把 `cloudfunctions/**` 里所有 `.where({...})` 组合列出来，与 `数据库索引.md` 第二节逐条对照，**而不是只信文档自己的描述** —— 上面那两条「建议」项的描述就是这么过期的。完整清单（含 `trip_items`、`trips`、`orders` 等）见 `数据库索引.md` 第二节；管理后台新增集合与索引见同文第四节。

## 待验证

- V0.3 主流程真机交互。
- 帮助与反馈、我的反馈页面的真机跳转、空态、失败重试与在线客服。
- 首页已过去日期折叠的展开/收起、滚动位置与不同机型视觉。
- 提醒授权补齐、系统通知授权和「补授权次数+1」（每次点击最多 +1）。
- 新模板 `_BUe5xII9f16kHmuYjz2esWY8MjdL7Qrp30pqmuKFmA` 的真机授权、旧模板任务分流和新模板任务分流。
- 新用户首页空态的视觉间距和不同机型适配。
- 分享、深链与场景页的真实微信环境行为。
- 微信隐私授权弹窗、拒绝路径、`wx.openPrivacyContract` 与协议页面真机验证。
- 首页 onShow 复用窗口的真实行为（2026-10-13 新增，纯前端、无云函数依赖）：切 tab 出去再回首页应命中缓存、不发请求；改一条提醒后必须发请求并刷新。结构断言已由 `test/home-bootstrap-ttl.test.js` 钉住，但它测不了真机生命周期。

## 权威文档

- 产品状态与行为：`产品文档.md`
- API 契约：`API-契约.md`
- 数据库索引：`数据库索引.md`
- 视觉规范：`figma_design.md`
- 提醒故障处理：`docs/engineering/reminder-troubleshooting.md`
- 工程迁移索引：`docs/engineering/rule-index.md`
- 上线前结论（归档）：`docs/engineering/archive/launch-test-report-v0.3-20260928-review.md`
