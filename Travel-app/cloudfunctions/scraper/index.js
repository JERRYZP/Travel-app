const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 抓取策略：
// - action: 'scheduled' → 每日凌晨 00:30 定时触发，全量更新
// - action: 'verify'     → 各景点放票时刻后 5 分钟触发，验证放票是否正常滚动
//
// V1 阶段 Playwright 抓取逻辑待部署环境就绪后实现，当前为规则推算 + 抓取占位

// 各景点放票时间（用于 verify 模式判断触发时机）
const SPOT_RELEASE_SCHEDULE = {
  'gugong':             { releaseTime: '20:00', advanceDays: 7 },
  'tiananmen-chenglou': { releaseTime: '17:00', advanceDays: 7 },
  'guobo':              { releaseTime: '17:00', advanceDays: 7 },
  'yiheyuan':           { releaseTime: '21:00', advanceDays: 7 },
  'tiantan':            { releaseTime: '21:00', advanceDays: 7 },
  'badaling':           { releaseTime: '00:00', advanceDays: 10 },
  'yuanmingyuan':       { releaseTime: '00:00', advanceDays: 7 },
  'beijing-zoo':        { releaseTime: '00:00', advanceDays: 7 },
  'gongwangfu':         { releaseTime: '00:00', advanceDays: 7 },
  'beihai':             { releaseTime: '00:00', advanceDays: 7 },
};

exports.main = async (event, context) => {
  const { action, spotId } = event;

  if (action === 'scheduled') {
    try {
      const results = [];
      for (const [id, schedule] of Object.entries(SPOT_RELEASE_SCHEDULE)) {
        // TODO: 实际 Playwright 抓取逻辑
        // const scrapedDate = await scrapeSpot(id);
        // 抓取结果写入数据库
        // await db.collection('rules').where({ spotId: id }).update({
        //   data: { lastCheckedDate: scrapedDate },
        // });

        results.push({ spotId: id, success: true, mode: 'placeholder' });
      }

      return {
        success: true,
        message: `已完成 ${results.length} 个景点定时抓取`,
        results,
      };
    } catch (err) {
      console.error('定时抓取失败', err);
      return { success: false, error: err.message };
    }
  }

  if (action === 'verify') {
    if (!spotId) return { success: false, error: '缺少 spotId' };

    const schedule = SPOT_RELEASE_SCHEDULE[spotId];
    if (!schedule) return { success: false, error: '未知景点' };

    try {
      // 验证逻辑：抓取官网最新可约日期，与预期日期对比
      // const actualEarliestDate = await scrapeSpot(spotId);
      // const expectedDate = computeExpectedDate(schedule.advanceDays);
      // const normal = actualEarliestDate === expectedDate;

      // TODO: 占位实现
      // if (!normal) {
      //   // 发送异常告警
      // }

      return {
        success: true,
        spotId,
        normal: true, // placeholder
        message: `放票验证完成（占位）`,
      };
    } catch (err) {
      console.error(`放票验证失败 [${spotId}]`, err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, message: 'unknown action' };
};
