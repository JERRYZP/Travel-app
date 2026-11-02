/**
 * 云函数请求级资源计量。
 *
 * 不依赖控制台采样：每次 hot action 记录数据库查询、返回文档、写入和子函数调用。
 * 日志不包含 OpenID、订单号或任何用户内容。
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
const TEST_PROCESS = process.argv.slice(1).some(arg => /(^|\/)test\//.test(arg));
const LOG_ENABLED = process.env.RESOURCE_METRICS_LOG !== 'off' && !TEST_PROCESS;

function returnedDocs(result) {
  if (!result) return 0;
  if (Array.isArray(result.data)) return result.data.length;
  if (result.data) return 1;
  if (result.doc) return 1;
  return 0;
}

function createResourceMonitor(service, defaultDatabase) {
  let lastSnapshot = null;
  const current = () => storage.getStore();

  function bump(field, amount = 1) {
    const state = current();
    if (!state) return;
    state[field] = (Number(state[field]) || 0) + amount;
  }

  function noteResult(result) {
    const docs = returnedDocs(result);
    if (docs > 0) bump('returnedDocuments', docs);
    return result;
  }

  function wrapCallable(target, value) {
    return typeof value === 'function' ? value.bind(target) : value;
  }

  function wrapTerminal(target, prop, kind) {
    return function metricTerminal(...args) {
      bump(kind === 'read' ? 'dbReadQueries' : 'dbWriteQueries');
      if (kind === 'write') bump('dbWriteOperations');
      let result;
      try {
        result = target[prop](...args);
      } catch (err) {
        throw err;
      }
      if (!result || typeof result.then !== 'function') return noteResult(result);
      return result.then(noteResult);
    };
  }

  function wrapDocument(document) {
    return new Proxy(document, {
      get(target, prop) {
        if (prop === 'get') return wrapTerminal(target, prop, 'read');
        if (prop === 'set' || prop === 'update' || prop === 'remove') {
          return wrapTerminal(target, prop, 'write');
        }
        const value = Reflect.get(target, prop);
        if (typeof value === 'function') return value.bind(target);
        return value;
      },
    });
  }

  function wrapQuery(query) {
    return new Proxy(query, {
      get(target, prop) {
        if (prop === 'get' || prop === 'count') return wrapTerminal(target, prop, 'read');
        if (prop === 'add' || prop === 'update' || prop === 'remove') {
          return wrapTerminal(target, prop, 'write');
        }
        if (prop === 'doc') {
          return (...args) => wrapDocument(target.doc(...args));
        }
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        return (...args) => wrapQuery(value.apply(target, args));
      },
    });
  }

  function wrapCollection(collection) {
    return wrapQuery(collection);
  }

  function wrapTransaction(transaction) {
    return new Proxy(transaction, {
      get(target, prop) {
        if (prop === 'collection') {
          return name => wrapCollection(target.collection(name));
        }
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        return value.bind(target);
      },
    });
  }

  const db = new Proxy({}, {
    get(_empty, prop) {
      const state = current();
      const database = state && state.db ? state.db : defaultDatabase;
      if (!database) return undefined;
      if (prop === 'collection') {
        return (...args) => wrapCollection(database.collection(...args));
      }
      if (prop === 'runTransaction') {
        return (fn, retries) => {
          bump('dbTransactions');
          return database.runTransaction(tx => fn(wrapTransaction(tx)), retries);
        };
      }
      if (prop === 'startTransaction') {
        return async () => {
          bump('dbTransactions');
          return wrapTransaction(await database.startTransaction());
        };
      }
      if (prop === 'createCollection') {
        if (typeof database.createCollection !== 'function') return undefined;
        return async (...args) => {
          bump('dbWriteQueries');
          bump('dbWriteOperations');
          return database.createCollection(...args);
        };
      }
      const value = Reflect.get(database, prop);
      return wrapCallable(database, value);
    },
  });

  async function run(action, database, fn) {
    const state = {
      service,
      action: String(action || 'unknown'),
      dbReadQueries: 0,
      dbWriteQueries: 0,
      dbWriteOperations: 0,
      returnedDocuments: 0,
      childFunctionCalls: 0,
      dbTransactions: 0,
      durationMs: 0,
      resultCode: null,
      db: database,
    };
    const startedAt = Date.now();
    return storage.run(state, async () => {
      try {
        const result = await fn();
        state.resultCode = result && result.success === false
          ? Number(result.errorCode) || 1500
          : 0;
        return result;
      } catch (err) {
        state.resultCode = Number(err && (err.errorCode || err.errCode)) || 1500;
        throw err;
      } finally {
        state.durationMs = Date.now() - startedAt;
        const record = { ...state };
        delete record.db;
        lastSnapshot = record;
        if (LOG_ENABLED) console.log('[resource]', JSON.stringify(record));
      }
    });
  }

  function childCall() {
    bump('childFunctionCalls');
  }

  function snapshot() {
    const state = current();
    if (!state) return lastSnapshot ? { ...lastSnapshot } : null;
    const copy = { ...state };
    delete copy.db;
    return copy;
  }

  return { db, run, childCall, snapshot };
}

module.exports = { createResourceMonitor };
