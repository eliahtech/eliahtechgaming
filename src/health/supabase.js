// Server-side Supabase health check. Performs REAL requests (auth endpoint, a one-row query, optional storage + RLS probes).
// Public output is minimal; detailed output is for authorized callers only. No URLs, keys, SQL errors or table names are returned.
import { supabaseSettings } from '../config/env.js';

export const EXPECTED_SCHEMA_VERSION = '20261028_newsletter_daily_cap';
const cache = { at: 0, value: null };

const timed = async (fn) => { const t = Date.now(); try { return { ...(await fn()), ms: Date.now() - t }; } catch { return { ok: false, ms: Date.now() - t }; } };

export async function checkSupabase({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 4000, detailed = false, expectedVersion = EXPECTED_SCHEMA_VERSION, useCache = true, now = Date.now } = {}) {
  if (useCache && !detailed && cache.value && now() - cache.at < 10_000) return cache.value;
  const settings = supabaseSettings(env);
  const unconfigured = { status: 'error', service: 'supabase', database: 'not_configured', live_tested: false };
  if (!settings) return unconfigured;
  try { const u = new URL(settings.url); if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('scheme'); } catch { return { status: 'error', service: 'supabase', database: 'misconfigured', live_tested: false }; }

  const call = (path, key, init = {}) => fetchImpl(`${settings.url}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init.headers || {}) }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const checks = {};

  checks.database = await timed(async () => {
    const res = await call('/rest/v1/app_health?select=schema_version&limit=1', settings.serviceKey);
    if (!res.ok) return { ok: false, reason: res.status === 404 ? 'migration_missing' : 'query_failed' };
    const rows = await res.json();
    const version = Array.isArray(rows) ? rows[0]?.schema_version : undefined;
    return { ok: Array.isArray(rows), version };
  });
  const dbOk = checks.database.ok;
  const result = { status: dbOk ? 'ok' : 'error', service: 'supabase', database: dbOk ? 'connected' : 'unavailable', live_tested: true };

  if (detailed) {
    if (settings.anonKey) {
      checks.auth_api = await timed(async () => ({ ok: (await call('/auth/v1/health', settings.anonKey)).ok }));
      // Row-level security: the anon role must NOT be able to read app_health rows.
      checks.rls_anon_blocked = await timed(async () => {
        const res = await call('/rest/v1/app_health?select=id&limit=1', settings.anonKey);
        if (!res.ok) return { ok: true }; // 401/403/404: denied
        const rows = await res.json();
        return { ok: Array.isArray(rows) && rows.length === 0 };
      });
    } else checks.auth_api = { ok: false, reason: 'anon_key_not_configured', ms: 0 };
    checks.storage = await timed(async () => ({ ok: (await call('/storage/v1/bucket', settings.serviceKey)).ok }));
    checks.migrations = { ok: dbOk && checks.database.version === expectedVersion, ms: 0, reason: !dbOk ? 'database_unavailable' : checks.database.version === expectedVersion ? undefined : 'schema_version_mismatch' };
    result.checks = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { status: v.ok ? 'ok' : 'fail', ms: v.ms, ...(v.reason ? { reason: v.reason } : {}) }]));
    if (Object.values(checks).some((c) => !c.ok)) result.status = dbOk ? 'degraded' : 'error';
  }
  if (useCache && !detailed) { cache.at = now(); cache.value = result; }
  return result;
}

export const clearHealthCache = () => { cache.at = 0; cache.value = null; };

// Constant-time comparison for the diagnostics token.
export function diagnosticsAuthorized(headerValue, token) {
  if (!token || typeof headerValue !== 'string') return false;
  const given = /^Bearer\s+(\S+)$/i.exec(headerValue)?.[1] || '';
  const a = new TextEncoder().encode(given); const b = new TextEncoder().encode(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
