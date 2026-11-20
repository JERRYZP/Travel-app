# admin 过期清理任务

2026-11-20 已移除只读 Web 管理后台及其全部公开 API。本云函数只用于每日清理：

- 删除超过 180 天的 `reminder_events`；
- 删除超过 180 天的 `admin_audit_logs`。

## 当前边界

- 定时触发器：`adminDailyCleanup`，北京时间每天 `01:00`。
- 每次每个集合最多清理 200 条，剩余记录由下一轮继续清理。
- 普通客户端调用 `internal.cleanupExpired` 返回 `1040`；任何旧的 `admin.login` / `admin.*` action 返回 `1099`。
- 不读写 `admins`、`reminder_daily_stats`；两者仅作为历史数据保留。
- 所有云端部署仍需用户当场明确授权。
