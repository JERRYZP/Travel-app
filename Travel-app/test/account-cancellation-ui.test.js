/** 注销入口、说明页和成功清缓存的静态行为锚点。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function main() {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.ok(appJson.pages.includes('pages/account-cancellation/account-cancellation'));

  const editWxml = read('miniprogram/pages/profile-edit/profile-edit.wxml');
  const editJs = read('miniprogram/pages/profile-edit/profile-edit.js');
  assert.ok(editWxml.includes('账号与安全'));
  assert.ok(editWxml.includes('注销账户'));
  assert.ok(editWxml.includes('bindtap="onAccountSecurity"'));
  assert.ok(editJs.includes('onAccountSecurity'));
  assert.ok(editJs.includes('当前修改未保存'));

  const wxml = read('miniprogram/pages/account-cancellation/account-cancellation.wxml');
  const wxss = read('miniprogram/pages/account-cancellation/account-cancellation.wxss');
  const js = read('miniprogram/pages/account-cancellation/account-cancellation.js');
  assert.ok(wxml.includes('您将注销本小程序账户'));
  assert.ok(wxml.includes('不会注销你的微信账号'));
  assert.ok(wxml.includes('注销后会删除'));
  assert.ok(wxml.includes('class="details-card"'));
  assert.ok(wxml.includes('wx:if="{{summary.membershipActive}}"'));
  assert.ok(!wxml.includes('仅在必要期限保留'));
  assert.ok(wxss.includes('.detail-section + .detail-section'));
  assert.ok(wxml.includes('我已了解，注销后数据无法恢复'));
  assert.ok(wxml.includes('{{(!canErase || !acknowledged || erasing) ? \'disabled\' : \'\'}}'));
  assert.ok(js.includes("api.account.preflight()"));
  assert.ok(js.includes("api.account.erase()"));
  assert.ok(js.includes('确认注销当前账户？此操作不可恢复'));
  assert.ok(js.includes('wx.clearStorageSync()'));
  assert.ok(js.includes("wx.reLaunch({ url: '/pages/home/home' })"));

  const api = read('miniprogram/utils/api.js');
  assert.ok(api.includes("'account.preflight'"));
  assert.ok(api.includes("call('account', { action: 'account.preflight' })"));
  assert.ok(api.includes("confirmation: 'ERASE_MY_ACCOUNT'"));

  const mock = read('miniprogram/utils/mock.js');
  assert.ok(mock.includes("handlers['account.preflight']"));
  assert.ok(mock.includes("handlers['account.erase']"));
  assert.ok(mock.includes("PAYMENT_RECONCILING"));
  console.log('account-cancellation-ui.test.js 全部通过');
}

main();
