---
name: travel-app-spot-data
name_en: Travel-app Spot Data Export
name_zh: Travel-app 景点数据导出
description: Generates the standardized Markdown "全量景点表" (full attraction table) for the Beijing Travel-app project, merging spots.json and rules.json source data. Use when the user mentions 全量景点数据, 景点数据, 全量景点表, 景点表导出, or asks to export/update the attraction data document.
description_en: Generates the standardized Markdown "full attraction table" for the Beijing Travel-app project, merging spots.json and rules.json source data. Use when the user mentions exporting or updating the attraction data document.
description_zh: 按标准格式生成 Travel-app 项目的「全量景点表」Markdown 文档，合并 spots.json 与 rules.json 源数据。用户提到全量景点数据、景点数据、全量景点表、导出景点表时使用。
argument-hint: Export the spot data table (optionally specify output location)
argument-hint-en: Export the spot data table (optionally specify output location)
argument-hint-zh: 导出景点数据表（可指定输出位置）
user-invocable: true
---

# Travel-app 景点数据导出

> 项目共享门禁：做代码或数据改动前先读 `CLAUDE.md`、`.claude/rules/data-contracts.md` 和 `docs/engineering/current-state.md`。本 Skill 只定义导出工作流，不替代项目规则。

## 数据源（唯一真身）

项目根目录：`/Users/zzmbp/Library/Mobile Documents/com~apple~CloudDocs/CCode /my/Travel-app`
（注意路径含空格，shell 命令必须整体加引号）

| 文件 | 提供字段 |
|------|---------|
| `data/spots.json` | spotId、name、difficultyScore（难度分）、reservationRequired（是否需预约）、category |
| `data/rules.json` | advanceDays（提前放票天数）、releaseTime（开票时间）、closedDays（闭馆日数组）、bookingTips、lastCheckedDate、specialNotice |

派生规则（与 `cloudfunctions/spots/index.js` 的 computeDifficultyLabel / TAG-RULE-001 保持一致）：
- 难度分 ≥4 → 极难约；=3 → 较难约；≤2 → 容易约
- 分层：S = 需预约且难度 ≥4；A = 需预约且难度 ≤3；B = 免预约（reservationRequired=false）
- 提醒属性：强提醒 = 需预约且难度 ≥3；弱提醒 = 需预约且难度 ≤2；不可提醒 = 需预约但 releaseTime 为空（随买随用）；不进提醒 = B 层

## 硬性规则

1. **永远从源数据现场生成**。禁止照抄旧截图、旧导出文档（曾因此把已修正的清华周一闭馆又改错）。旧文档只作格式参考。
2. 生成前 `diff data/rules.json cloudfunctions/reminder/data/rules.json` 和 `diff data/spots.json cloudfunctions/reminder/data/spots.json`；不一致时以 `data/` 为准并在文档「数据风险」节注明。
3. B 层（免预约）行：难度标签列写「—（不渲染）」；advanceDays/releaseTime 用圆括号展示原始值（如 `(7天)`、`(21:00)`），口径见说明节。
4. 周一闭馆列：`monday ∈ closedDays` → ✅，否则 ❌；closedDays 含其他日期时加括号注（如周二闭馆、仅园中园——园中园口径 = 公园本体开放、闭馆只针对园中园）。
5. 按开票时间聚类表：**从主表全量推导**，覆盖 00:00–20:00 全部时段 + 无放票时刻，不得截断。多时刻景点（如军博三场放票）归入首场并加脚注。
6. 文档头部注明数据基准（取所有 lastCheckedDate 最新值或 rules 最近修改日期）与导出时间（运行 `date` 获取）。

## 输出格式模板

```markdown
# 全量景点表（北京 · 预约难度参考表）

> 数据基准：{日期}（rules.json）｜导出时间：{日期}
> 景点总数：{N}（S 层 {n1} ｜ A 层 {n2} ｜ B 层 {n3}）

## 全量景点表

| # | 景点 | 难度分 | 难度标签 | 分层 | 是否预约 | 周一是否闭馆 | 提前放票 | 开票时间 | 提醒属性 |
|---|------|-------|---------|------|---------|-------------|---------|---------|---------|
| 1 | 故宫博物院 | 5 | 🔴 极难约 | **S** | ✅ 需预约 | ✅ | 7天 | 20:00 | 🔶 强提醒 |
| … | | | | | | | | | |

## 口径说明

- **难度标签**：由 spots 云函数 `computeDifficultyLabel` 生成，规则 TAG-RULE-001：难度分 ≥4 → 极难约；=3 → 较难约；≤2 → 容易约。B 层不渲染难度标签。
- **分层**：S = 需预约且难度 ≥4（{n1} 个：{列表}）；A = 需预约且难度 ≤3（{n2} 个）；B = 免预约（{n3} 个）。
- **提醒属性**：强提醒 = 需预约且难度 ≥3（{n} 个：{列表}）；弱提醒 = 需预约且难度 ≤2（{n} 个）；不可提醒 = 需预约但无放票时刻、随买随用；不进提醒 = B 层免预约。
- **B 层括号数据**：B 层括号里的天数 / 时刻是 rules.json 原始数据。因 `reservationRequired=false`，不参与提醒计算，UI 也不展示，只显示「随到随买」。
- **周一是否闭馆**（来自 rules.json `closedDays`）：✅ = 周一闭馆；❌ = 周一正常开放。（按需加子条目：仅园中园、周二闭馆、特殊条目）

## 数据风险

- **未二次核实**（`lastCheckedDate` 为 null，{n} 个）：{列表}。
- **过期公告**：{specialNotice 含已过期日期区间的条目，逐一列出}。（无则写「无」）

## 按开票时间聚类

> 仅覆盖 S / A 层（需预约项）。

| 时刻 | 景点 |
|------|------|
| 00:00 | … |
| … | … |
| 无放票时刻 | {随买随用景点}（不进提醒） |

\* {多时刻放票景点的脚注说明}
```

符号约定：难度 🔴🟠🟢 / 分层 **S** A B / 预约 ✅❌ / 提醒 🔶强 🔵弱 ⚠️不可 不进提醒(B层纯文字)。
行序：S → A → B；层内难度分降序，同分按 spots.json 原始顺序。

## 交付

1. 写入当前会话 outputs/：`全量景点表_北京景点预约数据.md`，用 present_files 呈现。
2. 若用户要求同步到项目：另存一份带日期副本 `{MMDD}全量景点表_北京景点预约数据.md` 到项目 `产品运营/` 目录。
3. 导出后自查：行数 = spots.json 条数；聚类表覆盖全部 A/S 层需预约景点、无遗漏无重复；各口径节的数量与主表实际行数吻合。
