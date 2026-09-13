/**
 * 开放日判定 + 公告过期测试（2026-09-11）
 *
 * 覆盖：isOpenOn 两套语义与优先级、spots 云函数的取值点、specialNoticeUntil 自动过期、
 * 四份数据副本一致性。
 * 注意：openDays 是机制，当前**只有北大**在用（清华唯一限制是周一闭馆，2026-09-11 用户核实）。
 * 机制本身用合成 rule 验证，不依赖某个具体景点是否还在用白名单。
 * 运行：node test/opendays.test.js
 */
// spots 云函数顶层 require wx-server-sdk（云端依赖），本地用桩顶上
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return require.resolve('./stubs/wx-server-sdk.js');
  return origResolve.call(this, request, ...rest);
};

const spotsFn = require('../cloudfunctions/spots/index.js');
const time = require('../cloudfunctions/reminder/lib/time.js');
const { computeReleaseStatus, computeEarliestDate, buildCard } = spotsFn._internal;
const activeNoticeOf = time.activeNoticeOf;

const spots = require('../data/spots.json').spots;
const rules = require('../data/rules.json').rules;
const sm = {}; spots.forEach(s => { sm[s.spotId] = s; });
const rm = {}; rules.forEach(r => { rm[r.spotId] = r; });

let fail = 0;
const eq = (a, b, m) => {
  const ok = String(a) === String(b);
  if (!ok) { fail += 1; console.log('FAIL', m, '\n  got :', a, '\n  want:', b); }
  else console.log('ok  ', m, '=', a);
};

/* 构造一个北京时间的 Date：给定 YYYY-MM-DD HH:mm（北京时间） */
function bj(y, mo, d, h, mi) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - 8 * 3600000);
}

/* 合成 rule：白名单 / 黑名单各一，用来验证机制本身 */
const WHITELIST = { advanceDays: 7, releaseTime: '08:00', closedDays: ['monday'], openDays: ['saturday', 'sunday'] };
const BLACKLIST = { advanceDays: 7, releaseTime: '20:00', closedDays: ['monday'] };

console.log('--- isOpenOn 两套语义（合成 rule）---');
eq(time.isOpenOn(WHITELIST, 'monday'), false, '白名单：周一不可约（白名单接管，closedDays 不叠加）');
eq(time.isOpenOn(WHITELIST, 'wednesday'), false, '白名单：周三不可约');
eq(time.isOpenOn(WHITELIST, 'saturday'), true, '白名单：周六可约');
// 关键边界：同时命中时以白名单为准，不能叠加出空集
eq(time.isOpenOn({ closedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], openDays: ['saturday', 'sunday'] }, 'saturday'), true, '黑名单+白名单不叠加，白名单胜出');
eq(time.isOpenOn(BLACKLIST, 'monday'), false, '黑名单：周一闭馆');
eq(time.isOpenOn(BLACKLIST, 'tuesday'), true, '黑名单：周二可约');
eq(time.isOpenOn({}, 'monday'), true, '无规则字段 → 全年开放');
eq(time.isOpenOn(null, 'monday'), true, '规则缺失 → 不拦');

console.log('\n--- openDays 白名单当前的使用者 ---');
const whitelistSpots = rules.filter(r => (r.openDays || []).length > 0).map(r => r.spotId);
eq(whitelistSpots.join(','), 'peking-university', '当前仅北大用 openDays');
eq(rm.tsinghua.openDays, undefined, '清华无 openDays（唯一限制是周一闭馆）');
eq(rm.tsinghua.closedDays.join(','), 'monday', '清华 closedDays=[monday]');
eq(time.isOpenOn(rm.tsinghua, 'wednesday'), true, '清华周三可约（工作日不禁约）');
eq(time.isOpenOn(rm.tsinghua, 'monday'), false, '清华周一闭馆');
eq(time.isOpenOn(rm['peking-university'], 'monday'), false, '北大周一不可约（白名单接管）');
eq(time.isOpenOn(rm['peking-university'], 'sunday'), true, '北大周日可约');

console.log('\n--- 人民大会堂：2026-09-11 校正为周一闭馆 ---');
eq(rm['renmin-dahuitang'].closedDays.join(','), 'monday', '大会堂 closedDays=[monday]');
eq(time.isOpenOn(rm['renmin-dahuitang'], 'monday'), false, '大会堂周一闭馆');
eq(time.isOpenOn(rm['renmin-dahuitang'], 'tuesday'), true, '大会堂周二可约');

console.log('\n--- 首都博物馆：2026-09-11 校正为周一闭馆（原为周二）---');
eq(rm.shoubo.closedDays.join(','), 'monday', '首博 closedDays=[monday]');
eq(time.isOpenOn(rm.shoubo, 'monday'), false, '首博周一闭馆');

console.log('\n--- 天坛/北海：closedDaysNote 只影响文案，不影响行为 ---');
eq(rm.tiantan.closedDays.length, 0, '天坛 closedDays 为空（公园本体全开）');
eq(time.isOpenOn(rm.tiantan, 'monday'), true, '天坛周一可约（不能因园中园闭馆就报整体闭馆）');
eq(rm.tiantan.closedDaysNote.includes('祈年殿'), true, '天坛 closedDaysNote 说明园中园');
eq(rm.beihai.closedDays.length, 0, '北海 closedDays 为空');
eq(time.isOpenOn(rm.beihai, 'monday'), true, '北海周一可约');
eq(rm.beihai.closedDaysNote.includes('琼华岛'), true, '北海 closedDaysNote 说明园中园');

console.log('\n--- 文案：openDaysLabel 四态 ---');
eq(time.openDaysLabel(rm.gugong), '周一闭馆', '黑名单 → 周一闭馆');
eq(time.openDaysLabel(rm.tsinghua), '周一闭馆', '清华 → 周一闭馆（不进白名单态）');
eq(time.openDaysLabel(rm['peking-university']), '仅周六、周日开放', '北大 → 仅周六、周日开放');
eq(time.openDaysLabel(rm.tiantan).includes('园中园'), true, '天坛 → 用 closedDaysNote（园中园型）');
eq(time.openDaysLabel(rm.badaling), '全年开放', '无任何字段 → 全年开放');
eq(time.openDaysLabel(null), '', '无规则 → 空串');

console.log('\n--- computeReleaseStatus：白名单与黑名单都走 isOpenOn ---');
// 2026-09-12 是周六，09-14 是周一，09-16 是周三
eq(computeReleaseStatus(rm['peking-university'], bj(2026, 9, 13, 9, 0)), 'BOOKABLE', '北大 周日 09:00 → 已放票');
eq(computeReleaseStatus(rm['peking-university'], bj(2026, 9, 16, 9, 0)), 'NOT_RELEASED', '北大 周三 → 不放票');
eq(computeReleaseStatus(rm.tsinghua, bj(2026, 9, 16, 9, 0)), 'BOOKABLE', '清华 周三 09:00 → 已放票（工作日可约）');
eq(computeReleaseStatus(rm.tsinghua, bj(2026, 9, 14, 9, 0)), 'NOT_RELEASED', '清华 周一 → 闭馆不放票');
eq(computeReleaseStatus(rm.gugong, bj(2026, 9, 14, 21, 0)), 'NOT_RELEASED', '故宫 周一 21:00 → 闭馆不放票');
eq(computeReleaseStatus(rm.gugong, bj(2026, 9, 15, 21, 0)), 'BOOKABLE', '故宫 周二 21:00 → 已放票');
eq(computeReleaseStatus(rm['renmin-dahuitang'], bj(2026, 9, 14, 18, 0)), 'NOT_RELEASED', '大会堂 周一 → 闭馆不放票');
eq(computeReleaseStatus(rm['renmin-dahuitang'], bj(2026, 9, 15, 18, 0)), 'BOOKABLE', '大会堂 周二 → 已放票');

console.log('\n--- computeEarliestDate：顺延到下一个可约日 ---');
eq(computeEarliestDate(rm['peking-university'], bj(2026, 9, 11, 10, 0)), '2026-09-19', '北大：周五+7=周五(白名单外)→顺延至周六 09-19');
eq(computeEarliestDate(rm.tsinghua, bj(2026, 9, 11, 10, 0)), '2026-09-18', '清华：周五+7=周五可约，不顺延');
eq(computeEarliestDate(rm.gugong, bj(2026, 9, 12, 10, 0)), '2026-09-19', '故宫：周六+7=周六可约');
eq(computeEarliestDate(rm.gugong, bj(2026, 9, 13, 10, 0)), '2026-09-20', '故宫：周日+7=周日可约');

console.log('\n--- 公告自动过期（specialNoticeUntil）---');
eq(activeNoticeOf({ specialNotice: 'X', specialNoticeUntil: '2026-09-10' }, bj(2026, 9, 11, 10, 0)), '', '昨天到期 → 不再下发');
eq(activeNoticeOf({ specialNotice: 'X', specialNoticeUntil: '2026-09-11' }, bj(2026, 9, 11, 10, 0)), 'X', '今天到期 → 含当天仍显示');
eq(activeNoticeOf({ specialNotice: 'X', specialNoticeUntil: '2026-09-12' }, bj(2026, 9, 11, 10, 0)), 'X', '未到期 → 显示');
eq(activeNoticeOf({ specialNotice: 'X' }, bj(2026, 9, 11, 10, 0)), 'X', '无 until 字段 → 向后兼容为长期有效');
eq(activeNoticeOf({ specialNotice: '' }, bj(2026, 9, 11, 10, 0)), '', '空公告 → 空');
eq(activeNoticeOf(null, bj(2026, 9, 11, 10, 0)), '', '无规则 → 空');
// 真实数据
eq(rm['maozhuxi-jiniantang'].specialNotice, '', '毛主席纪念堂过期公告已清除（2026-09-01 恢复开放）');
eq(activeNoticeOf(rm.gugong, bj(2026, 9, 11, 10, 0)) !== '', true, '故宫公告未到期，仍下发');
eq(activeNoticeOf(rm.gugong, bj(2026, 9, 15, 10, 0)), '', '故宫公告 9/15 起自动过期，无需人工清理');
eq(rm.gugong.specialNoticeUntil, '2026-09-14', '故宫公告带到期日（结构化，不再只写在自由文本里）');

console.log('\n--- 一致性：四份数据副本同步 ---');
const seedRules = require('../data/seed/rules.seed.json');
const deployRules = require('../cloudfunctions/reminder/data/rules.json').rules;
const seedRm = {}; seedRules.forEach(r => { seedRm[r.spotId] = r; });
const depRm = {}; deployRules.forEach(r => { depRm[r.spotId] = r; });
const FIELDS = ['closedDays', 'openDays', 'closedDaysNote', 'openTime', 'bookingTips', 'lastCheckedDate', 'specialNotice', 'specialNoticeUntil'];
let diff = [];
for (const id of Object.keys(rm)) {
  for (const f of FIELDS) {
    if (JSON.stringify(rm[id][f]) !== JSON.stringify(seedRm[id][f])) diff.push(`seed:${id}.${f}`);
    if (JSON.stringify(rm[id][f]) !== JSON.stringify(depRm[id][f])) diff.push(`deploy:${id}.${f}`);
  }
}
eq(diff.length, 0, `真身/seed/部署副本 全字段一致（差异：${diff.join(',') || '无'}）`);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
