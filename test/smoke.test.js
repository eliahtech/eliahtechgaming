// API route tests. Requires dependencies (npm install). Supabase (REST + Auth) is replaced by a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
process.env.APP_URL = 'https://app.example';
process.env.RESEND_API_KEY = 're_test_key_0123456789';
process.env.EMAIL_FROM = 'Eliah Tech <no-reply@example.com>';
process.env.SUPABASE_AUTH_HOOK_SECRET = `v1,whsec_${Buffer.from('hook-secret-bytes-0123456789').toString('base64')}`;
const { app } = await import('../server.js');

const U = { free: '11111111-1111-4111-8111-111111111111', trial: '22222222-2222-4222-8222-222222222222', admin: '33333333-3333-4333-8333-333333333333' };
const soon = new Date(Date.now() + 2 * 86400000).toISOString();
const profiles = {
  [U.free]: { id: U.free, display_name: 'Free', role: 'free_user' },
  [U.trial]: { id: U.trial, display_name: 'Trial', role: 'free_user', trial_started_at: new Date().toISOString(), trial_ends_at: soon },
  [U.admin]: { id: U.admin, display_name: 'Boss', role: 'admin' },
};
const post = (over) => ({ id: 'p1', slug: 'a-post', title: 'A post', excerpt: 'x', published_at: '2026-09-01T00:00:00Z', featured: true, is_premium: false, featured_image_url: null, author_name: 'Editorial', reading_time: 2, categories: { slug: 'android-tips', name: 'Android Tips' }, post_tags: [], content_html: '<p>Body</p><script>alert(1)</script>', ...over });
const rows = { posts: [post()], services: [{ id: 's1', slug: 's', title: 'S', features: [] }], settings: [{ value: { hero_title: 'Hello' } }] };

const realFetch = globalThis.fetch;
const sent = [];
let rateAllowed = true;
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => (body === null ? '' : JSON.stringify(body)), json: async () => body });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const headers = init.headers || {};
  if (u.hostname === 'api.resend.com') {
    const batch = JSON.parse(init.body);
    sent.push({ mail: { messages: batch } });
    return json({ data: batch.map((_, i) => ({ id: `em-${i}` })) });
  }
  if (u.pathname.startsWith('/auth/v1/')) {
    const route = u.pathname.replace('/auth/v1', '');
    const token = String(headers.Authorization || '').replace('Bearer ', '');
    if (route === '/token') {
      const body = JSON.parse(init.body);
      if (u.searchParams.get('grant_type') === 'password') {
        if (body.password !== 'correct-password') return json({ error_code: 'invalid_credentials' }, 400);
        return json({ access_token: `tok-${U.free}`, refresh_token: 'rt', expires_in: 3600, user: { id: U.free, email: body.email, email_confirmed_at: '2026-01-01' } });
      }
      return json({ access_token: `tok-${U.free}`, refresh_token: 'rt2', expires_in: 3600, user: { id: U.free, email: 'a@b.co', email_confirmed_at: '2026-01-01' } });
    }
    if (route === '/user' && init.method === 'GET') {
      const id = token.startsWith('tok-') ? token.slice(4) : null;
      return id && profiles[id] ? json({ id, email: `${id}@x.co`, email_confirmed_at: '2026-01-01' }) : json({ error_code: 'bad_jwt' }, 401);
    }
    sent.push({ auth: route, method: init.method, body: init.body });
    return json({});
  }
  const table = u.pathname.split('/').pop();
  if (table === 'rate_limit_hit') return json([{ allowed: rateAllowed, remaining: 1, reset_at: new Date(Date.now() + 60000).toISOString() }]);
  if (u.searchParams.get('slug') === 'eq.does-not-exist') return json([]);
  sent.push({ table, method: init.method, body: init.body });
  if (table === 'profiles' && init.method === 'GET') return json([profiles[u.searchParams.get('id').replace('eq.', '')]].filter(Boolean));
  if (init.method === 'PATCH') return json([{ id: 'x' }]);
  if (init.method === 'POST') return json(table === 'messages' ? [{ id: 'm1' }] : [{ id: 'mock-1' }]);
  return json(rows[table] ?? []);
};
test.after(() => { globalThis.fetch = realFetch; });
const as = (id) => ({ Authorization: `Bearer tok-${id}` });

test('health reports database configuration', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.database, 'configured');
});

test('security headers include a CSP without unsafe-inline scripts', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.match(res.headers['content-security-policy'], /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(res.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
});

test('posts, services and homepage come from the database layer', async () => {
  assert.equal((await request(app).get('/api/v1/posts?limit=2')).body.data.items[0].slug, 'a-post');
  assert.equal((await request(app).get('/api/v1/services')).body.data[0].slug, 's');
  assert.equal((await request(app).get('/api/v1/settings/homepage')).body.data.hero_title, 'Hello');
  assert.equal((await request(app).get('/api/v1/posts/does-not-exist')).status, 404);
});

test('post HTML is sanitized before it leaves the API', async () => {
  const res = await request(app).get('/api/v1/posts/a-post');
  assert.equal(res.status, 200);
  assert.match(res.body.data.content, /<p>Body<\/p>/);
  assert.doesNotMatch(res.body.data.content, /script/);
});

test('premium posts: guests and free users are blocked without content, trial users and admins read them', async () => {
  rows.posts = [post({ is_premium: true, content_html: '<p>Secret body</p>' })];
  try {
    const guest = await request(app).get('/api/v1/posts/a-post');
    assert.deepEqual([guest.status, guest.body.error.code], [403, 'PREMIUM_REQUIRED']);
    assert.equal(JSON.stringify(guest.body).includes('Secret body'), false);
    assert.equal((await request(app).get('/api/v1/posts/a-post').set(as(U.free))).status, 403);
    assert.equal((await request(app).get('/api/v1/posts/a-post').set(as(U.trial))).status, 200);
    assert.equal((await request(app).get('/api/v1/posts/a-post').set(as(U.admin))).status, 200);
    assert.equal((await request(app).get('/api/v1/posts/a-post').set('Authorization', 'Bearer garbage')).status, 401);
    assert.equal((await request(app).get('/api/v1/posts/a-post').set('X-Is-Premium', 'true')).status, 403);
  } finally { rows.posts = [post()]; }
});

test('register validates input and gives the same answer for any address', async () => {
  assert.equal((await request(app).post('/api/v1/auth/register').send({ email: 'bad', password: 'longenough1' })).status, 422);
  assert.equal((await request(app).post('/api/v1/auth/register').send({ email: 'a@b.co', password: 'short' })).status, 422);
  const ok = await request(app).post('/api/v1/auth/register').send({ email: 'new@b.co', password: 'longenough1', display_name: 'New' });
  assert.equal(ok.status, 201);
  assert.equal(ok.headers['cache-control'], 'no-store');
  const signup = sent.find((c) => c.auth === '/signup');
  assert.equal(JSON.parse(signup.body).data.display_name, 'New');
});

test('login: success returns a session and computed access; bad credentials return 401', async () => {
  const ok = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'correct-password' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.session.access_token, `tok-${U.free}`);
  assert.equal(ok.body.data.user.role, 'free_user');
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'wrong' })).body.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co' })).status, 422);
});

test('me requires a valid token and ignores forged role claims', async () => {
  assert.equal((await request(app).get('/api/v1/auth/me')).status, 401);
  const res = await request(app).get('/api/v1/auth/me').set(as(U.free)).set('X-Role', 'admin');
  assert.equal(res.body.data.role, 'free_user');
  assert.equal((await request(app).get('/api/v1/auth/me').set(as(U.trial))).body.data.access.source, 'trial');
  const patched = await request(app).patch('/api/v1/auth/me').set(as(U.free)).send({ display_name: 'Eli', role: 'admin' });
  assert.equal(patched.status, 200);
  const patch = sent.filter((c) => c.table === 'profiles' && c.method === 'PATCH').at(-1);
  assert.equal('role' in JSON.parse(patch.body), false);
});

test('forgot-password never reveals whether an address exists; reset needs a token', async () => {
  assert.equal((await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@b.co' })).status, 200);
  assert.equal((await request(app).post('/api/v1/auth/reset-password').send({ password: 'newpassword1' })).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/reset-password').set(as(U.free)).send({ password: 'x' })).status, 422);
  assert.equal((await request(app).post('/api/v1/auth/reset-password').set(as(U.free)).send({ password: 'newpassword1' })).status, 200);
});

test('rate limiter blocks with 429 once the shared counter says so', async () => {
  rateAllowed = false;
  try {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'correct-password' });
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
  } finally { rateAllowed = true; }
});

test('newsletter and contact validate and store through Supabase', async () => {
  assert.equal((await request(app).post('/api/v1/newsletter/subscribe').send({ email: 'nope' })).status, 400);
  assert.equal((await request(app).post('/api/v1/newsletter/subscribe').send({ email: 'reader@example.com' })).status, 202);
  assert.ok(sent.some((c) => c.table === 'subscribers' && c.method === 'POST'));
  assert.ok(sent.some((c) => c.mail && c.mail.messages[0].to[0] === 'reader@example.com'));
  assert.equal((await request(app).post('/api/v1/contact').send({ name: 'A' })).status, 400);
  const ok = await request(app).post('/api/v1/contact').send({ name: 'Ann', email: 'ann@example.com', subject: 'Hi', message: 'Hello there' });
  assert.equal(ok.body.data.id, 'm1');
});

test('unknown API routes return JSON 404, and CORS is closed to unlisted origins', async () => {
  const res = await request(app).get('/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  const cors = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
  assert.equal(cors.headers['access-control-allow-origin'], undefined);
});

test('malformed JSON is a 400 and errors never expose internals', async () => {
  const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad');
  assert.equal(res.status, 400);
  assert.equal(JSON.stringify(res.body).includes('SyntaxError'), false);
});

// ---- Admin API ----
test('admin API: guests get 401, non-admins 403, forged body claims do nothing', async () => {
  assert.equal((await request(app).get('/api/v1/admin/posts')).status, 401);
  assert.equal((await request(app).get('/api/v1/admin/posts').set('Authorization', 'Bearer garbage')).status, 401);
  assert.equal((await request(app).get('/api/v1/admin/posts').set(as(U.free))).status, 403);
  assert.equal((await request(app).get('/api/v1/admin/posts').set(as(U.trial))).status, 403);
  const forged = await request(app).post('/api/v1/admin/categories').set(as(U.free)).send({ name: 'Hack', isAdmin: true, role: 'admin' });
  assert.equal(forged.status, 403);
  assert.equal(sent.some((c) => c.table === 'categories' && c.method === 'POST'), false);
  assert.equal((await request(app).put('/api/v1/admin/settings/homepage').set(as(U.free)).send({})).status, 403);
  assert.equal((await request(app).post('/api/v1/admin/media').set(as(U.free)).set('Content-Type', 'image/png').send(Buffer.from([0x89]))).status, 403);
  assert.equal((await request(app).patch(`/api/v1/admin/users/${U.free}/role`).set(as(U.free)).send({ role: 'admin' })).status, 403);
});

test('admin API: an admin can list, create (validated + audited) and gets structured validation errors', async () => {
  assert.equal((await request(app).get('/api/v1/admin/categories').set(as(U.admin))).status, 200);
  const bad = await request(app).post('/api/v1/admin/categories').set(as(U.admin)).send({ name: '' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.ok(bad.body.error.details.fields.name);
  assert.equal((await request(app).get('/api/v1/admin/nonsense').set(as(U.admin))).status, 404);
  assert.equal((await request(app).get('/api/v1/admin/__proto__').set(as(U.admin))).status, 404);
});

test('admin API: oversized JSON is accepted up to 4 MB for articles, but the public API keeps its 100 KB limit', async () => {
  const big = '<p>' + 'word '.repeat(60000) + '</p>'; // ~300 KB
  assert.notEqual((await request(app).post('/api/v1/admin/guides').set(as(U.admin)).send({ title: 'Guide', content_html: big })).status, 413);
  assert.equal((await request(app).post('/api/v1/contact').send({ name: 'A', email: 'a@b.co', subject: 'S', message: 'x'.repeat(200000) })).status, 413);
});

test('admin API: media upload rejects fake images and wrong types', async () => {
  const fake = await request(app).post('/api/v1/admin/media').set(as(U.admin)).set('Content-Type', 'image/png').send(Buffer.from('<svg onload=alert(1)>'));
  assert.equal(fake.status, 415);
  const wrongType = await request(app).post('/api/v1/admin/media').set(as(U.admin)).set('Content-Type', 'application/x-msdownload').send(Buffer.from('MZ'));
  assert.ok([415, 422].includes(wrongType.status));
});

test('admin API: users cannot change their own role', async () => {
  assert.equal((await request(app).patch(`/api/v1/admin/users/${U.admin}/role`).set(as(U.admin)).send({ role: 'free_user' })).status, 409);
});

test('posts API exposes the live installation guide, never the raw guide row', async () => {
  rows.posts = [post({ installation_guides: { title: 'Install', content_html: '<ol><li>Step</li></ol><script>x()</script>', enabled: true } })];
  try {
    const res = await request(app).get('/api/v1/posts/a-post');
    assert.equal(res.body.data.installation_guide.title, 'Install');
    assert.doesNotMatch(res.body.data.installation_guide.content, /script/);
    assert.equal('installation_guides' in res.body.data, false);
  } finally { rows.posts = [post()]; }
  rows.posts = [post({ installation_guides: { title: 'Off', content_html: '<p>x</p>', enabled: false } })];
  try { assert.equal((await request(app).get('/api/v1/posts/a-post')).body.data.installation_guide, undefined); } finally { rows.posts = [post()]; }
});

test('newsletter verify and unsubscribe reject malformed tokens with 400 (no database lookup)', async () => {
  const before = sent.length;
  assert.equal((await request(app).post('/api/v1/newsletter/verify').send({ token: 'nope' })).status, 400);
  assert.equal((await request(app).post('/api/v1/newsletter/unsubscribe').send({ token: "x' or '1'='1" })).status, 400);
  assert.equal(sent.length, before);
});

test('admin inbox, subscribers and newsletters are admin-only', async () => {
  for (const [method, path] of [['get', '/messages'], ['get', '/subscribers'], ['get', '/subscribers/export'], ['get', '/newsletter/campaigns'], ['get', '/email-events'], ['post', `/messages/${U.free}/reply`], ['post', `/newsletter/campaigns/${U.free}/send-batch`]]) {
    assert.equal((await request(app)[method](`/api/v1/admin${path}`)).status, 401, `${path} guest`);
    assert.equal((await request(app)[method](`/api/v1/admin${path}`).set(as(U.free))).status, 403, `${path} free user`);
  }
});

test('auth email hook rejects unsigned and wrongly signed requests', async () => {
  const body = JSON.stringify({ user: { email: 'u@x.co' }, email_data: { email_action_type: 'signup', token_hash: 'h' } });
  assert.equal((await request(app).post('/api/v1/hooks/auth-email').set('Content-Type', 'application/json').send(body)).status, 401);
  const bad = await request(app).post('/api/v1/hooks/auth-email').set('Content-Type', 'application/json').set({ 'webhook-id': 'm1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' }).send(body);
  assert.equal(bad.status, 401);
});

// ---- Payments ----
test('payment endpoints require sign-in; plans and providers are public; PesaPal and PayPal are the only providers', async () => {
  for (const [method, path] of [['post', '/payments/checkout'], ['get', '/payments/mine'], ['post', `/payments/${U.free}/confirm`], ['post', `/payments/${U.free}/cancel`], ['get', '/subscriptions/me']]) {
    assert.equal((await request(app)[method](`/api/v1${path}`)).status, 401, path);
  }
  assert.equal((await request(app).get('/api/v1/payments/plans')).status, 200);
  const providers = (await request(app).get('/api/v1/payments/providers')).body.data;
  assert.deepEqual(providers.map((p) => p.name), ['pesapal', 'paypal']);
  const pesapal = providers.find((p) => p.name === 'pesapal');
  assert.deepEqual([pesapal.label, pesapal.available, pesapal.currency], ['PesaPal', false, 'KES']); // no credentials in the test environment
  assert.equal(providers.some((p) => /equity/i.test(p.name + p.label)), false);
});

test('checkout ignores client-supplied prices and refuses unavailable or unknown providers', async () => {
  const res = await request(app).post('/api/v1/payments/checkout').set(as(U.free)).send({ plan: 'monthly', provider: 'pesapal', amount: '0.01' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal((await request(app).post('/api/v1/payments/checkout').set(as(U.free)).send({ plan: 'monthly', provider: 'equity' })).status, 422); // Equity is gone
  assert.equal((await request(app).post('/api/v1/payments/checkout').set(as(U.free)).send({ plan: 'monthly', provider: 'bitcoin' })).status, 422);
  assert.equal(sent.some((c) => c.table === 'payments' && c.method === 'POST'), false);
});

test('PesaPal IPN, callback and cancel routes: bad input is rejected, the browser is only redirected, nothing is granted', async () => {
  const ipn = await request(app).post('/api/v1/payments/pesapal/ipn').set('Content-Type', 'application/json').send({ OrderNotificationType: 'IPNCHANGE' });
  assert.equal(ipn.status, 400);
  assert.equal((await request(app).get('/api/v1/payments/pesapal/ipn').query({ OrderTrackingId: 'x', OrderMerchantReference: 'ET-1' })).status, 400);
  const cb = await request(app).get('/api/v1/payments/pesapal/callback').redirects(0);
  assert.deepEqual([cb.status, cb.headers.location], [302, '/premium']);
  const cancel = await request(app).get('/api/v1/payments/pesapal/cancel').query({ payment: 'not-a-uuid' }).redirects(0);
  assert.deepEqual([cancel.status, cancel.headers.location], [302, '/premium']);
  const ok = await request(app).get('/api/v1/payments/pesapal/cancel').query({ payment: U.free }).redirects(0);
  assert.equal(ok.headers.location, `/payment/cancel?payment=${U.free}`);
  assert.equal(sent.some((c) => c.table === 'subscriptions' && c.method !== 'GET'), false);
});

test('PayPal webhook route rejects unsigned calls and never grants access', async () => {
  const before = sent.length;
  const res = await request(app).post('/api/v1/payments/webhooks/paypal').set('Content-Type', 'application/json').send(JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
  assert.ok([401, 503].includes(res.status));
  assert.equal(sent.slice(before).some((c) => c.table === 'subscriptions'), false);
});

test('admin billing and plans are admin-only', async () => {
  for (const [method, path] of [['get', '/payments'], ['get', '/subscriptions'], ['post', '/subscriptions/grant'], ['get', '/plans'], ['post', '/plans']]) {
    assert.equal((await request(app)[method](`/api/v1/admin${path}`)).status, 401, `${path} guest`);
    assert.equal((await request(app)[method](`/api/v1/admin${path}`).set(as(U.free))).status, 403, `${path} free user`);
  }
});
