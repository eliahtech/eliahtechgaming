// Thin client for Supabase Auth (GoTrue) over fetch. Passwords are sent to Supabase and never stored or logged here.
import { AppError } from './errors.js';
import { ConfigError } from './supabase.js';

const publicUser = (u) => ({ id: u.id, email: u.email, email_verified: Boolean(u.email_confirmed_at) });

export const toSession = (payload) => ({
  access_token: payload.access_token,
  refresh_token: payload.refresh_token,
  token_type: payload.token_type || 'bearer',
  expires_in: payload.expires_in,
  expires_at: payload.expires_at,
});

export function mapAuthError(status, payload) {
  const code = payload?.error_code || payload?.code || '';
  const text = payload?.msg || payload?.message || payload?.error_description || '';
  if (code === 'invalid_credentials') return new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401);
  if (code === 'email_not_confirmed') return new AppError('EMAIL_NOT_VERIFIED', 'Verify your email address before signing in.', 403);
  if (code === 'weak_password') return new AppError('WEAK_PASSWORD', text || 'That password is too weak.', 422);
  if (code === 'same_password') return new AppError('VALIDATION_ERROR', 'Choose a password you have not used before.', 422);
  if (/rate_limit/.test(code) || status === 429) return new AppError('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.', 429);
  if (status === 401 || status === 403 || ['bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'no_authorization'].includes(code)) {
    return new AppError('INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.', 401);
  }
  if (status >= 500) return new AppError('AUTH_UNAVAILABLE', 'The authentication service is unavailable. Try again shortly.', 502);
  return new AppError('AUTH_ERROR', 'The request could not be completed.', 400);
}

export function createAuthClient({ url, anonKey, fetchImpl } = {}) {
  const call = async (method, path, { body, token, query } = {}) => {
    const base = (url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const key = anonKey ?? process.env.SUPABASE_ANON_KEY ?? '';
    if (!base || !key) throw new ConfigError('Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    const qs = new URLSearchParams(query || {}).toString();
    let response;
    try {
      response = await (fetchImpl ?? globalThis.fetch)(`${base}/auth/v1${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AppError('AUTH_UNAVAILABLE', 'The authentication service is unreachable.', 502);
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) throw mapAuthError(response.status, payload);
    return payload;
  };

  return {
    async signUp({ email, password, displayName, redirectTo }) {
      const payload = await call('POST', '/signup', { query: redirectTo ? { redirect_to: redirectTo } : {}, body: { email, password, data: { display_name: displayName } } });
      // With email confirmation off Supabase returns a session immediately; otherwise only a pending user.
      return payload?.access_token ? { session: toSession(payload), user: publicUser(payload.user) } : { session: null, user: null };
    },
    async signIn({ email, password }) {
      const payload = await call('POST', '/token', { query: { grant_type: 'password' }, body: { email, password } });
      return { session: toSession(payload), user: publicUser(payload.user) };
    },
    async refresh(refreshToken) {
      const payload = await call('POST', '/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: refreshToken } });
      return { session: toSession(payload), user: publicUser(payload.user) };
    },
    async getUser(token) {
      const payload = await call('GET', '/user', { token });
      return publicUser(payload);
    },
    async signOut(token) { await call('POST', '/logout', { token, query: { scope: 'local' } }); },
    async recover(email, redirectTo) { await call('POST', '/recover', { query: redirectTo ? { redirect_to: redirectTo } : {}, body: { email } }); },
    async updatePassword(token, password) { await call('PUT', '/user', { token, body: { password } }); },
  };
}
