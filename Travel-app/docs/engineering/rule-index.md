# Claude/Codex 规则迁移索引

> 基线快照：`CLAUDE.md@19a4798`
> Phase 1 仅新增目标文件；Phase 2 已完成覆盖审计；Phase 3 已按本索引重写根规则。
> 当前根文件为 101 行、约 5.4KB；基线文件为 174 行、约 75KB。

## 状态说明

- `root-current`：已保留在精简后的根 `CLAUDE.md`，作为高频硬门禁或路由。
- `extracted`：内容已抽取到新工程文档或路径规则。
- `delegated`：原内容本来就指向现有权威文档，根文件只保留指针。
- `history`：当前不再影响行动的日期流水或旧症状，后续只保留仍有行动价值的结论。

## 迁移矩阵

| ID | 源位置 | 主题 | 目标 | 状态 |
|---|---|---|---|---|
| `RULE-SCOPE-001` | `CLAUDE.md` 1-2 | 项目定位、不代抢不代约 | 根 `CLAUDE.md` | `root-current` |
| `RULE-STATE-001` | `CLAUDE.md` 4-17 | 当前版本状态与近期变更 | `docs/engineering/current-state.md` | `extracted` |
| `RULE-DATA-001` | `CLAUDE.md` 19 | `shortName` 窄容器口径与四处同步 | `.claude/rules/data-contracts.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-REMINDER-001` | `CLAUDE.md` 20-33 | 行程项提醒四态、菜单、MISSED、挽回候选 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-TICKET-001` | `CLAUDE.md` 34-39 | 六票务态、固定判定顺序、结果撤销 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-PROGRESS-001` | `CLAUDE.md` 40 | 门票进度分母 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-HOME-001` | `CLAUDE.md` 41-50 | 首页单形态、摘要卡、胶囊与样式硬约束 | `docs/engineering/domain-rules.md`、`.claude/rules/frontend.md` | `extracted` |
| `RULE-HOME-002` | `CLAUDE.md` 85 | 双 Tab/`homeMode` 已废弃，首页只保留单形态 | `docs/engineering/domain-rules.md` | `history` |
| `RULE-TIMELINE-001` | `CLAUDE.md` 51-60 | 纯预览、按钮态、已开票锁定、清单分组 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-CART-001` | `CLAUDE.md` 61 | 清单是提交前暂存区 | `docs/engineering/domain-rules.md`、`docs/engineering/architecture.md` | `extracted` |
| `RULE-DOC-001` | `CLAUDE.md` 62 | 首页权威文档位置 | 根 `CLAUDE.md` 路由表 | `root-current` |
| `RULE-SPOTDATA-001` | `CLAUDE.md` 65-72 | 开放日、公告过期、核验与景点详情 | `.claude/rules/data-contracts.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-SPOTDATA-002` | `CLAUDE.md` 73-76 | 闭馆跳过展示已删除，云函数字段保留 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-CLOUD-001` | `CLAUDE.md` 77-79 | 集合权限、spot-hub 加载误报 | `docs/engineering/frontend-pitfalls.md`、`docs/engineering/architecture.md` | `extracted` |
| `RULE-TIER-001` | `CLAUDE.md` 80 | C/S/A 景点分层与可提醒条件 | `docs/engineering/domain-rules.md`、`.claude/rules/data-contracts.md` | `extracted` |
| `RULE-SOURCE-001` | `CLAUDE.md` 82 | 产品/视觉权威文档 | 根 `CLAUDE.md` 的权威来源表 | `root-current` |
| `RULE-PAGE-001` | `CLAUDE.md` 83 | 页面职责与退役页 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-ENV-001` | `CLAUDE.md` 84, 148 | mock 开关、cloudEnv、appid 配对 | `.claude/rules/deployment.md` | `extracted` |
| `RULE-HOMEBOOT-001` | `CLAUDE.md` 86-90 | `home.bootstrap` V2、读取时拆分、状态兜底 | `docs/engineering/architecture.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-STACK-001` | `CLAUDE.md` 92-97 | 技术栈、云函数、抓取状态 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-DIR-001` | `CLAUDE.md` 98-118 | 目录结构、数据位置和脚本 | `docs/engineering/architecture.md`、`.claude/rules/data-contracts.md` | `extracted` |
| `RULE-TIME-001` | `CLAUDE.md` 119 | 北京时间与 camelCase | 根 `CLAUDE.md`、`.claude/rules/frontend.md`、`.claude/rules/data-contracts.md` | `root-current` |
| `RULE-CONFIRM-001` | `CLAUDE.md` 120 | 景点规则必须用户确认 | 根 `CLAUDE.md`、`.claude/rules/data-contracts.md` | `root-current` |
| `RULE-WXML-001` | `CLAUDE.md` 121 | WXML 选中态与 setData 引用 | `.claude/rules/frontend.md`、`docs/engineering/frontend-pitfalls.md` | `extracted` |
| `RULE-REMINDERCFG-001` | `CLAUDE.md` 122-127 | 系统权限、订阅额度、PAGE-008 硬闸门 | `docs/engineering/domain-rules.md`、`.claude/rules/frontend.md` | `extracted` |
| `RULE-NOTIFYOPS-001` | `CLAUDE.md` 128-137 | 状态收敛、台账自愈、发送链路 | `提醒推送排障清单.md`、`.claude/rules/deployment.md` | `delegated` |
| `RULE-AUTH-001` | `CLAUDE.md` 138-139 | 无感登录、资料编辑与反馈管理 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-DIFF-001` | `CLAUDE.md` 140-143 | 难度真身、mock/seed 与数据确认 | `.claude/rules/data-contracts.md` | `extracted` |
| `RULE-SILENT-001` | `CLAUDE.md` 144 | 首页静默刷新 | `docs/engineering/frontend-pitfalls.md` | `extracted` |
| `RULE-ICON-001` | `CLAUDE.md` 145 | SVG 图标系统与资源边界 | `.claude/rules/frontend.md` | `extracted` |
| `RULE-OFFICIAL-001` | `CLAUDE.md` 146 | 官方预约入口与兜底 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-VISUAL-001` | `CLAUDE.md` 147 | 402px 视觉基准 | `figma_design.md` | `delegated` |
| `RULE-COMMAND-001` | `CLAUDE.md` 150-155 | 安装、构建、运行、测试和静态检查 | 根 `CLAUDE.md` | `root-current` |
| `RULE-DEPLOY-001` | `CLAUDE.md` 157-174 | 部署依赖、顺序和未验证状态 | `.claude/rules/deployment.md`、`docs/engineering/current-state.md` | `extracted` |

## Phase 3 验收结果

1. 根 `CLAUDE.md` 只保留 `root-current` 条目和路由指针。
2. 每个 `extracted` 条目必须能在目标文件中找到对应约束。
3. `delegated` 条目必须指向仍存在的权威文档。
4. `history` 内容不得作为当前约束重新写回根规则。
5. 重写根规则后搜索旧字段、旧路由和退役状态词，确认没有非历史引用。
6. `npm test` 25 套、`npm run check`、`git diff --check` 均通过。
7. 根文件中的本地路径引用全部存在；路径规则 frontmatter 可解析。

## 尚未完成的最终验收

- 在全新 Claude Code 会话中使用 `/memory` 检查实际加载链。
- 分别模拟 `data/**`、`miniprogram/**`、`cloudfunctions/**` 改动，确认路径规则按预期触发。
