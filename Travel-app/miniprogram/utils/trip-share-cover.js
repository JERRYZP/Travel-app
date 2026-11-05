/**
 * 行程只读分享的会话封面。
 *
 * 微信小程序没有官方 DOM 截图 API，因此这里用 Canvas 2D 重绘
 * 「摘要卡 + 一条行程信息」。封面只消费公开信息，不画票务进度、
 * 提醒状态、菜单或个人身份；任何绘制失败都由调用方回退静态封面。
 */

const util = require('./util.js');
const assets = require('./assets.js');

const FALLBACK_IMAGE = '/images/share/home-today.jpg';
const COVER_WIDTH = 700;
const COVER_HEIGHT = 560;

function windowOf(trip) {
  return {
    startDate: trip.windowStartDate || trip.startDate,
    endDate: trip.windowEndDate || trip.endDate,
  };
}

function publicItemsInWindow(trip) {
  const window = windowOf(trip);
  return (trip && Array.isArray(trip.items) ? trip.items : [])
    .filter(item => item.visitDate >= window.startDate && item.visitDate <= window.endDate)
    .map(item => ({
      visitDate: item.visitDate,
      spotId: item.spotId,
      spotName: item.spotName,
    }))
    .filter(item => item.visitDate && item.spotName)
    .sort((a, b) => {
      const byDate = String(a.visitDate).localeCompare(String(b.visitDate));
      if (byDate !== 0) return byDate;
      return String(a.spotName).localeCompare(String(b.spotName));
    });
}

function firstPublicItem(trip) {
  return publicItemsInWindow(trip)[0] || null;
}

/**
 * 生成绘制模型。返回值只含展示所需的公共字段，拒绝把 itemId、
 * ticketState、reminder、result 等状态透传给 Canvas 层。
 */
function buildModel(trip) {
  const first = firstPublicItem(trip);
  if (!trip || !first) return null;
  const window = windowOf(trip);
  const items = publicItemsInWindow(trip);
  const spotIds = {};
  items.forEach(item => {
    if (item && item.spotId) spotIds[item.spotId] = true;
  });
  return {
    displayName: util.tripDisplayName(trip),
    dateRange: util.monthDayRange(window.startDate, window.endDate),
    dayText: util.dayDiff(window.startDate, window.endDate) + '天',
    spotText: Object.keys(spotIds).length + '处景点',
    watermark: util.tripWatermark(trip).join(''),
    first: {
      visitDate: first.visitDate,
      spotId: first.spotId,
      spotName: first.spotName,
      dateLabel: util.dayTitleOf(first.visitDate),
      dayLabel: '第' + util.dayDiff(window.startDate, first.visitDate) + '天',
    },
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fill) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function drawWatermark(ctx, text, x, y) {
  const chars = String(text || '').split('');
  ctx.save();
  ctx.fillStyle = 'rgba(234, 217, 168, .28)';
  ctx.font = '400 22px "Times New Roman", Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cursor = x;
  chars.forEach(ch => {
    ctx.fillText(ch, cursor, y);
    cursor += ch === ' ' ? 11 : 24;
  });
  ctx.restore();
}

function loadSpotImage(canvas, spotId) {
  return new Promise(resolve => {
    if (!spotId || typeof wx === 'undefined' || !wx.cloud || !wx.cloud.downloadFile) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = image => {
      if (settled) return;
      settled = true;
      resolve(image);
    };
    setTimeout(() => finish(null), 1200);
    wx.cloud.downloadFile({
      fileID: assets.SPOT_IMAGE_BASE + spotId + '.jpg',
    }).then(res => {
      const image = canvas.createImage();
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = res.tempFilePath;
    }).catch(() => finish(null));
  });
}

function drawCover(ctx, model, spotImage) {
  ctx.fillStyle = '#F8F3EA';
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  ctx.fillStyle = '#4A3025';
  ctx.font = '600 25px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('行程 · 提醒', COVER_WIDTH / 2, 42);

  const gradient = ctx.createLinearGradient(36, 74, 664, 320);
  gradient.addColorStop(0.129, '#C65941');
  gradient.addColorStop(0.8746, '#B8432A');
  fillRoundRect(ctx, 36, 74, 628, 252, 22, gradient);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 38px sans-serif';
  ctx.fillText(model.displayName, 66, 124);
  drawWatermark(ctx, model.watermark, 236, 123);

  ctx.fillStyle = '#EAD9A8';
  ctx.font = '400 24px sans-serif';
  ctx.fillText(model.dateRange, 66, 178);

  ctx.fillStyle = 'rgba(234, 217, 168, .96)';
  ctx.font = '500 26px sans-serif';
  ctx.fillText(model.dayText + ' · ' + model.spotText, 66, 242);
  fillRoundRect(ctx, 522, 219, 112, 46, 23, 'rgba(234, 217, 168, .22)');
  ctx.fillStyle = '#F6E0B5';
  ctx.font = '500 21px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('只读行程', 578, 242);

  fillRoundRect(ctx, 36, 350, 628, 166, 22, '#FFFFFF');
  if (spotImage) {
    ctx.save();
    roundRect(ctx, 62, 380, 106, 106, 14);
    ctx.clip();
    ctx.drawImage(spotImage, 62, 380, 106, 106);
    ctx.restore();
  } else {
    fillRoundRect(ctx, 62, 380, 106, 106, 14, '#F3DFBD');
    ctx.fillStyle = '#B8904A';
    ctx.font = '500 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('北京', 115, 433);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#967F6D';
  ctx.font = '400 21px sans-serif';
  ctx.fillText(model.first.dateLabel, 194, 398);
  fillRoundRect(ctx, 446, 380, 88, 36, 10, '#F8E7C7');
  ctx.fillStyle = '#B8904A';
  ctx.font = '500 19px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(model.first.dayLabel, 490, 398);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#3F2E27';
  ctx.font = '600 31px sans-serif';
  ctx.fillText(fitText(ctx, model.first.spotName, 456), 194, 449);

  ctx.fillStyle = '#B8904A';
  ctx.font = '400 20px sans-serif';
  ctx.fillText('打开小程序查看完整行程', 194, 487);
}

function canvasToFile(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      destWidth: COVER_WIDTH,
      destHeight: COVER_HEIGHT,
      fileType: 'jpg',
      quality: 0.68,
      success: res => resolve(res.tempFilePath || ''),
      fail: reject,
    });
  });
}

function getCanvas(page) {
  return new Promise((resolve, reject) => {
    if (!wx.createSelectorQuery) {
      reject(new Error('canvas unavailable'));
      return;
    }
    wx.createSelectorQuery()
      .in(page)
      .select('#trip-share-cover-canvas')
      .fields({ node: true, size: true })
      .exec(res => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) reject(new Error('canvas node missing'));
        else resolve(canvas);
      });
  });
}

/**
 * 生成封面。调用方必须允许失败并继续分享，封面不能成为分享主链路。
 */
async function generate(page, trip) {
  try {
    const model = buildModel(trip);
    if (!model) return FALLBACK_IMAGE;
    const canvas = await getCanvas(page);
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const ctx = canvas.getContext('2d');
    const image = await loadSpotImage(canvas, model.first.spotId);
    drawCover(ctx, model, image);
    const path = await canvasToFile(canvas);
    return path || FALLBACK_IMAGE;
  } catch (err) {
    return FALLBACK_IMAGE;
  }
}

module.exports = {
  FALLBACK_IMAGE,
  buildModel,
  generate,
};
