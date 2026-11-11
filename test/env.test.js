import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, assertEnv, supabaseSettings, ENV_SPEC, SECRET_NAMES } from '../src/config/env.js';

const key = 'sb_secret_' + 'a'.repeat(30);
const good = { NODE_ENV: 'production', APP_URL: 'https://eliah.example', SITE_API_URL: 'https://api.eliah.example/api/v1', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_' + 'b'.repeat(20), SUPABASE_SERVICE_ROLE_KEY: key };

test('valid production configuration is accepted; optional integrations report NOT CONFIGURED', () => {
  const r = validateEnv(good);
  assert.equal(r.ok, true);
  assert.equal(r.integrations.supabase, 'CONFIGURED');
  for (const k of ['paypal', 'pesapal', 'email', 'ai']) assert.equal(r.integrations[k], 'NOT CONFIGURED');
});
test('missing required production variables are detected by name', () => {
  const r = validateEnv({ NODE_ENV: 'production' });
  const names = r.errors.map((e) => e.variable);
  for (const n of ['APP_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) assert.ok(names.includes(n), n);
});
test('empty required values are rejected', () => {
  const r = validateEnv({ ...good, SUPABASE_SERVICE_ROLE_KEY: '   ' });
  assert.ok(r.errors.some((e) => e.variable === 'SUPABASE_SERVICE_ROLE_KEY' && e.problem === 'empty'));
});
test('invalid URLs, numbers and booleans are rejected', () => {
  const r = validateEnv({ ...good, SUPABASE_URL: 'not a url', APP_URL: 'http://eliah.example', EMAIL_TIMEOUT_MS: 'abc', SCHEDULER_ENABLED: 'maybe', PESAPAL_IPN_URL: 'ftp://x' });
  const bad = r.errors.filter((e) => e.problem === 'invalid').map((e) => e.variable);
  for (const n of ['SUPABASE_URL', 'APP_URL', 'EMAIL_TIMEOUT_MS', 'SCHEDULER_ENABLED', 'PESAPAL_IPN_URL']) assert.ok(bad.includes(n), n);
});
test('development allows http://localhost but production does not', () => {
  const dev = { APP_URL: 'http://localhost:3000' };
  assert.equal(validateEnv(dev, { mode: 'development' }).ok, true);
  assert.equal(validateEnv(dev, { mode: 'production' }).errors.some((e) => e.variable === 'APP_URL'), true);
});
test('partial provider credentials are incompatible configuration', () => {
  const r = validateEnv({ ...good, PAYPAL_CLIENT_ID: 'abc123' });
  assert.ok(r.errors.some((e) => e.variable === 'PAYPAL_CLIENT_SECRET'));
});
test('production refuses sandbox payment endpoints (no silent dev fallback)', () => {
  const r = validateEnv({ ...good, PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com', PAYPAL_CLIENT_ID: 'x1', PAYPAL_CLIENT_SECRET: 'y1', PESAPAL_ENV: 'sandbox' });
  assert.ok(r.errors.some((e) => e.problem === 'incompatible' && e.variable === 'PAYPAL_BASE_URL'));
  assert.ok(r.errors.some((e) => e.problem === 'incompatible' && e.variable === 'PESAPAL_ENV'));
});
test('error messages and thrown errors never contain secret values', () => {
  const secret = 'sb_secret_SUPERSECRETVALUE123456789';
  const env = { ...good, SUPABASE_SERVICE_ROLE_KEY: secret, SUPABASE_URL: 'bad url', GROQ_API_KEY: 'x y' };
  assert.throws(() => assertEnv(env), (e) => { assert.doesNotMatch(e.message, /SUPERSECRET/); assert.ok(e.variables.includes('SUPABASE_URL')); return true; });
  assert.doesNotMatch(JSON.stringify(validateEnv(env)), /SUPERSECRET/);
});
test('supabaseSettings returns null when unconfigured and never invents defaults', () => {
  assert.equal(supabaseSettings({}), null);
  assert.equal(supabaseSettings({ SUPABASE_URL: 'https://a.supabase.co' }), null);
  assert.equal(supabaseSettings(good).url, 'https://abc.supabase.co');
});
test('no secret variable name carries a public prefix', () => {
  assert.ok(SECRET_NAMES.length >= 8);
  for (const n of SECRET_NAMES) assert.doesNotMatch(n, /^NEXT_PUBLIC_/);
  for (const s of ENV_SPEC) assert.doesNotMatch(s.name, /^NEXT_PUBLIC_/);
});

test('SCHEDULER_ENABLED=true requires a JOBS_TOKEN', () => {
  assert.ok(validateEnv({ ...good, SCHEDULER_ENABLED: 'true' }).errors.some((e) => e.variable === 'JOBS_TOKEN' && e.problem === 'missing'));
  assert.equal(validateEnv({ ...good, SCHEDULER_ENABLED: 'true', JOBS_TOKEN: 'j'.repeat(32) }).ok, true);
  assert.equal(validateEnv({ ...good, SCHEDULER_ENABLED: 'false' }).ok, true);
});
