// Admin-editable AI settings, stored as one JSON document in the existing `settings` table (key 'ai', never public).
// Every value is validated and clamped to the HARD ceilings in config.js, both when an admin saves and when it is read back.
import { AppError } from '../errors.js';
import { CAPABILITIES, TIERS, HARD, defaultSettings } from './config.js';

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,59}$/;
const clean = (value) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

const FIELDS = {
  ai_name: { type: 'string', min: 1, max: 40 },
  welcome_message: { type: 'string', min: 0, max: 400 },
  system_prompt: { type: 'string', min: 1, max: 4000 },
  safety_instructions: { type: 'string', min: 0, max: 2000 },
  upgrade_message: { type: 'string', min: 0, max: 300 },
  default_model: { type: 'slug', nullable: true },
  default_capability: { type: 'enum', values: CAPABILITIES },
  guest_access: { type: 'bool' }, free_access: { type: 'bool' }, premium_access: { type: 'bool' },
  failover_enabled: { type: 'bool' }, free_failover: { type: 'bool' }, rag_enabled: { type: 'bool' },
  max_input_chars: { type: 'int', min: 1, max: HARD.maxInputChars },
  max_output_tokens: { type: 'int', min: 1, max: HARD.maxOutputTokens },
  max_context_messages: { type: 'int', min: 0, max: HARD.maxContextMessages },
  max_context_chars: { type: 'int', min: 0, max: HARD.maxContextChars },
  max_attempts: { type: 'int', min: 1, max: HARD.maxAttempts },
  request_timeout_ms: { type: 'int', min: HARD.minTimeoutMs, max: HARD.maxTimeoutMs },
  total_deadline_ms: { type: 'int', min: 2000, max: HARD.maxDeadlineMs },
  retention_days: { type: 'int', min: 0, max: HARD.maxRetentionDays },
};
const LIMIT_FIELDS = { per_minute: { min: 1, max: 600 }, per_day: { min: 1, max: 100000 }, tokens_per_day: { min: 1, max: 100000000, nullable: true } };

function check(name, spec, value) {
  if (spec.type === 'bool') return typeof value === 'boolean' ? { value } : { error: 'Must be true or false.' };
  if (spec.type === 'int') return Number.isInteger(value) && value >= spec.min && value <= spec.max ? { value } : { error: `Must be a whole number from ${spec.min} to ${spec.max}.` };
  if (spec.type === 'enum') return spec.values.includes(value) ? { value } : { error: `Must be one of: ${spec.values.join(', ')}.` };
  if (spec.type === 'slug') {
    if ((value === null || value === '') && spec.nullable) return { value: null };
    return typeof value === 'string' && SLUG_RE.test(value) ? { value } : { error: 'Use a model slug.' };
  }
  if (typeof value !== 'string') return { error: 'Must be text.' };
  const text = clean(value);
  return text.length >= spec.min && text.length <= spec.max ? { value: text } : { error: `Must be ${spec.min} to ${spec.max} characters.` };
}

// strict = admin save (throws 422 with per-field messages); lenient = reading stored data (bad values fall back to the base).
function build(input, base, strict) {
  const out = { ...base, limits: structuredClone(base.limits) };
  const errors = {};
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  for (const [name, spec] of Object.entries(FIELDS)) {
    if (!(name in src)) continue;
    const { value, error } = check(name, spec, src[name]);
    if (error) errors[name] = error; else out[name] = value;
  }

  if ('enabled_capabilities' in src) {
    const list = src.enabled_capabilities;
    if (Array.isArray(list) && list.length > 0 && list.every((c) => CAPABILITIES.includes(c))) out.enabled_capabilities = [...new Set(list)];
    else errors.enabled_capabilities = 'Choose at least one valid capability.';
  }

  if ('limits' in src) {
    if (!src.limits || typeof src.limits !== 'object') errors.limits = 'Provide the limits object.';
    else {
      for (const tier of TIERS) {
        if (!(tier in src.limits)) continue;
        for (const [field, spec] of Object.entries(LIMIT_FIELDS)) {
          if (!(field in (src.limits[tier] ?? {}))) continue;
          const value = src.limits[tier][field];
          const ok = (value === null && spec.nullable) || (Number.isInteger(value) && value >= spec.min && value <= spec.max);
          if (ok) out.limits[tier][field] = value; else errors[`limits.${tier}.${field}`] = `Must be a whole number from ${spec.min} to ${spec.max}${spec.nullable ? ' (or null for no limit)' : ''}.`;
        }
      }
    }
  }

  if (!out.enabled_capabilities.includes(out.default_capability)) {
    if ('default_capability' in src || 'enabled_capabilities' in src) errors.default_capability = 'The default capability must be one of the enabled capabilities.';
    out.default_capability = out.enabled_capabilities.includes('general') ? 'general' : out.enabled_capabilities[0];
  }
  if (out.total_deadline_ms < out.request_timeout_ms) {
    if (strict && ('total_deadline_ms' in src || 'request_timeout_ms' in src)) errors.total_deadline_ms = 'The total deadline must be at least the per-request timeout.';
    out.total_deadline_ms = Math.min(Math.max(out.request_timeout_ms, out.total_deadline_ms), HARD.maxDeadlineMs);
  }
  if (strict && Object.keys(errors).length) throw new AppError('VALIDATION_ERROR', 'Some AI settings are invalid.', 422, { fields: errors });
  return out;
}

export const parseSettingsInput = (input, current) => build(input, current, true);
export const normalizeStored = (stored, env = process.env) => build(stored, defaultSettings(env), false);

export function createSettingsStore({ db, env = process.env, ttlMs = 15000, now = () => Date.now() }) {
  let cache = null;
  return {
    async get() {
      if (cache && now() - cache.at < ttlMs) return cache.value;
      const [row] = await db.select('settings', { select: 'value', key: 'eq.ai', limit: '1' });
      cache = { at: now(), value: normalizeStored(row?.value, env) };
      return cache.value;
    },
    async put(value) {
      await db.insert('settings', { key: 'ai', value, is_public: false, updated_at: new Date().toISOString() }, { query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal' });
      cache = { at: now(), value };
      return value;
    },
    invalidate() { cache = null; },
  };
}
