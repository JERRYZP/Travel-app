/**
 * 服务端日期计划的纯视图映射。
 *
 * 这里只负责把 `cart.planDates` 的结构化结果转成用户可读状态，
 * 不重新判断 advanceDays / releaseAt，避免形成第二套业务规则。
 */

function dateLabelOf(dateStr) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  return matched ? `${Number(matched[2])}月${Number(matched[3])}日` : String(dateStr || '');
}

function labelsOf(dates) {
  return dates.map(row => dateLabelOf(row.visitDate)).filter(Boolean).join('、');
}

function viewOf(plan) {
  const summary = plan && plan.summary;
  if (!summary || (summary.tripOnly <= 0 && summary.existing <= 0)) return null;

  const dates = Array.isArray(plan.dates) ? plan.dates : [];
  const reminderDates = dates.filter(row => row.status === 'REMINDABLE');
  const releasePassedDates = dates.filter(row => row.reason === 'RELEASE_PASSED');
  const noFixedDates = dates.filter(row => row.reason === 'NO_FIXED_RELEASE');
  const noReservationDates = dates.filter(row => row.reason === 'NO_RESERVATION');
  const existingDates = dates.filter(row => row.status === 'IN_CART' || row.status === 'IN_TRIP');

  const lines = [];
  if (reminderDates.length) {
    lines.push({ tone: 'ok', label: '可设提醒', text: labelsOf(reminderDates) });
  }
  if (releasePassedDates.length) {
    lines.push({
      tone: 'warn',
      label: '仅加入行程',
      text: `${labelsOf(releasePassedDates)}（已过放票时间）`,
    });
  }
  if (noFixedDates.length) {
    lines.push({
      tone: 'warn',
      label: '仅加入行程',
      text: `${labelsOf(noFixedDates)}（无固定放票时刻）`,
    });
  }
  if (noReservationDates.length) {
    lines.push({
      tone: 'warn',
      label: '仅加入行程',
      text: `${labelsOf(noReservationDates)}（免预约景点）`,
    });
  }
  if (existingDates.length) {
    lines.push({
      tone: 'muted',
      label: '已跳过',
      text: `${labelsOf(existingDates)}（已在清单或行程中）`,
    });
  }

  let title = '';
  if (summary.reminder > 0 && summary.tripOnly > 0) {
    title = `${summary.reminder} 天可设提醒，${summary.tripOnly} 天仅加入行程`;
  } else if (summary.reminder > 0) {
    title = `${summary.reminder} 天将设置提醒`;
  } else if (summary.tripOnly > 0) {
    title = '所选日期已过放票时间，无法设置提醒';
  } else {
    title = '所选日期已经添加过';
  }

  const primaryAction = summary.reminder > 0 ? 'continue' : (summary.tripOnly > 0 ? 'trip-only' : 'reselect');
  return {
    title,
    lines,
    tone: summary.reminder > 0 ? 'info' : 'warn',
    primaryAction,
    continueText: primaryAction === 'trip-only'
      ? '仅加入行程'
      : (primaryAction === 'reselect' ? '返回修改日期' : '开启行程放票提醒'),
  };
}

function hasNotice(plan) {
  return !!viewOf(plan);
}

module.exports = { viewOf, hasNotice, dateLabelOf };
