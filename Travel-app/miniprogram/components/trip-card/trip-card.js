const util = require('../../utils/util.js');

/**
 * 行程项卡片（首页行程状态墙的核心单元）
 *
 * 一张卡承载三层信息，必须**分开**呈现，不能混成一个状态词：
 *   ① 票务展示态（待抢/可抢/已成/未成/开过票了/免预约）—— 这是「这趟成了没」；
 *   ② 提醒送达态（待提醒/已提醒/未送达）—— 这是「我有没有被叫醒」；
 *   ③ 可做的动作（抢到没？/ 约其他日 / 菜单）—— 这是「现在能干嘛」。
 *
 * 票没抢到不等于提醒失败，提醒没送到也不等于没抢到。合成一个状态就再也说不清了。
 */
Component({
  properties: {
    item: { type: Object, value: null },
    /* 历史行程：整体灰化、无操作按钮，只能点进景点详情回看 */
    history: { type: Boolean, value: false },
    /* 展开的三点菜单的 itemId（由页面统一管，保证同屏只有一个菜单开着） */
    menuId: { type: String, value: '' },
    /* 气泡被划掉后，这一点已经不再主动追问 */
    bubbleDismissed: { type: Boolean, value: false },
    /* 「没抢到」且确实还有别的日期可约（由页面按服务端的 recoveryCandidates 判定） */
    recoverable: { type: Boolean, value: false },
    recoverHint: { type: String, value: '' },
  },

  data: {
    stateClass: '',
    reminderClass: '',
    releaseLine: '',
    countdown: '',
    menuOpen: false,
    /* 卡上直接展示的状态标签，点它看详情（不藏在菜单里） */
    stateChip: '',
  },

  observers: {
    'item, menuId, history': function (item, menuId, history) {
      if (!item) return;
      this.setData({
        stateClass: util.stateClass(item.ticketState),
        reminderClass: util.reminderClass(item.reminder && item.reminder.state),
        releaseLine: util.releaseLineOf(item),
        countdown: util.countdownTextOf(item.visitDate),
        menuOpen: !history && item.itemId === menuId,
        stateChip: item.ticketStateLabel || '',
      });
    },
  },

  methods: {
    onTapSpot() {
      this.triggerEvent('spot', { spotId: this.data.item.spotId });
    },

    onMenuToggle() {
      if (this.data.history) return;
      this.triggerEvent('menu', { itemId: this.data.item.itemId });
    },

    onMenuClose() {
      this.triggerEvent('menuclose');
    },

    /* 三点菜单里的动作：标记结果 / 修改提醒设置 / 删除行程项 */
    onMark() {
      this.triggerEvent('menuclose');
      this.triggerEvent('mark', { itemId: this.data.item.itemId });
    },

    onEditReminder() {
      this.triggerEvent('menuclose');
      this.triggerEvent('editreminder', { itemId: this.data.item.itemId });
    },

    onRemove() {
      this.triggerEvent('menuclose');
      this.triggerEvent('remove', { itemId: this.data.item.itemId });
    },

    /* 可抢态卡片上的两键气泡 */
    onResult(e) {
      this.triggerEvent('result', {
        itemId: this.data.item.itemId,
        result: e.currentTarget.dataset.result,
      });
    },

    onDismissBubble() {
      this.triggerEvent('dismiss', { itemId: this.data.item.itemId });
    },

    /* 「未成且没有备选」时卡片下方的挽回快捷入口 */
    onRecover() {
      this.triggerEvent('recover', { itemId: this.data.item.itemId });
    },

    /* 提醒未送达是状态不是普通操作：点状态标签看原因 */
    onReminderTap() {
      const r = this.data.item.reminder;
      if (!r || r.state !== 'MISSED') return;
      this.triggerEvent('missedreason', { itemId: this.data.item.itemId, reason: r.reason });
    },
  },
});
