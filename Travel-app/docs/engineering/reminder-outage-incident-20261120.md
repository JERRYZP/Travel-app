# 2026-11-20 提醒发送全量中断复盘

> 状态：已关闭。代码已修复并部署，线上真实发送已验证。
> 影响：2026-11-20 中午，到期提醒任务被批量跳过并标记为 `MISSED`，用户未收到订阅消息；客服工作台 13:00 提醒质量为 0。
> 运行态权威：`docs/engineering/current-state.md`。日常排障入口：`docs/engineering/reminder-troubleshooting.md`。

## 一、结论

这是一次由**云数据库返回值形状不一致**触发的提醒发送全量中断：

- 线上 `doc().get()` 返回对象；
- `notifier` 的发送前回读按数组取值 `[0]`；
- 所有仍存在的 `WAITING` 任务都被误判为“已删除”；
- `scanAndSend` 全量 `skipped`，没有发出任何消息；
- 到达放票时刻后，`sweepMissed` 将任务批量落为 `MISSED`，用户侧显示“未送达”。

今早客户端体验版和 `payment` 增量不是本次原因；直接触发点是 2026-11-19 18:07:17 部署的 `notifier` 注销竞态保护改动。

## 二、影响范围

- 生产日志中，12:29 的巡检为 `due=223 / skipped=223 / sent=0 / failed=0`。
- 12:30 的巡检为 `missed.marked=223`。
- 13:00 客服工作台提醒质量快照为 0。
- 用户端表现为收不到订阅消息，行程项显示“未送达”；点击后只有兜底文案“超过放票时间点未触发成功”。
- 已错过任务不会自动补发；修复后只恢复后续到期任务。

这里的 223 是提醒任务/offset 数量，不据此推断受影响用户数。

## 三、时间线

| 北京时间 | 事件 |
| --- | --- |
| 2026-11-19 18:07:17 | `notifier` 部署注销竞态保护；发送前增加 `doc().get()` 任务回读 |
| 2026-11-20 08:07–08:27 | `payment` 增量与客户端 `2.6.1` 体验版发布；未修改 `notifier` |
| 2026-11-20 12:24 起 | 待发任务开始持续命中全量 `skipped` |
| 2026-11-20 12:29 | 生产日志记录 `due=223 / skipped=223 / sent=0 / failed=0` |
| 2026-11-20 12:30 | 生产日志记录 `missed.marked=223` |
| 2026-11-20 13:00 | 客服工作台提醒质量快照为 0，用户反馈未收到提醒 |
| 2026-11-20 16:43:48 | 修复版 `notifier` 整包部署，回读 `Active` / Nodejs16.13 / 60 秒 |
| 2026-11-20 16:49 | 手动执行 `{"action":"tick"}`，返回 `success=true`、`errors=[]` |
| 2026-11-20 16:54:05 | 首个真实任务写入 `SEND_SUCCEEDED` / `TASK_TRIGGERED`，发送链路恢复 |

## 四、根因

错误代码：

```js
freshTask = (freshRes.data || [])[0] || null;
```

云开发服务器 SDK 的文档读取结果是：

```js
{ data: { _id: '...', backendStatus: 'WAITING', ... } }
```

代码却按测试桩的旧形状读取：

```js
{ data: [{ _id: '...', backendStatus: 'WAITING', ... }] }
```

因此对象被当成空数组，`freshTask` 恒为 `null`。注销竞态保护的本意是“发送前发现任务已删除就跳过”，实际却退化成“所有任务都当作已删除”。

## 五、为什么测试没有拦住

`test/mock-db.js` 同时支持对象和数组两种 `doc().get()` 返回形状，但注销竞态测试默认使用了数组形状：

```js
const CURRENT_DB = createDb();
```

这使测试桩与真实云库契约不一致，形成了假绿。2026-11-16 激励视频领取事务也出现过同类问题；本次是同一形状漂移再次进入发送主链路。

## 六、修复与验证

代码修复：

- 新增 `docDataOf(result)`，同时兼容对象和数组。
- 发送前回读改用 `docDataOf(freshRes)`。
- 回归测试改用 `createDb({ cloudDocGetObject: true, cloudGetOnMissing: true })`。
- 测试同时覆盖：
  - 存在且仍为 `WAITING` 的任务必须进入发送链；
  - 已被删除的任务必须跳过，不得复活或补发。

验证证据：

- `npm test`、`npm run check`、`git diff --check` 通过。
- 修复前，新的真实形状回归稳定失败于 `skipped=1`。
- 部署后线上源码确认包含 `docDataOf()`。
- `ListTriggers` 确认 `notifierEveryMinute` 仍在、启用、cron 为 `0 * * * * * *`。
- 16:54:05 真实任务产生 `SEND_SUCCEEDED` 与 `TASK_TRIGGERED`。

## 七、防复发门禁

已完成：

1. `doc().get()` 调用必须使用对象/数组兼容转换；测试必须模拟真实云库对象形状。
2. 注销竞态回归同时覆盖“存在任务发送”和“删除任务跳过”两条路径。
3. `notifier` 部署后必须核验线上源码、定时触发器、手动 `tick` 和下一到期窗口的真实发送证据。
4. 生产日志出现 `due > 0`、`skipped=due`、`sent=0`、`failed=0` 时按 P0 处理，不得解释为正常清理。
5. 规则与索引已同步到 `.claude/rules/deployment.md` 和 `docs/engineering/rule-index.md`。

仍待处理：

- 当前没有独立的主动告警通道。`notifier` 全量跳过仍主要依赖质量快照、日志巡检和用户反馈发现。
- 后续若接入告警，应对“大量到期任务全部跳过”“连续多个 tick 无成功发送”“发送失败率突增”设置主动通知；具体通道、接收人和部署授权需另行确认。

## 八、教训

- 测试桩不是生产契约；测试桩越宽松，越容易制造假绿。
- “函数 Active”“tick 返回 success”“quality 接口可读”都不能替代真实发送证据。
- 发送主链路需要同时观察 `scanned / due / sent / failed / skipped`，不能只看是否抛错。
- 用户端的“未送达”只是结果状态；兜底文案不能替代可行动的服务端错误原因。
