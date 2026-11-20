# Travel-app

> 项目规则入口是 `CLAUDE.md`，详细约束位于 `.claude/rules/`。本文件只是 Codex 入口：Codex 不展开 `@` 文件导入，也不会自动加载 `.claude/rules/`，因此必须按下面的门禁手动读取同一套规则。

## Codex 读取门禁

开始规划、改代码、改文档或判断部署状态前：

1. 读取 `CLAUDE.md`。
2. 运行 `git status`，识别并保护现有 dirty 文件。
3. 按改动路径读取对应规则和文档：

| 改动范围 | 必读 |
|---|---|
| `miniprogram/**`、`test/**` | `.claude/rules/frontend.md`、`docs/engineering/frontend-pitfalls.md` |
| `data/**`、`miniprogram/utils/mock.js`、seed/导出脚本 | `.claude/rules/data-contracts.md` |
| `cloudfunctions/**`、`miniprogram/app.js`、`project.config.json` | `.claude/rules/deployment.md`、`docs/engineering/current-state.md` |
| API、数据模型、首页聚合 | `API-契约.md`、`docs/engineering/architecture.md` |
| 产品交互、页面文案、状态 | `产品文档.md` 对应当页、`docs/engineering/domain-rules.md` |
| Agent 规则或文档结构 | `docs/engineering/rule-index.md` |

## 共享硬门禁

- 景点规则值必须先向用户确认，禁止根据资料置信度自行推断。
- 不得覆盖、回滚或清理与本任务无关的未提交改动。
- 业务规则只保留一个真身；页面和 mock 不得成为第二套业务真相。
- 云函数部署、环境切换、数据删除、分支/worktree 清场都必须有用户当场明确授权。
- 测试通过、已提交、PR 合并、已部署、真机验证是不同状态，不能互相替代。

## 验证

代码或模板变化完成后至少运行：

```bash
npm test
npm run check
git diff --check
```

修改景点、规则或 mock 时，先按 `.claude/rules/data-contracts.md` 完成数据同步，再跑全套测试。

## 同步纪律

- Claude Code：根 `CLAUDE.md` 每次加载，`.claude/rules/*.md` 按路径加载。
- Codex：本文件入口，按上表手动加载同一份规则。
- 不把详细机制复制进本文件；新增长期规则先更新 `docs/engineering/rule-index.md`。
