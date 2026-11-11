// The AI router. Two parts, both free of I/O so they are easy to test:
//   selectCandidates()      who may be tried, in which order (tier access, capability, priority, caps, health)
//   executeWithFailover()   try them in order within a hard attempt count and a hard deadline
// Premium/Admin requests may fail over across the whole eligible pool. Free/Guest requests only ever see models flagged
// free_user_enabled, and only fail over (to other such models) when the administrator turned free_failover on.
import { AppError } from '../errors.js';
import { TIERS, HARD } from './config.js';
import { ProviderError, providerErrors } from './providers/base.js';
import { atCap } from './registry.js';

export const tierOf = (user) => {
  if (!user) return 'guest';
  return TIERS.includes(user.access?.role) && user.access.role !== 'guest' ? user.access.role : 'free_user';
};
export const isFreeTier = (tier) => tier === 'guest' || tier === 'free_user';

export function tierMayUse(tier, model, settings) {
  // A paid or unclassified provider/model is never eligible for any account tier.
  if (model.is_free !== true || model.provider?.is_free !== true) return false;
  if (tier === 'admin') return Boolean(model.premium_user_enabled || model.free_user_enabled);
  if (tier === 'premium_user') return Boolean(settings.premium_access && model.premium_user_enabled);
  return Boolean(settings.free_access && model.free_user_enabled);
}

const byPriority = (a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug);

export function selectCandidates({ tier, settings, models, counters = new Map(), isUnavailable = () => false, requested = null, capability }) {
  const accessible = models.filter((m) => m.ready && tierMayUse(tier, m, settings));
  let first = null;
  if (requested) {
    const model = models.find((m) => m.id === requested || m.slug === requested);
    if (!model) throw new AppError('AI_MODEL_NOT_FOUND', 'That model does not exist.', 404);
    if (!accessible.includes(model)) throw new AppError('AI_MODEL_FORBIDDEN', 'You do not have access to that model.', 403);
    first = model;
  }

  // Capability routing: models tagged with the capability first, then general-purpose models as a fallback.
  const tagged = accessible.filter((m) => m.capabilities.includes(capability)).sort(byPriority);
  const general = ['general','multimodal'].includes(capability) ? [] : accessible.filter((m) => !m.capabilities.includes(capability) && m.capabilities.includes('general')).sort(byPriority);
  let pool = [...tagged, ...general];
  if (!first && settings.default_model) {
    const preferred = pool.find((m) => m.slug === settings.default_model && (capability==='general'||m.capabilities.includes(capability)));
    if (preferred) pool = [preferred, ...pool.filter((m) => m !== preferred)];
  }
  // Models that recently failed repeatedly go to the back instead of being removed, so they are probed again once they recover.
  const healthy = pool.filter((m) => !isUnavailable(m));
  const ordered = first && !isUnavailable(first) && (capability !== 'multimodal' || first.capabilities.includes('multimodal')) ? [first, ...healthy.filter((m) => m !== first)] : healthy;

  const failoverOn = isFreeTier(tier) ? settings.free_failover : settings.failover_enabled;
  const considered = failoverOn ? ordered : ordered.slice(0, 1);
  const usable = considered.filter((m) => !atCap(m, counters));
  if (!usable.length) {
    if (considered.length) throw new AppError('AI_LIMIT_REACHED', 'The AI limit for this model has been reached. Please try again later.', 429, { limit: 'model' });
    throw new AppError('AI_UNAVAILABLE', 'EliahTech AI is temporarily unavailable. Please try again later.', 503);
  }
  const maxAttempts = failoverOn ? Math.max(1, Math.min(settings.max_attempts, HARD.maxAttempts, usable.length)) : 1;
  return { candidates: usable, maxAttempts, failover: failoverOn };
}

const statusFor = (error) => {
  if (error.code === providerErrors.E.TIMEOUT.code) return 'timeout';
  if (error.code === providerErrors.E.RATE_LIMITED.code) return 'rate_limited';
  if (error.code === providerErrors.E.CONTENT.code) return 'rejected';
  return 'error';
};

// Raised when the router gives up. `providerError` is the last failure; `attempts` is how many providers were tried.
export class RouterError extends Error {
  constructor(kind, providerError, attempts) {
    super(kind);
    this.name = 'RouterError';
    this.kind = kind; // 'non_recoverable' | 'all_failed' | 'out_of_time'
    this.providerError = providerError;
    this.attempts = attempts;
  }
}

export async function executeWithFailover({ candidates, maxAttempts, settings, call, record = {}, now = () => Date.now(), startedAt = now() }) {
  const deadline = startedAt + settings.total_deadline_ms;
  let attempts = 0;
  let last = null;
  let outOfTime = false;
  const limitedProviders = new Set();
  for (let i = 0; i < candidates.length && attempts < maxAttempts; i += 1) {
    const model = candidates[i];
    if (limitedProviders.has(model.provider?.code)) continue;
    const remaining = deadline - now();
    if (remaining < 1500) { outOfTime = true; last ??= new ProviderError(providerErrors.E.TIMEOUT.code, { recoverable: true }); break; }
    const timeoutMs = Math.max(HARD.minTimeoutMs, Math.min(model.timeout_ms ?? settings.request_timeout_ms, remaining - 250));
    attempts += 1;
    const t0 = now();
    try {
      const result = await call(model, { timeoutMs });
      await record.attempt?.({ model, attempt: attempts, status: 'success', latencyMs: now() - t0, usage: result.usage ?? null });
      return { model, result, attempts };
    } catch (raw) {
      // Anything that is not a ProviderError is a bug on our side: never retry it against paid providers.
      const error = raw instanceof ProviderError ? raw : new ProviderError('AI_INTERNAL_ERROR', { recoverable: false });
      last = error;
      if(error.code === providerErrors.E.RATE_LIMITED.code) limitedProviders.add(model.provider?.code);
      await record.cooldown?.({model,error});
      await record.attempt?.({ model, attempt: attempts, status: statusFor(error), errorCode: error.code, latencyMs: now() - t0 });
      if (!error.recoverable) throw new RouterError('non_recoverable', error, attempts);
      const next = candidates.slice(i + 1).find(m=>!limitedProviders.has(m.provider?.code));
      if (next && attempts < maxAttempts) await record.failover?.({ from: model, to: next, error });
    }
  }
  throw new RouterError(outOfTime ? 'out_of_time' : 'all_failed', last, attempts);
}
