/**
 * 客服工作台提醒质量卡：视图状态和结构回归。
 * 运行：node test/admin-reminder-quality-ui.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const api = require('../miniprogram/utils/api');
const mock = require('../miniprogram/utils/mock');
const originalStats = api.payment.adminReminderQuality.stats;
const QUALITY_CACHE_KEY = 'admin_reminder_quality_snapshot_v1';
const qualityStorage = {};

let fail = 0;
const eq = (actual, expected, message) => {
  if (String(actual) === String(expected)) {
    console.log('ok  ', message, '=', actual);
    return;
  }
  fail += 1;
  console.log('FAIL', message, '\n  got :', actual, '\n  want:', expected);
};

function fixture(status = 'HEALTHY', overrides = {}) {
  return {
    quality: {
      timezone: 'Asia/Shanghai',
      threshold: { onTimeRate: 99, delayToleranceSeconds: 120 },
      currentWindow: {
        label: '今日 05:00-13:00',
        updatedLabel: '13:00',
        durationHours: 8,
        expectedCount: 12,
        onTimeCount: 11,
        lateCount: 1,
        missedCount: 0,
        skippedCount: 0,
        unknownCount: 0,
        onTimeRate: 91.67,
        p95DelaySeconds: 78,
        status,
        reasonCodes: status === 'ALERT' ? ['BELOW_THRESHOLD'] : ['LATE'],
        nextUpdateAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
      baseline5d: {
        startDate: '2026-10-27',
        endDate: '2026-10-31',
        daysWithData: 5,
        expectedCount: 70,
        onTimeRate: 99.4,
      },
      dataTruncated: false,
      generatedAt: '2026-11-02T01:00:00.000Z',
    },
  };
}

let pageDefinition = null;
global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
});
global.Page = definition => { pageDefinition = definition; };
global.wx = {
  showToast() {},
  showModal() {},
  getStorageSync(key) { return qualityStorage[key] || ''; },
  setStorageSync(key, value) { qualityStorage[key] = value; },
  removeStorageSync(key) { delete qualityStorage[key]; },
};

require('../miniprogram/admin/after-sales/admin-after-sales');

function context() {
  const ctx = {
    data: {},
    setData(patch) { Object.assign(this.data, patch); },
  };
  for (const method of [
    'loadReminderQuality',
    'scheduleReminderQualityRefresh',
    'scheduleReminderQualityRetry',
    'clearReminderQualityTimer',
  ]) {
    ctx[method] = pageDefinition[method];
  }
  return ctx;
}

async function loadWith(response) {
  const ctx = context();
  delete qualityStorage[QUALITY_CACHE_KEY];
  api.payment.adminReminderQuality.stats = () => Promise.resolve(response);
  await pageDefinition.loadReminderQuality.call(ctx, { force: true });
  return ctx.data.reminderQuality;
}

async function run() {
  console.log('=== 1. 质量卡状态 ===');
  const healthy = await loadWith(fixture('HEALTHY', {
    onTimeCount: 12,
    lateCount: 0,
    onTimeRate: 100,
  }));
  eq(healthy.statusLabel, '正常', '健康状态有文字标识');
  eq(healthy.statusTone, 'healthy', '健康状态使用绿色语义');
  eq(healthy.rateText, '100%', '主值展示最近 8 小时准时率');
  eq(healthy.sampleText, '截至 13:00', '展示最近更新时间');
  eq(healthy.baselineText, '99.4%', '展示前 5 日均值');

  const alert = await loadWith(fixture('ALERT', {
    onTimeCount: 10,
    lateCount: 1,
    missedCount: 1,
    onTimeRate: 83.33,
  }));
  eq(alert.statusLabel, '异常', '未送达显示异常');
  eq(alert.statusTone, 'alert', '异常使用红色语义');
  eq(alert.rateText, '83.33%', '低于阈值时仍展示真实送达率');

  const empty = await loadWith(fixture('EMPTY', {
    expectedCount: 0,
    onTimeCount: 0,
    lateCount: 0,
    missedCount: 0,
    onTimeRate: null,
    p95DelaySeconds: null,
  }));
  eq(empty.statusLabel, '无数据', '无任务时不用绿色伪装健康');
  eq(empty.rateText, '—', '无数据主值不显示 0%');
  eq(empty.sampleText, '截至 13:00', '无任务时仍显示更新时间');

  console.log('\n=== 1.1 节点快照缓存与刷新保留旧值 ===');
  const cachedFixture = fixture('HEALTHY', {
    onTimeCount: 12,
    lateCount: 0,
    onTimeRate: 100,
  });
  qualityStorage[QUALITY_CACHE_KEY] = {
    quality: cachedFixture.quality,
    savedAt: Date.now(),
  };
  let statsCalls = 0;
  api.payment.adminReminderQuality.stats = () => {
    statsCalls += 1;
    return Promise.resolve(fixture('ALERT'));
  };
  const cachedCtx = context();
  await pageDefinition.loadReminderQuality.call(cachedCtx);
  eq(statsCalls, 0, '下一个 13:00/21:00 前直接使用本地快照');
  eq(cachedCtx.data.reminderQuality.rateText, '100%', '本地快照立即渲染，不先清空');

  const retainedCtx = context();
  retainedCtx._qualitySnapshot = cachedFixture.quality;
  retainedCtx.data.reminderQuality = {
    rateText: '100%',
    statusLabel: '正常',
    statusTone: 'healthy',
    sampleText: '截至 13:00',
    baselineText: '99.4%',
    issueText: '',
    showRetry: false,
  };
  api.payment.adminReminderQuality.stats = () => Promise.resolve({ pending: true, quality: null });
  await pageDefinition.loadReminderQuality.call(retainedCtx, { force: true });
  eq(retainedCtx.data.reminderQuality.rateText, '100%', '节点快照尚未生成时保留上一份数据');
  eq(retainedCtx.data.reminderQuality.statusLabel, '正常', '后台计算中不清空质量卡');

  const firstPendingCtx = context();
  delete qualityStorage[QUALITY_CACHE_KEY];
  api.payment.adminReminderQuality.stats = () => Promise.resolve({ pending: true, quality: null });
  await pageDefinition.loadReminderQuality.call(firstPendingCtx, { force: true });
  eq(firstPendingCtx.data.reminderQuality.statusLabel, '统计中',
    '首次尚无快照时显示统计中并等待定时器写入');

  console.log('\n=== 2. 加载失败与待部署 ===');
  api.payment.adminReminderQuality.stats = () => Promise.reject({ errorCode: 1099 });
  const pendingCtx = context();
  delete qualityStorage[QUALITY_CACHE_KEY];
  await pageDefinition.loadReminderQuality.call(pendingCtx);
  eq(pendingCtx.data.reminderQuality.statusLabel, '待部署', '旧后端显示待部署');
  eq(pendingCtx.data.reminderQuality.showRetry, false, '待部署不显示误导重试');

  api.payment.adminReminderQuality.stats = () => Promise.reject({ errorCode: 1500 });
  const failedCtx = context();
  delete qualityStorage[QUALITY_CACHE_KEY];
  await pageDefinition.loadReminderQuality.call(failedCtx);
  eq(failedCtx.data.reminderQuality.statusLabel, '不可用', '接口失败不显示健康');
  eq(failedCtx.data.reminderQuality.showRetry, true, '失败状态提供行内重试');

  console.log('\n=== 3. 顶部结构与接口镜像 ===');
  const wxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/admin/after-sales/admin-after-sales.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.join(ROOT, 'miniprogram/admin/after-sales/admin-after-sales.wxss'),
    'utf8'
  );
  const apiSource = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/api.js'), 'utf8');
  const mockSource = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/mock.js'), 'utf8');
  eq(wxml.includes('class="top-dashboard"'), true, '顶部使用非对称双列仪表');
  eq(wxml.indexOf('quality-card') < wxml.indexOf('dashboard-control-stack'),
    true, '质量卡位于左侧主列');
  eq(wxml.indexOf('sales-card') < wxml.indexOf('enforcement-card'),
    true, '会员购买与会员限制在右列上下排列');
  eq(wxml.includes('前 5 日均值'), true, '只保留前 5 日均值作为第二项数据');
  eq(wxml.includes('2 分钟内送达率'), true, '卡片直接解释准时口径');
  eq(wxml.includes('本时段未送达') || wxml.includes('昨日未送达')
    || wxml.includes('P95') || wxml.includes('阈值'), false,
  '卡片只保留送达率和前 5 日均值');
  eq(wxml.includes('quality-primary-copy'), true, '指标名称位于数字下方');
  eq(wxml.includes('quality-caption-row') && wxml.includes('quality-sample'),
    true, '更新时间位于送达率说明右侧');
  eq(wxml.includes('showReminderQualityDetail'), false, '不提供隐藏质量明细交互');
  eq(wxml.includes('onRetryReminderQuality'), true, '失败状态使用行内重试');
  eq(wxss.includes('grid-template-columns: minmax(0, 40fr) minmax(0, 60fr)'),
    true, '质量卡与右侧控制列按 40/60 分配');
  eq(wxss.includes('height: 100%'), true, '质量卡跟随右列高度拉伸');
  eq(wxss.includes('.dashboard-control-stack { display: flex; flex-direction: column; min-width: 0; min-height: 236rpx;'),
    true, '右侧两条设置卡共同定义质量卡高度');
  eq(wxss.includes('.dashboard-control-stack .admin-control-card { flex: 1 1 0;'),
    true, '会员购买和会员限制保持等高');
  eq(wxss.includes('.quality-rate { flex-shrink: 0; color: var(--color-ink); font-size: 40rpx;'),
    true, '左侧质量卡使用清晰的主数字字号');
  eq(wxss.includes('.quality-primary { display: flex; align-items: stretch; min-width: 0; flex-direction: column;'),
    true, '指标名称与等待更新时间放到数字下方');
  eq(wxss.includes('.quality-sample { min-width: 0; overflow: hidden; color: var(--color-muted); font-size: 18rpx;'),
    true, '等待更新时间文字已放大');
  eq(wxss.includes('.quality-baseline-label { color: var(--color-muted); font-size: 20rpx;'),
    true, '前 5 日均值标签已放大');
  const pageSource = fs.readFileSync(
    path.join(ROOT, 'miniprogram/admin/after-sales/admin-after-sales.js'),
    'utf8'
  );
  eq(pageSource.includes('scheduleReminderQualityRefresh'), true, '页面在 8 小时边界自动刷新');
  eq(pageSource.includes('scheduleReminderQualityRetry'), true,
    '定时器尚未写入新快照时保留旧值并延迟重试');
  eq(pageSource.includes('QUALITY_CACHE_KEY'), true, '页面缓存最近一次有效快照');
  eq(pageSource.includes('clearReminderQualityTimer'), true, '离开页面时清理刷新定时器');
  eq(pageSource.includes("'等待更新'"), true, '加载中在送达率说明右侧显示等待更新');
  eq(apiSource.includes("action: 'adminReminderQuality.stats'"),
    true, '客户端接入质量统计接口');
  eq(mockSource.includes("'adminReminderQuality.stats'"),
    true, 'mock 镜像包含质量统计接口');
  const mockedQuality = await mock.mockCall('payment', { action: 'adminReminderQuality.stats' });
  eq(mockedQuality.pending, false, 'mock 返回当前窗口快照已就绪');
  eq(mockedQuality.stale, false, 'mock 不把当前快照标记为过期');
  eq(mockedQuality.expectedWindowKey, mockedQuality.quality.currentWindow.endAt,
    'mock 预期窗口与快照窗口一致');
  eq(mockedQuality.quality.currentWindow.status, 'HEALTHY', 'mock 返回可渲染的质量状态');
  eq(mockedQuality.quality.baseline5d.daysWithData, 5, 'mock 返回完整基线结构');

  api.payment.adminReminderQuality.stats = originalStats;
  if (fail) {
    console.error(`\n${fail} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll admin reminder quality UI tests passed.');
}

run().catch(err => {
  api.payment.adminReminderQuality.stats = originalStats;
  console.error(err);
  process.exit(1);
});
