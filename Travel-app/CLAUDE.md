# Travel-app
景点预约提醒小程序：聚合北京热门景点的放票规则，在放票前提醒用户手动去官方渠道抢票。不代抢代约。

## 当前状态（2026-08-04）

**文档已换代，代码还没跟上。开工前必读这段。**

- 权威需求 = `产品文档.md`（V1.0 基线，编号化条目，440 行）。视觉规范 = `figma_design.md`。
- `miniprogram/` 与 `cloudfunctions/` 里的代码是**上一代形态**（景点大盘列表 + 详情页订阅，3 页 3 集合），不是 `产品文档.md` 的部分实现。
- 新形态是「行程 → 时间线 → 提醒清单 → 提醒任务」，PAGE-001~011，7 张表。现有 index/detail/profile 三页在新 IA 里没有对应页面。
- 下一步：按 `产品文档.md` 第二册重建页面、第四册重建集合。改任何功能前先确认自己动的是新形态还是旧脚手架。

## 技术栈
- 前端：微信原生 + Vant Weapp 1.11（`app.json` 已注册 15 个 van- 组件）
- 后端：腾讯云开发，云函数 4 个：`spots`（查询+放票状态实时计算，195 行，唯一有实质逻辑的）、`scraper`（抓取，规则推算占位）、`notifier`（推送，TODO 占位）、`ics-generator`（.ics 生成，TODO 占位）
- 抓取：Playwright + stealth，方案见 `data/scraping-plan.md`，未部署

## 目录与约定
```
miniprogram/pages/    页面（现为旧形态 index/detail/profile）
miniprogram/images/   空目录——app.json 引用的 tabbar 图标（images/tabbar/*.png）不存在，真机缺图；新版 UI-V1.0/ 也未提供图标源文件
miniprogram/components/ 空目录
cloudfunctions/       云函数，一函数一目录
data/spots.json       10 个北京景点，difficultyScore 实际取值 {1,2,3,5}
data/rules.json       对应放票规则，含 closedDays/releaseFrequency
UI-V1.0/              页面导出图 01~11.png（对应 PAGE-001~011，缺 06）
产品分析/ 竞品资料/    调研素材，非开发依据
```
- 字段命名 camelCase。全系统时间按北京时间 GMT+8（`产品文档.md` TIME-RULE-001）。
- 旧集合：spots / rules / subscriptions / favorites。新集合见 `产品文档.md` 第四册，迁移时以文档为准。
- `project.config.json` 的 `appid` 仍是占位符 `wx YOUR_APPID_HERE`，真机预览前需填真实 appid。
- **导航实现有分歧**：`app.json` 当前用原生 `tabBar`（引用不存在的 png 图标），但 `figma_design.md` 第 5 节要求 V1 以「页面内自绘导航」实现，后续再迁 custom-tab-bar。按新规范做则应删掉 `app.json` 的 `tabBar` 段，原生图标也不必再补。
- 视觉基准宽度 402px（`figma_design.md` 第 4 节），非 750rpx；换算到 rpx 时以 402px 为 100% 宽计算。
- 难度标签只有一处真身：`spots` 云函数的 `computeDifficultyLabel`（≥4 极难约 / =3 较难约 / ≤2 容易约，同 TAG-RULE-001）。它已随 list/detail 返回 `difficultyLabel`，页面直接渲染即可。旧 wxml 自己用 `difficultyScore > 4` 又算了一遍且在 score=4 时判错——重建页面时不要复制这个模式。

## 指令集
- 安装依赖：`cd Travel-app && npm install`
- 构建 npm：微信开发者工具 →「工具」→「构建 npm」（Vant 必需）
- 云函数部署：右键 `cloudfunctions/<name>` →「创建并部署：云端安装依赖」
- 运行：微信开发者工具打开 `Travel-app/` 目录
- 无测试脚本（`npm test` 是 npm 默认占位，会直接 exit 1）

## 部署
微信小程序 + 腾讯云云开发。云环境 id 写在 `miniprogram/app.js` 的 `cloudEnv: 'travel-app-env'`。尚未真机验证。
