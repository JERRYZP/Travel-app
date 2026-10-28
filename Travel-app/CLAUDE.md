# Travel-app

景点预约提醒小程序：聚合北京热门景点的预约与放票规则，在放票前提醒用户去官方渠道手动抢票。产品不代抢、不代约，不承诺库存。

## 最高优先级门禁

1. **规则值先确认**：放票时间、提前天数、开放/闭馆日、可约窗口、票务、核验日期等任何景点规则值，都必须先报告差异并等用户确认；禁止根据资料置信度推断或替用户拍板。
2. **保护现有工作**：开始改动前检查 `git status`。不得回滚、覆盖、格式化或清理与本任务无关的 dirty 文件。
3. **部署必须单独授权**：没有用户当场明确确认，不部署云函数、不切环境、不修改生产配置、不执行破坏性清场。
4. **不要制造第二套业务真相**：业务规则只保留一个真身；必要镜像必须由测试或生成脚本钉住。页面不得自行重推服务端状态。
5. **不要伪造能力或时效**：首页提醒区域只进入真实样式示例；任何“可约/库存”都只能表述为规则推算，并明确不代表官方库存。

## 当前状态

- 主分支：`main`。实时分支、HEAD、远端与 dirty 状态以 `git status` 和 `git log` 为准；开发任务从 `main` 创建 `codex/*` 分支，不直接堆在 `main`。
- V0.3 主流程已实现：四步流程、日期锚点、清单策略、PAGE-008 授权硬闸门。
- 新用户首页空态已重构：动态结果预览、提醒样式入口、高热度 S 级景点「近期热门景点放票」。
- 分享、深链、今日/国庆场景页、提醒额度健康度、真实缺口预警与 48 小时缓冲窗口均已实现。
- 2026-10-28 已完成非会员修复收口：授权额度、提醒回滚、清单收敛、随买随用、强提醒与景点页搜索均已提交；云函数尚未重新部署，客户端尚未发版，真机验证仍为 `pending`。
- 会员付费工作保存在独立 WIP 分支，未进入 `main`；不得把 WIP 提交当成已上线能力。
- 2026-10-27 已发版客户端来自当时未提交工作区，Git 中没有可诚实对应的发布 commit/tag。
- 完整状态、待部署范围和待验证项见 `docs/engineering/current-state.md`。

## Git 纪律

- `main` 只做集成与发布基线；功能、修复、文档治理分别从 `main` 建 `codex/*` 分支，完成验证后再合并。
- 一个提交只承载一个可独立回滚的行为；代码、测试、对应文档同提交，禁止把多个功能塞进“大收口”。
- 开始任务、切换分支、提交、合并、发版前都必须先看 `git status`、当前分支和 `origin` 差异；发现混合脏工作区、直接改 `main`、未推送提交或无法对应发布版本时，必须先提醒用户。
- 测试通过、已提交、已推送、已合并、已部署、已发版、真机已验证是不同状态，不得互相替代。

## 权威来源

| 领域 | 权威文档 |
|---|---|
| 产品行为、页面规则、状态词 | `产品文档.md` |
| API、请求/响应、错误码 | `API-契约.md` |
| 数据库集合与索引 | `数据库索引.md` |
| 视觉 token、尺寸与组件规范 | `figma_design.md` |
| 提醒发送故障与排障 | `docs/engineering/reminder-troubleshooting.md` |
| 工程结构、数据流、当前状态 | `docs/engineering/` |
| 规则迁移和无丢失索引 | `docs/engineering/rule-index.md` |

## 任务路由

开始任务时，先读本文件的硬门禁，再按改动范围读取对应内容：

| 改动范围 | 必读 |
|---|---|
| 产品交互、页面文案、状态 | `产品文档.md` 对应当页；`.claude/rules/frontend.md` |
| `miniprogram/**`、`test/**` | `.claude/rules/frontend.md`、`docs/engineering/frontend-pitfalls.md` |
| 景点/规则数据、mock、seed | `.claude/rules/data-contracts.md` |
| `cloudfunctions/**`、appid/cloudEnv | `.claude/rules/deployment.md`、`docs/engineering/current-state.md` |
| API 域与数据模型 | `API-契约.md`、`docs/engineering/architecture.md` |
| 提醒发送和 MISSED | `docs/engineering/reminder-troubleshooting.md`、`docs/engineering/domain-rules.md` |

路径规则由 Claude Code 按匹配文件自动加载；根文件不复制完整机制。

## 工程事实

- 前端：微信原生小程序 + Vant Weapp + 自绘组件。
- 后端：微信云开发；核心云函数 `reminder`，另有 `spots`、`notifier`、`feedback`、`scraper`、`ics-generator`。
- 首页数据由 `reminder.home.bootstrap` 聚合；`trip_items` 是首页、票务结果、提醒关联和删除动线的事实来源。
- 模型关系：`trips -> trip_items -> reminder_tasks`；`reminder_cart` 只是提交前暂存区。
- 首页、行程、清单、提醒的完整规则见 `docs/engineering/domain-rules.md`。
- 所有业务日期和放票时间均按北京时间 GMT+8。

## 数据真身

- 景点真身：`data/spots.json`
- 规则真身：`data/rules.json`
- 云函数部署副本：`cloudfunctions/reminder/data/`
- mock 镜像：`miniprogram/utils/mock.js`
- 运营 skill 参考：`.codex/skills/beijing-spot-posts/references/spots.json`
- `data/seed/*.seed.json` 是测试夹具，不是业务真身，不手改

改数据后先读 `.claude/rules/data-contracts.md`，再执行：

```bash
python3 scripts/sync-seed-copies.py
npm test
```

## 常用命令

```bash
npm install
npm test
npm run check
```

- 若从父目录 `my/` 进入，先执行 `cd Travel-app`。
- `npm test`：当前 28 套回归测试。
- `npm run check`：校验 WXML 方法绑定、图标资源、包内图片路径（WXML 与 `imageUrl` 字面量）、组件路径、CSS 变量和页面三件套。
- 微信开发者工具：打开 `Travel-app/`；Vant 首次使用前执行“工具 -> 构建 npm”。

## 部署

- 当前 appid：`wx05c160a589b97d76`
- 当前 cloudEnv：`cloud1-d9g9f4hja396d6e92`
- appid 与 cloudEnv 必须成对更换。
- 部署前先按 `数据库索引.md` 建集合和索引，再按 `.claude/rules/deployment.md` 的顺序部署云函数。
- 最新首页空态仅改小程序端，不需要部署云函数。
- 只要本轮修改了云函数源码、接口返回体或共享业务逻辑，就必须单独核对 `reminder` / `notifier` 的部署范围。

## 维护规则

- 本文件只保留高频门禁、权威来源和路由；详细机制放入 `.claude/rules/` 或 `docs/engineering/`。
- 新增长期约束前先更新 `docs/engineering/rule-index.md`，避免同一事实出现多处版本。
- 历史事故和日期流水以 Git、事故文档或 `docs/engineering/current-state.md` 为准，不堆回根文件。
- `AGENTS.md` 是 Codex 入口；它要求 Codex 先读取本文件和任务相关规则，不复制规则正文。
