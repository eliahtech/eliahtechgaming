// Optional: route Supabase Auth emails (signup confirmation, password reset, magic link) through our own mailer instead of
// Supabase's built-in one. Enable it under Supabase > Authentication > Hooks > Send Email (HTTPS) pointing at
// POST /api/v1/hooks/auth-email, and copy the generated secret to SUPABASE_AUTH_HOOK_SECRET.
// Supabase still generates and validates every token; this code only delivers the link it is handed.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { AUTH_TYPES, authEmail } from './email-templates.js';
import { normalizeEmail } from './validate.js';

// Standard Webhooks signature: base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), header "v1,<sig> [v1,<sig>...]".
export function verifyWebhook({ secret, headers, rawBody, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const id = headers['webhook-id']; const timestamp = headers['webhook-timestamp']; const signatures = headers['webhook-signature'];
  if (!secret || !id || !timestamp || !signatures || typeof rawBody !== 'string') return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return String(signatures).split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function buildAuthEmail(payload, { supabaseUrl }) {
  const to = normalizeEmail(payload?.user?.email);
  const data = payload?.email_data ?? {};
  const type = data.email_action_type;
  if (!to || !AUTH_TYPES.includes(type)) throw new AppError('UNSUPPORTED_EMAIL_TYPE', `Unsupported auth email type: ${String(type).slice(0, 40)}`, 400);
  if (type === 'reauthentication') return { to, ...authEmail({ type, code: data.token }) };
  if (!data.token_hash) throw new AppError('INVALID_PAYLOAD', 'Missing token.', 400);
  const link = new URL('/auth/v1/verify', supabaseUrl);
  link.searchParams.set('token', data.token_hash);
  link.searchParams.set('type', type);
  if (data.redirect_to) link.searchParams.set('redirect_to', data.redirect_to);
  return { to, ...authEmail({ type, url: link.toString() }) };
}
