import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSupabase, clearHealthCache, diagnosticsAuthorized, EXPECTED_SCHEMA_VERSION } from '../src/health/supabase.js';

// MOCKED: these tests use a fake fetch and prove the health-check LOGIC only. They are not a live Supabase test.
const env = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(20), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_' + 'b'.repeat(30) };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeFetch = (over = {}) => async (url, init) => {
  const u = String(url); const anon = init.headers.apikey === env.SUPABASE_ANON_KEY;
  if (over.throw) throw new Error('boom https://abc.supabase.co secret');
  if (u.includes('/auth/v1/health')) return json({ ok: true }, over.auth ?? 200);
  if (u.includes('/storage/v1/bucket')) return json([], over.storage ?? 200);
  if (u.includes('/rest/v1/app_health')) {
    if (anon) return over.anonRows ? json([{ id: 1 }]) : json([], 200);
    return over.db ? json({ message: 'SQL detail leak' }, over.db) : json([{ schema_version: over.version ?? EXPECTED_SCHEMA_VERSION }]);
  }
  return json({}, 404);
};
const run = (over, opts = {}) => { clearHealthCache(); return checkSupabase({ env, fetchImpl: fakeFetch(over), useCache: false, ...opts }); };

test('not configured is reported honestly and performs no request', async () => {
  const r = await checkSupabase({ env: {}, fetchImpl: () => { throw new Error('must not call'); }, useCache: false });
  assert.deepEqual([r.status, r.database, r.live_tested], ['error', 'not_configured', false]);
});
test('connected database yields ok', async () => { const r = await run(); assert.deepEqual([r.status, r.service, r.database], ['ok', 'supabase', 'connected']); });
test('query failure yields unavailable and leaks nothing', async () => {
  const r = await run({ db: 500 }); assert.equal(r.database, 'unavailable');
  assert.doesNotMatch(JSON.stringify(r), /SQL detail|abc\.supabase|sb_secret/);
});
test('network error yields unavailable without exposing the error text', async () => {
  const r = await run({ throw: true }); assert.equal(r.database, 'unavailable'); assert.doesNotMatch(JSON.stringify(r), /boom|secret|abc/);
});
test('malformed URL is reported as misconfigured without a request', async () => {
  const r = await checkSupabase({ env: { ...env, SUPABASE_URL: 'http://evil.example' }, fetchImpl: () => { throw new Error('no'); }, useCache: false });
  assert.equal(r.database, 'misconfigured');
});
test('detailed mode verifies auth, storage, RLS and migration version', async () => {
  const r = await run({}, { detailed: true });
  assert.equal(r.status, 'ok');
  for (const k of ['database', 'auth_api', 'rls_anon_blocked', 'storage', 'migrations']) assert.equal(r.checks[k].status, 'ok', k);
});
test('detailed mode flags RLS exposure, storage failure and schema drift', async () => {
  assert.equal((await run({ anonRows: true }, { detailed: true })).checks.rls_anon_blocked.status, 'fail');
  assert.equal((await run({ storage: 500 }, { detailed: true })).status, 'degraded');
  const drift = await run({ version: 'old' }, { detailed: true }); assert.equal(drift.checks.migrations.reason, 'schema_version_mismatch');
});
test('timeouts abort slow requests', async () => {
  clearHealthCache();
  const slow = (_u, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); }); // keep-alive timer stands in for a real socket
  const r = await checkSupabase({ env, fetchImpl: slow, timeoutMs: 30, useCache: false });
  assert.equal(r.database, 'unavailable');
});
test('public results are cached briefly to avoid load amplification', async () => {
  clearHealthCache(); let calls = 0; const f = async (...a) => { calls++; return fakeFetch()(...a); };
  await checkSupabase({ env, fetchImpl: f }); await checkSupabase({ env, fetchImpl: f }); assert.equal(calls, 1);
  clearHealthCache();
});
test('diagnostics token check is strict', () => {
  const t = 'x'.repeat(24);
  assert.equal(diagnosticsAuthorized(`Bearer ${t}`, t), true);
  assert.equal(diagnosticsAuthorized(`Bearer ${t}y`, t), false);
  assert.equal(diagnosticsAuthorized(undefined, t), false);
  assert.equal(diagnosticsAuthorized(`Bearer ${t}`, undefined), false);
  assert.equal(diagnosticsAuthorized(`Bearer `, ''), false);
});
