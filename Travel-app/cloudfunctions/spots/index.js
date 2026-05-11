const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, spotId } = event;

  if (action === 'list') {
    try {
      const { data } = await db.collection('spots').get();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'detail') {
    try {
      const { data } = await db.collection('spots').where({ spotId }).get();
      return { success: true, data: data[0] || null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'entries') {
    try {
      const { data } = await db.collection('spots').field({
        spotId: true,
        name: true,
        officialAppid: true,
        officialPath: true,
        officialWebUrl: true,
        status: true,
        statusText: true,
      }).get();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'profile') {
    const { OPENID } = cloud.getWXContext();
    try {
      const subs = await db.collection('subscriptions').where({ userId: OPENID }).get();
      const favs = await db.collection('favorites').where({ userId: OPENID }).get();
      return {
        success: true,
        subscriptions: subs.data,
        favorites: favs.data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, message: 'unknown action' };
};
