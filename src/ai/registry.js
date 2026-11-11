// Model registry: reads providers and models from Postgres (short in-memory cache; it is only an optimisation, the database
// is the source of truth on every serverless instance) and works out whether each model is actually usable right now.
// Readiness never reveals or reads a key value: it only asks the provider factory whether the credential exists.
const PROVIDER_COLUMNS = 'id,code,display_name,adapter,base_url,api_key_env,enabled,is_free,created_at,updated_at';
const MODEL_COLUMNS = 'id,slug,display_name,provider_id,model_identifier,base_url,capabilities,enabled,is_free,priority,free_user_enabled,premium_user_enabled,max_tokens,temperature,timeout_ms,daily_limit,monthly_limit,created_at,updated_at';

export function notReadyReason(model, provider, factory) {
  if (!model.enabled) return 'model_disabled';
  if (!provider) return 'no_provider';
  if (provider.is_free !== true || model.is_free !== true) return 'not_verified_free';
  if (!model.model_identifier) return 'no_model_identifier';
  if (!provider.enabled) return 'provider_disabled';
  if (!provider.api_key_env) return 'no_credential_variable';
  if (!factory.isConfigured(provider, model)) return 'credentials_or_endpoint_missing';
  return null;
}

export function createRegistry({ db, factory, ttlMs = 15000, counterTtlMs = 5000, now = () => Date.now() }) {
  let cache = null;
  let counters = null;

  async function load() {
    if (cache && now() - cache.at < ttlMs) return cache;
    const [providerRows, modelRows] = await Promise.all([
      db.select('ai_providers', { select: PROVIDER_COLUMNS, order: 'code.asc', limit: '100' }),
      db.select('ai_models', { select: MODEL_COLUMNS, order: 'priority.asc,slug.asc', limit: '200' }),
    ]);
    const providers = new Map(providerRows.map((p) => [p.id, p]));
    const models = modelRows.map((m) => {
      const provider = providers.get(m.provider_id) ?? null;
      const reason = notReadyReason(m, provider, factory);
      return { ...m, provider, ready: reason === null, not_ready_reason: reason };
    });
    cache = { at: now(), providers, models };
    return cache;
  }

  // Successful-request counts per model (today / this month, UTC) for daily_limit / monthly_limit enforcement.
  async function modelCounters() {
    if (counters && now() - counters.at < counterTtlMs) return counters.value;
    const rows = await db.rpc('ai_model_counters');
    const value = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.model_id, { day: r.day_count, month: r.month_count }]));
    counters = { at: now(), value };
    return value;
  }

  return {
    load,
    modelCounters,
    invalidate() { cache = null; counters = null; },
    async findModel(ref) {
      const { models } = await load();
      return models.find((m) => m.id === ref || m.slug === ref) ?? null;
    },
  };
}

export const atCap = (model, counters) => {
  const used = counters.get(model.id) ?? { day: 0, month: 0 };
  return (model.daily_limit != null && used.day >= model.daily_limit) || (model.monthly_limit != null && used.month >= model.monthly_limit);
};
