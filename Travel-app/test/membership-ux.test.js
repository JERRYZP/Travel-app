/**
 * 会员付费入口的 UX 契约：未超额不出现，超额才出现；我的页常驻状态入口。
 *
 * 运行：node test/membership-ux.test.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
});

let setupDef = null;
const originalPage = global.Page;
global.Page = def => { setupDef = def; };
require('../miniprogram/pages/setup/setup.js');
let profileDef = null;
global.Page = def => { profileDef = def; };
require('../miniprogram/pages/profile/profile.js');
let membershipDef = null;
global.Page = def => { membershipDef = def; };
require('../miniprogram/pages/membership/membership.js');
global.Page = originalPage;

const free = {
  member: false,
  taskUsed: 2,
  taskRemaining: 3,
  taskLimit: 5,
  memberTaskSlots: 10,
  ownedTaskPackCount: 0,
  taskPackSize: 5,
  memberExpiresAtText: '',
};

async function run() {
  console.log('=== 1. 提醒页只在超额时显示付费入口 ===');
  let gate = setupDef.membershipGateOf(2, free);
  eq(gate.showMembershipGate, false, '本次 2 条且额度足够时不显示');
  gate = setupDef.membershipGateOf(2, { ...free, taskUsed: 3, taskRemaining: 2 });
  eq(gate.showMembershipGate, false, '刚好用满 5 个时仍不显示');
  gate = setupDef.membershipGateOf(1, { ...free, taskUsed: 5, taskRemaining: 0 });
  eq(gate.showMembershipGate, true, '第 6 条时显示');
  eq(gate.upgradePackageId, 'member', '普通用户优先开会员');
  eq(gate.membershipActionText, '支付 ¥3，开通 30 天会员并继续', '按钮直接说明商品、金额并继续原流程');

  console.log('\n=== 2. 会员超额时加购，不重复卖会员 ===');
  gate = setupDef.membershipGateOf(1, {
    ...free,
    member: true,
    taskUsed: 10,
    taskRemaining: 0,
    taskLimit: 10,
    memberExpiresAtText: '2026年11月26日',
  });
  eq(gate.showMembershipGate, true, '会员满额时显示');
  eq(gate.upgradePackageId, 'task_pack_5', '会员显示加购包');
  eq(gate.membershipActionText, '支付 ¥3，加购 5 个名额并继续', '加购后继续原提交');

  console.log('\n=== 3. 会员过期后续费会恢复已购提醒名额 ===');
  gate = setupDef.membershipGateOf(1, {
    ...free,
    member: false,
    taskUsed: 12,
    taskRemaining: 0,
    taskLimit: 5,
    memberTaskSlots: 10,
    ownedTaskPackCount: 1,
    taskPackSize: 5,
  });
  eq(gate.upgradePackageId, 'member', '续费会员即可恢复原有 15 个提醒名额');
  eq(gate.membershipGateDesc, '因服务器压力，普通用户最多有 5 个提醒名额；开通会员后上限提升至 10 个，有效期 30 天。',
    '非会员用服务器压力说明固定免费额度，不再重复本次数量');
  eq(gate.membershipGateDesc.includes('本次需要'), false, '标题已经说明缺口，正文不再重复本次数量');

  console.log('\n=== 4. 页面结构与常驻入口 ===');
  const setupWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/setup/setup.wxml'), 'utf8');
  const setupJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/setup/setup.js'), 'utf8');
  const setupWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/setup/setup.wxss'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
  const profileJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.js'), 'utf8');
  const profileWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxss'), 'utf8');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  const membershipWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxml'), 'utf8');
  const membershipJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.js'), 'utf8');
  const membershipWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxss'), 'utf8');
  const membershipAll = [membershipWxml, membershipJs].join('\n');

  eq(setupWxml.includes('wx:if="{{showMembershipGate}}"'), true, '付费块整体由额度不足开关控制');
  eq(setupWxml.indexOf('membership-gate-desc') < setupWxml.indexOf('membership-gate-action'), true,
    '会员说明在上、支付按钮在下，长文案不再挤在右侧');
  eq(/membership-gate-link[^>]*bindtap="onMembership"/.test(setupWxml), true,
    '会员卡有独立的权益详情入口');
  eq(setupWxml.includes('查看会员权益与退款说明'), true,
    '权益入口明确说明可查看会员和退款信息');
  eq(/submit-btn \{\{canSubmit \? '' : 'disabled'\}\}/.test(setupWxml), true,
    '会员名额不足时通过统一 canSubmit 同步置灰主按钮');
  eq(/membershipBlocked\s*=\s*this\.data\.showMembershipGate === true/.test(setupJs), true,
    'JS 提交态与会员闸门使用同一事实');
  eq(setupJs.includes("upgradeConfirmAmount: '¥3'"), true, '设置提醒确认层使用 3 元价格');
  eq(setupWxml.includes('支付 {{upgradeConfirmAmount}}'), true,
    '设置提醒支付按钮复用确认金额字段，避免再次调价漏改');
  eq(/onSubmit\(\)[\s\S]{0,180}?showMembershipGate/.test(setupJs), true,
    'onSubmit 有不可绕过的会员闸门');
  eq(/\.membership-gate-action\s*\{[^}]*width:\s*100%/.test(setupWxss), true,
    '支付按钮占满卡片宽度，避免长文案截断');
  let membershipUrl = '';
  const oldWx = global.wx;
  global.wx = { navigateTo: ({ url }) => { membershipUrl = url; } };
  setupDef.onMembership.call({
    data: {
      membership: { taskUsed: 5, taskLimit: 5, taskRemaining: 0 },
      reminderCount: 3,
    },
  });
  global.wx = oldWx;
  eq(membershipUrl.includes('/pages/membership/membership?reason=task_limit'), true,
    '会员详情入口跳到会员页并携带超额上下文');
  eq(membershipUrl.includes('requested=3') && membershipUrl.includes('shortfall=3'), true,
    '会员页收到本次提醒数与缺口');
  eq(profileWxml.includes('membership-entry'), true, '我的页常驻会员状态卡');
  eq(profileWxml.includes('membership-entry {{isMember ? \'member\' : \'normal\'}}'), true,
    '会员卡普通/会员两套视觉状态');
  eq(profileWxml.indexOf('membership-entry') < profileWxml.indexOf('setting-card'), true,
    '会员卡独立位于头像下方、设置列表之前');
  eq(profileWxml.includes('profile-tag {{isMember ? \'member\' : \'\'}}'), true,
    '昵称下方身份标签随会员状态变化');
  eq(profileWxss.includes('height: 134rpx'), true, '会员卡高度按指定值改为 134rpx');
  eq(profileWxss.includes('background: #FFF7E7'), true, '会员卡填充对齐 Figma');
  eq(profileWxss.includes('border: 1rpx solid #F0E0C8'), true, '会员卡描边对齐 Figma');
  eq(profileWxss.includes('border-radius: 22rpx'), true, '会员卡圆角对齐 Figma 12px');
  eq(/\.membership-entry\s*\{[^}]*margin-bottom:\s*24rpx[^}]*\}/.test(profileWxss), true,
    '会员卡与下方卡片的间距和其他卡片一致');
  eq(/\.membership-entry\s*\{[^}]*box-shadow:\s*var\(--shadow-card\)[^}]*\}/.test(profileWxss), true,
    '会员卡使用与其他卡片一致的投影');
  eq(profileWxss.includes('width: 92rpx') && profileWxss.includes('height: 54rpx'), true,
    '行动按钮尺寸对齐 Figma');
  eq(profileWxss.includes('border-radius: 11rpx'), true, '行动按钮圆角为 6px');
  eq(/\.profile-header\s*\{[^}]*padding:\s*0;[^}]*\}/.test(profileWxss), true,
    '头像区不再套白色容器');
  eq(profileJs.includes("url: '/pages/membership/membership'"), true, '入口跳转会员页');
  eq(appJson.pages.includes('pages/membership/membership'), true, '会员页已注册');
  eq(appJson.pages.includes('pages/membership-orders/membership-orders'), true, '订单页已注册');
  eq(membershipAll.includes('bindtap="onOrders"'), true, '会员详情页有订单信息入口');
  eq(/免广告/.test(membershipAll), false, '会员页不承诺平台无法控制的免广告');
  eq(membershipWxml.includes('wx:if="{{!membership.member}}" class="explain-card"'), true,
    '免费版顶部权益卡只在非会员状态展示');
  eq(membershipWxml.includes('explain-kicker'), false, '顶部权益卡删除冗余小字');
  eq(membershipWxml.includes('开通会员以增加可同时开启的提醒名额'), true,
    '顶部权益卡使用精简后的主文案');
  eq(membershipWxml.includes('¥3 一次支付') && membershipWxml.includes('¥3 增加 5 个名额'), true,
    '会员页当前价格展示为 3 元');
  eq(membershipWxml.includes('¥2'), false, '会员页不再展示旧价格 2 元');
  eq(membershipWxml.includes('protectedTaskUsed > 0') && membershipWxml.includes('不占当前新增的'), true,
    '老用户历史提醒单独展示且明确不占当前新增名额');
  eq(/\.explain-card\s*\{[^}]*padding:\s*22rpx 24rpx/.test(membershipWxss), true,
    '顶部权益卡已压缩高度');
  eq(membershipWxml.includes('<text class="order-entry-title">会员订单</text>'), true,
    '订单入口标题改为会员订单');
  eq(membershipWxml.includes('<text class="order-entry-desc">查看支付结果和售后信息</text>'), true,
    '订单入口副文案只保留支付结果与售后信息');
  eq((membershipWxml.match(/<view class="benefit-row">/g) || []).length, 2,
    '你能得到什么只保留两条核心权益');
  eq(membershipWxml.includes('到期不删除已有提醒'), false,
    '权益列表不再重复展示到期提醒边界');
  eq(membershipWxml.includes('权益已到账'), false,
    '会员页不再渲染独立的权益已到账卡');
  eq(membershipWxml.includes('原则上'), false,
    '退款提示不再使用“原则上”弱化退款边界');
  eq(membershipWxss.includes('.payment-state.PAID_GRANTED'), false,
    '移除已不可达的权益到账状态样式');
  eq(membershipJs.includes('`因服务器压力，普通用户最多有 ${freeSlots} 个提醒名额`'), true,
    '免费版状态卡使用固定免费基础额度，不使用老用户保护额度');
  eq(membershipJs.includes('免费版可使用 ${limit || 5} 个提醒名额'), false,
    '免费版副标题不再把 taskLimit 误当成免费版标准名额');
  let paymentData = {};
  membershipDef.setPaymentState.call(
    { setData: patch => { paymentData = { ...paymentData, ...patch }; } },
    'PAID_GRANTED',
    '权益已到账',
    '支付结果已确认',
    'order_paid'
  );
  eq(paymentData.paymentState, null, '支付成功只更新会员卡，不重复展示状态卡');
  membershipDef.setPaymentState.call(
    { setData: patch => { paymentData = { ...paymentData, ...patch }; } },
    'PAID_GRANT_FAILED',
    '支付已完成，权益发放异常',
    '请勿重复支付',
    'order_failed'
  );
  eq(paymentData.paymentState && paymentData.paymentState.status, 'PAID_GRANT_FAILED',
    '仍需用户处理的权益异常状态继续保留');
  const orderDetailJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-order-detail/membership-order-detail.js'), 'utf8');
  const afterSalesWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-after-sales/membership-after-sales.wxml'), 'utf8');
  eq(orderDetailJs.includes('latestCase && latestCase.decisionNote'), true,
    '订单详情展示客服填写的驳回原因');
  eq(afterSalesWxml.includes('previousCase.decisionNote'), true,
    '重新申请售后前展示上次驳回原因');

  console.log('\n=== 5. 身份卡文案随会员状态切换 ===');
  let profileData = {};
  profileDef.applyUser.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { nickname: '普通用户', membership: { member: false, taskUsed: 2, taskLimit: 5 } }
  );
  eq(profileData.memberTagText, '普通用户', '普通用户标签');
  eq(profileData.memberCardTitle, '非会员', '普通用户卡标题');
  eq(profileData.memberCardAction, '开通', '普通用户卡行动');
  profileDef.applyUser.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    {
      nickname: '会员用户',
      membership: {
        member: true,
        memberExpiresAtText: '2026年11月26日',
        taskUsed: 3,
        taskLimit: 10,
      },
    }
  );
  eq(profileData.memberTagText, '尊贵会员', '会员标签凸显身份');
  eq(profileData.memberCardTitle, '尊贵会员', '会员卡标题');
  eq(profileData.memberCardDesc, '2026-11-26 到期｜提醒名额 3/10', '会员卡显示到期和提醒名额');
  eq(profileData.memberCardAction, '升级', '会员卡行动为升级');

  console.log('\n=== 5b. 售后入口只在有待处理单时显示数量标识 ===');
  profileData = {};
  profileDef.applyAfterSalesAdminStatus.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: true, pendingCount: 0 }
  );
  eq(profileData.showAfterSalesEntry, true, '管理员始终看到售后管理入口');
  eq(profileData.afterSalesPendingCount, 0, '没有待处理单时不显示数量');
  profileDef.applyAfterSalesAdminStatus.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: true, pendingCount: 3 }
  );
  eq(profileData.afterSalesPendingText, '3', '有待处理单时显示准确数量');
  profileDef.applyAfterSalesAdminStatus.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: true, pendingCount: 120 }
  );
  eq(profileData.afterSalesPendingText, '99+', '数量过大时使用 99+ 保持徽标尺寸稳定');
  profileDef.applyAfterSalesAdminStatus.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: false, pendingCount: 8 }
  );
  eq(profileData.showAfterSalesEntry, false, '非管理员不显示售后入口或数量');
  eq(profileWxml.includes('afterSalesPendingCount > 0'), true, 'WXML 仅在有待处理单时渲染徽标');
  eq(profileWxml.includes('class="setting-pending-badge"'), true, '售后管理入口包含待处理数量标识');
  eq(/\.setting-pending-badge\s*\{[^}]*background:\s*#C0472A/.test(profileWxss), true,
    '待处理标识使用独立的警示色');

  console.log('\n=== 6. 加购确认展示真实到期时间 ===');
  const now = Date.now();
  const currentExpiry = new Date(now + 40 * 86400000);
  let upgradeData = {
    membership: { member: true, memberExpiresAt: currentExpiry },
    upgradePackageId: 'task_pack_5',
  };
  setupDef.onUpgradeAndContinue.call({
    data: upgradeData,
    setData(patch) { upgradeData = { ...upgradeData, ...patch }; },
  });
  const expectedExpiry = new Date(currentExpiry.getTime() + 8 * 60 * 60 * 1000);
  const expectedText = `会员有效期至 ${expectedExpiry.getUTCFullYear()}年${expectedExpiry.getUTCMonth() + 1}月${expectedExpiry.getUTCDate()}日`;
  eq(upgradeData.upgradeConfirmExpiry, expectedText, '已有更长会员期时不被 30 天底线缩短');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
