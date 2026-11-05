/**
 * 首页行程窗口交互与视觉契约。
 * 运行：node test/trip-window-ui.test.js
 */
const fs = require('fs');
const path = require('path');
const time = require('../cloudfunctions/reminder/lib/time');
const util = require('../miniprogram/utils/util.js');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HOME_JSON = read('miniprogram/pages/home/home.json');
const HOME_WXML = read('miniprogram/pages/home/home.wxml');
const HOME_JS = read('miniprogram/pages/home/home.js');
const SUMMARY_WXML = read('miniprogram/components/trip-summary-card/trip-summary-card.wxml');
const SECTION_WXML = read('miniprogram/components/trip-section/trip-section.wxml');
const SECTION_WXSS = read('miniprogram/components/trip-section/trip-section.wxss');
const PICKER_JS = read('miniprogram/components/date-range-picker/index.js');
const PICKER_WXML = read('miniprogram/components/date-range-picker/index.wxml');

let fail = 0;
const eq = (a, b, message) => {
  const ok = String(a) === String(b);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', a, '\n  want:', b);
  } else {
    console.log('ok  ', message, '=', a);
  }
};

function loadComponent(rel) {
  let def = null;
  const old = global.Component;
  global.Component = value => { def = value; };
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  global.Component = old;
  return def;
}

function instanceOf(def) {
  const comp = Object.assign({}, def, def.methods || {});
  comp.data = JSON.parse(JSON.stringify(def.data || {}));
  comp.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  comp.triggerEvent = function triggerEvent(name, detail) {
    this._event = { name, detail };
  };
  return comp;
}

console.log('=== 1. 模板与入口 ===');
eq(/"date-range-picker": "\/components\/date-range-picker\/index"/.test(HOME_JSON), true,
  '首页装载日期范围选择器');
eq(/show-edit-action="\{\{showSummaryEdit\}\}"/.test(HOME_WXML), true,
  '摘要卡只对当前进行中行程显示编辑入口');
eq(/bind:edit="onTripWindowEdit"/.test(HOME_WXML), true,
  '摘要卡编辑事件接到首页');
eq(/bind:editwindow="onTripWindowEdit"/.test(HOME_WXML), true,
  '其他进行中行程标题接到同一编辑事件');
eq(/title="修改行程日期"/.test(HOME_WXML), true, '编辑浮层标题明确');
eq(/只调整行程标识和分享范围，不改变提醒/.test(HOME_JS), true,
  '页面明确说明不会改变提醒');
eq(/trip\.updateWindow/.test(HOME_JS), true, '保存调用新的窗口接口');
eq(/expectedWindowUpdatedAt:\s*trip\.windowVersion/.test(HOME_JS), true,
  '保存携带并发版本');
eq(/showEditAction/.test(SUMMARY_WXML), true, '摘要卡编辑入口由显式属性控制');
eq(/name="calendar"/.test(SUMMARY_WXML), true, '摘要卡复用现有日历图标');
eq(/class="ts-window-marker/.test(SECTION_WXML), true, '行程墙渲染首尾分隔标识');
eq(/北京之行开始|北京之行结束/.test(read('miniprogram/components/trip-section/trip-section.js')), true,
  '首尾标识文案明确');
eq(/行程前 · 提醒照常/.test(read('miniprogram/components/trip-section/trip-section.js')), true,
  '范围前项目说明提醒继续发送');
eq(/行程后 · 提醒照常/.test(read('miniprogram/components/trip-section/trip-section.js')), true,
  '范围后项目说明提醒继续发送');
eq(/confirmText/.test(PICKER_JS) && /note/.test(PICKER_WXML), true,
  '日期选择器支持说明与自定义确认文案');
eq(/triggerEvent\('change'/.test(PICKER_JS), true, '选择范围变化时通知页面');
eq(/scrollIntoView/.test(PICKER_JS) && /scroll-into-view/.test(PICKER_WXML), true,
  '打开编辑时自动滚到当前开始月份');

console.log('=== 2. 行程墙分组与第几天 ===');
const sectionDef = loadComponent('miniprogram/components/trip-section/trip-section.js');
const section = instanceOf(sectionDef);
const today = time.todayStr();
const past = time.addDays(today, -2);
const before = time.addDays(today, 1);
const start = time.addDays(today, 2);
const inside = time.addDays(today, 3);
const end = time.addDays(today, 4);
const after = time.addDays(today, 5);
const trip = {
  _id: 'T_UI',
  city: '北京',
  startDate: before,
  endDate: after,
  windowStartDate: start,
  windowEndDate: end,
  windowProgress: { done: 0, total: 1, noReservationCount: 0 },
  items: [
    { itemId: 'i_past', visitDate: past, spotId: 'gugong' },
    { itemId: 'i_before', visitDate: before, spotId: 'gugong' },
    { itemId: 'i_inside', visitDate: inside, spotId: 'gugong' },
    { itemId: 'i_after', visitDate: after, spotId: 'gugong' },
  ],
  progress: { done: 0, total: 1, noReservationCount: 0 },
};
section.data.trip = trip;
section.data.history = false;
sectionDef.observers['trip, menuDate, dismissed, recoverableIds, recoveryPromptIds, history']
  .call(section, trip, '', [], [], [], false);
const markerRows = section.data.days.filter(d => d.kind === 'marker');
eq(markerRows.length, 2, '行程墙插入开始和结束两个边界');
eq(markerRows[0].markerType, 'start', '开始边界类型正确');
eq(markerRows[1].markerType, 'end', '结束边界类型正确');
const beforeDay = section.data.days.find(d => d.key === before);
const insideDay = section.data.days.find(d => d.key === inside);
const afterDay = section.data.days.find(d => d.key === after);
eq(beforeDay.badge, '', '范围前不显示第 N 天');
eq(insideDay.badge, '【第2天】', '范围后项目按窗口开始日计算');
eq(afterDay.badge, '', '范围后不显示第 N 天');
eq(beforeDay.outsideLabel, '行程前 · 提醒照常', '范围前标签');
eq(afterDay.outsideLabel, '行程后 · 提醒照常', '范围后标签');
section.onWindowEdit();
eq(section._event.name, 'editwindow', '行程标题触发编辑事件');
eq(section._event.detail.tripId, 'T_UI', '编辑事件携带 tripId');
eq(/width:\s*104rpx/.test(SECTION_WXSS), true, '编辑入口保留足够点击面积');

console.log('=== 3. 摘要卡使用窗口数据 ===');
const summaryDef = loadComponent('miniprogram/components/trip-summary-card/trip-summary-card.js');
const summary = instanceOf(summaryDef);
summaryDef.observers.trip.call(summary, {
  ...trip,
  windowProgress: { done: 1, total: 2, noReservationCount: 0 },
  progress: { done: 0, total: 1, noReservationCount: 0 },
});
summary.data.trip = trip;
eq(summary.data.metaLine.indexOf(util.tripMetaLine(start, end, '')) === 0, true,
  '摘要卡日期来自窗口');
eq(summary.data.percent, 50, '摘要卡进度只使用窗口内进度');
summary.onEditTap();
eq(summary._event.name, 'edit', '摘要卡编辑事件名称稳定');

console.log('\n' + (fail === 0 ? 'ALL PASS' : `FAIL ${fail}`));
process.exit(fail === 0 ? 0 : 1);
