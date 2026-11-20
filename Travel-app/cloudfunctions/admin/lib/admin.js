/** 过期事件清理：只保留 180 天以上的 reminder_events 与 admin_audit_logs 清理。 */
const { COLLECTIONS, ok } = require('./schema');

const CLEAN_PAGE_SIZE = 200;

function isTimerInvocation(event = {}, env = process.env) {
  return env.TRIGGER_SRC === 'timer'
    || event.Type === 'Timer'
    || event.type === 'timer'
    || event.TriggerName === 'adminDailyCleanup';
}

async function cleanupExpired(db, nowTs = new Date()) {
  let removed = 0;
  for (const collection of [COLLECTIONS.REMINDER_EVENTS, COLLECTIONS.AUDIT_LOGS]) {
    try {
      const res = await db.collection(collection)
        .where({ expireAt: db.command.lte(nowTs) })
        .limit(CLEAN_PAGE_SIZE)
        .get();
      for (const doc of (res.data || [])) {
        await db.collection(collection).doc(doc._id).remove();
        removed += 1;
      }
    } catch (e) {
      console.error('[admin-maintenance] cleanup-failed', collection, e.message);
    }
  }
  return ok({ removed });
}

module.exports = { isTimerInvocation, cleanupExpired };
