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
const membershipModule = require('../miniprogram/pages/membership/membership.js');
let orderDetailPage = null;
global.Page = () => {};
orderDetailPage = require('../miniprogram/pages/membership-order-detail/membership-order-detail.js');
global.Page = originalPage;

const free = {
  member: false,
  taskUsed: 2,
  taskRemaining: 3,
  taskLimit: 5,
  freeTaskSlots: 5,
  memberTaskSlots: 15,
  memberDurationDays: 30,
  ownedTaskPackCount: 0,
  taskPackSize: 10,
  memberExpiresAtText: '',
};

const serverPackages = [
  {
    id: 'member',
    type: 'MEMBER',
    title: '会员 30 天',
    priceText: '¥3',
    taskSlots: 15,
    addedSlots: 10,
    memberDays: 30,
    memberFloorDays: 30,
    available: true,
  },
  {
    id: 'task_pack_5',
    type: 'TASK_PACK',
    title: '10 个提醒名额',
    priceText: '¥3',
    taskSlots: 10,
    addedSlots: 10,
    memberDays: 0,
    memberFloorDays: 30,
    available: true,
  },
];

function membershipGateOf(reminderCount, current) {
  return setupDef.membershipGateOf(reminderCount, current, serverPackages);
}

async function run() {
  console.log('=== 1. 提醒页只在超额时显示付费入口 ===');
  let gate = membershipGateOf(2, free);
  eq(gate.showMembershipGate, false, '本次 2 条且额度足够时不显示');
  eq(gate.membershipQuotaLimit, 5, '未超额时也同步当前额度，状态不会沿用旧值');
  eq(gate.membershipQuotaRequested, 2, '未超额时同步本次新建数');
  gate = membershipGateOf(2, { ...free, taskUsed: 3, taskRemaining: 2 });
  eq(gate.showMembershipGate, false, '刚好用满 5 个时仍不显示');
  gate = membershipGateOf(5, { ...free, taskUsed: 3, taskRemaining: 2 });
  eq(gate.showMembershipGate, true, '免费额度不足时显示');
  eq(gate.membershipQuotaLimit, 5, '公式展示当前额度 5');
  eq(gate.membershipQuotaUsed, 3, '公式展示已占额度 3');
  eq(gate.membershipQuotaRemaining, 2, '公式展示剩余额度 2');
  eq(gate.membershipQuotaRequested, 5, '公式展示本次新建 5');
  eq(gate.membershipQuotaGap, 3, '公式展示还差 3');
  eq(gate.upgradePackageId, 'member', '普通用户优先开会员');
  eq(gate.membershipActionText, '支付 ¥3，开通 30 天会员并继续', '按钮直接说明商品、金额并继续原流程');

  console.log('\n=== 2. 会员超额时加购，不重复卖会员 ===');
  gate = membershipGateOf(1, {
    ...free,
    member: true,
    taskUsed: 15,
    taskRemaining: 0,
    taskLimit: 15,
    memberExpiresAtText: '2026年11月26日',
  });
  eq(gate.showMembershipGate, true, '会员满额时显示');
  eq(gate.upgradePackageId, 'task_pack_5', '会员显示加购包');
  eq(gate.membershipActionText, '支付 ¥3，加购 10 个名额并继续', '加购后继续原提交');
  gate = membershipGateOf(7, {
    ...free,
    member: true,
    taskUsed: 12,
    taskRemaining: 3,
    taskLimit: 15,
  });
  eq(gate.membershipQuotaLimit, 15, '会员公式展示当前额度 15');
  eq(gate.membershipQuotaUsed, 12, '会员公式展示已占额度 12');
  eq(gate.membershipQuotaRemaining, 3, '会员公式展示剩余额度 3');
  eq(gate.membershipQuotaGap, 4, '会员公式展示本次新建 7、还差 4');
  gate = membershipGateOf(13, {
    ...free,
    member: true,
    taskUsed: 3,
    taskRemaining: 12,
    taskLimit: 15,
  });
  eq(gate.membershipQuotaUsed, 3, '历史保护任务不进入公式的已占额度');
  eq(gate.membershipQuotaRemaining, 12, '历史保护任务不压缩公式的剩余额度');
  eq(gate.membershipQuotaGap, 1, '历史保护额度下按新增池计算本次缺口');
  const availablePackages = [
    { id: 'member', type: 'MEMBER', available: true },
    { id: 'task_pack_5', type: 'TASK_PACK', available: true },
  ];
  eq(membershipDef.defaultPackageIdOf({ member: true }, availablePackages), 'task_pack_5',
    '会员进入会员页默认选中加购，不默认续费会员');
  eq(membershipDef.defaultPackageIdOf({ member: false }, availablePackages), 'member',
    '非会员仍默认选中开通会员');
  eq(membershipDef.defaultPackageIdOf({ member: true }, [availablePackages[0]]), 'member',
    '加购不可用时安全回退到会员套餐');
  let preferredMembershipUrl = '';
  const originalWx = global.wx;
  global.wx = { navigateTo: ({ url }) => { preferredMembershipUrl = url; } };
  setupDef.onMembership.call({
    data: {
      membership: { member: true, taskUsed: 15, taskLimit: 15, taskRemaining: 0 },
      reminderCount: 16,
      upgradePackageId: 'task_pack_5',
    },
  });
  eq(preferredMembershipUrl.includes('packageId=task_pack_5'), true,
    '设置提醒页打开会员页时显式携带加购意向');
  global.wx = originalWx;
  const membershipPage = { setData: () => {} };
  membershipDef.onLoad.call(membershipPage, { packageId: 'task_pack_5' });
  eq(membershipPage._preferredPackageId, 'task_pack_5',
    '会员页接收并校验设置提醒页传入的加购意向');

  console.log('\n=== 3. 会员过期后续费会恢复已购提醒名额 ===');
  gate = membershipGateOf(1, {
    ...free,
    member: false,
    taskUsed: 15,
    taskRemaining: 0,
    taskLimit: 5,
    memberTaskSlots: 15,
    ownedTaskPackCount: 1,
    taskPackSize: 10,
  });
  eq(gate.upgradePackageId, 'member', '续费会员即可恢复原有 25 个提醒名额');
  eq(gate.membershipGateDesc, '因服务器压力，普通用户最多有 5 个提醒名额；开通会员后上限提升至 15 个，有效期 30 天。',
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
  const spotCardWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/components/spot-card/spot-card.wxss'), 'utf8');
  const membershipAll = [membershipWxml, membershipJs].join('\n');
  const reminderAuthWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/reminder-auth-sheet/reminder-auth-sheet.wxml'), 'utf8');
  const reminderAuthJs = fs.readFileSync(path.join(ROOT, 'miniprogram/components/reminder-auth-sheet/reminder-auth-sheet.js'), 'utf8');
  const reminderAuthJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/components/reminder-auth-sheet/reminder-auth-sheet.json'), 'utf8'));
  const paymentConfirmWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/payment-confirm-sheet/payment-confirm-sheet.wxml'), 'utf8');
  const paymentConfirmJs = fs.readFileSync(path.join(ROOT, 'miniprogram/components/payment-confirm-sheet/payment-confirm-sheet.js'), 'utf8');
  const privacyPolicy = fs.readFileSync(path.join(ROOT, 'docs/legal/隐私政策.md'), 'utf8');
  const termsAgreement = fs.readFileSync(path.join(ROOT, 'docs/legal/用户服务协议.md'), 'utf8');
  const membershipJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.json'), 'utf8'));
  const spotHubJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.json'), 'utf8'));
  const shareSceneJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/share-scene/share-scene.json'), 'utf8'));
  const homeJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.json'), 'utf8'));
  const spotHubWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/spot-hub/spot-hub.wxml'), 'utf8');
  const shareSceneWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/share-scene/share-scene.wxml'), 'utf8');
  const homeWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/home/home.wxml'), 'utf8');
  const orderDetailWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-order-detail/membership-order-detail.wxml'), 'utf8');
  const orderDetailJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-order-detail/membership-order-detail.js'), 'utf8');
  const orderDetailWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-order-detail/membership-order-detail.wxss'), 'utf8');
  const orderListWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-orders/membership-orders.wxml'), 'utf8');
  const orderListJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-orders/membership-orders.js'), 'utf8');

  eq(setupWxml.includes('wx:if="{{showMembershipGate}}"'), true, '付费块整体由额度不足开关控制');
  eq(setupWxml.includes('当前额度 {{membershipQuotaLimit}} 个 − 已占 {{membershipQuotaUsed}} 个 = 剩余 {{membershipQuotaRemaining}} 个'),
    true, '支付卡展示额度、已占和剩余的公式');
  eq(membershipWxml.includes("status-band {{membership.member ? 'member-first' : ''}}"), true,
    '会员态给顶部状态卡添加独立间距状态');
  eq(/\.status-band\.member-first\s*\{\s*margin-top:\s*0;?\s*\}/.test(membershipWxss), true,
    '会员态移除说明卡不存在时残留的上边距');
  eq(/\.spot-card-remind\s*\{[^}]*min-width:\s*100rpx/.test(spotCardWxss), true,
    '景点设提醒入口提供更宽的触控区域');
  eq(/\.spot-card-remind\s*\{[^}]*min-height:\s*72rpx/.test(spotCardWxss), true,
    '景点设提醒入口提供更稳的安卓纵向热区');
  eq(setupWxml.includes('本次新建 {{membershipQuotaRequested}} 个，还差 {{membershipQuotaGap}} 个'),
    true, '支付卡展示本次新建数和缺口');
  eq(/if \(restored\.status === 'PAID_GRANTED'\)[\s\S]{0,260}this\.loadCartAndAccess\(\{ force: true \}\)/.test(setupJs),
    true, '恢复已支付订单后强制刷新会员额度，不使用支付前缓存');
  eq(/if \(result\.status === 'PAID_GRANTED'\)[\s\S]{0,260}this\.loadCartAndAccess\(\{ force: true \}\)/.test(setupJs),
    true, '支付成功继续原提醒前强制刷新会员额度');
  eq(setupWxml.indexOf('membership-gate-desc') < setupWxml.indexOf('membership-gate-action'), true,
    '会员说明在上、支付按钮在下，长文案不再挤在右侧');
  eq(reminderAuthWxml.includes('放票提醒授权'), true, '统一浮层包含放票提醒授权区');
  eq(reminderAuthWxml.includes('<text class="ras-title">设置提醒</text>'), true,
    '统一浮层标题固定为设置提醒');
  eq(reminderAuthWxml.includes('show && (auth || datePlan)'), true,
    '日期资格说明与授权共用同一个浮层');
  eq(reminderAuthWxml.includes("busy ? '正在处理...' : auth.primaryText"), true,
    '授权区复用 PAGE-008 的固定补授权按钮位置');
  eq(reminderAuthWxml.includes('1次授权可发送1条提醒'), true,
    '授权区复用 PAGE-008 的第一条说明');
  eq(reminderAuthWxml.includes('每次点击最多增加1次授权，需要几次请重复点'), true,
    '授权区复用 PAGE-008 的手动补齐说明');
  eq(reminderAuthWxml.includes('“总是保持以上选择”可免去后续弹窗'), true,
    '授权区复用 PAGE-008 的订阅弹窗说明');
  eq(reminderAuthWxml.includes('查看提醒样式示例'), true,
    '授权区提供真实提醒样式示例入口');
  eq(reminderAuthJson.usingComponents['reminder-sample-sheet'],
    '/components/reminder-sample-sheet/reminder-sample-sheet',
    '统一浮层注册真实提醒样式组件');
  eq(reminderAuthWxml.includes('当前额度 {{membership.limit}} 个 − 已占 {{membership.used}} 个 = 剩余 {{membership.remaining}} 个'),
    true, '统一浮层包含提醒名额额度公式');
  eq(reminderAuthWxml.includes('本次新建 {{membership.requested}} 个，还差 {{membership.shortfall}} 个'),
    true, '统一浮层包含本次新建数与名额缺口');
  eq(reminderAuthWxml.includes('查看会员权益与退款说明'), true,
    '统一浮层提供会员权益说明入口');
  eq(reminderAuthWxml.includes('{{membership.payText}}'), true,
    '名额主按钮直接使用服务端套餐生成的支付并继续文案');
  eq(reminderAuthWxml.includes('{{continueText}}'), true,
    '无名额限制时统一浮层使用状态机提供的正式提交按钮');
  eq(/continueText:\s*\{\s*type:\s*String,\s*value:\s*'开启行程放票提醒'/.test(reminderAuthJs), true,
    '统一浮层默认主按钮文案保持开启行程放票提醒');
  eq(/ras-continue \{\{checkoutReady \? '' : 'disabled'\}\}/.test(reminderAuthWxml), true,
    '名额未满足时底部提交按钮置灰');
  eq(reminderAuthWxml.includes('bindtap="onReselect"'), true,
    '日期失效时可在原浮层返回重选');
  eq(reminderAuthWxml.includes('暂不处理'), false, '统一浮层不保留暂不处理');
  eq(reminderAuthWxml.includes('payment-confirm-sheet'), true, '统一浮层内嵌支付确认层');
  eq(reminderAuthJson.usingComponents['payment-confirm-sheet'], '/components/payment-confirm-sheet/payment-confirm-sheet',
    '统一浮层注册支付确认组件');
  eq(membershipJson.usingComponents['payment-confirm-sheet'], '/components/payment-confirm-sheet/payment-confirm-sheet',
    '会员页复用同一个支付确认组件');
  eq(paymentConfirmWxml.includes('确认支付'), true, '支付确认组件展示明确标题');
  eq(paymentConfirmWxml.includes('Apple'), true, '支付确认组件保留 iOS 退款边界');
  eq(paymentConfirmWxml.includes('本商品为即时交付的虚拟服务')
    && paymentConfirmWxml.includes('不自动续费'), true,
    '支付确认组件明确即时交付和不自动续费');
  eq(paymentConfirmWxml.includes('《用户服务协议》')
    && paymentConfirmWxml.includes('《隐私政策》'), true,
    '支付前可直接查阅用户协议和隐私政策');
  eq(paymentConfirmWxml.includes('点击支付即同意'), false,
    '支付确认层不再把点击支付解释为默认同意协议');
  eq(paymentConfirmWxml.includes('bindtap="onToggleAgreement"')
    && paymentConfirmWxml.includes('agreementAccepted'), true,
    '支付确认层提供默认未勾选的主动协议选择');
  eq(/agreementAccepted:\s*false/.test(paymentConfirmJs), true,
    '协议选择初始为未勾选');
  eq(/show\(value\)[\s\S]{0,160}agreementAccepted:\s*false/.test(paymentConfirmJs), true,
    '每次重新打开支付确认层都会重置协议选择');
  eq(/!this\.data\.agreementAccepted/.test(paymentConfirmJs), true,
    '未主动勾选协议时不能发起支付');
  eq(/paying \|\| disabled \|\| !agreementAccepted/.test(paymentConfirmWxml), true,
    '未勾选协议时支付按钮显示禁用态');
  eq(/onOpenAgreement\(e\)[\s\S]*\/pages\/legal\/legal\?type=/.test(paymentConfirmJs), true,
    '支付确认页协议链接复用统一协议页');
  eq(privacyPolicy.includes('iOS 端由 Apple App Store 处理'), true,
    '隐私政策明确 Apple 支付和退款数据处理角色');
  eq(privacyPolicy.includes('售后服务与审核记录')
    && privacyPolicy.includes('支付后新增提醒数')
    && privacyPolicy.includes('审计日志'), true,
    '隐私政策覆盖售后申请证据与审核日志');
  eq(termsAgreement.includes('相关权益立即开始提供')
    && termsAgreement.includes('不适用七日无理由退货'), true,
    '用户协议明确虚拟服务即时交付及无理由退货边界');
  eq(/paying \|\| disabled/.test(paymentConfirmWxml), true,
    '支付中或不可继续时禁用支付按钮');
  eq(/triggerEvent\('confirm'\)/.test(paymentConfirmJs), true,
    '支付确认组件向页面发出确认事件');
  eq(/onBenefits\(\)[\s\S]*triggerEvent\('benefits'\)/.test(reminderAuthJs), true,
    '权益入口发出独立事件');
  eq(/bind:benefits="onReminderAuthBenefits"/.test(spotHubWxml), true,
    '景点页接收权益入口事件');
  eq(/bind:reselect="onReminderAuthReselect"/.test(spotHubWxml), true,
    '景点页接收日期重选事件');
  eq(/bind:benefits="onReminderAuthBenefits"/.test(shareSceneWxml), true,
    '分享场景接收权益入口事件');
  eq(/bind:pay="onReminderAuthPay"/.test(homeWxml), true,
    '首页约其他日接收同一提醒名额支付入口');
  eq(/bind:continue="onReminderAuthContinue"/.test(homeWxml), true,
    '首页约其他日接收同一提醒检查继续事件');
  eq(spotHubJson.usingComponents['reminder-auth-sheet'], '/components/reminder-auth-sheet/reminder-auth-sheet',
    '景点页注册统一提醒检查浮层');
  eq(shareSceneJson.usingComponents['reminder-auth-sheet'], '/components/reminder-auth-sheet/reminder-auth-sheet',
    '分享场景注册统一提醒检查浮层');
  eq(homeJson.usingComponents['reminder-auth-sheet'], '/components/reminder-auth-sheet/reminder-auth-sheet',
    '首页约其他日注册同一个提醒检查浮层');
  eq(/membership-gate-link[^>]*bindtap="onMembership"/.test(setupWxml), true,
    '会员卡有独立的权益详情入口');
  eq(setupWxml.includes('查看会员权益与退款说明'), true,
    '权益入口明确说明可查看会员和退款信息');
  eq(/submit-btn \{\{canSubmit \? '' : 'disabled'\}\}/.test(setupWxml), true,
    '会员名额不足时通过统一 canSubmit 同步置灰主按钮');
  eq(/membershipBlocked\s*=\s*this\.data\.showMembershipGate === true/.test(setupJs), true,
    'JS 提交态与会员闸门使用同一事实');
  eq(setupJs.includes("upgradeConfirmAmount: ''") && setupJs.includes('upgradeConfirmAmount: pkg.priceText'), true,
    '设置提醒确认层价格只读取服务端套餐');
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
  eq(orderListWxml.includes('bindtap="onOpenPaymentFaq"'), true, '会员订单页顶部提供支付 FAQ 入口');
  eq(orderListWxml.indexOf('payment-faq-entry') < orderListWxml.indexOf('wx:if="{{loading}}"'), true,
    '支付 FAQ 入口固定在订单内容顶部');
  eq(orderListJs.includes("url: '/pages/guide/guide?focus=payment-faq'"), true,
    '支付 FAQ 入口深链到攻略问答组');
  eq(membershipAll.includes('bindtap="onOrders"'), true, '会员详情页有订单信息入口');
  eq(/免广告/.test(membershipAll), false, '会员页不承诺平台无法控制的免广告');
  eq(membershipWxml.includes('wx:if="{{!membership.member}}" class="explain-card"'), true,
    '免费版顶部权益卡只在非会员状态展示');
  eq(membershipWxml.includes('explain-kicker'), false, '顶部权益卡删除冗余小字');
  eq(membershipWxml.includes('开通会员以增加可同时开启的提醒名额'), true,
    '顶部权益卡使用精简后的主文案');
  eq(membershipWxml.includes('{{membership.memberPackagePriceText}} 一次支付')
    && membershipWxml.includes('{{membership.taskPackPriceText}} 增加 {{membership.taskPackSize}} 个名额'), true,
    '会员页当前价格与加购数量读取服务端套餐口径');
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
  eq(membershipWxml.includes('退款申请和审核由 Apple 独立处理，小程序客服无法决定结果'), true,
    'iOS 购买说明明确退款决定权归 Apple，客服不决定退款');
  eq(paymentConfirmWxml.includes('如需申请，可在 App Store 购买记录中操作'), true,
    'iOS 支付确认层只在需要时说明简短申请路径');
  eq(membershipWxml.includes('可申请退款，需客服核实'), true,
    'Android 退款仍保留客服核实口径');
  eq(membershipWxml.includes('wx:else>虚拟权益支付成功后生效'), true,
    '会员页购买说明按设备区分 iOS 与 Android');
  eq(paymentConfirmWxml.includes('wx:else>24 小时内且未新增任何提醒'), true,
    '支付确认层按设备区分 iOS 与 Android');
  eq(membershipWxml.includes('iOS 退款：') || membershipWxml.includes('点击“报告问题”申请'), false,
    '会员页与支付确认层不把 Apple 退款做成强引导路径');
  eq(paymentConfirmJs.includes('wx.getDeviceInfo'), true,
    '支付确认层只在 iOS 设备展示 Apple 退款提示');
  eq(paymentConfirmJs.includes('若提示付款方式不可用')
    && paymentConfirmJs.includes('设置 > 你的姓名 > 付款与配送')
    && paymentConfirmJs.includes('中国大陆可使用微信支付'), true,
    'iOS 支付确认层提供条件化的 Apple 付款方式自查路径');
  eq(membershipJs.includes('若 Apple 付款提示付款方式不可用')
    && membershipJs.includes('设置 > 你的姓名 > 付款与配送')
    && membershipJs.includes('中国大陆可使用微信支付'), true,
    'iOS 支付失败状态卡提供条件化的 Apple 付款方式自查路径');
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

  /* 设备不具备支付能力时只说明原因，不进入下单流程——让用户走完整下单
     再失败，等于把一个可以提前说清的问题变成一个订单加一句模糊提示。 */
  const modalCalls = [];
  const capabilityOriginalWx = global.wx;
  global.wx = {
    ...(capabilityOriginalWx || {}),
    showModal: opts => { modalCalls.push(opts); },
  };
  let payData = {
    purchasing: false,
    sales: null,
    selectedPackage: null,
    payCapability: { supported: false, reason: '当前微信版本暂不支持虚拟支付' },
    payUnsupportedTip: '请确认 iPhone 系统为 iOS 15 及以上，并将微信更新到最新版本后重试。',
  };
  const payCtx = {
    data: payData,
    setData: patch => { payData = { ...payData, ...patch }; },
  };
  payCtx.showPayUnsupported = membershipDef.showPayUnsupported.bind(payCtx);
  membershipDef.onPay.call(payCtx);
  eq(modalCalls.length, 1, '能力不足时点击支付只弹一次说明');
  eq(modalCalls[0] && modalCalls[0].title, '当前设备无法完成购买',
    '说明弹窗标题直接点明设备无法购买');
  eq(modalCalls[0] && modalCalls[0].content, payData.payUnsupportedTip,
    '弹窗内容与页面提示共用同一份设备条件文案');
  eq(payData.showPayConfirm, undefined, '能力不足时不打开支付确认层');

  modalCalls.length = 0;
  payData = {
    purchasing: false,
    sales: null,
    selectedPackage: { id: 'member', priceText: '¥3', memberDays: 30 },
    payCapability: { supported: true, reason: '' },
    payUnsupportedTip: '',
    membership: {},
  };
  const capableCtx = {
    data: payData,
    setData: patch => { payData = { ...payData, ...patch }; },
  };
  capableCtx.showPayUnsupported = membershipDef.showPayUnsupported.bind(capableCtx);
  membershipDef.onPay.call(capableCtx);
  eq(modalCalls.length, 0, '能力正常时不弹设备说明');
  eq(payData.showPayConfirm, true, '能力正常时正常进入支付确认层');
  global.wx = capabilityOriginalWx;

  /* 失败提示里摊开微信版本和系统版本：用户能对照自查，客服不必再问一遍。
     只展示，不参与拦截——版本门槛没有和微信官方原文复核过。 */
  global.wx = {
    ...(capabilityOriginalWx || {}),
    getAppBaseInfo: () => ({ version: '8.0.47' }),
    getDeviceInfo: () => ({ platform: 'ios', system: 'iOS 16.6' }),
  };
  eq(membershipModule.payEnvTextOf(), '当前环境 微信 8.0.47 / iOS 16.6。',
    '失败提示展示微信版本与系统版本');

  global.wx = {
    ...(capabilityOriginalWx || {}),
    getSystemInfoSync: () => ({ version: '8.0.31', system: 'iOS 14.2' }),
  };
  eq(membershipModule.payEnvTextOf(), '当前环境 微信 8.0.31 / iOS 14.2。',
    '老基础库退回 getSystemInfoSync 仍能读到版本');

  global.wx = { ...(capabilityOriginalWx || {}), getSystemInfoSync: () => ({}) };
  eq(membershipModule.payEnvTextOf(), '', '版本读不到时不显示环境前缀');

  global.wx = {
    ...(capabilityOriginalWx || {}),
    getAppBaseInfo: () => { throw new Error('boom'); },
    getSystemInfoSync: () => ({ version: '8.0.47', system: 'iOS 16.6' }),
  };
  eq(membershipModule.payEnvTextOf(), '', '读取版本异常不连累支付失败提示本身');
  global.wx = capabilityOriginalWx;
  const afterSalesWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-after-sales/membership-after-sales.wxml'), 'utf8');
  const afterSalesJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership-after-sales/membership-after-sales.js'), 'utf8');
  const adminAfterSalesWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxml'), 'utf8');
  const adminAfterSalesJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.js'), 'utf8');
  eq(afterSalesWxml.includes('wx:if="{{existingCase.canCancel}}"')
    && afterSalesWxml.includes('取消售后'), true,
    '用户售后页只在服务端允许时展示取消按钮');
  eq(afterSalesWxml.includes('申请时间：{{existingCase.createdAtText}}')
    && afterSalesWxml.includes('售后申请预计 24 小时内处理；超过 24 小时仍未更新处理结果，请联系客服。'), true,
    '售后单明确展示申请时间和超时处理预期');
  eq(afterSalesJs.includes('api.payment.afterSales.cancel(existingCase._id)')
    && afterSalesJs.includes('确认取消'), true,
    '取消售后经过二次确认并调用专用接口');
  eq(
    !adminAfterSalesJs.includes("key: 'CANCELLED'")
      && adminAfterSalesJs.includes("DEFAULT_AFTER_SALES_FILTER = 'UNDER_REVIEW'"),
    true,
    '后台隐藏终态筛选并默认进入审核中队列'
  );
  eq(adminAfterSalesWxml.includes('用户已主动取消本次售后申请')
    && adminAfterSalesWxml.includes('history.stats.cancelled'), true,
    '后台详情展示取消来源与历史取消统计');
  eq(orderDetailWxml.includes('{{afterSalesActionLabel}}')
    && orderDetailJs.includes("'如何申请 Apple 退款'"), true,
    'Apple 订单退款按钮固定使用如何申请 Apple 退款');
  eq(orderDetailJs.includes('查看 Apple 退款说明'), false,
    'Apple 订单退款按钮不随退款状态切换文案');
  eq(orderDetailWxml.includes('Apple 退款说明') && orderDetailWxml.includes('Apple 审核期间'), true,
    '订单详情提供 Apple 退款申请路径和审核期间权益说明');
  eq(orderDetailWxml.includes('Apple 拒绝退款：会员权益保持不变。'), true,
    '明确 Apple 拒绝退款时权益不变');
  eq(orderDetailWxml.includes('确认退款：系统收到结果后自动回收'), true,
    '明确 Apple 退款成功后的权益回收');
  eq(orderDetailJs.includes("this.setData({ showIosRefundGuide: true })"), true,
    '点击 Apple 退款入口打开详细说明面板');
  eq(orderDetailWxss.includes('.refund-sheet') && orderDetailWxss.includes('max-height: 84vh'), true,
    '详细说明面板适配移动端高度并可滚动');
  eq(orderDetailWxml.includes('order.entitlementGrant.taskPackDelta * order.addedSlots'), true,
    '提醒名额增量按订单快照计算，不把当前 10 个规格写死回 5 个');
  eq(orderDetailWxml.includes('taskPackDelta * 5'), false,
    '订单详情不再残留 5 个名额的硬编码阶梯');
  eq(orderDetailJs.includes('latestCase && latestCase.decisionNote'), true,
    '订单详情展示客服填写的驳回原因');
  eq(orderDetailWxml.includes('wx:if="{{latestCase}}"')
    && orderDetailWxml.includes('退款售后记录'), true,
    '订单详情直接展示本单退款售后记录卡');
  eq(orderDetailWxml.includes("order.paymentChannel === 'APPLE' ? '退款记录' : '退款售后记录'"), true,
    'Apple 订单退款记录卡不显示售后字样');
  eq(orderDetailWxml.includes('{{latestCase.typeLabel}}')
    && orderDetailWxml.includes('{{latestCase.statusLabel}}')
    && orderDetailWxml.includes('{{latestCase.outRefundNo}}'), true,
    '退款售后记录卡展示类型、状态和退款单号');
  const grantedState = orderDetailPage.stateOfOrder({
    status: 'PAID',
    grantStatus: 'GRANTED',
    refundStatus: 'NONE',
    entitlementGrant: { appliedAt: new Date() },
  }, { status: 'CANCELLED' });
  eq(grantedState.tone, 'success', '已支付且权益已发放的订单展示成功态');
  eq(grantedState.title, '支付已完成，权益已到账',
    '取消售后后不再落入“状态待核验”兜底文案');
  eq(/待核验/.test(grantedState.desc), false,
    '权益已到账时不再提示用户重复进入页面核验');
  const unknownGrantState = orderDetailPage.stateOfOrder({
    status: 'PAID',
    grantStatus: 'UNKNOWN',
    refundStatus: 'NONE',
  }, null);
  eq(unknownGrantState.title, '支付已确认，权益待核验',
    '真正未知的权益发放状态仍保留保护性提示');
  eq(orderDetailWxml.includes('该记录由系统根据平台退款结果自动生成'), true,
    '系统自动退款记录有明确来源说明');
  eq(orderDetailWxml.includes('refund-service-link'), false,
    'Apple 退款说明不再提供无效的售后页面跳转');
  eq(orderDetailWxss.includes('.refund-service-link'), false,
    'Apple 退款说明移除无效跳转的残留样式');
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
        taskLimit: 15,
      },
    }
  );
  eq(profileData.memberTagText, '尊贵会员', '会员标签凸显身份');
  eq(profileData.memberCardTitle, '尊贵会员', '会员卡标题');
  eq(profileData.memberCardDesc, '2026-11-26 到期｜提醒名额 3/15', '会员卡显示到期和提醒名额');
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
    { isAdmin: true, pendingCount: 3, fundingBlockedCount: 1 }
  );
  eq(profileData.afterSalesPendingText, '3', '有待处理单时显示准确数量');
  eq(profileData.afterSalesFundingBlocked, true, '退款资金不足时在“我的”入口持续告警');
  eq(profileData.afterSalesAdminHint, '退款资金不足 · 1 笔', '资金阻断数量直接显示在入口说明');
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
  eq(profileWxml.includes('afterSalesFundingBlocked'), true, '售后入口区分退款资金阻断状态');
  eq(/\.setting-pending-badge\s*\{[^}]*background:\s*#C0472A/.test(profileWxss), true,
    '待处理标识使用独立的警示色');
  eq(/\.setting-row-hint\.funding-blocked\s*\{[^}]*color:\s*#C0472A/.test(profileWxss), true,
    '资金阻断说明使用警示色');

  console.log('\n=== 5c. 反馈管理入口与用户未读标识 ===');
  profileData = {};
  profileDef.applyFeedbackEntry.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: true, adminPendingCount: 8, handledUnreadCount: 2 }
  );
  eq(profileData.showFeedbackAdminEntry, true, '管理员看到反馈管理按钮');
  eq(profileData.feedbackAdminPendingText, '8', '管理按钮显示待处理反馈数');
  eq(profileData.feedbackUnreadText, '2', '帮助与反馈行显示用户未读数');
  profileDef.applyFeedbackEntry.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: true, adminPendingCount: 120, handledUnreadCount: 0 }
  );
  eq(profileData.feedbackAdminPendingText, '99+', '管理待处理数过大时使用 99+');
  eq(profileData.feedbackUnreadCount, 0, '用户查看后隐藏帮助与反馈数字');
  profileDef.applyFeedbackEntry.call(
    { setData: patch => { profileData = { ...profileData, ...patch }; } },
    { isAdmin: false, adminPendingCount: 12, handledUnreadCount: 1 }
  );
  eq(profileData.showFeedbackAdminEntry, false, '普通用户不显示反馈管理按钮');
  eq(profileData.feedbackAdminPendingCount, 0, '普通用户不保留管理端计数');
  eq(/<button wx:if="\{\{showFeedbackAdminEntry\}\}"/.test(profileWxml), true,
    '反馈管理使用独立 Button 入口');
  eq(/profile-header[\s\S]*showFeedbackAdminEntry/.test(profileWxml)
    && !/bindlongpress/.test(profileWxml), true, '入口位于头像右侧且不再依赖长按');
  eq(/feedbackUnreadCount > 0[\s\S]*feedbackUnreadText/.test(profileWxml), true,
    '帮助与反馈行只在有未读时显示数字');
  eq(/\.profile-feedback-entry\s*\{[^}]*margin-left:\s*auto/.test(profileWxss), true,
    '反馈管理按钮右对齐');

  eq(adminAfterSalesWxml.includes('退款资金阻断'), true, '售后工作台顶部显示资金阻断告警');
  eq(adminAfterSalesWxml.includes('detail.case.failureReason'), true, '售后详情保留并展示退款失败原因');
  eq(adminAfterSalesWxml.includes('approveRefundLabel'), true, '异常售后单的按钮明确为重新发起退款');

  console.log('\n=== 6. 加购确认展示真实到期时间 ===');
  const now = Date.now();
  const currentExpiry = new Date(now + 40 * 86400000);
  let upgradeData = {
    membership: { member: true, memberExpiresAt: currentExpiry },
    upgradePackageId: 'task_pack_5',
    packages: serverPackages,
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
