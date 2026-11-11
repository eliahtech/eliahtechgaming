// PesaPal provider + payment-service tests. PesaPal is mocked (no network); the mock follows the official API 3.0 shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPesaPalProvider, newMerchantReference, normalizeStatus, pesapalConfig, PESAPAL_BASES, MERCHANT_REFERENCE_RE } from '../src/payments/pesapal.js';
import { createProviders } from '../src/payments/providers.js';
import { createPaymentService, buildBilling } from '../src/payments/service.js';
import { createBillingAdmin } from '../src/admin/billing.js';

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const user = { id: UID, email: 'jane@example.com', emailVerified: true, profile: { display_name: 'Jane Wanjiru Doe' } };
const IPN_ID = 'fe078e53-78da-4a83-aa89-e7ded5c456e6';
const TRACK = 'b945e4af-80a5-4ec1-8706-e03f8332fb04';
const PS_ENV = { PESAPAL_CONSUMER_KEY: 'ck-secret-key', PESAPAL_CONSUMER_SECRET: 'cs-secret-value', PESAPAL_ENV: 'sandbox', PESAPAL_IPN_ID: IPN_ID, PESAPAL_CURRENCY: 'KES', APP_URL: 'https://app.example' };
const BASE = '/pesapalv3/api';

// Mock PesaPal. `handler(pathname, init, url)` answers everything except the token call (unless `token` overrides it).
function harness(handler, { env = PS_ENV, token, clock = { t: 1_000_000 } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, search: u.search, method: init.method, headers: init.headers, body: init.body });
    if (u.pathname === `${BASE}/Auth/RequestToken`) {
      const r = token ? token(calls) : { body: { token: 'BEARER-TOKEN', expiryDate: new Date(clock.t + 5 * 60_000).toISOString(), error: null, status: '200' } };
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
    }
    const r = handler(u.pathname, init, u) ?? {};
    if (r.throws) throw new Error('network down');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => { if (r.badJson) throw new Error('bad json'); return r.body ?? null; } };
  };
  return { ps: createPesaPalProvider({ env, fetchImpl, now: () => clock.t }), calls, clock };
}
const orderResponse = (over = {}) => ({ status: 200, body: { order_tracking_id: TRACK, merchant_reference: 'WILL-BE-SET', redirect_url: `https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index/?OrderTrackingId=${TRACK}`, error: null, status: '200', ...over } });
const txBody = (over = {}) => ({ payment_method: 'Visa', amount: 499, created_date: '2026-10-06T07:41:09', confirmation_code: 'CONF123', payment_status_description: 'Completed', status_code: 1, merchant_reference: 'REF', currency: 'KES', error: { error_type: null, code: null, message: null }, status: '200', ...over });

// ---------- configuration ----------
test('config: one source for environment URLs; the base must be an official host that agrees with PESAPAL_ENV', () => {
  assert.equal(pesapalConfig({ PESAPAL_ENV: 'sandbox' }).base, 'https://cybqa.pesapal.com/pesapalv3/api');
  assert.equal(pesapalConfig({ PESAPAL_ENV: 'live' }).base, 'https://pay.pesapal.com/v3/api');
  assert.equal(pesapalConfig({}).environment, 'sandbox');
  assert.equal(pesapalConfig({ PESAPAL_ENV: 'live', PESAPAL_BASE_URL: PESAPAL_BASES.sandbox }).ok, false);
  assert.equal(pesapalConfig({ PESAPAL_ENV: 'sandbox', PESAPAL_BASE_URL: 'https://evil.example' }).ok, false);
  assert.equal(pesapalConfig({ PESAPAL_ENV: 'staging' }).ok, false);
  const avail = (env) => createPesaPalProvider({ env }).available();
  assert.equal(avail(PS_ENV), true);
  assert.equal(avail({ ...PS_ENV, PESAPAL_CONSUMER_SECRET: '' }), false);
  assert.equal(avail({ ...PS_ENV, PESAPAL_IPN_ID: '' }), false); // IPN not registered yet
  assert.equal(avail({ ...PS_ENV, PESAPAL_IPN_ID: 'not-a-guid' }), false);
  assert.equal(avail({ ...PS_ENV, APP_URL: 'http://insecure.example' }), false);
  assert.match(createPesaPalProvider({ env: { ...PS_ENV, PESAPAL_IPN_ID: '' } }).unavailableReason(), /IPN/);
});

test('the provider list is exactly PesaPal and PayPal', () => {
  assert.deepEqual(Object.keys(createProviders({ env: {} })), ['pesapal', 'paypal']);
});

// ---------- authentication ----------
test('token: requested with the consumer key/secret, sent as a Bearer token, cached, refreshed after it expires', async () => {
  const { ps, calls, clock } = harness(() => ({ body: txBody() }));
  await ps.getTransactionStatus(TRACK); await ps.getTransactionStatus(TRACK);
  const tokenCalls = calls.filter((c) => c.path === `${BASE}/Auth/RequestToken`);
  assert.equal(tokenCalls.length, 1);
  assert.deepEqual(JSON.parse(tokenCalls[0].body), { consumer_key: 'ck-secret-key', consumer_secret: 'cs-secret-value' });
  assert.equal(tokenCalls[0].method, 'POST');
  assert.equal(calls.find((c) => c.path.includes('GetTransactionStatus')).headers.Authorization, 'Bearer BEARER-TOKEN');
  clock.t += 6 * 60_000; // token lifetime is at most 5 minutes
  await ps.getTransactionStatus(TRACK);
  assert.equal(calls.filter((c) => c.path === `${BASE}/Auth/RequestToken`).length, 2);
});

test('token: concurrent callers share one authentication request', async () => {
  const { ps, calls } = harness(() => ({ body: txBody() }));
  await Promise.all([ps.getTransactionStatus(TRACK), ps.getTransactionStatus(TRACK), ps.getTransactionStatus(TRACK)]);
  assert.equal(calls.filter((c) => c.path === `${BASE}/Auth/RequestToken`).length, 1);
});

test('token: a longer expiryDate than 5 minutes is not trusted', async () => {
  const clock = { t: 1_000_000 };
  const { ps, calls } = harness(() => ({ body: txBody() }), { clock, token: () => ({ body: { token: 'T', expiryDate: new Date(clock.t + 24 * 3600_000).toISOString(), error: null, status: '200' } }) });
  await ps.getTransactionStatus(TRACK);
  clock.t += 5 * 60_000;
  await ps.getTransactionStatus(TRACK);
  assert.equal(calls.filter((c) => c.path === `${BASE}/Auth/RequestToken`).length, 2);
});

test('token: invalid credentials fail safely (502) and nothing secret is logged', async () => {
  const lines = []; const log = console.error; console.error = (l) => lines.push(l);
  try {
    const { ps } = harness(() => ({}), { token: () => ({ status: 401, body: { error: { error_type: 'authentication_error', code: 'invalid_consumer_key_or_secret_provided', message: 'x' } } }) });
    await assert.rejects(() => ps.getTransactionStatus(TRACK), (e) => e.status === 502 && e.code === 'PAYMENT_PROVIDER_ERROR');
  } finally { console.error = log; }
  const text = lines.join('\n');
  assert.equal(/ck-secret-key|cs-secret-value|BEARER/.test(text), false);
  assert.match(text, /pesapal_auth_failed/);
});

test('token: a token rejected mid-flight (401) is refreshed once and the call retried', async () => {
  let n = 0;
  const { ps, calls } = harness(() => (++n === 1 ? { status: 401, body: null } : { body: txBody() }));
  assert.equal((await ps.getTransactionStatus(TRACK)).status, 'completed');
  assert.equal(calls.filter((c) => c.path === `${BASE}/Auth/RequestToken`).length, 2);
});

test('unconfigured PesaPal never calls the network', async () => {
  const { ps, calls } = harness(() => { throw new Error('must not be called'); }, { env: {} });
  await assert.rejects(() => ps.getTransactionStatus(TRACK), (e) => e.status === 503);
  assert.equal(calls.length, 0);
});

// ---------- IPN registration ----------
test('registerIpn: POSTs url + ipn_notification_type and returns the ipn_id; rejects non-https and bad methods', async () => {
  const { ps, calls } = harness(() => ({ body: { url: 'https://app.example/api/v1/payments/pesapal/ipn', created_date: 'x', ipn_id: IPN_ID, notification_type: 1, ipn_notification_type_description: 'POST', ipn_status: 1, ipn_status_description: 'Active', error: null, status: '200' } }));
  const out = await ps.registerIpn({ url: 'https://app.example/api/v1/payments/pesapal/ipn' });
  assert.deepEqual([out.ipnId, out.method, out.status], [IPN_ID, 'POST', 'Active']);
  const call = calls.find((c) => c.path === `${BASE}/URLSetup/RegisterIPN`);
  assert.deepEqual(JSON.parse(call.body), { url: 'https://app.example/api/v1/payments/pesapal/ipn', ipn_notification_type: 'POST' });
  await assert.rejects(() => ps.registerIpn({ url: 'http://app.example/ipn' }), (e) => e.status === 422);
  await assert.rejects(() => ps.registerIpn({ url: 'https://app.example/ipn', method: 'PUT' }), (e) => e.status === 422);
  const bad = harness(() => ({ body: { ipn_id: 'nope', error: null } }));
  await quiet(() => assert.rejects(() => bad.ps.registerIpn({ url: 'https://app.example/ipn' }), (e) => e.status === 502));
});

// ---------- merchant reference ----------
test('merchant references are unique, PesaPal-safe and at most 50 characters', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) { const r = newMerchantReference(new Date('2026-10-06T12:00:00Z')); assert.match(r, /^ET-20261006-[A-Z2-9]{10}$/); assert.ok(MERCHANT_REFERENCE_RE.test(r) && r.length <= 50); seen.add(r); }
  assert.equal(seen.size, 2000);
});

// ---------- submit order ----------
const order = (over = {}) => ({ paymentId: 'PAY1', merchantReference: 'ET-20261006-ABCDEFGHJK', amount: '499.00', description: 'Eliah Tech Premium - Monthly', billing: { email_address: 'jane@example.com' }, ...over });

test('createOrder: documented request fields, server config for currency/callback/IPN, tracking id and redirect returned', async () => {
  const { ps, calls } = harness(() => orderResponse({ merchant_reference: 'ET-20261006-ABCDEFGHJK' }));
  const out = await ps.createOrder(order());
  assert.deepEqual(out, { orderId: TRACK, approvalUrl: `https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index/?OrderTrackingId=${TRACK}` });
  const call = calls.find((c) => c.path === `${BASE}/Transactions/SubmitOrderRequest`);
  const body = JSON.parse(call.body);
  assert.deepEqual(body, { id: 'ET-20261006-ABCDEFGHJK', currency: 'KES', amount: 499, description: 'Eliah Tech Premium - Monthly', callback_url: 'https://app.example/api/v1/payments/pesapal/callback', notification_id: IPN_ID, billing_address: { email_address: 'jane@example.com' }, cancellation_url: 'https://app.example/api/v1/payments/pesapal/cancel?payment=PAY1' });
  assert.equal(call.method, 'POST');
});

test('createOrder: provider errors, timeouts, malformed and unsafe responses all fail with 502 and no redirect', async () => {
  const ref = 'ET-20261006-ABCDEFGHJK';
  const cases = {
    'provider error object': () => ({ status: 200, body: { order_tracking_id: null, error: { error_type: 'invalid_request', code: 'bad', message: 'nope' }, status: '500' } }),
    'http 500': () => ({ status: 500, body: { error: { code: 'x' } } }),
    'timeout / network': () => ({ throws: true }),
    'invalid json': () => ({ badJson: true }),
    'missing redirect url': () => orderResponse({ merchant_reference: ref, redirect_url: undefined }),
    'redirect to another host': () => orderResponse({ merchant_reference: ref, redirect_url: 'https://evil.example/pay' }),
    'lookalike host': () => orderResponse({ merchant_reference: ref, redirect_url: 'https://pesapal.com.evil.example/pay' }),
    'http redirect': () => orderResponse({ merchant_reference: ref, redirect_url: 'http://pay.pesapal.com/x' }),
    'missing tracking id': () => orderResponse({ merchant_reference: ref, order_tracking_id: undefined }),
    'merchant reference mismatch': () => orderResponse({ merchant_reference: 'SOMETHING-ELSE' }),
  };
  for (const [name, handler] of Object.entries(cases)) {
    const { ps } = harness(handler);
    await quiet(() => assert.rejects(() => ps.createOrder(order()), (e) => e.status === 502 && e.code === 'PAYMENT_PROVIDER_ERROR', name));
  }
  const { ps } = harness(() => ({}));
  await assert.rejects(() => ps.createOrder(order({ merchantReference: 'has space/#' })), (e) => e.status === 500);
});

// ---------- transaction status ----------
test('status mapping follows the documented values; unknown or contradictory values are never "completed"', () => {
  assert.equal(normalizeStatus(1, 'Completed'), 'completed');
  assert.equal(normalizeStatus('1', 'COMPLETED'), 'completed');
  assert.equal(normalizeStatus(2, 'Failed'), 'failed');
  assert.equal(normalizeStatus(3, 'Reversed'), 'reversed');
  assert.equal(normalizeStatus(0, 'Invalid'), 'pending');
  assert.equal(normalizeStatus(undefined, 'COMPLETED'), 'completed');
  assert.equal(normalizeStatus(1, undefined), 'completed');
  for (const [code, text] of [[1, 'Failed'], [2, 'Completed'], [9, 'Completed'], [undefined, undefined], ['', ''], [1, 'SUCCESS'], [null, 'PAID'], [7, 'Whatever']]) {
    assert.notEqual(normalizeStatus(code, text), 'completed', `${code}/${text}`);
  }
  assert.equal(normalizeStatus(1, 'Failed'), 'unknown');
});

test('getTransactionStatus: GET with orderTrackingId, returns a normalized result; bad ids never reach PesaPal', async () => {
  const { ps, calls } = harness(() => ({ body: txBody({ merchant_reference: 'ET-X', amount: 499.5, currency: 'kes' }) }));
  const tx = await ps.getTransactionStatus(TRACK);
  assert.deepEqual([tx.status, tx.merchantReference, tx.amount, tx.currency, tx.paymentMethod, tx.confirmationCode], ['completed', 'ET-X', 499.5, 'KES', 'Visa', 'CONF123']);
  const call = calls.find((c) => c.path.includes('GetTransactionStatus'));
  assert.deepEqual([call.method, call.search], ['GET', `?orderTrackingId=${TRACK}`]);
  const n = calls.length;
  for (const bad of ['', undefined, 'x', `${TRACK}&x=1`, '../../etc']) await assert.rejects(() => ps.getTransactionStatus(bad), (e) => e.status === 422);
  assert.equal(calls.length, n);
  const unknown = harness(() => ({ body: txBody({ payment_status_description: 'WEIRD', status_code: 9 }) }));
  assert.equal(await quiet(() => unknown.ps.getTransactionStatus(TRACK)).then((t) => t.status), 'unknown');
});

// ---------- payment service with a mocked PesaPal ----------
function memDb(seed = {}) {
  const t = {
    payments: [], payment_events: [], subscriptions: [], audit_logs: [],
    settings: [{ key: 'premium', value: { status: 'available' } }],
    premium_plans: [{ id: randomUUID(), code: 'monthly', name: 'Monthly', duration_days: 30, prices: { USD: '4.99', KES: '499.00' }, enabled: true }],
    ...seed,
  };
  const match = (row, q) => Object.entries(q).every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k) || typeof v !== 'string') return true;
    if (v === 'is.null') return row[k] === null || row[k] === undefined;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    return true;
  });
  const first = (id) => t.payments.find((r) => r.id === id);
  return {
    t,
    select: async (table, q) => t[table].filter((r) => match(r, q)).slice(0, Number(q.limit) || 1e9),
    insert: async (table, row) => {
      const rows = (Array.isArray(row) ? row : [row]).map((r) => ({ id: randomUUID(), ...r }));
      if (table === 'payment_events' && t.payment_events.some((e) => e.provider === rows[0].provider && e.event_id === rows[0].event_id)) return [];
      if (table === 'payments' && rows[0].merchant_reference && t.payments.some((p) => p.merchant_reference === rows[0].merchant_reference)) throw Object.assign(new Error('dup'), { detail: { code: '23505' } });
      t[table].push(...rows); return rows;
    },
    update: async (table, q, v) => { const rows = t[table].filter((r) => match(r, q)); rows.forEach((r) => Object.assign(r, v)); return rows; },
    rpc: async (name, a) => {
      const p = first(a.p_payment_id);
      if (!p) throw new Error('payment not found');
      if (name === 'payment_complete') {
        if (['completed', 'refunded'].includes(p.status)) return [{ out_payment_id: p.id, out_status: p.status, out_newly_completed: false, out_expires_at: null }];
        const end = new Date(Date.now() + p.metadata.duration_days * 86400000).toISOString();
        Object.assign(p, { status: 'completed', transaction_id: a.p_transaction_id, completed_at: new Date().toISOString(), metadata: { ...p.metadata, ...a.p_metadata } });
        t.subscriptions.push({ id: randomUUID(), user_id: p.user_id, payment_id: p.id, status: 'active', expires_at: end, payment_provider: p.provider });
        return [{ out_payment_id: p.id, out_status: 'completed', out_newly_completed: true, out_expires_at: end }];
      }
      if (name === 'payment_fail') { if (p.status !== 'pending') return [{ out_status: p.status, out_changed: false }]; p.status = a.p_status; p.failure_reason = a.p_reason; return [{ out_status: a.p_status, out_changed: true }]; }
      if (name === 'payment_refund') { if (p.status !== 'completed') return [{ out_status: p.status, out_changed: false }]; p.status = 'refunded'; t.subscriptions.filter((s) => s.payment_id === p.id).forEach((s) => { s.status = 'cancelled'; }); return [{ out_status: 'refunded', out_changed: true }]; }
      throw new Error(`unknown rpc ${name}`);
    },
  };
}

// A mocked PesaPal whose transaction status can be changed per test: ctx.tx = { ...fields of GetTransactionStatus }.
function setup({ seed, notifier } = {}) {
  const db = memDb(seed);
  const ctx = { tx: null, statusCalls: 0, orderBody: null, orderStatus: 200 };
  const { ps, calls } = harness((p, init, u) => {
    if (p.endsWith('/Transactions/SubmitOrderRequest')) {
      ctx.orderBody = JSON.parse(init.body);
      return ctx.orderStatus >= 400 ? { status: ctx.orderStatus, body: { error: { code: 'x' } } } : orderResponse({ merchant_reference: ctx.orderBody.id });
    }
    if (p.endsWith('/Transactions/GetTransactionStatus')) {
      ctx.statusCalls += 1;
      if (ctx.tx instanceof Error) throw ctx.tx;
      const pay = db.t.payments[0];
      return { body: ctx.tx === null ? txBody({ merchant_reference: pay?.merchant_reference, payment_status_description: 'Invalid', status_code: 0 }) : { ...txBody({ merchant_reference: pay?.merchant_reference }), ...ctx.tx } };
    }
    return {};
  });
  const events = { succeeded: [], failed: [], initiated: [] };
  const n = notifier ?? { initiated: async (p) => events.initiated.push(p.id), succeeded: async (p, exp) => events.succeeded.push([p.id, exp]), failed: async (p) => events.failed.push(p.id) };
  const svc = createPaymentService({ db, providers: { pesapal: ps }, appUrl: 'https://app.example', notifier: n });
  return { db, ps, svc, ctx, calls, events };
}
const buy = (svc, extra = {}) => svc.checkout({ user, planCode: 'monthly', providerName: 'pesapal', ...extra });
const ipn = (svc, over = {}, params = {}) => svc.handlePesaPalIpn({ params: { OrderTrackingId: TRACK, OrderMerchantReference: over.ref, OrderNotificationType: 'IPNCHANGE', ...params } });
async function started(opts) {
  const c = setup(opts);
  const out = await buy(c.svc);
  const payment = c.db.t.payments[0];
  return { ...c, out, payment, ref: payment.merchant_reference };
}

test('checkout: amount, currency and duration come from the database; reference and tracking id are stored; the customer gets the PesaPal URL', async () => {
  const { db, ctx, out, payment, events } = await started();
  assert.deepEqual([payment.amount, payment.currency, payment.status, payment.provider, payment.user_id], ['499.00', 'KES', 'pending', 'pesapal', UID]);
  assert.match(payment.merchant_reference, /^ET-\d{8}-[A-Z2-9]{10}$/);
  assert.equal(payment.provider_order_id, TRACK);
  assert.equal(ctx.orderBody.id, payment.merchant_reference);
  assert.equal(ctx.orderBody.amount, 499);
  assert.deepEqual(out, { payment_id: payment.id, provider: 'pesapal', approval_url: `https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index/?OrderTrackingId=${TRACK}` });
  assert.deepEqual(events.initiated, [payment.id]);
  assert.ok(db.t.audit_logs.some((a) => a.action === 'pesapal.order_created'));
  assert.equal(db.t.subscriptions.length, 0);
});

test('checkout: the browser cannot choose amount, currency, user or premium state', async () => {
  const c = setup();
  await buy(c.svc, { amount: '0.01', currency: 'USD', userId: OTHER, isPremium: true, duration_days: 9999 });
  const p = c.db.t.payments[0];
  assert.deepEqual([p.amount, p.currency, p.user_id, p.metadata.duration_days], ['499.00', 'KES', UID, 30]);
  assert.equal(c.ctx.orderBody.amount, 499);
  assert.equal(c.db.t.subscriptions.length, 0);
});

test('checkout: guards (verified email, open sales, plan, KES price, billing input) create nothing', async () => {
  const c = setup();
  await assert.rejects(() => c.svc.checkout({ user: { ...user, emailVerified: false }, planCode: 'monthly', providerName: 'pesapal' }), (e) => e.status === 403);
  await assert.rejects(() => buy(c.svc, { planCode: 'nope' }), (e) => e.status === 404);
  await assert.rejects(() => buy(c.svc, { contact: { phone_number: 'call me maybe' } }), (e) => e.status === 422);
  await assert.rejects(() => buy(c.svc, { contact: { country_code: 'Kenya' } }), (e) => e.status === 422);
  await assert.rejects(() => c.svc.checkout({ user: { ...user, email: '' }, planCode: 'monthly', providerName: 'pesapal' }), (e) => e.status === 422);
  c.db.t.premium_plans[0].prices = { USD: '4.99' };
  await assert.rejects(() => buy(c.svc), (e) => e.code === 'PLAN_NOT_AVAILABLE');
  assert.equal(c.db.t.payments.length, 0);
});

test('billing address: only needed, validated fields; names split from the display name; nothing else invented', () => {
  assert.deepEqual(buildBilling(user, {}), { email_address: 'jane@example.com', first_name: 'Jane', last_name: 'Wanjiru Doe' });
  assert.deepEqual(buildBilling({ ...user, profile: {} }, { phone_number: '+254 712 345 678', country_code: 'ke' }), { email_address: 'jane@example.com', phone_number: '+254 712 345 678', country_code: 'KE' });
  assert.throws(() => buildBilling(user, { phone_number: '<script>' }), (e) => e.status === 422);
});

test('checkout: a PesaPal failure marks the payment failed, grants nothing and surfaces a 502', async () => {
  const c = setup(); c.ctx.orderStatus = 500;
  await quiet(() => assert.rejects(() => buy(c.svc), (e) => e.status === 502));
  assert.equal(c.db.t.payments[0].status, 'failed');
  assert.equal(c.db.t.subscriptions.length, 0);
});

test('checkout: a merchant-reference collision draws another reference', async () => {
  const c = setup();
  const original = c.db.insert;
  let collided = false;
  c.db.insert = async (table, row, opts) => { if (table === 'payments' && !collided) { collided = true; c.db.t.payments.push({ id: randomUUID(), merchant_reference: row.merchant_reference }); throw Object.assign(new Error('dup'), { detail: { code: '23505' } }); } return original(table, row, opts); };
  await buy(c.svc);
  assert.equal(c.db.t.payments.length, 2);
});

// ---- IPN: the happy path and idempotency ----
test('IPN: a verified COMPLETED payment (amount, currency, reference match) completes the payment and activates the subscription once', async () => {
  const { svc, db, ref, ctx, events, payment } = await started();
  ctx.tx = {};
  const ack = await ipn(svc, { ref });
  assert.deepEqual(ack, { orderNotificationType: 'IPNCHANGE', orderTrackingId: TRACK, orderMerchantReference: ref, status: 200, duplicate: false, payment_status: 'completed' });
  assert.deepEqual([payment.status, db.t.subscriptions.length, db.t.subscriptions[0].user_id], ['completed', 1, UID]);
  assert.equal(payment.payment_method, 'Visa');
  assert.equal(payment.metadata.provider_reference, 'CONF123');
  assert.equal(events.succeeded.length, 1);
  for (const a of ['pesapal.ipn_received', 'pesapal.transaction_verified', 'payment.completed', 'subscription.activated']) assert.ok(db.t.audit_logs.some((l) => l.action === a), a);
  assert.equal(db.t.payment_events.length, 1);
  assert.deepEqual([db.t.payment_events[0].tracking_id, db.t.payment_events[0].merchant_reference, db.t.payment_events[0].processed], [TRACK, ref, true]);
});

test('IPN: duplicate and replayed notifications do not create a second subscription, extend premium or resend email', async () => {
  const { svc, db, ref, ctx, events } = await started();
  ctx.tx = {};
  await ipn(svc, { ref });
  const again = await ipn(svc, { ref });
  assert.equal(again.status, 200);
  await ipn(svc, { ref }); await svc.handlePesaPalCallback({ params: { OrderTrackingId: TRACK, OrderMerchantReference: ref, OrderNotificationType: 'CALLBACKURL' } });
  assert.equal(db.t.subscriptions.length, 1);
  assert.equal(events.succeeded.length, 1);
  assert.equal(db.t.payment_events.filter((e) => e.event_type === 'IPNCHANGE').length, 1);
});

test('IPN: concurrent deliveries still activate once', async () => {
  const { svc, db, ref, ctx, events } = await started();
  ctx.tx = {};
  await Promise.all([ipn(svc, { ref }), ipn(svc, { ref }), ipn(svc, { ref })]);
  assert.equal(db.t.subscriptions.length, 1);
  assert.equal(events.succeeded.length, 1);
});

test('IPN: the status always comes from GetTransactionStatus, never from the IPN parameters', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = null; // PesaPal says: not paid yet
  const out = await ipn(svc, { ref }, { status: 'COMPLETED', payment_status_description: 'Completed', status_code: '1', amount: '0.01' });
  assert.equal(out.payment_status, 'pending');
  assert.equal(ctx.statusCalls, 1);
  assert.deepEqual([payment.status, db.t.subscriptions.length], ['pending', 0]);
});

// ---- IPN: validation and security ----
test('IPN: malformed or unknown notifications are rejected before any provider call', async () => {
  const { svc, ctx, ref } = await started();
  const rejected = (params, status) => assert.rejects(() => svc.handlePesaPalIpn({ params }), (e) => e.status === status, JSON.stringify(params));
  await rejected({}, 400);
  await rejected({ OrderMerchantReference: ref }, 400);
  await rejected({ OrderTrackingId: TRACK }, 400);
  await rejected({ OrderTrackingId: 'not-a-guid', OrderMerchantReference: ref }, 400);
  await rejected({ OrderTrackingId: `${TRACK}' or 1=1`, OrderMerchantReference: ref }, 400);
  await rejected({ OrderTrackingId: TRACK, OrderMerchantReference: 'has space' }, 400);
  await rejected({ OrderTrackingId: TRACK, OrderMerchantReference: 'ET-20261006-NOSUCHREF1' }, 404);
  await rejected({ OrderTrackingId: TRACK, OrderMerchantReference: ['a', 'b'] }, 400);
  assert.equal(ctx.statusCalls, 0);
});

test('IPN: a tracking id that belongs to another payment is rejected and audited', async () => {
  const { svc, db, ref, ctx } = await started();
  ctx.tx = {};
  await assert.rejects(() => svc.handlePesaPalIpn({ params: { OrderTrackingId: randomUUID(), OrderMerchantReference: ref, OrderNotificationType: 'IPNCHANGE' } }), (e) => e.status === 400);
  assert.equal(db.t.subscriptions.length, 0);
  assert.ok(db.t.audit_logs.some((a) => a.action === 'pesapal.ipn_rejected'));
});

test('IPN: a PesaPal merchant_reference that differs from ours never completes the payment', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = { merchant_reference: 'ET-20261006-SOMEONEELSE' };
  await quiet(() => ipn(svc, { ref }));
  assert.equal(db.t.subscriptions.length, 0);
  assert.equal(payment.status, 'failed');
  assert.ok(db.t.audit_logs.some((a) => a.action === 'payment.mismatch' && a.metadata.reason === 'merchant_reference_mismatch'));
});

test('IPN: amount tampering (paid less than the plan price) never grants premium and is audited for review', async () => {
  for (const amount of [0.01, 498.99, 4.99]) {
    const { svc, db, ref, ctx, payment } = await started();
    ctx.tx = { amount };
    await quiet(() => ipn(svc, { ref }));
    assert.equal(db.t.subscriptions.length, 0, String(amount));
    assert.equal(payment.status, 'failed');
    assert.ok(db.t.audit_logs.some((a) => a.action === 'payment.mismatch' && a.metadata.reason === 'amount_mismatch'));
  }
});

test('IPN: currency tampering never grants premium', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = { currency: 'USD' };
  await quiet(() => ipn(svc, { ref }));
  assert.deepEqual([payment.status, db.t.subscriptions.length], ['failed', 0]);
  assert.ok(db.t.audit_logs.some((a) => a.metadata?.reason === 'currency_mismatch'));
});

test('IPN: user_id in the request is ignored; the user comes from the stored payment', async () => {
  const { svc, db, ref, ctx } = await started();
  ctx.tx = {};
  await ipn(svc, { ref }, { user_id: OTHER, userId: OTHER });
  assert.equal(db.t.subscriptions[0].user_id, UID);
});

test('IPN: pending, failed and unknown statuses grant nothing; unknown is logged as an unprocessed event', async () => {
  const pending = await started(); pending.ctx.tx = { payment_status_description: 'Invalid', status_code: 0 };
  assert.equal((await ipn(pending.svc, { ref: pending.ref })).payment_status, 'pending');
  assert.equal(pending.db.t.subscriptions.length, 0);

  const failed = await started(); failed.ctx.tx = { payment_status_description: 'Failed', status_code: 2 };
  assert.equal((await ipn(failed.svc, { ref: failed.ref })).payment_status, 'failed');
  assert.deepEqual([failed.db.t.subscriptions.length, failed.events.failed.length], [0, 1]);
  await ipn(failed.svc, { ref: failed.ref });
  assert.equal(failed.events.failed.length, 1); // no duplicate failure email

  const odd = await started(); odd.ctx.tx = { payment_status_description: 'PAID??', status_code: 42 };
  const out = await quiet(() => ipn(odd.svc, { ref: odd.ref }));
  assert.equal(out.payment_status, 'pending');
  assert.equal(odd.db.t.subscriptions.length, 0);
  assert.deepEqual([odd.db.t.payment_events[0].processed, odd.db.t.payment_events[0].error_message], [false, 'unknown_provider_status']);
});

test('IPN: if PesaPal cannot be queried the error propagates (so PesaPal retries) and nothing is recorded or granted', async () => {
  const { svc, db, ref, ctx } = await started();
  ctx.tx = new Error('network down');
  await quiet(() => assert.rejects(() => ipn(svc, { ref }), (e) => e.status === 502));
  assert.deepEqual([db.t.subscriptions.length, db.t.payment_events.length], [0, 0]);
});

test('IPN that arrives before our tracking id was stored: adopted only because PesaPal confirms our reference', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  payment.provider_order_id = null;
  ctx.tx = {};
  await ipn(svc, { ref });
  assert.deepEqual([payment.provider_order_id, payment.status], [TRACK, 'completed']);
  const second = await started(); second.payment.provider_order_id = null;
  second.ctx.tx = { merchant_reference: 'ET-20261006-SOMEONEELSE' };
  await assert.rejects(() => ipn(second.svc, { ref: second.ref }), (e) => e.status === 400);
  assert.equal(second.payment.provider_order_id, null);
  assert.equal(second.db.t.subscriptions.length, 0);
});

test('a failed attempt that is later paid on the same PesaPal order completes (verified), once', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = { payment_status_description: 'Failed', status_code: 2 };
  await ipn(svc, { ref });
  assert.equal(payment.status, 'failed');
  ctx.tx = {};
  await ipn(svc, { ref }); await ipn(svc, { ref });
  assert.deepEqual([payment.status, db.t.subscriptions.length], ['completed', 1]);
});

test('a REVERSED transaction ends access for a completed payment; a late FAILED never downgrades it', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = {}; await ipn(svc, { ref });
  ctx.tx = { payment_status_description: 'Failed', status_code: 2 }; await ipn(svc, { ref });
  assert.equal(payment.status, 'completed');
  ctx.tx = { payment_status_description: 'Reversed', status_code: 3 }; await ipn(svc, { ref });
  assert.deepEqual([payment.status, db.t.subscriptions[0].status], ['refunded', 'cancelled']);
  assert.ok(db.t.audit_logs.some((a) => a.action === 'payment.refunded'));
});

// ---- callback / cancel / confirm: the browser is never proof ----
test('callback: a fake success redirect cannot grant access; the browser is sent to our own page after PesaPal is asked', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = null; // PesaPal says unpaid
  const out = await svc.handlePesaPalCallback({ params: { OrderTrackingId: TRACK, OrderMerchantReference: ref, OrderNotificationType: 'CALLBACKURL', status: 'COMPLETED' } });
  assert.equal(out.redirectTo, `/payment/return?payment=${payment.id}`);
  assert.equal(ctx.statusCalls, 1);
  assert.deepEqual([payment.status, db.t.subscriptions.length], ['pending', 0]);
});

test('callback: when PesaPal confirms payment the callback completes it (IPN may be late); a later IPN does not double-grant', async () => {
  const { svc, db, ref, ctx, payment } = await started();
  ctx.tx = {};
  await svc.handlePesaPalCallback({ params: { OrderTrackingId: TRACK, OrderMerchantReference: ref, OrderNotificationType: 'CALLBACKURL' } });
  assert.equal(payment.status, 'completed');
  await ipn(svc, { ref });
  assert.equal(db.t.subscriptions.length, 1);
});

test('callback: unknown, malformed or failing requests never throw to the browser and redirect only to fixed paths', async () => {
  const { svc, ctx, ref, payment } = await started();
  for (const params of [{}, { OrderTrackingId: 'x', OrderMerchantReference: 'y z' }, { OrderTrackingId: TRACK, OrderMerchantReference: 'ET-20261006-NOSUCHREF1' }]) {
    assert.equal((await svc.handlePesaPalCallback({ params })).redirectTo, '/premium');
  }
  ctx.tx = new Error('network down');
  const out = await quiet(() => svc.handlePesaPalCallback({ params: { OrderTrackingId: TRACK, OrderMerchantReference: ref, OrderNotificationType: 'CALLBACKURL' } }));
  assert.equal(out.redirectTo, `/payment/return?payment=${payment.id}`);
});

test('cancel URL: not a payment failure by itself; only PesaPal\'s status can complete or fail the payment', async () => {
  const { svc, db, ctx, payment } = await started();
  assert.equal(svc.handlePesaPalCancel({ paymentId: payment.id }).redirectTo, `/payment/cancel?payment=${payment.id}`);
  assert.equal(svc.handlePesaPalCancel({ paymentId: "x' or 1=1" }).redirectTo, '/premium');
  ctx.tx = null;
  assert.equal((await svc.cancel({ user, paymentId: payment.id })).status, 'pending'); // still pending: PesaPal has not said failed
  assert.equal(payment.status, 'pending');
  ctx.tx = {};
  assert.equal((await svc.cancel({ user, paymentId: payment.id })).status, 'completed'); // customer actually paid
  assert.equal(db.t.subscriptions.length, 1);
});

test('confirm: asks PesaPal, only for the payer, and is idempotent', async () => {
  const { svc, db, ctx, payment } = await started();
  ctx.tx = null;
  assert.equal((await svc.confirm({ user, paymentId: payment.id })).status, 'pending');
  await assert.rejects(() => svc.confirm({ user: { id: OTHER }, paymentId: payment.id }), (e) => e.status === 404);
  ctx.tx = {};
  const done = await svc.confirm({ user, paymentId: payment.id });
  assert.equal(done.status, 'completed'); assert.ok(done.expires_at);
  const calls = ctx.statusCalls;
  assert.equal((await svc.confirm({ user, paymentId: payment.id })).status, 'completed');
  assert.equal(ctx.statusCalls, calls); // completed payments are not re-queried
  assert.equal(db.t.subscriptions.length, 1);
});

test('subscription timing: expired access is not extended; a second payment extends from the later end (central SQL), trial untouched', async () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261004_payments.sql', import.meta.url), 'utf8');
  assert.match(sql, /greatest\(now\(\), coalesce\(max\(s\.expires_at\), now\(\)\)\)/);
  const { computeAccess } = await import('../src/access.js');
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(computeAccess({ profile: { role: 'free_user' }, subscriptions: [{ status: 'active', expires_at: past }] }).isPremium, false);
  assert.equal(computeAccess({ profile: { role: 'free_user' }, subscriptions: [{ status: 'active', expires_at: future }] }).source, 'subscription');
  assert.equal(computeAccess({ profile: { role: 'free_user', trial_started_at: past, trial_ends_at: future }, subscriptions: [] }).source, 'trial');
});

// ---------- admin ----------
test('admin payments list: filters are validated; hostile values never reach PostgREST; analytics come from the database', async () => {
  const seen = [];
  const db = { selectPage: async (_t, q) => { seen.push(q); return { rows: [], total: 0 }; }, rpc: async (name) => { assert.equal(name, 'payment_analytics'); return { revenue_by_currency: { KES: '499.00' } }; } };
  const billing = createBillingAdmin({ db });
  await billing.listPayments({ status: 'completed', provider: 'pesapal', currency: 'kes', from: '2026-10-01', to: '2026-10-06', user: UID, reference: 'ET-20261006-ABCDEFGHJK', plan: 'monthly', limit: 25, offset: 0 });
  const q = seen[0];
  assert.deepEqual([q.status, q.provider, q.currency, q.user_id, q['metadata->>plan_code']], ['eq.completed', 'eq.pesapal', 'eq.KES', `eq.${UID}`, 'eq.monthly']);
  assert.match(q.or, /merchant_reference\.eq\.ET-20261006-ABCDEFGHJK/);
  assert.match(q.and, /created_at\.gte\.2026-10-01T00:00:00Z,created_at\.lte\.2026-10-06T23:59:59\.999Z/);
  await billing.listPayments({ status: 'x', provider: 'equity', currency: "K');--", from: 'yesterday', user: 'x),role.eq.admin', reference: 'a,b)or(c', plan: 'Bad Plan', limit: 25, offset: 0 });
  const bad = seen[1];
  for (const key of ['status', 'provider', 'currency', 'user_id', 'or', 'and', 'created_at', 'metadata->>plan_code']) assert.equal(bad[key], undefined, key);
  assert.deepEqual((await billing.analytics()).revenue_by_currency, { KES: '499.00' });
});

// ---------- migration and repository hygiene ----------
test('migration: additive, unique merchant reference, provider rule, events columns, analytics privileges', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261006_replace_equity_with_pesapal.sql', import.meta.url), 'utf8');
  assert.match(sql, /create unique index if not exists payments_merchant_reference_uidx/);
  assert.match(sql, /provider in \('pesapal', 'paypal'\)\) not valid/); // historical rows are preserved
  for (const col of ['tracking_id', 'merchant_reference', 'payload', 'processed', 'processed_at', 'error_message']) assert.match(sql, new RegExp(`payment_events add column if not exists ${col}`));
  assert.match(sql, /revoke all on function public\.payment_analytics\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.payment_analytics\(\) to service_role/);
  assert.equal(/drop table|delete from|truncate|update public\.payments/i.test(sql), false);
});

test('Equity is gone: no active code, frontend, configuration or credentials mention it (only the migration/docs history may)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { if (['node_modules', '.git', 'supabase', 'docs', 'test'].includes(name)) continue; const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full); else if (/\.(m?js|html|json|txt|example|yml|gs)$/.test(name) || name === '.env.example') files.push(full); } };
  walk(root);
  const hits = files.filter((f) => !f.endsWith('package-lock.json')).filter((f) => /equity/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(root, f)), []);
  assert.equal(readdirSync(new URL('../src/payments', import.meta.url)).includes('equity.js'), false);
  assert.equal(/EQUITY_/.test(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')), false);
});

test('no fake payment success exists in payment code', () => {
  for (const f of ['src/payments/pesapal.js', 'src/payments/service.js', 'src/payments/providers.js']) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.equal(/NOT_IMPLEMENTED|\bTODO\b|\bFAKE\b|\bDUMMY\b|isPremium\s*=\s*true/i.test(text), false, f);
  }
});
