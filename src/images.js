// Turns the image links people actually paste (share pages, protocol-relative, http, Drive/Dropbox/imgur/GitHub)
// into direct https image URLs the browser can load. Pure and dependency-free so server and tests share it.
const DRIVE_FILE = /^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/i;
const DRIVE_UC = /^https?:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]{10,})/i;

export function normalizeImageUrl(input) {
  let url = String(input ?? '').trim();
  if (!url) return '';
  if (/^data:/i.test(url) || /^(?:javascript|vbscript|file|blob):/i.test(url)) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^http:\/\//i.test(url)) url = `https://${url.slice(7)}`; // http images are blocked as mixed content
  if (url.startsWith('/')) return /^\/(?![\/\\])[^\s\\]*$/.test(url) ? url : '';
  if (!/^https:\/\//i.test(url)) return /^[\w.-]+\.[a-z]{2,}\/\S+/i.test(url) ? `https://${url}` : ''; // "example.com/a.jpg"
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const host = parsed.hostname.toLowerCase();
  const drive = DRIVE_FILE.exec(url) || DRIVE_UC.exec(url);
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
  if (host === 'www.dropbox.com' || host === 'dropbox.com') { parsed.hostname = 'dl.dropboxusercontent.com'; parsed.searchParams.delete('dl'); return parsed.href; }
  if (host === 'imgur.com' || host === 'www.imgur.com') { const m = /^\/(?:a\/|gallery\/)?([A-Za-z0-9]{5,8})$/.exec(parsed.pathname); return m && !/\/(?:a|gallery)\//.test(parsed.pathname) ? `https://i.imgur.com/${m[1]}.jpg` : parsed.href; }
  if (host === 'github.com') { const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(parsed.pathname); if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`; }
  return parsed.href;
}
export const isImageUrl = (value) => normalizeImageUrl(value) !== '';
