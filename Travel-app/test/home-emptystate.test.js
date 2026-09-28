/**
 * 首页空态的入口唯一性
 *
 * 用户反馈：新用户首页出现了**两个一模一样的「新增提醒」**——
 * 空态自带一个居中的 CTA，右下角又有一个悬浮按钮。
 *
 * 这类问题单测跑不出来（数据是对的、方法也存在），只能靠断言结构：
 * 两个入口的显示条件必须互斥。
 *
 * 运行：node test/home-emptystate.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.js'), 'utf8');
const HOME_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');
const RELEASE_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/release-context.js'), 'utf8');

/**
 * 剥掉注释再断言。
 * ⚠️ 必须的：这轮删除留下的都是「说明删了什么」的注释，里面天然会出现
 * `sticky` / `boundingClientRect` 这些词。直接对全文 grep 会把解释当成残留，
 * 于是断言要么误报、要么被逼着把有用的注释删掉。
 */
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

console.log('=== 1. 空态只在「一个行程项都没有」时出现 ===');
{
  /* 空态判据用的是 trips/history 都为空，而不是 isBlank 这个布尔 ——
     两者语义一致，但模板里直接用数组长度更好读、也少一个同步点。
     ⚠️ 必须带 !loading：加载期间两个数组都还是初值 []，
     不带的话新用户一进页面会先闪一下空态再切走。 */
  const blankBlock = /<block wx:if="\{\{!loading && trips\.length === 0 && history\.length === 0\}\}">/;
  eq(blankBlock.test(WXML), true, '空态块带 !loading（防加载瞬间闪空态）');
  eq(/class="empty-cta" bindtap="onAddTrip"/.test(WXML), true, '空态里有一个创建行程 CTA');
  eq(/class="empty-steps"/.test(WXML), false, '旧三步说明已由结果预览替代');
  eq(/class="empty-proof-card"/.test(WXML), true, '空态展示行程→抢票→提醒的结果预览');
  eq(/emptyReleaseSample\.visitText/.test(WXML), true, '预览的出行计划来自动态示例数据');
  eq(/ep-stop-icon|ep-arrow/.test(WXML), false, '步骤区不再渲染图标');
  eq(/class="ep-sample-entry" bindtap="onOpenReminderSamples"/.test(WXML), true,
    '服务通知示意卡改为提醒样式示意图入口');
  eq(/将在 5 分钟后放票/.test(RELEASE_JS), false,
    '不再在首页伪造未经真实样式核验的通知内容');
  eq(/class="empty-hot"/.test(WXML), true, '空态底部有近期热门景点放票模块');
  eq(/emptyReleaseRows\.length/.test(WXML), true, '近期热门景点放票无数据时整块不渲染');
  eq(/bindtap="onEmptySpotTap"[\s\S]*data-id="\{\{item\.spotId\}\}"/.test(WXML), true,
    '热门景点行点击进入景点详情');
  eq(/class="empty-hot-img" src="\/images\/spots\/\{\{item\.spotId\}\}\.jpg"[\s\S]*lazy-load="\{\{true\}\}"/.test(WXML), true,
    '近期热门景点放票行展示对应景点缩略图');
  eq(/class="empty-hot-all" bindtap="onOpenAllSpots"/.test(WXML), true,
    '近期热门景点放票提供「全部景点」入口');
  eq(/class="empty-hot-all" bindtap="onOpenAllSpots"[\s\S]*empty-hot-all-text[\s\S]*chevron-right/.test(WXML), true,
    '「全部景点」带下划线文字和右箭头');
  eq(/\.ep-stop-label \{[^}]*color:\s*#AA927C/.test(HOME_WXSS), true,
    '步骤标题颜色加深一级');
  eq(/\.ep-stop-value \{[^}]*font-size:\s*22rpx/.test(HOME_WXSS), true,
    '步骤内容字号增大一级');
  eq(/buildHomeReleasePreview\(res\.hotSpots \|\| \[\], serverNow, 3\)/.test(JS), true,
    '预览复用 home.bootstrap 已返回的 hotSpots，不额外请求接口');
  eq(/emptyReleaseRows: releasePreview\.rows/.test(JS), true, '页面消费近期热门景点放票预览行');
  eq(/emptyReleaseSample: releasePreview\.sample/.test(JS), true, '页面消费动态提醒示例');
  eq(/onEmptySpotTap\(e\)[\s\S]*openSpotPopup\(spotId\)/.test(JS), true,
    '热门景点行复用现有景点详情浮窗');
  eq(/onOpenAllSpots\(\)[\s\S]*\/pages\/spot-hub\/spot-hub/.test(JS), true,
    '「全部景点」复用小程序的景点页');
  eq(/onOpenReminderSamples\(\)[\s\S]*\/pages\/setup\/setup\?showSample=1/.test(JS), true,
    '示意图入口复用设置页已有的三种真实样式弹层');
}

console.log('=== 1.1 首页规则预览只展示高热度景点，并给出真实放票文案 ===');
{
  const release = require(path.join(ROOT, 'miniprogram/utils/release-context.js'));
  const now = new Date('2026-09-28T02:00:00Z'); // 北京时间周一 10:00
  const mk = (spotId, name, popularityScore, difficultyScore, releaseTime, closedDays) => ({
    spotId,
    name,
    popularityScore,
    difficultyScore,
    difficultyLabel: { key: difficultyScore >= 4 ? 'EXTREME' : 'EASY', text: difficultyScore >= 4 ? '极难约' : '容易约' },
    remindable: true,
    advanceDays: 7,
    releaseTime,
    closedDays,
    openDays: [],
  });
  const preview = release.buildHomeReleasePreview([
    mk('gugong', '故宫博物院', 5, 5, '20:00', ['monday']),
    mk('square', '极难约今日场', 5, 4, '12:00', []),
    mk('badaling', '极难约已放票', 5, 4, '00:00', []),
    mk('cold', '冷门场馆', 2, 1, '09:00', []),
  ], now, 3);

  eq(preview.rows.length, 3, '最多只展示 3 条');
  eq(preview.rows.some(row => row.spotId === 'cold'), false, '热度不足的景点不进入首页');
  eq(preview.rows.find(row => row.spotId === 'square')._releaseStatusText, '今天 12:00 放票', '当天未到点显示今天放票');
  eq(preview.rows.find(row => row.spotId === 'badaling')._releaseStatusText, '今天已放票', '过了放票时刻显示今天已放票');
  eq(preview.rows.find(row => row.spotId === 'gugong')._releaseStatusText, '明天 20:00 放票', '闭馆时顺延到下一个开放日');
  eq(preview.sample.visitText, '10月6日 · 故宫博物院', '示例优先选高难度热门景点');
  eq(preview.sample.releaseText, '明天 20:00 起抢', '示例给出该景点具体的抢票时间');
  eq(preview.sample.remindText, '19:55 微信提醒', '示例给出提醒提前量');
}

console.log('=== 2. 悬浮按钮只在已有行程时出现 ===');
{
  eq(/<view wx:if="\{\{!loading && !isBlank\}\}" class="fab-btn"/.test(WXML), true,
    '悬浮按钮带 !loading && !isBlank');
  /* 没有 wx:if 就是无条件渲染 —— 那正是「同屏两个入口」的原因 */
  eq(/<view class="fab-btn"/.test(WXML), false, '悬浮按钮不是无条件渲染');
  eq(/isBlank: trips\.length === 0 && \(res\.history \|\| \[\]\)\.length === 0/.test(JS), true,
    'isBlank 的算法与空态判据一致');
  eq(/isBlank: false,/.test(JS), true, 'isBlank 有初值（且初值为 false，配合 !loading 使用）');
}

console.log('=== 3. 两个入口互斥 ===');
{
  /* 结构上：空态 CTA 在 wx:if 块内、悬浮按钮以 !isBlank 为条件。
     两者的触发条件互补 —— 要么「无事可做 → 居中 CTA」，
     要么「已有行程 → 右下悬浮」，不会同时出现。 */
  const blankAt = WXML.indexOf('class="empty-cta"');
  const elseAt = WXML.indexOf('<block wx:else>');
  const fabAt = WXML.indexOf('class="fab-btn"');
  eq(blankAt > 0 && blankAt < elseAt, true, '空态 CTA 在 wx:if 分支内（不在 else 分支）');
  eq(fabAt > elseAt, true, '悬浮按钮在 wx:else 分支之后，由 !isBlank 二次把关');
  eq((WXML.match(/bindtap="onAddTrip"/g) || []).length, 2, '全页只有这两个入口指向 onAddTrip');
}

console.log('=== 4. 摘要卡底部的「即将提醒」胶囊 ===');
{
  /* 用户口径（2026-09-21）：摘要卡最下面**不要**「未来行程」那行，改成展示
     **即将提醒的两个事件**（设计稿 UI/V.0.2-0919）：`今天20:00 天安门城楼/国博放票`。
     那行小字说的是行程结构，而卡底部要的是**行动信息**——「接下来该抢什么」。
     ⚠️ 文案由服务端拼（task.buildReleasePills），页面只渲染：
     与吸顶横幅同一条纪律，时间一律走北京时间，页面不得自己 format。 */
  eq(/futureTrips|futureText|onFutureTap|onFutureTripTap/.test(WXML + JS), false,
    '「未来行程」那行已彻底撤掉（页面与摘要卡两处都不留残迹）');
  /* ⚠️ 胶囊必须是 home.bootstrap 的**顶层独立字段**，不能挂在 stickyBanner 下：
     横幅受 BANNER_WINDOW_HOURS(1h) 限制只覆盖眼下，挂进去就等于「一小时内有票要放
     才显示胶囊」——而设计稿上要展示的恰恰是「后面还有哪几场」。 */
  eq(/bannerPills: res\.releasePills \|\| \[\]/.test(JS), true,
    '胶囊取顶层 releasePills（不挂在 stickyBanner 下）');
  const HOMEFN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/reminder/index.js'), 'utf8');
  eq(/releasePills: task\.buildReleasePills\(decorated, nowTs, 2\)/.test(HOMEFN), true,
    'home.bootstrap 顶层下发 releasePills');
  eq(/pills: buildReleasePills/.test(HOMEFN), false, '不再把胶囊塞进 stickyBanner');
  eq(/pills="\{\{bannerPills\}\}"/.test(WXML), true, '页面把胶囊传给摘要卡');

  const CARD_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.wxml'), 'utf8');
  const CARD_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.js'), 'utf8');
  const CARD_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-summary-card/trip-summary-card.wxss'), 'utf8');
  /* 配色：北京之行以下的正文统一 #EAD9A8，但**最近那颗胶囊**不在此列 */
  eq(/color: #EAD9A8/.test(CARD_WXSS), true, '正文取 #EAD9A8');
  eq(/\.sm-pill \{[^}]*color: #EAD9A8/.test(CARD_WXSS), true, '胶囊文字同色系');
  eq(/background: rgba\(234, 217, 168, \.25\)/.test(CARD_WXSS), true,
    '胶囊底色 #EAD9A8 25% 不透明度');
  eq(/wx:if="\{\{pills\.length > 0\}\}"/.test(CARD_WXML), true, '没有即将放票的项时整块不渲染');
  eq(/class="sm-pill \{\{p\.nearest \? 'is-nearest' : ''\}\}"/.test(CARD_WXML), true,
    '胶囊逐个渲染，且最近的一颗带 is-nearest');
  eq(/\.sm-pill\.is-nearest \{/.test(CARD_WXSS), true, '最近的胶囊有高亮样式（设计稿两颗粒深浅不同）');
  /* 最近一颗：实底 #EAD9A8 + 朱砂字 #C0472A。第二颗保持半透明浅底 + 浅字。 */
  const nearestRule = (/\.sm-pill\.is-nearest \{[^}]*\}/.exec(CARD_WXSS) || [''])[0];
  eq(/background: #EAD9A8/.test(nearestRule), true, '最近的胶囊实底 #EAD9A8');
  eq(/color: #C0472A/.test(nearestRule), true, '最近的胶囊文字 #C0472A');
  eq(/rgba\(234, 217, 168, \.25\)/.test(CARD_WXSS), true, '第二颗仍是 25% 半透明底（与第一颗形成对比）');
  eq(/pills: \{ type: Array, value: \[\] \}/.test(CARD_JS), true, 'props 收 pills');
  eq(/onPillTap/.test(CARD_JS) && /triggerEvent\('pill'/.test(CARD_JS), true, '点胶囊抛 pill 事件');
  eq(/onBannerPillTap/.test(JS) && /openSpotPopup/.test(JS), true,
    '点胶囊打开景点浮窗（「去看看这张票」，不是「新增提醒」）');
  eq(/\.sm-pill \{[^}]*font-size: 22rpx/.test(CARD_WXSS), true, '胶囊是小字（22rpx）');
  /* ⚠️ 胶囊上方**不要分隔线**（用户 2026-09-21 明确点名）：设计稿里胶囊直接浮在
     卡面上。这条断言就是钉住它别被「顺手加条线」改回去。 */
  const pillsRule = (/\.sm-pills \{[^}]*\}/.exec(CARD_WXSS) || [''])[0];
  eq(/border-top/.test(pillsRule), false, '胶囊上方没有分隔线');

  /* 设计稿一比一还原的其它硬指标 */
  /* 渐变/圆角是设计给的**精确值**，不是"看起来差不多"的自造值：
     自造一组会在对稿时露馅。 */
  eq(/linear-gradient\(160deg, #C65941 12\.9%, #B8432A 87\.46%\)/.test(CARD_WXSS), true,
    '渐变与断点逐字采用设计值');
  eq(/border-radius: 24rpx/.test(CARD_WXSS), true, '圆角 24rpx（设计值 12px）');
  eq(/opacity: \.[89]/.test(codeOf(CARD_WXSS)), false,
    '卡上文字不用 opacity 叠渐变（渐变两端色不同，会渲染成两种颜色）');
  eq(/font-family: 'Times New Roman', Georgia, 'Songti SC', Didot, serif/.test(CARD_WXSS), true,
    '装饰英文走衬线族');
  eq(/top: 59rpx; transform: translateY\(-50%\)/.test(CARD_WXSS), true,
    '水印与「北京之行」上下居中');
  /* 字距用 em（= 字号 × 70%），不用 rpx：em 自带「相对字号」的语义，
     以后调字号字距自动跟着走；写死 21rpx 会脱钩。 */
  eq(/\.sm-mark-ch \{ margin-left: \.7em; \}/.test(CARD_WXSS), true,
    '水印字距 = 字号 × 70%（em 单位，不用绝对值）');
  eq(/\.sm-mark \{[^}]*opacity: \.28/.test(CARD_WXSS), true,
    '水印不透明度 .28（2026-09-21 由 .55 再降一半）');
  eq(/\.sm-name \{[^}]*font-size: 38rpx/.test(CARD_WXSS), true, '标题字号小一号（42→38rpx）');
  eq(/color: #EAD9A8/.test(CARD_WXSS), true, '正文统一取 #EAD9A8（北京之行以下）');
  /* 右侧比例 N/M：**整行同一字号、同一颜色、都不加粗**。
     之前是分子 36rpx/700/白色、分母 26rpx/浅色——那让一个"读数"看起来像两个东西。 */
  const numRules = ['.sm-num-done', '.sm-num-sep', '.sm-num-total'].map(c =>
    (new RegExp('\\' + c + ' \\{[^}]*\\}').exec(CARD_WXSS) || [''])[0]);
  eq(numRules.every(r => /font-weight: 400/.test(r)), true, 'NP/M 都不加粗');
  /* 字号**不要求相同**：分子 15px(28rpx) 是读数主体，分母与斜杠 11px(21rpx) 是陪衬。
     要求的是「同色、都不加粗」以及**基线上对齐**（否则分子会往下坠）。 */
  eq(/\.sm-num-done \{[^}]*font-size: 28rpx/.test(CARD_WXSS), true, '分子 15px（28rpx）');
  eq(/\.sm-num-total \{[^}]*font-size: 21rpx/.test(CARD_WXSS), true, '分母 11px（21rpx）');
  eq(/\.sm-num-sep \{[^}]*font-size: 21rpx/.test(CARD_WXSS), true, '斜杠与分母同字号');
  eq(/\.sm-progress-num \{[^}]*align-items: baseline/.test(CARD_WXSS), true,
    '分子分母按基线对齐（字号不同才不会错位）');
  eq(numRules.every(r => /color: #EAD9A8/.test(r)), true, 'N 与 M 同色');
  eq(/font-weight: 700/.test(CARD_WXSS.match(/\.sm-num[^}]*\}/g).join('')), false,
    '比例区没有任何一处加粗');

  /* 卡内纵向节奏统一 8rpx（设计 4px），目标是紧凑 */
  eq(/\.sm-meta \{[^}]*margin-top: 4rpx/.test(CARD_WXSS), true, '标题→日期段 4rpx（设计 2px）');
  /* ⚠️ 高度守恒：上面两处收紧让出多少，「门票搞定」的 margin-top 就得补回多少，
     否则卡片会矮一截、胶囊整体上移——而用户要的是「胶囊相对位置不变、卡高不变」。 */
  eq(/\.sm-progress \{ margin-top: 22rpx; \}/.test(CARD_WXSS), true,
    '门票搞定上方的 22rpx 是高度补偿（4+10 让出的量补回来）');
  eq(/\.sm-progress-row \{[^}]*margin-bottom: 4rpx/.test(CARD_WXSS), true,
    '进度条紧贴「门票搞定」4rpx');
  eq(/\.sm-pills \{[^}]*margin-top: 20rpx/.test(CARD_WXSS), true, '进度模块→胶囊 20rpx（设计 10px）');
  eq(/\.sm-pills--after-free \{ margin-top: 16rpx; \}/.test(CARD_WXSS), true,
    '有免预约文案时，胶囊上间距再减少 4rpx（约 2px）');
  /* ⚠️ 补偿量：.sm-pills 吃掉的量加到 .sm-free 上，保证**净高不变**、
     免预约行与胶囊各自位置不动。改一处必须改另一处。 */
  eq(/\.sm-free \{[^}]*margin-top: 16rpx/.test(CARD_WXSS), true,
    '「另有 X 处景点无需预约，随到随玩」的 16rpx 含补偿量');
  eq(/margin: 0 0 24rpx/.test(CARD_WXSS), true,
    '卡片满宽：与下方「10月2日 · 周五」分段标题同一左边缘');
  eq(/tripMetaLine/.test(CARD_JS), true, '日期段与倒计时走同一条 tripMetaLine（同一行）');
  eq(/tripCountdownTextOf/.test(CARD_JS), true,
    '摘要卡用**行程级**倒计时（进行中显示「进行中第N天」，不是「就是今天」）');
  eq(/tripWatermark/.test(CARD_JS), true, '右上角装饰英文由 util.tripWatermark 生成');
  eq(/class="sm-mark"/.test(CARD_WXML), true, '水印渲染在卡片上');
  eq(/tripDisplayName/.test(CARD_JS), true, '标题走 tripDisplayName（北京 10.2-10.4 → 北京之行）');


  /* 服务端拼文案，且**不带「还有 N 分钟」** */
  const TASK_JS = fs.readFileSync(path.join(ROOT, 'cloudfunctions/reminder/lib/task.js'), 'utf8');
  const ITEM_JS = fs.readFileSync(path.join(ROOT, 'cloudfunctions/reminder/lib/item.js'), 'utf8');

  const spotsSeed = require('../data/spots.json').spots;
  const junbo = spotsSeed.find(s => s.spotId === 'junbo') || {};
  eq(junbo.shortName, '军博', '军博胶囊使用民间简称「军博」');
  /* 同一**时刻**的多条提醒合成一颗胶囊：用户盯的是「几点该动手」，
     17:00 城楼和国博同时放票是一次行动，拆成两颗既占宽又像要分头去抢。
     ⚠️ limit 数的是时间点不是项数——同刻 3 个景点仍只占 1 颗。 */
  const pillSrc = (/function buildReleasePills[\s\S]*?\n\}/.exec(TASK_JS) || [''])[0];
  eq(/const groups = new Map\(\)/.test(pillSrc), true, '按放票时刻分组');
  eq(/join\('\/'\)/.test(pillSrc), true, '同刻多个景点用 / 连接');
  eq(/slice\(0, limit\)/.test(pillSrc), true, '先分组再取前 limit 组（数的是时间点）');
  eq(/nearest: i === 0/.test(pillSrc), true, '第一颗标记 nearest（排序后的最近一场）');
  eq(/function buildReleasePills/.test(TASK_JS), true, '服务端提供 buildReleasePills');

  /* ⚠️ 胶囊必须用**简称**：它是窄容器，「中国工艺美术馆·非遗馆」这种全名会把
     胶囊撑成两行、把摘要卡拉高——这正是加简称字段要解决的问题。
     行程项卡等宽处继续用全名（用户要认门牌），两者别搞反。 */
  eq(/sorted\.map\(x => x\.spotShort \|\| x\.spotName \|\| ''\)/.test(TASK_JS), true,
    '胶囊用简称（无简称回退全名）');
  eq(/spotShort: spot \? \(spot\.shortName \|\| spot\.name\)/.test(ITEM_JS),
    true, 'decorateItem 下发 spotShort（短名缺省回退全名）');
  eq(/spotName: spot \? spot\.name: '未知景点'|spotName: spot \? spot\.name/.test(ITEM_JS),
    true, 'spotName 仍是全名（宽处用，不受简称影响）');
  const pillFn = (/function buildReleasePills[\s\S]*?\n\}/.exec(TASK_JS) || [''])[0];
  /* ⚠️ 剥掉注释再查：函数上方的说明里天然会出现「放票时刻」这类词，
     直接对全文 grep 会把解释当成残留（本次就踩到了）。 */
  eq(/放票/.test(codeOf(pillFn)), false, '胶囊文案不带「放票」二字（语义已由胶囊本身表达）');
  eq(/还有.*分钟/.test(codeOf(pillFn)), false, '胶囊文案不带「还有 N 分钟」');

  /* 吸顶横幅本身：文案也不得带「还有 N 分钟」（设计稿 UI/V.0.2-0919 确认） */
  const bannerAt = TASK_JS.indexOf('function buildReleaseBanner');
  const bannerFn = TASK_JS.slice(bannerAt, TASK_JS.indexOf('function buildReleasePills'));
  eq(/还有\$\{minutesLeft\}分钟/.test(bannerFn), false, '横幅文案不再带「还有 N 分钟」');
  eq(/分钟/.test(bannerFn.replace(/\/\*[\s\S]*?\*\//g, '')), false,
    '横幅实现里（剥掉注释后）也不再出现「分钟」字样');
}

console.log('=== 5. 删除只到「天」为止，整趟行程的删除入口已移除 ===');
{
  /* 用户口径（2026-09-21）：不需要整个行程级别的删除，只有天级别的删除。
     三层动线的第三层「行程删除」本来就由服务端在空行程时自动收尾
     （前端读 tripRemoved），所以只需保证 UI 上没有整趟删除的入口。 */
  const SECTION_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxml'), 'utf8');
  const SECTION_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.js'), 'utf8');
  eq(/ts-manage/.test(SECTION_WXML), false, '行程分段标题右侧不再有「行程管理」入口（与摘要卡重复）');
  eq(/onManage/.test(SECTION_JS), false, 'trip-section 不再抛 manage 事件');
  eq(/bind:manage/.test(WXML), false, '首页不再监听 manage');
  eq(/manage=1/.test(JS), false, 'home.js 不再跳 add-trip?manage=1（add-trip 也从没读过它）');
  eq(/\?manage=1|'manage'/.test(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/add-trip/add-trip.js'), 'utf8')),
    false, 'add-trip 里没有 manage 的残留');

  /* 卡片菜单里那条删的是**一个行程项**，文案不能写成「删除行程」——那会让人
     以为整趟都要没了。 */
  const CARD_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  eq(/删除这天/.test(CARD_WXML), true, '行程项菜单文案为「删除这天」');
  eq(/>删除行程</.test(CARD_WXML), false, '行程项菜单不再写「删除行程」');

  /* 删除后的提示同理：用户删的是一条/一天，服务端顺手清掉空行程也不该说「行程已删除」 */
  eq(/tripRemoved \?/.test(JS), false, '删除提示不再分叉到「行程已删除」');
  eq(/已删除当天/.test(JS), true, '删当天仍回「已删除当天」');
}

console.log('=== 6. 行程分段标题：摘要卡那趟不渲染，未来行程必须有 ===');
{
  /* 用户口径（2026-09-21）：顶部行程卡展示的是最近即将发生或正在发生的行程，
     所以**摘要卡那一趟**的标题行是重复的，不要；但后面还没发生的行程**要有**标题行——
     摘要卡没覆盖它们，没有标题行就会塌成一堆裸日期，读不出「这是独立的一段、到哪结束」。
     ⚠️ 这里绕过一次：我先把它一刀切删过，连未来行程的也删了。别再来一次。
     「未来行程」那行小字是摘要卡上的**指路**，不是标题行的替代品（没进度、无分段边界）。 */
  const SECTION_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxml'), 'utf8');
  const SECTION_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.js'), 'utf8');
  const SECTION_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxss'), 'utf8');

  eq(/wx:if="\{\{!weak\}\}"\s+class="ts-head"/.test(SECTION_WXML), true,
    '标题行存在，且由 !weak 把关（不是一刀切删掉）');
  eq(/ts-city/.test(SECTION_WXML) && /ts-range/.test(SECTION_WXML) && /ts-progress/.test(SECTION_WXML),
    true, '标题行含 城市 + 日期段 + 进度');
  eq(/\.ts-head \{[^}]*\}/.test(SECTION_WXSS), true, '标题行样式在（不能只留标记）');
  eq(/progressText: p\.total > 0/.test(SECTION_JS), true, '组件重新计算进度文案');
  eq(/daysPast: util\.pastDaysOf\(visitDate\)/.test(SECTION_JS), true,
    '首页行程墙日期标题计算已过去天数');
  eq(/ts-day-past-note/.test(SECTION_WXML), true, '首页行程墙日期标题渲染已过去备注');
  eq(/\.ts-day-past-note\s*\{[^}]*font-size:\s*20rpx/.test(SECTION_WXSS), true,
    '首页已过去备注使用辅助字号');

  /* 谁 weak：只看「是不是摘要卡那趟」。判断放页面（_weak），不在模板里数 index——
     模板内置计数器一加 wx:if 就会静默错位。 */
  eq(/_weak: !!isPrimary/.test(JS), true, '_weak 按「是不是 trips[0]」算');
  eq(/weak="\{\{trip\._weak\}\}"/.test(WXML), true, '页面把 _weak 传给分段');
  eq(/weak="\{\{trips\.length === 1\}\}"/.test(WXML), false,
    '不再按「行程总数」判 weak——那会把未来行程的标题一起弱化掉');

  /* 已废止且不得复活：分段吸顶（含占位）与「行程管理」入口 */
  eq(/ts-spacer|ts-manage/.test(SECTION_WXML + SECTION_WXSS), false, '无吸顶占位、无行程管理入口');
  eq(/sticky|headHeight/.test(codeOf(SECTION_JS)), false, 'trip-section 不再声明吸顶属性');
  eq(/measureSections/.test(codeOf(JS)), false, 'home.js 不再调 measureSections（滚动空跑查询已删）');
  eq(/boundingClientRect/.test(codeOf(JS)), false, 'home.js 不再做吸顶测位');
  eq(/sticky=|head-height=/.test(WXML), false, 'home.wxml 不再下传吸顶属性');

  eq(/<view class="trip-section/.test(SECTION_WXML), true, '分段容器本身保留（日期分组还在）');
  eq(/wx:for="\{\{days\}\}"/.test(SECTION_WXML), true, '日期分段与行程项卡不受影响');
  eq(/\.filter\(it => it\.visitDate === visitDate\)[\s\S]*?\.map\(it => it\.itemId\)/.test(SECTION_JS), true,
    '删除当天时收集该日期全部 itemId');
  eq(/removeVisitDate\(\{ tripId, visitDate, itemIds \}\)/.test(JS), true,
    '删除当天把完整 itemId 列表传给云函数');

  /* 日期菜单的键：页面与组件各算一次，**必须逐字一致**，
     否则点日期标题右侧的菜单不展开（静默失效，不报错）。 */
  eq(/menuOpen: menuDate === visitDate/.test(SECTION_JS), true, '组件侧菜单键 = visitDate');
  eq(/const key = e\.detail\.visitDate;/.test(JS), true, '页面侧菜单键 = visitDate（与组件一致）');
}

console.log('=== 7. 行程项卡不再显示难约程度标签 ===');
{
  /* 用户口径（2026-09-21）：首页行程墙上的单个行程项去掉难约标签。
     它在选景点的地方（spots 列表 / 景点浮窗 / add-trip 时间线）仍有价值，
     那里正是按难易挑景点的时候；但行程项是**一次具体出行**，
     「故宫 较难约」不会因为这趟行程而变，卡上重复出现只是噪音。
     ⚠️ 光删模板不够：`item.difficulty` 仍会下发，`.tc-diff` 样式也会变成孤儿。 */
  const CARD_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  const CARD_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxss'), 'utf8');
  eq(/tc-diff/.test(CARD_WXML), false, '行程项卡不再渲染难约标签');
  /* ⚠️ 先剥注释再查样式：wxml 里「说明删了什么」的注释本身就含这个词，
     直接对全文 grep 会把解释当成残留。 */
  eq(/tc-diff/.test(codeOf(CARD_WXSS)), false, '难约标签样式已一并删除（不留孤儿）');
  /* 同屏其它入口不受影响——删干净 ≠ 删过头 */
  const SPOTS_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spots/spots.wxml'), 'utf8');
  const ADDTRIP_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/add-trip/add-trip.wxml'), 'utf8');
  eq(/spot-card-diff/.test(SPOTS_WXML), true, '景点列表仍显示难约标签（选景点的地方）');
  eq(/event-diff/.test(ADDTRIP_WXML), true, '新增提醒的时间线仍显示难约标签');
}

console.log('=== 8. 行程项卡的提醒状态（四态上卡）与菜单显示条件 ===');
{
  /* ⚠️ **本节 2026-09-22 整体反转**，别照着旧版本改回去。
     09-21 的口径是「卡上不显示提醒标签」，理由是「提醒是否已设是操作结果，
     与摘要卡胶囊重复」。该理由**只对 `WAITING` / `TRIGGERED` 成立**：
       - `NOT_SET` 是**打开提醒的唯一入口**——旧条件下它永远不显示，
         而重加会被 cart.add 的跨行程去重拦住，是条死胡同；
       - `MISSED` 是决策文档 §五 明文强制的异常信号（「不得只藏在菜单里」）。
     所以 09-22 恢复四态，两个缺口一起补。本节从此**正向**锁住它。 */
  const CARD_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  const CARD_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxss'), 'utf8');
  const CARD_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.js'), 'utf8');

  /* ① 提醒 chip 存在，且样式类**由 state 推导**（不是由文案推导） */
  eq(/tc-remind/.test(CARD_WXML), true, '卡片渲染提醒状态 chip');
  eq(/tc-remind/.test(codeOf(CARD_WXSS)), true, '提醒 chip 有对应样式');
  eq(/alert-circle/.test(CARD_WXML), true, '未送达保留警告形状图标');
  eq(/alert-circle-muted/.test(CARD_WXML), false, '未送达图标不再使用弱化色，改用警告色提高可见性');
  eq(/\.tc-remind-miss\s*\{[^}]*border:\s*1rpx solid var\(--reminder-miss-border\)/.test(codeOf(CARD_WXSS)), true,
    '未送达增加浅描边');
  eq(/\.tc-remind-miss\s*\{[^}]*color:\s*var\(--reminder-miss-text\)/.test(codeOf(CARD_WXSS)), true,
    '未送达文字加深');
  eq(/\.tc-remind-miss\s*\{[^}]*background:\s*var\(--chip-red-bg\)/.test(codeOf(CARD_WXSS)), false,
    '未送达不改红底，避免与票务轴混色');
  eq(/reminderClass/.test(codeOf(CARD_JS)), true, '样式类由 state 推导（reminderClass）');
  /* 文案必须取服务端 stateLabel —— 四态文案的**唯一真身**在云端 REMINDER_STATE_LABEL，
     前端自己拼一套必然漂 */
  eq(/reminder\.stateLabel/.test(codeOf(CARD_JS)), true, 'chip 文案取服务端 stateLabel');
  eq(/已设提醒/.test(codeOf(CARD_WXML) + codeOf(CARD_JS)), false,
    '正文不得出现「已设提醒」（同时指 WAITING 与 TRIGGERED，歧义）');

  /* ② 免预约项不渲染提醒 chip（它恒为 NOT_SET 且没有提醒可言，
        同一张卡上不该同时出现「免预约」与提醒 chip） */
  eq(/reservationRequired !== false/.test(CARD_WXML), true, '免预约项无提醒 chip');

  /* ②' 提醒 chip **与景点名同一行**（决策文档 3.4 的明文位置：「紧跟景点名右侧」）。
        ⚠️ 2026-09-22 首次落地时它被写在名字行**下方**——`.tc-title` 是 column，
           chip 是 `.tc-name-row` 的兄弟节点，读起来像第二行副标题。本轮移进行内。
        这里锁的是**DOM 结构**不是视觉：`关闭 .tc-name-row 之前必须已经渲染 chip`。
        断言方式对 wxml 做括号配平扫描，而不是正则——正则跨不过嵌套的同名标签。 */
  const rowOpen = CARD_WXML.indexOf('<view class="tc-name-row">');
  eq(rowOpen > -1, true, '名字行存在');
  {
    let depth = 0, closeAt = -1;
    const re = /<\/?view\b[^>]*?(\/?)>/g;
    re.lastIndex = rowOpen;
    let m;
    while ((m = re.exec(CARD_WXML))) {
      if (m[1] === '/') continue;                    // 自闭合 <view ... /> 不改变层级
      depth += m[0][1] === '/' ? -1 : 1;
      if (depth === 0) { closeAt = m.index; break; }
    }
    const chipAt = CARD_WXML.indexOf('class="tc-remind');
    eq(closeAt > -1, true, '名字行能配平（结构没写坏）');
    eq(chipAt > -1 && chipAt < closeAt, true, '提醒 chip 在名字行内部（与景点名同行）');
  }
  /* 名字行现在装着「名字 + chevron + chip」三个元素，6rpx 的 gap 会让 chip 贴着 chevron */
  eq(/\.tc-name-row\s*\{[^}]*gap:\s*12rpx/.test(codeOf(CARD_WXSS)), true, '名字行 gap 已放宽到 12rpx');
  /* 空壳容器不留：`.tc-title` 只剩一个子节点后就是纯透传，留着会误导下一个人 */
  eq(/\.tc-title\s*\{/.test(codeOf(CARD_WXSS)), false, '.tc-title 空壳已删');

  /* ②'' 景点名的下划线**与文字同色**。
        原来写死 `text-decoration-color: var(--color-primary)`（朱砂），黑字配红下划线
        在行程墙上一屏出现七八次，密集处像一排报错。设计稿是同色下划线。
        用 `currentColor` 而不是重复写一遍 `--text-strong`：换颜色时不会漏改一处。 */
  eq(/text-decoration-color:\s*currentColor/.test(codeOf(CARD_WXSS)), true,
    '名字下划线跟文字同色（currentColor）');
  eq(/text-decoration-color:\s*var\(--color-primary\)/.test(codeOf(CARD_WXSS)), false,
    '不再写死朱砂下划线');

  /* ③ 未送达**整块可点**，且事件真的抛得出去。
        这是全卡唯一能触达 onMissedReason 的入口，断了 = 静默失败重新发生。 */
  eq(/bindtap="onMissedTap"/.test(CARD_WXML), true, '未送达 chip 可点');
  eq(/onMissedTap/.test(CARD_JS), true, '有点击处理器');
  eq(/triggerEvent\('missedreason'/.test(CARD_JS), true, '真的抛 missedreason 事件');
  eq(/reason/.test(CARD_JS), true, 'payload 带 reason（页面靠它区分 43101 / 密钥缺失 / 兜底）');

  /* ④ 菜单各项**各带显示条件**，不是固定几项。
        平铺会让开票前出现「标记结果」这种点不动的死按钮（服务端 canMark=false 直接拒）。 */
  eq(/item\.canMark/.test(CARD_WXML), true, '标记结果按 canMark 显示');
  /* ⚠️ 2026-09-23 改口径：原先两项互斥的「设置提醒 / 修改提醒」合并成**一项按态直出**
     （「开启提醒 / 取消提醒」）。「修改」这个名字从没兑现过——点开只有一个开关，
     改不了提前量、更改不了出行日期（改日期走「约其他日」）。 */
  eq(/item\.canSetReminder/.test(CARD_WXML), true, '提醒开关按服务端 canSetReminder 显示');
  eq(/reminderClass === 'none' \? '开启提醒' : '取消提醒'/.test(CARD_WXML), true,
    '文案按提醒态直出「开启提醒 / 取消提醒」');
  /* ⚠️ 反向锁：放票后这两个动作都没有意义（开启会即刻 MISSED、取消是空转），
     判据因此**不能**是 ticketState —— 清单先加、放票后才提交的项是可抢票态却也需要入口。
     更不许把旧的两项名字写回来（它们是这次要消灭的歧义源）。 */
  eq(/设置提醒|修改提醒/.test(CARD_WXML.replace(/<!--[\s\S]*?-->/g, '')), false,
    '「设置提醒 / 修改提醒」两个旧名字不得复活');
  eq(/ticketState === 'PENDING'/.test(CARD_WXML.replace(/<!--[\s\S]*?-->/g, '')), false,
    '提醒入口不得按 ticketState 判定（会漏掉「清单先加、放票后才提交」那一档）');
  eq(/item\.result === 'FAILED' && recoverable/.test(CARD_WXML), true,
    '「约其他日」要求没抢到 **且** 服务端确实算出候选（无候选时是空转建议）');
  eq(/删除这天/.test(CARD_WXML), true, '删除项文案是「删除这天」而非「删除行程」');

  /* ⑤ 反向锁：旧实现与死代码不得复活 */
  eq(/tc-recover/.test(codeOf(CARD_WXSS)), false, '独立挽回行已删（并入气泡），不留孤儿');
  eq(/onMenuToggleClick/.test(codeOf(CARD_JS)), false, '死方法 onMenuToggleClick 已删');
  eq(/onReminderTap/.test(CARD_JS), false, '死掉的 onReminderTap 已删除');
  /* ⚠️ **必须剥掉 HTML 注释再断言**（codeOf 只处理反斜杠星号块注释与双斜杠行注释，
     不管 HTML 注释）。本次在模板顶部写了大段「为什么去掉放票二字」的说明，
     不剥就会把解释当成残留 —— 这正是「测试把注释当代码」的老坑。 */
  const wxmlCode = CARD_WXML.replace(/<!--[\s\S]*?-->/g, '');
  eq(/放票/.test(wxmlCode), false, '副行不再有「放票」二字（语义交给尾巴表达）');
}

console.log('=== 8.1 副行尾巴：文案与色调的分支 ===');
{
  /* `releaseRemainderOf` 的全部判断都收在这里，WXML 只拼色类
     （WXML 不能调方法，在模板里写判断会静默失效）。 */
  const util = require(path.join(ROOT, 'miniprogram/utils/util.js'));
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const past = new Date(Date.now() - 3600000).toISOString();
  const base = { reservationRequired: true, ticketState: 'PENDING', reminder: { state: 'NOT_SET' } };

  eq(util.releaseRemainderOf(Object.assign({}, base, { releaseAt: future })).text, '· 还有3天',
    '待抢 → 距放票还剩 N 天');
  eq(util.releaseRemainderOf(Object.assign({}, base, { releaseAt: future })).tone, 'muted', '倒计时是中性色');
  eq(util.releaseRemainderOf(Object.assign({}, base, { ticketState: 'BOOKABLE', releaseAt: past })).text,
    '· 现在预约 ›', '可抢 → 现在预约');
  eq(util.releaseRemainderOf(Object.assign({}, base, { ticketState: 'BOOKABLE', releaseAt: past })).tone,
    'go', '行动文本用绿色');
  eq(util.releaseRemainderOf(Object.assign({}, base, { ticketState: 'SUCCESS', releaseAt: past })).text,
    '· 已约', '已成 → 已约');
  /* ⚠️ 未抢到的尾巴是**「现在预约 ›」不是「约其他日 ›」**（2026-09-24 订正断言）：
     票已经放出来了，那天本来就还有票可抢，副行说这件事才对；「约其他日」是
     另一条动线（换成期），由卡片底部的挽回气泡 + 菜单承担，不该挤进放票行。
     这条断言一度停在旧实现上，与 `util.js` 改了词之后就没再对齐过。 */
  eq(util.releaseRemainderOf(Object.assign({}, base, { ticketState: 'FAILED', releaseAt: past })).text,
    '· 现在预约 ›', '未成 → 仍可抢票（挽回不挤进放票行）');
  eq(util.releaseRemainderOf(Object.assign({}, base, { ticketState: 'UNMARKED', releaseAt: past })).text,
    '· 现在预约 ›', '待确认 → 仍可抢票');
  /* ⚠️ 还没到点但 releaseAt 已经过去（放票时刻落在过去），不能显示「还有-1天」 */
  eq(util.releaseRemainderOf(Object.assign({}, base, { releaseAt: past })).text,
    '· 现在预约 ›', 'releaseAt 已过时不显示负数天数');

  /* ⚠️ **MISSED 压过一切**：提醒没送到是唯一会真正伤到用户的状态，
     被「现在预约」盖掉等于把静默失败藏起来。 */
  eq(util.releaseRemainderOf(Object.assign({}, base, {
    ticketState: 'BOOKABLE', releaseAt: past, reminder: { state: 'MISSED' },
  })).text, '· 未送达', '未送达优先于票务态（哪怕正在可抢）');

  /* 免预约项不显示尾巴，副行整句由 releaseLineOf 给 */
  eq(util.releaseRemainderOf({ reservationRequired: false }).text, '', '免预约不显示尾巴');
  eq(util.releaseLineOf({ reservationRequired: false }), '无需预约 · 随到随玩', '免预约主文本不变');

  /* 绿色「现在预约」必须是可点击入口，且继续受 bookingEntryEnabled 闸门控制。 */
  const CARD_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  const CARD_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.js'), 'utf8');
  const CARD_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxss'), 'utf8');
  eq(/bindtap="onRemainTap"/.test(CARD_WXML), true, '现在预约文字已绑定点击事件');
  eq(/onRemainTap\(\)[\s\S]*?bookingEntryEnabled === false/.test(CARD_JS), true,
    '现在预约点击受 bookingEntryEnabled 闸门控制');
  eq(/source: 'booking_entry'/.test(CARD_JS), true, '点击后按预约入口来源打开景点详情');
  eq(/\.tc-sub-tail-go\.is-action:active/.test(CARD_WXSS), true, '现在预约有按压反馈');
}

console.log('=== 9. 行程级倒计时文案（进行中第N天）===');
{
  /* 用户口径（2026-09-21）：摘要卡副标题在进行中要显示「进行中第N天」，
     而不是景点级的「就是今天」（那句话是给行程项卡的放票行配的）。
     ⚠️ **行程级与景点级是两套文案，别合并**：行程项卡说「第3天」很怪
     （用户看的是"这个景点哪天去"），摘要卡说「就是今天」又浪费
     （那是他此刻正身在其中那一趟，告诉他第几天更有用）。 */
  const util = require(path.join(ROOT, 'miniprogram/utils/util.js'));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const D = n => iso(new Date(Date.now() + n * 86400000));

  eq(util.tripCountdownTextOf(D(9), D(12)), '还有9天', '未开始：还有N天');
  eq(util.tripCountdownTextOf(D(0), D(3)), '进行中第1天', '出发当天 = 第1天');
  eq(util.tripCountdownTextOf(D(-2), D(1)), '进行中第3天', '第N天按自然日推');
  eq(util.tripCountdownTextOf(D(-3), D(0)), '进行中第4天',
    '⚠️ 最后一天仍属进行中（与服务端 activeTrips 的 endDate >= today 同口径）');
  eq(util.tripCountdownTextOf(D(-5), D(-1)), '已结束', '结束日次日才结束');
  eq(util.tripCountdownTextOf(D(0), D(0)), '进行中第1天', '单日行程当天 = 第1天');

  /* ⚠️ 2026-09-22 起行程项卡的副行**不再用它**（改成「距放票」的 releaseRemainderOf），
     全仓只剩这里在断言。**函数本身保留**：它是「距出行日」这套日历口径的唯一真身，
     未来若要显示出行倒计时（如详情浮窗）直接复用，别在调用方另写一份天数算法。 */
  eq(util.countdownTextOf(D(0)), '就是今天', '距出行日文案：当天');
  eq(util.countdownTextOf(D(-3)), '已结束', '距出行日文案：已过');
}

console.log('=== 10. 组件抛出的事件，页面必须都接上了 ===');
{
  /* 用户报的三个「点了没反应」是**同一个根因**：组件 triggerEvent 了，
     但页面 WXML 漏了对应的 bind:，于是彻底静默——不报错、不提示、查日志也没线索。
     `npm run check` 只能查出「bind 的方法不存在」，查不出「组件抛了但没人听」，
     所以这里对着组件的 triggerEvent 清单逐个核对。 */
  const HOME_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  /* ⚠️ 只取 <trip-section …/> 那一块：首页别处（release-banner / date-picker-sheet 等）
     也有同名事件，混在一起会误判。 */
  const secTag = (/<trip-section[\s\S]*?\/>/.exec(HOME_WXML) || [''])[0];
  eq(secTag.length > 0, true, '找到了 trip-section 标签块');

  /* trip-section 会向页面抛的全部事件（见其 triggerEvent 调用） */
  const SECTION_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.js'), 'utf8');
  /* 剥注释再提取：注释里会提到已删除的事件名（本次就踩到） */
  const thrown = [...new Set([...codeOf(SECTION_JS).matchAll(/triggerEvent\('([a-z]+)'/g)].map(m => m[1]))];
  const unbound = thrown.filter(ev => !new RegExp('bind:' + ev + '=').test(secTag));
  eq(unbound.join(','), '', 'trip-section 抛出的事件全部已绑定' + (unbound.length ? '（漏：' + unbound.join(',') + '）' : ''));

  /* 卡片三点菜单的开合与「编辑提醒」必须是**两个事件**：
     合成一个的话页面只能接一头，另一头必然静默失效。 */
  const CARD_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.js'), 'utf8');
  eq(/triggerEvent\('menutoggle'/.test(CARD_JS), true, '卡片的菜单开合抛 menutoggle');
  eq(/triggerEvent\('editreminder'/.test(CARD_JS), true, '「修改提醒设置」抛 editreminder（两个语义不共用事件名）');
  eq(/triggerEvent\('recover'/.test(CARD_JS), true, '「约其他日」抛 recover（页面 bind:recover 已接）');

  /* 日期菜单的文字不能是红色 */
  const SECTION_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxss'), 'utf8');
  const itemRule = (/\.ts-day-pop-item \{[^}]*\}/.exec(SECTION_WXSS) || [''])[0];
  eq(/color: var\(--color-text\)/.test(itemRule), true, '日期下拉菜单文字用正文色（不是红）');
  eq(/#C0392B/.test(itemRule), false, '菜单条目本身不写红色');

  /* ⚠️ 横幅**必须留在文档流里**（曾经是 fixed 的「吸顶横幅」，见第 11 节）：
     fixed 的横幅不占位，页面得靠给内容加 padding 去躲它，而那个 padding
     依赖机型相关的导航栏高度——所以「挡住行程卡」当初是必然，不是偶然。 */
  const HOME_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');
  const bRule = (/\.sticky-banner \{[^}]*\}/.exec(HOME_WXSS) || [''])[0];
  eq(/position:\s*fixed/.test(bRule), false, '横幅不是 fixed（在文档流里，跟着内容一起滚）');
  eq(/class="sticky-banner \{\{showReminderQuotaWarning \? 'sticky-banner--after-warning' : ''\}\}"/.test(HOME_WXML), true,
    '横幅在模板里是普通节点（不带内联 top），并识别额度预警前置态');
}

console.log('=== 11. 顶部布局：横幅在文档流里 / 标题下沿对齐 / 卡片右列 ===');
{
  /* 用户 2026-09-22 报的三个问题，根因是同一个：**横幅曾经是 `position: fixed`**。
     fixed 元素不占文档流，于是「不被它压住」只能靠给内容加 padding 去凑，
     而页面的 padding 又依赖导航栏高度（机型相关）—— 只要那一项算偏，
     卡片就被压住。间距同理：横幅与卡片不在同一个坐标系里，怎么凑都是巧合。
     如今横幅回到文档流，位置关系变成三条 CSS 声明，任何一条都能单独验证。 */
  const WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxss'), 'utf8');

  const bannerRule = (/\.sticky-banner \{[^}]*\}/.exec(WXSS) || [''])[0];
  /* ⚠️ 2026-09-28：顶部基准已直接对齐标题下沿，横幅不再用负 margin 抵消留白。
     这里同时锁住「没有下间距」和「没有残余上移补偿」，避免旧口径复活。 */
  eq(bannerRule.length > 0, true, '找得到 .sticky-banner 规则');
  eq(/position:\s*fixed/.test(bannerRule), false,
    '横幅**不是** fixed（回到文档流，跟着内容一起上滑）');
  eq(/margin-bottom|margin:\s*0 0/.test(bannerRule), false,
    '横幅与摘要卡之间不留间距（2026-09-23 用户口径：别再给 margin-bottom）');
  eq(/margin-top:\s*0/.test(bannerRule), true,
    '横幅与标题下沿直接对齐，不再通过负 margin 抵消留白');

  /* ⚠️ 导航栏是 fixed、不占文档流 → **正文必须自己让出它的高度**，
     否则第一块内容（加了横幅时就是横幅）会钻到标题底下被盖住。
     这一条曾经漏过，改完当场就是「横幅看不见」。 */
  eq(/class="page-body" style="padding-top: \{\{pageTop\}\}rpx;"/.test(WXML), true,
    '正文让出导航栏高度（否则内容钻到标题底下）');
  /* ⚠️ 基准是**标题下沿**，不是导航块底边：导航块 88rpx 是给胶囊留的高度，
     标题在它里面居中，底边到标题下沿还空着 (88−45)/2 ≈ 21.5rpx。
     按底边算实测 20.1px —— 用户看到的就是「间隔太大」（2026-09-23 报的）。 */
  eq(/const titleInset = \(NAV_BAR_RPX - NAV_TITLE_RPX\) \/ 2;/.test(JS), true,
    'pageTop 减掉的是导航块比标题高出来的一半（居中内缩）');
  eq(/return \(statusBarHeight \|\| 20\) \* 2 \+ NAV_BAR_RPX \+ PAGE_GAP_RPX - titleInset;/.test(JS), true,
    'pageTop = 状态栏(px→rpx) + 导航块 − 内缩 = 标题下沿');
  eq(/const PAGE_GAP_RPX = 0;/.test(JS), true,
    '正文直接与标题下沿对齐');
  eq(/const NAV_TITLE_RPX = 45;/.test(JS), true,
    '标题行高 45rpx（30rpx × page line-height 1.5）');
  /* ⚠️ 但**不能**把横幅高度也让进去：横幅就在正文里，占位它自己负责，
     再让一次就是双倍空白（上一版 fixed 时代就是这么写的）。 */
  eq(/BANNER_RPX|bannerTop|topOffsets/.test(WXML + JS), false,
    '「让出横幅高度」那套偏移计算没有复活（fixed 时代的东西）');
  /* 正文与横幅都在 .page-body 里，横幅不能再自己留左右白 */
  const bodyStart = WXML.indexOf('class="page-body"');
  const bannerStart = WXML.indexOf('<view wx:if="{{banner}}" class="sticky-banner');
  eq(bannerStart > bodyStart && bannerStart > 0, true, '横幅排在 .page-body 内部');
  const quotaWarningStart = WXML.indexOf('class="quota-warning-banner"');
  eq(quotaWarningStart > bodyStart && quotaWarningStart < bannerStart, true,
    '额度预警排在放票横幅上方（行动优先级更高）');
  eq(/onQuotaWarningDismiss/.test(JS) && /QUOTA_WARNING_DISMISS_KEY/.test(JS), true,
    '首页额度预警支持按北京时间当天关闭');

  /* ---- ② 导航栏滚动淡入（0 → 100% 不透明度，滚 50px）----
     ⚠️ 这条动线**曾经一直没生效**，根因不在样式也不在状态：
     页面生命周期给的是 `e.scrollTop`，而原实现只读了 `e.detail.scrollTop`，
     于是滚动值恒为 0、不透明度恒为 0（Vant 的 pageScrollMixin 才用 detail 那层）。 */
  eq(/const NAV_FADE_PX = 50;/.test(JS), true, '淡入行程 50px');
  eq(/Math\.min\(1, Math\.max\(0, scrollTop \/ NAV_FADE_PX\)\)/.test(JS), true,
    '不透明度 = clamp(scrollTop / 50, 0, 1)，逐帧给值而不是切类');
  eq(/typeof d\.scrollTop === 'number'/.test(JS) && /\|\| 0\)/.test(JS), true,
    '滚动值两种事件形态都读（页面给 e.scrollTop，Vant 转发给 e.detail.scrollTop）');
  eq(/class="navbar" style="background-color: rgba\(248, 243, 234, \{\{navOpacity\}\}\);"/.test(WXML), true,
    '导航栏底色由 navOpacity 内联给出');
  eq(/navOpacity: 0,/.test(JS), true, 'navOpacity 初值 0（进页面时全透明）');
  /* ⚠️ wxss 里不能再写 background：它同优先级且后写，会把内联之外的状态锁死、
     淡入永远不发生。 */
  /* ⚠️ 先剥掉 wxss 注释再查「有没有写 background 声明」——
     说明「为什么不能写」的那句注释里天然带这个词（本轮就踩了）。 */
  const navRule = ((/\.navbar \{[^}]*\}/.exec(WXSS) || [''])[0]).replace(/\/\*[\s\S]*?\*\//g, '');
  eq(/background\s*:/.test(navRule), false,
    '.navbar 规则里不写 background 声明（否则会盖掉内联的透明度）');
  const navBarRule = (/\.navbar-content \{[^}]*\}/.exec(WXSS) || [''])[0];
  eq(/height: 88rpx/.test(navBarRule), true, '导航块 88rpx（常规 44px）');

  /* ① 横幅不能被小程序胶囊盖住「去看看」：右侧留出胶囊的宽度。
     胶囊在小程序里恒定在右上角、宽约 87px = 162rpx，所以横幅右内边距要够。 */
  eq(/\.sticky-banner \.rb \{\s*margin-bottom: 0;\s*\}/.test(WXSS), true,
    '横幅自身不带下边距（间距只算一次）');

  /* ② 「导航栏滚动变填充」为什么不做：页面在顶部**不能滚动**，
     没有回弹就没有向上的位移，`scrollTop` 恒为 0。
     这里钉住「没有残留的滚动状态」，免得半年后又有人加回来。 */
  /* 旧的 navSolid（布尔硬切）与 navOpacity 的早期写法都不能留：
     导航栏现在是**逐帧渐变**，硬切会在中间帧闪一下。 */
  /* 按**用法**查而不是按词查：WXML 的 HTML 注释不在 codeOf 的剥离范围内，
     而「别再改回 .navbar-solid 那种硬切」这句解释里就有这个词。 */
  eq(/navSolid/.test(codeOf(JS) + codeOf(WXSS)), false, 'JS/wxss 里没有 navSolid 状态');
  eq(/class="navbar \{\{/.test(WXML), false, '导航栏没有条件类绑定（已改成内联不透明度）');
  eq(/\.navbar-solid \{/.test(WXSS), false, 'wxss 里没有 .navbar-solid 规则');
  /* ⚠️ 也**没有**「滚动到 N 像素把横幅收掉」：横幅在文档流里，滑下去自己会走；
     按阈值把它摘掉会让下面的内容瞬间上跳一个横幅的高度。 */
  /* ⚠️ WXML 的 `<!-- -->` 注释不在 codeOf 的剥离范围内，这里按**属性形式**精确匹配，
     否则「解释为什么删掉它」的那句注释会被当成残留。 */
  eq(/hideBanner/.test(codeOf(JS)), false, 'JS 里没有 hideBanner 状态');
  eq(/wx:if="\{\{banner && !hideBanner\}\}"/.test(WXML), false,
    '模板里没有按滚动阈值收起横幅的绑定');
  eq(/onPageScroll\(e\) \{/.test(JS), true, 'onPageScroll 仍在（收起浮层用）');
  eq(/position: fixed/.test(WXSS), true, '页面里仍有 fixed 元素（导航栏 / tabbar / 浮层）');

  /* ③ 行程项卡：景点名小一号不加粗；票务 chip 与菜单同一行、间距 8px */
  const CARD_WXSS2 = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxss'), 'utf8');
  const CARD_WXML2 = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  const nameRule = (/\.tc-name \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/font-size: 28rpx/.test(nameRule), true, '景点名 28rpx（原 30rpx，小一号）');
  eq(/font-weight: 400/.test(nameRule), true, '景点名不加粗（原 600）');
  const rightRule = (/\.tc-right \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/flex-direction: row/.test(rightRule), true, '右列横排（票务 · 菜单同一行）');
  eq(/gap: 16rpx/.test(rightRule), true, '两者间距 8px（16rpx）：票务 chip 因此右移 8px');
  const stateAt = CARD_WXML2.indexOf('class="tc-state');
  /* 同上：菜单容器是条件类，锚点要带上尾随分隔符 */
  const menuAt = CARD_WXML2.search(/class="tc-menu[ "]/);
  eq(stateAt > 0 && stateAt < menuAt, true, '票务 chip 在前、三点菜单在后（菜单在「待抢」右侧）');

  /* ---- ④ 回填气泡按 UI/28.png 重做：**卡片内的一行**，不是彩色浮岛 ----
     设计稿里它没有底色/圆角/尖角，只有上方一条极淡的分隔线，
     提示语在左、动作在右（同一行）。这两条是这一轮返工的核心。 */
  const bubRule = (/\.tc-bubble \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/display: flex/.test(bubRule), true, '气泡是**横排**（提示语在左、动作在右同一行）');
  eq(/background/.test(bubRule), false, '气泡没有底色（不是彩色浮岛）');
  eq(/border-radius/.test(bubRule), false, '气泡没有圆角（设计稿里它没有边框盒）');
  eq(/border-top: 1rpx solid #F7F2E6/.test(bubRule), true, '只有上方一条极淡的分隔线');
  eq(/\.tc-bubble::before/.test(CARD_WXSS2), false, '尖角已删除（设计稿里没有）');
  eq(/@keyframes tc-rise/.test(CARD_WXSS2), false, '进入动画已删除（设计稿未定义）');
  /* 按**声明**查而不是按词查：app.wxss 里那句「这两个 token 已删除」的注释里就有名字。 */
  const APP_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/app.wxss'), 'utf8');
  eq(/--bubble-bg:|--bubble-text:/.test(APP_WXSS + CARD_WXSS2), false,
    '旧的 --bubble-bg / --bubble-text 定义已清掉');
  eq(/var\(--bubble-bg\)|var\(--bubble-text\)/.test(CARD_WXSS2), false,
    '没有地方还在引用它们');
  /* 主按钮是哑光金 #B8904A（--color-muted），不是朱砂红 */
  const yesRule = (/\.tc-bubble-yes \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/var\(--color-muted\)/.test(yesRule), true, '「抢到了」是哑光金（设计稿色）');
  const goRule = (/\.tc-bubble-go \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/var\(--color-muted\)/.test(goRule), true, '「约其他日」与主按钮同款（两态一套版式）');
  eq(/tc-bubble-hint|标记一下/.test(CARD_WXML2), false,
    '设计稿里没有那行副说明，已删除');
  /* 药丸的 Layout 是用户从 Figma 逐值给的：
     `display:flex; padding:6px 8px; justify-content:center; align-items:center; gap:10px;`
     换算成 rpx = padding 12rpx 16rpx / gap 20rpx。
     ⚠️ **不写死高度**：设计给的就是「上下 6px + 文字行盒」，定高会把字号和高度解耦。
     ⚠️ 上一版这里写的是 `height: 80rpx`（= 42.9px），而设计稿只有 22px —— 换算错了。 */
  const btnRule = (/\.tc-bubble-btn \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/display: flex/.test(btnRule), true, '药丸 display:flex');
  eq(/justify-content: center/.test(btnRule), true, '药丸 justify-content:center');
  eq(/align-items: center/.test(btnRule), true, '药丸 align-items:center');
  eq(/gap: 20rpx/.test(btnRule), true, '药丸 gap:10px（20rpx）');
  eq(/padding: 12rpx 16rpx/.test(btnRule), true, '药丸 padding:6px 8px（12/16rpx）');
  /* ⚠️ 用行首锚点查，不能用 `/height:/` —— `line-height: 1` 里就含这个子串。 */
  eq(/\n\s*height:/.test(btnRule), false, '药丸不写死高度（设计给的是内边距 + 行盒）');
  eq(/line-height: 1/.test(btnRule), true, '药丸行高 1：整颗 ≈ 23.6px，与设计 22px 同档');
  eq(/font-size: 22rpx/.test(btnRule), true, '药丸字号 22rpx（与徽标同档）');
  eq(/border-radius: 16rpx/.test(btnRule), true, '圆角 16rpx（设计 8px）');
  /* 「忽略」到卡片右边缘 20px：气泡的右内边距 38rpx，忽略自己不再带右边距 */
  eq(/padding: 24rpx 38rpx 24rpx 64rpx/.test(bubRule), true,
    '气泡上下 12px（Figma 的 padding 12px）、右 20px（忽略到卡片右边）');
  const skipRule = (/\.tc-bubble-skip \{[^}]*\}/.exec(CARD_WXSS2) || [''])[0];
  eq(/padding: 16rpx 0 16rpx 14rpx/.test(skipRule), true, '忽略只留左边距，右边归气泡');
}

/**
 * 两个下拉菜单的开合。
 *
 * 这条线从 2026-09-21 起报了三轮，每一轮的根因都不同，所以这里把**四条**一起钉住：
 *
 *   ① 事件名共用：组件把「开合」和「编辑提醒」抛成同一个 `menu`（09-21）。
 *   ② 事件没接上：`bind:menutoggle` / `bind:missedreason` 漏绑（09-21）。
 *   ③ 面板自己关自己：`.tc-menu-pop` / `.ts-day-pop` 上挂了 `catchtap="onMenuClose"`，
 *      而它们嵌在 `catchtap="onMenuToggle"`（开合）的容器**内部** ——
 *      点面板任意位置 = 先关再开，菜单弹不出来；日期菜单更狠，「删除当天行程」
 *      的动作被自己的关闭抢先截胡。同时两处**根本没有捕获层**（09-23 上）。
 *   ④ **唯一入口只有 52rpx 的图标，展开后被自己的全屏蒙层埋掉**（09-23 本轮真因）：
 *      `.tc-menu` 只有图标那点宽度，它是唯一的开合入口；而上一轮加的
 *      `position: fixed` 全屏蒙层把它整个盖住了 —— 第一次点开之后就再也点不回去。
 *
 * ⚠️ ④ 是我上一轮**自己写错、又自己写断言锁住**的：断言只查了「蒙层存在且层级递增」，
 *    没有查「图标是否浮在蒙层之上」。设计错了，锁就跟着错。
 *    所以这一节现在断言的是**关系**：谁在谁之上、谁先谁后、靶区多大。
 */
console.log('=== 9. 下拉菜单：面板不自关、捕获层在容器外、图标浮在捕获层之上 ===');
{
  const CARD_WXML3 = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxml'), 'utf8');
  const CARD_WXSS3 = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.wxss'), 'utf8');
  const SECT_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxml'), 'utf8');
  const SECT_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.wxss'), 'utf8');
  const ruleOf = (css, sel) => (new RegExp('\\.' + sel + ' \\{[^}]*\\}').exec(css) || [''])[0];
  const zOf = (css, sel) => {
    const m = /z-index:\s*(\d+)/.exec(ruleOf(css, sel));
    return m ? Number(m[1]) : 0;
  };

  /* --- ① 弹出层本身不带关闭手势（③ 的根因，别再挂回去） --- */
  const cardPop = (/<view wx:if="\{\{menuOpen\}\}" class="tc-menu-pop"[^>]*>/.exec(CARD_WXML3) || [''])[0];
  eq(/catchtap/.test(cardPop), false, '卡片菜单面板自己不绑 catchtap');
  const dayPop = (/<view wx:if="\{\{day\.menuOpen\}\}" class="ts-day-pop"[^>]*>/.exec(SECT_WXML) || [''])[0];
  eq(/catchtap/.test(dayPop), false, '日期菜单面板自己不绑 catchtap（否则「删除当天行程」被截胡）');

  /* --- ② 捕获层挂在 `.tc-menu` **外面**，且在它之前 ---
     ⚠️ 「在里面」是上一轮的写法，正是 ④ 的死锁来源。捕获层必须与 `.tc-menu`
        平级、且排在它**前面**，才能靠文档序被图标压住（两者的 z-index 相同）。 */
  /* ⚠️ 锚点必须用 `class="tc-menu[ "]` 而不是 `class="tc-menu"`：
     `tc-menu` 现在是**带条件类**的容器（`class="tc-menu {{menuOpen ? 'is-open' : ''}}"`），
     字面量 `class="tc-menu"` 在模板里根本不存在，indexOf 恒为 -1 → 断言**恒假**。
     尾随的 `[ "]` 同时把它与 `tc-menu-catch` / `tc-menu-pop` 区分开（后两者的下一个字符是 `-`）。 */
  const cardMenuAt = CARD_WXML3.search(/class="tc-menu[ "]/);
  const cardCatchAt = CARD_WXML3.indexOf('class="tc-menu-catch"');
  const cardPopAt = CARD_WXML3.indexOf('class="tc-menu-pop"');
  eq(cardCatchAt > 0 && cardCatchAt < cardMenuAt, true,
    '卡片捕获层在 `.tc-menu` 之外且排在它之前（同 z-index 时靠文档序决胜）');
  eq(cardMenuAt < cardPopAt, true, '图标在捕获层之后、面板之前');
  eq(/catchtap="onMenuClose"/.test(CARD_WXML3), true, '捕获层负责关闭（catch 而非 bind）');
  eq(/catchtouchmove="noop"/.test(CARD_WXML3), true, '捕获层吞掉 touchmove（不让页面跟着滚）');

  const dayMenuAt = SECT_WXML.indexOf('class="ts-day-menu"');
  const dayCatchAt = SECT_WXML.indexOf('class="ts-day-catch"');
  eq(dayCatchAt > 0 && dayCatchAt < dayMenuAt, true, '日期菜单捕获层同样在容器外且在前');
  eq(/catchtap="onMenuClose"/.test(SECT_WXML), true, '日期菜单捕获层负责关闭');

  /* --- ③ 捕获层浮在卡片之上（fixed + 铺满 + z-index 高于卡片） --- */
  const cardCatchRule = ruleOf(CARD_WXSS3, 'tc-menu-catch');
  eq(/position: fixed/.test(cardCatchRule), true, '卡片捕获层 position:fixed');
  eq(/calc\(100vw/.test(cardCatchRule) && /calc\(100vh/.test(cardCatchRule), true,
    '卡片捕获层铺满视口（写死四边而不是 inset，见 wxss 注释）');
  const dayCatchRule = ruleOf(SECT_WXSS, 'ts-day-catch');
  eq(/position: fixed/.test(dayCatchRule) && /calc\(100vw/.test(dayCatchRule), true,
    '日期菜单捕获层同款');

  /* ⚠️ **这一条是 ④ 的核心**：图标必须和捕获层至少同级。
     上一轮写成「蒙层 30 < 图标 31」，看起来层层递进，实际上 `.tc-menu` 没有提层级，
     图标根本没浮起来 —— 这就是「点开后再也点不回去」。 */
  const cz = zOf(CARD_WXSS3, 'tc-menu-catch');
  const mz = zOf(CARD_WXSS3, 'tc-menu');
  const pz = zOf(CARD_WXSS3, 'tc-menu-pop');
  eq(cz > 0, true, '捕获层有 z-index（' + cz + '）');
  eq(mz >= cz, true, '三点菜单容器浮在捕获层之上或同级（菜单 ' + mz + ' vs 捕获层 ' + cz + '）');
  eq(pz > mz, true, '面板浮在菜单之上（面板 ' + pz + ' > 菜单 ' + mz + '）');
  /* 同级时靠**文档序**决胜：二者同为 z-index 时，wxss 里后声明的那个赢。
     所以 `.tc-menu-catch` 的规则必须排在 `.tc-menu` 之后。 */
  const srcOrderCatch = CARD_WXSS3.indexOf('.tc-menu-catch {');
  const srcOrderMenu = CARD_WXSS3.indexOf('.tc-menu {');
  eq(srcOrderCatch > srcOrderMenu, true,
    '同级时靠文档序：`.tc-menu-catch` 的规则写在 `.tc-menu` 之后（谁在后谁在上）');

  const dz = zOf(SECT_WXSS, 'ts-day-catch');
  const dmenuZ = zOf(SECT_WXSS, 'ts-day-menu');
  const dpz = zOf(SECT_WXSS, 'ts-day-pop');
  eq(dmenuZ >= dz && dpz > dmenuZ, true,
    '日期菜单层级：容器(' + dmenuZ + ') ≥ 捕获层(' + dz + ')、面板(' + dpz + ') 最高');
  eq(SECT_WXSS.indexOf('.ts-day-catch {') > SECT_WXSS.indexOf('.ts-day-menu {'), true,
    '日期菜单同级时同样靠文档序');

  /* --- ④ 靶区：拇指下限 44px，且**不得改变视觉位置** ---
     「点菜单没反应」有一半是**打不中**：改之前卡片菜单横向只有 28px、图标本体 15px，
     用户点在图标旁边那几十像素上必然没反应，看起来就像 handler 没触发。
     ⚠️ 这一组常数是**联动的**，单改任何一个都会「修一个坏一个」——
        推导：盒居中 ⇒ 图标中心 = 盒中心；要它落在旧位置 ⇒ m = (新尺寸 − 旧盒尺寸)/2。
          · 卡片菜单旧盒 44×52rpx（padding 12rpx 8rpx + 图标 28）⇒ margin −26/−30
          · 日期菜单旧盒 38×38rpx（padding 6rpx + 图标 26）     ⇒ margin −33/−33
        `top` 也要跟着加回纵向 margin（面板定位原点随盒顶上移）。
     ⚠️ 104rpx 而不是 88rpx：rpx 随屏宽缩放（1rpx = 屏宽/750），88rpx 在 375px 屏上
        正好 44px，**在 320px 窄屏上只有 37.5px**，又跌破下限。104rpx 全屏宽都 ≥44px。 */
  [['tc-menu', CARD_WXSS3, 30, 26], ['ts-day-menu', SECT_WXSS, 33, 33]].forEach(([sel, css, mh, mv]) => {
    const r = ruleOf(css, sel);
    eq(/width:\s*104rpx/.test(r) && /height:\s*104rpx/.test(r), true,
      sel + ' 靶区 104rpx（rpx 随屏宽缩放，104 保证 320px 窄屏也有 44.4px）');
    /* 居中：图标中心 = 盒中心，这是上面 m 公式的前提，换 flex-end 就得重推 */
    eq(/align-items:\s*center/.test(r) && /justify-content:\s*center/.test(r), true,
      sel + ' 以盒中心定位图标（负 margin 的推导以此为前提）');
    /* margin 写法两种都接受：等值时可缩写成一个值，不等时必须写两个。
       断言的是**最终生效的两个数**，不是书写形式。 */
    const mAll = /margin:\s*(-?\d+)rpx(?:\s+(-?\d+)rpx)?/.exec(r);
    eq(!!mAll, true, sel + ' 有 margin 声明');
    if (mAll) {
      const vert = Number(mAll[1]);
      const horiz = mAll[2] === undefined ? vert : Number(mAll[2]);
      eq(vert, -mv, true, sel + ' 纵向 margin = −' + mv + 'rpx = (104 − 旧盒高)/2');
      eq(horiz, -mh, true, sel + ' 横向 margin = −' + mh + 'rpx = (104 − 旧盒宽)/2');
    }
  });
  /* 面板 top 必须把纵向 margin 加回去，否则浮层与图标错位 */
  eq(/top:\s*102rpx/.test(ruleOf(CARD_WXSS3, 'tc-menu-pop')), true,
    '菜单面板 top 102rpx（旧 76 + 纵向 margin 26）');
  eq(/top:\s*77rpx/.test(ruleOf(SECT_WXSS, 'ts-day-pop')), true,
    '日期菜单面板 top 77rpx（旧 44 + 纵向 margin 33）');

  /* --- ⑤ 两个组件都实现了捕获层的 touchmove 回调（否则 catchtouchmove 是死绑定） --- */
  const CARD_JS3 = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-card/trip-card.js'), 'utf8');
  const SECT_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/trip-section/trip-section.js'), 'utf8');
  eq(/noop\(\)\s*\{\s*\}/.test(CARD_JS3), true, 'trip-card 有 noop 方法');
  eq(/noop\(\)\s*\{\s*\}/.test(SECT_JS), true, 'trip-section 有 noop 方法');

  /* --- ⑥ wxml 绑定的「裸属性」必须在 properties/data 里声明（09-23 第五种根因） ---
     trip-section.wxml 一直传着 `menu-id="{{menuId}}"`，而 trip-section.js 的 properties
     在重构时把 menuId 声明删了。**没声明的属性不会进组件 data**，模板里解析为
     undefined，trip-card 的 menuOpen 永远 false —— 事件链（menutoggle 一路到
     home 的 setData）全程是通的、诊断日志都在打，唯独值回不来：
     表现是「点菜单 icon 没反应且不报错」。
     check-miniprogram.py 只查方法存在/图标名/组件路径，不查这种「模板引用了
     未声明属性」的静默失效，所以在这里对 wxml 里所有 {{裸标识符}} 逐个钉住。 */
  const forVarsOf = (wxml) => {
    const s = new Set(['index']);
    Array.from(wxml.matchAll(/wx:for-item="(\w+)"/g)).forEach(m => s.add(m[1]));
    return s;
  };
  /* 从 Component({ ... }) 源码里按花括号配对抠出 `properties` / `data` 两个对象块，
     再在块内查 key —— 直接在整份源码上 grep `name:` 会撞上注释与方法体里的同名键。 */
  const blocksOf = (js) => {
    const out = [];
    ['properties', 'data'].forEach(key => {
      const at = js.indexOf(key + ':');
      if (at < 0) return;
      let i = js.indexOf('{', at), depth = 0, start = i;
      for (; i < js.length; i++) {
        if (js[i] === '{') depth++;
        else if (js[i] === '}') { depth--; if (depth === 0) break; }
      }
      out.push(js.slice(start, i + 1));
    });
    return out;
  };
  const declaredIn = (blocks, name) =>
    blocks.some(b => new RegExp('\\b' + name + '\\s*:', 'm').test(b));
  [['trip-section', SECT_WXML, SECT_JS], ['trip-card', CARD_WXML3, CARD_JS3]].forEach(
    ([label, wxml, js]) => {
      const forVars = forVarsOf(wxml);
      const blocks = blocksOf(js);
      const bound = new Set();
      Array.from(wxml.matchAll(/\{\{\s*(\w+)\s*\}\}/g)).forEach(m => bound.add(m[1]));
      bound.forEach(name => {
        if (forVars.has(name)) return;
        eq(declaredIn(blocks, name), true,
          label + ' wxml 绑定的 ' + name + ' 已在 properties/data 声明（缺声明 = 静默 undefined）');
      });
    });
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
