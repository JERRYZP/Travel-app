const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 抓取策略：
// - action: 'scheduled' → 每日凌晨 00:30 定时触发，全量更新
// - action: 'verify'     → 各景点放票时刻后 5 分钟触发，验证放票是否正常滚动
//
// V1 状态：Playwright 抓取逻辑未实现（scraping-plan.md Phase 1 未启动）。
// 影响面：TIMELINE-RULE-004 的「已约满」（ENUM-005 FULL）判不出来，
// 已放票事件统一按「立即预约」返回并带 stale 标记，由前端提示数据仅供参考。
// 时间线生成本身不依赖抓取——releaseAt 完全由 advanceDays/releaseTime/closedDays 推算。
//
// 放票时间表由 release_rules 集合提供，此处不再硬编码副本，避免与数据库不一致。

const COLLECTIONS = {
  SPOTS: 'spots',
  RELEASE_RULES: 'release_rules',
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 北京时间日期字符串（TIME-RULE-001） */
function toBeijingDateStr(date = new Date()) {
  const s = new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString();
  return s.slice(0, 10);
}

exports.main = async (event, context) => {
  const { action, spotId } = event || {};

  if (action === 'scheduled') {
    try {
      const rulesRes = await db.collection(COLLECTIONS.RELEASE_RULES).limit(200).get();
      const rules = rulesRes.data || [];
      const results = [];

      for (const rule of rules) {
        // TODO(Phase 1): Playwright 抓取该景点官网最新可约日期
        // const scraped = await scrapeSpot(rule.spotId);
        // await db.collection(COLLECTIONS.RELEASE_RULES).doc(rule._id).update({
        //   data: { lastCheckedDate: toBeijingDateStr(), earliestDateActual: scraped.earliestDate },
        // });
        results.push({ spotId: rule.spotId, success: true, mode: 'placeholder' });
      }

      return {
        success: true,
        message: `已扫描 ${results.length} 个景点（抓取逻辑待实现）`,
        checkedDate: toBeijingDateStr(),
        results,
      };
    } catch (err) {
      console.error('[scraper] 定时抓取失败', err);
      return { success: false, error: err.message };
    }
  }

  if (action === 'verify') {
    if (!spotId) return { success: false, error: '缺少 spotId' };

    try {
      const ruleRes = await db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId }).get();
      const rule = (ruleRes.data || [])[0];
      if (!rule) return { success: false, error: '未知景点' };

      // TODO(Phase 1): 抓取实际最早可约日期，与 (今天 + advanceDays) 对比
      // 不一致 → 放票规则可能变更，发送告警（ERROR-1005）
      return {
        success: true,
        spotId,
        normal: true,
        mode: 'placeholder',
        message: '放票验证占位（抓取逻辑待实现）',
      };
    } catch (err) {
      console.error(`[scraper] 放票验证失败 [${spotId}]`, err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, message: 'unknown action' };
};
