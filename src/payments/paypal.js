// PayPal Orders v2 (https://developer.paypal.com/docs/api/orders/v2/) and Webhooks verification. No SDK needed.
import { AppError } from '../errors.js';

const HOSTS = new Set(['https://api-m.sandbox.paypal.com', 'https://api-m.paypal.com']);
// Currencies PayPal accepts that use two decimal places (the amount checks below assume cents).
export const PAYPAL_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'NZD', 'HKD', 'PLN', 'MXN', 'BRL', 'ILS', 'MYR', 'PHP', 'THB', 'CNY']);

export class PayPalError extends Error {
  constructor(status, name, issue, debugId) { super(`PayPal ${status} ${name || ''} ${issue || ''}`.trim()); this.status = status; this.paypalName = name; this.issue = issue; this.debugId = debugId; }
}

export function createPayPalProvider({ env = process.env, fetchImpl, now = () => Date.now() } = {}) {
  let cached = null;
  const base = () => String(env.PAYPAL_BASE_URL ?? '').replace(/\/$/, '');
  const currency = () => String(env.PAYPAL_CURRENCY || 'USD').toUpperCase();
  const available = () => Boolean(HOSTS.has(base()) && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && PAYPAL_CURRENCIES.has(currency()));
  const f = (url, init) => (fetchImpl ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(Number(env.PAYMENT_TIMEOUT_MS) || 9000) });
  const unavailable = () => new AppError('PROVIDER_UNAVAILABLE', 'PayPal payments are not available right now.', 503);

  async function accessToken() {
    if (!available()) throw unavailable();
    if (cached && cached.expires > now() + 30_000) return cached.value;
    let res;
    try {
      res = await f(`${base()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
    } catch { throw new AppError('PAYMENT_PROVIDER_ERROR', 'PayPal could not be reached.', 502); }
    if (!res.ok) { console.error(JSON.stringify({ level: 'error', msg: 'paypal_auth_failed', status: res.status })); throw new AppError('PAYMENT_PROVIDER_ERROR', 'Could not authenticate with PayPal.', 502); }
    const data = await res.json();
    cached = { value: data.access_token, expires: now() + Number(data.expires_in || 300) * 1000 };
    return cached.value;
  }

  async function call(method, path, { body, requestId } = {}) {
    const token = await accessToken();
    let res;
    try {
      res = await f(`${base()}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new AppError('PAYMENT_PROVIDER_ERROR', 'PayPal could not be reached.', 502); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new PayPalError(res.status, data?.name, data?.details?.[0]?.issue, data?.debug_id);
    return data;
  }
  const providerFailure = (error, action) => {
    if (error instanceof AppError) return error;
    console.error(JSON.stringify({ level: 'error', msg: 'paypal_request_failed', action, status: error.status, name: error.paypalName, issue: error.issue, debug_id: error.debugId }));
    return new AppError('PAYMENT_PROVIDER_ERROR', 'The payment provider rejected the request.', 502);
  };

  // Reduce a PayPal order to the fields we verify. Amounts are compared by us against our own database record.
  const normalizeOrder = (order) => {
    const unit = order?.purchase_units?.[0] ?? {};
    const capture = unit.payments?.captures?.[0];
    return {
      orderId: order?.id, status: order?.status, customId: unit.custom_id ?? capture?.custom_id ?? null,
      capture: capture ? { id: capture.id, status: capture.status, amount: capture.amount?.value, currency: capture.amount?.currency_code } : null,
    };
  };

  return {
    name: 'paypal',
    label: 'PayPal',
    get currency() { return currency(); },
    available,
    unavailableReason: () => (available() ? null : 'PayPal is not configured.'),
    normalizeOrder,

    async createOrder({ paymentId, amount, description, returnUrl, cancelUrl }) {
      try {
        const order = await call('POST', '/v2/checkout/orders', {
          requestId: paymentId,
          body: {
            intent: 'CAPTURE',
            purchase_units: [{ reference_id: paymentId, custom_id: paymentId, description: String(description).slice(0, 120), amount: { currency_code: currency(), value: amount } }],
            payment_source: { paypal: { experience_context: { brand_name: 'Eliah Tech', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: returnUrl, cancel_url: cancelUrl } } },
          },
        });
        const link = order.links?.find((l) => ['payer-action', 'approve'].includes(l.rel))?.href;
        let host = '';
        try { host = new URL(link).hostname; } catch { host = ''; }
        if (!order.id || !host.endsWith('paypal.com')) throw new PayPalError(502, 'BAD_ORDER_RESPONSE');
        return { orderId: order.id, approvalUrl: link };
      } catch (error) { throw providerFailure(error, 'create_order'); }
    },

    async getOrder(orderId) {
      try { return normalizeOrder(await call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)); } catch (error) { throw providerFailure(error, 'get_order'); }
    },

    // Returns the normalized order, or { declined: true } / { notApproved: true } for expected outcomes.
    async captureOrder(orderId, requestId) {
      try { return normalizeOrder(await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { requestId })); } catch (error) {
        if (error instanceof PayPalError) {
          if (error.issue === 'ORDER_ALREADY_CAPTURED') return this.getOrder(orderId);
          if (error.issue === 'INSTRUMENT_DECLINED' || error.issue === 'TRANSACTION_REFUSED') return { declined: true };
          if (error.issue === 'ORDER_NOT_APPROVED' || error.issue === 'PAYER_ACTION_REQUIRED') return { notApproved: true };
        }
        throw providerFailure(error, 'capture_order');
      }
    },

    // Uses PayPal's own verification endpoint with the webhook ID from the dashboard.
    async verifyWebhook({ headers, rawBody }) {
      if (!env.PAYPAL_WEBHOOK_ID) throw new AppError('PROVIDER_UNAVAILABLE', 'PayPal webhooks are not configured.', 503);
      let event;
      try { event = JSON.parse(rawBody); } catch { return false; }
      const h = (name) => headers[name];
      if (!h('paypal-transmission-id') || !h('paypal-transmission-sig') || !h('paypal-transmission-time') || !h('paypal-cert-url') || !h('paypal-auth-algo')) return false;
      try {
        const result = await call('POST', '/v1/notifications/verify-webhook-signature', {
          body: { auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'), transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event },
        });
        return result?.verification_status === 'SUCCESS';
      } catch (error) { throw providerFailure(error, 'verify_webhook'); }
    },
  };
}
