import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, hashKey } from '../src/ratelimit.js';

const run = (mw, req) => new Promise((resolve) => { const headers = {}; mw(req, { set: (k, v) => { headers[k] = v; } }, (err) => resolve({ err, headers })); });
const future = () => new Date(Date.now() + 60000).toISOString();

test('allows requests under the limit and stores only a hashed key', async () => {
  let args;
  const db = { rpc: async (name, a) => { args = { name, ...a }; return [{ allowed: true, remaining: 4, reset_at: future() }]; } };
  const { err, headers } = await run(rateLimit({ db, scope: 'login', limit: 5, windowSeconds: 900 }), { ip: '203.0.113.9' });
  assert.equal(err, undefined);
  assert.equal(headers['RateLimit-Remaining'], '4');
  assert.equal(args.name, 'rate_limit_hit');
  assert.equal(args.p_key, hashKey('login', '203.0.113.9'));
  assert.equal(args.p_key.includes('203.0.113.9'), false);
});

test('blocks with 429 and Retry-After when over the limit', async () => {
  const db = { rpc: async () => [{ allowed: false, remaining: 0, reset_at: future() }] };
  const { err, headers } = await run(rateLimit({ db, scope: 's', limit: 1, windowSeconds: 60 }), { ip: '1.1.1.1' });
  assert.deepEqual([err.status, err.code], [429, 'RATE_LIMITED']);
  assert.ok(Number(headers['Retry-After']) >= 1);
});

test('database failure: fails open by default, fails closed for sensitive scopes', async () => {
  const db = { rpc: async () => { throw new Error('db down'); } };
  const log = console.error; console.error = () => {};
  try {
    assert.equal((await run(rateLimit({ db, scope: 's', limit: 1, windowSeconds: 60 }), { ip: '1.1.1.1' })).err, undefined);
    assert.equal((await run(rateLimit({ db, scope: 's', limit: 1, windowSeconds: 60, failClosed: true }), { ip: '1.1.1.1' })).err.status, 503);
  } finally { console.error = log; }
});

test('skips limiting when there is no key (e.g. no email in the body)', async () => {
  let called = false;
  const db = { rpc: async () => { called = true; } };
  assert.equal((await run(rateLimit({ db, scope: 's', limit: 1, windowSeconds: 60, keyOf: () => null }), {})).err, undefined);
  assert.equal(called, false);
});
