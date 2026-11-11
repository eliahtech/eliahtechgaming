// Cookie-session primitives shared by Express browser authentication and Google PKCE.
// Access/refresh tokens live ONLY in HttpOnly cookies. A readable CSRF cookie enables a double-submit check;
// an Origin check is the second layer. Browsers never see the Supabase tokens.

export const ACCESS_MAX_AGE = 60 * 60;            // matches Supabase default JWT lifetime; the real expiry is enforced by Supabase
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export const cookieNames = (secure) => {
  const p = secure ? '__Host-' : '';
  return { access: `${p}eliah_at`, refresh: `${p}eliah_rt`, csrf: `${p}eliah_csrf`, oauth: `${p}eliah_oauth` };
};

export const isSecureRequest = (request, appUrl) => {
  try { if (new URL(request.url).protocol === 'https:') return true; } catch { /* fall through */ }
  if (request.headers.get('x-forwarded-proto') === 'https') return true;
  try { return new URL(appUrl).protocol === 'https:'; } catch { return false; }
};

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export const serialize = (name, value, { maxAge, httpOnly, secure }) => [
  `${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, httpOnly ? 'HttpOnly' : '', secure ? 'Secure' : '', 'SameSite=Lax',
].filter(Boolean).join('; '); // No Domain attribute: required for __Host- cookies and keeps cookies host-only.

export const randomToken = (bytes = 32) => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
};

export function sessionCookies(session, { secure }) {
  const n = cookieNames(secure);
  return [
    serialize(n.access, session.access_token, { maxAge: Math.min(session.expires_in || ACCESS_MAX_AGE, ACCESS_MAX_AGE), httpOnly: true, secure }),
    serialize(n.refresh, session.refresh_token, { maxAge: REFRESH_MAX_AGE, httpOnly: true, secure }),
    serialize(n.csrf, randomToken(), { maxAge: REFRESH_MAX_AGE, httpOnly: false, secure }),
  ];
}

export const clearCookies = ({ secure }) => {
  const n = cookieNames(secure);
  return [n.access, n.refresh, n.csrf].map((name) => serialize(name, '', { maxAge: 0, httpOnly: name !== n.csrf, secure }));
};

export const readSession = (request, { secure }) => {
  const n = cookieNames(secure); const c = parseCookies(request.headers.get('cookie') || '');
  return { access: c[n.access] || null, refresh: c[n.refresh] || null, csrf: c[n.csrf] || null };
};

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
};

// CSRF for cookie-authenticated, state-changing requests: matching header+cookie token AND same-origin Origin/Referer.
export function csrfProblem(request, { secure, appUrl }) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const { csrf } = readSession(request, { secure });
  if (!safeEqual(request.headers.get('x-csrf-token'), csrf)) return 'CSRF_TOKEN_INVALID';
  const origin = request.headers.get('origin') || (request.headers.get('referer') ? new URL(request.headers.get('referer')).origin : null);
  if (!origin) return 'ORIGIN_MISSING';
  const allowed = new Set([new URL(request.url).origin]);
  try { allowed.add(new URL(appUrl).origin); } catch { /* APP_URL invalid: only request origin allowed */ }
  return allowed.has(origin) ? null : 'ORIGIN_MISMATCH';
}

// Only same-origin relative paths are accepted as post-login destinations (prevents open redirects).
export const safeNextPath = (value) => (typeof value === 'string' && /^\/(?![/\\])[^\r\n]*$/.test(value) ? value : '/profile');
