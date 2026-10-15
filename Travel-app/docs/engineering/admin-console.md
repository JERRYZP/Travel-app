# 只读 Web 管理后台

> 2026-10-06 工作区实现。当前未创建云端集合、索引、触发器，也未部署。

## 定位

- 桌面端运营分析工具，只读查看用户、提醒任务和景点任务频率。
- 不修改用户、行程、任务或反馈；不提供 CSV、重发、备注等运营写操作。
- 第一版使用 CloudBase 默认域名，仅用于内部测试，不作为生产发布。

## 组成

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Web 前端 | `admin-web/` | Vue 3 + Vite + TypeScript + Element Plus + ECharts |
| Admin API | `cloudfunctions/admin/` | 管理员鉴权、只读查询、事件汇总、审计 |
| 事件账本 | `reminder_events` | 追加式原始事件，保留 180 天 |
| 永久汇总 | `reminder_daily_stats` | 按北京时间 `dateKey + metricType + spotId` 保存 |
| 管理员审计 | `admin_audit_logs` | 登录和敏感字段查看，保留 180 天 |

## 鉴权

1. Web 使用 CloudBase Web SDK 匿名登录，仅用于调用云函数。
2. `admin.login` 使用 `admins` 集合中的独立账号密码签发 8 小时 HS256 token。
3. 连续 5 次失败锁定 15 分钟。
4. 首个管理员由 `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_PASSWORD_HASH`、`ADMIN_BOOTSTRAP_PASSWORD_SALT` 引导创建。
5. `ADMIN_SESSION_SECRET` 必须配置为随机长字符串。

生成首个管理员密码哈希：

```bash
cd cloudfunctions/admin
node scripts/hash-password.js "your-password"
```

## 统计口径

- 用户活跃度 = 最近一次 `TASK_CREATED`、`TASK_TRIGGERED` 或 `TASK_MISSED`。
- 景点任务频率 = 按 `TASK_CREATED` 的 `taskId` 去重计数。
- 任务重建单独记 `TASK_REBUILT`，不混入创建频率。
- 到期处理率 = 已触发 /（已触发 + 未送达）。
- 发送成功率 = 发送成功 /（发送成功 + 发送失败），跳过不计入分母。
- “任务已触发”表示任务处理完成，不等于用户已收到消息；发送结果必须看 `SEND_SUCCEEDED / SEND_FAILED / SEND_SKIPPED`。

## 命令

```bash
npm test
npm run check
npm run test:admin-web
git diff --check
```

`npm run test:admin-web` 会执行 Vitest 并生成 Web 生产构建。

## 云函数安全规则

Web 端先用匿名身份调用 `admin`，管理员权限再由 `admin.login` 的签名 token 校验。CloudBase 云函数安全规则需要单独放行 `admin`，同时继续排除其他匿名调用：

```json
{
  "*": {
    "invoke": "auth.loginType != 'ANONYMOUS' && auth != null"
  },
  "admin": {
    "invoke": "auth != null"
  }
}
```

- 若当前已有其他函数的安全规则，只新增或修改 `admin` 这一项，不要覆盖已有规则。
- 不允许把 `*` 改成 `true`。
- `admin` 的 `internal.rollupDaily` 只接受定时触发器调用，普通客户端调用会返回 1040。

## 部署前置

1. 创建 `admins`、`reminder_events`、`reminder_daily_stats`、`admin_audit_logs`。
2. 按 `数据库索引.md` 第四节创建管理后台索引。
3. 在 CloudBase 控制台开启匿名登录，并配置 `admin` 云函数环境变量。
4. 在“云函数 / 权限控制”中配置上面的函数安全规则。
5. 部署 `admin`、`reminder`、`notifier`。
6. 构建并上传 `admin-web/dist` 到 CloudBase 静态托管。
7. 使用测试管理员完成只读冒烟。

所有云端操作和部署都必须先获得用户当场明确授权。
