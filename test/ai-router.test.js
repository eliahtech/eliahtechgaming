import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates, executeWithFailover, tierOf, tierMayUse, RouterError } from '../src/ai/router.js';
import { ProviderError } from '../src/ai/providers/base.js';
import { defaultSettings } from '../src/ai/config.js';

let n = 0;
const model = (slug, o = {}) => ({ id: `id-${slug}`, slug, display_name: slug, priority: 100 + (n += 1), capabilities: ['general'], ready: true, enabled: true, is_free: true, free_user_enabled: false, premium_user_enabled: true, provider: { code: `p-${slug}`, is_free: true }, daily_limit: null, monthly_limit: null, timeout_ms: null, ...o });
const settings = (o = {}) => ({ ...defaultSettings({}), ...o });
const slugs = (plan) => plan.candidates.map((m) => m.slug);
const fail = (code, recoverable) => new ProviderError(code, { recoverable });
const pool = () => [
  model('qwen', { priority: 1, capabilities: ['general', 'coding'], free_user_enabled: true }),
  model('gemma', { priority: 2, capabilities: ['general', 'fast'], free_user_enabled: true }),
  model('nemotron', { priority: 3, capabilities: ['general', 'coding', 'reasoning'] }),
  model('ling', { priority: 4, capabilities: ['general'] }),
];

test('tier is derived from the verified server-side access object, never from client input', () => {
  assert.equal(tierOf(null), 'guest');
  assert.equal(tierOf({ access: { role: 'free_user' } }), 'free_user');
  assert.equal(tierOf({ access: { role: 'premium_user' } }), 'premium_user');
  assert.equal(tierOf({ access: { role: 'admin' } }), 'admin');
  assert.equal(tierOf({ access: { role: 'guest' } }), 'free_user', 'a role value of "guest" on a signed-in user is not trusted');
  assert.equal(tierOf({ isPremium: true, access: { role: 'free_user' } }), 'free_user', 'a client-style isPremium flag is ignored');
});

test('models are ordered by priority; disabled / not-ready models are never selected', () => {
  const models = pool();
  models[0].ready = false; // e.g. disabled model or missing credential
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models, capability: 'general' });
  assert.deepEqual(slugs(plan), ['gemma', 'nemotron', 'ling']);
});

test('capability routing prefers tagged models, then falls back to general-purpose models', () => {
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'coding' });
  assert.deepEqual(slugs(plan), ['qwen', 'nemotron', 'gemma', 'ling'], 'coding-capable first (by priority), then general');
  const reasoning = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'reasoning' });
  assert.equal(slugs(reasoning)[0], 'nemotron');
  const fast = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'fast' });
  assert.equal(slugs(fast)[0], 'gemma', 'not simply the first model by priority');
  const general = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
  assert.equal(slugs(general)[0], 'qwen');
});

test('Free users only ever see free_user_enabled models; Premium-only models are unreachable, even by name', () => {
  const plan = selectCandidates({ tier: 'free_user', settings: settings({ free_failover: true }), models: pool(), capability: 'general' });
  assert.deepEqual(slugs(plan), ['qwen', 'gemma']);
  assert.throws(() => selectCandidates({ tier: 'free_user', settings: settings(), models: pool(), capability: 'general', requested: 'nemotron' }), (e) => e.status === 403 && e.code === 'AI_MODEL_FORBIDDEN');
  assert.throws(() => selectCandidates({ tier: 'guest', settings: settings(), models: pool(), capability: 'general', requested: 'ling' }), (e) => e.status === 403);
  assert.equal(tierMayUse('free_user', pool()[2], settings()), false);
});

test('Premium users reach every premium-enabled model, with failover across the pool', () => {
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
  assert.deepEqual(slugs(plan), ['qwen', 'gemma', 'nemotron', 'ling']);
  assert.equal(plan.failover, true);
  assert.equal(plan.maxAttempts, 3, 'bounded by max_attempts, not by pool size');
  const freeOnly = [model('free-only', { priority: 1, free_user_enabled: true, premium_user_enabled: false }), ...pool()];
  assert.equal(slugs(selectCandidates({ tier: 'premium_user', settings: settings(), models: freeOnly, capability: 'general' })).includes('free-only'), false);
});

test('Free users may fail over only within the free pool by default; disabling it gives one attempt', () => {
  const multi = selectCandidates({ tier: 'free_user', settings: settings(), models: pool(), capability: 'general' });
  assert.deepEqual([slugs(multi), multi.maxAttempts, multi.failover], [['qwen', 'gemma'], 2, true]);
  const single = selectCandidates({ tier: 'free_user', settings: settings({ free_failover: false }), models: pool(), capability: 'general' });
  assert.deepEqual([slugs(single), single.maxAttempts, single.failover], [['qwen'], 1, false]);
  assert.equal(multi.candidates.some((m) => !m.free_user_enabled), false, 'never the Premium pool');
});

test('disabled access flags are enforced: free_access / premium_access off removes the whole tier pool', () => {
  assert.throws(() => selectCandidates({ tier: 'free_user', settings: settings({ free_access: false }), models: pool(), capability: 'general' }), (e) => e.status === 503);
  assert.throws(() => selectCandidates({ tier: 'premium_user', settings: settings({ premium_access: false }), models: pool(), capability: 'general' }), (e) => e.status === 503);
  assert.ok(selectCandidates({ tier: 'admin', settings: settings({ premium_access: false }), models: pool(), capability: 'general' }).candidates.length);
});

test('requested model: must exist, is tried first, and premium failover continues afterwards', () => {
  assert.throws(() => selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general', requested: 'nope' }), (e) => e.status === 404 && e.code === 'AI_MODEL_NOT_FOUND');
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general', requested: 'ling' });
  assert.deepEqual(slugs(plan), ['ling', 'qwen', 'gemma', 'nemotron']);
  assert.equal(selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general', requested: 'id-ling' }).candidates[0].slug, 'ling', 'ids work as well as slugs');
  const disabled = pool(); disabled[3].ready = false;
  assert.throws(() => selectCandidates({ tier: 'premium_user', settings: settings(), models: disabled, capability: 'general', requested: 'ling' }), (e) => e.status === 403);
});

test('default_model setting wins when nothing is requested', () => {
  const plan = selectCandidates({ tier: 'premium_user', settings: settings({ default_model: 'ling' }), models: pool(), capability: 'general' });
  assert.equal(slugs(plan)[0], 'ling');
});

test('per-model daily and monthly caps: capped models are skipped; a capped lone free model returns AI_LIMIT_REACHED', () => {
  const models = pool();
  models[0].daily_limit = 5; models[1].monthly_limit = 10;
  const counters = new Map([['id-qwen', { day: 5, month: 5 }], ['id-gemma', { day: 1, month: 10 }]]);
  assert.deepEqual(slugs(selectCandidates({ tier: 'premium_user', settings: settings(), models, counters, capability: 'general' })), ['nemotron', 'ling']);
  assert.throws(() => selectCandidates({ tier: 'free_user', settings: settings(), models, counters, capability: 'general' }), (e) => e.status === 429 && e.code === 'AI_LIMIT_REACHED');
});

test('models in cooldown are excluded until recovery',()=>{
 const models=pool();
 assert.deepEqual(slugs(selectCandidates({tier:'premium_user',settings:settings(),models,capability:'general',isUnavailable:m=>m.slug==='qwen'})),['gemma','nemotron','ling']);
 assert.equal(slugs(selectCandidates({tier:'premium_user',settings:settings(),models,capability:'general'}))[0],'qwen');
});

test('failover: 429 on model 1 -> model 2 is attempted and its answer returned', async () => {
  const calls = []; const attempts = []; const failovers = [];
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
  const out = await executeWithFailover({
    ...plan, settings: settings(),
    call: async (m) => { calls.push(m.slug); if (m.slug === 'qwen') throw fail('AI_PROVIDER_RATE_LIMITED', true); return { content: 'hi', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }; },
    record: { attempt: (a) => attempts.push([a.model.slug, a.status, a.errorCode]), failover: (f) => failovers.push([f.from.slug, f.to.slug, f.error.code]) },
  });
  assert.deepEqual(calls, ['qwen', 'gemma']);
  assert.equal(out.model.slug, 'gemma');
  assert.deepEqual(attempts, [['qwen', 'rate_limited', 'AI_PROVIDER_RATE_LIMITED'], ['gemma', 'success', undefined]]);
  assert.deepEqual(failovers, [['qwen', 'gemma', 'AI_PROVIDER_RATE_LIMITED']]);
});

test('failover: timeout then 5xx then success walks the chain in priority order', async () => {
  const calls = [];
  const plan = selectCandidates({ tier: 'premium_user', settings: settings({ max_attempts: 3 }), models: pool(), capability: 'general' });
  const out = await executeWithFailover({ ...plan, settings: settings(), call: async (m) => { calls.push(m.slug); if (m.slug === 'qwen') throw fail('AI_PROVIDER_TIMEOUT', true); if (m.slug === 'gemma') throw fail('AI_PROVIDER_UNAVAILABLE', true); return { content: 'ok' }; } });
  assert.deepEqual(calls, ['qwen', 'gemma', 'nemotron']);
  assert.equal(out.attempts, 3);
});

test('non-recoverable errors (bad request, auth, content rejection, bugs) are NOT retried on other providers', async () => {
  for (const code of ['AI_PROVIDER_REJECTED_REQUEST', 'AI_PROVIDER_AUTH', 'AI_CONTENT_REJECTED', 'AI_PROVIDER_MODEL_NOT_FOUND']) {
    const calls = [];
    const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
    await assert.rejects(executeWithFailover({ ...plan, settings: settings(), call: async (m) => { calls.push(m.slug); throw fail(code, false); } }), (e) => e instanceof RouterError && e.kind === 'non_recoverable' && e.providerError.code === code);
    assert.equal(calls.length, 1, code);
  }
  const calls = [];
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
  await assert.rejects(executeWithFailover({ ...plan, settings: settings(), call: async (m) => { calls.push(m.slug); throw new TypeError('bug'); } }), (e) => e.kind === 'non_recoverable' && e.providerError.code === 'AI_INTERNAL_ERROR');
  assert.equal(calls.length, 1, 'a programming error must not be replayed against paid providers');
});

test('all providers failing returns a controlled RouterError after at most max_attempts calls', async () => {
  const calls = [];
  const many = Array.from({ length: 8 }, (_, i) => model(`m${i}`, { priority: i + 1 }));
  const plan = selectCandidates({ tier: 'premium_user', settings: settings({ max_attempts: 3 }), models: many, capability: 'general' });
  await assert.rejects(executeWithFailover({ ...plan, settings: settings({ max_attempts: 3 }), call: async (m) => { calls.push(m.slug); throw fail('AI_PROVIDER_RATE_LIMITED', true); } }), (e) => e instanceof RouterError && e.kind === 'all_failed' && e.attempts === 3);
  assert.equal(calls.length, 3, 'no infinite or unbounded retrying');
});

test('the hard ceiling on attempts holds even if settings are absurd', () => {
  const many = Array.from({ length: 20 }, (_, i) => model(`m${i}`, { priority: i + 1 }));
  assert.equal(selectCandidates({ tier: 'premium_user', settings: settings({ max_attempts: 999 }), models: many, capability: 'general' }).maxAttempts, 5);
});

test('failover can be switched off for everyone: exactly one attempt', async () => {
  const plan = selectCandidates({ tier: 'premium_user', settings: settings({ failover_enabled: false }), models: pool(), capability: 'general' });
  assert.deepEqual([plan.candidates.length, plan.maxAttempts], [1, 1]);
});

test('per-attempt timeout comes from the model, then settings, and never exceeds the remaining deadline', async () => {
  const seen = [];
  let clock = 0;
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: [model('a', { priority: 1, timeout_ms: 9000 }), model('b', { priority: 2 })], capability: 'general' });
  const s = settings({ request_timeout_ms: 20000, total_deadline_ms: 12000 });
  await executeWithFailover({ ...plan, settings: s, now: () => clock, startedAt: 0, call: async (m, { timeoutMs }) => { seen.push([m.slug, timeoutMs]); clock += 9000; if (m.slug === 'a') throw fail('AI_PROVIDER_TIMEOUT', true); return { content: 'ok' }; } }).catch(() => {});
  assert.deepEqual(seen[0], ['a', 9000]);
  assert.deepEqual(seen[1], ['b', 2750], '3s of the 12s deadline remain: the next call is clamped to remaining time minus a 250ms margin, not the 20s setting');
});

test('running out of time is reported as out_of_time, not as an endless wait', async () => {
  let clock = 0;
  const plan = selectCandidates({ tier: 'premium_user', settings: settings(), models: pool(), capability: 'general' });
  await assert.rejects(executeWithFailover({ ...plan, settings: settings({ total_deadline_ms: 5000 }), now: () => clock, startedAt: 0, call: async () => { clock += 4000; throw fail('AI_PROVIDER_TIMEOUT', true); } }), (e) => e.kind === 'out_of_time');
});
