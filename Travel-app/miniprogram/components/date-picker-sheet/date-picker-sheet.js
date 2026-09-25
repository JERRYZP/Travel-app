/**
 * 单日期选择 Sheet（日历网格版 · 纵向滑动切月，2026-09-24 改版）
 *
 * 交互规则：
 * - **上下滑动切换月份**（纵向 `swiper`），原来的左右点箭头已删除
 * - 已有行程覆盖的日期 → 浅米色背景条带
 * - 该景点已存在行程的日期 → 不可选（置灰）
 * - 周一起始
 *
 * ⚠️ **为什么从「左右点箭头」改成上下滑**（用户口径，2026-09-24）：
 *   找一个月要连点好几下，而且箭头贴在标题两侧、离手指常驻位置远。
 *   纵向滑动一次翻一整月，手势方向也和「日期是一行行往下排的」一致。
 *   月份标题随之**不再承担翻页功能**，只做当前位置的指示（滑到哪显示哪）。
 *
 * ⚠️ `choice` **不参与网格构建**：选中态在模板里用 `item.date === choice` 判——
 *   WXML 支持 `===`，而 `indexOf` 这类方法调用会**静默失效**（项目踩过）。
 *   于是点一天只需 `setData({ choice })`，不必把 12 个月 × 40 多个格子重算一遍。
 */

/* 从 minDate 所在月起向后生成多少个月。
   旧实现是无限翻页（箭头没有尽头），滑动式必须给出确定的可滑范围。
   取 12：放票提前量最多 10 天（`rules.json` 的 advanceDays 上限），
   用户真正会选的出行日都在近几个月内，一年是远超需求的宽松上界。 */
const MONTH_HORIZON = 12;

/* 网格固定 6 行高。各月行数不一（4~6 行），不固定高度时滑到下个月会整体跳动。 */
const ROWS = 6;
const CELL_RPX = 88;

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Component({
  properties: {
    show: { type: Boolean, value: false },
    spotName: { type: String, value: '' },
    /* 标题后缀，如「约其他日」「设置提醒」，最终标题 = spotName + '·' + title */
    title: { type: String, value: '约其他日' },
    /* 所有已有行程覆盖的日期集合（用于浅色背景条带） */
    tripDates: { type: Array, value: [] },
    /* 该景点已创建行程的日期集合（用于禁用） */
    bookedDates: { type: Array, value: [] },
    minDate: { type: String, value: '' },
    maxDate: { type: String, value: '' },
  },

  data: {
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    /* 可滑动的月份页：[{ key, label, days: [cell] }] */
    months: [],
    monthIndex: 0,
    /* 当前月份标题：随滑动更新（模板在 swiper 内部拿不到「当前页」的 label） */
    monthLabel: '',
    gridHeight: ROWS * CELL_RPX,
    choice: '',
  },

  observers: {
    'show': function (val) {
      if (!val) return;
      /* 每次打开回到 minDate 所在月（= 今天），与旧实现「默认定位到 minDate 所在月」一致 */
      this.buildMonths();
    },
  },

  methods: {
    buildMonths() {
      const { tripDates, bookedDates, minDate, maxDate } = this.data;
      const tripSet = new Set(tripDates);
      const bookedSet = new Set(bookedDates);

      const start = minDate ? new Date(minDate + 'T00:00:00') : new Date();
      const months = [];
      for (let i = 0; i < MONTH_HORIZON; i++) {
        const first = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const y = first.getFullYear();
        const mo = first.getMonth();
        months.push({
          key: y + '-' + pad(mo + 1),
          label: y + '年' + (mo + 1) + '月',
          days: this.buildCells(y, mo, tripSet, bookedSet, minDate, maxDate),
        });
      }

      /* ⚠️ `choice` 一并清空：上一次打开选的日期如果还留着，换个月份滑过去
         会看到一个"已经被选中"的日子，而用户这一轮根本没点过它。 */
      this.setData({
        months,
        monthIndex: 0,
        monthLabel: months.length ? months[0].label : '',
        choice: '',
      });
    },

    /** 单个月份的格子：上月补位 + 本月 + 下月补位，并标记条带 / 禁用 */
    buildCells(year, month, tripSet, bookedSet, minDate, maxDate) {
      const firstDay = new Date(year, month, 1);
      const firstWeekday = (firstDay.getDay() + 6) % 7;   // 周日=0 → 6，周一起始
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const prevMonthDays = new Date(year, month, 0).getDate();
      const min = minDate || '';
      const max = maxDate || '';

      const cells = [];
      /* 上月补位 */
      for (let i = firstWeekday - 1; i >= 0; i--) {
        cells.push({ date: '', day: prevMonthDays - i, cellClass: 'other-month', disabled: true, inTrip: false, tripEdge: '' });
      }
      /* 本月 */
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = year + '-' + pad(month + 1) + '-' + pad(d);
        const tooEarly = min && ds < min;
        const tooLate = max && ds > max;
        const booked = bookedSet.has(ds);
        cells.push({
          date: ds,
          day: d,
          cellClass: '',
          disabled: !!(tooEarly || tooLate || booked),
          inTrip: tripSet.has(ds) && !booked,
          tripEdge: '',
        });
      }
      /* 下月补位 */
      const trailing = (7 - (cells.length % 7)) % 7;
      for (let d = 1; d <= trailing; d++) {
        cells.push({ date: '', day: d, cellClass: 'other-month', disabled: true, inTrip: false, tripEdge: '' });
      }

      /* 标记连续行程条带的首尾圆角 */
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i].inTrip) continue;
        const isStart = i === 0 || !cells[i - 1].inTrip;
        const isEnd = i === cells.length - 1 || !cells[i + 1].inTrip;
        cells[i].tripEdge = (isStart ? 'trip-start ' : '') + (isEnd ? 'trip-end' : '');
      }
      return cells;
    },

    /* 滑动切月：只更新标题，网格位移由 swiper 自己负责 */
    onMonthSwipe(e) {
      const idx = e.detail.current;
      const m = this.data.months[idx];
      if (!m) return;
      this.setData({ monthIndex: idx, monthLabel: m.label });
    },

    onDayTap(e) {
      const { date, disabled } = e.currentTarget.dataset;
      if (!date || disabled) return;
      /* 只改选中值：选中态由模板按 `item.date === choice` 判，不必重算网格 */
      this.setData({ choice: date });
    },

    onConfirm() {
      if (!this.data.choice) return;
      this.triggerEvent('confirm', { visitDate: this.data.choice });
    },

    onClose() {
      this.triggerEvent('close');
    },

    noop() {},
  },
});
