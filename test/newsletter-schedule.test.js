import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_DAILY_LIMIT, MAX_ATTEMPTS, allowanceFor, clampLimit, daysLeft, estimatedFinish, nextUtcDay, utcDayStart } from '../src/newsletter-schedule.js';
import { authorizedScheduler } from '../src/scheduler-auth.js';
import { SETTINGS } from '../src/admin/settings.js';
import { validateEnv } from '../src/config/env.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('defaults: 30 emails a day, three attempts per delivery', () => {
  assert.equal(DEFAULT_DAILY_LIMIT, 30); assert.equal(MAX_ATTEMPTS, 3);
});
test('limit values are validated and fall back safely', () => {
  assert.equal(clampLimit(10), 10); assert.equal(clampLimit('25'), 25); assert.equal(clampLimit(1000), 1000);
  for (const bad of [0, -5, 1001, 2.5, 'abc', null, undefined, NaN]) assert.equal(clampLimit(bad), 30, String(bad));
  assert.equal(clampLimit('bad', 12), 12);
});
test('the quota day is the UTC day regardless of the server time zone', () => {
  assert.equal(utcDayStart(new Date('2026-10-28T23:59:59Z')).toISOString(), '2026-10-28T00:00:00.000Z');
  assert.equal(utcDayStart(new Date('2026-10-28T00:00:00Z')).toISOString(), '2026-10-28T00:00:00.000Z');
  assert.equal(utcDayStart(new Date('2026-10-29T02:59:00+03:00')).toISOString(), '2026-10-28T00:00:00.000Z'); // 02:59 in Kenya is still the previous UTC day
  assert.equal(nextUtcDay(new Date('2026-12-31T12:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});
test('allowance = limit minus sent today minus in-flight, never negative', () => {
  assert.equal(allowanceFor({ limit: 30 }), 30);
  assert.equal(allowanceFor({ limit: 30, sentToday: 12 }), 18);
  assert.equal(allowanceFor({ limit: 30, sentToday: 20, inFlight: 8 }), 2);
  assert.equal(allowanceFor({ limit: 30, sentToday: 45 }), 0);
  assert.equal(allowanceFor({ limit: 30, sentToday: -3 }), 30);
});
test('sending days left matches the plan: 20 people = 1 day, 70 = 3 days (30 + 30 + 10)', () => {
  assert.equal(daysLeft({ remaining: 20, limit: 30, allowance: 30 }), 1);
  assert.equal(daysLeft({ remaining: 30, limit: 30, allowance: 30 }), 1);
  assert.equal(daysLeft({ remaining: 31, limit: 30, allowance: 30 }), 2);
  assert.equal(daysLeft({ remaining: 70, limit: 30, allowance: 30 }), 3);
  assert.equal(daysLeft({ remaining: 70, limit: 30, allowance: 10 }), 3); // 10 today, 30, 30
  assert.equal(daysLeft({ remaining: 70, limit: 30, allowance: 0 }), 3); // nothing today; 30, 30, 10 on the next three days
  assert.equal(daysLeft({ remaining: 1, limit: 30, allowance: 0 }), 1);
  assert.equal(daysLeft({ remaining: 0, limit: 30, allowance: 30 }), 0);
  for (const [people, days] of [[20, 1], [100, 4], [500, 17], [1000, 34]]) assert.equal(daysLeft({ remaining: people, limit: 30, allowance: 30 }), days, `${people} people`);
});
test('estimated finish date follows the same arithmetic', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  assert.equal(estimatedFinish({ remaining: 20, limit: 30, allowance: 30, now }).toISOString(), '2026-10-28T00:00:00.000Z'); // today
  assert.equal(estimatedFinish({ remaining: 70, limit: 30, allowance: 30, now }).toISOString(), '2026-10-30T00:00:00.000Z');
  assert.equal(estimatedFinish({ remaining: 70, limit: 30, allowance: 0, now }).toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(estimatedFinish({ remaining: 0, limit: 30, allowance: 30, now }), null);
});
test('the scheduler endpoint accepts JOBS_TOKEN or CRON_SECRET, only when enabled, and nothing else', () => {
  const env = { SCHEDULER_ENABLED: 'true', JOBS_TOKEN: 'j'.repeat(32), CRON_SECRET: 'c'.repeat(32) };
  assert.equal(authorizedScheduler(`Bearer ${'j'.repeat(32)}`, env), true);
  assert.equal(authorizedScheduler(`Bearer ${'c'.repeat(32)}`, env), true); // Vercel Cron
  for (const bad of [undefined, '', 'Bearer ', 'Bearer wrong', `Bearer ${'j'.repeat(31)}`, 'j'.repeat(33), `Basic ${'j'.repeat(32)}`]) assert.equal(authorizedScheduler(bad, env), false, String(bad));
  assert.equal(authorizedScheduler(`Bearer ${'j'.repeat(32)}`, { ...env, SCHEDULER_ENABLED: 'false' }), false);
  assert.equal(authorizedScheduler(`Bearer ${'j'.repeat(32)}`, { ...env, SCHEDULER_ENABLED: undefined }), false);
  assert.equal(authorizedScheduler('Bearer undefined', { SCHEDULER_ENABLED: 'true' }), false); // no secrets configured
  assert.equal(authorizedScheduler(`Bearer ${'c'.repeat(32)}`, { SCHEDULER_ENABLED: 'true', CRON_SECRET: 'c'.repeat(32) }), true);
});
test('Vercel runs the job once a day, shortly after the mail quota resets, and the route accepts the GET it sends', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.deepEqual(vercel.crons.map((c) => c.path), ['/api/v1/jobs/run']);
  const [minute, hour, day, month, weekday] = vercel.crons[0].schedule.split(' ');
  assert.ok(/^\d+$/.test(minute) && /^\d+$/.test(hour)); assert.deepEqual([day, month, weekday], ['*', '*', '*']); // exactly once a day (Hobby plan limit)
  assert.ok(Number(hour) >= 0 && Number(hour) <= 23 && Number(minute) <= 59 && Number(hour) >= 1); // after 00:00 UTC, when the Resend daily quota resets
  const jobs = read('src/jobs.js');
  assert.match(jobs, /app\.get\('\/api\/v1\/jobs\/run'/); assert.match(jobs, /app\.post\('\/api\/v1\/jobs\/run'/);
  assert.match(jobs, /processDaily\(\)/); assert.doesNotMatch(jobs, /sendBatch\(/);
});
test('the daily limit is an admin setting kept private, with whole numbers 1 to 1000 only', () => {
  const parse = SETTINGS['newsletter-sending'];
  assert.deepEqual(parse({ daily_limit: 30 }), { daily_limit: 30 }); assert.deepEqual(parse({ daily_limit: '45' }), { daily_limit: 45 });
  for (const bad of [{}, { daily_limit: 0 }, { daily_limit: 1001 }, { daily_limit: 'many' }, { daily_limit: 2.5 }]) assert.throws(() => parse(bad), (e) => e.status === 422, JSON.stringify(bad));
  assert.match(read('src/admin/routes.js'), /'newsletter-sending'\]\.includes\(req\.params\.key\)/); // not exposed on the public settings API
});
test('admin API exposes usage, pause and resume; the old uncapped loop is gone from the UI', () => {
  const routes = read('src/admin/routes.js'); const ui = read('public/admin.js');
  for (const piece of ["'/newsletter/usage'", "'/newsletter/campaigns/:id/pause'", "'/newsletter/campaigns/:id/resume'", "'/newsletter/campaigns/:id/send-batch'"]) assert.ok(routes.includes(piece), piece);
  const view = ui.slice(ui.indexOf('const fmtDay'), ui.indexOf('async function emailLogView'));
  assert.doesNotMatch(view, /for \(;;\)/);
  for (const piece of ['Start sending', "Send today's batch now", 'Pause', 'Resume sending', 'Daily sending limit', 'role="progressbar"', '/admin/settings/newsletter-sending']) assert.ok(view.includes(piece), piece);
});
test('scheduler needs JOBS_TOKEN or CRON_SECRET; new variables are validated', () => {
  const good = { NODE_ENV: 'production', APP_URL: 'https://e.example', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: `sb_publishable_${'b'.repeat(20)}`, SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'a'.repeat(30)}`, SCHEDULER_ENABLED: 'true' };
  assert.ok(validateEnv(good).errors.some((e) => e.variable === 'JOBS_TOKEN' && e.problem === 'missing'));
  assert.equal(validateEnv({ ...good, CRON_SECRET: 'c'.repeat(32) }).ok, true);
  assert.equal(validateEnv({ ...good, JOBS_TOKEN: 'j'.repeat(32) }).ok, true);
  assert.ok(validateEnv({ ...good, CRON_SECRET: 'short' }).errors.some((e) => e.variable === 'CRON_SECRET'));
  assert.ok(validateEnv({ ...good, JOBS_TOKEN: 'j'.repeat(32), NEWSLETTER_DAILY_LIMIT: '0' }).errors.some((e) => e.variable === 'NEWSLETTER_DAILY_LIMIT'));
  assert.equal(validateEnv({ ...good, JOBS_TOKEN: 'j'.repeat(32), NEWSLETTER_DAILY_LIMIT: '30', NEWSLETTER_BATCH_SIZE: '50' }).ok, true);
});
test('the migration only adds what the sender needs and is re-runnable', () => {
  const sql = read('supabase/migrations/20261028100000_newsletter_daily_cap.sql');
  assert.match(sql, /add column if not exists attempts/); assert.match(sql, /drop constraint if exists newsletter_campaigns_status_check/);
  assert.match(sql, /'draft', 'sending', 'paused', 'sent'/); assert.match(sql, /20261028_newsletter_daily_cap/);
  assert.match(sql, /grant execute on function public\.newsletter_next_batch\(uuid, integer\) to service_role/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
});
