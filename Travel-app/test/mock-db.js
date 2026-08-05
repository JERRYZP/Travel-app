/**
 * 内存版云数据库桩 —— 让 lib/ 里的 DB 逻辑能脱离云环境测试
 *
 * 只实现本项目实际用到的 API 子集：
 *   collection().where().get() / count() / update() / remove() / orderBy() / limit()
 *   collection().doc().update() / remove()
 *   collection().add()
 *   db.command.in / gt / lte / and
 *   db.startTransaction() → collection().add() / doc().remove() / commit() / rollback()
 */

let seq = 0;
function nextId(prefix = 'id') {
  seq += 1;
  return `${prefix}_${String(seq).padStart(4, '0')}`;
}

/* ---- 查询条件求值 ---- */
const CMD = Symbol('cmd');

function cmdIn(values) { return { [CMD]: 'in', values }; }
function cmdGt(v) { return { [CMD]: 'gt', value: v }; }
function cmdGte(v) { return { [CMD]: 'gte', value: v }; }
function cmdLt(v) { return { [CMD]: 'lt', value: v }; }
function cmdLte(v) { return { [CMD]: 'lte', value: v }; }
function cmdAnd(list) { return { [CMD]: 'and', list }; }

function attachAnd(node) {
  node.and = (other) => attachAnd(cmdAnd([node, other]));
  return node;
}

function matchOne(fieldValue, cond) {
  if (cond && typeof cond === 'object' && cond[CMD]) {
    switch (cond[CMD]) {
      case 'in': return cond.values.some(v => sameValue(fieldValue, v));
      case 'gt': return toNum(fieldValue) > toNum(cond.value);
      case 'gte': return toNum(fieldValue) >= toNum(cond.value);
      case 'lt': return toNum(fieldValue) < toNum(cond.value);
      case 'lte': return toNum(fieldValue) <= toNum(cond.value);
      case 'and': return cond.list.every(c => matchOne(fieldValue, c));
      default: throw new Error(`未实现的 command: ${cond[CMD]}`);
    }
  }
  return sameValue(fieldValue, cond);
}

function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) return toNum(a) === toNum(b);
  return a === b;
}

function toNum(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v : t;
  }
  return v;
}

function matchDoc(doc, where) {
  return Object.entries(where || {}).every(([k, cond]) => matchOne(doc[k], cond));
}

/* ---- 主体 ---- */
function createDb() {
  const store = new Map(); // collectionName -> Map(id -> doc)

  function coll(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }

  function makeQuery(name, where = {}, opts = {}) {
    const run = () => {
      let rows = [...coll(name).values()].filter(d => matchDoc(d, where));
      if (opts.orderBy) {
        const { field, dir } = opts.orderBy;
        rows.sort((a, b) => {
          const x = toNum(a[field]); const y = toNum(b[field]);
          if (x === y) return 0;
          return dir === 'desc' ? (y > x ? 1 : -1) : (x > y ? 1 : -1);
        });
      }
      if (opts.limit != null) rows = rows.slice(0, opts.limit);
      return rows.map(d => ({ ...d }));
    };

    return {
      get: async () => ({ data: run() }),
      count: async () => ({ total: run().length }),
      orderBy: (field, dir) => makeQuery(name, where, { ...opts, orderBy: { field, dir } }),
      limit: (n) => makeQuery(name, where, { ...opts, limit: n }),
      update: async ({ data }) => {
        const rows = run();
        rows.forEach(r => Object.assign(coll(name).get(r._id), data));
        return { stats: { updated: rows.length } };
      },
      remove: async () => {
        const rows = run();
        rows.forEach(r => coll(name).delete(r._id));
        return { stats: { removed: rows.length } };
      },
    };
  }

  function collectionApi(name) {
    return {
      where: (w) => makeQuery(name, w),
      orderBy: (field, dir) => makeQuery(name, {}, { orderBy: { field, dir } }),
      limit: (n) => makeQuery(name, {}, { limit: n }),
      get: async () => ({ data: [...coll(name).values()].map(d => ({ ...d })) }),
      count: async () => ({ total: coll(name).size }),
      add: async ({ data }) => {
        const _id = data._id || nextId(name.slice(0, 4));
        coll(name).set(_id, { _id, ...data });
        return { _id };
      },
      doc: (id) => ({
        get: async () => {
          const d = coll(name).get(id);
          return { data: d ? [{ ...d }] : [] };
        },
        update: async ({ data }) => {
          const d = coll(name).get(id);
          if (d) Object.assign(d, data);
          return { stats: { updated: d ? 1 : 0 } };
        },
        remove: async () => {
          const had = coll(name).delete(id);
          return { stats: { removed: had ? 1 : 0 } };
        },
      }),
    };
  }

  const db = {
    collection: collectionApi,
    command: {
      in: (v) => attachAnd(cmdIn(v)),
      gt: (v) => attachAnd(cmdGt(v)),
      gte: (v) => attachAnd(cmdGte(v)),
      lt: (v) => attachAnd(cmdLt(v)),
      lte: (v) => attachAnd(cmdLte(v)),
    },
    /** 事务：记录逆操作，rollback 时回放 */
    startTransaction: async () => {
      const undo = [];
      let done = false;
      return {
        collection: (name) => ({
          add: async ({ data }) => {
            const r = await collectionApi(name).add({ data });
            undo.push(() => coll(name).delete(r._id));
            return r;
          },
          doc: (id) => ({
            update: async ({ data }) => {
              const before = { ...coll(name).get(id) };
              undo.push(() => coll(name).set(id, before));
              return collectionApi(name).doc(id).update({ data });
            },
            remove: async () => {
              const before = coll(name).get(id);
              if (before) undo.push(() => coll(name).set(id, { ...before }));
              return collectionApi(name).doc(id).remove();
            },
          }),
          where: (w) => makeQuery(name, w),
        }),
        commit: async () => { done = true; return { errMsg: 'ok' }; },
        rollback: async () => {
          if (done) throw new Error('已提交无法回滚');
          undo.reverse().forEach(fn => fn());
          return { errMsg: 'rollback ok' };
        },
      };
    },
    /** 测试辅助 */
    _dump: (name) => [...coll(name).values()].map(d => ({ ...d })),
    _seed: (name, docs) => docs.forEach(d => {
      const _id = d._id || nextId(name.slice(0, 4));
      coll(name).set(_id, { _id, ...d });
    }),
    _size: (name) => coll(name).size,
    _reset: () => store.clear(),
  };

  return db;
}

module.exports = { createDb };
