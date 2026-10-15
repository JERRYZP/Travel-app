/**
 * 自有公众号入口（「我的」列表项 + 设置提醒成功态）的结构与交互约定。
 *
 * 运行：node test/oa-follow-entry.test.js
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

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = p => fs.existsSync(path.join(ROOT, p));

/**
 * 取 `name(...) { ... }` 的方法定义体（花括号配平）。
 *
 * 跳过 `this.submitTask({...});` 这类**调用**：只有参数括号之后紧跟 `{` 的才算定义。
 */
function fnBody(src, name) {
  let at = -1;
  let open = -1;
  for (;;) {
    at = src.indexOf(name + '(', at + 1);
    if (at < 0) return '';
    let depth = 0;
    let i = at + name.length;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const brace = src.slice(i + 1).match(/^\s*\{/);
    if (brace) {
      open = i + 1 + brace[0].length - 1;
      break;
    }
  }
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

const OA = read('miniprogram/utils/official-account.js');
const SHEET_JS = read('miniprogram/components/oa-follow-sheet/oa-follow-sheet.js');
const SHEET_WXML = read('miniprogram/components/oa-follow-sheet/oa-follow-sheet.wxml');
const SHEET_WXSS = read('miniprogram/components/oa-follow-sheet/oa-follow-sheet.wxss');
const PROFILE_JS = read('miniprogram/pages/profile/profile.js');
const PROFILE_WXML = read('miniprogram/pages/profile/profile.wxml');
const PROFILE_JSON = read('miniprogram/pages/profile/profile.json');
const SETUP_JS = read('miniprogram/pages/setup/setup.js');
const SETUP_WXML = read('miniprogram/pages/setup/setup.wxml');
const SETUP_JSON = read('miniprogram/pages/setup/setup.json');

console.log('=== 1. 公众号信息只有一个出处，页面不写死名称 ===');
{
  eq(has('miniprogram/utils/official-account.js'), true, '存在 utils/official-account.js');
  eq(/NAME\s*=\s*'智序准点游'/.test(OA), true, '公众号名称为「智序准点游」');
  eq(/fromLocalPath\(QR_PATH\)/.test(OA), true, '二维码经 assets.fromLocalPath 转云地址');
  eq(/QR_PATH\s*=\s*'\/images\/qrcodes\//.test(OA), true,
    '二维码指向 /images/qrcodes/（云存储镜像，不进代码包）');
  /* 代码包图片额度只剩约 2.4KB，二维码一旦进包就顶爆 200KB 硬线 */
  eq(/cloud-assets\/images\/qrcodes/.test(OA), true, '注释里指明云资源源文件位置');
  eq(has('cloud-assets/images/qrcodes/zhundianyou-oa.jpg'), true,
    '公众号二维码源文件已在 cloud-assets/images/qrcodes/');
  /* 配置路径必须和实际源文件同名同后缀，否则云上取不到图 */
  eq(/QR_PATH\s*=\s*'\/images\/qrcodes\/zhundianyou-oa\.jpg'/.test(OA), true,
    'QR_PATH 与源文件名一致');

  const pages = [
    ['profile.js', PROFILE_JS], ['profile.wxml', PROFILE_WXML],
    ['setup.js', SETUP_JS], ['setup.wxml', SETUP_WXML],
    ['oa-follow-sheet.js', SHEET_JS], ['oa-follow-sheet.wxml', SHEET_WXML],
  ];
  pages.forEach(([name, src]) => {
    eq(/['"][^'"]*准点游[^'"]*['"]/.test(src), false, name + ' 不硬编码公众号名');
  });
  eq(/require\('\.\.\/\.\.\/utils\/official-account\.js'\)/.test(PROFILE_JS), true,
    '「我的」页从配置取文案');
  eq(/require\('\.\.\/\.\.\/utils\/official-account\.js'\)/.test(SETUP_JS), true,
    '设置提醒页从配置取文案');
  eq(/require\('\.\.\/\.\.\/utils\/official-account\.js'\)/.test(SHEET_JS), true,
    '关注弹层从配置取文案与二维码');
}

console.log('=== 2. 关注弹层是共用组件，二维码可长按识别 ===');
{
  ['js', 'json', 'wxml', 'wxss'].forEach(ext => {
    eq(has(`miniprogram/components/oa-follow-sheet/oa-follow-sheet.${ext}`), true,
      `组件四件套 .${ext}`);
  });
  eq(/\.oa-mask\s*\{[^}]*position:\s*fixed/.test(SHEET_WXSS), true, '弹层 fixed 定位');
  eq(/show-menu-by-longpress/.test(SHEET_WXML), true, '二维码支持长按识别');
  eq(/binderror="onQrError"/.test(SHEET_WXML), true, '云图加载失败有降级回调');
  eq(/qrFailed/.test(SHEET_WXML) && /qrFailed/.test(SHEET_JS), true, '失败态渲染搜索引导，不留白框');
  eq(/observers:/.test(SHEET_JS) && /qrFailed:\s*false/.test(SHEET_JS), true,
    '重新打开时重试云图');
  eq(/triggerEvent\('close'\)/.test(SHEET_JS), true, '关闭回传给调用页');
  eq(/position:\s*fixed/.test(SHEET_WXSS) && /z-index/.test(SHEET_WXSS), true, '浮层在同级层叠上下文里');

  [['profile.json', PROFILE_JSON], ['setup.json', SETUP_JSON]].forEach(([name, src]) => {
    eq(/"oa-follow-sheet":\s*"\/components\/oa-follow-sheet\/oa-follow-sheet"/.test(src), true,
      name + ' 注册了关注弹层');
  });
  eq(/<oa-follow-sheet\s+show="\{\{showOaSheet\}\}"\s+bind:close="onCloseOaSheet"\s*\/>/.test(PROFILE_WXML), true,
    '「我的」页挂载弹层并接收 close');
  eq(/<oa-follow-sheet\s+show="\{\{showOaSheet\}\}"\s+bind:close="onCloseOaSheet"\s*\/>/.test(SETUP_WXML), true,
    '设置提醒页挂载弹层并接收 close');
}

console.log('=== 3. 只留入口，不强引流 ===');
{
  /* 「我的」：新增一行，提示语是攻略/入口，不是「立刻关注」 */
  eq(/onFollowOa/.test(PROFILE_WXML) && /onFollowOa\s*\(\)/.test(PROFILE_JS), true,
    '「我的」有一行可点的公众号入口');
  eq(/oaRowLabel/.test(PROFILE_WXML) && /oaRowHint/.test(PROFILE_WXML), true,
    '列表项文案同样取自配置');
  /* 位置：最下面、独立一张卡，与上面几项隔开 */
  eq(/<view class="setting-card">\s*(?:<!--[\s\S]*?-->\s*)?<view class="setting-row" bindtap="onFollowOa">/.test(PROFILE_WXML), true,
    '公众号入口自成一张卡，不与提醒设置/使用攻略混排');
  eq(PROFILE_WXML.indexOf('bindtap="onFollowOa"') > PROFILE_WXML.indexOf('bindtap="onLegal"'), true,
    '公众号入口排在隐私政策 / 用户服务协议之后');
  const oaRowAt = PROFILE_WXML.indexOf('bindtap="onFollowOa"');
  const oaCardAt = PROFILE_WXML.lastIndexOf('<view class="setting-card">', oaRowAt);
  eq((PROFILE_WXML.slice(oaCardAt).match(/class="setting-row"/g) || []).length, 1,
    '公众号入口是最后一个设置项');
  eq(PROFILE_WXML.indexOf('<view class="setting-card">', oaCardAt + 1), -1,
    '公众号那张卡在页面最下面');
  eq(/\.setting-card\s*\{[^}]*margin-bottom/.test(read('miniprogram/pages/profile/profile.wxss')), true,
    '卡片之间保留间距（与上面的设置项分开）');
  eq(/loadNotifyHint\(\)/.test(fnBody(PROFILE_JS, 'onShow')), true, '「我的」onShow 照旧刷状态');
  eq(/showOaSheet/.test(fnBody(PROFILE_JS, 'onShow')), false,
    '进「我的」页不自动弹二维码');
  eq(/showOaSheet:\s*true/.test(fnBody(PROFILE_JS, 'onFollowOa')), true,
    '只有点列表项才打开弹层');

  /* 设置提醒：成功态才出现入口，且不自动打开弹层 */
  eq(/onSuccessOa/.test(SETUP_WXML) && /onSuccessOa\s*\(\)/.test(SETUP_JS), true,
    '成功卡片里有公众号出口');
  eq(/showOaSheet/.test(fnBody(SETUP_JS, 'onShow')), false,
    '进入设置页不自动弹二维码');
  eq(fnBody(SETUP_JS, 'onSuccessOa').indexOf('clearAutoBack()') <
     fnBody(SETUP_JS, 'onSuccessOa').indexOf('showOaSheet: true'), true,
     '打开二维码前先取消自动回首页');
  eq(/onSuccessSkip/.test(SETUP_WXML) && /goHome\(\)/.test(fnBody(SETUP_JS, 'onSuccessSkip')), true,
    '点卡片外任意处立即回首页');
  eq(fnBody(SETUP_JS, 'onCloseOaSheet').indexOf('showOaSheet: false') <
     fnBody(SETUP_JS, 'onCloseOaSheet').indexOf('goHome()'), true,
     '看完二维码直接回首页');
  eq(/clearAutoBack\(\)/.test(fnBody(SETUP_JS, 'onUnload')), true,
    '页面卸载清掉定时器');
}

console.log('=== 4. 成功反馈只有一份 ===');
{
  const submit = fnBody(SETUP_JS, 'submitTask');
  const okBranch = submit.slice(0, submit.indexOf('.catch(err'));
  eq(/wx\.showToast/.test(okBranch), false, '提交成功分支不再额外弹 toast');
  eq(/showSuccess:\s*true/.test(okBranch), true, '成功分支展示成功卡片');
  eq(/AUTO_BACK_SECONDS\s*=\s*4/.test(SETUP_JS), true, '默认自动关闭时间 4 秒');
  eq(/_backTimer = setTimeout\(\(\) => this\.goHome\(\), AUTO_BACK_SECONDS \* 1000\)/.test(okBranch), true,
    '成功卡片按 4 秒自动回首页');
  eq(/_countdownTimer = setInterval/.test(okBranch), true, '倒计时按秒刷新');
  eq(/clearAutoBack\(\)/.test(fnBody(SETUP_JS, 'onSuccessOa')) &&
     /clearAutoBack\(\)/.test(fnBody(SETUP_JS, 'goHome')), true,
     '自动返回与倒计时一起取消');
  eq(/clearInterval\(this\._countdownTimer\)/.test(fnBody(SETUP_JS, 'clearAutoBack')), true,
     '取消时清理的是 interval');
  eq(/getCurrentPages\(\)/.test(fnBody(SETUP_JS, 'goHome')), true,
    '回首页仍按页面栈深度计算 delta');
  eq(/success-mask[\s\S]{0,400}?bindtap="onSuccessSkip"/.test(SETUP_WXML), true,
    '成功卡片带遮罩点击出口');
  eq(/class="success-close" bindtap="onSuccessSkip"/.test(SETUP_WXML), true,
    '右上角有主动关闭');
  eq(/success-countdown">\{\{successCountdown\}\} 秒后自动返回首页/.test(SETUP_WXML), true,
    '底部有弱化倒计时提示');
  eq(/\.success-countdown\s*\{[^}]*color:\s*var\(--text-faint\)/.test(read('miniprogram/pages/setup/setup.wxss')), true,
    '倒计时提示用弱化文字色，不抢主信息');
}

if (fail) {
  console.log('\n共 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('\n全部通过');
