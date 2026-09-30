const assets = require('../../utils/assets.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
  },

  data: {
    sampleShots: [
      { key: 'style-1', label: '通知中心 / 锁屏通知', src: assets.reminderSample('style-1'), pending: false },
      { key: 'style-2', label: '提醒卡片详情', src: assets.reminderSample('style-2'), pending: false },
      { key: 'style-3', label: '微信内的提醒样式', src: assets.reminderSample('style-3'), pending: false },
    ],
  },

  methods: {
    onClose() { this.triggerEvent('close'); },
    onPreview(e) {
      const src = e.currentTarget.dataset.src;
      if (!src) return;
      wx.previewImage({ current: src, urls: [src] });
    },
    noop() {},
  },
});
