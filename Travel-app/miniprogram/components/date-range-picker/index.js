/**
 * 半屏日期范围选择器
 * 选择开始/结束日期，底部悬浮确认按钮实时反馈范围与天数。
 * 全系统时间 GMT+8 (TIME-RULE-001)，输入输出均为 'YYYY-MM-DD'。
 */
const util = require('../../utils/util.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseLocal(s) {
  if (!s) return null;
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    minDate: { type: String, value: '' },
    maxDate: { type: String, value: '' },
    start: { type: String, value: '' },
    end: { type: String, value: '' },
  },

  data: {
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    months: [],
    startStr: '',
    endStr: '',
    rangeText: '请选择出行日期',
    canConfirm: false,
  },

  observers: {
    'show': function (val) {
      if (val) this.init();
    },
  },

  methods: {
    init() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const min = this.data.minDate ? parseLocal(this.data.minDate) : today;
      const max = this.data.maxDate ? parseLocal(this.data.maxDate) : new Date(today.getTime() + 90 * 86400000);
      this.buildMonths(min, max, this.data.start, this.data.end);
    },

    buildMonths(min, max, startStr, endStr) {
      const months = [];
      let cur = new Date(min.getFullYear(), min.getMonth(), 1);
      const last = new Date(max.getFullYear(), max.getMonth(), 1);
      while (cur.getTime() <= last.getTime()) {
        months.push(this.buildMonth(cur, min, max));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      this.applySelection(months, startStr, endStr);
    },

    buildMonth(monthFirst, min, max) {
      const year = monthFirst.getFullYear();
      const month = monthFirst.getMonth();
      const title = year + '年' + (month + 1) + '月';
      const days = [];
      const firstWeekday = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let i = 0; i < firstWeekday; i++) {
        days.push({ date: '', day: '', disabled: true, inRange: false, isStart: false, isEnd: false });
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const dateStr = fmtStr(dateObj);
        const disabled = dateObj.getTime() < min.getTime() || dateObj.getTime() > max.getTime();
        days.push({ date: dateStr, day: d, disabled, inRange: false, isStart: false, isEnd: false });
      }
      return { key: year + '-' + (month + 1), title, days };
    },

    applySelection(months, startStr, endStr) {
      const ms = months.map(m => Object.assign({}, m, {
        days: m.days.map(d => {
          if (!d.date) return d;
          const inRange = startStr && endStr && d.date > startStr && d.date < endStr;
          const isStart = d.date === startStr;
          const isEnd = d.date === endStr;
          return Object.assign({}, d, { inRange, isStart, isEnd });
        }),
      }));
      let rangeText = '请选择出行日期';
      let canConfirm = false;
      if (startStr && endStr) {
        rangeText = util.formatDateWithWeek(startStr) + ' - ' + util.formatDateWithWeek(endStr) + ' · 共' + util.dayDiff(startStr, endStr) + '天';
        canConfirm = true;
      } else if (startStr) {
        rangeText = '已选开始，请选结束日期';
      }
      this.setData({ months: ms, startStr, endStr, rangeText, canConfirm });
    },

    onDayTap(e) {
      const date = e.currentTarget.dataset.date;
      const disabled = e.currentTarget.dataset.disabled;
      if (!date || disabled === true || disabled === 'true') return;
      let { startStr, endStr } = this.data;
      if (!startStr || (startStr && endStr)) {
        startStr = date;
        endStr = '';
      } else if (date < startStr) {
        startStr = date;
        endStr = '';
      } else if (date === startStr) {
        endStr = date;
      } else {
        endStr = date;
      }
      this.applySelection(this.data.months, startStr, endStr);
    },

    onConfirm() {
      if (!this.data.canConfirm) return;
      this.triggerEvent('confirm', { start: this.data.startStr, end: this.data.endStr });
    },

    onClose() {
      this.triggerEvent('close');
    },

    noop() {},
  },
});
