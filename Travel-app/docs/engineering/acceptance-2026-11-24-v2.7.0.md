# v2.7.0 体验版验收单（2026-11-24）

## 版本基线

- 发布基线：`codex/release-2.6.2-20261120@0c9c3d4`（含 `v2.6.2-rc.1`）
- 候选分支：`codex/release-2.7.0-20261124`
- 建议标签：`v2.7.0-rc.2`
- 建议上传版本号：`2.7.0`
- 状态：**云函数已部署并回读，提醒链路自测通过；等待用户亲自上传体验版**

## 本轮范围

1. 首页品牌露出：顶部品牌组合、页尾单行暖灰品牌、`准点约票 · 从容出游`、渐隐横线与授权后的顶部间距调整。
2. 首页横向拖动修复：`page-meta` 根页锁、`touch-action: pan-y`、正文宽度约束、分享画布定位修正，以及悬浮时钟恢复页面样式时保留横向锁。
3. 首页行程墙第 N 天：统一以顶部摘要卡实际展示范围的 `displayStartDate` 起算，并移除首页悬浮时钟验收入口。
4. 清华抽签状态：抽签时段 `statusOnly=true`，参与票务状态与“可预约至”窗口，但不创建提醒、不占授权或会员名额；即时预约仍是唯一提醒时段。
5. 北京今日放票页：日期主标题 `34rpx`，右侧新增全大写衬线装饰 `TICKET RELEASE`。
6. 继承 `2.6.2-rc.1`：闭馆日不可设提醒、顶部 Banner 按真实放票时刻判断状态。

## 合并来源

- `codex/tsinghua-status-window`
- `codex/home-trip-day-range-20261124`
- `codex/home-brand-exposure`

## 自动验证

- `npm test`：通过
- `npm run check`：通过
- `git diff --check`：通过

## 发布边界

- 不包含提交审核或正式版发布。
- 不包含新的数据库结构变更。
- 最终合并产物 `reminder` / `spots` 已从 `main@5fb34f2` 部署到 `cloud1-d9g9f4hja396d6e92`，均回读为 `Active / Nodejs16.13`；线上包与发布 manifest 分别 30 / 3 个业务文件哈希一致。
- 提醒链路只读自测通过：清华抽签为 `statusOnly` 且不增加提醒任务数；故宫闭馆日返回 `UNAVAILABLE / CLOSED_DAY`；`home.bootstrap` 成功；`task.list` 返回 6 条 `WAITING` 任务。未触发真实订阅消息发送。
