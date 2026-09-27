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

## 固定流程

修改数据后：

```bash
python3 scripts/sync-seed-copies.py
npm test
```

修改 mock 镜像后必须重点验证：

```bash
node test/mock-mirror.test.js
```

任何字段集、字段值或包装形态变化都必须由现有测试捕获，不允许降低断言。
