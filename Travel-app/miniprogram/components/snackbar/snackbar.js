/**
 * 底部撤销条（4 秒）
 *
 * 用页面底部的轻量条，**不用系统 Toast、不用弹窗**（决策文档 3.3）：
 * Toast 会挡住「刚标记的那张卡」的即时反馈，弹窗则会打断——
 * 撤销是处理误触的补救，不该比误触本身更重。
 *
 * ⚠️ 文案是**分段**的（2026-09-22 按设计稿）：`故宫博物院 已标记为「抢到了」` 里
 *   只有「抢到了」着色（成功绿 / 失败朱砂）。所以 text 拆成
 *   `lead + highlight + tail` 三段 + 一个 tone，由页面用 `util.snackbarPartsOf` 拼好
 *   ——**别退回单段 text**，那样就染不了色，设计稿的红绿对照会丢。
 *
 * 倒计时由组件自己跑：外层只管把 show 置 true 并给 duration，
 * 时间到了回调 onExpire，页面据此锁定结果（之后不可再改）。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    /* 分段文案：lead + 「highlight」 + tail，highlight 按 tone 着色 */
    lead: { type: String, value: '' },
    highlight: { type: String, value: '' },
    tail: { type: String, value: '' },
    tone: { type: String, value: '' },   // '' | 'success' | 'failed'
    /* 撤销窗口秒数：服务端 V1.RESULT_UNDO_SECONDS 同步过来，
       不在这里写死——两边不一致会让「看起来能撤，点了说过期」 */
    duration: { type: Number, value: 4 },
  },

  data: { progress: 100 },

  observers: {
    show: function (show) {
      if (show) this.startCountdown();
      else this.stopCountdown();
    },
  },

  detached() { this.stopCountdown(); },

  methods: {
    startCountdown() {
      this.stopCountdown();
      const total = Math.max(1, this.data.duration) * 1000;
      const started = Date.now();
      this.setData({ progress: 100 });
      /* 用 50ms 步进驱动进度条收缩，视觉上让「还剩多久」可见——
         不显示倒计时的撤销条会让用户不确定它还在不在 */
      this._timer = setInterval(() => {
        const left = total - (Date.now() - started);
        if (left <= 0) {
          this.stopCountdown();
          this.setData({ progress: 0 });
          this.triggerEvent('expire');
          return;
        }
        this.setData({ progress: Math.round((left / total) * 100) });
      }, 50);
    },

    stopCountdown() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    onUndo() {
      this.stopCountdown();
      this.triggerEvent('undo');
    },
  },
});
