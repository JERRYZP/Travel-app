#!/usr/bin/env node
/**
 * 生成景点静态快照。
 *
 * 唯一输入：
 *   - data/spots.json
 *   - data/rules.json
 *
 * 输出：
 *   - miniprogram/data/spots-snapshot.js（随包兜底）
 *   - cloud-assets/data/spots-snapshot.json（静态托管 / 云存储发布源）
 *   - cloud-assets/data/spots-manifest.json
 *
 * 快照只改变分发方式，不是业务真身。禁止手工修改生成文件。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPOTS_SOURCE = path.join(ROOT, 'data', 'spots.json');
const RULES_SOURCE = path.join(ROOT, 'data', 'rules.json');
const PACKAGE_OUTPUT = path.join(ROOT, 'miniprogram', 'data', 'spots-snapshot.js');
const STATIC_DIR = path.join(ROOT, 'cloud-assets', 'data');
const STATIC_OUTPUT = path.join(STATIC_DIR, 'spots-snapshot.json');
const MANIFEST_OUTPUT = path.join(STATIC_DIR, 'spots-manifest.json');

const SCHEMA_VERSION = 'spots-snapshot/v1';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_CN = {
  monday: '周一',
  tuesday: '周二',
  wednesday: '周三',
  thursday: '周四',
  friday: '周五',
  saturday: '周六',
  sunday: '周日',
};
const ReleaseStatus = {
  NOT_RELEASED: 'NOT_RELEASED',
  BOOKABLE: 'BOOKABLE',
  FULL: 'FULL',
};

function beijingParts(date) {
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

function toDateStr(date) {
  const p = beijingParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDaysStr(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function dayNameOfStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function isOpenOn(rule, dayName) {
  if (!rule) return true;
  const open = rule.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(rule.closedDays || []).includes(dayName);
}

function computeDifficultyLabel(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约', color: 'red' };
  if (score === 3) return { key: 'NORMAL', text: '较难约', color: 'orange' };
  return { key: 'EASY', text: '容易约', color: 'green' };
}

function computeReleaseStatus(rule, now) {
  if (!rule || !rule.releaseTime) return ReleaseStatus.NOT_RELEASED;
  const p = beijingParts(now);
  if (!isOpenOn(rule, p.dayName)) return ReleaseStatus.NOT_RELEASED;
  const [hour, minute] = rule.releaseTime.split(':').map(Number);
  return p.hour * 60 + p.minute < hour * 60 + minute
    ? ReleaseStatus.NOT_RELEASED
    : ReleaseStatus.BOOKABLE;
}

function computeEarliestDate(rule, now) {
  if (!rule || !rule.advanceDays) return null;
  let target = addDaysStr(toDateStr(now), rule.advanceDays);
  for (let i = 0; i < 7; i += 1) {
    if (isOpenOn(rule, dayNameOfStr(target))) return target;
    target = addDaysStr(target, 1);
  }
  return null;
}

function cardDescOf(rule, now) {
  if (!rule) return '';
  const p = beijingParts(now);
  if (rule.peakPrice || rule.offPrice) {
    const isPeak = p.month >= 4 && p.month <= 10;
    const fragment = (isPeak ? rule.peakPrice : rule.offPrice) || rule.peakPrice || rule.offPrice;
    return `随到随买，当前${fragment}`;
  }
  const base = rule.cardPrice || rule.ticketPrice || '';
  return base ? `随到随买，${base}` : '';
}

function weakLine(rule) {
  if (!rule) return '票量充足，无需卡点抢票';
  const releaseTime = rule.releaseTimes || rule.releaseTime;
  if (!releaseTime) return '票量充足，无需卡点抢票';
  const advance = rule.advanceDays ? `提前${rule.advanceDays}天 ` : '';
  return `${advance}${Array.isArray(releaseTime) ? releaseTime.join('、') : releaseTime}放票 · 票量充足，无需卡点`;
}

function buildTags(rule) {
  const tags = [];
  if (rule.advanceDays) tags.push(`提前${rule.advanceDays}天放票`);
  const releaseTime = rule.releaseTimes || rule.releaseTime;
  if (releaseTime) tags.push(`每日${Array.isArray(releaseTime) ? releaseTime.join('、') : releaseTime}放票`);
  return tags;
}

function closedDaysLabel(days, openDays, note) {
  const open = openDays || [];
  if (open.length > 0) return `仅${open.map(day => DAY_CN[day] || day).join('、')}开放`;
  if (days && days.length > 0) return `${days.map(day => DAY_CN[day] || day).join('、')}闭馆`;
  return note || '全年开放';
}

function buildEntries(spot) {
  const entries = [];
  if (spot.officialAppid) {
    entries.push({
      type: 'MINIPROGRAM',
      label: '官方小程序',
      appid: spot.officialAppid,
      path: spot.officialPath || '',
      url: spot.officialWebUrl || '',
      hint: '点击直接跳转官方小程序预约',
    });
  }
  if (spot.officialAccount) {
    entries.push({
      type: 'OFFICIAL_ACCOUNT',
      label: '微信公众号',
      value: spot.officialAccount,
      qrCode: spot.qrCode || '',
      hint: '点击参与预约 → 填写信息 → 预约成功',
    });
  }
  if (spot.officialWebUrl) {
    entries.push({
      type: 'WEB',
      label: '景区官网',
      url: spot.officialWebUrl,
      hint: '点击直接进入官网预约',
    });
  }
  return entries;
}

function buildCard(spot, rule, now) {
  const remindable = spot.reservationRequired !== false
    && !!(rule && rule.advanceDays && (rule.releaseTimes || rule.releaseTime));
  const weak = spot.reservationRequired !== false
    && spot.strongReminder !== true
    && (spot.difficultyScore || 0) <= 2;
  let cardDesc = cardDescOf(rule, now);
  if (remindable && weak) cardDesc = weakLine(rule);
  else if (!remindable && spot.reservationRequired !== false) cardDesc = '无固定放票时刻，随买随用';
  const releaseStatus = computeReleaseStatus(rule, now);
  return {
    spotId: spot.spotId,
    name: spot.name,
    shortName: spot.shortName || spot.name,
    aliases: spot.aliases || [],
    category: spot.category,
    audienceTags: spot.audienceTags || [],
    district: spot.district,
    difficultyScore: spot.difficultyScore,
    difficultyLabel: computeDifficultyLabel(spot.difficultyScore),
    popularityScore: spot.popularityScore,
    reservationRequired: spot.reservationRequired !== false,
    remindable,
    addable: true,
    weak,
    cardDesc,
    tags: rule ? buildTags(rule) : [],
    advanceDays: rule ? rule.advanceDays : null,
    releaseTime: rule ? (rule.releaseTimes || rule.releaseTime) : null,
    releaseTimes: rule ? (rule.releaseTimes || null) : null,
    cardPrice: rule ? (rule.cardPrice || '') : '',
    peakPrice: rule ? (rule.peakPrice || '') : '',
    offPrice: rule ? (rule.offPrice || '') : '',
    ticketPrice: rule ? (rule.ticketPrice || '') : '',
    openTime: rule ? (rule.openTime || '') : '',
    closedDays: rule ? (rule.closedDays || []) : [],
    openDays: rule ? (rule.openDays || []) : [],
    releaseStatus,
    earliestDate: computeEarliestDate(rule, now),
    lastCheckedDate: rule ? (rule.lastCheckedDate || '') : '',
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
    stale: releaseStatus === ReleaseStatus.BOOKABLE,
  };
}

function buildDetail(spot, rule, now) {
  return {
    ...buildCard(spot, rule, now),
    address: spot.address || '',
    location: spot.location || null,
    entries: buildEntries(spot),
    bookingTips: rule ? (rule.bookingTips || '') : '',
    specialNotice: rule ? (rule.specialNotice || '') : '',
    specialNoticeUntil: rule ? (rule.specialNoticeUntil || '') : '',
    openTime: rule ? (rule.openTime || '') : '',
    ticketPrice: rule ? (rule.ticketPrice || '') : '',
    idRequirement: rule ? (rule.idRequirement || '') : '',
    ageLimit: rule ? (rule.ageLimit || '') : '',
    qrCode: spot.qrCode || '',
    closedDaysLabel: closedDaysLabel(rule && rule.closedDays, rule && rule.openDays, rule && rule.closedDaysNote),
    closedDaysNote: (rule && rule.closedDaysNote
      && (((rule.openDays || []).length > 0) || ((rule.closedDays || []).length > 0)))
      ? rule.closedDaysNote
      : '',
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function buildArtifacts() {
  const spotsSource = JSON.parse(fs.readFileSync(SPOTS_SOURCE, 'utf8'));
  const rulesSource = JSON.parse(fs.readFileSync(RULES_SOURCE, 'utf8'));
  const spots = spotsSource.spots || [];
  const rules = rulesSource.rules || [];
  const ruleMap = Object.fromEntries(rules.map(rule => [rule.spotId, rule]));
  const sourceMaxDate = rules
    .map(rule => rule.lastCheckedDate || '')
    .filter(Boolean)
    .sort()
    .pop() || '';
  const generatedAt = sourceMaxDate ? `${sourceMaxDate}T00:00:00+08:00` : '1970-01-01T00:00:00+08:00';
  const buildNow = new Date(generatedAt);
  const contentVersion = sha256(JSON.stringify({ spots, rules })).slice(0, 20);
  const cards = spots
    .map(spot => buildDetail(spot, ruleMap[spot.spotId], buildNow))
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    sourceMaxDate,
    cards,
  };
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    file: 'spots-snapshot.json',
  };
  return {
    contentVersion,
    cards,
    outputs: {
      [STATIC_OUTPUT]: json,
      [MANIFEST_OUTPUT]: `${JSON.stringify(manifest, null, 2)}\n`,
      [PACKAGE_OUTPUT]: [
        '/* 自动生成：运行 node scripts/build-spots-snapshot.js，禁止手改。 */',
        `module.exports = ${JSON.stringify(snapshot)};`,
        '',
      ].join('\n'),
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const result = buildArtifacts();
  if (check) {
    const stale = Object.entries(result.outputs).filter(([file, expected]) => {
      try {
        return fs.readFileSync(file, 'utf8') !== expected;
      } catch (e) {
        return true;
      }
    });
    if (stale.length > 0) {
      console.error('spots snapshot is stale; run npm run build:spots-snapshot');
      stale.forEach(([file]) => console.error(`- ${path.relative(ROOT, file)}`));
      process.exitCode = 1;
      return;
    }
    console.log(`spots snapshot ${result.contentVersion}: up to date`);
    return;
  }
  Object.entries(result.outputs).forEach(([file, content]) => writeFile(file, content));
  console.log(`spots snapshot ${result.contentVersion}: ${result.cards.length} cards`);
}

if (require.main === module) main();

module.exports = {
  SCHEMA_VERSION,
  buildArtifacts,
  beijingParts,
  toDateStr,
  addDaysStr,
  dayNameOfStr,
  isOpenOn,
  computeDifficultyLabel,
  computeReleaseStatus,
  computeEarliestDate,
  cardDescOf,
  weakLine,
  buildTags,
  closedDaysLabel,
  buildEntries,
  buildCard,
  buildDetail,
};
