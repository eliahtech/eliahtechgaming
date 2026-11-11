// Admin operations for the contact inbox, newsletter subscribers/campaigns and the email log.
import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { isUuid } from '../validate.js';
import { contactReply, newsletterIssue } from '../email-templates.js';
import { MAX_ATTEMPTS, allowanceFor, clampLimit, daysLeft, estimatedFinish, nextUtcDay, utcDayStart } from '../newsletter-schedule.js';

const cleanTerm = (v) => String(v || '').replace(/[^\p{L}\p{N}\s@.+_-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const MESSAGE_STATUSES = ['unread', 'read', 'replied', 'archived'];
const SUBSCRIBER_STATUSES = ['pending', 'active', 'unsubscribed'];
const notFound = (what) => new AppError('NOT_FOUND', `${what} not found.`, 404);
const needUuid = (id, what) => { if (!isUuid(id)) throw notFound(what); };

export const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Newsletters go out at most `daily limit` emails per UTC day (admin setting "newsletter-sending", env NEWSLETTER_DAILY_LIMIT, default 30)
// so the free Resend quota is never exhausted and sign-up, payment and contact emails keep working. `batchSize` is the most emails
// claimed per database round trip (max 50).
export function createMailAdmin({ db, email, appUrl, sanitize, batchSize = 50, dailyLimit, now = () => new Date() }) {
  const chunkSize = Math.min(Math.max(Number(batchSize) || 50, 1), 50);
  const ctx = (actor, ip) => ({ actorId: actor.id, ip });

  // ---- Contact inbox ----
  const inbox = {
    async list({ q, status, limit, offset }) {
      const query = { select: 'id,name,email,subject,status,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) };
      if (MESSAGE_STATUSES.includes(status)) query.status = `eq.${status}`;
      const term = cleanTerm(q);
      if (term) query.or = `(name.ilike.*${term}*,email.ilike.*${term}*,subject.ilike.*${term}*)`;
      const { rows, total } = await db.selectPage('messages', query);
      return { items: rows, meta: { total, limit, offset } };
    },
    async get(id) {
      needUuid(id, 'Message');
      const [message] = await db.select('messages', { select: 'id,name,email,subject,message,status,created_at', id: `eq.${id}`, limit: '1' });
      if (!message) throw notFound('Message');
      const replies = await db.select('message_replies', { select: 'id,body,admin_id,created_at', message_id: `eq.${id}`, order: 'created_at.asc' });
      return { ...message, replies };
    },
    async setStatus(id, status, actor, ip) {
      needUuid(id, 'Message');
      if (!['unread', 'read', 'archived'].includes(status)) throw new AppError('VALIDATION_ERROR', 'Status must be unread, read or archived.', 422);
      const rows = await db.update('messages', { id: `eq.${id}` }, { status });
      if (!rows.length) throw notFound('Message');
      await audit(db, { ...ctx(actor, ip), action: 'message.status', targetType: 'messages', targetId: id, metadata: { status } });
      return { id, status };
    },
    async reply(id, body, actor, ip) {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text.length < 2 || text.length > 5000) throw new AppError('VALIDATION_ERROR', 'Reply must be 2 to 5000 characters.', 422);
      const message = await inbox.get(id);
      // Send first: a reply is only recorded (and the message marked replied) once the email was accepted for delivery.
      await email.sendOne({ to: message.email, ...contactReply({ name: message.name, body: text, originalSubject: message.subject, originalMessage: message.message }) }, { type: 'contact_reply' });
      await db.insert('message_replies', { message_id: id, admin_id: actor.id, body: text }, { prefer: 'return=minimal' });
      await db.update('messages', { id: `eq.${id}` }, { status: 'replied' });
      await audit(db, { ...ctx(actor, ip), action: 'message.reply', targetType: 'messages', targetId: id });
      return inbox.get(id);
    },
    async remove(id, actor, ip) {
      needUuid(id, 'Message');
      const rows = await db.remove('messages', { id: `eq.${id}` });
      if (!rows.length) throw notFound('Message');
      await audit(db, { ...ctx(actor, ip), action: 'message.delete', targetType: 'messages', targetId: id });
    },
  };

  // ---- Subscribers ----
  const subscribers = {
    async list({ q, status, limit, offset }) {
      const query = { select: 'id,email,status,subscribed_at,verified_at,unsubscribed_at', order: 'subscribed_at.desc', limit: String(limit), offset: String(offset) };
      if (SUBSCRIBER_STATUSES.includes(status)) query.status = `eq.${status}`;
      const term = cleanTerm(q);
      if (term) query.email = `ilike.*${term}*`;
      const { rows, total } = await db.selectPage('subscribers', query);
      return { items: rows, meta: { total, limit, offset } };
    },
    async exportCsv(status, actor, ip) {
      const lines = ['email,status,subscribed_at,verified_at'];
      for (let offset = 0; offset < 50000; offset += 1000) {
        const { items } = await subscribers.list({ status, limit: 1000, offset });
        lines.push(...items.map((s) => [s.email, s.status, s.subscribed_at, s.verified_at].map(csvCell).join(',')));
        if (items.length < 1000) break;
      }
      await audit(db, { ...ctx(actor, ip), action: 'subscribers.export', targetType: 'subscribers', metadata: { status: status || 'all', rows: lines.length - 1 } });
      return `${lines.join('\r\n')}\r\n`;
    },
    // Admins may unsubscribe or delete, but never activate: activation requires the subscriber's own confirmation.
    async unsubscribe(id, actor, ip) {
      needUuid(id, 'Subscriber');
      const rows = await db.update('subscribers', { id: `eq.${id}` }, { status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), verify_token_hash: null });
      if (!rows.length) throw notFound('Subscriber');
      await audit(db, { ...ctx(actor, ip), action: 'subscriber.unsubscribe', targetType: 'subscribers', targetId: id });
    },
    async remove(id, actor, ip) {
      needUuid(id, 'Subscriber');
      const rows = await db.remove('subscribers', { id: `eq.${id}` });
      if (!rows.length) throw notFound('Subscriber');
      await audit(db, { ...ctx(actor, ip), action: 'subscriber.delete', targetType: 'subscribers', targetId: id });
    },
  };

  // ---- Newsletter campaigns ----
  const campaigns = {
    async list({ limit, offset }) {
      const { rows, total } = await db.selectPage('newsletter_campaigns', { select: 'id,subject,status,created_at,started_at,completed_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) });
      return { items: rows, meta: { total, limit, offset } };
    },
    // ---- daily quota ----
    async limit() {
      const [row] = await db.select('settings', { select: 'value', key: 'eq.newsletter-sending', limit: '1' });
      return clampLimit(row?.value?.daily_limit, clampLimit(dailyLimit));
    },
    // Emails accepted today (UTC) plus rows claimed but not finished, so concurrent runs cannot overshoot the limit.
    async usage() {
      const day = utcDayStart(now()).toISOString();
      const [limit, sent, flying] = await Promise.all([
        campaigns.limit(),
        db.selectPage('email_events', { select: 'id', type: 'eq.newsletter', status: 'eq.sent', created_at: `gte.${day}`, limit: '1' }).then((r) => r.total),
        db.selectPage('newsletter_deliveries', { select: 'subscriber_id', status: 'eq.pending', updated_at: `gte.${day}`, limit: '1' }).then((r) => r.total),
      ]);
      return { daily_limit: limit, sent_today: sent, in_flight: flying, allowance: allowanceFor({ limit, sentToday: sent, inFlight: flying }), resets_at: nextUtcDay(now()).toISOString() };
    },
    async get(id) {
      needUuid(id, 'Campaign');
      const [row] = await db.select('newsletter_campaigns', { select: 'id,subject,content_html,status,created_at,started_at,completed_at', id: `eq.${id}`, limit: '1' });
      if (!row) throw notFound('Campaign');
      const count = (status, extra = {}) => db.selectPage('newsletter_deliveries', { select: 'subscriber_id', campaign_id: `eq.${id}`, status: `eq.${status}`, ...extra, limit: '1' }).then((r) => r.total);
      const [sent, failed, pending, fresh, retryable] = await Promise.all([
        count('sent'), count('failed'), count('pending'),
        db.rpc('newsletter_remaining', { p_campaign: id }),
        count('failed', { attempts: `lt.${MAX_ATTEMPTS}` }),
      ]);
      const waiting = Number(fresh) || 0; const remaining = waiting + retryable;
      const out = { ...row, progress: { sent, failed, pending, remaining, retryable, total: sent + failed + pending + waiting } };
      if (row.status === 'sending' || row.status === 'paused') {
        const usage = await campaigns.usage();
        out.schedule = { ...usage, days_left: daysLeft({ remaining, limit: usage.daily_limit, allowance: usage.allowance }), estimated_finish: estimatedFinish({ remaining, limit: usage.daily_limit, allowance: usage.allowance, now: now() })?.toISOString() ?? null };
      }
      return out;
    },
    parse(body) {
      const subject = typeof body?.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : '';
      const content = typeof body?.content_html === 'string' ? sanitize(body.content_html) : '';
      if (subject.length < 2 || subject.length > 150) throw new AppError('VALIDATION_ERROR', 'Subject must be 2 to 150 characters.', 422);
      if (content.replace(/<[^>]*>/g, '').trim().length < 2) throw new AppError('VALIDATION_ERROR', 'The newsletter needs some content.', 422);
      return { subject, content_html: content };
    },
    async create(body, actor, ip) {
      const [row] = await db.insert('newsletter_campaigns', { ...campaigns.parse(body), created_by: actor.id });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.create', targetType: 'newsletter_campaigns', targetId: row.id });
      return campaigns.get(row.id);
    },
    async update(id, body, actor, ip) {
      const current = await campaigns.get(id);
      if (current.status !== 'draft') throw new AppError('CONFLICT', 'Only drafts can be edited.', 409);
      await db.update('newsletter_campaigns', { id: `eq.${id}` }, campaigns.parse(body));
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.update', targetType: 'newsletter_campaigns', targetId: id });
      return campaigns.get(id);
    },
    async remove(id, actor, ip) {
      const current = await campaigns.get(id);
      if (current.status === 'sending') throw new AppError('CONFLICT', 'A campaign that is sending cannot be deleted.', 409);
      await db.remove('newsletter_campaigns', { id: `eq.${id}` });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.delete', targetType: 'newsletter_campaigns', targetId: id });
    },
    async sendTest(id, to) {
      const campaign = await campaigns.get(id);
      await email.sendOne({ to, ...newsletterIssue({ subject: `[Test] ${campaign.subject}`, contentHtml: campaign.content_html, unsubscribeUrl: `${appUrl}/newsletter/unsubscribe?token=test` }) }, { type: 'newsletter_test', campaignId: id });
    },
    async start(id, actor, ip) {
      const campaign = await campaigns.get(id);
      if (campaign.status === 'sent') throw new AppError('CONFLICT', 'This campaign has already been sent.', 409);
      if (campaign.status === 'draft') await db.update('newsletter_campaigns', { id: `eq.${id}` }, { status: 'sending', started_at: new Date().toISOString() });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.send_start', targetType: 'newsletter_campaigns', targetId: id });
      return campaigns.get(id);
    },
    async pause(id, actor, ip) {
      const campaign = await campaigns.get(id);
      if (campaign.status !== 'sending') throw new AppError('CONFLICT', 'Only a campaign that is sending can be paused.', 409);
      await db.update('newsletter_campaigns', { id: `eq.${id}` }, { status: 'paused' }, { prefer: 'return=minimal' });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.pause', targetType: 'newsletter_campaigns', targetId: id });
      return campaigns.get(id);
    },
    async resume(id, actor, ip) {
      const campaign = await campaigns.get(id);
      if (campaign.status !== 'paused') throw new AppError('CONFLICT', 'Only a paused campaign can be resumed.', 409);
      await db.update('newsletter_campaigns', { id: `eq.${id}` }, { status: 'sending' }, { prefer: 'return=minimal' });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.resume', targetType: 'newsletter_campaigns', targetId: id });
      return campaigns.get(id);
    },
    // Claims up to `want` recipients for this run. Rows are inserted/updated as pending BEFORE any email is sent, so two concurrent
    // runs can never email the same subscriber twice. Earlier days' failures get another try first (oldest first, at most
    // MAX_ATTEMPTS in total), then people who have not been tried yet. `exhausted` means nobody else is waiting.
    async claim(id, want, dayStartIso) {
      const claimed = [];
      const failedRows = await db.select('newsletter_deliveries', { select: 'subscriber_id,attempts', campaign_id: `eq.${id}`, status: 'eq.failed', attempts: `lt.${MAX_ATTEMPTS}`, updated_at: `lt.${dayStartIso}`, order: 'updated_at.asc', limit: String(want) });
      if (failedRows.length) {
        const people = await db.select('subscribers', { select: 'id,email,unsubscribe_token,status', id: `in.(${failedRows.map((r) => r.subscriber_id).join(',')})` });
        const byId = new Map(people.map((p) => [p.id, p]));
        const stamp = new Date().toISOString();
        for (const row of failedRows) {
          const person = byId.get(row.subscriber_id);
          if (!person || person.status !== 'active') { await db.update('newsletter_deliveries', { campaign_id: `eq.${id}`, subscriber_id: `eq.${row.subscriber_id}` }, { attempts: MAX_ATTEMPTS, error: 'no_longer_subscribed', updated_at: stamp }, { prefer: 'return=minimal' }); continue; }
          const won = await db.update('newsletter_deliveries', { campaign_id: `eq.${id}`, subscriber_id: `eq.${row.subscriber_id}`, status: 'eq.failed', attempts: `eq.${row.attempts}` }, { status: 'pending', attempts: row.attempts + 1, updated_at: stamp }, { prefer: 'return=representation' });
          if (won.length) claimed.push(person);
        }
      }
      const space = want - claimed.length;
      const candidates = space > 0 ? await db.rpc('newsletter_next_batch', { p_campaign: id, p_limit: space }) : [];
      if (candidates.length) {
        const inserted = await db.insert('newsletter_deliveries', candidates.map((p) => ({ campaign_id: id, subscriber_id: p.id, status: 'pending' })), { query: { on_conflict: 'campaign_id,subscriber_id' }, prefer: 'resolution=ignore-duplicates,return=representation' });
        const mine = new Set(inserted.map((r) => r.subscriber_id));
        claimed.push(...candidates.filter((p) => mine.has(p.id)));
      }
      return { claimed, exhausted: failedRows.length < want && candidates.length < space };
    },
    async deliver(campaign, claimed) {
      const id = campaign.id ?? undefined;
      const results = await email.send(claimed.map((p) => ({ to: p.email, ...newsletterIssue({ subject: campaign.subject, contentHtml: campaign.content_html, unsubscribeUrl: `${appUrl}/newsletter/unsubscribe?token=${p.unsubscribe_token}` }), headers: { 'List-Unsubscribe': `${appUrl}/newsletter/unsubscribe?token=${p.unsubscribe_token}` } })), { type: 'newsletter', campaignId: id });
      const okIds = claimed.filter((_, i) => results[i].ok).map((p) => p.id);
      const stamp = new Date().toISOString();
      if (okIds.length) await db.update('newsletter_deliveries', { campaign_id: `eq.${id}`, subscriber_id: `in.(${okIds.join(',')})` }, { status: 'sent', updated_at: stamp }, { prefer: 'return=minimal' });
      await Promise.all(claimed.map((p, i) => (results[i].ok ? null : db.update('newsletter_deliveries', { campaign_id: `eq.${id}`, subscriber_id: `eq.${p.id}` }, { status: 'failed', error: results[i].error ?? 'send_failed', updated_at: stamp }, { prefer: 'return=minimal' }))));
      return { sent: okIds.length, failed: claimed.length - okIds.length };
    },
    // Sends today's share of one campaign: never more than the daily allowance, and only to people still waiting
    // (so 20 subscribers with a limit of 30 sends 20). Safe to call any number of times: once the allowance is used it sends nothing.
    async sendBatch(id) {
      const campaign = await campaigns.get(id);
      if (campaign.status === 'paused') throw new AppError('CONFLICT', 'This campaign is paused. Resume it to continue sending.', 409);
      if (campaign.status !== 'sending') throw new AppError('CONFLICT', 'Start the campaign before sending batches.', 409);
      const usage = await campaigns.usage();
      const dayStartIso = utcDayStart(now()).toISOString();
      const began = Date.now();
      let sent = 0; let failed = 0;
      while (usage.allowance - sent - failed > 0 && Date.now() - began < 40_000) {
        const want = Math.min(usage.allowance - sent - failed, chunkSize);
        const { claimed, exhausted } = await campaigns.claim(id, want, dayStartIso);
        if (!claimed.length) break;
        const result = await campaigns.deliver({ ...campaign, id }, claimed);
        sent += result.sent; failed += result.failed;
        if (exhausted || result.sent === 0) break; // nobody left, or the mail service is failing: stop for today
      }
      const fresh = await campaigns.get(id);
      let status = 'sending';
      if (fresh.progress.remaining === 0) { status = 'sent'; await db.update('newsletter_campaigns', { id: `eq.${id}` }, { status: 'sent', completed_at: new Date().toISOString() }, { prefer: 'return=minimal' }); }
      const used = sent; // failures are not accepted by the mail service, so they do not use today's quota
      return { sent, failed, remaining: fresh.progress.remaining, status, daily_limit: usage.daily_limit, sent_today: usage.sent_today + used, allowance_left: Math.max(0, usage.allowance - used - failed), resets_at: usage.resets_at };
    },
    // Called once a day by the scheduler: continues the oldest sending campaign and, if it finishes with allowance to spare, the next one.
    async processDaily() {
      const runs = [];
      for (let i = 0; i < 3; i += 1) {
        const [next] = await db.select('newsletter_campaigns', { select: 'id', status: 'eq.sending', order: 'started_at.asc', limit: '1' });
        if (!next) break;
        const result = await campaigns.sendBatch(next.id);
        runs.push({ id: next.id, ...result });
        if (result.status !== 'sent' || result.allowance_left <= 0) break;
      }
      return runs;
    },
    // Makes failed (and abandoned pending) deliveries eligible again, e.g. after the daily mail quota resets.
    async requeue(id, actor, ip) {
      const campaign = await campaigns.get(id);
      await db.remove('newsletter_deliveries', { campaign_id: `eq.${id}`, status: 'in.(failed,pending)' });
      if (campaign.status === 'sent') await db.update('newsletter_campaigns', { id: `eq.${id}` }, { status: 'sending', completed_at: null }, { prefer: 'return=minimal' });
      await audit(db, { ...ctx(actor, ip), action: 'newsletter.requeue', targetType: 'newsletter_campaigns', targetId: id });
      return campaigns.get(id);
    },
  };

  const emailEvents = {
    async list({ limit, offset }) {
      const { rows, total } = await db.selectPage('email_events', { select: 'id,type,to_email,status,error,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) });
      return { items: rows, meta: { total, limit, offset } };
    },
  };

  return { inbox, subscribers, campaigns, emailEvents };
}
