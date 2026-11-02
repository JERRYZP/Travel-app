/**
 * 首页顶部布局锁定值。
 *
 * 用户已确认的视觉结果：
 * - 正文第一块以微信胶囊实际 bottom 为基准，不再被固定导航块透明区撑高；
 * - 胶囊下方保留 8rpx 呼吸位，再精确追加 2 CSS 像素；
 * - 无横幅卡片、额度提示或放票横幅共享同一个起点。
 *
 * 修改这里必须同步运行 test/home-top-layout.test.js。
 */

const NAV_BAR_RPX = 88;
const PAGE_GAP_RPX = 8;
const EXTRA_TOP_PX = 2;

function pageTopOf(statusBarHeight, menuButton, windowWidth) {
  const width = Number(windowWidth) || 375;
  const status = Number(statusBarHeight) || 20;
  const navBottomRpx = status * 750 / width + NAV_BAR_RPX;
  const capsuleBottom = Number(menuButton && menuButton.bottom) || 0;
  const capsuleBottomRpx = capsuleBottom > 0 ? capsuleBottom * 750 / width : 0;
  const contentBaseRpx = capsuleBottomRpx > 0 ? capsuleBottomRpx : navBottomRpx;
  return Math.ceil(contentBaseRpx + PAGE_GAP_RPX + EXTRA_TOP_PX * 750 / width);
}

module.exports = {
  NAV_BAR_RPX,
  PAGE_GAP_RPX,
  EXTRA_TOP_PX,
  pageTopOf,
};
