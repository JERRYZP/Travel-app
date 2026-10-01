# 提醒推送排障清单

> 2026-09-14 立。起因：首页「已过期」里的提醒任务显示「待提醒」、无告警图标、点胶囊无反应，且用户从未收到推送。
> 关联规则：`REMINDER-RULE-004` / `STATE-002`；关联文档：`产品文档.md`、`API-契约.md`、`数据库索引.md`、`CLAUDE.md`。
> ⚠️ 2026-09-25 状态审计：文中「任务列表 / 已过期 Tab / `decorateTaskGroups`」属于 2026-09-16 前的旧首页形态。现役用户界面是行程状态墙；云端触发器、索引和环境变量仍按本文 A 节核查，用户侧只看行程项卡的提醒 chip 与“未送达”原因。第五、六节保留为旧任务列表兼容期的历史修复记录。

## 一、症状

| 用户看到 | 实际含义 |
| --- | --- |
| 「已过期」列表里的任务胶囊写「待提醒」 | 任务还卡在 `WAITING`，从未被处理 |
| 胶囊旁没有告警图标、点了没反应 | 前端只对 `MISSED` 渲染图标与解释弹窗 |
| 到点没收到订阅消息 | `notifier` 没有发出推送 |

## 二、根因（两条独立，必须都修）

### 1. 服务端从未被触发（主因）

`notifier` 的**定时触发器是空的**（云开发控制台 → 云函数 → `notifier` → 函数配置 → 触发器配置 → 定时触发器 = `--`）。

没有定时触发 → 不扫描任务 → 不推送；同时**也不会**把已过放票时刻的任务判为 `MISSED`，任务就永久停在 `WAITING`。

> 旧版 `tick` 是三步串行（`scanAndSend` → `sweepMissed` → `cleanup`）。第一步因缺索引等原因抛错时，后两步**不会执行**，「没发出去」与「没标 MISSED」同时发生，用户侧完全静默。

### 2. 前端状态判定用了两套口径

| 判定项 | 依据 |
| --- | --- |
| 落在「已过期」列表、`counts.expired` | `msLeft <= 0`（**时间**） |
| 胶囊文案「待提醒」 | `backendStatus === WAITING` |
| `alert-circle` 图标、点击解释 | `backendStatus === 'MISSED'` |

三者不同源 → 出现「已过期 + 待提醒 + 无图标 + 点击无反应」。

## 三、修复

### A. 云端配置（控制台操作，**必须做，代码修不了**）

1. **定时触发器**：名称 `notifierEveryMinute`，类型「定时触发」，周期 `0 * * * * * *`
   > cron 为 **7 段式**：`秒 分 时 日 月 周 年`。`0 * * * * * *` = 每分钟第 0 秒。时区固定 UTC+8，一个函数只能挂 1 个触发器。
2. **环境变量**（同一页面「环境配置」）：

   | key | value |
   | --- | --- |
   | `WX_APPID` | `wx05c160a589b97d76` |
   | `WX_APPSECRET` | 公众平台「管理 → 开发管理 → 开发设置 → 开发者ID」重置后获取（**只显示一次**） |
   | `SUBSCRIBE_TEMPLATE_ID` | `V6Nm8xUD4sMWwSCy8CFWm3ukhla-RGNrEfnI4aBYb-Q` |

   「API Key 设置」与「时区设置」两个开关**都保持关闭**（全仓云函数时间处理时区无关，不依赖容器 TZ）。
3. **超时时间改 60 秒**（默认 3 秒会把 30 秒错峰窗口掐断）。
4. **建索引** `reminder_tasks`：`backendStatus` + `releaseAt`（升序、不勾唯一）。缺了它 `tick` 第一步就报错。
5. **重新部署** `notifier` 与 `reminder`（右键 → 上传并部署：云端安装依赖）。
6. **验证**：`notifier` → 云端测试 → `{"action":"tick"}`，期望 `errors` 为空数组。
   - `{"action":"whoami"}` → 确认 `appid` 是新号
   - `{"action":"testSend","touser":"<users 集合里的 openId>"}` → 真机收到订阅消息

### B. 代码修复（历史记录：2026-09-14 当时已完成）

| 文件 | 改动 |
| --- | --- |
| `cloudfunctions/notifier/index.js` | `tick` 三步各自 `try/catch`（单步失败不再连带）；发送失败时写 `lastSendError`；`sweepMissed` 的 `missedReason` 优先取 `lastSendError`，不再写死笼统文案 |
| `cloudfunctions/reminder/lib/task.js` | 新增 `effectiveStatusOf()`（已过 `releaseAt` 的 `WAITING` ≡ `MISSED`）与 `sweepOverdue()`（`list()` 读取时兜底补判并落库，幂等，写库失败也收敛返回值） |
| `miniprogram/pages/home/home.js` / `.wxml` | `decorateTaskGroups` 派生 `missed`，图标与解释弹窗改判 `task.missed`；兼容未重新部署的旧云端 |
| `miniprogram/utils/mock.js` | `task.list` / `task.clear` 同步镜像上述口径 |
| `test/task-status.test.js` | 新增回归测试（5 组），已挂进 `npm test`（六套 → 七套） |

## 四、排障顺序（下次直接照这个走）

1. 看 `notifier` **日志**有没有 `[notifier] tick`
   - 完全没有 → 触发器没建/没启用 → 做 A.1
   - 有 tick 但 `errors` 非空 → 缺索引 → 做 A.4
   - 有 tick、`send.failed > 0`，reason 含「未配置」→ 做 A.2
2. 再核对「函数配置」页：触发器、环境变量、超时 60 秒
3. 最后看小程序端：对应**行程项卡**的提醒 chip 是否显示「未送达」+ 警告图标（圆圈 + 叹号）。点它应弹出未送达原因（`home.js` 的 `onMissedReason`，原因来自服务端 `item.reminder.reason`）。该渲染已于 2026-09-22 落地；若此时卡上没有任何提示，再回到 A 节检查任务是否仍停在 `WAITING`。

## 五、单条删除权限（旧任务列表兼容期，2026-09-14）

`sweepOverdue` 把过期 `WAITING` 落库成 `MISSED` 后，原口径「仅 WAITING 可单删」会变成死结——**一条已经失败的任务反而删不掉**，只能靠「清空任务」连带清掉别的记录。

现已放宽 `REMINDER-RULE-005`：

| 状态 | 单条删除 | 说明 |
| --- | --- | --- |
| `WAITING` | ✅ | |
| `MISSED` | ✅ | **2026-09-14 新增** |
| `TRIGGERED` | ❌ | 保留为送达历史，前端不显示「删除」项，改提示走「清空任务」 |

- 服务端：`cloudfunctions/reminder/lib/task.js` 的 `DELETABLE_STATUS = [WAITING, MISSED]`，其余返回 1012。
- 前端：`home.js` 的 `decorateTaskGroups` 派生 `deletable`，`home.wxml` 据此渲染「删除」项或说明行；`onTaskDelete` 另有兜底 Toast。
- mock：`miniprogram/utils/mock.js` 的 `task.remove` 同步同一口径。

## 六、空壳行程：任务清零后行程仍占着 Tab（旧首页形态，2026-09-14 修复）

**症状**：首页「提醒任务」选中某行程 Tab，显示「进行中 0 / 已过期 0」，列表全空，但 Tab 一直在，点进去什么都做不了。

**根因**：行程删除有两条口径，旧代码只实现了第一条。

| 口径 | 触发 | 保留条件 | 旧行为 |
| --- | --- | --- | --- |
| 读取时兜底 `removeIfEmpty` | `trip.list` | 任务空**且**清单空 | 清单非空即保留（保护草稿行程） |
| 主动删除级联 | `task.remove` / `task.clear` | —— | **缺失** → 清空任务后清单残留，行程被 `removeIfEmpty` 判为「非空」永久残留 |

**关键时序（别搞反）**：行程创建于 `home.js onGenerateTimeline()`（点「生成预约时间线」）时，**早于**清单添加（`cart.add` / `cart.addAll`），更早于 `task.submit`。所以「清单非空即保留」不是 bug，是草稿行程的保护网——**不能去掉**，去掉会连带清掉草稿清单，前端 `ensureInlineTrip` 也无法自愈。

**修复**：

| 文件 | 改动 |
| --- | --- |
| `cloudfunctions/reminder/lib/trip.js` | 新增 `purgeIfNoTask()`（任务空 → 删行程 + 其清单，不看清单）与 `remove()`（显式删除行程 + 任务 + 清单）；`removeIfEmpty` 保持原样 |
| `cloudfunctions/reminder/index.js` | `task.remove` / `task.clear` / `admin.cleanup` 的级联改用 `purgeIfNoTask`；新增 `trip.remove` action |
| `miniprogram/pages/home/home.js` | `onClearTasks` 弹窗写出「该行程及其提醒清单会被一并删除」；选中行程 0/0 时入口转为「删除这个空行程？」→ `doDeleteEmptyTrip` |
| `miniprogram/utils/mock.js` | 新增 `purgeTripIfNoTask()` 与 `trip.remove`，`task.remove` / `task.clear` 同步镜像 |
| `test/flow.test.js` | 第 10、11 节新增回归断言（空壳行程清理、只清一半不误删、`trip.remove`） |

**存量数据**：修复前留下的空壳行程不会自动消失（它有清单，`removeIfEmpty` 判为非空）。重新部署 `reminder` 后，在首页选中该行程 Tab →「清空任务」→ 会弹「删除这个空行程？」，确认即可清掉。
