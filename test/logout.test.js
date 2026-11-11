// Sign-out must always end signed out, so the next person on a shared phone cannot reuse the previous session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { buildAuthorizeUrl } from '../src/session/oauth.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
process.env.APP_URL = 'https://app.example';
process.env.RESEND_API_KEY = 're_test_key_0123456789';
process.env.EMAIL_FROM = 'Eliah Tech <no-reply@example.com>';
process.env.SUPABASE_AUTH_HOOK_SECRET = `v1,whsec_${Buffer.from('hook-secret-bytes-0123456789').toString('base64')}`;
const { app } = await import('../server.js');

const realFetch = globalThis.fetch;
const upstream = { logoutStatus: 204, calls: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname === '/auth/v1/logout') {
    upstream.calls.push({ token: String(init.headers?.Authorization || '').replace('Bearer ', ''), scope: u.searchParams.get('scope') });
    return { ok: upstream.logoutStatus < 400, status: upstream.logoutStatus, text: async () => '', json: async () => ({}) };
  }
  return realFetch(url, init);
};

const cleared = (res) => {
  const header = (res.headers['set-cookie'] || []).join('\n');
  return ['__Host-eliah_at', '__Host-eliah_rt', '__Host-eliah_csrf'].every((name) => new RegExp(`${name}=;[^\\n]*Max-Age=0`).test(header));
};
const signedIn = '__Host-eliah_at=ACCESS; __Host-eliah_rt=REFRESH; __Host-eliah_csrf=CSRF';

test('sign-out clears all session cookies and revokes only this device\'s session', async () => {
  upstream.calls.length = 0; upstream.logoutStatus = 204;
  const res = await request(app).post('/api/v1/auth/logout').set('Cookie', signedIn).set('Origin', 'https://app.example').set('X-CSRF-Token', 'CSRF').set('X-Eliah-Browser', '1');
  assert.equal(res.status, 200);
  assert.ok(cleared(res), 'access, refresh and csrf cookies must all be expired');
  assert.deepEqual(upstream.calls, [{ token: 'ACCESS', scope: 'local' }]);
});

test('sign-out still works when the CSRF cookie or header is missing (nobody is trapped signed in)', async () => {
  const res = await request(app).post('/api/v1/auth/logout').set('Cookie', '__Host-eliah_at=ACCESS; __Host-eliah_rt=REFRESH').set('Origin', 'https://app.example').set('X-Eliah-Browser', '1');
  assert.equal(res.status, 200);
  assert.ok(cleared(res));
});

test('sign-out clears the cookies even when the access token has expired or Supabase rejects the revoke', async () => {
  upstream.logoutStatus = 401;
  const res = await request(app).post('/api/v1/auth/logout').set('Cookie', signedIn).set('Origin', 'https://app.example').set('X-CSRF-Token', 'CSRF').set('X-Eliah-Browser', '1');
  assert.equal(res.status, 200);
  assert.ok(cleared(res));
  upstream.logoutStatus = 204;
});

test('sign-out with no session at all is harmless and idempotent', async () => {
  const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'https://app.example').set('X-Eliah-Browser', '1');
  assert.equal(res.status, 200);
  assert.ok(cleared(res));
});

test('sign-out from a foreign origin is still rejected', async () => {
  const res = await request(app).post('/api/v1/auth/logout').set('Cookie', signedIn).set('Origin', 'https://evil.example').set('X-CSRF-Token', 'CSRF');
  assert.equal(res.status, 403);
});

test('other cookie-authenticated mutations still require the CSRF token', async () => {
  const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', signedIn).set('Origin', 'https://app.example').set('X-Eliah-Browser', '1').send({});
  assert.equal(res.status, 403);
});

test('Google sign-in always shows the account chooser, so a shared phone never silently reuses the last Google account', () => {
  const url = new URL(buildAuthorizeUrl({ supabaseUrl: 'https://p.supabase.co', redirectTo: 'https://app.example/api/auth/google/callback', challenge: 'c'.repeat(43) }));
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
});

test('signed-in pages offer a visible Sign out, and it reports failure instead of faking success', () => {
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const header = appJs.slice(appJs.indexOf('function header()'), appJs.indexOf('function footer()'));
  assert.match(header, /data-action=\\"logout\\"|data-action="logout"/);
  assert.match(appJs, /Could not sign out/);
  assert.match(appJs, /pageshow/);
  const gaming = readFileSync(new URL('../public/gaming.js', import.meta.url), 'utf8');
  assert.match(gaming, /signout-nav/);
  assert.match(gaming, /pageshow/);
});

test('after sign-in an admin lands in the admin workspace and everyone else in their account', () => {
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const homeFor = new Function(`${/const homeFor = [^\n]+/.exec(appJs)[0]}; return homeFor;`)();
  assert.equal(homeFor({ role: 'admin' }), '/admin');
  assert.equal(homeFor({ role: 'free_user' }), '/profile');
  assert.equal(homeFor({ role: 'premium_user' }), '/profile');
  assert.equal(homeFor(null), '/profile');
  assert.match(appJs, /takeNext\(\) \|\| homeFor\(data\.user\)/, 'password login must use the role-aware destination');
  assert.match(appJs, /eliah\.afterLogin/, 'the Google button marks a fresh sign-in');
  const gaming = readFileSync(new URL('../public/gaming.js', import.meta.url), 'utf8');
  assert.match(gaming, /justSignedIn&&account\?\.role==='admin'\)\{location\.replace\('\/admin'\)/, 'the dashboard page forwards a freshly signed-in admin');
});
