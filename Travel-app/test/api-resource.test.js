const assert = require('assert');

let cloudCalls = 0;
let pending = null;

global.wx = {
  cloud: {
    callFunction(options) {
      cloudCalls += 1;
      pending = options;
    },
  },
  getStorageSync() { return null; },
  setStorageSync() {},
  removeStorageSync() {},
};

const api = require('../miniprogram/utils/api.js');

async function run() {
  const first = api.reminder.home.bootstrap({});
  const second = api.reminder.home.bootstrap({});
  assert.strictEqual(first, second, '相同只读请求共用同一个 Promise');
  assert.strictEqual(cloudCalls, 1, '并发相同只读请求只调用一次云函数');
  assert.deepStrictEqual(
    pending.data.membershipCapabilities,
    ['unlimited-v3', 'two-tier-v5'],
    '新客户端对 reminder 请求显式声明会员契约能力'
  );
  pending.success({ result: { success: true, runtimeVersion: 'test' } });
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(a.runtimeVersion, 'test');
  assert.strictEqual(b.runtimeVersion, 'test');

  const before = cloudCalls;
  const spots = await api.spots.list();
  assert.strictEqual(spots.success, true);
  assert.strictEqual(Array.isArray(spots.data), true);
  assert.strictEqual(cloudCalls, before, '景点列表从包内快照读取，不走云函数');
  const detail = await api.spots.detail('gugong');
  assert.strictEqual(detail.data.spotId, 'gugong');
  assert.strictEqual(cloudCalls, before, '景点详情从包内快照读取，不走云函数');

  const beforeFailure = cloudCalls;
  const failed = api.reminder.membership.status();
  assert.strictEqual(cloudCalls, beforeFailure + 1);
  assert.deepStrictEqual(
    pending.data.membershipCapabilities,
    ['unlimited-v3', 'two-tier-v5'],
    '会员状态入口同样携带能力声明'
  );
  pending.fail(new Error('network down'));
  await assert.rejects(failed);
  await assert.rejects(api.reminder.membership.status());
  assert.strictEqual(cloudCalls, beforeFailure + 1, '网络失败后的短退避内不再打云函数');

  console.log('api-resource.test.js 全部通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
