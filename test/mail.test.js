import test from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { createEmailService } from '../src/email.js';
import { newsletterVerify, contactReply, newsletterIssue, authEmail, esc } from '../src/email-templates.js';
import { createNewsletterService, hashToken } from '../src/newsletter.js';
import { verifyWebhook, buildAuthEmail } from '../src/auth-hook.js';
import { createMailAdmin, csvCell } from '../src/admin/mail.js';
import { DatabaseError, ConfigError } from '../src/supabase.js';

const KEY = 're_test_key_0123456789';
const env = { RESEND_API_KEY: KEY, EMAIL_FROM: 'Eliah Tech <no-reply@example.com>' };
const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN = { id: '33333333-3333-4333-8333-333333333333' };
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

function mailHarness(respond) {
  const calls = []; const events = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const r = await respond(JSON.parse(init.body), calls.length); return { ok: r.status ? r.status < 400 : true, status: r.status ?? 200, json: async () => { if (r.notJson) throw new SyntaxError('Unexpected token <'); return r.body; } }; };
  const db = { insert: async (table, rows) => { events.push(...rows); return null; } };
  return { svc: createEmailService({ db, fetchImpl, env }), calls, events };
}
const allOk = (batch) => ({ body: { data: batch.map((_, i) => ({ id: `id-${i}` })) } });
const msg = (to = 'a@b.co') => ({ to, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });

test('emails go to the Resend batch API with the key in the Authorization header only', async () => {
  const { svc, calls } = mailHarness(allOk);
  await svc.sendOne({ ...msg(), replyTo: 'r@b.co' }, { type: 'test' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails/batch');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].url.includes(KEY) || calls[0].init.body.includes(KEY), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), [{ from: 'Eliah Tech <no-reply@example.com>', to: ['a@b.co'], subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', reply_to: 'r@b.co' }]);
});

test('only a single https List-Unsubscribe header can be set by callers', async () => {
  const { svc, calls } = mailHarness(allOk);
  await svc.send([{ ...msg(), headers: { 'List-Unsubscribe': 'https://x.co/u?t=1', Bcc: 'evil@x.co' } }, { ...msg(), headers: { 'List-Unsubscribe': 'javascript:alert(1)' } }], { type: 'n' });
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent[0].headers, { 'List-Unsubscribe': '<https://x.co/u?t=1>' });
  assert.equal('headers' in sent[1], false);
});

test('batches over 100 messages are split into separate API calls', async () => {
  const { svc, calls } = mailHarness(allOk);
  const results = await svc.send(Array.from({ length: 250 }, (_, i) => msg(`u${i}@b.co`)), { type: 'n' });
  assert.equal(results.length, 250);
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).length), [100, 100, 50]);
});

test('send validates input, strips header injection from subjects and logs every attempt without bodies', async () => {
  const { svc, calls, events } = mailHarness(allOk);
  await assert.rejects(() => svc.send([msg('not-an-email')], { type: 't' }), (e) => e.status === 422);
  await assert.rejects(() => svc.send([], { type: 't' }), (e) => e.status === 422);
  assert.equal(calls.length, 0);
  await svc.send([{ ...msg(), subject: 'Hi\r\nBcc: victim@x.co' }], { type: 'unit', campaignId: UUID });
  assert.equal(JSON.parse(calls[0].init.body)[0].subject, 'Hi Bcc: victim@x.co');
  assert.deepEqual(events[0], { type: 'unit', to_email: 'a@b.co', status: 'sent', error: null, campaign_id: UUID });
  assert.equal('html' in events[0], false);
});

test('delivery failures are returned and logged, never thrown, and never leak the API key', async () => {
  const lines = []; const log = console.error; console.error = (l) => lines.push(l);
  try {
    const rejected = mailHarness(() => ({ status: 422, body: { message: 'The to field must be a valid email address.' } }));
    const results = await rejected.svc.send([msg('a@b.co'), msg('c@d.co')], { type: 'x' });
    assert.deepEqual(results.map((r) => r.ok), [false, false]);
    assert.equal(rejected.events[1].error, 'The to field must be a valid email address.');
    for (const bad of [{ status: 500, body: {} }, { notJson: true }, { body: {} }, { body: { data: [] } }]) {
      const h = mailHarness(() => bad);
      assert.equal((await h.svc.send([msg()], { type: 'x' }))[0].ok, false);
    }
    await assert.rejects(() => mailHarness(() => ({ status: 401, body: {} })).svc.sendOne(msg(), { type: 'x' }), (e) => e.status === 502 && e.code === 'EMAIL_FAILED');
    const down = createEmailService({ db: { insert: async () => null }, env, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.equal((await down.send([msg()], { type: 'x' }))[0].ok, false);
  } finally { console.error = log; }
  assert.equal(lines.join('\n').includes(KEY), false);
});

test('missing or invalid configuration is an explicit error', async () => {
  const svc = (e) => createEmailService({ db: {}, env: e, fetchImpl: async () => { throw new Error('unreachable'); } });
  await assert.rejects(() => svc({}).send([msg()], {}), ConfigError);
  await assert.rejects(() => svc({ RESEND_API_KEY: KEY, EMAIL_FROM: 'not-an-address' }).send([msg()], {}), ConfigError);
  await assert.rejects(() => svc({ EMAIL_FROM: env.EMAIL_FROM }).send([msg()], {}), ConfigError);
});

test('a failure to write the email log does not break sending', async () => {
  await quiet(async () => {
    const svc = createEmailService({ db: { insert: async () => { throw new DatabaseError('x', {}); } }, env, fetchImpl: async (u, i) => ({ ok: true, status: 200, json: async () => allOk(JSON.parse(i.body)).body }) });
    assert.equal((await svc.send([msg()], { type: 'x' }))[0].ok, true);
  });
});

test('templates escape every dynamic value', () => {
  const evil = '<script>alert(1)</script>"\'&';
  const reply = contactReply({ name: evil, body: evil, originalSubject: 'S', originalMessage: evil });
  assert.equal(reply.html.includes('<script>'), false);
  assert.match(reply.html, /&lt;script&gt;/);
  assert.equal(newsletterVerify({ url: 'https://x.co/?a="><script>' }).html.includes('"><script>'), false);
  assert.equal(esc(null), '');
  assert.equal(contactReply({ name: 'A', body: 'B', originalSubject: 'RE: Topic', originalMessage: 'M' }).subject, 'Re: Topic');
  assert.match(newsletterIssue({ subject: 'S', contentHtml: '<p>Body</p>', unsubscribeUrl: 'https://x.co/u?token=t' }).html, /Unsubscribe/);
  assert.match(authEmail({ type: 'recovery', url: 'https://x.co/r' }).html, /Reset password/);
});

// ---- newsletter ----
function newsletterHarness({ existing, insertError } = {}) {
  const log = []; let time = 1_800_000_000_000;
  const db = {
    select: async (table, q) => { log.push({ op: 'select', table, q }); return existing ? [existing] : []; },
    insert: async (table, row) => { log.push({ op: 'insert', table, row }); if (insertError) throw insertError; return null; },
    update: async (table, q, v) => { log.push({ op: 'update', table, q, v }); return [{}]; },
  };
  const sent = []; let failSend = false;
  const email = { sendOne: async (m, meta) => { if (failSend) throw new Error('mail down'); sent.push({ m, meta }); } };
  return { svc: createNewsletterService({ db, email, appUrl: 'https://app.example', now: () => time }), log, sent, setTime: (t) => { time = t; }, failSend: () => { failSend = true; } };
}

test('subscribe: new address is stored pending with only a token hash, and gets a confirmation link', async () => {
  const h = newsletterHarness();
  await h.svc.subscribe(' New@Example.com ');
  const row = h.log.find((c) => c.op === 'insert').row;
  assert.equal(row.email, 'new@example.com');
  assert.equal(row.status, 'pending');
  const link = h.sent[0].m.html.match(/confirm\?token=([A-Za-z0-9_-]+)/)[1];
  assert.equal(row.verify_token_hash, hashToken(link));
  assert.equal(JSON.stringify(row).includes(link), false);
  assert.equal(h.sent[0].m.to, 'new@example.com');
});

test('subscribe: active addresses and recent pending requests send nothing (no enumeration, no mail bombing)', async () => {
  const active = newsletterHarness({ existing: { id: UUID, status: 'active' } });
  await active.svc.subscribe('a@b.co');
  assert.equal(active.sent.length, 0);
  const recent = newsletterHarness({ existing: { id: UUID, status: 'pending', verify_sent_at: new Date(1_800_000_000_000 - 30_000).toISOString() } });
  await recent.svc.subscribe('a@b.co');
  assert.equal(recent.sent.length, 0);
  const stale = newsletterHarness({ existing: { id: UUID, status: 'pending', verify_sent_at: new Date(1_800_000_000_000 - 600_000).toISOString() } });
  await stale.svc.subscribe('a@b.co');
  assert.equal(stale.sent.length, 1);
});

test('subscribe: unsubscribed addresses must re-confirm; duplicates racing in are ignored; invalid emails rejected; mail failure surfaces', async () => {
  const back = newsletterHarness({ existing: { id: UUID, status: 'unsubscribed' } });
  await back.svc.subscribe('a@b.co');
  const upd = back.log.find((c) => c.op === 'update').v;
  assert.deepEqual([upd.status, upd.unsubscribed_at], ['pending', null]);
  assert.equal(back.sent.length, 1);
  const race = newsletterHarness({ insertError: new DatabaseError('x', { code: '23505' }) });
  await race.svc.subscribe('a@b.co');
  assert.equal(race.sent.length, 0);
  await assert.rejects(() => newsletterHarness().svc.subscribe('nope'), (e) => e.status === 400);
  const down = newsletterHarness(); down.failSend();
  await assert.rejects(() => down.svc.subscribe('a@b.co'), /mail down/);
});

test('verify: only a matching, fresh, pending token activates; the token is single-use', async () => {
  const token = 'A'.repeat(43);
  const ok = newsletterHarness({ existing: { id: UUID, verify_sent_at: new Date(1_800_000_000_000 - 1000).toISOString() } });
  await ok.svc.verify(token);
  assert.equal(ok.log.find((c) => c.op === 'select').q.verify_token_hash, `eq.${hashToken(token)}`);
  const upd = ok.log.find((c) => c.op === 'update').v;
  assert.deepEqual([upd.status, upd.verify_token_hash], ['active', null]);
  await assert.rejects(() => newsletterHarness().svc.verify(token), (e) => e.status === 400 && e.code === 'INVALID_TOKEN');
  const old = newsletterHarness({ existing: { id: UUID, verify_sent_at: new Date(1_800_000_000_000 - 8 * 86400000).toISOString() } });
  await assert.rejects(() => old.svc.verify(token), (e) => e.status === 400);
  for (const bad of [undefined, '', 'short', "x' or '1'='1", ['a'], 'A'.repeat(500)]) await assert.rejects(() => newsletterHarness().svc.verify(bad), (e) => e.status === 400);
});

test('unsubscribe: valid token works and is idempotent; garbage is rejected without querying', async () => {
  const token = 'a'.repeat(48);
  const h = newsletterHarness({ existing: { id: UUID, status: 'active' } });
  await h.svc.unsubscribe(token);
  assert.equal(h.log.find((c) => c.op === 'update').v.status, 'unsubscribed');
  const again = newsletterHarness({ existing: { id: UUID, status: 'unsubscribed' } });
  await again.svc.unsubscribe(token);
  assert.equal(again.log.some((c) => c.op === 'update'), false);
  const bad = newsletterHarness();
  await assert.rejects(() => bad.svc.unsubscribe('zzz'), (e) => e.status === 400);
  assert.equal(bad.log.length, 0);
  await assert.rejects(() => newsletterHarness().svc.unsubscribe(token), (e) => e.status === 400);
});

// ---- Supabase auth email hook ----
const hookSecret = `v1,whsec_${Buffer.from('super-secret-key-bytes-1234567890').toString('base64')}`;
const signHook = (id, ts, body) => `v1,${createHmac('sha256', Buffer.from('super-secret-key-bytes-1234567890')).update(`${id}.${ts}.${body}`).digest('base64')}`;

test('webhook signature: valid passes; tampering, replay, wrong secret and missing headers fail', () => {
  const body = JSON.stringify({ hello: 'world' }); const now = 1_800_000_000;
  const headers = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(now), 'webhook-signature': signHook('msg_1', now, body) };
  const check = (over = {}) => verifyWebhook({ secret: hookSecret, headers: { ...headers, ...over }, rawBody: over.rawBody ?? body, nowSeconds: now + (over.skew ?? 0) });
  assert.equal(check(), true);
  assert.equal(verifyWebhook({ secret: hookSecret, headers, rawBody: `${body} `, nowSeconds: now }), false);
  assert.equal(check({ skew: 1000 }), false);
  assert.equal(verifyWebhook({ secret: 'v1,whsec_' + Buffer.from('other').toString('base64'), headers, rawBody: body, nowSeconds: now }), false);
  assert.equal(verifyWebhook({ secret: '', headers, rawBody: body, nowSeconds: now }), false);
  assert.equal(verifyWebhook({ secret: hookSecret, headers: {}, rawBody: body, nowSeconds: now }), false);
  assert.equal(check({ 'webhook-signature': 'v1,AAAA' }), false);
  assert.equal(check({ 'webhook-signature': `v2,${headers['webhook-signature'].slice(3)}` }), false);
  assert.equal(check({ 'webhook-signature': `v1,AAAA ${headers['webhook-signature']}` }), true); // multiple signatures allowed
});

test('auth hook builds a Supabase verify link from the token hash it is given', () => {
  const payload = { user: { email: 'U@Example.com' }, email_data: { token_hash: 'hash123', email_action_type: 'recovery', redirect_to: 'https://app.example/reset-password', token: '123456' } };
  const out = buildAuthEmail(payload, { supabaseUrl: 'https://proj.supabase.co' });
  assert.equal(out.to, 'u@example.com');
  const link = new URL(out.html.match(/https:\/\/proj\.supabase\.co[^"<\s]+/)[0].replace(/&amp;/g, '&'));
  assert.equal(link.pathname, '/auth/v1/verify');
  assert.deepEqual([link.searchParams.get('token'), link.searchParams.get('type'), link.searchParams.get('redirect_to')], ['hash123', 'recovery', 'https://app.example/reset-password']);
  assert.match(buildAuthEmail({ user: { email: 'u@x.co' }, email_data: { email_action_type: 'reauthentication', token: '654321' } }, { supabaseUrl: 'https://p.supabase.co' }).html, /654321/);
  for (const bad of [{ user: { email: 'u@x.co' }, email_data: { email_action_type: 'weird', token_hash: 'h' } }, { user: {}, email_data: { email_action_type: 'signup', token_hash: 'h' } }, { user: { email: 'u@x.co' }, email_data: { email_action_type: 'signup' } }, {}]) {
    assert.throws(() => buildAuthEmail(bad, { supabaseUrl: 'https://p.supabase.co' }), (e) => e.status === 400);
  }
});

// ---- admin mail ----
test('CSV cells neutralise formulas and escape quotes', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('plain@x.co'), 'plain@x.co');
});

function adminHarness({ message, campaign, candidates = [], sendResult, remaining = 0, claimLost = false } = {}) {
  const log = [];
  const db = {
    select: async (table, q) => { log.push({ op: 'select', table, q }); if (table === 'messages') return message ? [message] : []; if (table === 'newsletter_campaigns') return campaign ? [campaign] : []; return []; },
    selectPage: async (table, q) => { log.push({ op: 'selectPage', table, q }); return { rows: [], total: 0 }; },
    insert: async (table, row) => { log.push({ op: 'insert', table, row }); if (table === 'newsletter_deliveries') return claimLost ? [] : row; return [{ id: UUID, ...row }]; },
    update: async (table, q, v) => { log.push({ op: 'update', table, q, v }); return [{ id: UUID }]; },
    remove: async (table, q) => { log.push({ op: 'remove', table, q }); return [{ id: UUID }]; },
    rpc: async (name, args) => { log.push({ op: 'rpc', name, args }); return name === 'newsletter_next_batch' ? candidates : remaining; },
  };
  const sent = []; let failNext = false;
  const email = {
    sendOne: async (m, meta) => { if (failNext) throw Object.assign(new Error('x'), { status: 502 }); sent.push({ m, meta }); },
    send: async (msgs, meta) => { sent.push({ msgs, meta }); return sendResult ? sendResult(msgs) : msgs.map(() => ({ ok: true })); },
  };
  const mail = createMailAdmin({ db, email, appUrl: 'https://app.example', sanitize: (h) => h.replace(/<script[\s\S]*?<\/script>/g, ''), batchSize: 5 });
  return { mail, log, sent, failNext: () => { failNext = true; } };
}

test('replying emails the sender first, then records the reply and marks the message replied', async () => {
  const h = adminHarness({ message: { id: UUID, name: 'Ann', email: 'ann@x.co', subject: 'Help', message: 'Hello', status: 'read' } });
  await h.mail.inbox.reply(UUID, '  Thanks for writing!  ', ADMIN, '1.1.1.1');
  assert.equal(h.sent[0].m.to, 'ann@x.co');
  assert.equal(h.sent[0].m.subject, 'Re: Help');
  assert.equal(h.log.find((c) => c.op === 'insert' && c.table === 'message_replies').row.body, 'Thanks for writing!');
  assert.equal(h.log.find((c) => c.op === 'update' && c.table === 'messages').v.status, 'replied');
  assert.ok(h.log.some((c) => c.op === 'insert' && c.table === 'audit_logs' && c.row.action === 'message.reply'));
});

test('a failed reply email records nothing; bad input and ids are rejected', async () => {
  const h = adminHarness({ message: { id: UUID, name: 'Ann', email: 'ann@x.co', subject: 'Help', message: 'Hello', status: 'unread' } });
  h.failNext();
  await assert.rejects(() => h.mail.inbox.reply(UUID, 'Hi there', ADMIN), (e) => e.status === 502);
  assert.equal(h.log.some((c) => (c.op === 'insert' && c.table === 'message_replies') || (c.op === 'update' && c.table === 'messages')), false);
  await assert.rejects(() => h.mail.inbox.reply(UUID, 'x', ADMIN), (e) => e.status === 422);
  await assert.rejects(() => h.mail.inbox.reply(UUID, 'y'.repeat(5001), ADMIN), (e) => e.status === 422);
  await assert.rejects(() => h.mail.inbox.get("1' or '1'='1"), (e) => e.status === 404);
  await assert.rejects(() => adminHarness().mail.inbox.get(UUID), (e) => e.status === 404);
  await assert.rejects(() => h.mail.inbox.setStatus(UUID, 'replied', ADMIN), (e) => e.status === 422);
});

test('inbox and subscriber lists build safe filters', async () => {
  const h = adminHarness();
  await h.mail.inbox.list({ q: 'a),status.eq.x,(b', status: 'unread', limit: 25, offset: 0 });
  await h.mail.inbox.list({ q: '', status: 'bogus', limit: 25, offset: 0 });
  const [first, second] = h.log.filter((c) => c.op === 'selectPage');
  assert.equal(first.q.status, 'eq.unread');
  assert.equal(first.q.or.includes('x,('), false);
  assert.equal(second.q.status, undefined);
});

test('subscriber export is audited and formula-safe; admins can unsubscribe/delete but there is no activate', async () => {
  const h = adminHarness();
  const csv = await h.mail.subscribers.exportCsv('active', ADMIN, '1.1.1.1');
  assert.equal(csv.split('\r\n')[0], 'email,status,subscribed_at,verified_at');
  assert.ok(h.log.some((c) => c.table === 'audit_logs' && c.row.action === 'subscribers.export'));
  await h.mail.subscribers.unsubscribe(UUID, ADMIN);
  assert.equal(h.log.find((c) => c.op === 'update' && c.table === 'subscribers').v.status, 'unsubscribed');
  assert.equal('activate' in h.mail.subscribers, false);
  await assert.rejects(() => h.mail.subscribers.remove('bad-id', ADMIN), (e) => e.status === 404);
});

const sending = { id: UUID, subject: 'Issue 1', content_html: '<p>News</p>', status: 'sending' };
const subs = [{ id: 's1', email: 'one@x.co', unsubscribe_token: 'a'.repeat(48) }, { id: 's2', email: 'two@x.co', unsubscribe_token: 'b'.repeat(48) }];

test('sendBatch: claims rows first, sends personalised unsubscribe links, records results and finishes when none remain', async () => {
  const h = adminHarness({ campaign: sending, candidates: subs, remaining: 0, sendResult: (m) => [{ ok: true }, { ok: false, error: 'daily_quota_exhausted' }] });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.deepEqual([out.sent, out.failed, out.remaining, out.status], [1, 1, 0, 'sent']);
  assert.deepEqual([out.daily_limit, out.sent_today, out.allowance_left], [30, 1, 28]); // failures do not use the quota
  const order = h.log.filter((c) => ['insert', 'update'].includes(c.op) && c.table === 'newsletter_deliveries').map((c) => `${c.op}:${c.row?.[0]?.status ?? c.v.status}`);
  assert.equal(order[0], 'insert:pending'); // claimed before any email goes out
  const msgs = h.sent[0].msgs;
  assert.match(msgs[0].html, /unsubscribe\?token=a{48}/);
  assert.match(msgs[1].html, /unsubscribe\?token=b{48}/);
  assert.equal(msgs[0].to, 'one@x.co');
  assert.ok(h.log.some((c) => c.op === 'update' && c.table === 'newsletter_campaigns' && c.v.status === 'sent'));
  assert.ok(h.log.some((c) => c.op === 'update' && c.v.status === 'failed' && c.v.error === 'daily_quota_exhausted'));
});

test('sendBatch: a concurrent call that lost the claim sends nothing; drafts cannot be batch-sent', async () => {
  const lost = adminHarness({ campaign: sending, candidates: subs, claimLost: true, remaining: 2 });
  const out = await lost.mail.campaigns.sendBatch(UUID);
  assert.deepEqual([out.sent, out.failed, out.status], [0, 0, 'sending']);
  assert.equal(lost.sent.length, 0);
  await assert.rejects(() => adminHarness({ campaign: { ...sending, status: 'draft' } }).mail.campaigns.sendBatch(UUID), (e) => e.status === 409);
  await assert.rejects(() => adminHarness({ campaign: { ...sending, status: 'sent' } }).mail.campaigns.start(UUID, ADMIN), (e) => e.status === 409);
});

test('campaign content is sanitized and validated; only drafts are editable; sending ones cannot be deleted', async () => {
  const h = adminHarness({ campaign: { ...sending, status: 'draft' } });
  await h.mail.campaigns.update(UUID, { subject: 'New subject', content_html: '<p>ok</p><script>x()</script>' }, ADMIN);
  assert.equal(h.log.find((c) => c.op === 'update' && c.table === 'newsletter_campaigns').v.content_html, '<p>ok</p>');
  assert.throws(() => h.mail.campaigns.parse({ subject: 'x', content_html: '<p>ok</p>' }), (e) => e.status === 422);
  assert.throws(() => h.mail.campaigns.parse({ subject: 'Fine', content_html: '<script>x()</script>' }), (e) => e.status === 422);
  await assert.rejects(() => adminHarness({ campaign: sending }).mail.campaigns.update(UUID, { subject: 'Fine', content_html: '<p>x y</p>' }, ADMIN), (e) => e.status === 409);
  await assert.rejects(() => adminHarness({ campaign: sending }).mail.campaigns.remove(UUID, ADMIN), (e) => e.status === 409);
});

test('requeue removes only failed/pending deliveries and reopens a finished campaign', async () => {
  const h = adminHarness({ campaign: { ...sending, status: 'sent' } });
  await h.mail.campaigns.requeue(UUID, ADMIN);
  assert.equal(h.log.find((c) => c.op === 'remove').q.status, 'in.(failed,pending)');
  assert.equal(h.log.find((c) => c.op === 'update' && c.table === 'newsletter_campaigns').v.status, 'sending');
});

// ---- daily cap (30 a day by default), retries, pause/resume and the daily runner ----
const person = (n) => ({ id: `s${n}`, email: `u${n}@x.co`, unsubscribe_token: String(n).padStart(48, '0') });
const people = (n, from = 1) => Array.from({ length: n }, (_, i) => person(from + i));

function cappedHarness({ campaign = sending, waiting = people(0), remaining, sentToday = 0, inFlight = 0, settingLimit, envLimit, batchSize = 50, failedRows = [], known = [], sendResult, retryLost = false, now = () => new Date('2026-10-28T10:30:00Z') } = {}) {
  const log = []; let cursor = 0;
  const db = {
    select: async (table, q) => {
      log.push({ op: 'select', table, q });
      if (table === 'newsletter_campaigns') return campaign ? [campaign] : [];
      if (table === 'settings') return settingLimit === undefined ? [] : [{ value: { daily_limit: settingLimit } }];
      if (table === 'newsletter_deliveries') return failedRows;
      if (table === 'subscribers') return known;
      return [];
    },
    selectPage: async (table, q) => { log.push({ op: 'selectPage', table, q }); return { rows: [], total: table === 'email_events' ? sentToday : q.status === 'eq.pending' ? inFlight : 0 }; },
    insert: async (table, row) => { log.push({ op: 'insert', table, row }); return Array.isArray(row) ? row : [{ id: UUID, ...row }]; },
    update: async (table, q, v) => { log.push({ op: 'update', table, q, v }); return retryLost && q.status === 'eq.failed' ? [] : [{ id: UUID }]; },
    remove: async () => [],
    rpc: async (name, args) => {
      log.push({ op: 'rpc', name, args });
      if (name === 'newsletter_next_batch') { const out = waiting.slice(cursor, cursor + args.p_limit); cursor += out.length; return out; }
      return remaining ?? Math.max(0, waiting.length - cursor);
    },
  };
  const sent = [];
  const email = { sendOne: async () => {}, send: async (msgs, meta) => { sent.push({ msgs, meta }); return sendResult ? sendResult(msgs) : msgs.map(() => ({ ok: true })); } };
  const mail = createMailAdmin({ db, email, appUrl: 'https://app.example', sanitize: (h) => h, batchSize, dailyLimit: envLimit, now });
  return { mail, log, sent, emailsSent: () => sent.reduce((n, c) => n + c.msgs.length, 0) };
}

test('daily cap: sends at most 30 a day and leaves the rest for tomorrow', async () => {
  const h = cappedHarness({ waiting: people(100) });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.equal(h.emailsSent(), 30);
  assert.deepEqual([out.sent, out.failed, out.remaining, out.status, out.daily_limit, out.sent_today, out.allowance_left], [30, 0, 70, 'sending', 30, 30, 0]);
  assert.equal(out.resets_at, '2026-10-29T00:00:00.000Z');
});
test('daily cap: 20 subscribers with a limit of 30 sends exactly 20 and finishes the campaign', async () => {
  const h = cappedHarness({ waiting: people(20) });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.equal(h.emailsSent(), 20);
  assert.deepEqual([out.sent, out.remaining, out.status, out.allowance_left], [20, 0, 'sent', 10]);
  assert.ok(h.log.some((c) => c.op === 'update' && c.table === 'newsletter_campaigns' && c.v.status === 'sent'));
});
test('daily cap: emails already sent today (and in-flight claims) reduce the allowance; at the limit nothing is sent', async () => {
  const some = cappedHarness({ waiting: people(50), sentToday: 25 });
  assert.equal((await some.mail.campaigns.sendBatch(UUID)).sent, 5);
  const flying = cappedHarness({ waiting: people(50), sentToday: 20, inFlight: 8 });
  assert.equal((await flying.mail.campaigns.sendBatch(UUID)).sent, 2);
  const none = cappedHarness({ waiting: people(50), sentToday: 30 });
  const out = await none.mail.campaigns.sendBatch(UUID);
  assert.deepEqual([out.sent, out.failed, out.remaining, out.status, out.allowance_left], [0, 0, 50, 'sending', 0]);
  assert.equal(none.sent.length, 0);
  assert.equal(none.log.some((c) => c.op === 'insert' && c.table === 'newsletter_deliveries'), false); // nothing was even claimed
});
test('daily cap: the quota day is the UTC day (when Resend resets), counted from the email log', async () => {
  const h = cappedHarness({ waiting: people(5), now: () => new Date('2026-10-28T23:59:30Z') });
  await h.mail.campaigns.sendBatch(UUID);
  const count = h.log.find((c) => c.op === 'selectPage' && c.table === 'email_events');
  assert.deepEqual([count.q.type, count.q.status, count.q.created_at], ['eq.newsletter', 'eq.sent', 'gte.2026-10-28T00:00:00.000Z']);
  const next = cappedHarness({ waiting: people(5), sentToday: 0, now: () => new Date('2026-10-29T00:00:01Z') });
  await next.mail.campaigns.sendBatch(UUID);
  assert.equal(next.log.find((c) => c.op === 'selectPage' && c.table === 'email_events').q.created_at, 'gte.2026-10-29T00:00:00.000Z');
});
test('daily cap: the limit comes from the admin setting, then the environment, then 30; bad values are ignored', async () => {
  assert.equal((await cappedHarness({ waiting: people(40), settingLimit: 10 }).mail.campaigns.sendBatch(UUID)).sent, 10);
  assert.equal((await cappedHarness({ waiting: people(40), envLimit: 12 }).mail.campaigns.sendBatch(UUID)).sent, 12);
  assert.equal((await cappedHarness({ waiting: people(40), settingLimit: 'lots', envLimit: 12 }).mail.campaigns.sendBatch(UUID)).sent, 12);
  assert.equal((await cappedHarness({ waiting: people(40), settingLimit: 0 }).mail.campaigns.sendBatch(UUID)).sent, 30);
  assert.equal((await cappedHarness({ waiting: people(40), settingLimit: 99999 }).mail.campaigns.sendBatch(UUID)).sent, 30);
  assert.equal(cappedHarness({ settingLimit: 10 }).log.length, 0);
});
test('daily cap: a larger limit is sent in several small claims, each claimed before sending', async () => {
  const h = cappedHarness({ waiting: people(40), settingLimit: 12, batchSize: 5 });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.deepEqual(h.sent.map((c) => c.msgs.length), [5, 5, 2]);
  assert.equal(out.sent, 12);
  const kinds = h.log.filter((c) => (c.op === 'insert' || c.op === 'rpc') && (c.table === 'newsletter_deliveries' || c.name === 'newsletter_next_batch')).map((c) => c.op);
  assert.deepEqual(kinds.slice(0, 2), ['rpc', 'insert']);
});
test('daily cap: if the mail service rejects the batch the run stops, nothing is lost and the failures are retried on a later day', async () => {
  const h = cappedHarness({ waiting: people(40), batchSize: 10, sendResult: (m) => m.map(() => ({ ok: false, error: 'daily_quota_exhausted' })) });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.deepEqual([out.sent, out.failed, h.sent.length], [0, 10, 1]); // stopped after the first failed chunk
  assert.equal(h.log.filter((c) => c.op === 'update' && c.v?.status === 'failed').length, 10);
  assert.equal(out.sent_today, 0);
});
test('retries: earlier days\' failures go first, at most 3 attempts, and people who unsubscribed are dropped', async () => {
  const known = [{ ...person(1), status: 'active' }, { ...person(2), status: 'unsubscribed' }];
  const h = cappedHarness({ waiting: people(2, 10), failedRows: [{ subscriber_id: 's1', attempts: 1 }, { subscriber_id: 's2', attempts: 2 }], known });
  const out = await h.mail.campaigns.sendBatch(UUID);
  const claim = h.log.find((c) => c.op === 'update' && c.v?.status === 'pending');
  assert.deepEqual([claim.q.status, claim.q.attempts, claim.v.attempts], ['eq.failed', 'eq.1', 2]); // optimistic claim, attempts + 1
  const dropped = h.log.find((c) => c.op === 'update' && c.v?.error === 'no_longer_subscribed');
  assert.equal(dropped.v.attempts, 3);
  assert.deepEqual(h.sent[0].msgs.map((m) => m.to), ['u1@x.co', 'u10@x.co', 'u11@x.co']); // the retry first, then new people
  const select = h.log.find((c) => c.op === 'select' && c.table === 'newsletter_deliveries').q;
  assert.deepEqual([select.status, select.attempts, select.updated_at], ['eq.failed', 'lt.3', 'lt.2026-10-28T00:00:00.000Z']); // never retried on the same day
  assert.equal(out.sent, 3);
});
test('retries: a retry that another run already claimed is skipped, never emailed twice', async () => {
  const h = cappedHarness({ waiting: [], failedRows: [{ subscriber_id: 's1', attempts: 1 }], known: [{ ...person(1), status: 'active' }], retryLost: true });
  const out = await h.mail.campaigns.sendBatch(UUID);
  assert.deepEqual([out.sent, out.failed, h.sent.length], [0, 0, 0]);
});
test('pause and resume only apply in the right state, and a paused campaign sends nothing', async () => {
  const running = cappedHarness({ waiting: people(5) });
  assert.equal((await running.mail.campaigns.pause(UUID, ADMIN)).status, 'sending'); // mock returns the stored row; the update call is what matters
  assert.equal(running.log.find((c) => c.op === 'update' && c.table === 'newsletter_campaigns').v.status, 'paused');
  const paused = cappedHarness({ campaign: { ...sending, status: 'paused' }, waiting: people(5) });
  await assert.rejects(() => paused.mail.campaigns.sendBatch(UUID), (e) => e.status === 409 && /paused/.test(e.message));
  await paused.mail.campaigns.resume(UUID, ADMIN);
  assert.equal(paused.log.find((c) => c.op === 'update' && c.table === 'newsletter_campaigns').v.status, 'sending');
  assert.equal(paused.sent.length, 0);
  await assert.rejects(() => cappedHarness({ campaign: { ...sending, status: 'draft' } }).mail.campaigns.pause(UUID, ADMIN), (e) => e.status === 409);
  await assert.rejects(() => running.mail.campaigns.resume(UUID, ADMIN), (e) => e.status === 409);
  assert.ok(running.log.some((c) => c.table === 'audit_logs' && c.row.action === 'newsletter.pause'));
});
test('a running campaign reports today\'s usage, days left and an estimated finish date', async () => {
  const h = cappedHarness({ waiting: people(70), sentToday: 0 });
  const c = await h.mail.campaigns.get(UUID);
  assert.deepEqual([c.schedule.daily_limit, c.schedule.sent_today, c.schedule.allowance, c.schedule.days_left], [30, 0, 30, 3]);
  assert.equal(c.schedule.estimated_finish, '2026-10-30T00:00:00.000Z'); // 30 today, 30 tomorrow, 10 the day after
  const used = await cappedHarness({ waiting: people(70), sentToday: 30 }).mail.campaigns.get(UUID);
  assert.deepEqual([used.schedule.allowance, used.schedule.days_left, used.schedule.estimated_finish], [0, 3, '2026-10-31T00:00:00.000Z']);
  assert.equal((await cappedHarness({ campaign: { ...sending, status: 'draft' } }).mail.campaigns.get(UUID)).schedule, undefined);
  assert.equal(c.progress.total, 70);
});
test('daily runner: continues the oldest campaign; moves to the next one only when it finishes with allowance to spare', async () => {
  const first = { id: UUID, subject: 'One', content_html: '<p>A</p>', status: 'sending' };
  const second = { id: '22222222-2222-4222-8222-222222222222', subject: 'Two', content_html: '<p>B</p>', status: 'sending' };
  // Stateful stand-in: campaign "One" has 20 people waiting; once it is marked sent, "Two" becomes the oldest sending campaign.
  const rows = [first, second]; const waitingByCampaign = { [UUID]: 20, [second.id]: 50 }; const delivered = [];
  const db = {
    select: async (table, q) => { if (table === 'newsletter_campaigns') { const open = rows.filter((r) => r.status === 'sending'); return q.id ? rows.filter((r) => `eq.${r.id}` === q.id) : open.slice(0, 1); } return []; },
    selectPage: async (table) => ({ rows: [], total: table === 'email_events' ? delivered.length : 0 }),
    insert: async (t, r) => (Array.isArray(r) ? r : [r]),
    update: async (t, q, v) => { if (t === 'newsletter_campaigns' && v.status) rows.find((r) => `eq.${r.id}` === q.id).status = v.status; return [{ id: UUID }]; },
    remove: async () => [],
    rpc: async (name, args) => { if (name === 'newsletter_next_batch') { const n = Math.min(args.p_limit, waitingByCampaign[args.p_campaign]); waitingByCampaign[args.p_campaign] -= n; return people(n); } return waitingByCampaign[args.p_campaign]; },
  };
  const email = { send: async (msgs) => { delivered.push(...msgs); return msgs.map(() => ({ ok: true })); }, sendOne: async () => {} };
  const mail = createMailAdmin({ db, email, appUrl: 'https://app.example', sanitize: (h) => h });
  const runs = await mail.campaigns.processDaily();
  assert.deepEqual(runs.map((r) => [r.id, r.sent, r.status]), [[UUID, 20, 'sent'], [second.id, 10, 'sending']]); // 20 finished, then only the 10 left of today's 30
  assert.equal(delivered.length, 30);
  assert.deepEqual((await mail.campaigns.processDaily()).map((r) => r.sent), [0]); // calling again the same day sends nothing
});
