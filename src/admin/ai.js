// Admin management of the AI platform. Every function here sits behind requireAdmin (see routes.js). Providers hold only the NAME
// of an environment variable (never a key). Every change is validated, then audited with before/after values of non-secret fields.
import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { isUuid } from '../validate.js';
import { ADAPTERS, CAPABILITIES, HARD } from '../ai/config.js';
import { parseSettingsInput } from '../ai/settings.js';
import { ADAPTER_CLASSES } from '../ai/providers/index.js';
import { assertSafeBaseUrl } from '../ai/providers/base.js';
import { HEALTH_WINDOW_MS, COOLDOWN_MS } from '../ai/health.js';
import { mapDbError } from './service.js';

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,59}$/;
const PROVIDER_CODE_RE = /^[a-z0-9-]{2,40}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,62}_API_KEY$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
// Each built-in adapter owns its key variable, so a generic provider can never be pointed at (and leak) it.
const FREE_KEY_ENV = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

const PROVIDER_KEYS = ['display_name', 'base_url', 'api_key_env', 'enabled'];
const MODEL_KEYS = ['display_name', 'provider_id', 'model_identifier', 'base_url', 'capabilities', 'enabled', 'is_free', 'priority', 'free_user_enabled', 'premium_user_enabled', 'max_tokens', 'temperature', 'timeout_ms', 'daily_limit', 'monthly_limit'];
// The audit scrubber redacts any key that looks secret (token, api_key...). These aliases keep harmless settings readable in the log.
const ALIAS = { max_tokens: 'output_cap', max_output_tokens: 'output_cap', tokens_per_day: 'daily_usage_cap', api_key_env: 'credential_variable' };
const aliased = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [ALIAS[k] ?? k, v]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (before, after, keys) => {
  const b = {}; const a = {};
  for (const k of keys) if (k in after && !same(before?.[k], after[k])) { b[k] = before?.[k] ?? null; a[k] = after[k]; }
  return { before: aliased(b), after: aliased(a), changed: Object.keys(a) };
};

const bad = (fields) => new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields });
const optionalInt = (v, min, max) => (v === null ? null : Number.isInteger(v) && v >= min && v <= max ? v : undefined);

function safeUrl(value, adapter) {
  try { return assertSafeBaseUrl(value, { allowedHosts: ADAPTER_CLASSES[adapter]?.allowedHosts ?? undefined }); } catch { return undefined; }
}

export function validateProvider(body, { partial = false, adapter: currentAdapter } = {}) {
  const errors = {}; const out = {};
  const has = (k) => body && Object.hasOwn(body, k);
  if (!partial) {
    if (!PROVIDER_CODE_RE.test(body?.code ?? '')) errors.code = 'Use 2 to 40 lowercase letters, numbers or hyphens.'; else out.code = body.code;
    if (!ADAPTERS.includes(body?.adapter)) errors.adapter = `Choose one of: ${ADAPTERS.join(', ')}.`; else out.adapter = body.adapter;
  }
  const adapter = out.adapter ?? currentAdapter;
  if (!partial || has('display_name')) {
    const name = typeof body?.display_name === 'string' ? body.display_name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
    if (name.length < 1 || name.length > 80) errors.display_name = 'Must be 1 to 80 characters.'; else out.display_name = name;
  }
  if (has('base_url')) {
    if (body?.base_url === null || body?.base_url === '') out.base_url = null;
    else { const url = safeUrl(body?.base_url, adapter); if (url === undefined) errors.base_url = `Must be an https:// URL on ${ADAPTER_CLASSES[adapter]?.allowedHosts?.join(', ') ?? 'the verified provider host'}.`; else out.base_url = url; }
  }
  if (has('api_key_env')) {
    if (body.api_key_env === null || body.api_key_env === '') out.api_key_env = null;
    else if (typeof body.api_key_env !== 'string' || !ENV_NAME_RE.test(body.api_key_env)) errors.api_key_env = 'Use the environment variable NAME, like QWEN_API_KEY (ends in _API_KEY). Never paste the key itself.';
    else if (body.api_key_env !== FREE_KEY_ENV[adapter]) errors.api_key_env = `Use ${FREE_KEY_ENV[adapter]}; only verified free-provider credentials are supported.`;
    else out.api_key_env = body.api_key_env;
  } else if (!partial) {
    out.api_key_env = FREE_KEY_ENV[adapter] ?? null;
  }
  if (has('enabled')) { if (typeof body.enabled !== 'boolean') errors.enabled = 'Must be true or false.'; else out.enabled = body.enabled; }
  if (Object.keys(errors).length) throw bad(errors);
  return out;
}

export function validateModel(body, { partial = false } = {}) {
  const errors = {}; const out = {};
  const has = (k) => body && Object.hasOwn(body, k);
  if (!partial) { if (!SLUG_RE.test(body?.slug ?? '')) errors.slug = 'Use lowercase letters, numbers, dots or hyphens (2 to 60 characters).'; else out.slug = body.slug; }
  if (!partial || has('display_name')) {
    const name = typeof body?.display_name === 'string' ? body.display_name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
    if (name.length < 1 || name.length > 80) errors.display_name = 'Must be 1 to 80 characters.'; else out.display_name = name;
  }
  if (has('provider_id')) { if (body.provider_id === null || body.provider_id === '') out.provider_id = null; else if (!isUuid(body.provider_id)) errors.provider_id = 'Choose a provider.'; else out.provider_id = body.provider_id; }
  if (has('model_identifier')) {
    if (body.model_identifier === null || body.model_identifier === '') out.model_identifier = null;
    else if (typeof body.model_identifier !== 'string' || !MODEL_ID_RE.test(body.model_identifier)) errors.model_identifier = 'Use the exact provider-side model id (letters, numbers and . _ : / @ + -).'; else out.model_identifier = body.model_identifier;
  }
  if (has('base_url')) {
    if (body.base_url === null || body.base_url === '') out.base_url = null;
    else { const url = safeUrl(body.base_url); if (url === undefined) errors.base_url = 'Must be a public https:// URL.'; else out.base_url = url; }
  }
  if (has('capabilities')) {
    if (!Array.isArray(body.capabilities) || !body.capabilities.length || !body.capabilities.every((c) => CAPABILITIES.includes(c))) errors.capabilities = `Choose one or more of: ${CAPABILITIES.join(', ')}.`; else out.capabilities = [...new Set(body.capabilities)];
  }
  for (const k of ['enabled', 'free_user_enabled', 'premium_user_enabled']) if (has(k)) { if (typeof body[k] !== 'boolean') errors[k] = 'Must be true or false.'; else out[k] = body[k]; }
  const ints = { priority: [1, 10000, false], max_tokens: [1, HARD.maxOutputTokens * 4, true], timeout_ms: [HARD.minTimeoutMs, HARD.maxTimeoutMs, true], daily_limit: [1, 100000000, true], monthly_limit: [1, 1000000000, true] };
  for (const [k, [min, max, nullable]] of Object.entries(ints)) {
    if (!has(k)) continue;
    const v = body[k] === '' ? null : body[k];
    const parsed = v === null && !nullable ? undefined : optionalInt(v, min, max);
    if (parsed === undefined) errors[k] = `Must be a whole number from ${min} to ${max}${nullable ? ' (or empty for no limit)' : ''}.`; else out[k] = parsed;
  }
  if (has('temperature')) {
    const t = body.temperature === '' ? null : body.temperature;
    if (t === null) out.temperature = null; else if (typeof t === 'number' && t >= 0 && t <= 2) out.temperature = Math.round(t * 100) / 100; else errors.temperature = 'Must be a number from 0 to 2.';
  }
  if (Object.keys(errors).length) throw bad(errors);
  return out;
}

export function createAiAdmin({ db, registry, health, settingsStore, service, env = process.env }) {
  const refresh = () => { registry.invalidate(); health.invalidate?.(); };
  const credential = (p) => (p.api_key_env ? (env[p.api_key_env] ? 'set' : 'missing') : 'not_specified');
  const guard = async (fn) => { try { return await fn(); } catch (error) { throw mapDbError(error); } };

  async function loadModelRow(id) {
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Model not found.', 404);
    const [row] = await db.select('ai_models', { select: '*', id: `eq.${id}`, limit: '1' });
    if (!row) throw new AppError('NOT_FOUND', 'Model not found.', 404);
    return row;
  }
  async function loadProviderRow(id) {
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Provider not found.', 404);
    const [row] = await db.select('ai_providers', { select: '*', id: `eq.${id}`, limit: '1' });
    if (!row) throw new AppError('NOT_FOUND', 'Provider not found.', 404);
    return row;
  }
  async function providerClassification(providerId) {
    if (!providerId) return { exists: false, is_free: false };
    const [provider] = await db.select('ai_providers', { select: 'id,adapter,is_free', id: `eq.${providerId}`, limit: '1' });
    return { exists: Boolean(provider), is_free: Boolean(provider?.is_free === true && ADAPTERS.includes(provider.adapter)), adapter: provider?.adapter };
  }
  async function assertEnableable(effective) {
    if (!effective.enabled) return;
    if (!effective.provider_id || !effective.model_identifier) throw bad({ enabled: 'Assign a verified free provider and its exact provider-side model identifier before enabling this model.' });
    const provider = await providerClassification(effective.provider_id);
    if (!provider.exists) throw bad({ provider_id: 'That provider does not exist.' });
    if (!provider.is_free) throw bad({ provider_id: 'Only verified free-plan providers may be enabled.' });
  }
  async function auditModelChange({ actor, ip, before, after, id }) {
    const d = diff(before, after, MODEL_KEYS);
    if (!d.changed.length) return;
    const base = { actorId: actor.id, targetType: 'ai_models', targetId: id, ip };
    const rest = d.changed.filter((k) => !['enabled', 'priority', 'free_user_enabled', 'premium_user_enabled'].includes(k));
    if (d.changed.includes('enabled')) await audit(db, { ...base, action: after.enabled ? 'ai.model.enable' : 'ai.model.disable', metadata: { slug: before.slug } });
    if (d.changed.includes('priority')) await audit(db, { ...base, action: 'ai.model.priority_change', metadata: { slug: before.slug, before: before.priority, after: after.priority } });
    if (d.changed.some((k) => k === 'free_user_enabled' || k === 'premium_user_enabled')) await audit(db, { ...base, action: d.changed.includes('free_user_enabled') ? 'ai.model.free_access_change' : 'ai.model.premium_access_change', metadata: { slug: before.slug, before: aliased({ free_user_enabled: before.free_user_enabled, premium_user_enabled: before.premium_user_enabled }), after: aliased({ free_user_enabled: after.free_user_enabled ?? before.free_user_enabled, premium_user_enabled: after.premium_user_enabled ?? before.premium_user_enabled }) } });
    if (rest.length) await audit(db, { ...base, action: 'ai.model.update', metadata: { slug: before.slug, before: Object.fromEntries(Object.entries(d.before).filter(([k]) => rest.some((r) => (ALIAS[r] ?? r) === k))), after: Object.fromEntries(Object.entries(d.after).filter(([k]) => rest.some((r) => (ALIAS[r] ?? r) === k))) } });
  }

  return {
    async overview() {
      registry.invalidate();
      const { providers, models } = await registry.load();
      const [counters, snap] = await Promise.all([registry.modelCounters(), health.snapshot().catch(() => ({ byModel: new Map(), byProvider: new Map() }))]);
      const providerList = [...providers.values()].map((p) => ({
        ...p, credential: credential(p), health: health.providerStatus(snap, p),
        models: models.filter((m) => m.provider_id === p.id).length,
      }));
      return {
        providers: providerList,
        models: models.map(({ provider, ...m }) => ({ ...m, provider: provider ? { id: provider.id, code: provider.code, display_name: provider.display_name } : null, health: health.modelStatus(snap, m), usage: counters.get(m.id) ?? { day: 0, month: 0 } })),
        settings: await settingsStore.get(),
        options: { adapters: ADAPTERS, capabilities: CAPABILITIES, health_window_minutes: HEALTH_WINDOW_MS / 60000, cooldown_seconds: COOLDOWN_MS / 1000 },
      };
    },

    async createProvider(body, actor, ip) {
      const values = { ...validateProvider(body ?? {}), is_free: true };
      const [row] = await guard(() => db.insert('ai_providers', values));
      refresh();
      await audit(db, { actorId: actor.id, action: 'ai.provider.create', targetType: 'ai_providers', targetId: row.id, metadata: aliased({ code: row.code, adapter: row.adapter, enabled: row.enabled, api_key_env: row.api_key_env }), ip });
      return { ...row, credential: credential(row) };
    },
    async updateProvider(id, body, actor, ip) {
      const before = await loadProviderRow(id);
      const values = validateProvider(body ?? {}, { partial: true, adapter: before.adapter });
      if (!Object.keys(values).length) throw bad({ _: 'Nothing to change.' });
      const [row] = await guard(() => db.update('ai_providers', { id: `eq.${id}` }, { ...values, updated_at: new Date().toISOString() }));
      refresh();
      const d = diff(before, values, PROVIDER_KEYS);
      if ('enabled' in values && values.enabled !== before.enabled) await audit(db, { actorId: actor.id, action: values.enabled ? 'ai.provider.enable' : 'ai.provider.disable', targetType: 'ai_providers', targetId: id, metadata: { code: before.code }, ip });
      const rest = d.changed.filter((k) => k !== 'enabled');
      if (rest.length) await audit(db, { actorId: actor.id, action: 'ai.provider.update', targetType: 'ai_providers', targetId: id, metadata: { code: before.code, before: Object.fromEntries(Object.entries(d.before).filter(([k]) => rest.some((r) => (ALIAS[r] ?? r) === k))), after: Object.fromEntries(Object.entries(d.after).filter(([k]) => rest.some((r) => (ALIAS[r] ?? r) === k))) }, ip });
      return { ...row, credential: credential(row) };
    },
    async deleteProvider(id, actor, ip) {
      const before = await loadProviderRow(id);
      await guard(() => db.remove('ai_providers', { id: `eq.${id}` })); // models still using it block this (foreign key)
      refresh();
      await audit(db, { actorId: actor.id, action: 'ai.provider.delete', targetType: 'ai_providers', targetId: id, metadata: { code: before.code }, ip });
    },

    async createModel(body, actor, ip) {
      const values = validateModel(body ?? {});
      const classification = await providerClassification(values.provider_id);
      values.is_free = classification.is_free;
      await assertEnableable(values);
      const [row] = await guard(() => db.insert('ai_models', values));
      refresh();
      await audit(db, { actorId: actor.id, action: 'ai.model.create', targetType: 'ai_models', targetId: row.id, metadata: { slug: row.slug, ...aliased(Object.fromEntries(MODEL_KEYS.map((k) => [k, row[k]]).filter(([k]) => k !== 'base_url'))) }, ip });
      return row;
    },
    async updateModel(id, body, actor, ip) {
      const before = await loadModelRow(id);
      const values = validateModel(body ?? {}, { partial: true });
      if (!Object.keys(values).length) throw bad({ _: 'Nothing to change.' });
      const classification = await providerClassification(values.provider_id ?? before.provider_id);
      values.is_free = classification.is_free;
      await assertEnableable({ ...before, ...values });
      const [row] = await guard(() => db.update('ai_models', { id: `eq.${id}` }, { ...values, updated_at: new Date().toISOString() }));
      refresh();
      await auditModelChange({ actor, ip, before, after: values, id });
      return row;
    },
    async deleteModel(id, actor, ip) {
      const before = await loadModelRow(id);
      await guard(() => db.remove('ai_models', { id: `eq.${id}` }));
      refresh();
      await audit(db, { actorId: actor.id, action: 'ai.model.delete', targetType: 'ai_models', targetId: id, metadata: { slug: before.slug }, ip });
    },
    async testModel(id, actor, ip) {
      const result = await service.testModel({ admin: actor, modelId: id });
      await audit(db, { actorId: actor.id, action: 'ai.model.test', targetType: 'ai_models', targetId: id, metadata: { ok: result.ok, status: result.status, error_code: result.error_code, latency_ms: result.latency_ms }, ip });
      return result;
    },

    getSettings: () => settingsStore.get(),
    async putSettings(body, actor, ip) {
      const before = await settingsStore.get();
      const next = parseSettingsInput(body ?? {}, before);
      await settingsStore.put(next);
      const changed = Object.keys(next).filter((k) => !same(before[k], next[k]));
      const prompts = changed.filter((k) => k === 'system_prompt' || k === 'safety_instructions');
      const limits = changed.includes('limits');
      const others = changed.filter((k) => !prompts.includes(k) && k !== 'limits');
      const meta = { ip, actorId: actor.id, targetType: 'settings', targetId: 'ai' };
      for (const k of prompts) await audit(db, { ...meta, action: `ai.${k}.change`, metadata: { length_before: before[k].length, length_after: next[k].length, sha256_after: createHash('sha256').update(next[k]).digest('hex').slice(0, 16) } });
      if (limits) await audit(db, { ...meta, action: 'ai.limits.change', metadata: { before: aliased(Object.fromEntries(Object.entries(before.limits).map(([t, v]) => [t, aliased(v)]))), after: aliased(Object.fromEntries(Object.entries(next.limits).map(([t, v]) => [t, aliased(v)]))) } });
      if (others.length) await audit(db, { ...meta, action: 'ai.settings.update', metadata: { before: aliased(Object.fromEntries(others.map((k) => [k, before[k]]))), after: aliased(Object.fromEntries(others.map((k) => [k, next[k]]))) } });
      return next;
    },

    // Real numbers only: everything comes from ai_analytics() over ai_usage (see the migration). Nothing is estimated.
    async analytics() {
      const result = await db.rpc('ai_analytics');
      return Array.isArray(result) ? result[0] : result;
    },
    async healthReport() {
      const { providers, models } = await registry.load();
      const snap = await health.snapshot();
      const summary = (s) => (s ? { requests: s.total, failures: s.failures, consecutive_failures: s.consecutiveFailures, last_failure_at: s.lastFailureAt ? new Date(s.lastFailureAt).toISOString() : null, last_success_at: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null } : { requests: 0, failures: 0, consecutive_failures: 0, last_failure_at: null, last_success_at: null });
      return {
        window_minutes: HEALTH_WINDOW_MS / 60000,
        providers: [...providers.values()].map((p) => ({ code: p.code, status: health.providerStatus(snap, p), ...summary(snap.byProvider.get(p.code)) })),
        models: models.map((m) => ({ slug: m.slug, status: health.modelStatus(snap, m), ready: m.ready, not_ready_reason: m.not_ready_reason, ...summary(snap.byModel.get(m.id)) })),
      };
    },
    async events({ limit, offset }) {
      const { rows, total } = await db.selectPage('ai_provider_events', { select: 'id,request_id,event_type,provider,model,error_code,failure_reason,fallback_provider,fallback_model,metadata,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) });
      return { items: rows, meta: { total, limit, offset } };
    },
    async purge(actor, ip) {
      const settings = await settingsStore.get();
      const result = await db.rpc('ai_purge_expired', { p_days: settings.retention_days });
      const counts = Array.isArray(result) ? result[0] : result;
      await audit(db, { actorId: actor.id, action: 'ai.retention.purge', targetType: 'settings', targetId: 'ai', metadata: { retention_days: settings.retention_days, ...counts }, ip });
      return { retention_days: settings.retention_days, ...counts };
    },
  };
}

// Route table (registered before the generic /:resource routes). `limit` is the DB-backed rate limiter factory.
export function registerAiAdminRoutes(router, { admin, h, actor, limit, ok, page }) {
  router.get('/ai/overview', h(async (_req, res) => ok(res, await admin.overview())));
  router.get('/ai/settings', h(async (_req, res) => ok(res, await admin.getSettings())));
  router.put('/ai/settings', h(async (req, res) => ok(res, await admin.putSettings(req.body, actor(req), req.ip))));
  router.get('/ai/analytics', h(async (_req, res) => ok(res, await admin.analytics())));
  router.get('/ai/health', h(async (_req, res) => ok(res, await admin.healthReport())));
  router.get('/ai/events', h(async (req, res) => ok(res, await admin.events(page(req)))));
  router.post('/ai/purge', limit('ai-admin-purge', 10, 3600, { failClosed: true, keyOf: (req) => req.user?.id }), h(async (req, res) => ok(res, await admin.purge(actor(req), req.ip))));

  router.post('/ai/providers', h(async (req, res) => ok(res, await admin.createProvider(req.body, actor(req), req.ip), 201)));
  router.patch('/ai/providers/:id', h(async (req, res) => ok(res, await admin.updateProvider(req.params.id, req.body, actor(req), req.ip))));
  router.delete('/ai/providers/:id', h(async (req, res) => { await admin.deleteProvider(req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));

  router.post('/ai/models', h(async (req, res) => ok(res, await admin.createModel(req.body, actor(req), req.ip), 201)));
  router.patch('/ai/models/:id', h(async (req, res) => ok(res, await admin.updateModel(req.params.id, req.body, actor(req), req.ip))));
  router.delete('/ai/models/:id', h(async (req, res) => { await admin.deleteModel(req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));
  // Paid provider call: limited per admin so a stuck UI or script cannot burn quota.
  router.post('/ai/models/:id/test', limit('ai-admin-test', 20, 3600, { failClosed: true, keyOf: (req) => req.user?.id }), h(async (req, res) => ok(res, await admin.testModel(req.params.id, actor(req), req.ip))));
}
