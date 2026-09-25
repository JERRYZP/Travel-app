---
name: beijing-spot-posts
description: Generate 北京景点预约提醒 daily operation posts (Markdown) for a date range or the next N days, computing each spot's earliest bookable date from the project's reservation rules. Use when the user asks to generate or refresh Beijing spot-reservation posts for a date range or the coming N days.
---

# 北京景点预约提醒 · 运营帖生成

## 用途
为「北京景点预约提醒」每日运营帖生成内容层（Markdown）。每个景点一行：最早可约、预约时间、预约难度。典型请求：
- 「生成 9月8日 到 9月15日 的运营帖」
- 「生成未来 7 天的运营帖」
- 「更新今天的预约帖」

## 触发
出现「运营帖 / 预约帖 / 放票提醒 / 生成未来N天 / X月X日到X月X日」等针对北京景点预约提醒的内容生成请求时触发。

## 数据源
- 权威表：`产品运营/0907全量景点表_北京景点预约数据.md`（提前放票N天、周一是否闭馆、开票时间、难度、是否预约）。
- 帖子数据集（脚本实际读取）：`references/spots.json`。权威表一旦更新（提前天数/闭馆日/难度），须同步更新此 JSON。
  行内字段：`name` / `n`（提前天数）/ `time`（预约时间）/ `flames`（🔥数，直接决定运营贴火焰数）/ `bookable`（是否需预约）；可选 `monday_closed`、`open`（白名单）、`skip_tuesday`、`time_note`（预约时间附注，见口径 6）、`note`（内部备注，不渲染）。
  2026-09-15 定稿：毛主席纪念堂、人民大会堂均为 `flames: 3`，对应「🔥🔥🔥」；App 的 `difficultyScore` 同步为 3，避免两套数据再度分叉。
  2026-09-15 运营口径调整：八达岭长城、中国考古博物馆均为 `flames: 2`，对应「🔥🔥」。
- 法定假期配置（脚本实际读取）：`references/holidays.json`。来源于国务院办公厅年度节假日安排；`periods` 定义放假调休日期，`holiday_monday_closed_spots` 定义假期中仍按周一闭馆的例外景点（当前仅人民大会堂）。
- **`references/spots.json` 与 App 的 `data/rules.json` 是两套独立数据**，字段名和口径都不同（这里用 `monday_closed` / `open`，App 用 `closedDays` / `openDays`）。任一边改了规则，两边都要人工核对 —— 没有自动同步机制。
- 生图提示词模板：`references/prompt-template.md`。

## 帖子口径（关键约束，必须严格遵循）
1. **最早可约 = 当天日期 + 该景点提前放票天数 N**；若该日不可约，则**回退**到最近的可约日。
   回退只会让提前量变短、不会变长 —— 那批票本来就在 N 天窗口内，往后顺延会指到还没开始放票的日期。
2. **不可约的两种情况**（脚本 `is_open_on` 是唯一判定入口）：
   - **`open` 白名单**（**仅北大** `[5,6]` = 仅周六周日）：白名单外的星期全不可约，**优先于** `monday_closed`。
     用白名单而非「周一闭馆」是因为北大平时工作日（周一至周五）都不可约、只开周末，黑名单表达不了。
     ⚠️ **清华不是白名单**：它唯一限制是周一闭馆，工作日照常可约（2026-09-11 用户核实）。
     其「即时预约工作日最多提前 1 天 / 周末节假日最多提前 7 天」说的是**提前量**不同，**不是**工作日不可约 —— 别读错。
   - **`monday_closed` 周一闭馆**（其余场馆，含义同 App 的 `closedDays: ["monday"]`）。
3. **无需预约**：八达岭长城、天坛公园、圆明园、颐和园显示「无需预约」，预约时间填「—」。最后三个景点名称固定写作「天坛公园 / 圆明园 / 颐和园」，**不得带「（随到）」后缀**。
4. **固定 18 行顺序**（见 spots.json）：含「天安门广场」（N=7、周一开放、12:00、🔥🔥），插入在毛主席纪念堂之后、人民大会堂之前。
5. **预约时间 / 预约难度（🔥数）** 固定，不随日期变化；`flames` 为 3 时运营贴必须输出 3 个火。
6. **预约时间附注 `time_note`（2026-09-13 新增）**：`spots.json` 可选字段，非空则把预约时间渲染成「时刻（附注）」。
   当前**仅北京大学**用，值 `仅周末` → 输出 `08:00（仅周末）`。
   原因：北大只有周末才放票，光看「08:00」会让人误以为工作日也能抢，需在时间列就地说明。
   ⚠️ 别把这条附注挪到清华 —— 清华唯一限制是周一闭馆，工作日照常可约。
7. **考古博物馆**：文档注明「周二仅团体，散客无法进入」。默认**不**处理周二（与 2026-09 运营口径一致）；需严格处理时加 `--skip-tuesday-groups`。
8. **法定假期开放覆盖（2026-09-23 新增）**：`references/holidays.json` 中的日期优先于所有闭馆日和开放白名单，假期内所有景点均按开放处理。唯一例外是 `holiday_monday_closed_spots` 中的景点；当前仅**人民大会堂**，它即便在法定假期期间也仍是**周一闭馆**。
   - 当前配置：2026 年中秋节 `9月25日—9月27日`，国庆节 `10月1日—10月7日`（依据国办发明电〔2025〕7号）。
   - 不要自行把假期前后的相邻周末或调休上班日加入范围；年度安排更新时必须同步维护该文件。

## 标准操作
1. 确认日期范围：显式「起止」，或「今天起 N 天」。
2. 运行脚本（自动读取 `references/spots.json`、`references/holidays.json`，套用上述口径）：

```bash
cd "/Users/zzmbp/Library/Mobile Documents/com~apple~CloudDocs/CCode /my/Travel-app"
python3 .codex/skills/beijing-spot-posts/scripts/generate_posts.py --start 2026-09-08 --end 2026-09-15
python3 .codex/skills/beijing-spot-posts/scripts/generate_posts.py --days 7        # 今天起 7 天
python3 .codex/skills/beijing-spot-posts/scripts/generate_posts.py --start 2026-09-09 --days 5 --out 产品运营/B号运营/预约帖   # 指定账号/输出
```

3. 默认输出到 `产品运营/A号运营/预约帖/`：每天一个 `MMDD_预约帖.md`，另加 `预约帖_汇总_<起>-<止>.md`。
4. 交付时给出每日汇总；用户要出图则引用 `references/prompt-template.md` 拼生图提示词。

## 注意
- 有两个账号目录（`产品运营/A号运营/预约帖`、`产品运营/B号运营`）：默认写 A 号；要用 B 号请传 `--out`。
- 有两个不可约特例：`monday_closed` 周一闭馆（清华属此类）、`open` 仅周末白名单（**仅北大**，该行预约时间渲染为 `08:00（仅周末）`）。法定假期按 `references/holidays.json` 覆盖上述限制；人民大会堂在假期内的周一仍闭馆。
- **寒暑假是已知缺口**：北大在寒暑假等假期会改为「每天开放」，但脚本只能按 `open:[5,6]` 算，假期期间产出的日期偏保守。
  发帖前若正值寒暑假，先核对「参观北大」小程序当期公告，必要时临时调整该行数据。
- 生成前若距数据基准日（2026-09-07）较远，先核对权威表是否更新；跨年度或临近法定假期时，同时核对 `references/holidays.json` 是否已按当年官方通知更新。
- 本 Skill 产出**内容层**；视觉海报需用户套模板，或按 prompt-template 交生图模型。
- 若 `.codex/skills` 不可写（沙箱只读），可把本目录整体复制到用户级 `~/.codex/skills/beijing-spot-posts/`。
