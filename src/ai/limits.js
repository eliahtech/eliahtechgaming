// Usage limits per tier, all enforced server-side. Per-minute bursts use the shared Postgres limiter (src/ratelimit.js, works
// across serverless instances). Daily request/token caps for signed-in users count real successful usage from ai_usage.
// Guests have no user id, so both of their windows are IP-keyed limiter hits. Any infrastructure failure FAILS CLOSED:
// the AI is paid usage, so "limiter down" must never mean "unlimited".
import { AppError } from '../errors.js';
import { hashKey } from '../ratelimit.js';

const unavailable = () => new AppError('SERVICE_UNAVAILABLE', 'The AI service is temporarily unavailable. Please try again.', 503);

async function hit(db, scope, value, windowSeconds, limit) {
  const result = await db.rpc('rate_limit_hit', { p_key: hashKey(scope, value), p_window_seconds: windowSeconds, p_limit: limit });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.allowed !== 'boolean') throw new Error('unexpected rate limiter response');
  return row;
}
const retryAfter = (row, fallback) => Math.max(1, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000) || fallback);

export async function enforceLimits({ db, settings, tier, userId, ip }) {
  const limits = settings.limits[tier];
  try {
    if (tier === 'guest') {
      const who = ip || 'unknown';
      const minute = await hit(db, 'ai-guest-min', who, 60, limits.per_minute);
      if (!minute.allowed) throw new AppError('AI_RATE_LIMITED', 'You are sending requests too quickly. Please wait a moment.', 429, { retryAfter: retryAfter(minute, 60) });
      const day = await hit(db, 'ai-guest-day', who, 86400, limits.per_day);
      if (!day.allowed) throw new AppError('AI_LIMIT_REACHED', 'Your AI usage limit has been reached. Please try again later or sign in.', 429, { limit: 'daily', retryAfter: retryAfter(day, 86400) });
      return;
    }
    const minute = await hit(db, 'ai-user-min', userId, 60, limits.per_minute);
    if (!minute.allowed) throw new AppError('AI_RATE_LIMITED', 'You are sending requests too quickly. Please wait a moment.', 429, { retryAfter: retryAfter(minute, 60) });
    const usage = await userUsage(db, userId);
    if (usage.requests_today >= limits.per_day) throw new AppError('AI_LIMIT_REACHED', 'Your AI usage limit has been reached. Please try again later.', 429, { limit: 'daily' });
    if (limits.tokens_per_day != null && usage.tokens_today >= limits.tokens_per_day) throw new AppError('AI_LIMIT_REACHED', 'Your daily AI token allowance has been used. Please try again tomorrow.', 429, { limit: 'tokens' });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(JSON.stringify({ level: 'error', msg: 'ai_limiter_failed', tier, code: error.code, message: error.message }));
    throw unavailable();
  }
}

export async function userUsage(db, userId) {
  const result = await db.rpc('ai_user_usage', { p_user: userId });
  const row = Array.isArray(result) ? result[0] : result;
  return { requests_today: Number(row?.requests_today ?? 0), tokens_today: Number(row?.tokens_today ?? 0) };
}
