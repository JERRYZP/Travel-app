const assert = require('assert');
const path = require('path');

const syncPath = path.resolve(__dirname, '../miniprogram/utils/spots-snapshot-sync.js');
const staticPath = path.resolve(__dirname, '../miniprogram/utils/spots-static.js');
const original = require(staticPath).getSnapshot();

function loadSync(downloadImpl) {
  const storage = {};
  global.wx = {
    getStorageSync(key) { return storage[key]; },
    setStorageSync(key, value) { storage[key] = value; },
    getFileSystemManager() {
      return {
        readFileSync(filePath) {
          return JSON.stringify(downloadImpl.files[filePath]);
        },
      };
    },
    cloud: {
      downloadFile(options) {
        if (downloadImpl.fail) {
          options.fail(new Error('network down'));
          return;
        }
        const file = downloadImpl.responses[options.fileID];
        if (!file) {
          options.fail(new Error('not found'));
          return;
        }
        options.success({ tempFilePath: file });
      },
    },
  };
  delete require.cache[syncPath];
  return require(syncPath);
}

async function run() {
  let sync = loadSync({ fail: true, files: {}, responses: {} });
  let result = await sync.syncNow({ force: true });
  assert.ok(result.error);

  sync = loadSync({
    files: {},
    responses: {},
  });
  sync.MANIFEST_FILE_ID = 'manifest';
  result = await sync.syncNow({ force: true });
  assert.ok(result.error);

  const next = { ...original, contentVersion: 'aaaaaaaaaaaaaaaaaaaa' };
  const files = { 'manifest-temp': { schemaVersion: 'spots-snapshot/v1', contentVersion: next.contentVersion }, 'snapshot-temp': next };
  sync = loadSync({
    files,
    responses: { 'manifest-file': 'manifest-temp', 'snapshot-file': 'snapshot-temp' },
  });
  result = await sync.syncNow({
    force: true,
    manifestFileId: 'manifest-file',
    snapshotFileId: 'snapshot-file',
  });
  assert.strictEqual(result.updated, true);
  assert.strictEqual(result.contentVersion, next.contentVersion);

  console.log('spots-snapshot-sync.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
