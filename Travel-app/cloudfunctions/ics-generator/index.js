/**
 * ics-generator 云函数 —— 生成 / 更新用户日历文件（ICS-RULE-001/002）
 *
 * 交付方式：单用户单文件，覆盖写云存储。
 * 每次任务变更（提交 / 删除）由 reminder 函数触发 rebuild，
 * 前端用 wx.downloadFile + wx.openDocument 让用户导入系统日历。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = {
  REMINDER_TASKS: 'reminder_tasks',
  SPOTS: 'spots',
};

const ReminderBackendStatus = {
  WAITING: 'WAITING',
  TRIGGERED: 'TRIGGERED',
  MISSED: 'MISSED',
  CLOSED: 'CLOSED',
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** ICS 需要的 UTC 基本格式：20260531T120000Z */
function toIcsUtc(date) {
  const s = new Date(date).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`;
}

/** 北京时间的 M月D日，用于事件描述 */
function beijingMonthDay(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * RFC 5545 文本转义：反斜杠、分号、逗号需转义，换行写成 \n
 */
function escapeText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 要求每行不超过 75 字节，超出需折行（后续行以单个空格开头）。
 * 中文按 UTF-8 3 字节计，必须按字节而非字符折。
 */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // 避免切断多字节字符：向前退到 UTF-8 字符边界
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74; // 后续行首有一个空格，实际内容 74 字节
  }
  return out.join('\r\n ');
}

/**
 * 生成单个 VEVENT
 * 一条任务 × 每个 offset = 一个日历事件（用户勾了 5 分钟和 2 分钟就有两个提醒）
 */
function buildEvent(task, spot, offsetMinutes, stamp) {
  const releaseAt = new Date(task.releaseAt);
  const remindAt = new Date(releaseAt.getTime() - offsetMinutes * 60 * 1000);
  const spotName = spot ? spot.name : '景点';

  // UID 需全局唯一且稳定：同一任务同一 offset 重生成时保持一致，便于日历端去重更新
  const uid = `${task._id}-${offsetMinutes}@travel-app`;

  const entry = [];
  const bookingUrl = spot && spot.officialWebUrl ? spot.officialWebUrl : '';
  const desc = [
    `${spotName} ${beijingMonthDay(task.visitDate)} 门票将在 ${offsetMinutes} 分钟后放票。`,
    bookingUrl ? `预约入口：${bookingUrl}` : '',
    '本提醒由「景点预约提醒」生成，请手动前往官方渠道预约。',
  ].filter(Boolean).join('\n');

  entry.push('BEGIN:VEVENT');
  entry.push(`UID:${uid}`);
  entry.push(`DTSTAMP:${stamp}`);
  entry.push(`DTSTART:${toIcsUtc(remindAt)}`);
  // 提醒是时间点事件，给 5 分钟时长以便在日历中可见
  entry.push(`DTEND:${toIcsUtc(new Date(remindAt.getTime() + 5 * 60 * 1000))}`);
  entry.push(foldLine(`SUMMARY:${escapeText(`${spotName}放票提醒`)}`));
  entry.push(foldLine(`DESCRIPTION:${escapeText(desc)}`));
  if (bookingUrl) entry.push(foldLine(`URL:${escapeText(bookingUrl)}`));
  // 事件本身即提醒时刻，触发器设为 0 分钟
  entry.push('BEGIN:VALARM');
  entry.push('ACTION:DISPLAY');
  entry.push(foldLine(`DESCRIPTION:${escapeText(`${spotName}即将放票`)}`));
  entry.push('TRIGGER:-PT0M');
  entry.push('END:VALARM');
  entry.push('END:VEVENT');
  return entry;
}

/**
 * 组装完整 .ics 文件
 * ICS-RULE-001：已提醒事件保留为历史，只有被删除的待提醒任务才移除
 */
function buildCalendar(tasks, spotMap, nowTs = new Date()) {
  const stamp = toIcsUtc(nowTs);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel App//景点预约提醒//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine('X-WR-CALNAME:景点放票提醒'),
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];

  let count = 0;
  for (const task of tasks) {
    if (task.backendStatus === ReminderBackendStatus.CLOSED) continue;
    const offsets = Array.isArray(task.offsets) && task.offsets.length ? task.offsets : [5];
    for (const off of offsets) {
      lines.push(...buildEvent(task, spotMap[task.spotId], off, stamp));
      count += 1;
    }
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 要求 CRLF 换行
  return { content: `${lines.join('\r\n')}\r\n`, eventCount: count };
}

exports.main = async (event) => {
  const { action = 'rebuild' } = event || {};
  // 由 reminder 函数内部调用时传入 userId；直接调用时取调用者 openid
  const userId = event.userId || cloud.getWXContext().OPENID;

  if (!userId) return { success: false, error: '缺少 userId' };

  if (action !== 'rebuild') {
    return { success: false, error: `unknown action: ${action}` };
  }

  try {
    const taskRes = await db.collection(COLLECTIONS.REMINDER_TASKS)
      .where({ userId })
      .orderBy('releaseAt', 'asc')
      .get();
    const tasks = taskRes.data || [];

    const spotIds = [...new Set(tasks.map(t => t.spotId))];
    const spotMap = {};
    if (spotIds.length) {
      const spotsRes = await db.collection(COLLECTIONS.SPOTS)
        .where({ spotId: db.command.in(spotIds) })
        .get();
      (spotsRes.data || []).forEach(s => { spotMap[s.spotId] = s; });
    }

    const { content, eventCount } = buildCalendar(tasks, spotMap);

    // 单用户单文件，固定路径覆盖写
    const cloudPath = `ics/${userId}.ics`;
    const up = await cloud.uploadFile({
      cloudPath,
      fileContent: Buffer.from(content, 'utf8'),
    });

    // 前端需要临时 https 链接才能 wx.downloadFile
    const urlRes = await cloud.getTempFileURL({ fileList: [up.fileID] });
    const tempUrl = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || '';

    return {
      success: true,
      fileID: up.fileID,
      downloadUrl: tempUrl,
      eventCount,
      taskCount: tasks.length,
    };
  } catch (err) {
    console.error('[ics-generator] 生成失败', err);
    // ICS-RULE-002：同步失败不阻塞微信侧提醒
    return { success: false, error: err.message };
  }
};

// 供本地测试引用
exports._internal = { buildCalendar, buildEvent, escapeText, foldLine, toIcsUtc };
