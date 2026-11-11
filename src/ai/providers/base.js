// Shared provider plumbing: one error type with an explicit recoverable flag, strict base-URL validation, and a JSON POST
// helper that always has a timeout. Adapters never put secrets in thrown errors, and the raw provider body never leaves here.
import { isIP } from 'node:net';

// recoverable = the router may try the next model. Everything else is returned to the caller as a controlled error.
export class ProviderError extends Error {
  constructor(code, { recoverable = false, status = null, publicStatus = 502, publicMessage, retryAfter = null } = {}) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.recoverable = recoverable;
    this.upstreamStatus = status;
    this.publicStatus = publicStatus;
    this.retryAfter = retryAfter;
    this.publicMessage = publicMessage ?? 'The AI service could not complete this request.';
  }
}

const E = {
  RATE_LIMITED: { code: 'AI_PROVIDER_RATE_LIMITED', recoverable: true },
  TIMEOUT: { code: 'AI_PROVIDER_TIMEOUT', recoverable: true },
  UNAVAILABLE: { code: 'AI_PROVIDER_UNAVAILABLE', recoverable: true },
  EMPTY: { code: 'AI_PROVIDER_EMPTY_RESPONSE', recoverable: true },
  AUTH: { code: 'AI_PROVIDER_AUTH', recoverable: false },
  MODEL: { code: 'AI_PROVIDER_MODEL_NOT_FOUND', recoverable: false },
  BAD_REQUEST: { code: 'AI_PROVIDER_REJECTED_REQUEST', recoverable: false },
  CONTENT: { code: 'AI_CONTENT_REJECTED', recoverable: false },
  CONFIG: { code: 'AI_PROVIDER_MISCONFIGURED', recoverable: false },
};
const make = (kind, status = null) => new ProviderError(kind.code, { recoverable: kind.recoverable, status });
export const providerErrors = { E, make };

// Map an upstream HTTP status to a ProviderError. 429 / 408 / 5xx are transient (try the next model); 400 / 401 / 403 / 404
// mean the request or our configuration is wrong, so repeating it on other providers would not help.
export function classifyHttpStatus(status) {
  if (status === 429) return make(E.RATE_LIMITED, status);
  if (status === 408) return make(E.TIMEOUT, status);
  if (status >= 500) return make(E.UNAVAILABLE, status);
  if (status === 401 || status === 403) return make(E.AUTH, status);
  if (status === 404) return make(E.MODEL, status);
  return make(E.BAD_REQUEST, status);
}
export const contentRejected = () => make(E.CONTENT);
export const emptyResponse = () => make(E.EMPTY);
export const misconfigured = () => make(E.CONFIG);

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp)$/i;

// Provider URLs come from the admin registry, so they are validated like any other untrusted URL: https only, no
// credentials, no IP literals or internal-looking host names, and (optionally) an operator allow-list of hosts.
export function assertSafeBaseUrl(raw, { allowedHosts = parseAllowedHosts() } = {}) {
  let url;
  try { url = new URL(String(raw)); } catch { throw misconfigured(); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw misconfigured();
  if (isIP(host) || !host.includes('.') || BLOCKED_HOST.test(host)) throw misconfigured();
  if (allowedHosts.length && !allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) throw misconfigured();
  return url.toString().replace(/\/+$/, '');
}
export function parseAllowedHosts(env = process.env) {
  return String(env.AI_ALLOWED_BASE_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

// POST JSON with a hard timeout. Throws ProviderError for timeouts, network failures and non-2xx statuses.
export async function postJson({ fetchImpl = globalThis.fetch, url, headers, body, timeoutMs, parseError }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    text = await response.text();
  } catch (error) {
    throw error?.name === 'AbortError' || controller.signal.aborted ? make(E.TIMEOUT) : make(E.UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) { const error = parseError?.(response.status, json) ?? classifyHttpStatus(response.status); const raw = response.headers?.get?.('retry-after'); const seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw)-Date.now())/1000 : 60; error.retryAfter = Math.max(1,Math.min(86400,Number.isFinite(seconds)?Math.ceil(seconds):60)); throw error; }
  if (json === null) throw make(E.UNAVAILABLE, response.status); // 2xx with an unreadable body: a provider glitch
  return json;
}

export const toUsage = (input, output, total) => {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const i = n(input); const o = n(output); let t = n(total);
  if (i === null && o === null && t === null) return null;
  if (t === null && i !== null && o !== null) t = i + o;
  return { inputTokens: i, outputTokens: o, totalTokens: t };
};

// Common shape every adapter implements. `model` is the registry row, `messages` is [{ role: system|user|assistant, content }].
export class AIProvider {
  constructor({ fetchImpl } = {}) { this.fetchImpl = fetchImpl; }
  // Subclasses return { content, usage, finishReason } or throw ProviderError.
  async complete() { throw new Error('complete() not implemented'); }
}
