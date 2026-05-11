const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 抓取逻辑将在后续实现
// 使用 Playwright + stealth 插件进行官网数据抓取

exports.main = async (event, context) => {
  const { action, spotId } = event;

  if (action === 'scrape') {
    // TODO: 实现具体抓取逻辑
    return {
      success: true,
      message: 'scraper placeholder',
      spotId,
    };
  }

  return { success: false, message: 'unknown action' };
};
