import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFakeDb, aiRpc } from './support/fakedb.js';
import { createAiAdmin, validateProvider, validateModel, registerAiAdminRoutes } from '../src/admin/ai.js';
import { createRegistry } from '../src/ai/registry.js';
import { createHealthTracker } from '../src/ai/health.js';
import { createSettingsStore, parseSettingsInput, normalizeStored } from '../src/ai/settings.js';
import { defaultSettings, HARD } from '../src/ai/config.js';
import { createAuthMiddleware } from '../src/auth-middleware.js';

const SECRET = 'sentinel-env-secret-4242';
const actor = { id: randomUUID() };
const rejects = (fn, status = 422) => assert.rejects(Promise.resolve().then(fn), (e) => e.status === status);
const throwsFields = (fn, ...fields) => assert.throws(fn, (e) => e.status === 422 && fields.every((f) => f in e.details.fields), `fields ${fields}`);

function harness({ env = {}, models, providers } = {}) {
  const gemini = { id: randomUUID(), code: 'gemini', display_name: 'Google Gemini (Free)', adapter: 'gemini', base_url: null, api_key_env: 'GEMINI_API_KEY', enabled: true, is_free: true };
  const groq = { id: randomUUID(), code: 'groq', display_name: 'Groq (Free)', adapter: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true, is_free: true };
  const generic = { id: randomUUID(), code: 'gw', display_name: 'Unverified Gateway', adapter: 'openai_compatible', base_url: 'https://gw.example.com/v1', api_key_env: 'GW_API_KEY', enabled: true, is_free: false };
  const placeholder = { id: randomUUID(), slug: 'qwen3-8-27b', display_name: 'Qwen3.8 27B', provider_id: null, model_identifier: null, base_url: null, capabilities: ['general'], enabled: false, is_free: false, priority: 10, free_user_enabled: true, premium_user_enabled: true, max_tokens: null, temperature: null, timeout_ms: null, daily_limit: null, monthly_limit: null };
  const db = createFakeDb({ ai_providers: providers ?? [gemini, groq, generic], ai_models: models ?? [placeholder], settings: [] }, { rpc: { ...aiRpc(), ai_analytics: () => ({ total_requests: 0 }), ai_purge_expired: () => ({ conversations_deleted: 2 }) } });
  const factory = { isConfigured: (p) => Boolean(env[p.api_key_env]), call: async () => ({ content: 'ok', usage: null }) };
  const registry = createRegistry({ db, factory, ttlMs: 0, counterTtlMs: 0 });
  const health = createHealthTracker({ db, ttlMs: 0 });
  const settingsStore = createSettingsStore({ db, ttlMs: 0 });
  const admin = createAiAdmin({ db, registry, health, settingsStore, service: { testModel: async () => ({ ok: true, status: 'success', error_code: null, latency_ms: 5 }) }, env });
  return { db, admin, gemini, groq, generic, placeholder, settingsStore };
}
const auditActions = (db) => (db.tables.audit_logs ?? []).map((r) => r.action);

test('provider validation: only verified free provider adapters and their fixed credential slots are accepted', () => {
  assert.equal(validateProvider({ code: 'groq', adapter: 'groq', display_name: 'Groq', api_key_env: 'GROQ_API_KEY' }).api_key_env, 'GROQ_API_KEY');
  assert.equal(validateProvider({ code: 'gemini', adapter: 'gemini', display_name: 'Gemini' }).api_key_env, 'GEMINI_API_KEY');
  for (const adapter of ['grok', 'openai_compatible', 'nope']) {
    throwsFields(() => validateProvider({ code: 'vendor', adapter, display_name: 'Vendor', api_key_env: 'ANY_API_KEY' }), 'adapter');
  }
  for (const bad of ['sk-abcdefghijklmnopqrstuvwxyz', 'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY', 'GW_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_SECRET']) {
    throwsFields(() => validateProvider({ code: 'groq', adapter: 'groq', display_name: 'Groq', api_key_env: bad }), 'api_key_env');
  }
  throwsFields(() => validateProvider({ code: 'gem', adapter: 'gemini', display_name: 'Gemini', api_key_env: 'GROQ_API_KEY' }), 'api_key_env');
  throwsFields(() => validateProvider({ code: 'gem', adapter: 'gemini', display_name: 'Gemini', base_url: 'https://evil.example.com/v1beta' }), 'base_url');
  throwsFields(() => validateProvider({ code: 'Bad Code', adapter: 'gemini', display_name: '' }), 'code', 'display_name');
});

test('model validation: whitelist of fields, bounded numbers, known capabilities only', () => {
  const ok = validateModel({ slug: 'qwen3-8-27b', display_name: 'Qwen', model_identifier: 'vendor/model:1', capabilities: ['coding'], priority: 5, timeout_ms: 15000, temperature: 0.7, daily_limit: 100, role: 'admin', id: 'x' });
  assert.deepEqual(Object.keys(ok).sort(), ['capabilities', 'daily_limit', 'display_name', 'model_identifier', 'priority', 'slug', 'temperature', 'timeout_ms']);
  throwsFields(() => validateModel({ slug: 'a', display_name: 'x', capabilities: ['telepathy'], priority: 0, timeout_ms: 999999, temperature: 5, model_identifier: "x'; drop table--", daily_limit: 0 }), 'slug', 'capabilities', 'priority', 'timeout_ms', 'temperature', 'model_identifier', 'daily_limit');
  assert.equal(validateModel({ max_tokens: '', daily_limit: null }, { partial: true }).max_tokens, null);
});

test('a model cannot be enabled without a provider and a real provider-side model identifier (no fake integrations)', async () => {
  const h = harness();
  await rejects(() => h.admin.updateModel(h.placeholder.id, { enabled: true }, actor, '1.1.1.1'));
  await rejects(() => h.admin.updateModel(h.placeholder.id, { enabled: true, provider_id: h.gemini.id }, actor, '1.1.1.1'));
  await rejects(() => h.admin.createModel({ slug: 'new-one', display_name: 'New', enabled: true }, actor, '1.1.1.1'));
  assert.equal(h.db.tables.ai_models[0].enabled, false);
  const row = await h.admin.updateModel(h.placeholder.id, { provider_id: h.gemini.id, model_identifier: 'gemini-real-id', enabled: true }, actor, '1.1.1.1');
  assert.equal(row.enabled, true);
});

test('changes are audited with before/after of non-secret fields, in the action categories the spec lists', async () => {
  const h = harness();
  await h.admin.updateModel(h.placeholder.id, { provider_id: h.gemini.id, model_identifier: 'gemini-real-id', enabled: true, priority: 3, free_user_enabled: false, max_tokens: 800 }, actor, '9.9.9.9');
  const actions = auditActions(h.db);
  for (const a of ['ai.model.enable', 'ai.model.priority_change', 'ai.model.free_access_change', 'ai.model.update']) assert.ok(actions.includes(a), a);
  const prio = h.db.tables.audit_logs.find((r) => r.action === 'ai.model.priority_change');
  assert.deepEqual([prio.actor_id, prio.target_type, prio.metadata.before, prio.metadata.after], [actor.id, 'ai_models', 10, 3]);
  const upd = h.db.tables.audit_logs.find((r) => r.action === 'ai.model.update');
  assert.equal(upd.metadata.after.output_cap, 800, 'max_tokens is not blanked out by the secret scrubber');
  await h.admin.updateModel(h.placeholder.id, { enabled: false }, actor, '9.9.9.9');
  assert.ok(auditActions(h.db).includes('ai.model.disable'));
  await h.admin.updateProvider(h.gemini.id, { enabled: false }, actor, '9.9.9.9');
  assert.ok(auditActions(h.db).includes('ai.provider.disable'));
  await h.admin.updateProvider(h.gemini.id, { display_name: 'Gemini free tier' }, actor, '9.9.9.9');
  const p = h.db.tables.audit_logs.find((r) => r.action === 'ai.provider.update');
  assert.equal(p.metadata.after.display_name, 'Gemini free tier');
});

test('settings: system prompt / limits / other changes are audited without leaking prompt text; bad values are rejected; hard ceilings hold', async () => {
  const h = harness();
  const next = await h.admin.putSettings({ system_prompt: 'You are a pirate. TOP SECRET PROMPT', limits: { free_user: { per_day: 7 } }, guest_access: true, max_output_tokens: 2048 }, actor, '1.1.1.1');
  assert.deepEqual([next.limits.free_user.per_day, next.limits.free_user.per_minute, next.guest_access], [7, 5, true]);
  const actions = auditActions(h.db);
  for (const a of ['ai.system_prompt.change', 'ai.limits.change', 'ai.settings.update']) assert.ok(actions.includes(a), a);
  assert.equal(JSON.stringify(h.db.tables.audit_logs).includes('TOP SECRET PROMPT'), false);
  const sp = h.db.tables.audit_logs.find((r) => r.action === 'ai.system_prompt.change');
  assert.ok(sp.metadata.length_after > 10 && sp.metadata.sha256_after.length === 16);
  assert.equal((await h.settingsStore.get()).limits.free_user.per_day, 7);
  const before = h.db.tables.audit_logs.length;
  await h.admin.putSettings({ guest_access: true }, actor, '1.1.1.1');
  assert.equal(h.db.tables.audit_logs.length, before, 'saving without changes writes no audit noise');
  const base = defaultSettings({});
  throwsFields(() => parseSettingsInput({ max_output_tokens: HARD.maxOutputTokens + 1 }, base), 'max_output_tokens');
  throwsFields(() => parseSettingsInput({ max_attempts: 50, max_input_chars: 10 ** 6, request_timeout_ms: 999999 }, base), 'max_attempts', 'max_input_chars', 'request_timeout_ms');
  throwsFields(() => parseSettingsInput({ limits: { free_user: { per_day: -1 }, premium_user: { per_minute: 'many' } } }, base), 'limits.free_user.per_day', 'limits.premium_user.per_minute');
  throwsFields(() => parseSettingsInput({ enabled_capabilities: ['general'], default_capability: 'coding' }, base), 'default_capability');
  throwsFields(() => parseSettingsInput({ enabled_capabilities: [] }, base), 'enabled_capabilities');
  throwsFields(() => parseSettingsInput({ system_prompt: '' }, base), 'system_prompt');
  assert.equal(parseSettingsInput({ unknown_flag: true, __proto__: { admin: true } }, base).unknown_flag, undefined);
});

test('stored settings are re-clamped on read: a tampered row can never exceed hard ceilings', () => {
  const s = normalizeStored({ max_output_tokens: 10 ** 9, max_attempts: 500, request_timeout_ms: 'x', limits: { free_user: { per_day: 'inf' } }, enabled_capabilities: ['nope'] }, {});
  assert.deepEqual([s.max_output_tokens <= HARD.maxOutputTokens, s.max_attempts <= HARD.maxAttempts, typeof s.request_timeout_ms, s.limits.free_user.per_day, s.enabled_capabilities.length > 0], [true, true, 'number', defaultSettings({}).limits.free_user.per_day, true]);
});

test('environment defaults feed the central settings but are clamped', () => {
  const s = defaultSettings({ AI_MAX_RETRIES: '1', AI_REQUEST_TIMEOUT_MS: '9999999', AI_MAX_INPUT_CHARS: '500', AI_MAX_OUTPUT_TOKENS: '300', AI_DEFAULT_MODEL: 'qwen3-8-27b', AI_DEFAULT_CAPABILITY: 'coding' });
  assert.deepEqual([s.max_attempts, s.request_timeout_ms, s.max_input_chars, s.max_output_tokens, s.default_model, s.default_capability], [2, HARD.maxTimeoutMs, 500, 300, 'qwen3-8-27b', 'coding']);
  assert.equal(defaultSettings({ AI_DEFAULT_CAPABILITY: 'bogus' }).default_capability, 'general');
});

test('overview reports credential STATUS only; the key value never reaches the admin API', async () => {
  const h = harness({ env: { GEMINI_API_KEY: SECRET } });
  const o = await h.admin.overview();
  const gem = o.providers.find((p) => p.code === 'gemini'); const gw = o.providers.find((p) => p.code === 'gw');
  assert.deepEqual([gem.credential, gem.is_free, gw.credential, gw.is_free], ['set', true, 'missing', false]);
  assert.equal(JSON.stringify(o).includes(SECRET), false);
  const q = o.models[0];
  assert.deepEqual([q.ready, q.not_ready_reason, q.health], [false, 'model_disabled', 'disabled']);
});

test('retention purge is explicit, uses the configured days and is audited', async () => {
  const h = harness();
  await h.admin.putSettings({ retention_days: 90 }, actor, '1.1.1.1');
  const out = await h.admin.purge(actor, '1.1.1.1');
  assert.deepEqual([out.retention_days, out.conversations_deleted], [90, 2]);
  assert.deepEqual(h.db.calls.filter(([k, n]) => k === 'rpc' && n === 'ai_purge_expired').map((c) => c[2]), [{ p_days: 90 }]);
  assert.ok(auditActions(h.db).includes('ai.retention.purge'));
});

test('analytics and events come straight from the database functions/tables (no synthesised numbers)', async () => {
  const h = harness();
  assert.deepEqual(await h.admin.analytics(), { total_requests: 0 });
  h.db.tables.ai_provider_events = [{ id: '1', event_type: 'failover', created_at: new Date().toISOString() }];
  assert.equal((await h.admin.events({ limit: 10, offset: 0 })).items.length, 1);
});

// ---- authorization wiring ----
const record = () => { const routes = []; const r = {}; for (const m of ['get', 'post', 'put', 'patch', 'delete']) r[m] = (path, ...chain) => routes.push({ method: m, path, chain }); return { router: r, routes }; };

test('every AI admin route is registered; the two paid/destructive ones sit behind a fail-closed per-admin limiter', () => {
  const { router, routes } = record(); const limits = [];
  registerAiAdminRoutes(router, { admin: {}, h: (fn) => fn, actor: () => actor, ok: () => {}, page: () => ({}), limit: (...a) => { limits.push(a); return Object.assign(() => {}, { limited: a[0] }); } });
  const table = routes.map((r) => `${r.method} ${r.path}`);
  for (const expected of ['get /ai/overview', 'get /ai/settings', 'put /ai/settings', 'get /ai/analytics', 'get /ai/health', 'get /ai/events', 'post /ai/purge', 'post /ai/providers', 'patch /ai/providers/:id', 'delete /ai/providers/:id', 'post /ai/models', 'patch /ai/models/:id', 'delete /ai/models/:id', 'post /ai/models/:id/test']) assert.ok(table.includes(expected), expected);
  const test = routes.find((r) => r.path === '/ai/models/:id/test');
  assert.equal(test.chain[0].limited, 'ai-admin-test');
  assert.deepEqual(limits.map((l) => [l[0], l[3].failClosed]), [['ai-admin-purge', true], ['ai-admin-test', true]]);
});

test('AI admin routes live inside the admin router, after requireAdmin and before the generic CRUD routes', () => {
  const src = readFileSync(new URL('../src/admin/routes.js', import.meta.url), 'utf8');
  const order = ['router.use(requireAdmin)', 'registerAiAdminRoutes(', "router.get('/:resource'"].map((s) => src.indexOf(s));
  assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
});

test('requireAdmin (the gate in front of every /api/v1/admin/ai route) refuses guests, free users and unverified admins', async () => {
  const run = async (user, header = 'Bearer t') => {
    const { requireAdmin } = createAuthMiddleware({ auth: { getUser: async () => ({ id: 'u', email: 'e', email_verified: user.verified ?? true }) }, loadContext: async () => ({ profile: { role: user.role }, subscriptions: [] }) });
    return new Promise((resolve) => requireAdmin({ headers: header ? { authorization: header } : {} }, {}, (e) => resolve(e)));
  };
  assert.equal((await run({ role: 'free_user' })).status, 403);
  assert.equal((await run({ role: 'premium_user' })).status, 403);
  assert.equal((await run({ role: 'admin', verified: false })).status, 403);
  assert.equal((await run({ role: 'admin' }, null)).status, 401);
  assert.equal(await run({ role: 'admin' }), undefined);
});
