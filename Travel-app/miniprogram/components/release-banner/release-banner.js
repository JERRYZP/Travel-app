/**
 * 吸顶放票横幅
 *
 * 跨**全部当前/未来行程**取全局最近的一条放票（决策文档 2.4）——用户不关心
 * 「哪趟行程的提醒最近」，只关心「接下来该抢哪张票」。
 *
 * 文案由服务端给（task.buildReleaseBanner）：刻意避开「还有 N 分钟」，
 * 因为推送是在开票**前 N 分钟**发的，横幅讲的是**开票时刻本身**，
 * 两者混用会让用户以为「是不是已经提醒过我了」。
 */
Component({
  properties: {
    banner: { type: Object, value: null },
  },
  methods: {
    /* 直达该行程项的详情浮窗（预约入口 + 倒计时） */
    onTap() {
      const b = this.data.banner;
      if (!b) return;
      this.triggerEvent('open', { itemId: b.itemId, spotId: b.spotId });
    },
  },
});
