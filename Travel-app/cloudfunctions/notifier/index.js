const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, spotId, targetDate, channels, subscriptionId } = event;

  if (action === 'subscribe') {
    const { OPENID } = cloud.getWXContext();
    // TODO: 创建订阅记录
    return { success: true, message: '订阅成功' };
  }

  if (action === 'cancel') {
    // TODO: 取消订阅
    return { success: true, message: '取消成功' };
  }

  if (action === 'sendReminder') {
    // TODO: 触发提醒推送
    return { success: true, message: '推送完成' };
  }

  return { success: false, message: 'unknown action' };
};
