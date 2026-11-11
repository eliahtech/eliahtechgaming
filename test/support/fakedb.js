// In-memory stand-in for src/supabase.js createDb(): enough PostgREST semantics (eq/neq/gt/gte/lt/lte/in/is/not.is, order, limit,
// offset, unique keys, rpc handlers) to run the real AI service and admin code without a network or a database.
import { randomUUID } from 'node:crypto';
import { DatabaseError } from '../../src/supabase.js';

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or']);
const unique = { ai_requests: ['scope', 'idempotency_key'], ai_models: ['slug'], ai_providers: ['code'] };
const coerce = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v);

function matches(row, filters) {
  return Object.entries(filters).every(([col, expr]) => {
    if (RESERVED.has(col)) return true;
    const value = row[col];
    const [op, ...rest] = String(expr).split('.');
    const arg = rest.join('.');
    switch (op) {
      case 'eq': return String(value) === arg || value === coerce(arg);
      case 'neq': return String(value) !== arg;
      case 'gt': return value > arg; case 'gte': return value >= arg;
      case 'lt': return value < arg; case 'lte': return value <= arg;
      case 'in': return arg.replace(/^\(|\)$/g, '').split(',').includes(String(value));
      case 'is': return arg === 'null' ? value == null : value != null;
      case 'not': return arg === 'is.null' ? value != null : true;
      default: return true; // wfts/ilike etc. are not simulated: tests inject retrieval instead
    }
  });
}

export function createFakeDb(seed = {}, { rpc = {} } = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls = [];
  const t = (name) => (tables[name] ??= []);
  const sorted = (rows, order) => {
    if (!order) return rows;
    const [col, dir = 'asc'] = order.split(',')[0].split('.');
    return [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  };
  const page = (rows, q) => rows.slice(Number(q?.offset ?? 0), Number(q?.offset ?? 0) + (q?.limit ? Number(q.limit) : rows.length));
  const db = {
    tables, calls,
    async select(table, q = {}) { calls.push(['select', table, q]); return page(sorted(t(table).filter((r) => matches(r, q)), q.order), q).map((r) => ({ ...r })); },
    async selectPage(table, q = {}) { calls.push(['selectPage', table, q]); const all = sorted(t(table).filter((r) => matches(r, q)), q.order); return { rows: page(all, q).map((r) => ({ ...r })), total: all.length }; },
    async insert(table, rows, { prefer } = {}) {
      calls.push(['insert', table, rows]);
      const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      for (const row of list) {
        const keys = unique[table];
        if (keys && t(table).some((x) => keys.every((k) => x[k] === row[k]))) throw new DatabaseError('Database request failed.', { status: 409, table, code: '23505' });
        t(table).push(row);
      }
      return prefer === 'return=minimal' ? null : list.map((r) => ({ ...r }));
    },
    async update(table, q, values) {
      calls.push(['update', table, q, values]);
      const hit = t(table).filter((r) => matches(r, q));
      hit.forEach((r) => Object.assign(r, values));
      return hit.map((r) => ({ ...r }));
    },
    async remove(table, q) { calls.push(['remove', table, q]); const hit = t(table).filter((r) => matches(r, q)); tables[table] = t(table).filter((r) => !hit.includes(r)); return hit; },
    async rpc(name, args) { calls.push(['rpc', name, args]); if (!rpc[name]) throw new Error(`no rpc handler for ${name}`); return rpc[name](args, db); },
  };
  return db;
}

// Default rpc handlers that behave like the real SQL functions closely enough for the service tests.
export const aiRpc = ({ limiter } = {}) => ({
  set_ai_cooldown: ({p_scope,p_until,p_reason},db) => {const rows=db.tables.ai_cooldowns??=[];const found=rows.find(r=>r.scope===p_scope);if(found)found.until_at=found.until_at>p_until?found.until_at:p_until;else rows.push({scope:p_scope,until_at:p_until,reason:p_reason});return null;},
  rate_limit_hit: ({ p_limit }) => (limiter ? limiter(p_limit) : [{ allowed: true, remaining: p_limit, reset_at: new Date(Date.now() + 60000).toISOString() }]),
  ai_model_counters: (_a, db) => {
    const out = {};
    for (const r of db.tables.ai_usage ?? []) if (r.status === 'success' && r.model_id && r.capability !== 'test') { out[r.model_id] ??= { model_id: r.model_id, day_count: 0, month_count: 0 }; out[r.model_id].day_count += 1; out[r.model_id].month_count += 1; }
    return Object.values(out);
  },
  ai_user_usage: ({ p_user }, db) => {
    const rows = (db.tables.ai_usage ?? []).filter((r) => r.user_id === p_user && r.status === 'success' && r.capability !== 'test');
    return [{ requests_today: rows.length, tokens_today: rows.reduce((n, r) => n + (r.tokens_total ?? 0), 0) }];
  },
});
