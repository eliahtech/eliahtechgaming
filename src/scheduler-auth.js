// Authorisation for the scheduler endpoint. Accepts JOBS_TOKEN (external schedulers, POST) or CRON_SECRET
// (Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" with a GET request automatically).
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(String(value)).digest();
export function authorizedScheduler(authorizationHeader, env = process.env) {
  if (env.SCHEDULER_ENABLED !== 'true') return false;
  const supplied = String(authorizationHeader || '').replace(/^Bearer /, '');
  if (!supplied) return false;
  return [env.JOBS_TOKEN, env.CRON_SECRET].filter(Boolean).some((secret) => timingSafeEqual(digest(supplied), digest(secret)));
}
