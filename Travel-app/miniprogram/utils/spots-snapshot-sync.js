/**
 * 景点快照增量同步。
 *
 * 每天最多检查一次。云端文件缺失、网络失败或格式不合法时继续使用包内快照。
 * 文件源在 cloud-assets/data/，上传到当前云环境 static/v1/data/。
 */

const spotsStatic = require('./spots-static.js');
const assets = require('./assets.js');
const spotsCache = require('./spots-cache.js');

const CHECK_KEY = 'spotsSnapshotRemoteCheckAtV1';
const REMOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MANIFEST_FILE_ID = assets.CLOUD_ROOT.replace('/static/v0.3/images/', '/static/v1/data/') + 'spots-manifest.json';
const SNAPSHOT_FILE_ID = assets.CLOUD_ROOT.replace('/static/v0.3/images/', '/static/v1/data/') + 'spots-snapshot.json';

let inflight = null;

function recentlyChecked() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return true;
    return Date.now() - (Number(wx.getStorageSync(CHECK_KEY)) || 0) < REMOTE_MAX_AGE_MS;
  } catch (e) {
    return true;
  }
}

function markChecked() {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(CHECK_KEY, Date.now());
  } catch (e) {}
}

function readDownloadedJson(filePath) {
  const fs = wx.getFileSystemManager && wx.getFileSystemManager();
  if (!fs || !fs.readFileSync) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function downloadJson(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: res => {
        const value = readDownloadedJson(res.tempFilePath);
        if (!value) reject(new Error('invalid snapshot json'));
        else resolve(value);
      },
      fail: reject,
    });
  });
}

function syncNow(options) {
  if (inflight) return inflight;
  if (!(options && options.force) && recentlyChecked()) return Promise.resolve({ skipped: true });
  markChecked();
  const manifestFileId = (options && options.manifestFileId) || MANIFEST_FILE_ID;
  const snapshotFileId = (options && options.snapshotFileId) || SNAPSHOT_FILE_ID;
  inflight = downloadJson(manifestFileId)
    .then(manifest => {
      if (!manifest || manifest.schemaVersion !== 'spots-snapshot/v1') {
        throw new Error('invalid manifest');
      }
      if (manifest.contentVersion === spotsStatic.getSnapshot().contentVersion) {
        return { updated: false, contentVersion: manifest.contentVersion };
      }
      return downloadJson(snapshotFileId).then(snapshot => {
        if (!spotsStatic.cacheRemoteSnapshot(snapshot)) throw new Error('invalid snapshot');
        spotsCache.invalidate();
        return { updated: true, contentVersion: snapshot.contentVersion };
      });
    })
    .catch(err => ({ updated: false, error: err && (err.errMsg || err.message) }))
    .then(result => {
      inflight = null;
      return result;
    });
  return inflight;
}

module.exports = { syncNow, CHECK_KEY, MANIFEST_FILE_ID, SNAPSHOT_FILE_ID };
