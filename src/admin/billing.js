import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { isUuid } from '../validate.js';

const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'cancelled', 'refunded'];
const SUB_STATUSES = ['active', 'expired', 'cancelled'];
const PROVIDERS = ['pesapal', 'paypal'];
const PAYMENT_LIST = 'id,user_id,provider,transaction_id,provider_order_id,merchant_reference,amount,currency,status,failure_reason,created_at,completed_at,metadata,profiles(display_name)';
const REFERENCE_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_RE = /^[a-z0-9-]{2,40}$/;

export function createBillingAdmin({ db }) {
  const page = (rows, total, limit, offset) => ({ items: rows, meta: { total, limit, offset } });
  return {
    // Server-side filtering and pagination. Every filter value is validated against a strict pattern before it reaches PostgREST.
    async listPayments({ status, provider, currency, from, to, user, reference, plan, limit, offset }) {
      const query = { select: PAYMENT_LIST, order: 'created_at.desc', limit: String(limit), offset: String(offset) };
      if (PAYMENT_STATUSES.includes(status)) query.status = `eq.${status}`;
      if (PROVIDERS.includes(provider)) query.provider = `eq.${provider}`;
      if (typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)) query.currency = `eq.${currency.toUpperCase()}`;
      if (isUuid(user)) query.user_id = `eq.${user}`;
      if (typeof plan === 'string' && PLAN_RE.test(plan)) query['metadata->>plan_code'] = `eq.${plan}`;
      if (typeof reference === 'string' && REFERENCE_RE.test(reference)) query.or = `(merchant_reference.eq.${reference},provider_order_id.eq.${reference},transaction_id.eq.${reference})`;
      const range = [];
      if (typeof from === 'string' && DAY_RE.test(from) && !Number.isNaN(Date.parse(from))) range.push(['gte', `${from}T00:00:00Z`]);
      if (typeof to === 'string' && DAY_RE.test(to) && !Number.isNaN(Date.parse(to))) range.push(['lte', `${to}T23:59:59.999Z`]);
      if (range.length === 1) query.created_at = `${range[0][0]}.${range[0][1]}`;
      if (range.length === 2) query.and = `(created_at.gte.${range[0][1]},created_at.lte.${range[1][1]})`;
      const { rows, total } = await db.selectPage('payments', query);
      return page(rows, total, limit, offset);
    },
    // Real numbers from the database (see payment_analytics() in the migration). Nothing is estimated here.
    async analytics() {
      const result = await db.rpc('payment_analytics');
      return Array.isArray(result) ? result[0] : result;
    },
    async getPayment(id) {
      if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
      const [payment] = await db.select('payments', { select: `${PAYMENT_LIST},plan_id,payment_method`, id: `eq.${id}`, limit: '1' });
      if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
      const events = await db.select('payment_events', { select: 'id,event_type,tracking_id,processed,error_message,received_at', payment_id: `eq.${id}`, order: 'received_at.asc' });
      return { ...payment, events };
    },
    async listSubscriptions({ status, limit, offset }) {
      const query = { select: 'id,user_id,plan,status,started_at,expires_at,payment_provider,payment_id,profiles(display_name)', order: 'expires_at.desc', limit: String(limit), offset: String(offset) };
      if (SUB_STATUSES.includes(status)) query.status = `eq.${status}`;
      const { rows, total } = await db.selectPage('subscriptions', query);
      return page(rows, total, limit, offset);
    },
    // Complimentary access (support, giveaways). Recorded as a manual subscription and audited.
    async grant({ userId, days, note }, actor, ip) {
      const n = Number(days);
      if (!isUuid(userId)) throw new AppError('VALIDATION_ERROR', 'Choose a user.', 422);
      if (!Number.isInteger(n) || n < 1 || n > 3660) throw new AppError('VALIDATION_ERROR', 'Days must be a whole number from 1 to 3660.', 422);
      const [profile] = await db.select('profiles', { select: 'id', id: `eq.${userId}`, limit: '1' });
      if (!profile) throw new AppError('NOT_FOUND', 'User not found.', 404);
      const [current] = await db.select('subscriptions', { select: 'expires_at', user_id: `eq.${userId}`, status: 'eq.active', expires_at: `gt.${new Date().toISOString()}`, order: 'expires_at.desc', limit: '1' });
      const start = new Date(Math.max(Date.now(), current ? Date.parse(current.expires_at) : 0));
      const end = new Date(start.getTime() + n * 86400000);
      const [row] = await db.insert('subscriptions', { user_id: userId, plan: 'complimentary', status: 'active', started_at: start.toISOString(), expires_at: end.toISOString(), payment_provider: 'manual' });
      await audit(db, { actorId: actor.id, action: 'subscription.grant', targetType: 'subscriptions', targetId: row.id, metadata: { user_id: userId, days: n, note: typeof note === 'string' ? note.slice(0, 200) : null }, ip });
      return row;
    },
    async cancel(id, actor, ip) {
      if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
      const rows = await db.update('subscriptions', { id: `eq.${id}`, status: 'eq.active' }, { status: 'cancelled', expires_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (!rows.length) throw new AppError('NOT_FOUND', 'No active subscription with that id.', 404);
      await audit(db, { actorId: actor.id, action: 'subscription.cancel', targetType: 'subscriptions', targetId: id, ip });
      return rows[0];
    },
  };
}
