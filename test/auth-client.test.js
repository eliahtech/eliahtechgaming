import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient, mapAuthError } from '../src/auth.js';
import { AppError } from '../src/errors.js';
import { ConfigError } from '../src/supabase.js';

const ANON = 'anon-key-for-tests';
function client(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const call = { path: u.pathname, query: Object.fromEntries(u.searchParams), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = handler(call);
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  return { auth: createAuthClient({ url: 'https://x.supabase.co', anonKey: ANON, fetchImpl }), calls };
}
const tokenBody = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, expires_at: 1, token_type: 'bearer', user: { id: 'u1', email: 'a@b.co', email_confirmed_at: '2026-01-01', app_metadata: { role: 'admin' }, phone: '123' } };

test('sign in posts the password grant and returns a trimmed session and user', async () => {
  const { auth, calls } = client(() => ({ body: tokenBody }));
  const out = await auth.signIn({ email: 'a@b.co', password: 'pw123456' });
  assert.equal(calls[0].path, '/auth/v1/token');
  assert.equal(calls[0].query.grant_type, 'password');
  assert.equal(calls[0].headers.apikey, ANON);
  assert.deepEqual(out.user, { id: 'u1', email: 'a@b.co', email_verified: true });
  assert.equal(out.session.access_token, 'AT');
  assert.equal(JSON.stringify(out).includes('app_metadata'), false);
});

test('invalid credentials and unverified email map to distinct, safe errors', async () => {
  const bad = client(() => ({ status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }));
  await assert.rejects(() => bad.auth.signIn({ email: 'a@b.co', password: 'x' }), (e) => e instanceof AppError && e.status === 401 && e.code === 'INVALID_CREDENTIALS');
  const unverified = client(() => ({ status: 400, body: { error_code: 'email_not_confirmed' } }));
  await assert.rejects(() => unverified.auth.signIn({ email: 'a@b.co', password: 'x' }), (e) => e.status === 403 && e.code === 'EMAIL_NOT_VERIFIED');
});

test('sign up sends display name metadata and redirect, and returns no session when confirmation is required', async () => {
  const { auth, calls } = client(() => ({ body: { id: 'u1', email: 'a@b.co' } }));
  const out = await auth.signUp({ email: 'a@b.co', password: 'pw123456', displayName: 'Ann', redirectTo: 'https://app/login?verified=1' });
  assert.deepEqual(out, { session: null, user: null });
  assert.deepEqual(calls[0].body.data, { display_name: 'Ann' });
  assert.equal(calls[0].query.redirect_to, 'https://app/login?verified=1');
});

test('token verification uses the caller token, not the anon key', async () => {
  const { auth, calls } = client(() => ({ body: tokenBody.user }));
  await auth.getUser('USER_JWT');
  assert.equal(calls[0].headers.Authorization, 'Bearer USER_JWT');
  const rejected = client(() => ({ status: 401, body: { error_code: 'bad_jwt' } }));
  await assert.rejects(() => rejected.auth.getUser('nope'), (e) => e.status === 401 && e.code === 'INVALID_TOKEN');
});

test('recover, update password and logout hit the right endpoints', async () => {
  const { auth, calls } = client(() => ({ body: {} }));
  await auth.recover('a@b.co', 'https://app/reset-password');
  await auth.updatePassword('T', 'newpassword1');
  await auth.signOut('T');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /auth/v1/recover', 'PUT /auth/v1/user', 'POST /auth/v1/logout']);
  assert.equal(calls[2].query.scope, 'local');
});

test('network failure and missing configuration are explicit', async () => {
  const down = createAuthClient({ url: 'https://x.supabase.co', anonKey: ANON, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(() => down.getUser('t'), (e) => e.code === 'AUTH_UNAVAILABLE' && e.status === 502);
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  await assert.rejects(() => createAuthClient({ fetchImpl: async () => { throw new Error('unreachable'); } }).getUser('t'), ConfigError);
  if (saved.u !== undefined) process.env.SUPABASE_URL = saved.u;
  if (saved.k !== undefined) process.env.SUPABASE_ANON_KEY = saved.k;
});

test('upstream 5xx and 429 never leak provider text', () => {
  assert.equal(mapAuthError(500, { msg: 'internal stack trace' }).message.includes('stack'), false);
  assert.equal(mapAuthError(429, {}).status, 429);
});
