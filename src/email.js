// Email delivery through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-batch-emails).
// The backend is the only caller. Resend only delivers mail: it never issues, stores or validates auth tokens.
// Set RESEND_API_KEY and EMAIL_FROM (an address on a domain you verified in Resend, e.g. "Eliah Tech <no-reply@example.com>").
import { AppError } from './errors.js';
import { ConfigError } from './supabase.js';
import { normalizeEmail } from './validate.js';

const API_URL = 'https://api.resend.com/emails/batch';
const MAX_BATCH = 100; // Resend's limit per batch request
const oneLine = (value, max) => String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, max);
// Only List-Unsubscribe may be set by callers, and only to a single https URL (no header injection, no arbitrary headers).
const cleanHeaders = (headers) => {
  const url = oneLine(headers?.['List-Unsubscribe'], 500).replace(/^<|>$/g, '');
  return /^https:\/\/[^\s<>]+$/.test(url) ? { 'List-Unsubscribe': `<${url}>` } : undefined;
};

export function createEmailService({ db, fetchImpl, env = process.env } = {}) {
  const config = () => {
    const apiKey = env.RESEND_API_KEY ?? '';
    const from = oneLine(env.EMAIL_FROM, 200);
    if (!apiKey || !/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) throw new ConfigError('Email is not configured. Set RESEND_API_KEY and EMAIL_FROM (for example "Eliah Tech <no-reply@yourdomain.com>").');
    return { apiKey, from };
  };

  const logEvents = async (rows) => {
    try { await db.insert('email_events', rows, { prefer: 'return=minimal' }); } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'email_event_log_failed', code: error.code }));
    }
  };

  async function sendChunk(chunk, { apiKey, from }) {
    const payload = chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}), ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(m.headers ? { headers: m.headers } : {}) }));
    try {
      const res = await (fetchImpl ?? globalThis.fetch)(API_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(Number(env.EMAIL_TIMEOUT_MS) || 8000),
      });
      const body = await res.json().catch(() => null);
      // A batch is accepted or rejected as a whole by Resend, so every message in it shares the outcome.
      if (!res.ok || !Array.isArray(body?.data) || body.data.length !== chunk.length) throw new Error(body?.message || body?.error?.message || `mail_service_status_${res.status}`);
      return chunk.map(() => ({ ok: true }));
    } catch (error) {
      const reason = oneLine(error?.message || 'mail_service_unreachable', 200);
      console.error(JSON.stringify({ level: 'error', msg: 'email_send_failed', reason }));
      return chunk.map(() => ({ ok: false, error: reason }));
    }
  }

  // Sends a batch; returns one { ok, error } per message (same order). Delivery failures are results, not exceptions.
  async function send(messages, { type, campaignId = null } = {}) {
    const cfg = config();
    const clean = messages.map((m) => ({ to: normalizeEmail(m.to), subject: oneLine(m.subject, 200), html: String(m.html ?? ''), text: String(m.text ?? ''), replyTo: m.replyTo ? normalizeEmail(m.replyTo) ?? undefined : undefined, headers: cleanHeaders(m.headers) }));
    if (!clean.length || clean.some((m) => !m.to || !m.subject || !m.html)) throw new AppError('VALIDATION_ERROR', 'Each email needs a valid recipient, subject and body.', 422);

    const results = [];
    for (let i = 0; i < clean.length; i += MAX_BATCH) results.push(...await sendChunk(clean.slice(i, i + MAX_BATCH), cfg));
    await logEvents(clean.map((m, i) => ({ type, to_email: m.to, status: results[i].ok ? 'sent' : 'failed', error: results[i].error ?? null, campaign_id: campaignId })));
    return results;
  }

  async function sendOne(message, meta) {
    const [result] = await send([message], meta);
    if (!result.ok) throw new AppError('EMAIL_FAILED', 'The email could not be sent. Please try again shortly.', 502);
  }

  return { send, sendOne };
}
