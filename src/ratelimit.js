// Database-backed rate limiting. In-memory limiters do not work on serverless platforms because every
// instance has its own counters; this one shares state through the rate_limit_hit() Postgres function.
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export const hashKey = (scope, value) => createHash('sha256').update(`${scope}:${value}`).digest('hex');

export function rateLimit({ db, scope, windowSeconds, limit, keyOf = (req) => req.ip, failClosed = false }) {
  return async (req, res, next) => {
    try {
      const value = keyOf(req);
      if (!value) return next();
      const result = await db.rpc('rate_limit_hit', { p_key: hashKey(scope, value), p_window_seconds: windowSeconds, p_limit: limit });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row || typeof row.allowed !== 'boolean') throw new Error('unexpected rate limiter response');
      res.set('RateLimit-Remaining', String(row.remaining));
      if (!row.allowed) {
        const retry = Math.max(1, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000) || windowSeconds);
        res.set('Retry-After', String(retry));
        return next(new AppError('RATE_LIMITED', 'Too many requests. Please try again later.', 429));
      }
      return next();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'rate_limiter_failed', scope, code: error.code, message: error.message }));
      return failClosed ? next(new AppError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again.', 503)) : next();
    }
  };
}
