# Travel-app
景点预约提醒小程序：聚合北京热门景点的放票规则，在放票前提醒用户手动去官方渠道抢票。不代抢代约。

## 当前状态（2026-08-11 已按新形态重建页面 + 景点库扩容分层）

**代码已是新形态**（行程 → 时间线 → 提醒清单 → 提醒任务，PAGE-001~011）。

**景点库分层（2026-08 定稿）**：26 个景点 = 需预约 20（11 S + 9 A）+ 免预约 6（B）（2026-08-14 按官方核实更新：首博免预约、八达岭/恭王府需预约）。**不新增 tier 字段**，用 `reservationRequired` 布尔表达「是否需预约」（行为开关：false = 免预约，不进时间线/清单/任务，卡片选择按钮位置显示「无需预约」tag、标签行显示「随到随买，当前{旺季/淡季}门票…」= `cardDesc`，云函数/mock 按 GMT+8 季节计算）；S = 需预约且 difficultyScore≥4（首页 PAGE-001 热门网格只放 S 级），A = 需预约且 ≤3（PAGE-003 热门推荐 S+A 混搭、每批 6S+4A、默认 10 个可换一批）。详情见 `产品分析/2026-08-景点库扩容调研与分层方案.md`。

- 权威需求 = `产品文档.md`（V1.0 基线，编号化条目，444 行）。视觉规范 = `figma_design.md`（第 4 节视觉基准宽度 402px，第 5 节 V1 用「页面内自绘导航」）。
- 页面：`home`（行程创建 + 任务列表双形态）/ `spots`（景点选择）/ `timeline`（时间线）/ `setup`（提醒设置）/ `profile`（我的）/ `webview`（官方渠道外链兜底）/ `notify-settings`（通知设置=订阅消息前置授权）/ `feedback`（意见反馈：建议/Bug）/ `spot-correction`（信息纠错：选景点+纠错类型）。原生 `tabBar` 已移除，用 `components/tabbar` 自绘导航。
- 数据层：`utils/mock.js`（内存 mock 后端）+ `utils/api.js`（云函数调用封装，按 `USE_MOCK` 自动切换）。**2026-08-19 起已联调真实环境：`USE_MOCK=false`，cloudEnv=cloud1-d5givb65417e3b8c9（填在 `app.js`，2026-08-19 换 AppID 后重建）。回退 mock 开发时改回 true。**
- **前端接口契约**：`API-契约.md`（从云函数源码提取，覆盖 spots / reminder(trip/timeline/cart/task/user) / feedback(意见反馈/信息纠错) / ics-generator / notifier 的 action、入参、出参、错误码）。页面开发前必须对照此文档，不要凭空猜接口。

## 技术栈
- 前端：微信原生 + Vant Weapp 1.11（页面 `usingComponents` 里按需注册，如 `van-icon` / `van-loading`）+ 自绘组件（`components/` 下 tabbar / spot-popup / cart-popup / date-range-picker / svg-icon）
- 后端：腾讯云开发，云函数 6 个：`reminder`（trip/timeline/cart/task/user 全模块，1447 行，核心逻辑）、`spots`（查询+放票状态实时计算）、`feedback`（意见反馈/信息纠错，集合 `feedbacks`）、`scraper`（抓取，规则推算）、`notifier`（推送）、`ics-generator`（.ics 生成）
- 抓取：Playwright + stealth，方案见 `data/scraping-plan.md`，未部署
- 运行时：主流程默认走 mock（`USE_MOCK=true`），真机预览需真实 appid（project.config.json 已填）

## 目录与约定
```
miniprogram/pages/    新形态页面：home / spots / timeline / setup / profile / notify-settings / feedback / spot-correction
miniprogram/components/ 自绘组件：tabbar / spot-popup / cart-popup / date-range-picker / svg-icon
miniprogram/images/spots/  26 张景点图（文件名 = spotId，与 mock.js 的 SPOTS 对齐；新 16 张为 Wikimedia Commons 真实照片）。**图片格式必须是 jpg/png**：微信 `<image>` 不渲染本地 webp（webp 属性只支持网络资源），2026-08-18 已由 webp 全量转回 jpg/png（500px q75，包体 ~1.16MB）
miniprogram/images/icons/  37 个 SVG 图标（预填色对齐设计 token；红底白字场景用 `*-white` 变体）
miniprogram/utils/    api.js（云函数封装）/ mock.js（内存 mock 后端）/ util.js（日期等工具）
cloudfunctions/      云函数，一函数一目录：reminder / spots / feedback / scraper / notifier / ics-generator
data/spots.json      26 个北京景点（需预约 20 + 免预约 6），difficultyScore 取值 {1,2,3,4,5}，含 reservationRequired/aliases
data/rules.json      对应放票规则，含 closedDays/releaseFrequency
cloudfunctions/reminder/data/  spots.json/rules.json 部署副本（云函数独立打包，改 data/ 时需同步这份）
UI-V1.0/             页面导出图 01~11.png（对应 PAGE-001~011，缺 06）
产品分析/ 竞品资料/    调研素材，非开发依据
```
- 字段命名 camelCase。全系统时间按北京时间 GMT+8（`产品文档.md` TIME-RULE-001）。
- **选中态约定**（重要）：WXML 数据绑定不支持 `indexOf` 等数组方法调用（静默失效 → 点了不变）。选中态需在 JS 侧算成 `selected` 布尔字段（用 `util.markSpotsSelected(list, ids)`），WXML 只绑 `{{item.selected}}`。同理，setData 必须传**新数组/新对象引用**，不能原地 `push`/`splice` 后传回原引用。
- **通知设置 = 订阅消息前置授权（2026-08-14）**：两个前置项 = ①微信系统通知权限（`wx.getAppAuthorizeSetting`）②小程序订阅消息授权（`wx.getSetting` 的 `scope.subscribeMessage`）。个人中心「通知设置」行右侧三态文案：全没设「未开启」/ 设了一个「部分开启」/ 全设「已开启」，检测逻辑共用 `miniprogram/utils/notify.js`。内页 `pages/notify-settings` 上下排列两项授权；**设置提醒页（PAGE-008）提交时前置未做齐 → 当前页弹窗就地引导授权并继续提交，不跳个人中心**。微信订阅消息是「一次性订阅」（每次授权=可发 1 条），模板 ID（2026-08-19 已回填，「活动开始通知」公共模板，编号 515，**字段 = 活动名称 `thing4` / 活动时间 `date5`（date 类型，例 `2026-08-21 18:30`）/ 温馨提示 `thing7`**，2026-08-21 对照公众平台修正）写在 `notify.js` 的 `SUBSCRIBE_TEMPLATE_ID` 与 notifier 的兜底常量（环境变量 `SUBSCRIBE_TEMPLATE_ID` 优先），两处必须一致；未配置时「去授权」按钮置灰「通道准备中」。短信提醒下个迭代上线，页面仅占位说明。
- **订阅消息发送链路（2026-08-21 修复）**：云调用 `cloud.openapi.subscribeMessage.send` 在**定时触发**下会报 `-501001 invalid wx openapi access_token`（云调用必须由小程序端触发）。已改为**微信服务端 HTTP 接口** `POST /cgi-bin/message/subscribe/send`（自带 access_token 缓存与 40001/42001 重试），不再依赖小程序端触发。所需配置为 notifier 云函数环境变量 `WX_APPID`（缺省 `wxfee99eee9c95bd15`）/ `WX_APPSECRET` / `SUBSCRIBE_TEMPLATE_ID`；`config.json` 已移除 `permissions.openapi`。新增 `notifier.testSend` / `notifier.whoami` action 用于验证通道。
- **一次性订阅额度（2026-08-21）**：`wx.requestSubscribeMessage` 授权一次=可发 1 条。已在 `reminder` 新增 `subscribe.add`（授权后 +1）/ `subscribe.get`（查剩余），额度存 `users.subscribeQuota`；`notifier` 发送成功后 -1（`consumeSubscribeQuota`），未落库/旧记录不拦截（微信侧仍按真实授权校验，`43101` 表示无额度/未订阅）。前端 `utils/notify.js` 在授权成功时自动 `subscribe.add`，通知设置页展示剩余次数。`requestSubscribe` / `subscribe.add` 均需在云开发控制台创建的 `users` 集合可写（已存在）。
- **意见反馈 / 信息纠错（2026-08-14）**：走 `feedback` 云函数 + `feedbacks` 集合（TABLE-008，type=feedback|correction）。意见反馈只保留 建议(suggestion)/Bug(bug) 两类；信息纠错 = 选景点（`spots.search`）+ 纠错类型（RELEASE_TIME/RELEASE_RULE/OPEN_TIME/TICKET_PRICE/ADDRESS/CLOSED_DAYS/OTHER）+ 描述。提交后 Toast「感谢反馈，我们会尽快核实」。错误码 1020=内容为空。V1 不做截图上传与积分奖励。**反馈管理页（2026-08-19）**：隐藏页 `pages/admin-feedback`（我的页长按用户信息卡进入），调 `feedback.adminList`/`feedback.adminUpdateStatus`（管理员改 OPEN/PROCESSED/IGNORED），管理员白名单在 `cloudfunctions/feedback/lib/schema.js` 的 `ADMIN_OPENIDS`（openid 从控制台 feedbacks 记录 userId 取，改后需重新部署）。
- 难度标签只有一处真身：`spots` 云函数的 `computeDifficultyLabel`（≥4 极难约 / =3 较难约 / ≤2 容易约，同 TAG-RULE-001），mock 里也有同逻辑。页面直接渲染 `difficultyLabel` 即可，不要自己再算。
- **时间线刷新**：加提醒/清单变化后刷新时间线必须用 `loadInlineTimeline(tripId, keepTab, true)` 静默模式——不要置 `timelineLoading`，否则列表高度塌缩会让 scroll-view 跳回顶部（2026-08-10 修复）。
- **图标系统**：`components/svg-icon`（属性 `name`/`size`/`rotate`）渲染 `images/icons/*.svg`，SVG 预填色、不可用 `color` 改色。4 主页面 + tabbar 已从 `van-icon` 迁出；购物车/警告/喇叭/批量/更多景点+/新增提醒加号等缺 SVG，仍临时用 `van-icon`，待补资源。
- **预约入口（PAGE-002 弹窗，SORT-RULE-001）**：官方小程序 `wx.navigateToMiniProgram` 直跳，失败兜底复制 `officialWebUrl`；官网用 `web-view` 打开（**真机需在微信后台配「业务域名」否则打不开**），弹窗内提供「复制链接」兜底；公众号点「查看二维码」弹二维码弹层（`show-menu-by-longpress` 长按识别；个别安卓机型/微信版本不出识别菜单属微信兼容问题）。数据在 `data/spots.json` 的 `officialAccount`/`qrCode` 字段。现状（2026-08-11）：公众号名 26/26、官网 24/26、officialAppid 22/26（**4 个无小程序**：天安门城楼/工艺美术馆/孔庙国子监/天文馆，走公众号+官网兜底）；qrCode 5/26（故宫为占位图，工艺美术馆/国博/美术馆/天文馆为官网获取的真实码），其余需各公众号后台导出（无码时点「查看二维码」降级 Toast 提示公众号名）。
- 视觉基准宽度 402px（`figma_design.md` 第 4 节，左右内边距 16px，主内容宽 370px），非 750rpx；换算到 rpx 时以 402px 为 100% 宽计算。
- `project.config.json` 已填真实 appid。当前 `USE_MOCK=false` 走真实云函数，依赖云开发环境就绪（集合 + 云函数部署 + seed）。

## 指令集
- 安装依赖：`cd Travel-app && npm install`
- 构建 npm：微信开发者工具 →「工具」→「构建 npm」（Vant 必需）
- 云函数部署：右键 `cloudfunctions/<name>` →「创建并部署：云端安装依赖」
- 运行：微信开发者工具打开 `Travel-app/` 目录
- 测试：`test/` 下 `flow.test.js`（FLOW-001 全链路）/ `timeline.test.js`（时间线交叉积），用 `test/mock-db.js` 内存云数据库桩跑 `cloudfunctions/reminder/lib/*`；运行 `npm test`（= `node test/flow.test.js && node test/timeline.test.js`）

## 部署
微信小程序 + 腾讯云云开发。云环境 id `cloud1-d5givb65417e3b8c9` 写在 `miniprogram/app.js` 的 `cloudEnv`（2026-08-19 换 AppID 后重建；`project.config.json` 已换新 appid `wxfee99eee9c95bd15`）。尚未真机验证。
