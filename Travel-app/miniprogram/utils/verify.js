/**
 * 数据准确性：核验溯源助手（纯函数，无依赖）
 *
 * 准确性是小程序核心壁垒之一。`lastCheckedDate` 已随 buildCard 流到前端
 * （云端 + mock 一致），这里从它派生「数据是否已核验」的展示文案。
 */

/** 解析 YYYY-M-D，返回 {m, d}；解析失败返回 null */
function parseMD(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? { m: Number(m[2]), d: Number(m[3]) } : null;
}

/** 核验状态文案：已核验 → 显示核验日期；未核验 → 明确警示 */
function verifiedLabel(lastCheckedDate) {
  const p = parseMD(lastCheckedDate);
  return p ? `数据已核验·更新于${p.m}月${p.d}日` : '尚未复核，以官方为准';
}

/** 是否已核验（lastCheckedDate 有值即视为已核验） */
function isVerified(lastCheckedDate) {
  return !!parseMD(lastCheckedDate);
}

/** 数据来源统一文案 */
const SOURCE_TEXT = '来源：官方渠道';

module.exports = { verifiedLabel, isVerified, SOURCE_TEXT };
