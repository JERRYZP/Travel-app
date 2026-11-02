/** notifier 部署单元内的最小失效钩子；不复制首页读模型逻辑。 */

const crypto = require('crypto');

function enabled(env = process.env) {
  const mode = String(env.HOME_RUNTIME_MODE || 'off').trim().toLowerCase();
  return mode === 'shadow' || mode === 'on';
}

function runtimeIdOf(userId) {
  return crypto.createHash('sha256').update(String(userId || ''), 'utf8').digest('hex');
}

async function invalidateUsers(db, userIds, now = new Date()) {
  if (!enabled()) return 0;
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const results = await Promise.all(ids.map(userId =>
    db.collection('user_runtime').doc(runtimeIdOf(userId)).update({
      data: { stale: true, staleAt: now },
    }).then(() => true).catch(() => false)
  ));
  return results.filter(Boolean).length;
}

module.exports = { enabled, runtimeIdOf, invalidateUsers };
