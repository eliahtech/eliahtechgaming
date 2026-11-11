// Scripts written directly into the HTML of POST pages only (never other pages, never for premium members), no admin placement into the HTML (no admin placement, no AD_ALLOWED_ORIGINS needed).
// To add another network, add an entry here. `origins` are also added to the page's Content-Security-Policy.
export const SITE_SCRIPTS = [
  // Monetag zone 306663
  { src: 'https://quge5.com/88/tag.min.js', attrs: { 'data-zone': '306663', 'data-cfasync': 'false' }, async: true },
  // Adsterra scripts that need no container on the page (pop/social-bar style). Banners with a fixed size live in the admin Ad Placement tab.
  { src: 'https://abscloud.org/1/80b1ce47b01e170a5d33ca5610a1028b', attrs: { 'data-cfasync': 'false' } },
  { src: 'https://bauval.org/14/ecc3c87448a67fa054a6c46b8b0b0d53', attrs: { 'data-cfasync': 'false' } },
];
export const siteScriptOrigins = () => [...new Set(SITE_SCRIPTS.map((s) => new URL(s.src).origin))];
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const siteScriptTags = (nonce = '') => SITE_SCRIPTS.map((s) => `<script src="${esc(s.src)}"${s.async ? ' async' : ''}${Object.entries(s.attrs || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}${nonce ? ` nonce="${esc(nonce)}"` : ''}></script>`).join('');
