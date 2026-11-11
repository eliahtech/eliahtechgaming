// Whitelist-based field validation for admin writes. Only fields declared in a resource definition are ever
// copied into the database payload, so unknown or privileged keys in a request body are ignored.
import { AppError } from '../errors.js';
import { isUuid } from '../validate.js';
import { normalizeImageUrl } from '../images.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON_RE = /^fa-[a-z0-9-]{1,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const slugify = (text) => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

const isHttpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
// Site-relative path ("/services") or in-page anchor ("#latest"); protocol-relative "//host" is rejected.
const isLocalPath = (value) => /^\/(?!\/)[^\s]*$/.test(value) || /^#[A-Za-z0-9_-]+$/.test(value);

function check(name, spec, raw, ctx) {
  const type = spec.type ?? 'string';
  if (type === 'bool') return typeof raw === 'boolean' ? { value: raw } : { error: 'Must be true or false.' };
  if(type==='decimal'){const n=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;if(!Number.isFinite(n)||n<(spec.min??0)||n>(spec.max??1000000))return{error:`Enter a number between ${spec.min??0} and ${spec.max??1000000}.`};return{value:n};}
  if (type === 'int') {
    const n = typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isInteger(n)) return { error: 'Must be a whole number.' };
    if (n < (spec.min ?? 0) || n > (spec.max ?? 1_000_000)) return { error: `Must be between ${spec.min ?? 0} and ${spec.max ?? 1_000_000}.` };
    return { value: n };
  }
  if (type === 'prices') {
    // { "USD": "4.99", "KES": "499" } -> normalised to two-decimal strings; every price must be positive.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 10) return { error: 'Provide prices such as USD=4.99.' };
    const out = {};
    for (const [code, amount] of Object.entries(raw)) {
      const text = String(amount ?? '').trim();
      if (!/^[A-Z]{3}$/.test(code) || !/^\d{1,7}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return { error: `Invalid price for ${code}. Use a currency code and a positive amount with at most 2 decimals.` };
      out[code] = Number(text).toFixed(2);
    }
    return { value: out };
  }
  if (type === 'strings') {
    if (!Array.isArray(raw) || raw.length > (spec.maxItems ?? 20)) return { error: `Must be a list of at most ${spec.maxItems ?? 20} items.` };
    const items = raw.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    if (items.some((x) => x.length > (spec.maxLen ?? 120))) return { error: `Each item must be ${spec.maxLen ?? 120} characters or fewer.` };
    return { value: items };
  }
  if (typeof raw !== 'string') return { error: 'Must be text.' };
  const text = type === 'html' ? raw : raw.trim();
  if (type === 'html') {
    if (text.length > (spec.max ?? 2_000_000)) return { error: 'Content is too long.' };
    if (!ctx.sanitize) throw new Error('validateFields needs a sanitize function for html fields');
    return { value: ctx.sanitize(text) };
  }
  if (spec.min && text.length < spec.min) return { error: `Must be at least ${spec.min} characters.` };
  if (text.length > (spec.max ?? (type === 'image' ? 2000 : 255))) return { error: `Must be ${spec.max ?? (type === 'image' ? 2000 : 255)} characters or fewer.` };
  switch (type) {
    case 'slug': return SLUG_RE.test(text) ? { value: text } : { error: 'Use lowercase letters, numbers and single hyphens.' };
    case 'icon': return ICON_RE.test(text) ? { value: text } : { error: 'Use a Font Awesome class such as fa-gamepad.' };
    case 'color': return HEX_RE.test(text) ? { value: text } : { error: 'Use a hex colour such as #8b5cf6.' };
    case 'uuid': return isUuid(text) ? { value: text } : { error: 'Invalid reference.' };
    case 'enum': return spec.values.includes(text) ? { value: text } : { error: `Must be one of: ${spec.values.join(', ')}.` };
    case 'image': { const fixed = normalizeImageUrl(text); return fixed && fixed.length <= (spec.max ?? 2000) ? { value: fixed } : { error: 'Paste a direct image link (https://…/photo.jpg), a Google Drive / Dropbox / imgur share link, or upload the image.' }; }
    case 'url': return isHttpsUrl(text) || (spec.relative && isLocalPath(text)) ? { value: text } : { error: spec.relative ? 'Use an https:// URL or a path starting with /.' : 'Use an https:// URL.' };
    case 'datetime': return Number.isNaN(Date.parse(text)) ? { error: 'Invalid date.' } : { value: new Date(text).toISOString() };
    default: return { value: text };
  }
}

export function validateFields(fields, body, { partial = false, sanitize } = {}) {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const values = {};
  const errors = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!(name in src)) { if (!partial && spec.required && !spec.derive) errors[name] = 'Required.'; continue; }
    const raw = src[name];
    if (raw === null || raw === '') {
      if (spec.nullable) values[name] = null;
      else errors[name] = 'Required.';
      continue;
    }
    const result = check(name, spec, raw, { sanitize });
    if (result.error) errors[name] = result.error; else values[name] = result.value;
  }
  if (Object.keys(errors).length) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: errors });
  return values;
}

export function parseTagNames(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 15) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { tags: 'Provide up to 15 tags.' } });
  const names = [...new Set(raw.map((t) => String(t ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (names.some((n) => n.length < 2 || n.length > 40 || !slugify(n))) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { tags: 'Each tag must be 2 to 40 characters.' } });
  return names;
}
