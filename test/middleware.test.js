import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthMiddleware } from '../src/auth-middleware.js';
import { AppError } from '../src/errors.js';

const now = () => new Date('2026-10-10T12:00:00Z');
const contexts = {
  admin: { profile: { role: 'admin' }, subscriptions: [] },
  free: { profile: { role: 'free_user' }, subscriptions: [] },
  trial: { profile: { role: 'free_user', trial_started_at: '2026-10-09T00:00:00Z', trial_ends_at: '2026-10-12T00:00:00Z' }, subscriptions: [] },
};
const auth = {
  async getUser(token) {
    if (token === 'bad') throw new AppError('INVALID_TOKEN', 'invalid', 401);
    const [id, verified] = token.split(':');
    return { id, email: `${id}@x.co`, email_verified: verified !== 'unverified' };
  },
};
const mw = createAuthMiddleware({ auth, loadContext: async (id) => contexts[id], now });
const run = (fn, headers = {}, body = {}) => new Promise((resolve) => { const req = { headers, body }; fn(req, {}, (err) => resolve({ err, req })); });

test('requireAuth rejects missing and invalid tokens with 401', async () => {
  assert.equal((await run(mw.requireAuth)).err.status, 401);
  assert.equal((await run(mw.requireAuth, { authorization: 'Bearer bad' })).err.code, 'INVALID_TOKEN');
  assert.equal((await run(mw.requireAuth, { authorization: 'Basic abc' })).err.status, 401);
});

test('requireAuth attaches a computed access object', async () => {
  const { err, req } = await run(mw.requireAuth, { authorization: 'Bearer free' });
  assert.equal(err, undefined);
  assert.deepEqual([req.user.id, req.user.access.isPremium, req.user.access.role], ['free', false, 'free_user']);
});

test('optionalAuth lets guests through but rejects a bad token', async () => {
  const guest = await run(mw.optionalAuth);
  assert.deepEqual([guest.err, guest.req.user], [undefined, null]);
  assert.equal((await run(mw.optionalAuth, { authorization: 'Bearer bad' })).err.status, 401);
});

test('requireAdmin: only a verified admin passes, and body claims are ignored', async () => {
  assert.equal((await run(mw.requireAdmin, { authorization: 'Bearer admin' })).err, undefined);
  assert.equal((await run(mw.requireAdmin, { authorization: 'Bearer admin:unverified' })).err.status, 403);
  const forged = await run(mw.requireAdmin, { authorization: 'Bearer free' }, { isAdmin: true, role: 'admin' });
  assert.equal(forged.err.status, 403);
  assert.equal((await run(mw.requireAdmin)).err.status, 401);
});

test('requirePremium: trial and admin pass, free users get PREMIUM_REQUIRED, body claims ignored', async () => {
  assert.equal((await run(mw.requirePremium, { authorization: 'Bearer trial' })).err, undefined);
  assert.equal((await run(mw.requirePremium, { authorization: 'Bearer admin' })).err, undefined);
  const free = await run(mw.requirePremium, { authorization: 'Bearer free' }, { isPremium: true });
  assert.deepEqual([free.err.status, free.err.code], [403, 'PREMIUM_REQUIRED']);
});
