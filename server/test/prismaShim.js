/**
 * TEST-ONLY in-memory stand-in for @prisma/client.
 *
 * Why it exists: in a locked-down environment that cannot download Prisma's native engines
 * (binaries.prisma.sh), `prisma generate` cannot run, so the real client is unavailable.
 * This shim implements exactly the subset of the Prisma API that PayLink uses so the whole
 * flow (HTTP + Socket.IO + email + SMS + analytics) can still be exercised.
 *
 * Usage:  node -r ./test/prismaShim.js index.js      (see `npm run dev:shim`)
 * It is never loaded in normal runs, which use the real Prisma client.
 */
const Module = require('module');
const crypto = require('crypto');

const cuid = () => 'c' + crypto.randomBytes(12).toString('hex');

const MODELS = {
  user: { defaults: () => ({ id: cuid(), createdAt: new Date(), phone: null }), rel: {} },
  paymentLink: {
    defaults: () => ({ id: cuid(), active: true, createdAt: new Date() }),
    rel: { user: { model: 'user', fk: 'userId' } },
    many: { payments: { model: 'payment', fk: 'paymentLinkId' } },
  },
  payment: {
    defaults: () => ({
      id: cuid(), status: 'pending', createdAt: new Date(), checkoutRequestId: null,
      merchantRequestId: null, mpesaReceiptNumber: null, failureReason: null, paidAt: null,
      payerName: null, payerEmail: null,
    }),
    rel: { paymentLink: { model: 'paymentLink', fk: 'paymentLinkId' } },
    unique: ['checkoutRequestId'],
  },
  notification: {
    defaults: () => ({ id: cuid(), read: false, createdAt: new Date(), data: '{}' }),
    rel: { user: { model: 'user', fk: 'userId' } },
  },
};

const tables = Object.fromEntries(Object.keys(MODELS).map((k) => [k, []]));
const clone = (r) => ({ ...r });

function matches(modelName, row, where = {}) {
  const def = MODELS[modelName];
  return Object.entries(where).every(([key, cond]) => {
    if (def.rel[key]) {
      const rel = def.rel[key];
      const related = tables[rel.model].find((r) => r.id === row[rel.fk]);
      return related ? matches(rel.model, related, cond) : false;
    }
    const v = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false;
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false;
      if ('equals' in cond && v !== cond.equals) return false;
      return true;
    }
    return v === cond;
  });
}

function applyInclude(modelName, row, include) {
  const out = clone(row);
  if (!include) return out;
  const def = MODELS[modelName];
  for (const [key, val] of Object.entries(include)) {
    if (!val) continue;
    if (key === '_count') {
      out._count = {};
      for (const [relName, spec] of Object.entries(val.select || {})) {
        const m = def.many[relName];
        const where = spec === true ? {} : spec.where || {};
        out._count[relName] = tables[m.model].filter(
          (r) => r[m.fk] === row.id && matches(m.model, r, where)
        ).length;
      }
    } else if (def.rel[key]) {
      const rel = def.rel[key];
      const related = tables[rel.model].find((r) => r.id === row[rel.fk]) || null;
      const sub = typeof val === 'object' ? val : {};
      out[key] = related ? applySelectInclude(rel.model, related, sub) : null;
    }
  }
  return out;
}

function applySelectInclude(modelName, row, opts = {}) {
  if (opts.select) {
    const out = {};
    for (const k of Object.keys(opts.select)) out[k] = row[k];
    return out;
  }
  return applyInclude(modelName, row, opts.include);
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const [[key, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
}

function makeModel(name) {
  const def = MODELS[name];
  const checkUnique = (data, ignoreId) => {
    const fields = ['id', ...(def.unique || []), ...(name === 'user' ? ['email'] : [])];
    for (const f of fields) {
      if (data[f] != null && tables[name].some((r) => r[f] === data[f] && r.id !== ignoreId)) {
        const e = new Error(`Unique constraint failed on ${f}`);
        e.code = 'P2002';
        throw e;
      }
    }
  };
  const findOne = (where) => tables[name].find((r) => matches(name, r, where));
  return {
    async create({ data, include }) {
      const row = { ...def.defaults(), ...data };
      checkUnique(row);
      tables[name].push(row);
      return applySelectInclude(name, row, { include });
    },
    async findUnique({ where, include, select }) {
      const row = findOne(where);
      return row ? applySelectInclude(name, row, { include, select }) : null;
    },
    async findFirst({ where, include, select }) {
      const row = findOne(where);
      return row ? applySelectInclude(name, row, { include, select }) : null;
    },
    async findMany({ where, include, select, orderBy, take } = {}) {
      let rows = tables[name].filter((r) => matches(name, r, where));
      rows = sortRows(rows, orderBy);
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => applySelectInclude(name, r, { include, select }));
    },
    async update({ where, data }) {
      const row = findOne(where);
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      checkUnique({ ...row, ...data }, row.id);
      Object.assign(row, data);
      return clone(row);
    },
    async updateMany({ where, data }) {
      const rows = tables[name].filter((r) => matches(name, r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    async count({ where } = {}) {
      return tables[name].filter((r) => matches(name, r, where)).length;
    },
    async aggregate({ where, _sum, _count }) {
      const rows = tables[name].filter((r) => matches(name, r, where));
      const out = {};
      if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map((k) => [k, rows.length ? rows.reduce((s, r) => s + r[k], 0) : null]));
      if (_count) out._count = Object.fromEntries(Object.keys(_count).map((k) => [k, rows.length]));
      return out;
    },
    async deleteMany() {
      tables[name].length = 0;
    },
  };
}

class PrismaClient {
  constructor() {
    for (const n of Object.keys(MODELS)) this[n] = makeModel(n);
  }
  async $disconnect() {}
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@prisma/client') return { PrismaClient };
  return origLoad.call(this, request, ...rest);
};
console.warn('[test] Using in-memory Prisma shim (test/prismaShim.js) - data is not persisted');
