import sanitizeHtml from 'sanitize-html';
import { cspDirectives } from '../csp.js';
import { siteScriptOrigins } from './site-scripts.js';

// Ad networks the site owner has approved in code, so banner ads pasted into the admin Ad Placement tab work without any
// environment variable. AD_ALLOWED_ORIGINS can still add more exact https origins.
export const BUILTIN_AD_ORIGINS = ['https://bauval.org'];
export const adDomains = () => [...new Set([...BUILTIN_AD_ORIGINS, ...String(process.env.AD_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(v => { try { const u = new URL(v); return u.protocol === 'https:' && u.origin === v; } catch { return false; } })])];
export function adEligible({ isPost, user, verified = true }) { return Boolean(isPost && verified && !user?.access?.isPremium); }
export function activeAds(rows, { now = Date.now() } = {}) {
  return rows.filter(a => a.enabled && (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now));
}
export function adMarkup(ad, nonce) {
  const origins = adDomains();
  if (!origins.length) return ''; // operator approval is required before ad code can execute
  const safeUrl = value => { try { return origins.includes(new URL(value).origin); } catch { return false; } };
  const code = sanitizeHtml(ad.code || '', {
    allowedTags: ['script', 'ins', 'div', 'span', 'a', 'img', 'iframe'],
    allowedAttributes: { '*': ['class', 'style', 'data-*'], script: ['src', 'async', 'crossorigin', 'nonce'], iframe: ['src', 'title', 'width', 'height', 'loading'], img: ['src', 'alt', 'width', 'height'], a: ['href', 'rel'] },
    allowedSchemes: ['https'], allowVulnerableTags: true,
    transformTags: { script: (tagName, attribs) => ({ tagName, attribs: { ...attribs, nonce } }), a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'nofollow sponsored noopener' } }) },
    exclusiveFilter: frame => ['script','iframe','img'].includes(frame.tag) && frame.attribs.src && !safeUrl(frame.attribs.src),
  });
  if (ad.placement === 'auto') return code;
  return `<aside class="advertisement ad-${ad.device || 'both'}" aria-label="Advertisement"><small>Advertisement</small>${code}</aside>`;
}
// Addresses the site-wide ad scripts (Monetag, Adsterra pop/social bar) contact after they load. Taken from the browser's
// Content-Security-Policy console reports; add a new one here if the Console shows another `Refused to connect to ...`.
export const AD_EXTRA_ORIGINS = ['https://araplhn.org', 'https://6opo.com'];
// SHA-256 hashes of the small inline scripts that Adsterra's banner script (bauval.org/22/...) writes into the page. Browsers
// refuse inline scripts without a nonce or hash, so each one is allowed by its exact content. A banner with a new key or size
// has new hashes: the Console shows them in `Refused to execute inline script ... 'sha256-...'` lines.
export const AD_INLINE_HASHES = [
  'sha256-Jon5QbhLFLG3UX0GXPyUMhtKBQVrMzPFym/mpG21T74=', 'sha256-mekHMuyuDS1U30f/aLpt0ygi8Mlfj7U3e4JrD5FQ8Fw=',
  'sha256-oZK9qdINNqM21fJalgAtQWQOHcVTDhRXinP81GWkjcQ=', 'sha256-Y5xunX9cO4fYw0nd6jNMe0qUygT7hq6lOmbIpQ27NzU=',
];
export function adCsp(nonce) {
  const origins = [...new Set([...adDomains(), ...siteScriptOrigins()])];
  const extra = [...origins, ...AD_EXTRA_ORIGINS];
  const hashes = AD_INLINE_HASHES.map((h) => `'${h}'`);
  const directives = { ...cspDirectives, scriptSrc: [...cspDirectives.scriptSrc, ...extra, `'nonce-${nonce}'`, ...hashes], frameSrc: [...cspDirectives.frameSrc, ...origins], connectSrc: [...cspDirectives.connectSrc, ...extra] };
  return Object.entries(directives).map(([k,v]) => `${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} ${v.join(' ')}`).join('; ');
}
