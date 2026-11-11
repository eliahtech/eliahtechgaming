// Shared by the server-rendered pages (src/web/templates.js) and the browser app (public/app.js).
// Brand-coloured inline SVG icons: no icon font, no network request, and they work under the strict CSP.
const G = {
  telegram: '<path fill="#fff" d="M20.7 4.3 3.2 11c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.2c.2.6.1.8.7.8.4 0 .7-.2 1-.5l2.200-2.100 4.500 3.300c.8.5 1.400.2 1.600-.8l3-14.200c.3-1.200-.5-1.800-1.500-1.300zM8.500 13.200l9.400-5.900c.4-.3.9-.1.5.2l-7.800 7-.3 3.200z"/>',
  facebook: '<path fill="#fff" d="M13.600 21.500v-8.300h2.800l.4-3.300h-3.200V7.800c0-.9.3-1.600 1.600-1.600h1.700V3.300c-.3 0-1.300-.1-2.500-.1-2.500 0-4.100 1.500-4.100 4.200v2.500H7.500v3.300h2.800v8.300z"/>',
  instagram: '<g fill="none" stroke="#fff" stroke-width="1.900"><rect x="4" y="4" width="16" height="16" rx="4.600"/><circle cx="12" cy="12" r="3.700"/></g><circle cx="16.900" cy="7.100" r="1.150" fill="#fff"/>',
  whatsapp: '<path fill="none" stroke="#fff" stroke-width="1.900" stroke-linejoin="round" d="M4 20l1.200-4.100A8 8 0 1 1 8.200 18.900z"/><path fill="#fff" d="M9.300 7.900c-.3 0-.7.2-.9.600-.4.900-.2 2 1 3.600 1.200 1.600 2.600 2.400 3.700 2.700.8.200 1.400-.4 1.700-.9.100-.3-.1-.5-.4-.6l-1.200-.6c-.2-.1-.4 0-.5.200l-.4.500c-.2.200-.4.200-.6.100-.7-.4-1.500-1-1.900-1.800-.1-.2 0-.4.100-.5l.4-.5c.1-.2.100-.4 0-.6l-.6-1.300c-.1-.3-.3-.4-.4-.4z"/>',
  youtube: '<rect x="3" y="6.200" width="18" height="11.600" rx="3.200" fill="#fff"/><path fill="#FF0000" d="M10.200 9.300v5.400l4.800-2.700z"/>',
  tiktok: '<path fill="#fff" d="M14.100 4v9.600a2.600 2.600 0 1 1-2.100-2.500V8.500a5.200 5.200 0 1 0 4.700 5.100V9.300c.9.600 1.900 1 3 1V7.700c-1.700 0-3.100-1.400-3.100-3.700z"/>',
  x: '<path fill="none" stroke="#fff" stroke-width="2.100" stroke-linecap="round" d="M5.500 5.500l13 13M18.500 5.500l-13 13"/>',
  twitter: '<path fill="#fff" d="M20.500 7.100c-.6.300-1.200.4-1.900.5.700-.4 1.200-1 1.400-1.800-.6.400-1.300.6-2.100.8a3.300 3.300 0 0 0-5.600 3A9.300 9.300 0 0 1 5.600 6.200a3.300 3.300 0 0 0 1 4.400c-.5 0-1-.2-1.500-.4 0 1.600 1.100 2.900 2.600 3.200-.5.100-1 .2-1.500.1.400 1.300 1.600 2.300 3.100 2.300A6.600 6.600 0 0 1 4 17.100a9.300 9.300 0 0 0 14.300-8.300c.8-.5 1.500-1.200 2.200-1.700z"/>',
  github: '<path fill="#fff" d="M12 3.500a8.500 8.500 0 0 0-2.700 16.600c.4.100.6-.2.6-.4v-1.500c-2.400.5-2.900-1.100-2.900-1.100-.4-1-1-1.300-1-1.300-.8-.5.100-.5.100-.5.900.1 1.400.9 1.400.9.800 1.400 2.100 1 2.600.8.100-.6.300-1 .6-1.200-1.900-.2-3.900-1-3.900-4.200 0-.9.300-1.700.9-2.300-.1-.2-.4-1.100.1-2.300 0 0 .7-.2 2.300.9a8 8 0 0 1 4.200 0c1.600-1.100 2.300-.9 2.300-.9.500 1.200.2 2.100.1 2.300.5.600.9 1.400.9 2.300 0 3.200-2 4-3.900 4.200.3.300.6.800.6 1.600v2.300c0 .2.200.5.600.4A8.500 8.500 0 0 0 12 3.500z"/>',
  link: '<g fill="none" stroke="#fff" stroke-width="1.900" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.700 0l2.600-2.600a4 4 0 0 0-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.700 0l-2.600 2.600a4 4 0 0 0 5.700 5.700l1-1"/></g>',
};
// Official brand colours. Instagram uses its gradient.
const BRANDS = {
  telegram: { color: '#26A5E4', label: 'Telegram' }, facebook: { color: '#1877F2', label: 'Facebook' }, instagram: { color: 'url(#etg-ig)', label: 'Instagram', fallback: '#E4405F' },
  whatsapp: { color: '#25D366', label: 'WhatsApp' }, youtube: { color: '#FF0000', label: 'YouTube' }, tiktok: { color: '#010101', label: 'TikTok' },
  x: { color: '#000000', label: 'X' }, twitter: { color: '#1DA1F2', label: 'Twitter' }, github: { color: '#24292F', label: 'GitHub' },
};
export const DEFAULT_SOCIAL = [
  { platform: 'Telegram', url: 'https://t.me/eliahtech' },
  { platform: 'Facebook', url: 'https://facebook.com/eliahtech' },
  { platform: 'Instagram', url: 'https://instagram.com/eliasjuma108' },
  { platform: 'WhatsApp', url: 'https://whatsapp.com/channel/0029VaPXwjgC6ZvjQ3ocsy12' },
  { platform: 'YouTube', url: 'https://youtube.com/@eliahtech' },
];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The old Blogger address was retired; it is never shown, whatever the database still contains.
const retired = (url) => /blogspot\.com/i.test(String(url));

export function brandKey(row = {}) {
  const hay = `${row.platform || ''} ${row.url || ''} ${row.icon || ''}`.toLowerCase();
  if (/t\.me|telegram/.test(hay)) return 'telegram';
  if (/facebook|fb\.com|fb\.me/.test(hay)) return 'facebook';
  if (/instagram/.test(hay)) return 'instagram';
  if (/whatsapp|wa\.me/.test(hay)) return 'whatsapp';
  if (/youtube|youtu\.be/.test(hay)) return 'youtube';
  if (/tiktok/.test(hay)) return 'tiktok';
  if (/github/.test(hay)) return 'github';
  if (/twitter\.com/.test(hay)) return 'twitter';
  if (/(?:^|[\s/.])x\.com|\bx\b/.test(hay)) return 'x';
  return 'link';
}
export const socialList = (rows) => {
  const usable = (Array.isArray(rows) ? rows : []).filter((r) => /^https:\/\//i.test(String(r?.url || '')) && !retired(r.url));
  return usable.length ? usable : DEFAULT_SOCIAL;
};
export function socialIcon(row, size = 30) {
  const key = brandKey(row); const brand = BRANDS[key] || { color: '#64748B', label: row.platform || 'Link' };
  const defs = key === 'instagram' ? '<defs><linearGradient id="etg-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset=".85" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs>' : '';
  return `<svg class="social-svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${defs}<circle cx="12" cy="12" r="12" fill="${brand.color}"/>${G[key] || G.link}</svg>`;
}
export function socialIcons(rows, { size = 30, className = 'social-icon' } = {}) {
  return socialList(rows).map((r) => { const key = brandKey(r); const name = (BRANDS[key]?.label) || r.platform || 'Link'; return `<a class="${className} social-${key}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)}" title="${esc(name)}">${socialIcon(r, size)}</a>`; }).join('');
}
// Pinned strip at the very top of every page.
export const socialBar = (rows) => `<div class="social-bar" role="complementary" aria-label="Follow Eliahtech"><div class="social-bar-inner"><span class="social-bar-label">Follow ETG</span><div class="social-bar-icons">${socialIcons(rows, { size: 30 })}</div></div></div>`;
