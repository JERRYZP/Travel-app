# Claude/Codex 规则迁移索引

> 基线快照：`CLAUDE.md@19a4798`
> Phase 1 仅新增目标文件；Phase 2 已完成覆盖审计；Phase 3 已按本索引重写根规则。
> 当前根文件只保留现役门禁、状态、权威路由和命令；具体机制与历史流水以本索引目标文档为准。

## 状态说明

- `root-current`：已保留在精简后的根 `CLAUDE.md`，作为高频硬门禁或路由。
- `extracted`：内容已抽取到新工程文档或路径规则。
- `delegated`：原内容本来就指向现有权威文档，根文件只保留指针。
- `history`：当前不再影响行动的日期流水或旧症状，后续只保留仍有行动价值的结论。

## 迁移矩阵

| ID | 源位置 | 主题 | 目标 | 状态 |
|---|---|---|---|---|
| `RULE-SCOPE-001` | `CLAUDE.md` 1-2 | 项目定位、不代抢不代约 | 根 `CLAUDE.md` | `root-current` |
| `RULE-STATE-001` | 根规则历史“当前状态” | 只保留最新正式版 / 体验版、云端 Active 基线、运行期配置和 `main` 分叉风险 | `CLAUDE.md`、`docs/engineering/current-state.md` | `delegated` |
| `RULE-DATA-001` | `CLAUDE.md` 19 | `shortName` 窄容器口径与四处同步 | `.claude/rules/data-contracts.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-REMINDER-001` | `CLAUDE.md` 20-33 | 行程项提醒四态、菜单、MISSED、挽回候选 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-TICKET-001` | `CLAUDE.md` 34-39 | 六票务态、固定判定顺序、结果撤销 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-PROGRESS-001` | `CLAUDE.md` 40 | 门票进度分母 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-HOME-001` | `CLAUDE.md` 41-50 | 首页单形态、摘要卡、胶囊与样式硬约束 | `docs/engineering/domain-rules.md`、`.claude/rules/frontend.md` | `extracted` |
| `RULE-HOME-002` | `CLAUDE.md` 85 | 双 Tab/`homeMode` 已废弃，首页只保留单形态 | `docs/engineering/domain-rules.md` | `history` |
| `RULE-HOME-003` | 2026-11-19 首页摘要卡动态日期 | 摘要卡日期段与倒计时读取 `home.bootstrap.displayStartDate/displayEndDate`；范围取当前行程全部 `trip_items.visitDate` 首尾并包含已过期日程，PAGE-005 日期预填复用同一展示首尾且仍只接受未结束 `primaryTrip`；原 `startDate/endDate` 继续服务分享与业务判定 | `产品文档.md` `HOME-RULE-009`、`API-契约.md`、`docs/engineering/architecture.md`、`docs/engineering/domain-rules.md` | `delegated` |
| `RULE-TIMELINE-001` | `CLAUDE.md` 51-60 | 纯预览、按钮态、已开票锁定、清单分组 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-CART-001` | `CLAUDE.md` 61 | 清单是提交前暂存区 | `docs/engineering/domain-rules.md`、`docs/engineering/architecture.md` | `extracted` |
| `RULE-CART-002` | `产品文档.md` CART-RULE-003 / 007 | 清单收敛到当前这次生成的时间线范围 | `产品文档.md`、`docs/engineering/domain-rules.md` | `delegated` |
| `RULE-DOC-001` | `CLAUDE.md` 62 | 首页权威文档位置 | 根 `CLAUDE.md` 路由表 | `root-current` |
| `RULE-SPOTDATA-001` | `CLAUDE.md` 65-72 | 开放日、公告过期、核验与景点详情 | `.claude/rules/data-contracts.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-SPOTDATA-002` | `CLAUDE.md` 73-76 | 闭馆跳过展示已删除，云函数字段保留 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-CLOUD-001` | `CLAUDE.md` 77-79 | 集合权限、spot-hub 加载误报 | `docs/engineering/frontend-pitfalls.md`、`docs/engineering/architecture.md` | `extracted` |
| `RULE-TIER-001` | `CLAUDE.md` 80 | C/S/A 景点分层、可提醒条件与显式强提醒 | `docs/engineering/domain-rules.md`、`.claude/rules/data-contracts.md` | `extracted` |
| `RULE-SOURCE-001` | `CLAUDE.md` 82 | 产品/视觉权威文档 | 根 `CLAUDE.md` 的权威来源表 | `root-current` |
| `RULE-PAGE-001` | `CLAUDE.md` 83 | 页面职责与退役页 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-ENV-001` | `CLAUDE.md` 84, 148 | mock 开关、cloudEnv、appid 配对 | `.claude/rules/deployment.md` | `extracted` |
| `RULE-GIT-001` | `CLAUDE.md` Git 纪律 | `main` 集成、`codex/*` 开发、原子提交、状态分离与非规范操作提醒 | `CLAUDE.md`、`docs/engineering/current-state.md` | `root-current` |
| `RULE-HOMEBOOT-001` | `CLAUDE.md` 86-90 | `home.bootstrap` V2、读取时拆分、状态兜底 | `docs/engineering/architecture.md`、`docs/engineering/domain-rules.md` | `extracted` |
| `RULE-STACK-001` | `CLAUDE.md` 92-97 | 技术栈、云函数、抓取状态 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-DIR-001` | `CLAUDE.md` 98-118 | 目录结构、数据位置和脚本 | `docs/engineering/architecture.md`、`.claude/rules/data-contracts.md` | `extracted` |
| `RULE-TIME-001` | `CLAUDE.md` 119 | 北京时间与 camelCase | 根 `CLAUDE.md`、`.claude/rules/frontend.md`、`.claude/rules/data-contracts.md` | `root-current` |
| `RULE-CONFIRM-001` | `CLAUDE.md` 120 | 景点规则必须用户确认 | 根 `CLAUDE.md`、`.claude/rules/data-contracts.md` | `root-current` |
| `RULE-WXML-001` | `CLAUDE.md` 121 | WXML 选中态与 setData 引用 | `.claude/rules/frontend.md`、`docs/engineering/frontend-pitfalls.md` | `extracted` |
| `RULE-REMINDERCFG-001` | `CLAUDE.md` 122-127 | 系统权限、订阅额度、PAGE-008 硬闸门 | `docs/engineering/domain-rules.md`、`.claude/rules/frontend.md` | `extracted` |
| `RULE-REMINDERCFG-002` | `产品文档.md` 3.5 / PAGE-002 | 轻量提醒入口订阅授权补充后继续原动线 | `产品文档.md` `REMINDER-RULE-009`、`docs/engineering/domain-rules.md` | `delegated` |
| `RULE-QUICKREMINDER-001` | 2026-11-02 快捷设提醒流程 | 景点页/详情/分享/首页“约其他日”使用 `planQuickDates + quickCommit` 一次性提交，不写主流程 `reminder_cart`；旧版 pending 同景点行可续用，已落行程仍拦截 | `产品文档.md`、`API-契约.md`、`docs/engineering/domain-rules.md`、`docs/engineering/frontend-pitfalls.md` | `delegated` |
| `RULE-MULTIREMINDER-001` | 2026-11-06 提醒时段收敛 | 底层保留 `releaseSlots` 和工作日/周末/法定节假日提前天数能力；`statusOnly` 时段只参与票务状态和可预约窗口，不建任务；当前清华仅即时预约创建提醒，军博只保留最早 `08:00`，每个出行日最多 1 条任务；`holidayRanges` 只录官方已公布日期；授权与提醒名额按实际 `reminderTaskCount` 计算 | `产品文档.md`、`API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/domain-rules.md`、`docs/engineering/architecture.md` | `delegated` |
| `RULE-MEMBER-001` | `产品文档.md` PAGE-008 / PAGE-014 | 免费 5 个提醒名额、会员 ¥6/30 天不限提醒名额、当前有效老会员自动升级且原到期时间不变、加量包停售、仅免费超额时出现付费 | `产品文档.md`、`docs/engineering/domain-rules.md`、`docs/engineering/membership-payment.md` | `delegated` |
| `RULE-MEMBER-002` | 2026-11-02 会员限制模式切换 | `payment_config/membership_enforcement` 是运行期唯一真身；后台可切 `off/test/all`，切全量前必须完成保护额度与权益账本迁移；环境变量只作配置缺失或读取失败时的兼容兜底 | `产品文档.md` PAGE-017、`API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/membership-payment.md`、`数据库索引.md` | `delegated` |
| `RULE-MEMBER-003` | 2026-11-04 会员升级临时公告 | 公告只对 `unlimited-v3` 白名单中、公告开始前已开通会员且在有效期内返回；唯一配置为 `payment_config/membership_upgrade_notice`；后台可快速下架且不影响权益；文案统一使用“不限提醒名额” | `产品文档.md` PAGE-010 / PAGE-017、`API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/membership-payment.md` | `delegated` |
| `RULE-MEMBER-004` | 2026-11-05 会员契约能力门禁 | 新客户端必须声明 `membershipCapabilities=['unlimited-v3']`；服务端仅在声明能力且命中 `MEMBERSHIP_ENFORCEMENT_MODE` 时返回新套餐、新额度、新订单和升级公告；未声明能力的旧客户端永久保持 legacy | `API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/domain-rules.md`、`docs/engineering/membership-payment.md` | `delegated` |
| `RULE-PAY-001` | `API-契约.md` 会员与支付 | 订单金额服务端决定；API v3 与虚拟支付双通道、按订单固化渠道；请求号幂等、额度锁、持久化补偿游标；退款生命周期与本单权益快照回收；售后工作台审计 | `API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/membership-payment.md`、`docs/engineering/payment-v3-runbook.md`、`docs/engineering/payment-virtual-runbook.md` | `delegated` |
| `RULE-SALES-001` | 2026-11-02 会员购买断路器 | 独立停售开关只阻止新下单和新发起支付；已付款、查单、权益、退款和售后继续；唯一配置为 `payment_config/membership_sales` | `API-契约.md`、`.claude/rules/deployment.md`、`docs/engineering/membership-payment.md`、`数据库索引.md` | `delegated` |
| `RULE-ROLLOUT-001` | 2026-11-04 生产事故；2026-11-20 校准 | 新功能不得影响线上；会员改版默认 `test`，切 `all` 必须单独授权且只覆盖声明新能力的客户端；未声明能力继续旧契约；体验版、审核和生产切换分别授权 | `CLAUDE.md`、`.claude/rules/deployment.md`、`API-契约.md`、`docs/engineering/membership-payment.md` | `root-current` |
| `RULE-COMPAT-001` | 2026-11-05 新旧客户端交叉期 | 客户端声明能力，服务端默认回退旧契约；白名单与运行期开关决定新契约范围；`all` 只覆盖声明能力的新客户端；订单、退款和售后按快照兼容 | `docs/engineering/client-version-compatibility.md`、`CLAUDE.md`、`.claude/rules/deployment.md` | `delegated` |
| `RULE-NOTIFYOPS-001` | `CLAUDE.md` 128-137 | 状态收敛、台账自愈、发送链路 | `docs/engineering/reminder-troubleshooting.md`、`.claude/rules/deployment.md` | `delegated` |
| `RULE-NOTIFYOPS-002` | 2026-11-20 提醒发送全量中断 | `doc().get()` 必须兼容线上对象与测试数组；回归必须模拟真实云库并覆盖存在/缺失文档；`notifier` 部署后必须核验触发器、手动 tick 与真实 `SEND_SUCCEEDED`；`due>0` 且全量 `skipped` 为 P0 | `docs/engineering/reminder-outage-incident-20261120.md`、`docs/engineering/reminder-troubleshooting.md`、`.claude/rules/deployment.md` | `delegated` |
| `RULE-AUTH-001` | `CLAUDE.md` 138-139 | 无感登录、资料编辑与反馈管理 | `docs/engineering/architecture.md` | `extracted` |
| `RULE-DIFF-001` | `CLAUDE.md` 140-143 | 难度真身、mock/seed 与数据确认 | `.claude/rules/data-contracts.md` | `extracted` |
| `RULE-SILENT-001` | `CLAUDE.md` 144 | 首页静默刷新 | `docs/engineering/frontend-pitfalls.md` | `extracted` |
| `RULE-ICON-001` | `CLAUDE.md` 145 | SVG 图标系统与资源边界 | `.claude/rules/frontend.md` | `extracted` |
| `RULE-OFFICIAL-001` | `CLAUDE.md` 146 | 官方预约入口与兜底 | `docs/engineering/domain-rules.md` | `extracted` |
| `RULE-VISUAL-001` | `CLAUDE.md` 147 | 402px 视觉基准 | `figma_design.md` | `delegated` |
| `RULE-COMMAND-001` | `CLAUDE.md` 150-155 | 安装、构建、运行、测试和静态检查 | 根 `CLAUDE.md` | `root-current` |
| `RULE-DEPLOY-001` | `CLAUDE.md` 157-174 | 部署依赖、顺序和未验证状态 | `.claude/rules/deployment.md`、`docs/engineering/current-state.md` | `extracted` |
| `RULE-DEPLOY-002` | 2026-11-20 支付售后详情产物漂移 | 云函数只能从干净提交构建；拍平包必须生成逐文件 SHA-256 manifest，上传前和下载线上代码后都要校验；`payment` 必须跑真实 `afterSales.adminDetail` 入口契约，并核验版本流量与定时触发器 | `.claude/rules/deployment.md`、`scripts/cloudfunction-artifact.js`、`test/payment-admin-detail-contract.test.js`、`docs/engineering/current-state.md` | `extracted` |
| `RULE-ADMIN-001` | 2026-10-06 新增；2026-11-20 退役 | 只读 Web 管理后台已移除；`admin` 仅保留过期事件清理，不再提供 Web API | `docs/engineering/current-state.md`、`docs/engineering/architecture.md` | `history` |
| `RULE-ADMIN-002` | 2026-11-02 客服工作台 | 会员购买开关置顶；会员订单与售后双页签；昵称/OpenID 展示、搜索、订单详情和管理员审计 | `产品文档.md` PAGE-017、`API-契约.md`、`数据库索引.md` | `delegated` |
| `RULE-SHARE-001` | 2026-11-02 行程只读分享 | PAGE-018 只分享当前未结束整趟行程；链接只带 32 字节令牌，`endDate + 7 天` 当日仍有效；接收方不可编辑、复制或二次转发，公开投影不夹带身份与票务/提醒状态。主人应用内昵称只用于会话标题，Canvas 封面只画公开行程信息 | `产品文档.md` PAGE-018 / SHARE-RULE-008~009、`API-契约.md`、`数据库索引.md`、`docs/engineering/domain-rules.md` | `delegated` |
| `RULE-ADMIN-003` | 2026-11-02 客服工作台提醒质量 | 每日 13:00 / 21:00 更新最近完成 8 小时时段的任务级 2 分钟内送达率；页面只直出当前送达率和前 5 日加权均值，低于 99% 才标红 | `产品文档.md` PAGE-017、`API-契约.md`、`docs/engineering/reminder-troubleshooting.md`、`数据库索引.md` | `delegated` |
| `RULE-ACCOUNT-001` | 2026-11-19 用户自助注销 | 立即注销、再次进入空账户；有效会员强提示；未结支付/售后阻断；交易最小保留且切断 OpenID；支付/提醒竞态保护 | `产品文档.md` PAGE-012-1、`API-契约.md` 2.5、`docs/engineering/architecture.md`、`docs/legal/隐私政策.md`、`数据库索引.md` | `delegated` |
| `RULE-RESOURCE-001` | 2026-11-02 调用量结构性优化 | 静态景点快照出云函数；页面级 bootstrap；写命令返回规范视图；`user_runtime` 只是可重建读模型；`off/shadow/on` 灰度后才能启用 | `API-契约.md` 8.8、`docs/engineering/architecture.md`、`.claude/rules/deployment.md`、`数据库索引.md` | `delegated` |

## Phase 3 验收结果

1. 根 `CLAUDE.md` 只保留 `root-current` 条目和路由指针。
2. 每个 `extracted` 条目必须能在目标文件中找到对应约束。
3. `delegated` 条目必须指向仍存在的权威文档。
4. `history` 内容不得作为当前约束重新写回根规则。
5. 重写根规则后搜索旧字段、旧路由和退役状态词，确认没有非历史引用。
6. 迁移验收当时 `npm test` 25 套、`npm run check`、`git diff --check` 均通过；当前工作区状态以 `docs/engineering/current-state.md` 为准。
7. 根文件中的本地路径引用全部存在；路径规则 frontmatter 可解析。

## 尚未完成的最终验收

- 在全新 Claude Code 会话中使用 `/memory` 检查实际加载链。
- 分别模拟 `data/**`、`miniprogram/**`、`cloudfunctions/**` 改动，确认路径规则按预期触发。

## Phase 4：跨 Agent 加载

- Claude Code：自动加载根 `CLAUDE.md`；`.claude/rules/*.md` 按 `paths` 匹配加载。
- Codex：读取 `AGENTS.md` 后手动加载 `CLAUDE.md` 以及上表中与任务匹配的规则和文档。
- 两个入口都不复制业务正文，统一指向本索引所列的权威文件。
- 项目 skill 只负责各自工作流，不能覆盖 `.claude/rules/data-contracts.md` 或其他项目规则。
