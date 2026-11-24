/**
 * 首页行程墙「第N天」必须与顶部摘要卡使用同一展示起点。
 *
 * 运行：node test/home-trip-day-badge.test.js
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMPONENT = path.join(
  ROOT,
  'miniprogram/components/trip-section/trip-section.js'
);

let fail = 0;
const eq = (actual, expected, message) => {
  const ok = String(actual) === String(expected);
  if (!ok) {
    fail += 1;
    console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
  } else {
    console.log('ok  ', message, '=', actual);
  }
};

function loadComponent() {
  let def = null;
  const prev = global.Component;
  global.Component = value => { def = value; };
  delete require.cache[require.resolve(COMPONENT)];
  require(COMPONENT);
  global.Component = prev;
  return def;
}

function runTripObserver(def, trip) {
  const observerKey = Object.keys(def.observers)
    .find(key => key.split(',').map(part => part.trim()).includes('trip'));
  const ctx = {
    data: {},
    setData(patch) { Object.assign(this.data, patch); },
  };
  def.observers[observerKey].call(ctx, trip, '', [], [], [], false);
  return ctx.data;
}

console.log('=== 首页行程墙日期徽标按摘要卡展示范围计算 ===');
{
  const def = loadComponent();
  const trip = {
    _id: 'TRIP-RANGE',
    city: '北京',
    startDate: '2026-10-07',
    endDate: '2026-11-30',
    displayStartDate: '2026-11-19',
    displayEndDate: '2026-11-30',
    progress: { done: 0, total: 2, noReservationCount: 0 },
    items: [
      { itemId: 'ITEM-19', visitDate: '2026-11-19' },
      { itemId: 'ITEM-25', visitDate: '2026-11-25' },
    ],
  };

  let data = runTripObserver(def, trip);
  eq(data.days[0].badge, '【第1天】', '11月19日按展示起始日显示第1天');
  eq(data.days[1].badge, '【第7天】', '11月25日按展示起始日显示第7天，而不是业务日期的第50天');

  const legacyTrip = Object.assign({}, trip);
  delete legacyTrip.displayStartDate;
  delete legacyTrip.displayEndDate;
  data = runTripObserver(def, legacyTrip);
  eq(data.days[1].badge, '【第50天】', '旧版响应缺少展示字段时兼容回退 startDate');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
