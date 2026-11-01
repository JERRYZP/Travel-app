# admin 云函数

只读 Web 管理后台 API。部署前需要：

1. 创建 `admins`、`reminder_events`、`reminder_daily_stats`、`admin_audit_logs` 集合，权限统一选“仅管理端可读写”。
2. 生成首个管理员密码哈希：

```bash
node scripts/hash-password.js "your-password"
```

3. 给云函数配置环境变量：

- `ADMIN_BOOTSTRAP_USERNAME`
- `ADMIN_BOOTSTRAP_PASSWORD_HASH`
- `ADMIN_BOOTSTRAP_PASSWORD_SALT`
- `ADMIN_SESSION_SECRET`

首次成功登录后会在 `admins` 集合创建 `SUPER_ADMIN`。后续登录不再依赖 bootstrap 环境变量。
