const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => UUID_RE.test(String(value ?? ''));

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

// Returns an error message, or null when the password is acceptable.
// 72 bytes is the bcrypt limit used by Supabase Auth; longer passwords would be silently truncated.
export function passwordProblem(value) {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(value, 'utf8') > 72) return 'Password must be 72 bytes or fewer.';
  return null;
}

export function cleanDisplayName(value) {
  const name = String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}
