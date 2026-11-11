import { cookieNames, parseCookies, sessionCookies, clearCookies, csrfProblem } from './cookies.js';

// Browser authentication uses HttpOnly cookies; native clients may still use Bearer tokens.
export function browserSession({ appUrl }) {
  const secure = appUrl.startsWith('https://');
  const names = cookieNames(secure);
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie || '');
    req.browserCookies = cookies;
    req.cookieAuthenticated = !req.headers.authorization && Boolean(cookies[names.access]);
    if (req.cookieAuthenticated) req.headers.authorization = `Bearer ${cookies[names.access]}`;
    if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/\/webhooks\/|\/pesapal\/(ipn|callback|cancel)|\/hooks\//.test(req.path)) {
      const origin = req.headers.origin;
      if (origin && origin !== new URL(appUrl).origin) return res.status(403).json({ success: false, error: { code: 'ORIGIN_MISMATCH', message: 'Request origin rejected.' } });
      // Sign-out is exempt from the CSRF token (never from the Origin check above): a missing or expired CSRF cookie
      // must not leave someone signed in on a shared device. SameSite=Lax cookies already block cross-site use.
      if (req.path !== '/api/v1/auth/logout' && (req.cookieAuthenticated || (req.path === '/api/v1/auth/refresh' && cookies[names.refresh]))) {
        const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'));
        const problem = csrfProblem({ method: req.method, url: appUrl + req.originalUrl, headers }, { secure, appUrl });
        if (problem) return res.status(403).json({ success: false, error: { code: problem, message: 'Refresh the page and try again.' } });
      }
    }
    if(req.path.startsWith('/api/v1/admin')||req.path.startsWith('/api/v1/auth'))res.set('Cache-Control','private, no-store');
    // Clear the session cookies up front so every outcome of a sign-out request (success, expired token, upstream error) ends signed out.
    if (req.method === 'POST' && req.path === '/api/v1/auth/logout') res.setHeader('Set-Cookie', clearCookies({ secure }));
    const json = res.json.bind(res);
    res.json = (payload) => {
      if (payload?.success && payload.data?.session && req.headers['x-eliah-browser'] === '1') {
        res.setHeader('Set-Cookie', sessionCookies(payload.data.session, { secure }));
        payload = { ...payload, data: { ...payload.data, session: { cookie: true, expires_in: payload.data.session.expires_in } } };
      }
      if (req.path === '/api/v1/auth/logout') res.setHeader('Set-Cookie', clearCookies({ secure }));
      return json(payload);
    };
    next();
  };
}
export function cookieRefresh(appUrl) {
  return (req, _res, next) => {
    if (req.path === '/api/v1/auth/refresh' && req.headers['x-eliah-browser'] === '1') req.body = { ...req.body, refresh_token: req.browserCookies?.[cookieNames(appUrl.startsWith('https://')).refresh] };
    next();
  };
}
