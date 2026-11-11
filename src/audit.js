// Audit trail for security-sensitive actions. Metadata is scrubbed so secrets cannot be written by accident.
const SECRET_KEY_RE = /pass(word)?|secret|token|api[_-]?key|authorization|service[_-]?role|cookie|session/i;

export function scrub(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY_RE.test(k) ? '[redacted]' : scrub(v, depth + 1)]));
  }
  return typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

export async function audit(db, { actorId = null, action, targetType = null, targetId = null, metadata = {}, ip = null }) {
  try {
    await db.insert('audit_logs', { actor_id: actorId, action, target_type: targetType, target_id: targetId ? String(targetId) : null, metadata: scrub(metadata), ip }, { prefer: 'return=minimal' });
  } catch (error) {
    // An audit failure must never be silent, but it also must not break the user's request.
    console.error(JSON.stringify({ level: 'error', msg: 'audit_write_failed', action, code: error.code, detail: error.detail }));
  }
}
