/**
 * 行程清单 BottomSheet 的结构与交互约定。
 *
 * 运行：node test/cart-popup.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.wxss'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/cart-popup/cart-popup.js'), 'utf8');
const SPOT_WXML = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxml'), 'utf8');
const SPOT_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.wxss'), 'utf8');
const SPOT_JS = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-popup/spot-popup.js'), 'utf8');
const cartView = require('../miniprogram/utils/cart-view.js');

console.log('=== 1. 下拉菜单渲染在 scroll-view 外，避免被裁切 ===');
{
  eq(/showActionSheet/.test(JS), false, '不再使用系统 ActionSheet');
  eq(/cart-drop-menu/.test(WXML), true, '存在自定义下拉面板');
  eq(/cart-drop-catch/.test(WXML), true, '存在关闭捕获层');
  eq(WXML.indexOf('</scroll-view>') < WXML.indexOf('cart-drop-menu'), true,
    '下拉面板排在 scroll-view 之后（兄弟层，不被裁切）');
  eq(/\.cart-drop-menu\s*\{[^}]*position:\s*fixed/.test(WXSS), true,
    '下拉面板 fixed 定位');
  eq(/onListScroll/.test(WXML + JS), true, '滚动清单时关闭下拉');
}

console.log('=== 2. 可选与不可选提醒共用同一控件形态 ===');
{
  eq(/class="cart-drop \{\{item\.canToggle \? '' : 'disabled'\}\}"/.test(WXML), true,
    '同一节点按 canToggle 切换 Default / disabled');
  eq(/OPTION_OFF: '仅加行程·不提醒'/.test(JS), true,
    '不可选项文案为「仅加行程·不提醒」');
  eq(/\.cart-drop\.disabled\s*\{[^}]*background:\s*#F8F0E8/.test(WXSS), true,
    'disabled 使用灰底');
  eq(/chevron-down-muted/.test(WXML), true,
    'disabled 使用灰色箭头');
  eq(/\.cart-drop\s*\{[^}]*width:\s*252rpx/.test(WXSS), true,
    '单选下拉宽度容纳完整文案和箭头');
  eq(/\.cart-drop-option\s*\{[^}]*font-size:\s*24rpx/.test(WXSS), true,
    '菜单文字与选中后文字字号一致');
}

console.log('=== 3. 清单视觉基线 ===');
{
  eq(/\.cart-list\s*\{\s*background:\s*#F8F3EA/.test(WXSS), true,
    '清单背景为 #F8F3EA');
  eq(/\.cart-group-date\s*\{[^}]*font-size:\s*26rpx[^}]*font-weight:\s*500/.test(WXSS), true,
    '日期标题沿用首页日期标题字号与字重');
  eq(/\.cart-day-chip\s*\{[^}]*background:\s*#F2E4C0[^}]*color:\s*#C26B0C[^}]*font-size:\s*22rpx/.test(WXSS), true,
    '第几天徽标沿用首页金底样式');
  eq(/\.cart-row-name\s*\{[^}]*font-size:\s*28rpx/.test(WXSS), true,
    '景点名称字号下调一号');
  eq(/chevron-right-ink/.test(WXML), false, '景点名称右侧不再渲染箭头');
  eq(/\.cart-row-name\s*\{[^}]*text-decoration:\s*underline/.test(WXSS), true,
    '景点名称按链接样式加下划线');
  eq(/\.cart-header\s*\{[^}]*background:\s*#FFFEFB/.test(WXSS), true,
    '清单标题背景为 #FFFEFB');
  eq(/\.cart-row-action\s*\{[^}]*margin-right:\s*8rpx/.test(WXSS), true,
    '下拉框相对垃圾桶左移 4px');
  eq(/cartView\.normalizeCartGroups/.test(JS), true,
    '页面通过兼容层归一化服务端完整放票文案');
}

console.log('=== 4. 底部条图标、角标与安全区 ===');
{
  const foot = /\.cart-foot\s*\{[^}]*\}/.exec(WXSS);
  eq(Boolean(foot), true, '找到 .cart-foot 样式');
  const decl = foot[0].replace(/\/\*[\s\S]*?\*\//g, '');
  eq(/env\(safe-area-inset-bottom\)/.test(decl), false,
    '底部条不含 env(safe-area-inset-bottom)（TabBar 已经吃掉了）');
  eq(/cart-foot-icon/.test(WXML), true, '底部条有清单圆形图标');
  eq(/cart-foot-badge/.test(WXML), true, '底部条有数量角标');
  eq(/heart-add-white/.test(WXML), false, '提交按钮不再带爱心加号图标');
  eq(/alert-circle-gold/.test(WXML), true, '温馨提示使用金色警示图标');
  eq(/\.cart-tips-head\s*\{[^}]*color:\s*#C87D2A/.test(WXSS), true,
    '温馨提示图标与文字使用 #C87D2A');
  eq(/\.cart-tips-title\s*\{[^}]*font-weight:\s*400/.test(WXSS), true,
    '温馨提示文字不加粗');
  eq(/\.cart-foot\s*\{[^}]*background:\s*#FDFBF7/.test(WXSS), true,
    '清单底部横条背景为 #FDFBF7');
  eq(/\.cart-foot\s*\{[^}]*height:\s*96rpx[^}]*min-height:\s*96rpx/.test(WXSS), true,
    '清单底部横条与行程页统一为 96rpx 高');
  eq(/\.cart-foot-icon\s*\{[^}]*width:\s*72rpx[^}]*height:\s*72rpx/.test(WXSS), true,
    '清单图标为行程页 60rpx 的 120%');
  eq(/name="list-white" size="24px"/.test(WXML), true,
    '清单图标内部图形同步放大到 120%');
  eq(/\.cart-foot-btn\s*\{[^}]*padding:\s*16rpx 24rpx[^}]*font-size:\s*26rpx[^}]*font-weight:\s*500/.test(WXSS), true,
    '主按钮尺寸、字号和字重与行程页一致');
  eq(/\.cart-foot-text\s*\{[^}]*font-size:\s*21rpx/.test(WXSS), true,
    '清单摘要字号与行程页一致');
  eq(/cart-foot-reminder-count/.test(WXML), true, '其中 M 项数字单独高亮');
  eq(/\.cart-foot-reminder-count\s*\{[^}]*color:\s*var\(--color-primary\)/.test(WXSS), true,
    '提醒项数字使用主红色');
}

console.log('=== 5. 已过去的出行日在标题标注天数 ===');
{
  eq(/cart-past-note/.test(WXML), true, '过去出行日有独立备注节点');
  eq(/已过去\{\{group\.daysPast\}\}天/.test(WXML), true, '备注显示已过去 N 天');
  eq(/\.cart-past-note\s*\{[^}]*font-size:\s*20rpx/.test(WXSS), true,
    '过去备注使用辅助字号');

  const groups = cartView.normalizeCartGroups({
    groups: [
      { key: '2026-09-24', label: '9月24日 · 周四', dayLabel: '【第1天】', items: [] },
      { key: '2026-09-26', label: '9月26日 · 周六', dayLabel: '【第3天】', items: [] },
      { key: '2026-09-27', label: '9月27日 · 周日', dayLabel: '【第4天】', items: [] },
      { key: '2026-09-28', label: '9月28日 · 周一', dayLabel: '【第5天】', items: [] },
    ],
    items: [],
  }, '2026-09-27');

  eq(groups[0].isPast, true, '早于今天的出行日标记为已过去');
  eq(groups[0].daysPast, 3, '多天前的出行日正确计算 N 天');
  eq(groups[1].isPast, true, '昨天的出行日标记为已过去');
  eq(groups[1].daysPast, 1, '昨天显示已过去 1 天');
  eq(groups[2].isPast, false, '当天不标记为已过去');
  eq(groups[3].isPast, false, '未来日期不标记为已过去');
}

console.log('=== 6. 旧云端响应兼容 ===');
{
  const legacy = cartView.normalizeCartGroups({
    groups: [
      { key: '2026-09-26', label: '9月26日 (周六)', items: [] },
      { key: '__no_reservation__', label: '无需预约', items: [] },
    ],
    items: [
      {
        _id: 'a', spotId: 'gugong', spotName: '故宫博物院', visitDate: '2026-10-02',
        releaseAt: '2026-09-26T02:00:00.000Z', reservationRequired: true,
      },
      {
        _id: 'b', spotId: 'tiantan', spotName: '天坛公园', visitDate: '2026-10-03',
        releaseAt: null, reservationRequired: false,
      },
    ],
  });
  eq(legacy.length, 2, '旧响应被重新按出行日分组');
  eq(legacy[0].key, '2026-10-02', '第一组 key 是 visitDate');
  eq(legacy[0].dayLabel, '【第1天】', '补出第几天徽标');
  eq(legacy[0].items[0].subline, '09月26日 10:00 放票', '补出完整放票时间');
  eq(legacy[1].dayLabel, '【第2天】', '第二天序号正确');
  eq(legacy[1].items[0].subline, '无需预约，随到随玩', '免预约副行保留说明');
}

console.log('=== 7. 景点详情长内容在真机可滚动到底 ===');
{
  eq(/<scroll-view[\s\S]*scroll-y[\s\S]*class="popup-scroll"[\s\S]*style="\{\{scrollStyle\}\}"/.test(SPOT_WXML), true,
    '景点详情使用 scroll-view，并绑定 JS 下发高度');
  eq(/<view class="popup-scroll"/.test(SPOT_WXML), false,
    '不再使用普通 view + overflow-y 承载详情滚动');
  eq(/\.popup-scroll\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/.test(SPOT_WXSS), true,
    '滚动区在操作栏上方参与 flex 布局');
  eq(/fitSheet\(\)/.test(SPOT_JS) && /\.popup-scroll-content/.test(SPOT_JS), true,
    '展开游玩信息后按真实内容高度重新适配');
  eq(/query\.select\('\.popup-tips'\)\.boundingClientRect\(\)/.test(SPOT_JS)
    && /query\.select\('\.popup-tips-body'\)\.boundingClientRect\(\)/.test(SPOT_JS), true,
    '以最后一块真实内容测量，避免 scroll-view 把容器拉满后留下大空白');
  eq(/\.popup-actions-bar/.test(SPOT_JS), true,
    '适配时扣除底部操作栏高度');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAIL ' + fail)));
process.exit(fail === 0 ? 0 : 1);
