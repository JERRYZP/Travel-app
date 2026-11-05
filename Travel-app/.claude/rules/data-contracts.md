---
paths:
  - "data/**"
  - "cloudfunctions/reminder/data/**"
  - "miniprogram/utils/mock.js"
  - "scripts/export-spots-*.py"
  - "scripts/sync-seed-copies.py"
---

# 数据契约规则

## 先确认再改

放票时间、提前天数、闭馆/开放日、可约窗口、票务信息、核验日期等景点规则值，必须先向用户报告差异并提出需要确认的具体字段。禁止根据资料置信度自行推断新值。

## 真身与副本

- 景点真身：`data/spots.json`
- 规则真身：`data/rules.json`
- 云函数部署副本：`cloudfunctions/reminder/data/`
- mock 镜像：`miniprogram/utils/mock.js`
- 运营 skill：`.codex/skills/beijing-spot-posts/references/spots.json`
- seed：派生测试夹具，不是业务真身，不手改

`shortName` 是窄容器专用民间简称；不得为完整名称足够短的景点硬造简称。宽容器继续使用全名。

多放票时段统一写 `rules.releaseSlots`：每个时段包含稳定 `key`、可选 `label`、`releaseTime`、`advanceDays`，周末及法定节假日提前天数不同时写 `weekendAdvanceDays`。法定节假日用规则级 `holidayRanges: [[startDate,endDate], ...]` 表达，只录入已由用户确认或官方公布且覆盖对应日期的范围；不得按常识推断未公布年份。一个出行日对应几个时段，就创建几条提醒任务。当前种子数据按成本收敛为一个出行日最多一条：清华只保留即时预约，军博只保留最早的 08:00；不得重新加入抽签或军博后续场次而不重新评估名额消耗。

2026 年清华节假日范围来源：国务院办公厅《关于2026年部分节假日安排的通知》`https://www.gov.cn/zhengce/content/202511/content_7047090.htm`。2027 年安排公布后需补 `holidayRanges`，不能沿用 2026 年日期。

## 固定流程

修改数据后：

```bash
node scripts/build-spots-snapshot.js
python3 scripts/sync-seed-copies.py
npm test
```

`miniprogram/data/spots-snapshot.js`、`cloud-assets/data/spots-snapshot.json` 和 manifest 都是上述脚本的生成物，禁止手改；`npm test` 会以 `--check` 阻止过期快照。

修改 mock 镜像后必须重点验证：

```bash
node test/mock-mirror.test.js
```

任何字段集、字段值或包装形态变化都必须由现有测试捕获，不允许降低断言。
