# Travel-app 工程架构

> 本文只记录工程结构和数据流。产品行为以 `产品文档.md` 为准，接口字段以 `API-契约.md` 为准。

## 技术栈

- 前端：微信原生小程序 + Vant Weapp + 自绘组件。
- 后端：微信云开发，云函数按独立部署单元打包。
- 数据：`data/` 为业务数据真身，云函数部署副本和 `miniprogram/utils/mock.js` 是必要镜像。
- 时间：所有业务日期、放票时刻和核验日期均按北京时间 GMT+8。

## 云函数

| 云函数 | 职责 |
|---|---|
| `reminder` | 行程、行程项、清单、提醒任务、用户与首页聚合，核心业务函数 |
| `spots` | 景点查询、规则卡片和放票状态推导 |
| `notifier` | 到期提醒发送、MISSED 收敛、清理 |
| `payment` | 会员 / 提醒名额订单、支付与退款回调、主动查单、售后、权益发放与 2 分钟补偿 |
| `feedback` | 意见反馈与信息纠错 |
| `scraper` | 抓取与规则推算，未完成线上闭环 |
| `ics-generator` | `.ics` 生成，日历通道已下线但函数保留 |

## 主要页面

| 页面 | 当前职责 |
|---|---|
| `pages/home` | 行程状态墙；新用户时显示创建与内容引导 |
| `pages/add-trip` | 行程输入、纯预览时间线、加入清单 |
| `pages/spot-hub` | 景点 Tab、今日放票 Banner、景点列表与详情入口 |
| `pages/setup` | PAGE-008 设置提醒；V0.3 授权硬闸门 |
| `pages/notify-settings` | 系统通知权限与提醒额度设置 |
| `pages/profile` | 我的；帮助与反馈统一入口 |
| `pages/membership` | 会员与提醒名额；权益解释、支付前确认、持久支付状态 |
| `pages/membership-orders` | 当前用户最近 50 笔订单，点击通过本人单笔接口进入订单详情 |
| `pages/membership-order-detail` | 订单主状态、独立退款状态、权益快照和可执行动作 |
| `pages/membership-after-sales` | 用户提交未到账、重复支付、未使用退款等售后申请 |
| `pages/admin-after-sales` | 管理员售后工作台、审计操作与老用户保护额度迁移 |
| `pages/help-feedback` | 帮助与反馈二级入口：在线客服、意见反馈、信息纠错、我的反馈 |
| `pages/my-feedback` | 当前用户最近 50 条反馈/纠错记录，只读 |
| `pages/legal` | 隐私政策与用户服务协议 |
| `pages/feedback` | 意见反馈 |
| `pages/spot-correction` | 景点信息纠错 |
| `pages/share-scene` | 今日/国庆公开场景页 |

`pages/spot-rule` 与 `pages/spots` 文件仍存在，但入口和历史定位需以当前路由审计为准，不能仅凭旧文档恢复旧动线。

## 首页数据流

1. 小程序调用 `reminder.home.bootstrap`。
2. 云函数并行读取行程、行程项、提醒任务、用户和公开景点卡。
3. 服务端完成行程拆分、状态推导、提醒状态装饰、可挽回候选和额度预警。
4. 前端只渲染服务端结果；票务状态和提醒送达状态不得在页面侧重新推导。
5. `trip_items` 是首页、票务结果、提醒关联和删除动线的事实来源。

## 分享与深链

- 景点分享统一落 `pages/spot-hub?spotId=...`。
- 今日放票和国庆场景统一落 `pages/share-scene?sceneId=...`。
- 分享链接只携带公开参数，不携带昵称、OpenID、行程、票务结果或提醒状态。
- 首页分享只分享公开场景，不分享个人行程。

## 行程与提醒模型

```text
trips
  └── trip_items
        └── reminder_tasks

reminder_cart 是提交前的暂存区，不属于正式行程。
```

- `trip_items`：行程 + 景点 + 出行日的最小执行单元。
- `reminder_tasks`：由明确开启提醒且存在 `releaseAt` 的行程项派生，挂 `itemId`；新任务写入 `templateId`，旧任务缺字段时发送侧回退旧订阅模板。无固定放票时刻的行程项只落 `trip_items`，不创建任务。
- `reminder_cart`：提交前清单；提交成功后才创建/合并正式行程并清空。

## 会员、支付与售后

```text
reminder.membership.createOrder
  -> orders (PENDING)
  -> payment.create
  -> 微信支付 API v3
  -> /payment/notify 或 payment.query/2 分钟补偿
  -> 订单与 users 权益事务提交
  -> orders (PAID, entitlementGrant 快照)

用户售后
  -> after_sales_cases
  -> 自动核验 / 客服审核
  -> 微信退款 API
  -> /payment/refund-notify 或退款查询
  -> 按本单快照回收权益
```

- 免费用户 5 个提醒名额；会员 ¥2/30 天上限 10；有效会员可 ¥2 加购 5 个提醒名额。
- 唯一规则在 `cloudfunctions/reminder/lib/membership.js`；`cart.commit` 与 `tripItem.updateReminder` 都必须过同一服务端闸门。
- 老用户保护额度 `protectedTaskQuota=max(5, 当前未来 WAITING 提醒数)`，迁移由管理员分批触发。
- 订单只由 `payment` 云函数在微信支付 API v3 回调或主动查单确认后置为 `PAID`；客户端不能自行改会员。
- 回调必须校验微信支付公钥 ID 和原始 body 签名，并解密资源；下单、查单、退款响应也必须验签。
- `orders.status` 保持 `PENDING/PAID/CLOSED`；退款生命周期独立写入 `refundStatus`，历史 `REFUNDED` 只兼容展示。
- 每笔订单保存权益发放快照；退款成功只回收本单新增时长和名额包，不删除已有提醒。
- 售后证据、审核结果和退款单号存 `after_sales_cases`；敏感查看与审核操作写 `admin_audit_logs`。
- 售后工作台仅对 `AFTER_SALES_ADMIN_OPENIDS` 开放，所有操作服务端二次鉴权。

## 数据真身与镜像

| 数据 | 真身 | 镜像/派生物 |
|---|---|---|
| 景点 | `data/spots.json` | 云函数部署副本、`miniprogram/utils/mock.js`、运营 skill 参考数据 |
| 规则 | `data/rules.json` | 云函数部署副本、`miniprogram/utils/mock.js` |
| seed | `data/seed/*.seed.json` | 测试夹具，不是第四份业务真身 |

任何业务规则出现第二份独立实现都视为高风险，必须通过测试或生成脚本锁定一致性。

## 部署单元

- 小程序：微信开发者工具重新编译。
- 云函数：逐个右键部署，部署顺序和范围见 `.claude/rules/deployment.md`。
- 数据：先确认规则真身，再同步部署副本、mock 和 seed 派生夹具。

## 身份与反馈

- 登录为无感登录，首次调用用户接口时惰性创建资料。
- 昵称和头像只能来自用户主动选择或系统生成占位，不能读取真实微信资料冒充。
- 反馈分建议/Bug；信息纠错必须附景点、纠错类型和描述。
- 反馈管理页只对白名单管理员开放。
