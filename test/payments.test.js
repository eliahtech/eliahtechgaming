import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPayPalProvider } from '../src/payments/paypal.js';
import { createPaymentService } from '../src/payments/service.js';
import { createBillingAdmin } from '../src/admin/billing.js';
import { RESOURCES } from '../src/admin/resources.js';
import { validateFields } from '../src/admin/fields.js';
import { readFileSync } from 'node:fs';

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const user = { id: UID, emailVerified: true };
const ADMIN = { id: '33333333-3333-4333-8333-333333333333' };

// ---------- PayPal provider ----------
const PP_ENV = { PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com', PAYPAL_CLIENT_ID: 'client-id-xyz', PAYPAL_CLIENT_SECRET: 'client-secret-xyz', PAYPAL_WEBHOOK_ID: 'WH-123', PAYPAL_CURRENCY: 'USD' };
function ppHarness(handler, env = PP_ENV) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method, headers: init.headers, body: init.body });
    if (u.pathname === '/v1/oauth2/token') return { ok: true, status: 200, json: async () => ({ access_token: 'TOKEN', expires_in: 3600 }) };
    const r = handler(u.pathname, init, calls) ?? {};
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? null };
  };
  return { pp: createPayPalProvider({ env, fetchImpl, now: () => 1_000_000 }), calls };
}
const orderBody = (over = {}) => ({ id: 'ORDER1', status: 'COMPLETED', purchase_units: [{ custom_id: 'PAY1', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '4.99', currency_code: 'USD' } }] } }], ...over });

test('PayPal is only available with a valid host, credentials and a supported currency', () => {
  const avail = (env) => createPayPalProvider({ env }).available();
  assert.equal(avail(PP_ENV), true);
  assert.equal(avail({ ...PP_ENV, PAYPAL_BASE_URL: 'https://evil.example' }), false);
  assert.equal(avail({ ...PP_ENV, PAYPAL_CLIENT_SECRET: '' }), false);
  assert.equal(avail({ ...PP_ENV, PAYPAL_CURRENCY: 'KES' }), false);
  assert.equal(avail({}), false);
});

test('createOrder: server amount, idempotency key, custom_id and a validated PayPal approval link', async () => {
  const { pp, calls } = ppHarness(() => ({ status: 201, body: { id: 'ORDER1', links: [{ rel: 'self', href: 'https://api-m.sandbox.paypal.com/x' }, { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' }] } }));
  const out = await pp.createOrder({ paymentId: 'PAY1', amount: '4.99', description: 'Eliah Tech Premium', returnUrl: 'https://app/r', cancelUrl: 'https://app/c' });
  assert.deepEqual(out, { orderId: 'ORDER1', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' });
  const call = calls.find((c) => c.path === '/v2/checkout/orders');
  const body = JSON.parse(call.body);
  assert.equal(call.headers['PayPal-Request-Id'], 'PAY1');
  assert.equal(call.headers.Authorization, 'Bearer TOKEN');
  assert.deepEqual([body.intent, body.purchase_units[0].custom_id, body.purchase_units[0].amount], ['CAPTURE', 'PAY1', { currency_code: 'USD', value: '4.99' }]);
  assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://app/r');
});

test('createOrder refuses an approval link that is not on paypal.com', async () => {
  const { pp } = ppHarness(() => ({ status: 201, body: { id: 'O', links: [{ rel: 'approve', href: 'https://evil.example/pay' }] } }));
  await quiet(() => assert.rejects(() => pp.createOrder({ paymentId: 'P', amount: '1.00', description: 'x', returnUrl: 'https://a/r', cancelUrl: 'https://a/c' }), (e) => e.status === 502));
});

test('access token is cached between calls', async () => {
  const { pp, calls } = ppHarness(() => ({ body: orderBody() }));
  await pp.getOrder('A'); await pp.getOrder('B');
  assert.equal(calls.filter((c) => c.path === '/v1/oauth2/token').length, 1);
});

test('captureOrder: already-captured is read back, declines and unapproved orders are normal outcomes, other errors are 502', async () => {
  const issue = (name) => ({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: name }], debug_id: 'dbg' } });
  const run = (response) => ppHarness((path) => (path.endsWith('/capture') ? response : { body: orderBody() })).pp.captureOrder('ORDER1', 'PAY1');
  assert.equal((await run(issue('ORDER_ALREADY_CAPTURED'))).capture.id, 'CAP1');
  assert.deepEqual(await run(issue('INSTRUMENT_DECLINED')), { declined: true });
  assert.deepEqual(await run(issue('ORDER_NOT_APPROVED')), { notApproved: true });
  await quiet(() => assert.rejects(() => run(issue('SOMETHING_ELSE')), (e) => e.status === 502 && e.code === 'PAYMENT_PROVIDER_ERROR'));
  const ok = await run({ status: 201, body: orderBody() });
  assert.deepEqual([ok.status, ok.customId, ok.capture.amount, ok.capture.currency], ['COMPLETED', 'PAY1', '4.99', 'USD']);
});

test('webhook verification is delegated to PayPal with the webhook id and the parsed event', async () => {
  const headers = { 'paypal-transmission-id': 'tid', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': 't', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA' };
  const good = ppHarness(() => ({ body: { verification_status: 'SUCCESS' } }));
  assert.equal(await good.pp.verifyWebhook({ headers, rawBody: '{"id":"WH-1"}' }), true);
  const sent = JSON.parse(good.calls.find((c) => c.path.includes('verify-webhook')).body);
  assert.deepEqual([sent.webhook_id, sent.transmission_id, sent.webhook_event.id], ['WH-123', 'tid', 'WH-1']);
  assert.equal(await ppHarness(() => ({ body: { verification_status: 'FAILURE' } })).pp.verifyWebhook({ headers, rawBody: '{}' }), false);
  const offline = ppHarness(() => { throw new Error('must not call PayPal'); });
  assert.equal(await offline.pp.verifyWebhook({ headers: {}, rawBody: '{}' }), false);
  assert.equal(await offline.pp.verifyWebhook({ headers, rawBody: 'not json' }), false);
  await assert.rejects(() => ppHarness(() => ({}), { ...PP_ENV, PAYPAL_WEBHOOK_ID: '' }).pp.verifyWebhook({ headers, rawBody: '{}' }), (e) => e.status === 503);
});

test('PayPal errors never log credentials', async () => {
  const lines = []; const log = console.error; console.error = (l) => lines.push(l);
  try {
    const { pp } = ppHarness(() => ({ status: 400, body: { name: 'INVALID_REQUEST', details: [{ issue: 'X' }], debug_id: 'd1' } }));
    await assert.rejects(() => pp.getOrder('O'));
  } finally { console.error = log; }
  const text = lines.join('\n');
  assert.equal(/client-secret-xyz|client-id-xyz|TOKEN/.test(text), false);
  assert.match(text, /d1/);
});

// ---------- payment service (in-memory database that mirrors the SQL functions) ----------
function memDb(seed = {}) {
  const t = {
    payments: [], payment_events: [], subscriptions: [], audit_logs: [],
    settings: [{ key: 'premium', value: { status: 'available' } }],
    premium_plans: [{ id: randomUUID(), code: 'monthly', name: 'Monthly', duration_days: 30, prices: { USD: '4.99', KES: '499.00' }, enabled: true }],
    ...seed,
  };
  const match = (row, q) => Object.entries(q).every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k) || typeof v !== 'string') return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    return true;
  });
  const first = (table, id) => t[table].find((r) => r.id === id);
  const db = {
    t,
    select: async (table, q) => t[table].filter((r) => match(r, q)).slice(0, Number(q.limit) || 1e9),
    selectPage: async (table, q) => { const rows = t[table].filter((r) => match(r, q)); return { rows, total: rows.length }; },
    insert: async (table, row, opts = {}) => {
      const rows = (Array.isArray(row) ? row : [row]).map((r) => ({ id: randomUUID(), ...r }));
      if (table === 'payment_events' && t.payment_events.some((e) => e.provider === rows[0].provider && e.event_id === rows[0].event_id)) return [];
      t[table].push(...rows); return rows;
    },
    update: async (table, q, v) => { const rows = t[table].filter((r) => match(r, q)); rows.forEach((r) => Object.assign(r, v)); return rows; },
    remove: async () => [],
    rpc: async (name, a) => {
      const p = first('payments', a.p_payment_id);
      if (!p) throw new Error('payment not found');
      if (name === 'payment_complete') {
        if (['completed', 'refunded'].includes(p.status)) return [{ out_payment_id: p.id, out_status: p.status, out_newly_completed: false, out_expires_at: null }];
        const end = new Date(Date.now() + p.metadata.duration_days * 86400000).toISOString();
        Object.assign(p, { status: 'completed', transaction_id: a.p_transaction_id, completed_at: new Date().toISOString() });
        t.subscriptions.push({ id: randomUUID(), user_id: p.user_id, payment_id: p.id, status: 'active', expires_at: end });
        return [{ out_payment_id: p.id, out_status: 'completed', out_newly_completed: true, out_expires_at: end }];
      }
      if (name === 'payment_fail') { if (p.status !== 'pending') return [{ out_status: p.status, out_changed: false }]; p.status = a.p_status; p.failure_reason = a.p_reason; return [{ out_status: a.p_status, out_changed: true }]; }
      if (name === 'payment_refund') { if (p.status !== 'completed') return [{ out_status: p.status, out_changed: false }]; p.status = 'refunded'; t.subscriptions.filter((s) => s.payment_id === p.id).forEach((s) => { s.status = 'cancelled'; }); return [{ out_status: 'refunded', out_changed: true }]; }
      throw new Error(`unknown rpc ${name}`);
    },
  };
  return db;
}
function fakeProvider(over = {}) {
  const calls = [];
  const provider = {
    name: 'paypal', label: 'PayPal', currency: 'USD', available: () => true, unavailableReason: () => null, calls,
    createOrder: async (args) => { calls.push(['createOrder', args]); return { orderId: 'ORD1', approvalUrl: 'https://www.paypal.com/checkout?token=ORD1' }; },
    getOrder: async (id) => { calls.push(['getOrder', id]); return over.order ?? { orderId: id, status: 'CREATED', customId: null, capture: null }; },
    captureOrder: async (id, key) => { calls.push(['captureOrder', id, key]); return over.captured ?? { notApproved: true }; },
    verifyWebhook: async () => over.verified ?? true,
    ...over.methods,
  };
  return provider;
}
const completedOrder = (paymentId, over = {}) => ({ orderId: 'ORD1', status: 'COMPLETED', customId: paymentId, capture: { id: 'CAP1', status: 'COMPLETED', amount: '4.99', currency: 'USD', ...over } });
function setup(over = {}, seed) {
  const db = memDb(seed);
  const paypal = fakeProvider(over);
  const svc = createPaymentService({ db, providers: { paypal }, appUrl: 'https://app.example' });
  return { db, paypal, svc };
}
const checkout = (svc, extra = {}) => svc.checkout({ user, planCode: 'monthly', providerName: 'paypal', ...extra });

test('checkout: price, currency and duration come from the database; the client cannot choose them', async () => {
  const { db, paypal, svc } = setup();
  const out = await checkout(svc, { amount: '0.01', currency: 'KES', duration_days: 9999 });
  const payment = db.t.payments[0];
  assert.deepEqual([payment.amount, payment.currency, payment.status, payment.provider, payment.user_id], ['4.99', 'USD', 'pending', 'paypal', UID]);
  assert.deepEqual(payment.metadata, { plan_code: 'monthly', plan_name: 'Monthly', duration_days: 30 });
  assert.equal(payment.provider_order_id, 'ORD1');
  assert.deepEqual(out, { payment_id: payment.id, provider: 'paypal', approval_url: 'https://www.paypal.com/checkout?token=ORD1' });
  const args = paypal.calls.find((c) => c[0] === 'createOrder')[1];
  assert.deepEqual([args.paymentId, args.amount, args.returnUrl], [payment.id, '4.99', `https://app.example/payment/return?payment=${payment.id}`]);
});

test('checkout guards: verified email, open sales, valid provider/plan, price in the provider currency', async () => {
  await assert.rejects(() => setup().svc.checkout({ user: { ...user, emailVerified: false }, planCode: 'monthly', providerName: 'paypal' }), (e) => e.status === 403);
  const closed = setup({}, { settings: [{ key: 'premium', value: { status: 'coming_soon' } }] });
  await assert.rejects(() => checkout(closed.svc), (e) => e.code === 'PAYMENTS_DISABLED' && e.status === 409);
  assert.equal(closed.db.t.payments.length, 0);
  const { svc, db } = setup();
  await assert.rejects(() => checkout(svc, { providerName: 'stripe' }), (e) => e.status === 422);
  await assert.rejects(() => checkout(svc, { providerName: '__proto__' }), (e) => e.status === 422);
  await assert.rejects(() => checkout(svc, { providerName: 'equity' }), (e) => e.status === 422); // Equity no longer exists
  await assert.rejects(() => checkout(svc, { planCode: 'nope' }), (e) => e.status === 404);
  await assert.rejects(() => checkout(svc, { planCode: "x' or '1'='1" }), (e) => e.status === 422);
  db.t.premium_plans[0].prices = { KES: '499.00' };
  await assert.rejects(() => checkout(svc), (e) => e.code === 'PLAN_NOT_AVAILABLE');
  for (const bad of ['-4.99', '0', '4.999', 'abc', '']) { db.t.premium_plans[0].prices = { USD: bad }; await assert.rejects(() => checkout(svc), (e) => e.code === 'PLAN_NOT_AVAILABLE', bad); }
  assert.equal(db.t.payments.length, 0);
});

test('a provider failure during checkout marks the payment failed and surfaces the error', async () => {
  const { db, svc } = setup({ methods: { createOrder: async () => { throw Object.assign(new Error('x'), { status: 502, code: 'PAYMENT_PROVIDER_ERROR' }); } } });
  await assert.rejects(() => checkout(svc), (e) => e.status === 502);
  assert.equal(db.t.payments[0].status, 'failed');
  assert.equal(db.t.subscriptions.length, 0);
});

test('confirm: an approved order is captured by the server, verified, and grants access once', async () => {
  const state = {};
  const { db, paypal, svc } = setup({ methods: {
    getOrder: async () => ({ orderId: 'ORD1', status: 'APPROVED', customId: state.id, capture: null }),
    captureOrder: async (id, key) => { state.key = key; return completedOrder(state.id); },
  } });
  const { payment_id } = await checkout(svc); state.id = payment_id;
  const first = await svc.confirm({ user, paymentId: payment_id });
  assert.equal(first.status, 'completed');
  assert.ok(first.expires_at);
  assert.equal(state.key, payment_id); // idempotency key for PayPal
  assert.equal(db.t.subscriptions.length, 1);
  assert.equal(db.t.payments[0].transaction_id, 'CAP1');
  const calls = paypal.calls.length;
  const again = await svc.confirm({ user, paymentId: payment_id });
  assert.equal(again.status, 'completed');
  assert.equal(paypal.calls.length, calls); // no provider call for an already-completed payment
  assert.equal(db.t.subscriptions.length, 1);
  assert.ok(db.t.audit_logs.some((a) => a.action === 'payment.completed'));
});

test('confirm never trusts the browser: an unpaid order stays pending and grants nothing', async () => {
  const { db, svc } = setup();
  const { payment_id } = await checkout(svc);
  assert.equal((await svc.confirm({ user, paymentId: payment_id })).status, 'pending');
  assert.equal(db.t.subscriptions.length, 0);
});

test('confirm is limited to the payer; bad ids are 404', async () => {
  const { svc } = setup();
  const { payment_id } = await checkout(svc);
  await assert.rejects(() => svc.confirm({ user: { id: OTHER }, paymentId: payment_id }), (e) => e.status === 404);
  await assert.rejects(() => svc.confirm({ user, paymentId: 'x),user_id.neq.0' }), (e) => e.status === 404);
});

test('a captured amount, currency or reference that does not match our record is rejected and audited', async () => {
  for (const wrong of [{ amount: '0.01' }, { currency: 'EUR' }, { customId: randomUUID() }]) {
    const state = {};
    const { db, svc } = setup({ methods: {
      getOrder: async () => ({ orderId: 'ORD1', status: 'APPROVED', capture: null }),
      captureOrder: async () => { const o = completedOrder(state.id, wrong.amount ? { amount: wrong.amount } : wrong.currency ? { currency: wrong.currency } : {}); if (wrong.customId) o.customId = wrong.customId; return o; },
    } });
    const { payment_id } = await quiet(() => checkout(svc)); state.id = payment_id;
    const out = await quiet(() => svc.confirm({ user, paymentId: payment_id }));
    assert.equal(out.status, 'failed', JSON.stringify(wrong));
    assert.equal(db.t.subscriptions.length, 0);
    assert.ok(db.t.audit_logs.some((a) => a.action === 'payment.mismatch'));
  }
});

test('declined captures fail the payment; cancel only cancels unpaid orders', async () => {
  const declined = setup({ methods: { getOrder: async () => ({ orderId: 'ORD1', status: 'APPROVED', capture: null }), captureOrder: async () => ({ declined: true }) } });
  const a = await checkout(declined.svc);
  assert.equal((await declined.svc.confirm({ user, paymentId: a.payment_id })).status, 'failed');

  const unpaid = setup();
  const b = await checkout(unpaid.svc);
  assert.equal((await unpaid.svc.cancel({ user, paymentId: b.payment_id })).status, 'cancelled');
  assert.equal((await unpaid.svc.confirm({ user, paymentId: b.payment_id })).status, 'cancelled');

  const approved = setup({ order: { orderId: 'ORD1', status: 'APPROVED', capture: null } });
  const c = await checkout(approved.svc);
  assert.equal((await approved.svc.cancel({ user, paymentId: c.payment_id })).status, 'pending'); // the customer did pay
});

// ---------- webhooks ----------
const wh = (svc, event) => svc.handlePayPalWebhook({ headers: {}, rawBody: JSON.stringify(event) });
async function pendingPayment(over = {}) {
  const ctx = setup(over);
  const { payment_id } = await checkout(ctx.svc);
  return { ...ctx, id: payment_id };
}

test('webhook: invalid signatures are rejected before anything is read or changed', async () => {
  const { svc, db } = setup({ verified: false });
  await assert.rejects(() => wh(svc, { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }), (e) => e.status === 401 && e.code === 'INVALID_SIGNATURE');
  assert.equal(db.t.payment_events.length, 0);
});

test('webhook: capture completed is confirmed against PayPal (not the event body), then deduplicated on retry', async () => {
  const ctx = {};
  const p = await pendingPayment({ methods: { getOrder: async () => completedOrder(ctx.id) } });
  ctx.id = p.id;
  const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', amount: { value: '0.01', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: 'ORD1' } } } };
  assert.deepEqual(await wh(p.svc, event), { duplicate: false, handled: true });
  assert.equal(p.db.t.payments[0].status, 'completed'); // the 0.01 in the event body was ignored
  assert.equal(p.db.t.subscriptions.length, 1);
  assert.equal(p.db.t.payment_events.length, 1);
  assert.deepEqual(await wh(p.svc, event), { duplicate: true });
  assert.equal(p.db.t.subscriptions.length, 1);
  // a different event id for the same capture (PayPal resend) is also harmless
  await wh(p.svc, { ...event, id: 'WH-2' });
  assert.equal(p.db.t.subscriptions.length, 1);
});

test('webhook: order approved triggers a server-side capture (customer closed the tab)', async () => {
  const ctx = {};
  const p = await pendingPayment({ methods: { captureOrder: async () => completedOrder(ctx.id) } });
  ctx.id = p.id;
  await wh(p.svc, { id: 'WH-3', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD1' } });
  assert.equal(p.db.t.payments[0].status, 'completed');
});

test('webhook: denied capture fails a pending payment but never downgrades a completed one', async () => {
  const p = await pendingPayment();
  await wh(p.svc, { id: 'WH-4', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { supplementary_data: { related_ids: { order_id: 'ORD1' } } } });
  assert.equal(p.db.t.payments[0].status, 'failed');
  const done = await pendingPayment();
  Object.assign(done.db.t.payments[0], { status: 'completed' });
  await wh(done.svc, { id: 'WH-5', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { supplementary_data: { related_ids: { order_id: 'ORD1' } } } });
  assert.equal(done.db.t.payments[0].status, 'completed');
});

test('webhook: a full refund ends access; a partial refund does not', async () => {
  const mk = async () => {
    const p = await pendingPayment();
    Object.assign(p.db.t.payments[0], { status: 'completed', transaction_id: 'CAP1' });
    p.db.t.subscriptions.push({ id: randomUUID(), payment_id: p.id, status: 'active' });
    return p;
  };
  const full = await mk();
  await wh(full.svc, { id: 'WH-6', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { amount: { value: '4.99', currency_code: 'USD' }, links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP1' }] } });
  assert.equal(full.db.t.payments[0].status, 'refunded');
  assert.equal(full.db.t.subscriptions[0].status, 'cancelled');
  assert.ok(full.db.t.audit_logs.some((a) => a.action === 'payment.refunded'));
  const partial = await mk();
  await wh(partial.svc, { id: 'WH-7', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { amount: { value: '1.00', currency_code: 'USD' }, links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP1' }] } });
  assert.equal(partial.db.t.payments[0].status, 'completed');
});

test('webhook: unknown payments and event types are accepted and logged; processing failures are not recorded so PayPal can retry', async () => {
  const { svc, db } = setup();
  assert.deepEqual(await wh(svc, { id: 'WH-8', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'NOPE' } } } }), { duplicate: false, handled: false });
  assert.deepEqual(await wh(svc, { id: 'WH-9', event_type: 'BILLING.SOMETHING', resource: {} }), { duplicate: false, handled: false });
  assert.equal(db.t.payment_events.length, 2);
  await assert.rejects(() => wh(svc, { event_type: 'X' }), (e) => e.status === 400);

  const failing = await pendingPayment({ methods: { getOrder: async () => { throw new Error('PayPal down'); } } });
  await assert.rejects(() => wh(failing.svc, { id: 'WH-10', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'ORD1' } } } }), /PayPal down/);
  assert.equal(failing.db.t.payment_events.length, 0);
});

test('the browser return URL alone cannot grant access (only provider-confirmed paths call payment_complete)', async () => {
  const p = await pendingPayment(); // provider reports the order as merely CREATED
  await p.svc.confirm({ user, paymentId: p.id });
  await p.svc.cancel({ user, paymentId: p.id });
  assert.equal(p.db.t.subscriptions.length, 0);
});

// ---------- admin billing ----------
test('admin grant: validated, extends from existing access, audited; cancel only affects active subscriptions', async () => {
  const db = memDb();
  db.t.profiles = [{ id: UID }];
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  db.t.subscriptions.push({ id: randomUUID(), user_id: UID, status: 'active', expires_at: future });
  const original = db.select; db.select = async (table, q) => (table === 'subscriptions' && q.order ? db.t.subscriptions.filter((s) => s.user_id === UID && s.status === 'active') : original(table, q));
  const billing = createBillingAdmin({ db });
  const row = await billing.grant({ userId: UID, days: 30, note: 'giveaway' }, ADMIN, '1.1.1.1');
  assert.equal(Math.round((Date.parse(row.expires_at) - Date.parse(future)) / 86400000), 30);
  assert.equal(row.payment_provider, 'manual');
  assert.ok(db.t.audit_logs.some((a) => a.action === 'subscription.grant' && a.metadata.days === 30));
  for (const bad of [0, -1, 4000, 1.5, 'x']) await assert.rejects(() => billing.grant({ userId: UID, days: bad }, ADMIN), (e) => e.status === 422);
  await assert.rejects(() => billing.grant({ userId: 'x),role.eq.admin', days: 5 }, ADMIN), (e) => e.status === 422);
  await assert.rejects(() => billing.grant({ userId: OTHER, days: 5 }, ADMIN), (e) => e.status === 404);
  await assert.rejects(() => billing.cancel('bad', ADMIN), (e) => e.status === 404);
});

test('plan prices are validated and normalised', () => {
  const v = (prices) => validateFields(RESOURCES.plans.fields, { code: 'monthly', name: 'Monthly', duration_days: 30, prices }, {});
  assert.deepEqual(v({ USD: '4.99', KES: 499 }).prices, { USD: '4.99', KES: '499.00' });
  for (const bad of [{ usd: '4.99' }, { USD: '-1' }, { USD: '0' }, { USD: '1.234' }, { USD: 'free' }, 'USD=4.99', [], null]) assert.throws(() => v(bad), (e) => e.status === 422, JSON.stringify(bad));
  assert.throws(() => validateFields(RESOURCES.plans.fields, { code: 'monthly', name: 'Monthly', prices: {} }, {}), (e) => e.status === 422 && e.details.fields.duration_days === 'Required.');
});

test('payment migration: idempotency, ownership and privilege rules are present', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261004_payments.sql', import.meta.url), 'utf8');
  assert.match(sql, /create unique index if not exists payments_provider_order_uidx/);
  assert.match(sql, /create unique index if not exists subscriptions_payment_uidx/);
  assert.match(sql, /for update/);
  assert.match(sql, /check \(amount > 0\)/);
  assert.match(sql, /check \(status in \('pending', 'completed', 'failed', 'cancelled', 'refunded'\)\)/);
  assert.match(sql, /users read own payments[\s\S]*user_id = auth\.uid\(\)/);
  for (const fn of ['payment_complete(uuid, text, jsonb)', 'payment_fail(uuid, text, text)', 'payment_refund(uuid, jsonb)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  assert.match(sql, /if v_pay\.status in \('completed', 'refunded'\) then/); // a late event can never resurrect or double-grant
});
