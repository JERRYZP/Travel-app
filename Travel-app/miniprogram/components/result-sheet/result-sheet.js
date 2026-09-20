/**
 * 「标记结果」BottomSheet
 *
 * 用途：① 次入口——已过 24 小时转「开过票了」的补标；
 *      ② 从三点菜单主动标记（用户自己想起来要标）。
 *
 * 主入口仍是卡片上的可抢态气泡（决策文档 4.1）：
 * 开票后卡片上直接问，不用用户进菜单。这个 Sheet 是「漏了那一次」的补救。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    spotName: { type: String, value: '' },
    /* 已标记过的结果，用于二次进入时回显 */
    current: { type: String, value: '' },
  },

  data: { choice: '' },

  observers: {
    show: function (show) {
      /* 每次打开都从已有结果回显，而不是记住上次的选择——
         否则用户以为改过了，实际只是回显 */
      if (show) this.setData({ choice: this.data.current || '' });
    },
  },

  methods: {
    onChoose(e) {
      this.setData({ choice: e.currentTarget.dataset.value });
    },
    onConfirm() {
      if (!this.data.choice) return;
      this.triggerEvent('confirm', { result: this.data.choice });
    },
    onSkip() { this.triggerEvent('close'); },
    onClose() { this.triggerEvent('close'); },
    noop() {},
  },
});
