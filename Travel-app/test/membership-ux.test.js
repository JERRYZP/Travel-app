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
  eq(gate.membershipActionText, '¥2 开通并继续', '按钮直接说明继续原流程');

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
  eq(gate.membershipActionText, '¥2 加购并继续', '加购后继续原提交');

  console.log('\n=== 3. 会员过期后续费会恢复已购任务位 ===');
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
  eq(gate.upgradePackageId, 'member', '续费会员即可恢复原有 15 个任务位');
  eq(/开通会员后 30 天内可用 10 个任务位/.test(gate.membershipGateDesc), true,
    '有历史任务包时续费描述仍保持简单');

  console.log('\n=== 4. 页面结构与常驻入口 ===');
  const setupWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/setup/setup.wxml'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
  const profileJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.js'), 'utf8');
  const profileWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxss'), 'utf8');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  const membershipAll = [
    fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.wxml'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'miniprogram/pages/membership/membership.js'), 'utf8'),
  ].join('\n');

  eq(setupWxml.includes('wx:if="{{showMembershipGate}}"'), true, '付费块整体由额度不足开关控制');
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
  eq(profileData.memberCardDesc, '2026-11-26 到期｜任务位 3/10', '会员卡显示到期和任务位');
  eq(profileData.memberCardAction, '升级', '会员卡行动为升级');

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
