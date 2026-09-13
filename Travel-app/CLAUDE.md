# Travel-app
景点预约提醒小程序：聚合北京热门景点的放票规则，在放票前提醒用户手动去官方渠道抢票。不代抢代约。

## 当前状态（2026-09-13 已同步：订阅消息按模板台账/43101 自愈 + notifier 60 秒；spot-hub 请求与渲染异常分离、北京时间统一；此前 2026-09-03 数据准确性、2026-08-31 首页聚合/行程修复均保留）

**代码已是新形态**（行程 → 时间线 → 提醒清单 → 提醒任务，PAGE-001~011）。

**数据准确性（2026-09-03 定稿，把「准确性」从运营表做成用户可见功能）**：
- **闭馆数据校正**：`data/rules.json`（与部署副本/seed/mock 四份一致）——**清华 `closedDays` → `["monday"]`，唯一限制就是周一闭馆，工作日可约**（2026-09-11 用户核实；`openDays` 已回滚，见下）；北大 `openDays` → `["saturday","sunday"]`（平时工作日不可约、仅周末及法定节假日；用白名单而非 `closedDays:["monday"]`，因为周一至周五都不可约，黑名单表达不了）；人民大会堂 `closedDays` → `["monday"]`（2026-09-11 用户核实）；首都博物馆 `closedDays` → `["monday"]`（2026-09-11 核实，原为 `tuesday`）；天坛/北海 → `[]` + `closedDaysNote`（公园本体周一正常开放，闭的是祈年殿/琼华岛等园中园）。
- **⚠️ 别把「提前量不同」读成「不可约」**：清华双轨制文案「即时预约工作日最多提前 1 天 / 周末及节假日最多提前 7 天」，说的是**提前天数**差异，**不是**工作日不能约。曾据此错误推断清华也有周末白名单并写进数据，已回滚（2026-09-11）。**清华只有一个限制：周一闭馆。**
- **`openDays` 白名单机制（2026-09-11 新增）**：`rules.json` 可选字段，语义 = **非空则接管 `closedDays`、不叠加**（叠加会得出空集）。稀疏字段，**当前仅北大**在用。判定收敛到单一入口 `cloudfunctions/reminder/lib/time.js` 的 `isOpenOn(rule, dayName)`，禁止在业务代码里自行 `includes`；`cloudfunctions/spots/index.js` 与 `miniprogram/utils/mock.js` 各有一份镜像（前端 mini program 无法 require 云函数）。消费方 5 处：`timeline.js` 的 `buildEvents` 与 `closedDaySkips`、`spots/index.js` 的 `computeReleaseStatus`/`computeEarliestDate`、`spot-hub.js` 的今日放票判定（星期、日期、已放票时刻统一用同一个北京时间视图，禁止混用设备本地时间）。文案侧：白名单景点被跳过的日子说「不可约」而非「闭馆」；`openDaysLabel(rule)` 四态 —— openDays 白名单 →「仅周六、周日开放」／closedDays 黑名单 →「周一闭馆」／`closedDaysNote` → 园中园型说明／否则「全年开放」（**不能**对白名单落回「全年开放」，那正好说反）。⚠️ 寒暑假北大改为每天开放，任何写死的规则表都会偏保守，靠 `bookingTips` 文案兜底。
- **`closedDaysNote`（2026-09-11）**：纯**展示**字段，表达「园中园周一闭馆、公园本体全开」（天坛祈年殿、北海琼华岛）。**不要**因此把 `closedDays` 改成 `["monday"]` —— 那会让 App 对公园本体报「周一闭馆」而它其实开着，属假提醒（与人民大会堂那类错误同性质）。该字段**不参与** `isOpenOn` 判定，只影响标签文案。
- **公告自动过期 `specialNoticeUntil`（2026-09-11 新增，规则）**：`specialNotice` 必须配 `specialNoticeUntil`（YYYY-MM-DD），过期后**自动**不再下发（`time.activeNoticeOf`，含当天有效；`spots/index.js` 与 `mock.js` 各镜像一份）。缺省 = 无到期日（向后兼容）。**起因**：毛主席纪念堂的闭馆公告有效期只写在自由文本里，8/31 到期却在 App 上继续顶红条显示「暂停对外开放」11 天。纪念堂 **2026-09-01 已正式恢复开放**，公告已下掉，`lastCheckedDate` 已更新。新增任何公告都要填这个字段。
- **核验溯源**：`miniprogram/utils/verify.js`（新）`verifiedLabel()` 从 `lastCheckedDate` 派生「数据已核验·更新于X月X日」/「尚未复核，以官方为准」。未核验景点**自动**按 `lastCheckedDate` 为空判定（当前 0 个），不硬编码清单。
- **规则详情可信区块**：景点 Tab 卡片与今日放票 Banner 进入 `spot-rule` 完整规则页（核验状态 +「来源：官方渠道」+「我要纠错」预选景点 + 设置提醒）；`spot-popup` 继续服务首页/时间线的快捷浮窗，并展示「数据」核验行。两套入口职责分离：完整决策走 `spot-rule`，轻量查看走 `spot-popup`。
- **闭馆日贯穿提醒流程**：`timeline.generate` 新增返回 `closedDaySkips`（非全闭馆景点在行程内被闭馆跳过的日期，含 note「X月X日 周一 闭馆，已为你跳过」），`home.js` 合并进现有 `timelineClosedSpots`；mock 的 `generateTimeline` 同步镜像。
- **集合权限澄清（重要）**：微信云开发里**云函数读集合不受集合权限限制**（走服务端管理员凭据），集合权限只管小程序端直接读写。所以「景点 Tab 加载失败」**不是**集合权限问题。
- **`spot-hub` 加载误报修复（2026-09-13）**：`spots.list` 成功后只更新数据，再用 `setData` callback 单独执行 Banner/列表渲染；渲染异常只写 `console.error`，不会再被请求 catch 误写成 `loadFailed=true`。仍需真机/模拟器复测成功页，但结构上已区分“云端请求失败”和“拿到数据后的展示异常”。`spots`/`reminder` 云端已部署 + seed 后确认 `tsinghua closedDays=["monday"]`、`lastCheckedDate="2026-09-11"`。

**景点库分层（2026-08 定稿，2026-08-26 按 data/spots.json + data/rules.json 复核；2026-08-31 难度 V1→V2 收敛，S 级 6→3，见 `产品分析/2026-08-景点难度-版本记录.md`）**：26 个景点 = 需预约 19（3 S + 16 A）+ 免预约 7（B）（2026-08-14 按官方核实更新：首博免预约、八达岭/恭王府需预约；2026-08-26 复核：恭王府 difficultyScore=3→V2 降为 2，首博与孔庙国子监免预约且 difficultyScore=2）。**不新增 tier 字段**，用 `reservationRequired` 布尔表达「是否需预约」（行为开关：false = 免预约，不进时间线/清单/任务，卡片选择按钮位置显示「无需预约」tag、标签行显示「随到随买，当前{旺季/淡季}门票…」= `cardDesc`，云函数/mock 按 GMT+8 季节计算）；S = 需预约且 difficultyScore≥4（3 个，首页 PAGE-001 热门网格只放 S 级），A = 需预约且 ≤3（16 个，PAGE-003 热门推荐 S+A 混搭、S 优先全部展示、不足用 A 补足凑满 10 个可换一批，见 spots.js mixBatch）。**可提醒 = 需预约且有放票时刻**（18 个，`buildCard` 派生 `remindable`）；需预约但无放票时刻（仅环球影城 huanqiu-yingcheng）不可选，卡片按钮位显示「随买随用」tag，不进时间线/清单/任务；弱提醒 = 需预约且 difficultyScore≤2 且可提醒（13 个：八达岭/恭王府/天安门广场/毛主席纪念堂/人民大会堂/军事博物馆/自然博物馆/考古博物馆/科技馆/美术馆/工艺美术馆/慕田峪/天文馆，`weak` 字段），标签行显示「提前N天 HH:MM放票 · 票量充足，无需卡点」。B 层 difficultyScore 不统一（首博、孔庙国子监为 2，其余为 1），UI 不渲染难度标签。详情见 `产品分析/2026-08-景点库扩容调研与分层方案.md`。

- 权威需求 = `产品文档.md`（V1.0 基线，编号化条目）。视觉规范 = `figma_design.md`（第 4 节视觉基准宽度 402px，第 5 节 V1 用「页面内自绘导航」）。
- 页面：`home`（创建表单 + 任务列表双 Tab：有任务时导航栏显示「提醒任务 / 添加提醒」，无任务为创建表单）/ `spots`（景点选择）/ `timeline`（时间线，已并入首页内联展示，仅 app.json 注册、无跳转入口，待确认是否删除）/ `setup`（提醒设置）/ `profile`（我的）/ `profile-edit`（编辑资料：头像/昵称/手机号）/ `webview`（官方渠道外链兜底）/ `notify-settings`（通知设置=订阅消息前置授权）/ `feedback`（意见反馈：建议/Bug）/ `spot-correction`（信息纠错：选景点+纠错类型）。原生 `tabBar` 已移除，用 `components/tabbar` 自绘导航。
- 数据层：`utils/mock.js`（内存 mock 后端）+ `utils/api.js`（云函数调用封装，按 `USE_MOCK` 自动切换）。**2026-08-19 起已联调真实环境：`USE_MOCK=false`，cloudEnv=cloud1-d5givb65417e3b8c9（填在 `app.js`，2026-08-19 换 AppID 后重建）。回退 mock 开发时改回 true。**
- **首页 Plan A 双 Tab（2026-08-26）**：有任务时（homeMode=2）顶部导航栏显示「提醒任务 / 添加提醒」下划线 Tab，默认落「提醒任务」；「添加提醒」Tab 内联展示创建表单 + 时间线（不跳 PAGE-005/006）；任务页悬浮「添加提醒」按钮只切 Tab 不跳页；设置提醒提交成功后返回自动切回「提醒任务」。
- **首页加载与行程规则（2026-08-31）**：首页数据走 `reminder.home.bootstrap` 聚合（一次返回任务/行程/清单/热门景点；云端未部署或失败时前端回退 `task.list` 旧链路，防形态2消失）；`trip.create` **取消自动合并**（严格按本次输入的日期/景点，旧云端仍合并时前端 `createTripStrict` 兜底改回）；内联时间线的孤儿行程被 `trip.list` 清理后，前端 `ensureInlineTrip` 用当前表单自愈重建（防「添加提醒进已删除行程、购物车清零」）。mock.js 亦含 `home.bootstrap` handler（与云端对齐）。
- **前端接口契约**：`API-契约.md`（从云函数源码提取，覆盖 spots / reminder(trip/timeline/cart/task/user) / feedback(意见反馈/信息纠错) / ics-generator / notifier 的 action、入参、出参、错误码）。页面开发前必须对照此文档，不要凭空猜接口。

## 技术栈
- 前端：微信原生 + Vant Weapp 1.11（页面 `usingComponents` 里按需注册，如 `van-icon` / `van-loading`）+ 自绘组件（`components/` 下 tabbar / spot-popup / cart-popup / date-range-picker / svg-icon）
- 后端：腾讯云开发，云函数 6 个：`reminder`（trip/timeline/cart/task/user 全模块，核心逻辑；2026-08-31 新增 `home.bootstrap` 聚合、`trip.create` 取消自动合并、行程按 startDate 排序）、`spots`（查询+放票状态实时计算）、`feedback`（意见反馈/信息纠错，集合 `feedbacks`）、`scraper`（抓取，规则推算）、`notifier`（推送）、`ics-generator`（.ics 生成；2026-08-14 起日历通道下线，云函数保留但前端无调用）
- 抓取：Playwright + stealth，方案见 `data/scraping-plan.md`，未部署
- 运行时：当前 `USE_MOCK=false` 走真实云函数（见上方「数据层」）；回退 mock 开发时改回 true

## 目录与约定
```
miniprogram/pages/    页面：home / spots / timeline（遗留） / setup / profile / profile-edit / notify-settings / feedback / spot-correction / admin-feedback
miniprogram/components/ 自绘组件：tabbar / spot-popup / cart-popup / date-range-picker / svg-icon
miniprogram/images/spots/  26 张景点图（文件名 = spotId，与 mock.js 的 SPOTS 对齐；新 16 张为 Wikimedia Commons 真实照片）。**图片格式必须是 jpg/png**：微信 `<image>` 不渲染本地 webp（webp 属性只支持网络资源），2026-08-18 已由 webp 全量转回 jpg/png（500px q75，包体 ~1.16MB）
miniprogram/images/avatars/ 6 张无感登录默认头像 default-{1..6}.png（Python 生成的暖色底+白色剪影占位图）
miniprogram/images/icons/  56 个 SVG 图标（预填色对齐设计 token；红底白字场景用 `*-white` 变体）
miniprogram/utils/    api.js（云函数封装）/ mock.js（内存 mock 后端）/ util.js（日期等工具）
cloudfunctions/      云函数，一函数一目录：reminder / spots / feedback / scraper / notifier / ics-generator
data/spots.json      26 个北京景点（需预约 19 + 免预约 7），difficultyScore 取值 {1,2,3,4,5}，含 reservationRequired/aliases
data/rules.json      对应放票规则，含 closedDays/openDays/closedDaysNote/specialNotice(+Until)/releaseFrequency
cloudfunctions/reminder/data/  spots.json/rules.json 部署副本（云函数独立打包，改 data/ 时需同步这份）
scripts/export-spots-table.py  从 data/spots.json + data/rules.json 导出 `产品运营/0911全量景点信息表.md`（可约日/难度/放票/核验日期）。改数据后重跑，勿手改表
UI-V1.0/             页面导出图 01~11.png（对应 PAGE-001~011，缺 06）
产品分析/ 竞品资料/    调研素材，非开发依据
```
- 字段命名 camelCase。全系统时间按北京时间 GMT+8（`产品文档.md` TIME-RULE-001）。
- **⚠️ 景点规则的改动必须先经用户确认（2026-09-11 定规）**：放票时刻、提前天数、闭馆日、可约窗口、票务、核验日期等**任何规则值**，都不允许依据资料置信度自行判定填写。发现数据疑似有误 → **报告差异 + 给建议 + 说明需要确认什么**，然后停下来等回复；不要先改后问，也不要因证据「置信度高」就替用户拍板。用户说「已核验」≠ 授权推断具体值，缺的值要问、不要猜。反例：曾据一份标 VERIFIED/置信度「中高」的交叉验证报告自行断定毛主席纪念堂存在「当日可约」政策，该政策**从未存在**；且那次核验本身是在该馆闭馆维修期间做的，封闭期规则未必等同恢复后规则。**保守优于猜测**：宁可保留旧口径并标注待核，也不要基于不完整证据改成「看起来更合理」的新值。
- **选中态约定**（重要）：WXML 数据绑定不支持 `indexOf` 等数组方法调用（静默失效 → 点了不变）。选中态需在 JS 侧算成 `selected` 布尔字段（用 `util.markSpotsSelected(list, ids)`），WXML 只绑 `{{item.selected}}`。同理，setData 必须传**新数组/新对象引用**，不能原地 `push`/`splice` 后传回原引用。
- **通知设置 = 订阅消息前置授权（2026-08-14）**：两个前置项 = ①微信系统通知权限（`wx.getAppAuthorizeSetting`）②小程序订阅消息授权（`wx.getSetting` 的 `scope.subscribeMessage`）。个人中心「通知设置」行右侧三态文案：全没设「未开启」/ 设了一个「部分开启」/ 全设「已开启」，检测逻辑共用 `miniprogram/utils/notify.js`。内页 `pages/notify-settings` 上下排列两项授权；**设置提醒页（PAGE-008）提交时前置未做齐 → 当前页弹窗就地引导授权并继续提交，不跳个人中心**。微信订阅消息是「一次性订阅」（每次授权=可发 1 条），模板注册表在 `miniprogram/utils/notify.js` 的 `SUBSCRIBE_TEMPLATES`（当前只有「放票提醒」一个，「活动开始通知」公共模板，编号 515，**字段 = 活动名称 `thing4` / 活动时间 `date5` / 温馨提示 `thing7`**）；notifier 兜底常量与 `SUBSCRIBE_TEMPLATE_ID` 环境变量保持一致。短信提醒下个迭代上线，页面仅占位说明。
- **订阅消息台账（2026-09-11 按模板记账 + 自愈）**：`users.subscribeQuotas[templateId]` 是唯一按模板计数的本地台账，`users.subscribeQuota` 仅作旧数据/页面的总数兼容；它不是微信真实余额。`reminder.subscribe.add/get` 按 `templateId` 增查；`notifier` 发送成功只扣对应模板，微信返回 `43101`（未订阅/已拒收/次数耗尽）时对应模板清零并记录 `subscribeLastError/At`。2026-09-11 排查确认：9/5 前成功发送 22 条，9/7 起持续 `43101`，本地却仍显示 19 次，导致不再触发授权、任务最终 MISSED。
- **订阅消息发送链路（2026-08-21 修复，2026-09-11 运行时复核）**：定时触发不能依赖 `cloud.openapi`，改走微信服务端 HTTP `POST /cgi-bin/message/subscribe/send`（access_token 缓存 + 40001/42001 重试）。环境变量为 `WX_APPID` / `WX_APPSECRET` / `SUBSCRIBE_TEMPLATE_ID`；`notifier` 线上超时必须保持 **60 秒**，不能是默认 3 秒（现已通过云开发控制台改为 60）。通知设置页对齐优剪模型：一个模板一套计数，展示“可提醒 N 次 / 续收 +1 / 微信授权设置”；当前只有一个模板，不展开多模板 UI。
- **登录态 = 无感登录（2026-08-24 重构）**：进小程序即自动建号，无任何弹窗。`user.profile` 首次调用惰性创建用户并自动生成资料——昵称 = 「用户」+ 6 位随机字符（小写字母+数字，去易混淆 0/o/1/l，允许与他人重复）+ 随机默认头像（主包内 `images/avatars/default-{1..6}.png`，前端 `<image>` 直接渲染）；旧数据（昵称为空或「游客」）在后端惰性迁移补齐，用户无感知。微信**不开放**程序化读取真实头像/昵称（`wx.getUserProfile` 已回收），故「默认头像」= 生成的占位图。用户资料编辑走独立页 `pages/profile-edit`：**我的页点头像或昵称进入**（2026-08-26 起去掉昵称右侧编辑 icon），可编辑 ①头像（整行 `button open-type="chooseAvatar"` 调微信原生头像选择，不再自绘选择面板；保存时上传云存储 `avatars/{ts}_{rand}.{ext}` 换 fileID）②昵称（`input type="nickname"`，键盘上方可一键填微信昵称）③手机号（选填，须为大陆 11 位格式）。编辑页输入框组下方无提示文案。`user.updateProfile` 写 `nickname/avatarUrl/phone/profileUpdatedAt`，昵称空 → 1010，手机号格式错 → 1010。mock 的 `user.profile` 初始化即自动生成资料，同步可改。**原 `components/login-sheet` 已删除（2026-08-24 无感登录重构后无引用）；`images/icons/edit.svg` 已无引用（删除候选）。**
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
- 测试：`test/` 下 `flow.test.js`（FLOW-001 全链路）/ `timeline.test.js`（时间线交叉积）/ `opendays.test.js`（开放日与公告过期）/ `feedback.test.js`（意见反馈/信息纠错）/ `notifier.test.js`（时间窗与错峰）/ `home-bootstrap.test.js`（首页聚合），用 `test/mock-db.js` 内存云数据库桩跑 `cloudfunctions/reminder/lib/*`；运行 `npm test`（六套）

## 部署
微信小程序 + 腾讯云云开发。云环境 id `cloud1-d5givb65417e3b8c9` 写在 `miniprogram/app.js` 的 `cloudEnv`（2026-08-19 换 AppID 后重建；`project.config.json` 已换新 appid `wxfee99eee9c95bd15`）。**2026-08-31 已重新部署 `reminder` 云函数**（含 `home.bootstrap` 聚合与无合并 `trip.create`）。尚未真机验证。
