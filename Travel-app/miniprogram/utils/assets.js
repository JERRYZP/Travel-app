/**
 * 代码包外静态资源。
 *
 * 微信代码质量会把整个代码包内所有图片/音频字节数相加，阈值只有 200KB。
 * 景点图、二维码、提醒示例图统一放到云存储 `static/v0.3/images/`，代码包内只保留
 * 图标、默认头像和分享封面等小资源。源文件备份在仓库根目录的 `cloud-assets/`。
 */
const CLOUD_ENV = 'cloud1-d9g9f4hja396d6e92';
const CLOUD_BUCKET = '636c-cloud1-d9g9f4hja396d6e92-1487385918';
const CLOUD_ROOT = 'cloud://' + CLOUD_ENV + '.' + CLOUD_BUCKET + '/static/v0.3/images/';

function fromLocalPath(value) {
  if (typeof value !== 'string') return value || '';
  if (value.indexOf('/images/') === 0) return CLOUD_ROOT + value.slice('/images/'.length);
  return value;
}

function reminderSample(key) {
  return CLOUD_ROOT + 'reminder-samples/' + key + '.jpg';
}

module.exports = {
  CLOUD_ROOT,
  SPOT_IMAGE_BASE: CLOUD_ROOT + 'spots/',
  CITY_IMAGE_BASE: CLOUD_ROOT + 'cities/',
  HOME_IMAGE_BASE: CLOUD_ROOT + 'home/',
  fromLocalPath,
  reminderSample,
};
