/**
 * 任务位超限时统一打开会员页。
 *
 * 不把配置常量复制到前端：页面的额度、价格和可购项都读
 * reminder.membership.status 的服务端返回，这里只负责携带本次缺口。
 */

function taskLimitOf(err) {
  if (!err || err.errorCode !== 1026 || !err.taskLimit) return null;
  return err.taskLimit;
}

function openTaskLimit(err) {
  const limit = taskLimitOf(err);
  if (!limit) return false;
  const query = [
    'reason=task_limit',
    `used=${encodeURIComponent(limit.used)}`,
    `limit=${encodeURIComponent(limit.limit)}`,
    `requested=${encodeURIComponent(limit.requested)}`,
    `shortfall=${encodeURIComponent(limit.shortfall)}`,
  ].join('&');
  wx.navigateTo({ url: `/pages/membership/membership?${query}` });
  return true;
}

module.exports = { taskLimitOf, openTaskLimit };
