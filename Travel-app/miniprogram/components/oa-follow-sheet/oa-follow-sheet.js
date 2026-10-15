/**
 * 公众号关注弹层（自有账号，仅保留入口，不做强引流）。
 *
 * 用它的地方：`pages/profile`（「我的」列表项）与 `pages/setup`（设置提醒成功态）。
 * 名称/二维码/文案统一来自 `utils/official-account.js`，组件本身不写死公众号信息。
 *
 * ⚠️ 二维码是云图，必须走运行时变量（`data.qr`）。写成字面量参数会被
 *    `scripts/check-miniprogram.py` 拦下，开发者工具预览也会 ENOENT。
 * ⚠️ 二维码没上传/加载失败时不渲染空白图框，降级成「搜一搜公众号名」文案。
 */
const oa = require('../../utils/official-account.js');

Component({
  properties: {
    /** 是否展示；由调用方控制，组件从不自己打开 */
    show: { type: Boolean, value: false },
  },

  data: {
    name: oa.NAME,
    qr: oa.QR,
    title: oa.SHEET_TITLE,
    subtitle: oa.SHEET_SUBTITLE,
    foot: oa.SHEET_FOOT,
    fallbackHint: oa.SHEET_FALLBACK_HINT,
    closeText: oa.SHEET_CLOSE,
    qrFailed: false,
  },

  observers: {
    /* 每次重新打开都重试一次云图：上一次失败可能只是网络问题 */
    show(value) {
      if (value && this.data.qrFailed) this.setData({ qrFailed: false });
    },
  },

  methods: {
    onClose() { this.triggerEvent('close'); },
    onQrError() { this.setData({ qrFailed: true }); },
    noop() {},
  },
});
