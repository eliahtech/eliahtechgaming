// Privacy-friendly page-view counting. Only a path, a 2-letter country (from the hosting platform's header), a device class and a browser
// family are stored, as daily counters. No IP address, cookie, user id or user-agent string is kept.
const BOT = /bot|crawl|spider|slurp|bing|facebookexternalhit|preview|monitor|uptime|lighthouse|headless|python|curl|wget|node-fetch|axios|go-http|java\//i;
const BLOCKED = /^\/(?:admin|api|login|register|profile|auth|payment|reset-password|forgot-password|preview|newsletter|unsubscribe)(?:\/|$)/i;
const PATH_OK = /^\/(?:[A-Za-z0-9._~%-]{1,100}(?:\/[A-Za-z0-9._~%-]{1,100}){0,2})?$/;

export const isBot = (ua) => !ua || BOT.test(ua);
export const deviceOf = (ua = '') => (/iPad|Tablet|PlayBook|Silk|(?:Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|iPhone|iPod|Android.*Mobile|Opera Mini|IEMobile/i.test(ua) ? 'mobile' : 'desktop');
export function browserOf(ua = '') {
  if (/SamsungBrowser/i.test(ua)) return 'Samsung';
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera|OPiOS/i.test(ua)) return 'Opera';
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Other';
}
export function cleanPath(input) {
  let p = String(input ?? '').split('#')[0].split('?')[0].trim();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (!p || p.length > 160 || !PATH_OK.test(p) || BLOCKED.test(p)) return null;
  return p.toLowerCase();
}
export const countryOf = (headers = {}) => { const c = String(headers['x-vercel-ip-country'] || headers['cf-ipcountry'] || '').toUpperCase(); return /^[A-Z]{2}$/.test(c) ? c : 'XX'; };

// Returns true when a view was recorded. Never throws: analytics must not break a page.
export async function recordView(db, { path, headers = {} }) {
  const ua = headers['user-agent'] || '';
  const clean = cleanPath(path);
  if (!clean || isBot(ua) || headers.dnt === '1') return false;
  try { await db.rpc('analytics_hit', { p_path: clean, p_country: countryOf(headers), p_device: deviceOf(ua), p_browser: browserOf(ua) }); return true; } catch { return false; }
}
