/**
 * 景点卡片（景点规则聚合页宫格 / 搜索结果共用）
 *
 * 数据来自 spots 云函数 buildCard，展示字段一次给全，前端不加工。
 * 聚合页卡片不渲染选择按钮（行动收敛到详情浮窗），整卡点击 → 详情。
 */
Component({
  properties: {
    spot: { type: Object, value: null },
  },

  methods: {
    onTap() {
      const spot = this.data.spot;
      if (spot && spot.spotId) {
        this.triggerEvent('cardtap', { spotId: spot.spotId });
      }
    },
  },
});
