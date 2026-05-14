# 版本迭代记录

## V1 → V1.1（2026-05-14）

### 信息架构调整
- TabBar 从 3 栏（首页/预约中心/我的）简化为 2 栏（首页/我的）
- 删除独立 booking 页面，预约入口功能下沉为首页/详情页的弹窗组件

### 数据模型升级
- `rules.json` 新增 `closedDays`（闭馆日规律）、`releaseFrequency`（放票频率）结构化字段
- `favorites` 集合新增 `favoritedAt` 时间戳，支持收藏置顶排序

### 云函数改造
- `spots` 云函数：`list` action 返回实时放票状态（before/after/no-release-today），收藏置顶排序，新增 `toggleFavorite` action
- `scraper` 云函数：支持双重抓取策略——定时全量（action: scheduled）+ 放票后验证（action: verify）
- 移除 `entries` action（随 booking 页面一同废弃）

### 首页简化
- 移除分类筛选、难度筛选、搜索框
- 移除紧急放票滚动栏（V2 功能）
- 城市切换区留白（V1 仅北京）
- 卡片数据结构增加 `releaseStatus`、`district`、`difficultyLabel` 等字段

### 待开发（等 UI 设计定稿）
- 详情页：日历模块、提醒设置条件逻辑、放票时间横幅、须知折叠
- 首页卡片：放票状态三种样式、预约入口弹窗
- 我的：微信订阅软引导弹窗、提醒历史
- 组件：日历底部弹窗、预约入口聚合弹窗、权限引导弹窗
