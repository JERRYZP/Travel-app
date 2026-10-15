# 小程序前端易错点

## WXML

- WXML 不能调用 `indexOf` 等数组方法。选中态必须在 JS 侧计算成布尔字段，WXML 只读结果。
- 组件和页面模板里使用的数据字段必须显式声明；拼写错误通常是静默 `undefined`，不会编译报错。
- WXML 绑定的方法必须真实存在，`npm run check` 会验证模板绑定、图标和组件路径。

## setData 与刷新

- `setData` 必须传新数组或新对象引用；原地 `push/splice` 后传回原引用可能不刷新。
- 首页标记、删除、撤销后使用 `loadHome({ silent: true })`，避免列表塌缩导致页面跳回顶部。
- 时间线加入清单后不能只改数字，列表和按钮状态必须按真实结果刷新。
- 景点选择状态只以 `spotId` 为键：云端 `spots.batch` 不保证按传入 ID 顺序返回，禁止用 `selectedSpotIds` 的下标去删 `selectedSpots`，否则会误删其他卡片并留下删不掉的项。

## 时间与日期

- 全系统业务时间按北京时间 GMT+8；不得混用设备本地时区。
- 摘要卡的行程级倒计时和行程项级倒计时是两套文案，不要合并。
- 行程项卡倒计时按距放票毫秒数分级，不等于北京时区的自然日差：≥24 小时显示天，1 小时至不足 24 小时显示小时，1 分钟至不足 1 小时显示分钟，不足 1 分钟显示「即将开始」。

## 页面状态

- 首页票务态和提醒态全部消费服务端结果，不在页面侧重新按时间推导。
- 摘要卡在**全部行程都已结束**时展示最近一段过往行程（副标题「已结束」，见 `HOME-RULE-008`），但**预填/提交类逻辑一律不认它**：`summaryTrip` 只喂 `trip-summary-card`，`onAddTrip` 的预填只读 `primaryTrip`（未结束行程）。把摘要卡那趟的日期段带进 PAGE-005 会预填出一个过去的时间范围，提交时被判 1016。退化的“哪一趟”也只沿服务端数组序（`trips[0]` → `history[0]`）回退，页面不重判结束状态。回归见 `test/home-past-trip-card.test.js`。
- `MISSED` 必须覆盖普通票务态显示。
- 首页空态与悬浮新增入口互斥，不能同屏出现两个同职责 CTA。
- 首页新用户空态的提醒区域只提供真实样式入口，不伪造微信通知内容。
- 微信一次性订阅的原子约束是“一次用户点击 → 一次 `wx.requestSubscribeMessage` → 同模板最多 +1 条”。“总是保持以上选择”只免去后续弹窗，禁止在第一个授权回调后的异步链里连续申请，第二次调用会脱离用户手势上下文，真机失败。

## 浮层与滚动容器

- ⚠️ **`position: fixed` 的浮层不能放进 `scroll-view` 里，也不能留在 `overflow: hidden` 的 sheet 内**（2026-10-12 事故）：真机上 fixed 元素的包含块会退化成滚动容器，再被外层 sheet 裁掉。`spot-popup` 的二维码弹层原本嵌在 `.popup-scroll` 内，折叠态下只露上半截、识别不了；同一弹层在 `pages/spot-rule`（该页没有 scroll-view）显示正常，差异只来自这个祖先。写法照 `cart-popup` 的下拉层与 `spot-popup` 的 `.qr-mask`：放在 `</scroll-view>` 之外，与 sheet 同级。回归断言在 `test/cart-popup.test.js` §1 / §9。
- fixed 浮层被移出 sheet 后，**原来靠父级数据存在性做的间接门控会失效**（例如 `.qr-mask` 曾隐式依赖 `spot` 非空）。改成独立 `wx:if` 时，要在所有会清空数据的失败分支里显式收掉它。
- 小程序的 `web-view` 只认公众平台「业务域名」白名单，而白名单要求把校验文件放到**目标域名根目录**——第三方官网（故宫 / 天安门 / 清华…）做不到，进去只会是打不开的白页。且 `wx.navigateTo` 到承载页本身会成功，「跳转失败再复制」的兜底永远不触发。官网一律走 `setClipboardData` + 指引到手机浏览器；`pages/webview/webview` 已于 2026-10-12 删除，不要再新增第二套官网跳转实现。
- **吸顶统一走 `position: sticky`**，不要再写「`onPageScroll` + `boundingClientRect` 测位 + 切固定态 + 撑 spacer」那一套：每帧一轮节点查询，比渲染层自己算贵得多（首页 2026-09-21 删掉的就是这套）。当前项目 `skylineRenderEnable: false`（WebView 渲染），sticky 正常；将来若开 Skyline 要重新验证。回归断言见 `test/sticky-day-head.test.js`。
  - **偏移量只能运行时下发**：导航栏高度跟状态栏走、各机型不同，wxss 写不出常量；`add-trip` 的日期标题还要加上 `.timeline-panel` 的高度（那个面板自己也在吸顶，同偏移量会叠在一起，而它的高度随「出游日 Tab 行」在不在变）。量不到就**不加吸顶类**——写死 `top: 0` 会把标题吸到屏幕最顶上、被导航栏压住。
  - **吸顶块必须有不透明底**：卡片是非定位元素，会正常滑到标题下面，但标题没底色时卡片内容会从标题处透出来糊住文字。底色取所在容器自己的底色（首页行程墙 = `--color-page`，时间线模块 = `--color-surface`）。
  - ⚠️ **sticky 的偏移作用在「外边距盒」上**：日期标题自带 `margin-top` 时（`trip-section` 的 `.ts-day-head` 是 32rpx），吸顶会在标题上方留出一条同高的透明带，卡片从这条带里透出来。要用 `::before` 补一块同色底，**高度必须等于那条外边距**（回归断言会比对两个数值）。
  - ⚠️ **z-index 要夹在「卡片普通内容」与「菜单展开态」之间**：`trip-section` 取 35，因为 `trip-card` 的菜单图标是 31、展开态是 40——低于 31 会让菜单图标浮在吸顶标题上（卡片滑过去时看得见），高于 40 会盖住用户正在用的菜单。注意 z-index 同时是**层叠上下文**：日期菜单（`.ts-day-menu` 31 / `.ts-day-pop` 32）会被收进这一层，对外整体按 35 参与比较，所以展开态仍压在卡片捕获层 31 之上、菜单照常能点。
  - 祖先链上任何 `overflow: hidden` 都会让 sticky 退化（包含块变成那个祖先）。两处日期标题的祖先（`.page-body` / `.timeline-section` / `.page-scroll`）都没有，新增包裹容器前先确认。
  - ⚠️ **吸顶块的高度 = 它自己的 padding 盒**：只靠 `margin` 做上下间距时，底色只有一行字那么高——吸住之后日期贴着导航栏，下面滑上来的卡片正好切在字的下沿，看着像「被切掉一块」（2026-10-12 用户报的就是这个）。把上下的呼吸位从 `margin` 挪进 `padding`：`trip-section` 的 `.ts-day-head` 现在是 `padding: 16rpx 0; margin: 16rpx 2rpx 0`，**总间距不变**（上方 16+16=32rpx，与原来纯 margin 的 32rpx 一致），但置顶条上下各多出 8px。挪动后记得同步 `::before` 补位块的高度。
  - ⚠️ **吸顶接缝上不要画分隔线**：`.timeline-panel` 与它下面的吸顶日期标题同为 `--color-surface` 白底，原来那条 1rpx `border-bottom` 夹在两块白底之间，面板吸住后就变成一条看着像「镂空」的缝（2026-10-12 用户报的）。吸顶态的分隔交给底部阴影，不要用描边。
  - ⚠️ **吸顶偏移量向下取整**（`Math.floor`，不是 `Math.round`）：四舍五入会向上取到半像素，在吸顶块与它上面的元素之间留出一条缝；floor 最多重叠不到 1px，而两块都是不透明底色，看不出重叠。

## 资源与图标

- `svg-icon` 读取 `images/icons/*.svg`；图标是预填色，不能靠 CSS `color` 改色。
- 删除页面或图标前必须反查模板、组件、测试和路由。
- 微信代码质量线要求主包小于 1.5MB，且**整个代码包的图片/音频合计不超过 200KB**（按字节求和，不是单文件限制）。
- 大图源文件放仓库根目录 `cloud-assets/images/`，通过 `scripts/upload-cloud-assets.sh` 上传到 `static/v0.3/images/`；小程序内用 `utils/cloud-assets.wxs` 或 `utils/assets.js` 生成云文件 ID。
- ⚠️ **`utils/cloud-assets.wxs` 的函数只吃运行时变量，不给字面量参数**（2026-09-30 事故）：`asset.city('beijing.png')` 这类写法除了产出云文件 ID，开发者工具预览编译还会按字面量**额外解析一次本地路径** `/images/cities/beijing.png`，本地没这个文件就是 `Error: ENOENT: no such file or directory`。同一个 commit 里 `asset.spot(item.spotId)` 没事，是因为动态值不走向量路径解析。
  - 包内小图（图标、头像、分享封面、空态头图）：WXML 里直接写 `src="/images/..."` 字面量，不走 WXS。
  - 云图：必须传运行时变量（`asset.spot(item.spotId)`、`item.qrCode`）。
  - 护栏：`scripts/check-miniprogram.py` 的 `check_wxs_cloud_literal()`，扫到字面量参数即失败。
- ⚠️ **200KB 额度只剩 2.4KB**（2026-09-30）。`banner_bg.png` 65.9KB + `share/` 两张 41KB 已占掉一半，新增任何包内图片前先算总账。
- **包内小图怎么压**（2026-09-30 三张图共 44.9KB → 17.0KB 的做法）：
  - 先判 alpha 是不是**恒定值**。`beijing.png` 全图 alpha 恒为 128（均匀 50%），没有任何透明度信息——垫上页面底色 `#F8F3EA` 压平成 RGB 后**渲染结果像素级一致**，再转 JPEG（44.9KB → 3.9KB）。恒定 alpha 是纯浪费，且它会把图锁死在 PNG。
  - 线稿/插画类（`empty-hero-bg`）PNG 调色板几乎无收益（30KB），JPEG 才是对的（11.2KB）。
  - 带**真**透明的（`empty-hero-logo` 有 68.6% 全透明）必须留 PNG，走 `quantize(colors=…, method=FASTOCTREE, dither=FLOYDSTEINBERG)`；记得先核对调色板档位，24 色与 40 色在 78rpx 上屏看没有差别。
  - **按实际上屏尺寸导出**，不要留超采样：卡片 690rpx 宽 → 2x 屏就是 690 物理像素，按 690×224 导出后 `aspectFill` 缩放正好 1.000（零重采样），比原图 740×240 更清晰。
- 本地 `<image>` 不支持 webp；景点图保持 jpg/png。
- `miniprogram/images/` 只保留图标、默认头像、分享封面等小资源；新增或替换资源后必须运行 `npm run check`。

## Mock 镜像

- `miniprogram/utils/mock-data.js` 存 `SPOTS` / `RULES` 数据镜像，`mock.js` 存行为镜像；两者都不是业务规则真身。2026-09-30 从 `mock.js` 拆出数据（原文件 122KB，首页冷启动要同步解析它）。
- ⚠️ **`mock.js` 的惰性化（把 122KB 移出主包）尚未完成**：`utils/api.js:5` 顶层 `require('./mock.js')`，而微信打包器是**静态依赖收集** —— 把 require 挪进 `if (USE_MOCK)` 分支不一定能减包，需要开发者工具的「代码依赖分析」实测确认。没实测之前不要动，也不要为减包破坏 `USE_MOCK=true` 的离线联调（`scripts/check-miniprogram.py` 的 `check_mock_not_in_client()` 专门保护这条链路）。
- 修改云端的行程合并、时间线、状态推导或接口返回体时，必须同步 mock，并跑 `test/mock-mirror.test.js`。

## 首页首屏（2026-09-30 三层渲染）

- 首页先出内容再原地替换：**缓存层**（`utils/home-cache.js` 回放上次的 bootstrap 返回体）→ **骨架层**（`utils/empty-preview.js` 的本地切片）→ **实况层**（云端返回）。
- ⚠️ 骨架层必须用 `wx:elif` 接在空态块之后，**不能是独立的 `wx:if`**：WXML 的 `wx:else` 绑的是紧邻的上一个 `wx:if/wx:elif`，中间插一个独立 `wx:if` 会让下面的行程墙 `wx:else` 改绑到骨架块上，结果空态和行程墙同时渲染且不报错。
- 骨架层期间 `loading` 必须保持 `true`，**不能渲染空态块**：否则返回用户会先看到「你还没有行程」再跳变成状态墙，比白屏更糟。
- 缓存只做首屏填充，**不参与任何业务判定**；缓存与实况必须共用同一个 `buildHomeData()` 纯函数，再逐键比对后只写变化的字段（`applyHomeData`）——这是「不跳变」的结构性保证。
- `empty-preview.js` 的本地切片是 `data/spots.json` 的只读投影，漂移由 `test/home-optimistic.test.js` 钉死（含一条自动推导「哪些字段影响渲染」的探针）。
- 首页热门景点预览改为**首屏渲染之后**单独拉（`loadHotSpots`）：它要付一次 `spots` 云函数冷启动，塞进 bootstrap 会让用户等两次冷启动。云端结果仍走 `applyHomeData`，内容一致时零 setData。
