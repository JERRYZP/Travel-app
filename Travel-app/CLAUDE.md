# Travel-app
为自由行游客解决热门景点预约难题的智能提醒工具。专注北京热门景区（故宫、国博、天安门等）的预约信息聚合与精准提醒。

## 技术栈
- 前端：微信原生开发 + Vant Weapp UI 组件库
- 后端：腾讯云云开发 (Cloud Development)
- 抓取：Playwright + stealth 插件
- 开发工具：Claude Code + 微信开发者工具

## 项目结构
```
Travel-app/
├── miniprogram/              # 小程序前端
│   ├── pages/
│   │   ├── index/            # 首页 - 北京预约大盘
│   │   ├── detail/           # 景点详情页
│   │   └── profile/          # 我的
│   ├── components/           # 自定义组件
│   ├── utils/                # 工具函数
│   └── images/               # 图片资源
├── cloudfunctions/           # 云函数
│   ├── scraper/              # 数据抓取（定时+放票后验证）
│   ├── notifier/             # 提醒推送
│   ├── spots/                # 景点数据查询+实时状态计算
│   └── ics-generator/        # .ics 日历文件生成
├── data/                     # 数据文件
│   ├── spots.json            # 景点基础信息表（10个北京热门景点）
│   ├── rules.json            # 景点预约规则表（含closedDays/releaseFrequency等结构化字段）
│   └── scraping-plan.md      # 数据抓取技术方案
├── 产品文档.md
├── V1功能规划.md
└── V1.1产品规划.md
```

## 指令集
- 安装 Vant Weapp：`cd Travel-app && npm install`
- 构建 npm：在微信开发者工具中点击「工具」→「构建 npm」
- 云函数部署：右键 cloudfunctions/xxx 文件夹 →「创建并部署：云端安装依赖」
- 运行：用微信开发者工具打开 Travel-app 目录

## 部署
微信小程序 + 腾讯云云开发

## 开发规范
- 所有页面文件放在 `miniprogram/pages/` 下
- 所有云函数放在 `cloudfunctions/` 下
- 云数据库集合命名：spots / rules / subscriptions / favorites
- 关键字段命名统一使用 camelCase
