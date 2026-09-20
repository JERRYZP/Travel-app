const util = require('../../utils/util.js');

/**
 * 「约其他日」BottomSheet
 *
 * 两段式，按服务端 recoveryCandidates 的三层规则驱动：
 *   - 有候选 → 列出候选（已开票的「现在就能约」在前，未开票的「到点放票」在后）；
 *   - 无候选 → **保持静默**，不给「延长行程」这类空转建议（延长出去的新日期同样无票可抢）。
 *
 * 候选由页面传入（服务端算）；这里只负责选一个 + 回传。
 * 不放任何「余票」「约满」字样——V1 没有可靠的余票数据源，宁可不说，不编一个。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    /* [{visitDate, releaseAt, action: 'BOOK_NOW'|'SET_REMINDER', label}] */
    candidates: { type: Array, value: [] },
    spotName: { type: String, value: '' },
    loading: { type: Boolean, value: false },
  },

  data: { choice: '', options: [] },

  observers: {
    'show, candidates': function (show, candidates) {
      if (!show) return;
      const options = (candidates || []).map(c => Object.assign({}, c, {
        dateText: util.dayTitleOf(c.visitDate),
        actionText: c.action === 'BOOK_NOW' ? '现在就能约' : '到点放票',
        actionClass: c.action === 'BOOK_NOW' ? 'now' : 'later',
      }));
      this.setData({ choice: options.length ? options[0].visitDate : '', options });
    },
  },

  methods: {
    onChoose(e) {
      this.setData({ choice: e.currentTarget.dataset.date });
    },
    onConfirm() {
      const hit = (this.data.options || []).find(o => o.visitDate === this.data.choice);
      if (!hit) return;
      this.triggerEvent('confirm', hit);
    },
    onClose() { this.triggerEvent('close'); },
    noop() {},
  },
});
