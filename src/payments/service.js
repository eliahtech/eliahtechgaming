// Payment orchestration. Rules this file enforces:
//  - The browser names a plan and a provider; price, currency and duration come from the database.
//  - Nothing is "paid" because a browser says so. Access is granted only after the provider's own API confirms it:
//    PayPal: order lookup/capture or a signature-verified webhook. PesaPal: GetTransactionStatus (its callback and IPN carry no
//    status, so they only tell us WHICH order to ask about). Amount, currency and reference must match our own record.
//  - Granting access is done by Postgres functions that are atomic and idempotent, so webhook retries cannot double-grant.
import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { isUuid } from '../validate.js';
import { newMerchantReference, MERCHANT_REFERENCE_RE } from './pesapal.js';

const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/;
const cents = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN; };
const first = (rows) => (Array.isArray(rows) ? rows[0] : rows);
const PAYMENT_COLUMNS = 'id,user_id,provider,amount,currency,status,provider_order_id,transaction_id,merchant_reference,plan_id,metadata,created_at,completed_at';
const TRACKING_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/;

// Only what PesaPal needs, validated, taken from the account (email, name) plus two optional fields the customer typed. Never stored.
export function buildBilling(user, contact = {}) {
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (!email) throw new AppError('VALIDATION_ERROR', 'Your account has no email address.', 422);
  const phone = contact.phone_number === undefined || contact.phone_number === null || contact.phone_number === '' ? null : String(contact.phone_number).trim();
  if (phone !== null && !PHONE_RE.test(phone)) throw new AppError('VALIDATION_ERROR', 'Enter a valid phone number or leave it empty.', 422);
  const country = contact.country_code === undefined || contact.country_code === null || contact.country_code === '' ? null : String(contact.country_code).trim().toUpperCase();
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw new AppError('VALIDATION_ERROR', 'Country must be a 2-letter code such as KE.', 422);
  const [first = '', ...rest] = String(user.profile?.display_name ?? '').trim().split(/\s+/).filter(Boolean);
  return { email_address: email, ...(phone ? { phone_number: phone } : {}), ...(country ? { country_code: country } : {}), ...(first ? { first_name: first.slice(0, 40) } : {}), ...(rest.length ? { last_name: rest.join(' ').slice(0, 40) } : {}) };
}

export const paymentView = (p) => ({
  id: p.id, status: p.status, provider: p.provider, amount: p.amount, currency: p.currency, plan: p.metadata?.plan_name ?? null,
  created_at: p.created_at, completed_at: p.completed_at ?? null, ...(p.expires_at ? { expires_at: p.expires_at } : {}),
});

export function createPaymentService({ db, providers, appUrl, notifier = null }) {
  const providerByName = (name) => {
    const p = typeof name === 'string' && Object.hasOwn(providers, name) ? providers[name] : null;
    if (!p) throw new AppError('VALIDATION_ERROR', 'Choose a valid payment method.', 422);
    return p;
  };
  const loadOwned = async (userId, paymentId) => {
    if (!isUuid(paymentId)) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    const [row] = await db.select('payments', { select: PAYMENT_COLUMNS, id: `eq.${paymentId}`, user_id: `eq.${userId}`, limit: '1' });
    if (!row) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    return row;
  };
  const byOrder = async (provider, orderId) => {
    if (typeof orderId !== 'string' || !orderId) return null;
    return (await db.select('payments', { select: PAYMENT_COLUMNS, provider: `eq.${provider}`, provider_order_id: `eq.${orderId}`, limit: '1' }))[0] ?? null;
  };
  const byTransaction = async (provider, transactionId) => {
    if (typeof transactionId !== 'string' || !transactionId) return null;
    return (await db.select('payments', { select: PAYMENT_COLUMNS, provider: `eq.${provider}`, transaction_id: `eq.${transactionId}`, limit: '1' }))[0] ?? null;
  };
  const byMerchantReference = async (reference) => {
    if (typeof reference !== 'string' || !MERCHANT_REFERENCE_RE.test(reference)) return null;
    return (await db.select('payments', { select: PAYMENT_COLUMNS, provider: 'eq.pesapal', merchant_reference: `eq.${reference}`, limit: '1' }))[0] ?? null;
  };
  const byId = async (id) => (isUuid(id) ? (await db.select('payments', { select: PAYMENT_COLUMNS, id: `eq.${id}`, limit: '1' }))[0] ?? null : null);

  async function fail(payment, status, reason, source) {
    const result = first(await db.rpc('payment_fail', { p_payment_id: payment.id, p_status: status, p_reason: reason }));
    if (result?.out_changed) {
      await audit(db, { action: `payment.${status}`, targetType: 'payments', targetId: payment.id, metadata: { provider: payment.provider, reason, source } });
      if (status === 'failed') await notifier?.failed(payment);
    }
    return { ...payment, status: result?.out_status ?? payment.status };
  }

  // Decide what a provider order means for our payment record.
  async function finalize(payment, order, source) {
    const capture = order?.capture;
    if (!capture) {
      if (order?.status === 'VOIDED') return fail(payment, 'cancelled', 'order_voided', source);
      return payment;
    }
    if (capture.status === 'COMPLETED') {
      const matches = order.customId === payment.id && cents(capture.amount) === cents(payment.amount) && capture.currency === payment.currency;
      if (!matches) {
        console.error(JSON.stringify({ level: 'error', msg: 'payment_mismatch', payment_id: payment.id, provider: payment.provider }));
        const failed = await fail(payment, 'failed', 'amount_or_reference_mismatch', source);
        await audit(db, { action: 'payment.mismatch', targetType: 'payments', targetId: payment.id, metadata: { provider: payment.provider, expected: { amount: payment.amount, currency: payment.currency }, received: { amount: capture.amount, currency: capture.currency }, source } });
        return failed;
      }
      const result = first(await db.rpc('payment_complete', { p_payment_id: payment.id, p_transaction_id: capture.id, p_metadata: { order_status: order.status, confirmed_via: source } }));
      if (result?.out_newly_completed) {
        await audit(db, { action: 'payment.completed', targetType: 'payments', targetId: payment.id, metadata: { provider: payment.provider, source, expires_at: result.out_expires_at } });
        await audit(db, { action: 'subscription.activated', targetType: 'payments', targetId: payment.id, metadata: { provider: payment.provider, expires_at: result.out_expires_at } });
        await notifier?.succeeded(payment, result.out_expires_at);
      }
      return { ...payment, status: result?.out_status ?? payment.status, expires_at: result?.out_expires_at ?? null, completed_at: new Date().toISOString() };
    }
    if (['DECLINED', 'FAILED'].includes(capture.status)) return fail(payment, 'failed', `capture_${capture.status.toLowerCase()}`, source);
    return payment; // PENDING (under review) etc.: wait for the webhook
  }

  // ---------------- PesaPal ----------------
  // Turns PesaPal's authoritative transaction status into our payment state. Every completion check happens here.
  async function applyPesaPal(payment, tx, source) {
    const mismatch = async (reason) => {
      console.error(JSON.stringify({ level: 'error', msg: 'payment_mismatch', payment_id: payment.id, provider: 'pesapal', reason }));
      await audit(db, { action: 'payment.mismatch', targetType: 'payments', targetId: payment.id, metadata: { provider: 'pesapal', reason, expected: { amount: payment.amount, currency: payment.currency, merchant_reference: payment.merchant_reference }, received: { amount: tx.amount, currency: tx.currency, merchant_reference: tx.merchantReference }, source } });
    };
    if (tx.merchantReference !== payment.merchant_reference || tx.trackingId !== payment.provider_order_id) {
      await mismatch('merchant_reference_mismatch');
      return tx.status === 'completed' ? fail(payment, 'failed', 'merchant_reference_mismatch', source) : payment;
    }
    switch (tx.status) {
      case 'completed': {
        if (tx.currency !== payment.currency) { await mismatch('currency_mismatch'); return fail(payment, 'failed', 'currency_mismatch', source); }
        if (cents(tx.amount) !== cents(payment.amount)) { await mismatch('amount_mismatch'); return fail(payment, 'failed', 'amount_mismatch', source); }
        const result = first(await db.rpc('payment_complete', { p_payment_id: payment.id, p_transaction_id: payment.provider_order_id, p_metadata: { payment_method: tx.paymentMethod, provider_reference: tx.confirmationCode, confirmed_via: source } }));
        if (result?.out_newly_completed) {
          await db.update('payments', { id: `eq.${payment.id}` }, { payment_method: tx.paymentMethod ?? 'pesapal', updated_at: new Date().toISOString() }).catch(() => null);
          await audit(db, { action: 'payment.completed', targetType: 'payments', targetId: payment.id, metadata: { provider: 'pesapal', source, payment_method: tx.paymentMethod, expires_at: result.out_expires_at } });
          await audit(db, { action: 'subscription.activated', targetType: 'payments', targetId: payment.id, metadata: { provider: 'pesapal', expires_at: result.out_expires_at } });
          await notifier?.succeeded(payment, result.out_expires_at);
        }
        return { ...payment, status: result?.out_status ?? payment.status, expires_at: result?.out_expires_at ?? null, completed_at: new Date().toISOString() };
      }
      case 'failed': return fail(payment, 'failed', 'pesapal_failed', source);
      case 'reversed': {
        if (payment.status === 'completed') {
          const result = first(await db.rpc('payment_refund', { p_payment_id: payment.id, p_metadata: { refund_event: 'pesapal_reversed' } }));
          if (result?.out_changed) await audit(db, { action: 'payment.refunded', targetType: 'payments', targetId: payment.id, metadata: { provider: 'pesapal', event: 'REVERSED' } });
          return { ...payment, status: result?.out_status ?? payment.status };
        }
        return fail(payment, 'failed', 'pesapal_reversed', source);
      }
      default: return payment; // pending or unknown: grant nothing, wait for the next IPN
    }
  }
  // A failed attempt may still be paid on the same PesaPal order, and a completed payment can still be REVERSED; only refunded is final.
  const settleable = (p) => p.status !== 'refunded';
  const needsConfirmation = (p) => !['completed', 'refunded'].includes(p.status); // browser return: no point re-asking once paid

  // Shared by the IPN and the browser callback. Neither request carries a status, so the ONLY input trusted from them is
  // which order to look up; the result always comes from GetTransactionStatus.
  async function processPesaPal({ trackingId, merchantReference, type, source }) {
    const provider = providers.pesapal;
    if (typeof trackingId !== 'string' || !TRACKING_RE.test(trackingId)) throw new AppError('VALIDATION_ERROR', 'Missing or invalid OrderTrackingId.', 400);
    if (typeof merchantReference !== 'string' || !MERCHANT_REFERENCE_RE.test(merchantReference)) throw new AppError('VALIDATION_ERROR', 'Missing or invalid OrderMerchantReference.', 400);
    const notificationType = typeof type === 'string' && /^[A-Z]{3,20}$/.test(type) ? type : 'UNKNOWN';

    const payment = await byMerchantReference(merchantReference);
    if (!payment) throw new AppError('NOT_FOUND', 'Unknown payment.', 404);
    if (payment.provider_order_id && payment.provider_order_id !== trackingId) {
      await audit(db, { action: 'pesapal.ipn_rejected', targetType: 'payments', targetId: payment.id, metadata: { reason: 'tracking_id_mismatch', source } });
      throw new AppError('VALIDATION_ERROR', 'Tracking id does not belong to this payment.', 400);
    }
    await audit(db, { action: 'pesapal.ipn_received', targetType: 'payments', targetId: payment.id, metadata: { type: notificationType, source, tracking_id: trackingId } });

    const tx = await provider.getTransactionStatus(trackingId);
    await audit(db, { action: 'pesapal.transaction_verified', targetType: 'payments', targetId: payment.id, metadata: { status: tx.status, status_code: tx.statusCode, amount: tx.amount, currency: tx.currency, source } });

    // The IPN can beat our own write of the tracking id. PesaPal itself vouches that this order carries our reference, so adopt it.
    let current = payment;
    if (!payment.provider_order_id) {
      if (tx.merchantReference !== payment.merchant_reference) throw new AppError('VALIDATION_ERROR', 'Tracking id does not belong to this payment.', 400);
      await db.update('payments', { id: `eq.${payment.id}`, provider_order_id: 'is.null' }, { provider_order_id: trackingId, updated_at: new Date().toISOString() });
      current = { ...payment, provider_order_id: trackingId };
    }

    const eventId = `${trackingId}:${notificationType}:${tx.status}:${tx.statusCode ?? 'x'}`;
    const [seen] = await db.select('payment_events', { select: 'id', provider: 'eq.pesapal', event_id: `eq.${eventId}`, limit: '1' });
    if (seen) return { duplicate: true, payment: current, tx };

    const result = settleable(current) ? await applyPesaPal(current, tx, source) : current;
    await db.insert('payment_events', {
      provider: 'pesapal', event_id: eventId, event_type: notificationType, payment_id: payment.id, tracking_id: trackingId, merchant_reference: merchantReference,
      payload: { status: tx.status, status_code: tx.statusCode, payment_method: tx.paymentMethod, amount: tx.amount, currency: tx.currency },
      processed: tx.status !== 'unknown', processed_at: new Date().toISOString(), error_message: tx.status === 'unknown' ? 'unknown_provider_status' : null,
    }, { query: { on_conflict: 'provider,event_id' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    return { duplicate: false, payment: result, tx };
  }

  return {
    async plans() {
      return db.select('premium_plans', { select: 'code,name,description,duration_days,prices', enabled: 'eq.true', order: 'sort_order.asc,created_at.asc' });
    },

    providerList() {
      return Object.values(providers).map((p) => ({ name: p.name, label: p.label, currency: p.currency, available: p.available(), ...(p.available() ? {} : { reason: p.unavailableReason() }) }));
    },

    async checkout({ user, planCode, providerName, contact = {} }) {
      if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email address before subscribing.', 403);
      const provider = providerByName(providerName);
      if (!provider.available()) throw new AppError('PROVIDER_UNAVAILABLE', `${provider.label} is not available right now.`, 503);
      const [setting] = await db.select('settings', { select: 'value', key: 'eq.premium', limit: '1' });
      if (setting?.value?.status !== 'available') throw new AppError('PAYMENTS_DISABLED', 'Premium subscriptions are not open yet.', 409);
      if (typeof planCode !== 'string' || !/^[a-z0-9-]{2,40}$/.test(planCode)) throw new AppError('VALIDATION_ERROR', 'Choose a plan.', 422);
      const [plan] = await db.select('premium_plans', { select: 'id,code,name,duration_days,prices', code: `eq.${planCode}`, enabled: 'eq.true', limit: '1' });
      if (!plan) throw new AppError('NOT_FOUND', 'That plan is not available.', 404);
      const amount = String(plan.prices?.[provider.currency] ?? '');
      if (!AMOUNT_RE.test(amount) || cents(amount) <= 0) throw new AppError('PLAN_NOT_AVAILABLE', `This plan has no ${provider.currency} price for ${provider.label}.`, 409);

      const billing = provider.name === 'pesapal' ? buildBilling(user, contact) : undefined; // validated before any record exists
      // The record exists before the provider is called, so a fast webhook/IPN always finds it.
      let payment = null;
      for (let attempt = 0; !payment; attempt += 1) {
        const merchantReference = provider.name === 'pesapal' ? newMerchantReference() : undefined;
        try {
          [payment] = await db.insert('payments', { user_id: user.id, provider: provider.name, amount, currency: provider.currency, status: 'pending', payment_method: provider.name, plan_id: plan.id, ...(merchantReference ? { merchant_reference: merchantReference } : {}), metadata: { plan_code: plan.code, plan_name: plan.name, duration_days: plan.duration_days } });
        } catch (error) {
          if (!merchantReference || error?.detail?.code !== '23505' || attempt >= 2) throw error; // reference collision: draw another
        }
      }
      try {
        const order = await provider.createOrder({ paymentId: payment.id, amount, description: `Eliah Tech Premium - ${plan.name}`, returnUrl: `${appUrl}/payment/return?payment=${payment.id}`, cancelUrl: `${appUrl}/payment/cancel?payment=${payment.id}`, merchantReference: payment.merchant_reference, billing });
        await db.update('payments', { id: `eq.${payment.id}` }, { provider_order_id: order.orderId, updated_at: new Date().toISOString() });
        if (notifier) await Promise.race([notifier.initiated(payment), new Promise((resolve) => setTimeout(resolve, 2500))]);
        await audit(db, { actorId: user.id, action: `${provider.name}.order_created`, targetType: 'payments', targetId: payment.id, metadata: { amount, currency: provider.currency, merchant_reference: payment.merchant_reference ?? null } });
        return { payment_id: payment.id, provider: provider.name, approval_url: order.approvalUrl };
      } catch (error) {
        await fail(payment, 'failed', 'provider_error', 'checkout');
        throw error;
      }
    },

    // Called when the browser returns from the provider. It asks the provider what happened; it never believes the browser.
    async confirm({ user, paymentId }) {
      const payment = await loadOwned(user.id, paymentId);
      if (payment.provider === 'pesapal') {
        if (!needsConfirmation(payment) || !payment.provider_order_id) return paymentView(payment);
        const { payment: result } = await processPesaPal({ trackingId: payment.provider_order_id, merchantReference: payment.merchant_reference, type: 'CALLBACKURL', source: 'return' });
        return paymentView(result);
      }
      if (payment.status !== 'pending' || !payment.provider_order_id) return paymentView(payment);
      const provider = providerByName(payment.provider);
      let order = await provider.getOrder(payment.provider_order_id);
      if (order.status === 'APPROVED') {
        const captured = await provider.captureOrder(order.orderId, payment.id);
        if (captured.declined) return paymentView(await fail(payment, 'failed', 'instrument_declined', 'return'));
        if (!captured.notApproved) order = captured;
      }
      return paymentView(await finalize(payment, order, 'return'));
    },

    async cancel({ user, paymentId }) {
      const payment = await loadOwned(user.id, paymentId);
      if (payment.status !== 'pending') return paymentView(payment);
      if (payment.provider === 'pesapal') {
        // Reaching the cancellation URL proves nothing: only PesaPal's own status can fail or complete the payment.
        if (!payment.provider_order_id) return paymentView(payment);
        const { payment: result } = await processPesaPal({ trackingId: payment.provider_order_id, merchantReference: payment.merchant_reference, type: 'CANCELLATION', source: 'cancel' });
        return paymentView(result);
      }
      if (payment.provider_order_id) {
        const order = await providerByName(payment.provider).getOrder(payment.provider_order_id);
        if (['APPROVED', 'COMPLETED'].includes(order.status)) return paymentView(payment); // the customer did pay: let confirm finish it
      }
      return paymentView(await fail(payment, 'cancelled', 'user_cancelled', 'return'));
    },

    async myPayments(userId) {
      const rows = await db.select('payments', { select: 'id,provider,amount,currency,status,created_at,completed_at,metadata', user_id: `eq.${userId}`, order: 'created_at.desc', limit: '50' });
      return rows.map(paymentView);
    },

    async mySubscriptions(userId) {
      return db.select('subscriptions', { select: 'id,plan,status,started_at,expires_at,payment_provider', user_id: `eq.${userId}`, order: 'expires_at.desc', limit: '50' });
    },

    // PesaPal IPN (POST JSON body, or GET query). Returns the acknowledgement PesaPal documents; errors are thrown.
    async handlePesaPalIpn({ params }) {
      const { duplicate, payment } = await processPesaPal({ trackingId: params?.OrderTrackingId, merchantReference: params?.OrderMerchantReference, type: params?.OrderNotificationType, source: 'ipn' });
      return { orderNotificationType: params.OrderNotificationType, orderTrackingId: params.OrderTrackingId, orderMerchantReference: params.OrderMerchantReference, status: 200, duplicate, payment_status: payment.status };
    },

    // Browser callback: verifies with PesaPal, then tells the route which of OUR pages to show. Never throws to the browser.
    async handlePesaPalCallback({ params }) {
      try {
        const { payment } = await processPesaPal({ trackingId: params?.OrderTrackingId, merchantReference: params?.OrderMerchantReference, type: params?.OrderNotificationType, source: 'callback' });
        return { redirectTo: `/payment/return?payment=${payment.id}` };
      } catch (error) {
        if (!(error instanceof AppError)) console.error(JSON.stringify({ level: 'error', msg: 'pesapal_callback_failed', code: error.code }));
        const row = typeof params?.OrderMerchantReference === 'string' ? await byMerchantReference(params.OrderMerchantReference).catch(() => null) : null;
        return { redirectTo: row ? `/payment/return?payment=${row.id}` : '/premium' };
      }
    },
    handlePesaPalCancel({ paymentId }) { return { redirectTo: isUuid(paymentId) ? `/payment/cancel?payment=${paymentId}` : '/premium' }; },

    async handlePayPalWebhook({ headers, rawBody }) {
      const provider = providers.paypal;
      if (!(await provider.verifyWebhook({ headers, rawBody }))) throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature.', 401);
      const event = JSON.parse(rawBody);
      if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') throw new AppError('VALIDATION_ERROR', 'Malformed event.', 400);
      const [seen] = await db.select('payment_events', { select: 'id', provider: 'eq.paypal', event_id: `eq.${event.id}`, limit: '1' });
      if (seen) return { duplicate: true };

      const resource = event.resource ?? {};
      let payment = null;
      switch (event.event_type) {
        case 'CHECKOUT.ORDER.APPROVED': {
          payment = await byOrder('paypal', resource.id);
          if (payment?.status === 'pending') {
            const captured = await provider.captureOrder(resource.id, payment.id);
            if (captured.declined) await fail(payment, 'failed', 'instrument_declined', 'webhook');
            else if (!captured.notApproved) await finalize(payment, captured, 'webhook');
          }
          break;
        }
        case 'PAYMENT.CAPTURE.COMPLETED': {
          const orderId = resource.supplementary_data?.related_ids?.order_id;
          payment = (await byOrder('paypal', orderId)) ?? (await byId(resource.custom_id));
          // Re-read the order from PayPal instead of trusting fields in the event body.
          if (payment?.status === 'pending' && payment.provider_order_id) await finalize(payment, await provider.getOrder(payment.provider_order_id), 'webhook');
          break;
        }
        case 'PAYMENT.CAPTURE.DENIED':
        case 'PAYMENT.CAPTURE.DECLINED': {
          payment = (await byOrder('paypal', resource.supplementary_data?.related_ids?.order_id)) ?? (await byId(resource.custom_id));
          if (payment) await fail(payment, 'failed', 'capture_denied', 'webhook');
          break;
        }
        case 'PAYMENT.CAPTURE.REFUNDED':
        case 'PAYMENT.CAPTURE.REVERSED': {
          const up = resource.links?.find((l) => l.rel === 'up')?.href;
          const captureId = up ? up.split('/').filter(Boolean).pop() : resource.id;
          payment = await byTransaction('paypal', captureId);
          // Only a full refund/chargeback ends access; a partial refund is recorded in the event log only.
          const refunded = resource.amount?.value;
          if (payment && (refunded === undefined || cents(refunded) >= cents(payment.amount))) {
            const result = first(await db.rpc('payment_refund', { p_payment_id: payment.id, p_metadata: { refund_event: event.event_type } }));
            if (result?.out_changed) await audit(db, { action: 'payment.refunded', targetType: 'payments', targetId: payment.id, metadata: { provider: 'paypal', event: event.event_type } });
          }
          break;
        }
        default: break; // other event types are accepted and logged
      }
      await db.insert('payment_events', { provider: 'paypal', event_id: event.id, event_type: event.event_type, payment_id: payment?.id ?? null }, { query: { on_conflict: 'provider,event_id' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
      return { duplicate: false, handled: Boolean(payment) };
    },
  };
}
