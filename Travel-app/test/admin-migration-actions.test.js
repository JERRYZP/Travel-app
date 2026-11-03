/**
 * 售后工作台一键迁移：游标续跑、两批自动完成、完成后清理本机进度。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const storage = new Map();
const storedCursors = [];

global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } });
global.wx = {
  getStorageSync: key => storage.get(key) || '',
  setStorageSync: (key, value) => {
    storedCursors.push(value);
    storage.set(key, value);
  },
  removeStorageSync: key => storage.delete(key),
  showModal: opts => opts.success({ confirm: true }),
  showToast: () => {},
};

let pageDef = null;
global.Page = def => { pageDef = def; };

const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/admin-after-sales/admin-after-sales.js');

function createPage() {
  const page = {
    data: JSON.parse(JSON.stringify(pageDef.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  Object.keys(pageDef).forEach(key => {
    if (typeof pageDef[key] === 'function') page[key] = pageDef[key];
  });
  return page;
}

async function run() {
  console.log('=== 1. 页面提供一键迁移与单批兜底 ===');
  const wxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/admin-after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  assert.strictEqual(wxml.includes('bindtap="onMigrateAllProtection"'), true);
  assert.strictEqual(wxml.includes('一键迁移全部'), true);
  assert.strictEqual(wxml.includes('bindtap="onMigrateProtection"'), true);
  assert.strictEqual(wxml.includes('wx:if="{{migrationEntryEnabled && !migrationCompleted}}"'), true);

  console.log('\n=== 2. 售后工单默认进入审核中 ===');
  const filterPage = createPage();
  filterPage.loadList = async () => true;
  filterPage.loadOrderStats = async () => true;
  filterPage.onTabTap({ currentTarget: { dataset: { tab: 'afterSales' } } });
  assert.strictEqual(filterPage.data.activeFilter, 'UNDER_REVIEW');
  assert.deepStrictEqual(
    filterPage.data.filters.map(item => item.key),
    ['', 'UNDER_REVIEW', 'AUTO_CHECKING', 'PROCESSING', 'REFUND_FAILED']
  );

  console.log('\n=== 3. 从上次游标继续并自动跑完 ===');
  storage.set('admin_protection_migration_cursor_v1', 'user_resume');
  const cursors = [];
  const responses = [
    { success: true, scanned: 50, updated: 48, hasMore: true, nextCursor: 'user_50' },
    { success: true, scanned: 10, updated: 10, hasMore: false, nextCursor: 'user_60' },
  ];
  api.payment.afterSales.adminMigrateProtection = async cursor => {
    cursors.push(cursor);
    return responses.shift();
  };
  api.payment.afterSales.adminStatus = async () => ({
    success: true,
    isAdmin: true,
    migrationCompleted: false,
  });

  const page = createPage();
  page.onLoad();
  assert.strictEqual(page.data.migrationEntryEnabled, false, '迁移完成后正式工作台关闭入口');
  await page.loadMigrationStatus();
  assert.strictEqual(page.data.migrationCursor, 'user_resume');
  assert.strictEqual(page.data.migrationCompleted, false);
  page._migrationBatchDelayMs = 0;
  await page.startMigrationAll();

  assert.deepStrictEqual(cursors, ['user_resume', 'user_50']);
  assert.strictEqual(page.data.migrationTotalScanned, 60);
  assert.strictEqual(page.data.migrationTotalUpdated, 58);
  assert.strictEqual(page.data.migrationHasMore, false);
  assert.strictEqual(page.data.migrationCompleted, true);
  assert.strictEqual(page.data.migrationAutoRunning, false);
  assert.strictEqual(page.data.migrating, false);
  assert.deepStrictEqual(storedCursors, ['user_50'], '第一批完成后保存下一批游标');
  assert.strictEqual(storage.has('admin_protection_migration_cursor_v1'), false);
  assert.strictEqual(page.data.migrationMessage.includes('迁移已完成'), true);

  console.log('\nALL PASS');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
