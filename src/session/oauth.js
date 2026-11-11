// Google sign-in through Supabase Auth using the PKCE authorization-code flow, done entirely server-side.
// The browser only ever sees redirects and an HttpOnly "flow" cookie holding the PKCE verifier; Google/Supabase tokens never reach JavaScript.
// Web-standard APIs only (works on Node/Vercel and Cloudflare Workers).

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => { const s = text.replace(/-/g, '+').replace(/_/g, '/'); return atob(s + '='.repeat((4 - (s.length % 4)) % 4)); };

export const randomVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(48))); // 64 chars, within RFC 7636's 43–128
export async function challengeFor(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function buildAuthorizeUrl({ supabaseUrl, redirectTo, challenge }) {
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  url.searchParams.set('prompt', 'select_account'); // never silently reuse the previous person's Google session on a shared phone
  return url.toString();
}

// Flow-cookie payload: verifier + validated post-login path. Opaque to the client (HttpOnly) and useless without the matching callback code.
export const encodeFlow = ({ verifier, next }) => b64url(new TextEncoder().encode(JSON.stringify({ v: verifier, n: next })));
export function decodeFlow(value) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(fromB64url(String(value)), (c) => c.charCodeAt(0))));
    return typeof parsed?.v === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(parsed.v) ? { verifier: parsed.v, next: typeof parsed.n === 'string' ? parsed.n : '/profile' } : null;
  } catch { return null; }
}

// Exchanges the one-time code for a session. Returns { ok: true, session } or { ok: false, reason } — never raw provider errors.
export async function exchangeCode({ fetchImpl = globalThis.fetch, supabaseUrl, anonKey, code, verifier, timeoutMs = 10000 }) {
  if (typeof code !== 'string' || !/^[\w.~-]{8,512}$/.test(code)) return { ok: false, reason: 'bad_code' };
  try {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=pkce`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!res.ok) return { ok: false, reason: 'exchange_rejected' };
    const session = await res.json();
    if (!session?.access_token || !session?.refresh_token || !session?.user?.id) return { ok: false, reason: 'bad_session' };
    // Only accept accounts whose email the provider has verified (Google does; this guards misconfiguration).
    if (!session.user.email || !(session.user.email_confirmed_at || session.user.confirmed_at)) return { ok: false, reason: 'email_unverified' };
    return { ok: true, session };
  } catch { return { ok: false, reason: 'unreachable' }; }
}

// Fixed, non-reflective error codes shown on /login.
export const OAUTH_ERRORS = { google_failed: 'Google sign-in did not complete. Please try again.', google_expired: 'That sign-in attempt expired. Please start again.', google_unavailable: 'Google sign-in is not available right now.', google_unverified: 'Your Google account email is not verified, so it cannot be used to sign in.' };
