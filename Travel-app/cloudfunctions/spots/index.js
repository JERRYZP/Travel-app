/**
 * spots 云函数 —— 景点查询与放票状态实时计算
 *
 * 新形态职责已收窄：只负责景点数据与实时放票状态。
 * 原 toggleFavorite / profile 两个 action 随「收藏」功能一并移除
 * （新 IA 无收藏入口，产品文档第四册无 favorites 集合）。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  SPOTS: 'spots',
  RELEASE_RULES: 'release_rules', // 原 rules
  SEARCH_HISTORY: 'search_history',
};

/** ENUM-005 实时放票状态 */
const ReleaseStatus = {
  NOT_RELEASED: 'NOT_RELEASED',
  BOOKABLE: 'BOOKABLE',
  FULL: 'FULL',
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SEARCH_HISTORY_MAX = 10; // SEARCH-RULE-002

/**
 * 北京时间各部分。云函数运行在 UTC，必须平移后再读取（TIME-RULE-001）。
 */
function beijingParts(date = new Date()) {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}

function toDateStr(date = new Date()) {
  const p = beijingParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) + days * 86400000;
  const nd = new Date(base);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
}

function dayNameOfStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** ENUM-006 / TAG-RULE-001 难度标签的唯一真身 */
function computeDifficultyLabel(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约', color: 'red' };
  if (score === 3) return { key: 'NORMAL', text: '较难约', color: 'orange' };
  return { key: 'EASY', text: '容易约', color: 'green' };
}

const DAY_CN = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日' };
/**
 * 闭馆 / 开放日标签。四态，与 reminder/lib/time.js 的 openDaysLabel 同逻辑（云函数间不共享模块，故镜像一份）：
 * 1. openDays 非空（白名单，北大/清华）→ 「仅周六、周日开放」。
 *    绝不能落回「全年开放」——那正好说反，比不显示更糟。
 * 2. closedDays 非空 → 「周一闭馆」。
 * 3. 都没配但有 closedDaysNote → 用 note。用于「园中园周一闭馆、公园本体全开」的天坛/北海：
 *    要说清周一有东西不开，但不能改 closedDays，否则 App 会报「周一闭馆」而公园其实开着。
 * 4. 否则 → 「全年开放」。
 */
function closedDaysLabel(days, openDays, note) {
  const open = openDays || [];
  if (open.length > 0) return '仅' + open.map(d => DAY_CN[d] || d).join('、') + '开放';
  if (days && days.length > 0) return days.map(d => DAY_CN[d] || d).join('、') + '闭馆';
  if (note) return note;
  return '全年开放';
}

/** 当前生效中的官方公告：过了 specialNoticeUntil（含当天）自动不下发（同 reminder/lib/time.js） */
function activeNoticeOf(rule, now = new Date()) {
  if (!rule || !rule.specialNotice) return '';
  const until = rule.specialNoticeUntil;
  if (!until) return rule.specialNotice;
  return toDateStr(now) <= until ? rule.specialNotice : '';
}

function isOpenOn(rule, dayName) {
  if (!rule) return true;
  const open = rule.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(rule.closedDays || []).includes(dayName);
}

/**
 * 今日放票是否已开始（按北京时间比较，修正了原实现用 UTC 小时的时区 bug）
 */
function computeReleaseStatus(rule, now = new Date()) {
  if (!rule || !rule.releaseTime) return ReleaseStatus.NOT_RELEASED;

  const p = beijingParts(now);
  // 今天不可约（闭馆日 / 白名单外的星期）→ 今日不放票
  if (!isOpenOn(rule, p.dayName)) return ReleaseStatus.NOT_RELEASED;

  const [h, m] = rule.releaseTime.split(':').map(Number);
  const nowMinutes = p.hour * 60 + p.minute;
  const releaseMinutes = h * 60 + m;

  if (nowMinutes < releaseMinutes) return ReleaseStatus.NOT_RELEASED;
  // 已过放票时刻：真实「是否约满」需 scraper 支持，V1 统一按可约返回
  return ReleaseStatus.BOOKABLE;
}

/**
 * 最早可约日期 = 今天 + advanceDays，不可约则顺延到下一个可约日（isOpenOn 判定）
 *
 * 顺延上限按 7 天取：白名单景点（仅周末）最多顺延 6 天即可命中，
 * 黑名单景点同理。超限说明规则异常，返回 null 好过返回一个其实约不了的日期。
 */
function computeEarliestDate(rule, now = new Date()) {
  if (!rule || !rule.advanceDays) return null;
  let target = addDaysStr(toDateStr(now), rule.advanceDays);
  for (let i = 0; i < 7; i += 1) {
    if (isOpenOn(rule, dayNameOfStr(target))) return target;
    target = addDaysStr(target, 1);
  }
  return null;
}

/** B 层卡片描述（TAG-RULE-001 补充）：随到随买，当前{旺季/淡季}门票...，按北京时间判季节（TIME-RULE-001） */
function cardDescOf(rule, now = new Date()) {
  if (!rule) return '';
  const p = beijingParts(now);
  if (rule.peakPrice || rule.offPrice) {
    const isPeak = p.month >= 4 && p.month <= 10; // 北京公园旺季 4-10 月
    const frag = (isPeak ? rule.peakPrice : rule.offPrice) || rule.peakPrice || rule.offPrice;
    return '随到随买，当前' + frag;
  }
  const base = rule.cardPrice || rule.ticketPrice || '';
  return base ? '随到随买，' + base : '';
}

/** 弱提醒（需预约但非常好约）：标签行改为平和描述，不渲染放票紧迫标签 */
function weakLine(rule) {
  if (!rule) return '票量充足，无需卡点抢票';
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) {
    const adv = rule.advanceDays ? `提前${rule.advanceDays}天 ` : '';
    return `${adv}${Array.isArray(rt) ? rt.join('、') : rt}放票 · 票量充足，无需卡点`;
  }
  return '票量充足，无需卡点抢票';
}

/** TAG-RULE-001 标签构建：提前天数 + 放票时刻（支持多时段/空时刻） */
function buildTags(rule) {
  const t = [];
  if (rule.advanceDays) t.push(`提前${rule.advanceDays}天放票`);
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) t.push(`每日${Array.isArray(rt) ? rt.join('、') : rt}放票`);
  return t;
}

/** 组装景点卡（PAGE-001 网格 / PAGE-003 列表共用） */
function buildCard(spot, rule, now) {
  const status = computeReleaseStatus(rule, now);
  // 可提醒 = 需预约 且有真实放票时刻（无放票时刻如环球影城购票型 → 不进时间线/清单/任务）
  const remindable = spot.reservationRequired !== false && !!(rule && rule.advanceDays && (rule.releaseTimes || rule.releaseTime));
  const weak = spot.reservationRequired !== false && (spot.difficultyScore || 0) <= 2;
  let cardDesc = cardDescOf(rule, now);
  if (remindable && weak) cardDesc = weakLine(rule);
  else if (!remindable && spot.reservationRequired !== false) cardDesc = '无固定放票时刻，随买随用';
  return {
    spotId: spot.spotId,
    name: spot.name,
    category: spot.category,
    audienceTags: spot.audienceTags || [],
    district: spot.district,
    difficultyScore: spot.difficultyScore,
    difficultyLabel: computeDifficultyLabel(spot.difficultyScore),
    popularityScore: spot.popularityScore,
    // 2026 分层：是否仍需实名预约（B 层免预约 → 不进提醒流程，卡片显示「无需预约」tag）
    reservationRequired: spot.reservationRequired !== false,
    // 无放票时刻的需预约景点（如环球影城）也不可添加，按钮位显示「随买随用」tag
    remindable,
    // 弱提醒：需预约但非常好约（difficulty≤2），标签行给平和描述而非紧迫放票标签
    weak,
    cardDesc,
    // TAG-RULE-001 核心标签：只回答「什么时候抢、难不难抢」
    tags: rule ? buildTags(rule) : [],
    advanceDays: rule ? rule.advanceDays : null,
    releaseTime: rule ? (rule.releaseTimes || rule.releaseTime) : null,
    // B 层卡片信息区展示购票/入园信息
    ticketPrice: rule ? (rule.ticketPrice || '') : '',
    openTime: rule ? (rule.openTime || '') : '',
    closedDays: rule ? (rule.closedDays || []) : [],
    // 白名单开放日（非空时接管 closedDays），前端据此显示「仅周六、周日开放」
    openDays: rule ? (rule.openDays || []) : [],
    releaseStatus: status,
    earliestDate: computeEarliestDate(rule, now),
    lastCheckedDate: rule ? (rule.lastCheckedDate || '') : '',
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
    // scraper 未上线，「已约满」无法判定
    stale: status === ReleaseStatus.BOOKABLE,
  };
}

/** SEARCH-RULE-001 本地模糊匹配：名称 / 别名 / 拼音前缀 */
function matchSpot(spot, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const candidates = [
    spot.name,
    ...(spot.aliases || []),
    spot.pinyin || '',
    spot.pinyinInitials || '',
    spot.spotId,
  ].filter(Boolean).map(s => String(s).toLowerCase());
  return candidates.some(c => c.includes(kw) || c.startsWith(kw));
}

async function loadAll() {
  const [spotsRes, rulesRes] = await Promise.all([
    db.collection(COLLECTIONS.SPOTS).limit(200).get(),
    db.collection(COLLECTIONS.RELEASE_RULES).limit(200).get(),
  ]);
  const ruleMap = {};
  (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
  return { spots: spotsRes.data || [], ruleMap };
}

exports.main = async (event) => {
  const { action, spotId, spotIds, keyword } = event || {};
  const { OPENID } = cloud.getWXContext();
  const now = new Date();

  try {
    switch (action) {
      /** PAGE-001 热门景点网格 / PAGE-003 热门列表，SORT-RULE-001 按 popularityScore 降序 */
      case 'list': {
        const { spots, ruleMap } = await loadAll();
        const cards = spots
          .map(s => buildCard(s, ruleMap[s.spotId], now))
          .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
        return { success: true, data: cards };
      }

      /** PAGE-002 景点信息弹窗 */
      case 'detail': {
        if (!spotId) return { success: false, error: '缺少 spotId', errorCode: 1010 };
        const [spotRes, ruleRes] = await Promise.all([
          db.collection(COLLECTIONS.SPOTS).where({ spotId }).get(),
          db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId }).get(),
        ]);
        const spot = (spotRes.data || [])[0];
        if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
        const rule = (ruleRes.data || [])[0] || null;

        // PAGE-002 预约方式列表：SORT-RULE-001 按直达率排序，缺失渠道不显示空行
        const entries = [];
        if (spot.officialAppid) {
          entries.push({ type: 'MINIPROGRAM', label: '官方小程序', appid: spot.officialAppid, path: spot.officialPath || '', url: spot.officialWebUrl || '', hint: '点击直接跳转官方小程序预约' });
        }
        if (spot.officialAccount) {
          entries.push({ type: 'OFFICIAL_ACCOUNT', label: '微信公众号', value: spot.officialAccount, qrCode: spot.qrCode || '', hint: '点击参与预约 → 填写信息 → 预约成功' });
        }
        if (spot.officialWebUrl) {
          entries.push({ type: 'WEB', label: '景区官网', url: spot.officialWebUrl, hint: '点击直接进入官网预约' });
        }

        return {
          success: true,
          data: {
            ...buildCard(spot, rule, now),
            address: spot.address,
            location: spot.location,
            entries,
            // 预约注意事项（折叠展开），取自 release_rules
            bookingTips: rule ? rule.bookingTips : '',
            // 官方临时公告（如闭馆维修/临时停开），有内容时详情弹窗顶部红条显示
            specialNotice: activeNoticeOf(rule),
            openTime: rule ? rule.openTime : '',
            ticketPrice: rule ? rule.ticketPrice : '',
            idRequirement: rule ? rule.idRequirement : '',
            ageLimit: rule ? rule.ageLimit : '',
            closedDaysLabel: closedDaysLabel(rule && rule.closedDays, rule && rule.openDays, rule && rule.closedDaysNote),
            // 园中园等「部分闭馆」说明（天坛/北海）。仅当主标签已经承载了它（白名单/黑名单态）时
            // 才单独透出，否则会与 closedDaysLabel 重复显示同一句话。
            closedDaysNote: (rule && rule.closedDaysNote
              && (((rule.openDays || []).length > 0) || ((rule.closedDays || []).length > 0)))
              ? rule.closedDaysNote : '',
          },
        };
      }

      /** 批量取卡片（PAGE-003 已选景点行、PAGE-005 行程摘要用） */
      case 'batch': {
        if (!Array.isArray(spotIds) || spotIds.length === 0) return { success: true, data: [] };
        const [spotsRes, rulesRes] = await Promise.all([
          db.collection(COLLECTIONS.SPOTS).where({ spotId: _.in(spotIds) }).get(),
          db.collection(COLLECTIONS.RELEASE_RULES).where({ spotId: _.in(spotIds) }).get(),
        ]);
        const ruleMap = {};
        (rulesRes.data || []).forEach(r => { ruleMap[r.spotId] = r; });
        return {
          success: true,
          data: (spotsRes.data || []).map(s => buildCard(s, ruleMap[s.spotId], now)),
        };
      }

      /** PAGE-004 搜索态，SEARCH-RULE-001 本地匹配（V1 景点库 18 条，全量拉取后内存过滤） */
      case 'search': {
        if (!keyword || !String(keyword).trim()) return { success: true, data: [], history: [] };
        const { spots, ruleMap } = await loadAll();
        const hits = spots
          .filter(s => matchSpot(s, keyword))
          .map(s => buildCard(s, ruleMap[s.spotId], now))
          .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));

        // SEARCH-RULE-002 写入历史：去重、最多 10 条、最新在前
        if (OPENID) {
          const kw = String(keyword).trim();
          const exist = await db.collection(COLLECTIONS.SEARCH_HISTORY)
            .where({ userId: OPENID, keyword: kw }).get();
          for (const h of (exist.data || [])) {
            await db.collection(COLLECTIONS.SEARCH_HISTORY).doc(h._id).remove();
          }
          await db.collection(COLLECTIONS.SEARCH_HISTORY).add({
            data: { userId: OPENID, keyword: kw, searchedAt: now },
          });
          const allRes = await db.collection(COLLECTIONS.SEARCH_HISTORY)
            .where({ userId: OPENID }).orderBy('searchedAt', 'desc').get();
          const overflow = (allRes.data || []).slice(SEARCH_HISTORY_MAX);
          for (const o of overflow) {
            await db.collection(COLLECTIONS.SEARCH_HISTORY).doc(o._id).remove();
          }
        }

        return { success: true, data: hits };
      }

      /** PAGE-003 历史搜索 tag 行 */
      case 'searchHistory': {
        if (!OPENID) return { success: true, data: [] };
        const res = await db.collection(COLLECTIONS.SEARCH_HISTORY)
          .where({ userId: OPENID })
          .orderBy('searchedAt', 'desc')
          .limit(SEARCH_HISTORY_MAX)
          .get();
        return { success: true, data: (res.data || []).map(h => h.keyword) };
      }

      /** SEARCH-RULE-002 仅支持整组清空 */
      case 'clearSearchHistory': {
        if (!OPENID) return { success: false, error: '未登录', errorCode: 1000 };
        const res = await db.collection(COLLECTIONS.SEARCH_HISTORY)
          .where({ userId: OPENID }).remove();
        return { success: true, removed: res.stats ? res.stats.removed : 0 };
      }

      default:
        return { success: false, error: 'unknown action', errorCode: 1099 };
    }
  } catch (err) {
    console.error(`[spots] action=${action} failed`, err);
    return { success: false, error: err.message, errorCode: 1500 };
  }
};

exports._internal = {
  computeReleaseStatus, computeEarliestDate, computeDifficultyLabel,
  buildCard, cardDescOf, matchSpot, beijingParts, toDateStr, dayNameOfStr,
};
