import sanitizeHtml from 'sanitize-html';
import { cspDirectives } from '../csp.js';
import { siteScriptOrigins } from './site-scripts.js';

export const adDomains = () => String(process.env.AD_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(v => { try { const u = new URL(v); return u.protocol === 'https:' && u.origin === v; } catch { return false; } });
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
export function adCsp(nonce) {
  const origins = [...new Set([...adDomains(), ...siteScriptOrigins()])];
  const directives = { ...cspDirectives, scriptSrc: [...cspDirectives.scriptSrc, ...origins, `'nonce-${nonce}'`], frameSrc: [...cspDirectives.frameSrc, ...origins], connectSrc: [...cspDirectives.connectSrc, ...origins] };
  return Object.entries(directives).map(([k,v]) => `${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} ${v.join(' ')}`).join('; ');
}
