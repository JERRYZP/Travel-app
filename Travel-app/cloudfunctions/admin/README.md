# admin 内部维护任务

2026-11-20 已移除只读 Web 管理后台。本云函数不再提供登录、用户/任务查询或敏感字段查看接口，只保留每日内部维护：

- 重建最近 N 天 `reminder_daily_stats`；
- 为缺失终态的任务补录 `TASK_CREATED / TASK_TRIGGERED / TASK_MISSED` 事件；
- 分批清理超过 180 天的 `reminder_events` 与 `admin_audit_logs`。

## 配置

- 索引见 `数据库索引.md` 第四节「内部维护任务必须」。
- 定时触发器：`adminDailyRollup`，北京时间每天 `01:00`。
- 普通客户端调用 `internal.rollupDaily` 返回 `1040`；任何旧的 `admin.login` / `admin.*` action 返回 `1099`。

## 安全边界

- 不开放匿名调用。
- 不接受客户端传 token。
- 不读写 `admins` 集合；该集合仅作为历史数据保留，不再参与运行。
- 所有云端部署仍需用户当场明确授权。
