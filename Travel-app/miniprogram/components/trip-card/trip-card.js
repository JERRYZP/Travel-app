const util = require('../../utils/util.js');

/**
 * 行程项卡片（首页行程状态墙的核心单元）
 *
 * 一张卡承载三层信息，必须**分开**呈现，不能混成一个状态词：
 *   ① 票务展示态（待抢票/可抢票/已约到/未抢到/待确认/免预约）—— 这是「这趟成了没」；
 *   ② 提醒送达态（未设提醒/待提醒/已提醒/未送达）—— 这是「我有没有被叫醒」；
 *   ③ 可做的动作（抢到没？/ 约其他日 / 菜单）—— 这是「现在能干嘛」。
 *
 * 票没抢到不等于提醒失败，提醒没送到也不等于没抢到。合成一个状态就再也说不清了。
 *
 * ⚠️ **两个状态各占卡片一侧**（2026-09-22 按设计稿）：提醒态紧跟景点名（以中性灰为底，
 *   仅未送达用警告色图标/描边/深色文字强化），票务态在卡片最右侧（彩底 chip）。
 *   分开不是排版偏好——它们是两个正交的轴，底色又是两套体系，放一起用户会当成
 *   同一个状态词的两个取值。
 *   两个 chip 的**文案都由服务端下发**（`ticketStateLabel` / `reminder.stateLabel`），
 *   这里只负责取色类，不做任何状态推导。
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
    /* 「还有其他日期可约」气泡的忽略态。⚠️ 与上面那个**不是同一个语义**
       （别问我结果 ≠ 别给我挽回方案），页面分开记 key（`itemId` vs `itemId:recover`）。 */
    recoverDismissed: { type: Boolean, value: false },
    /* 「没抢到」且确实还有别的日期可约（由页面按服务端的 recoveryCandidates 判定） */
    recoverable: { type: Boolean, value: false },
    recoverHint: { type: String, value: '' },
  },

  data: {
    stateClass: '',
    /* 卡上直接展示的票务标签，点不进菜单 */
    stateChip: '',
    /* 提醒状态：文案取服务端 stateLabel，色类取 util.reminderClass（none/waiting/done/miss） */
    reminderChip: '',
    reminderClass: '',
    /* 未送达的原因，供 missedreason 事件带出去（服务端只在 MISSED 时给值） */
    reminderReason: '',
    releaseLine: '',
    remainLine: '',
    remainTone: '',
    menuOpen: false,
  },

  observers: {
    'item, menuId, history': function (item, menuId, history) {
      if (!item) return;
      const reminder = item.reminder || {};
      const remain = util.releaseRemainderOf(item);
      this.setData({
        stateClass: util.stateClass(item.ticketState),
        stateChip: item.ticketStateLabel || '',
        reminderChip: reminder.stateLabel || '',
        reminderClass: util.reminderClass(reminder.state),
        reminderReason: reminder.reason || '',
        releaseLine: util.releaseLineOf(item),
        remainLine: remain.text,
        remainTone: remain.tone,
        menuOpen: !history && item.itemId === menuId,
      });
    },
  },

  methods: {
    onTapSpot() {
      this.triggerEvent('spot', { spotId: this.data.item.spotId });
    },

    /**
     * 副行绿色「现在预约」文字按钮。
     * 它和景点名走同一个事件，由首页打开景点详情浮窗；服务端
     * bookingEntryEnabled 决定放票后到出行日结束前仍可进入官方预约渠道。
     */
    onRemainTap() {
      if (this.data.history || this.data.remainTone !== 'go') return;
      if (!this.data.item || this.data.item.bookingEntryEnabled === false) return;
      this.triggerEvent('spot', { spotId: this.data.item.spotId, source: 'booking_entry' });
    },

    onMenuToggle() {
      /* ⚠️ 这一行是**诊断用**的，不是日志洁癖：这个「点菜单没反应」的 bug
         从 09-21 起被反复「修好」又复发，根因每次都不一样（2026-09-23 一次列全）：
           ① 事件名共用（`menu` 同时表示开合与编辑提醒）；
           ② `trip-section` 与 `home` 的 `bind:menutoggle` 没接上；
           ③ 弹出层把「关闭」挂在自己身上 → 点面板先关再开；
           ④ **唯一入口只有 52rpx 的图标，展开后被自己的全屏蒙层埋掉**（本轮真因）。
         前三次都是靠「看代码推测」，所以每次都只修掉当时能想到的那一种。
         留着这行，下次再复发时控制台会直接区分「点击没到达 handler」还是
         「到达了但状态没渲染」——这两类的排查方向完全相反。 */
      console.log('[tc-menu] toggle', this.data.item && this.data.item.itemId, '→', !this.data.menuOpen);
      if (this.data.history) return;
      this.triggerEvent('menutoggle', { itemId: this.data.item.itemId });
    },

    /**
     * 收起菜单。**只有两个调用方**：全屏蒙层（点空白处 =
     * 「关掉，但别开另一个」）与四个菜单项（点了就收）。
     *
     * ⚠️ 别再把它挂到 `.tc-menu-pop` 面板本身上（2026-09-23 删）：
     *   面板节点在 `.tc-menu`（`catchtap="onMenuToggle"`）**内部**，
     *   把关闭挂上去等于「点面板任意位置 = 先关再开」，菜单永远弹不出来，
     *   表现就是「点右侧菜单图标没反应」。面板上只留条目各自的 catchtap。
     */
    onMenuClose() {
      this.triggerEvent('menuclose');
    },

    /**
     * 点三点菜单的**开合**。
     *
     * ⚠️ 原来直接抛 `menu` 给页面，而页面把它接在「编辑提醒」上——
     * 于是同一个手势既开菜单又弹设置浮层。这里拆成两个事件：
     * `menutoggle`（开合，页面只翻 menuId）/ `editreminder`（菜单里那一项）。
     * （`onMenuToggleClick` 是拆分时留下的死方法，模板从未绑定，2026-09-22 删除。）
     */

    /* 三点菜单里的动作：标记结果 / 设置·修改提醒 / 约其他日 / 删除这一个行程项。
       ⚠️ 四个都要带 `itemId`：页面拿到才能直接定位，不依赖「当前展开的是哪张卡」
       这种隐式状态（菜单收起后那个状态就没了）。 */
    onMark() {
      this.triggerEvent('menuclose');
      this.triggerEvent('mark', { itemId: this.data.item.itemId });
    },

    onEditReminder() {
      this.triggerEvent('menuclose');
      this.triggerEvent('editreminder', { itemId: this.data.item.itemId });
    },

    onRecover() {
      this.triggerEvent('menuclose');
      this.triggerEvent('recover', { itemId: this.data.item.itemId });
    },

    onRemove() {
      this.triggerEvent('menuclose');
      this.triggerEvent('remove', { itemId: this.data.item.itemId });
    },

    /**
     * 点「未送达」chip —— 全卡唯一能触达未送达原因的入口。
     *
     * ⚠️ 这是 2026-09-22 补的：`pages/home/home.js` 的 `onMissedReason` 从 09-21
     *   就在那儿（明写 43101 / 密钥缺失 / 兜底三类原因），`bind:missedreason` 在
     *   `trip-section` 与 `home` 两端也都接着，唯独组件端**从来没抛过**这个事件。
     *   于是「提醒没送到」这个唯一会真正伤到用户的状态，在界面上完全不可见。
     *   别把这里改回纯展示——`reason` 必须跟着事件走，页面靠它区分文案。
     */
    onMissedTap() {
      this.triggerEvent('missedreason', {
        itemId: this.data.item.itemId,
        reason: this.data.reminderReason,
      });
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

    /* 「还有其他日期可约」气泡的忽略。与上一个是两个事件——
       页面用不同的 storage key 记，避免「先忽略追问、后补标没抢到」时
       把新冒出来的挽回气泡一起压掉。 */
    onDismissRecover() {
      this.triggerEvent('dismissrecover', { itemId: this.data.item.itemId });
    },
  },
});
