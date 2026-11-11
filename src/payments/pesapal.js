// PesaPal API 3.0 (REST/JSON) provider. Official docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
// Endpoints used (all relative to the environment base + "/api"):
//   POST Auth/RequestToken              consumer_key + consumer_secret -> bearer token (valid for at most 5 minutes)
//   POST URLSetup/RegisterIPN           url + ipn_notification_type -> ipn_id (used as notification_id when ordering)
//   GET  URLSetup/GetIpnList            registered IPN URLs (setup script only)
//   POST Transactions/SubmitOrderRequest -> order_tracking_id, merchant_reference, redirect_url
//   GET  Transactions/GetTransactionStatus?orderTrackingId=  -> the only trusted source of a payment's result
// The callback and IPN requests carry NO payment status (PesaPal's own rule), so nothing here ever reads a status from them.
import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';

// The ONE place environment URLs live (docs: sandbox https://cybqa.pesapal.com/pesapalv3, live https://pay.pesapal.com/v3).
export const PESAPAL_BASES = Object.freeze({ sandbox: 'https://cybqa.pesapal.com/pesapalv3', live: 'https://pay.pesapal.com/v3' });
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;

// Resolves PESAPAL_ENV (+ optional PESAPAL_BASE_URL, which must be one of the two official hosts and agree with PESAPAL_ENV).
export function pesapalConfig(env = process.env) {
  const environment = String(env.PESAPAL_ENV || 'sandbox').toLowerCase();
  if (!Object.hasOwn(PESAPAL_BASES, environment)) return { ok: false, reason: 'PESAPAL_ENV must be "sandbox" or "live".' };
  const base = String(env.PESAPAL_BASE_URL || PESAPAL_BASES[environment]).replace(/\/$/, '');
  if (base !== PESAPAL_BASES[environment]) return { ok: false, reason: `PESAPAL_BASE_URL must be ${PESAPAL_BASES[environment]} when PESAPAL_ENV=${environment}.` };
  const appUrl = String(env.APP_URL || '').replace(/\/$/, '');
  const callbackUrl = env.PESAPAL_CALLBACK_URL || (appUrl ? `${appUrl}/api/v1/payments/pesapal/callback` : '');
  const cancellationUrl = env.PESAPAL_CANCELLATION_URL || (appUrl ? `${appUrl}/api/v1/payments/pesapal/cancel` : '');
  const currency = String(env.PESAPAL_CURRENCY || 'KES').toUpperCase();
  return { ok: true, environment, base: `${base}/api`, callbackUrl, cancellationUrl, currency, ipnId: String(env.PESAPAL_IPN_ID || '').trim() };
}

// Merchant reference: ET-YYYYMMDD-XXXXXXXXXX. Only A-Z, 0-9 and dashes, 22 characters (PesaPal allows 50 and [A-Za-z0-9-_.:]).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newMerchantReference(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  const bytes = randomBytes(10);
  return `ET-${day}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}
export const MERCHANT_REFERENCE_RE = /^[A-Za-z0-9._:-]{1,50}$/;

// PesaPal's documented payment_status_description / status_code values: INVALID(0), COMPLETED(1), FAILED(2), REVERSED(3).
// INVALID is what an order that has not been paid yet reports, so it maps to "pending", never to "failed".
// Anything else (or a code/description disagreement) is "unknown": it is logged and treated as still pending.
const BY_CODE = { 0: 'pending', 1: 'completed', 2: 'failed', 3: 'reversed' };
const BY_DESCRIPTION = { INVALID: 'pending', COMPLETED: 'completed', FAILED: 'failed', REVERSED: 'reversed' };
export function normalizeStatus(statusCode, description) {
  const hasCode = !(statusCode === '' || statusCode === null || statusCode === undefined);
  const hasText = String(description ?? '').trim() !== '';
  if (!hasCode && !hasText) return 'unknown';
  const code = hasCode ? BY_CODE[Number(statusCode)] : undefined;
  const text = hasText ? BY_DESCRIPTION[String(description).trim().toUpperCase()] : undefined;
  // Every value PesaPal sends must be recognised, and the code and description must agree, before we believe it.
  if ((hasCode && !code) || (hasText && !text)) return 'unknown';
  if (code && text && code !== text) return 'unknown';
  return code ?? text;
}

export function createPesaPalProvider({ env = process.env, fetchImpl, now = () => Date.now() } = {}) {
  const config = () => pesapalConfig(env);
  const f = (url, init) => (fetchImpl ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(Number(env.PAYMENT_TIMEOUT_MS) || 9000) });
  const providerError = (message = 'PesaPal could not be reached.') => new AppError('PAYMENT_PROVIDER_ERROR', message, 502);
  const available = () => {
    const c = config();
    return Boolean(c.ok && env.PESAPAL_CONSUMER_KEY && env.PESAPAL_CONSUMER_SECRET && GUID_RE.test(c.ipnId) && CURRENCY_RE.test(c.currency) && /^https:\/\//.test(c.callbackUrl));
  };
  const unavailableReason = () => {
    const c = config();
    if (!c.ok) return c.reason;
    if (!env.PESAPAL_CONSUMER_KEY || !env.PESAPAL_CONSUMER_SECRET) return 'PesaPal credentials are not configured.';
    if (!GUID_RE.test(c.ipnId)) return 'PesaPal IPN has not been registered (set PESAPAL_IPN_ID; see docs/payments.md).';
    if (!CURRENCY_RE.test(c.currency)) return 'PESAPAL_CURRENCY must be a 3-letter code.';
    if (!/^https:\/\//.test(c.callbackUrl)) return 'PesaPal needs an https callback URL (set APP_URL or PESAPAL_CALLBACK_URL).';
    return null;
  };

  // ---- Token service: server-side only, cached in memory per instance, refreshed before it expires. ----
  let cached = null;
  let inflight = null;
  async function requestToken() {
    const c = config();
    if (!c.ok || !env.PESAPAL_CONSUMER_KEY || !env.PESAPAL_CONSUMER_SECRET) throw new AppError('PROVIDER_UNAVAILABLE', 'PesaPal payments are not available right now.', 503);
    let res;
    try {
      res = await f(`${c.base}/Auth/RequestToken`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ consumer_key: env.PESAPAL_CONSUMER_KEY, consumer_secret: env.PESAPAL_CONSUMER_SECRET }) });
    } catch { throw providerError(); }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.token || data?.error) {
      console.error(JSON.stringify({ level: 'error', msg: 'pesapal_auth_failed', http: res.status, code: data?.error?.code ?? null, error_type: data?.error?.error_type ?? null }));
      throw providerError('Could not authenticate with PesaPal.');
    }
    // Documented lifetime is at most 5 minutes; never trust a longer expiryDate and keep a safety margin.
    const parsed = Date.parse(data.expiryDate);
    const expires = Math.min(Number.isNaN(parsed) ? Infinity : parsed, now() + 5 * 60_000);
    cached = { value: data.token, expires };
    return cached.value;
  }
  async function accessToken(force = false) {
    if (!force && cached && cached.expires > now() + 30_000) return cached.value;
    if (!inflight) inflight = requestToken().finally(() => { inflight = null; });
    return inflight;
  }

  async function call(method, path, { body, query } = {}, retried = false) {
    const c = config();
    const token = await accessToken(retried);
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    let res;
    try {
      res = await f(`${c.base}${path}${qs}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw providerError(); }
    if (res.status === 401 && !retried) { cached = null; return call(method, path, { body, query }, true); } // expired token: refresh once
    const data = await res.json().catch(() => null);
    if (!res.ok || data === null || (data && !Array.isArray(data) && data.error && (data.error.code || data.error.message || data.error.error_type))) {
      console.error(JSON.stringify({ level: 'error', msg: 'pesapal_request_failed', path, http: res.status, code: data?.error?.code ?? null, error_type: data?.error?.error_type ?? null }));
      throw providerError('PesaPal rejected the request.');
    }
    return data;
  }

  return {
    name: 'pesapal',
    label: 'PesaPal',
    get currency() { return config().currency ?? 'KES'; },
    available,
    unavailableReason,
    accessToken,

    // One-time setup (scripts/pesapal-register-ipn.mjs). Not called per payment: PESAPAL_IPN_ID is stored in the environment.
    async registerIpn({ url, method = 'POST' }) {
      if (!/^https:\/\//.test(String(url))) throw new AppError('VALIDATION_ERROR', 'The IPN URL must be a public https URL.', 422);
      if (!['GET', 'POST'].includes(method)) throw new AppError('VALIDATION_ERROR', 'IPN method must be GET or POST.', 422);
      const data = await call('POST', '/URLSetup/RegisterIPN', { body: { url, ipn_notification_type: method } });
      if (!GUID_RE.test(String(data.ipn_id ?? ''))) throw providerError('PesaPal returned an invalid IPN registration.');
      return { ipnId: data.ipn_id, url: data.url, method: data.ipn_notification_type_description ?? method, status: data.ipn_status_description ?? null };
    },
    async listIpns() {
      const data = await call('GET', '/URLSetup/GetIpnList');
      return (Array.isArray(data) ? data : []).map((i) => ({ ipnId: i.ipn_id, url: i.url, method: i.ipn_notification_type_description, status: i.ipn_status_description }));
    },

    // Returns { orderId (= PesaPal order_tracking_id), approvalUrl (= redirect_url) } like the PayPal provider.
    async createOrder({ merchantReference, amount, description, billing, paymentId }) {
      const c = config();
      if (!available()) throw new AppError('PROVIDER_UNAVAILABLE', 'PesaPal payments are not available right now.', 503);
      if (!MERCHANT_REFERENCE_RE.test(String(merchantReference ?? ''))) throw new AppError('SERVER_ERROR', 'Invalid merchant reference.', 500);
      const body = {
        id: merchantReference, currency: c.currency, amount: Number(amount), description: String(description).slice(0, 100),
        callback_url: c.callbackUrl, notification_id: c.ipnId, billing_address: billing,
        ...(c.cancellationUrl ? { cancellation_url: `${c.cancellationUrl}?payment=${encodeURIComponent(paymentId)}` } : {}),
      };
      const data = await call('POST', '/Transactions/SubmitOrderRequest', { body });
      let host = '';
      try { const u = new URL(data.redirect_url); host = u.protocol === 'https:' ? u.hostname : ''; } catch { host = ''; }
      if (!data.order_tracking_id || typeof data.order_tracking_id !== 'string' || data.merchant_reference !== merchantReference || !(host === 'pesapal.com' || host.endsWith('.pesapal.com'))) {
        console.error(JSON.stringify({ level: 'error', msg: 'pesapal_bad_order_response', has_tracking: Boolean(data.order_tracking_id), reference_matches: data.merchant_reference === merchantReference, host }));
        throw providerError('PesaPal returned an unexpected response.');
      }
      return { orderId: data.order_tracking_id, approvalUrl: data.redirect_url };
    },

    // Authoritative status for an order. Returns a normalized object; callers compare amount/currency/reference themselves.
    async getTransactionStatus(orderTrackingId) {
      if (!GUID_RE.test(String(orderTrackingId ?? ''))) throw new AppError('VALIDATION_ERROR', 'Invalid tracking id.', 422);
      const d = await call('GET', '/Transactions/GetTransactionStatus', { query: { orderTrackingId } });
      const status = normalizeStatus(d.status_code, d.payment_status_description);
      if (status === 'unknown') console.error(JSON.stringify({ level: 'error', msg: 'pesapal_unknown_status', status_code: d.status_code ?? null, description: String(d.payment_status_description ?? '').slice(0, 40) }));
      return {
        trackingId: orderTrackingId, merchantReference: d.merchant_reference ?? null, status,
        statusCode: d.status_code ?? null, statusDescription: d.payment_status_description ?? null,
        amount: d.amount ?? null, currency: d.currency ? String(d.currency).toUpperCase() : null,
        paymentMethod: d.payment_method ? String(d.payment_method).slice(0, 40) : null, confirmationCode: d.confirmation_code ? String(d.confirmation_code).slice(0, 80) : null,
      };
    },
  };
}
