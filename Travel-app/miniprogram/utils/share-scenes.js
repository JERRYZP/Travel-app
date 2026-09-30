/**
 * 首批分享场景（2026-09-25）。
 *
 * today 为动态场景；国庆为编辑精选，过了有效期后页面降级到 today。
 * 场景只描述“去哪里、放票规则是什么”，不承诺真实库存。
 */

const release = require('./release-context.js');

const NATIONAL_SPOT_IDS = [
  'gugong',
  'guobo',
  'tiananmen-chenglou',
  'maozhuxi-jiniantang',
  'renmin-dahuitang',
  'gongwangfu',
  'peking-university',
  'tsinghua',
  'junbo',
  'kejiguan',
];

const SCENES = {
  today: {
    id: 'today',
    kind: 'today',
    navTitle: '北京今日放票',
    title: '北京今日放票',
    subtitle: '按北京时间实时计算 · 库存以官方为准',
    shareTitle: '今天北京热门景点放票时间，整理好了',
    imageUrl: '/images/banner_bg.png',
  },
  'national-day-2026': {
    id: 'national-day-2026',
    kind: 'national',
    navTitle: '北京国庆抢票清单',
    title: '2026 国庆北京抢票清单',
    subtitle: '故宫、国博、城楼等 10 个热门景点',
    shareTitle: '2026国庆北京热门景点放票清单',
    imageUrl: '/images/spots/gugong.jpg',
    activeFrom: '2026-09-25',
    activeTo: '2026-10-08',
    spotIds: NATIONAL_SPOT_IDS,
    notice: '国庆法定节假日期间，多数周一闭馆场馆通常开放；人民大会堂周一仍闭馆，最终以各官方公告为准。',
  },
};

function getScene(sceneId) {
  return SCENES[sceneId] || SCENES.today;
}

function isSceneActive(scene, now) {
  if (!scene || !scene.activeFrom || !scene.activeTo) return true;
  const day = release.toDateStr(now || new Date());
  return day >= scene.activeFrom && day <= scene.activeTo;
}

function buildSceneTitle(scene, count) {
  if (scene && scene.kind === 'today') {
    return count > 0
      ? `今天北京有${count}个热门景点放票，时间都在这里`
      : scene.shareTitle;
  }
  return (scene && scene.shareTitle) || SCENES.today.shareTitle;
}

module.exports = {
  NATIONAL_SPOT_IDS,
  SCENES,
  getScene,
  isSceneActive,
  buildSceneTitle,
};
