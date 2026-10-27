/**
 * 自有公众号（「智序准点游」服务号）的唯一出处。
 *
 * 规则：公众号只做「留一个入口」，不做强引流 ——
 * 小程序内两处入口（「我的」列表项、设置提醒成功的轻量出口）都从这里取
 * 名称/二维码/文案，改文案只改本文件，不得在页面或组件里另写一份硬编码。
 *
 * ⚠️ 二维码必须走云存储：代码包内图片/音频额度只剩约 2.4KB（见
 *    docs/engineering/frontend-pitfalls.md），二维码进包会直接顶爆 200KB 硬线。
 *    源文件放仓库根目录 `cloud-assets/images/qrcodes/zhundianyou-oa.jpg`，
 *    用 `scripts/upload-cloud-assets.sh` 上传到 `static/v0.3/images/qrcodes/`。
 *
 * 二维码还没上传时不留白框：`oa-follow-sheet` 的 `<image binderror>` 会降级成
 * 「微信搜一搜公众号名」文案，入口照常可用。
 */
const assets = require('./assets.js');

const NAME = '智序准点游';
const QR_PATH = '/images/qrcodes/zhundianyou-oa.jpg';

module.exports = {
  /** 公众号名称（微信内唯一可搜到的关注路径） */
  NAME,
  /** 云存储二维码地址；未上传时组件降级为搜索引导 */
  QR: assets.fromLocalPath(QR_PATH),

  /** 「我的」列表项 */
  ROW_LABEL: '关注公众号',
  ROW_HINT: '攻略 · 小程序入口',

  /** 关注弹层 */
  SHEET_TITLE: '关注「' + NAME + '」看攻略',
  SHEET_SUBTITLE: '每日放票时间表和预约攻略都在这里；公众号菜单里也放了小程序入口。',
  SHEET_FOOT: '长按图片识别二维码关注',
  SHEET_FALLBACK_NAME: NAME,
  SHEET_FALLBACK_HINT: '在微信「搜一搜」里搜索这个公众号名，关注即可',
  SHEET_CLOSE: '知道了',

  /** 设置提醒成功态里的轻量出口（一行文字，点开才是二维码） */
  SETUP_ENTRY: '关注「' + NAME + '」，看每日放票攻略',
};
