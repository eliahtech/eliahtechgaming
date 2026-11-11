// Payment emails through the shared mailer (src/email.js). Always best effort: a mail failure never changes a payment.
// Called only on a real state change (newly completed / newly failed), so repeated IPNs cannot send duplicates.
import { paymentInitiated, paymentSucceeded, paymentFailed } from '../email-templates.js';
import { normalizeEmail } from '../validate.js';

export function createPaymentNotifier({ db, email, env = process.env, fetchImpl } = {}) {
  async function recipient(userId) {
    const base = String(env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key || !userId) return null;
    try {
      const res = await (fetchImpl ?? globalThis.fetch)(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const user = await res.json();
      const [profile] = await db.select('profiles', { select: 'display_name', id: `eq.${userId}`, limit: '1' }).catch(() => []);
      return { to: normalizeEmail(user?.email), name: profile?.display_name || 'there' };
    } catch { return null; }
  }
  const labelOf = { pesapal: 'PesaPal', paypal: 'PayPal' };
  async function send(kind, payment, extra = {}) {
    if (!email) return false;
    try {
      const who = await recipient(payment.user_id);
      if (!who?.to) return false;
      const data = { name: who.name, plan: payment.metadata?.plan_name ?? 'Premium', amount: payment.amount, currency: payment.currency, provider: labelOf[payment.provider] ?? payment.provider, reference: payment.merchant_reference ?? payment.id, ...extra };
      const message = kind === 'initiated' ? paymentInitiated(data) : kind === 'succeeded' ? paymentSucceeded(data) : paymentFailed(data);
      await email.sendOne({ to: who.to, ...message }, { type: `payment_${kind}` });
      return true;
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'payment_email_failed', kind, code: error?.code }));
      return false;
    }
  }
  return { initiated: (p) => send('initiated', p), succeeded: (p, expiresAt) => send('succeeded', p, { expiresAt }), failed: (p) => send('failed', p) };
}
