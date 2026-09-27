---
paths:
  - "miniprogram/**"
  - "test/**"
---

# 前端规则

修改小程序前端前，先读 `docs/engineering/frontend-pitfalls.md` 和对应的 `产品文档.md` 页面条目。

## 硬约束

- WXML 不调用数组方法；选中态必须由 JS 预计算。
- `setData` 使用新数组/新对象引用。
- 业务日期统一北京时间。
- 首页状态不得由页面重新推导；`MISSED` 优先展示。
- 首页空态和悬浮按钮只能出现一个新增入口。
- 提醒样式区域只允许使用真实示例入口，不伪造通知或库存。
- 修改 mock 镜像后必须运行 `test/mock-mirror.test.js`。

## 最低验收

```bash
npm test
npm run check
```

视觉或交互改动还需要在微信开发者工具中做真机尺寸检查；测试通过不等于真机通过。
