// Email delivery through the Brevo HTTP API (https://developers.brevo.com/reference/send-transac-email) or, when no Brevo key
// is set, through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-batch-emails).
// The backend is the only caller. The mail service only delivers mail: it never issues, stores or validates auth tokens.
// Set BREVO_API_KEY (or RESEND_API_KEY) and EMAIL_FROM, an address the provider has verified for you, e.g. "Eliah Tech <no-reply@yourdomain.com>".
// If both keys are set, Brevo is used.
import { AppError } from './errors.js';
import { ConfigError } from './supabase.js';
import { normalizeEmail } from './validate.js';

const API_URL = 'https://api.resend.com/emails/batch';
const MAX_BATCH = 100; // Resend's limit per batch request
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_PARALLEL = 5; // Brevo takes one message per request here, so a few are sent at the same time
const oneLine = (value, max) => String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, max);
// Only List-Unsubscribe may be set by callers, and only to a single https URL (no header injection, no arbitrary headers).
const cleanHeaders = (headers) => {
  const url = oneLine(headers?.['List-Unsubscribe'], 500).replace(/^<|>$/g, '');
  return /^https:\/\/[^\s<>]+$/.test(url) ? { 'List-Unsubscribe': `<${url}>` } : undefined;
};

// "Eliah Tech <no-reply@x.com>" -> { name: 'Eliah Tech', email: 'no-reply@x.com' }; a bare address -> { email }.
const parseFrom = (from) => {
  const match = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(from);
  if (!match) return { email: from };
  const name = match[1].replace(/^["']|["']$/g, '').trim().slice(0, 70);
  return { email: match[2], ...(name ? { name } : {}) };
};

export function createEmailService({ db, fetchImpl, env = process.env } = {}) {
  const config = () => {
    const brevoKey = String(env.BREVO_API_KEY ?? '').trim();
    const apiKey = brevoKey || (env.RESEND_API_KEY ?? '');
    const from = oneLine(env.EMAIL_FROM, 200);
    if (!apiKey || !/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) throw new ConfigError('Email is not configured. Set BREVO_API_KEY (or RESEND_API_KEY) and EMAIL_FROM (for example "Eliah Tech <no-reply@yourdomain.com>").');
    return { provider: brevoKey ? 'brevo' : 'resend', apiKey, from };
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

  // Brevo: one request per message. A failure only affects that message. Brevo does not accept the standard List-Unsubscribe
  // header on this endpoint ("standard email headers are not supported"), so it is not sent; every newsletter already carries
  // its own personal unsubscribe link in the body.
  async function sendBrevoOne(m, { apiKey, from }) {
    try {
      const res = await (fetchImpl ?? globalThis.fetch)(BREVO_URL, {
        method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(Number(env.EMAIL_TIMEOUT_MS) || 8000),
        body: JSON.stringify({ sender: parseFrom(from), to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, ...(m.text ? { textContent: m.text } : {}), ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ? `${body.code ? `${body.code}: ` : ''}${body.message}` : `mail_service_status_${res.status}`);
      return { ok: true };
    } catch (error) {
      const reason = oneLine(error?.message || 'mail_service_unreachable', 200);
      console.error(JSON.stringify({ level: 'error', msg: 'email_send_failed', provider: 'brevo', reason }));
      return { ok: false, error: reason };
    }
  }

  // Sends a batch; returns one { ok, error } per message (same order). Delivery failures are results, not exceptions.
  async function send(messages, { type, campaignId = null } = {}) {
    const cfg = config();
    const clean = messages.map((m) => ({ to: normalizeEmail(m.to), subject: oneLine(m.subject, 200), html: String(m.html ?? ''), text: String(m.text ?? ''), replyTo: m.replyTo ? normalizeEmail(m.replyTo) ?? undefined : undefined, headers: cleanHeaders(m.headers) }));
    if (!clean.length || clean.some((m) => !m.to || !m.subject || !m.html)) throw new AppError('VALIDATION_ERROR', 'Each email needs a valid recipient, subject and body.', 422);

    const results = [];
    if (cfg.provider === 'brevo') for (let i = 0; i < clean.length; i += BREVO_PARALLEL) results.push(...await Promise.all(clean.slice(i, i + BREVO_PARALLEL).map((m) => sendBrevoOne(m, cfg))));
    else for (let i = 0; i < clean.length; i += MAX_BATCH) results.push(...await sendChunk(clean.slice(i, i + MAX_BATCH), cfg));
    await logEvents(clean.map((m, i) => ({ type, to_email: m.to, status: results[i].ok ? 'sent' : 'failed', error: results[i].error ?? null, campaign_id: campaignId })));
    return results;
  }

  async function sendOne(message, meta) {
    const [result] = await send([message], meta);
    if (!result.ok) throw new AppError('EMAIL_FAILED', 'The email could not be sent. Please try again shortly.', 502);
  }

  return { send, sendOne };
}
