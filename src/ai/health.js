// Provider/model health derived ONLY from real recent attempts in ai_usage (plus explicit admin tests, which are also rows).
// No synthetic traffic is ever generated. States: healthy | degraded | unavailable | disabled | unknown (no recent traffic).
// Recovery is automatic: "unavailable" only lasts for a short cooldown, after which the next request probes the model again.
export const HEALTH_WINDOW_MS = 15 * 60 * 1000;
export const COOLDOWN_MS = 60 * 1000;
const FAILURE = new Set(['error', 'timeout', 'rate_limited']); // 'rejected' (content/user input) is not the provider's fault

export function summarize(rows, keyOf) {
  const out = new Map();
  // rows arrive newest first
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const at = Date.parse(row.created_at);
    const s = out.get(key) ?? { total: 0, failures: 0, successes: 0, consecutiveFailures: 0, lastFailureAt: null, lastSuccessAt: null, streakOpen: true };
    if (row.status === 'rejected') { out.set(key, s); continue; }
    s.total += 1;
    if (FAILURE.has(row.status)) {
      s.failures += 1;
      if (s.streakOpen) s.consecutiveFailures += 1;
      s.lastFailureAt ??= at;
    } else {
      s.successes += 1;
      s.streakOpen = false;
      s.lastSuccessAt ??= at;
    }
    out.set(key, s);
  }
  return out;
}

export function statusOf(summary, { enabled = true, now = Date.now() } = {}) {
  if (!enabled) return 'disabled';
  if (!summary || summary.total === 0) return 'unknown';
  if (summary.consecutiveFailures >= 3) return now - summary.lastFailureAt < COOLDOWN_MS ? 'unavailable' : 'degraded';
  if (summary.total >= 5 && summary.failures / summary.total >= 0.3) return 'degraded';
  return 'healthy';
}

export function createHealthTracker({ db, ttlMs = 10000, now = () => Date.now() }) {
  let cache = null;
  async function snapshot() {
    if (cache && now() - cache.at < ttlMs) return cache.value;
    const since = new Date(now() - HEALTH_WINDOW_MS).toISOString();
    const rows = await db.select('ai_usage', { select: 'provider,model_id,status,created_at', created_at: `gte.${since}`, request_id: 'not.is.null', order: 'created_at.desc', limit: '1000' });
    const value = { byModel: summarize(rows, (r) => r.model_id), byProvider: summarize(rows, (r) => r.provider), at: now() };
    cache = { at: now(), value };
    return value;
  }
  return {
    snapshot,
    invalidate() { cache = null; },
    modelStatus: (snap, model) => statusOf(snap.byModel.get(model.id), { enabled: model.enabled, now: now() }),
    providerStatus: (snap, provider) => statusOf(snap.byProvider.get(provider.code), { enabled: provider.enabled, now: now() }),
  };
}
