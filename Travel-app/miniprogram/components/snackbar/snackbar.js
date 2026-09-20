/**
 * 底部撤销条（4 秒）
 *
 * 用页面底部的轻量条，**不用系统 Toast、不用弹窗**（决策文档 3.3）：
 * Toast 会挡住「刚标记的那张卡」的即时反馈，弹窗则会打断——
 * 撤销是处理误触的补救，不该比误触本身更重。
 *
 * 倒计时由组件自己跑：外层只管把 show 置 true 并给 duration，
 * 时间到了回调 onExpire，页面据此锁定结果（之后不可再改）。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    text: { type: String, value: '' },
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
