// Double opt-in newsletter: subscribe -> emailed confirmation link -> verify; unsubscribe by token. No account enumeration.
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import { DatabaseError } from './supabase.js';
import { normalizeEmail } from './validate.js';
import { newsletterVerify } from './email-templates.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const VERIFY_COOLDOWN_MS = 2 * 60 * 1000;
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createNewsletterService({ db, email, appUrl, now = () => Date.now() }) {
  const invalid = () => new AppError('INVALID_TOKEN', 'This link is invalid or has expired.', 400);

  async function sendConfirmation(address, token) {
    await email.sendOne({ to: address, ...newsletterVerify({ url: `${appUrl}/newsletter/confirm?token=${encodeURIComponent(token)}` }) }, { type: 'newsletter_verify' });
  }

  return {
    // Always resolves the same way for valid addresses, whether or not they are already subscribed.
    async subscribe(rawEmail) {
      const address = normalizeEmail(rawEmail);
      if (!address) throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.', 400);
      const [existing] = await db.select('subscribers', { select: 'id,status,verify_sent_at', email: `eq.${address}`, limit: '1' });
      if (existing?.status === 'active') return;
      if (existing?.status === 'pending' && existing.verify_sent_at && now() - Date.parse(existing.verify_sent_at) < VERIFY_COOLDOWN_MS) return;
      const token = newToken();
      const fields = { status: 'pending', verify_token_hash: hashToken(token), verify_sent_at: new Date(now()).toISOString(), unsubscribed_at: null };
      if (existing) await db.update('subscribers', { id: `eq.${existing.id}` }, fields);
      else {
        try { await db.insert('subscribers', { email: address, ...fields }, { prefer: 'return=minimal' }); } catch (error) {
          if (error instanceof DatabaseError && error.detail?.code === '23505') return; // a concurrent request created it
          throw error;
        }
      }
      await sendConfirmation(address, token);
    },

    async verify(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw invalid();
      const [row] = await db.select('subscribers', { select: 'id,verify_sent_at', verify_token_hash: `eq.${hashToken(token)}`, status: 'eq.pending', limit: '1' });
      if (!row || now() - Date.parse(row.verify_sent_at) > VERIFY_TTL_MS) throw invalid();
      await db.update('subscribers', { id: `eq.${row.id}` }, { status: 'active', verified_at: new Date(now()).toISOString(), verify_token_hash: null });
    },

    async unsubscribe(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw invalid();
      const [row] = await db.select('subscribers', { select: 'id,status', unsubscribe_token: `eq.${token}`, limit: '1' });
      if (!row) throw invalid();
      if (row.status !== 'unsubscribed') await db.update('subscribers', { id: `eq.${row.id}` }, { status: 'unsubscribed', unsubscribed_at: new Date(now()).toISOString(), verify_token_hash: null });
    },
  };
}
