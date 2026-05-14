const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 计算放票状态
function computeReleaseStatus(rule) {
  const now = new Date();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = dayNames[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // 今天闭馆 → 不放票
  if (rule.closedDays && rule.closedDays.includes(todayName)) {
    return 'no-release-today';
  }

  const [h, m] = rule.releaseTime.split(':').map(Number);
  const releaseMinutes = h * 60 + m;

  if (currentMinutes < releaseMinutes) {
    return 'before';
  }
  return 'after';
}

// 计算最早可约日期
function computeEarliestDate(rule) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + rule.advanceDays);

  // 如果可约日期落在闭馆日，顺延一天
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (rule.closedDays && rule.closedDays.includes(dayNames[target.getDay()])) {
    target.setDate(target.getDate() + 1);
  }

  return formatDate(target);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDifficultyLabel(score) {
  if (score >= 4) return { text: '极难约', color: 'red' };
  if (score >= 3) return { text: '较难约', color: 'orange' };
  return { text: '易约', color: 'yellow' };
}

exports.main = async (event, context) => {
  const { action, spotId } = event;

  if (action === 'list') {
    try {
      const { OPENID } = cloud.getWXContext();
      const spotsRes = await db.collection('spots').get();
      const rulesRes = await db.collection('rules').get();
      const favsRes = await db.collection('favorites')
        .where({ userId: OPENID })
        .orderBy('favoritedAt', 'desc')
        .get();

      const favSpotIds = new Set(favsRes.data.map(f => f.spotId));
      const rulesMap = {};
      rulesRes.data.forEach(r => { rulesMap[r.spotId] = r; });

      const favorites = [];
      const others = [];

      spotsRes.data.forEach(spot => {
        const rule = rulesMap[spot.spotId] || {};
        const status = rule.advanceDays ? computeReleaseStatus(rule) : 'no-release-today';
        const earliestDate = rule.advanceDays ? computeEarliestDate(rule) : '暂无数据';
        const difficulty = computeDifficultyLabel(spot.difficultyScore);

        const card = {
          spotId: spot.spotId,
          name: spot.name,
          category: spot.category,
          district: spot.district,
          difficultyScore: spot.difficultyScore,
          difficultyLabel: difficulty,
          earliestDate,
          releaseTime: rule.releaseTime || '',
          releaseStatus: status,
          isFavored: favSpotIds.has(spot.spotId),
          officialAppid: spot.officialAppid,
          officialPath: spot.officialPath,
          officialWebUrl: spot.officialWebUrl,
        };

        if (card.isFavored) {
          favorites.push(card);
        } else {
          others.push(card);
        }
      });

      // 收藏置顶，按收藏时间倒序（已在查询中排序，保持顺序即可）
      return { success: true, data: [...favorites, ...others] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'detail') {
    try {
      const spotRes = await db.collection('spots').where({ spotId }).get();
      const ruleRes = await db.collection('rules').where({ spotId }).get();
      const spot = spotRes.data[0] || null;
      const rule = ruleRes.data[0] || null;

      if (!spot) return { success: false, error: '景点不存在' };

      const releaseStatus = rule ? computeReleaseStatus(rule) : null;
      const earliestDate = rule ? computeEarliestDate(rule) : null;

      return {
        success: true,
        data: {
          ...spot,
          rule,
          releaseStatus,
          earliestDate,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'toggleFavorite') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { success: false, error: '未登录' };

    try {
      const exist = await db.collection('favorites')
        .where({ userId: OPENID, spotId })
        .get();

      if (exist.data.length > 0) {
        await db.collection('favorites').doc(exist.data[0]._id).remove();
        return { success: true, isFavored: false };
      } else {
        await db.collection('favorites').add({
          data: {
            userId: OPENID,
            spotId,
            favoritedAt: new Date(),
          },
        });
        return { success: true, isFavored: true };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'profile') {
    const { OPENID } = cloud.getWXContext();
    try {
      const subs = await db.collection('subscriptions').where({ userId: OPENID }).get();
      const favs = await db.collection('favorites')
        .where({ userId: OPENID })
        .orderBy('favoritedAt', 'desc')
        .get();

      // 关联景点名称
      const spotsRes = await db.collection('spots').get();
      const spotsMap = {};
      spotsRes.data.forEach(s => { spotsMap[s.spotId] = s; });

      const favorites = favs.data.map(f => ({
        ...f,
        name: spotsMap[f.spotId] ? spotsMap[f.spotId].name : '未知景点',
        statusText: spotsMap[f.spotId] ? '正常' : '未知',
      }));

      const subscriptions = subs.data.map(s => ({
        ...s,
        spotName: spotsMap[s.spotId] ? spotsMap[s.spotId].name : '未知景点',
      }));

      return { success: true, subscriptions, favorites };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, message: 'unknown action' };
};
