/**
 * 行程清单视图兼容层。
 *
 * 正常路径直接使用 `/reminder/cart.list` 已经按出行日分好组、并下发完整
 * `releaseLabel` 的返回值。这里只处理一个明确窗口：小程序包已升级、但
 * `reminder` 云函数尚未重新部署，旧响应仍按开票日分组且缺少新字段。
 *
 * 旧响应一旦消失，这层会自然走 passthrough；不要在页面里再维护第三套分组。
 */
const util = require('./util.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function legacyReleaseLabelOf(item) {
  if (!item || !item.releaseAt) return '';
  const d = new Date(item.releaseAt);
  if (Number.isNaN(d.getTime())) return '';
  const b = new Date(d.getTime() + 8 * 3600000);
  return pad(b.getUTCMonth() + 1) + '月' + pad(b.getUTCDate()) + '日 '
    + pad(b.getUTCHours()) + ':' + pad(b.getUTCMinutes()) + ' 放票';
}

function groupItemsByVisitDate(items) {
  const dates = [...new Set((items || []).map(i => i.visitDate).filter(Boolean))].sort();
  const firstDate = dates[0];
  return dates.map(visitDate => ({
    key: visitDate,
    label: util.dayTitleOf(visitDate),
    dayLabel: firstDate ? '【第' + util.dayDiff(firstDate, visitDate) + '天】' : '',
    items: (items || [])
      .filter(i => i.visitDate === visitDate)
      .sort((a, b) => {
        const af = a.reservationRequired === false ? 1 : 0;
        const bf = b.reservationRequired === false ? 1 : 0;
        if (af !== bf) return af - bf;
        const at = a.releaseAt ? new Date(a.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.releaseAt ? new Date(b.releaseAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (at !== bt) return at - bt;
        return String(a.spotName || '').localeCompare(String(b.spotName || ''), 'zh-CN');
      }),
  }));
}

function isLegacyResponse(res, items, groups) {
  if (items.some(i => i.reservationRequired !== false && !i.releaseLabel)) return true;
  if (groups.some(g => !g.dayLabel)) return true;
  if (groups.some(g => g.key === '__no_reservation__')) return true;
  return false;
}

function normalizeCartGroups(res, today = util.beijingTodayStr()) {
  const items = Array.isArray(res && res.items) ? res.items : [];
  const serverGroups = Array.isArray(res && res.groups) ? res.groups : [];
  const groups = isLegacyResponse(res, items, serverGroups)
    ? groupItemsByVisitDate(items)
    : serverGroups;

  return groups.map(group => {
    const visitDate = group && typeof group.key === 'string' ? group.key : '';
    const daysPast = util.pastDaysOf(visitDate, today);
    return Object.assign({}, group, {
      isPast: daysPast > 0,
      daysPast,
      items: (group.items || []).map(item => {
        const releasePassed = item.remindLocked === true;
        return Object.assign({}, item, {
          releasePassed,
          subline: item.reservationRequired === false
            ? '无需预约，随到随玩'
            : (releasePassed ? '已放票' : (item.releaseLabel || legacyReleaseLabelOf(item))),
        });
      }),
    });
  });
}

module.exports = {
  legacyReleaseLabelOf,
  groupItemsByVisitDate,
  normalizeCartGroups,
};
