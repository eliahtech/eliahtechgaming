// Central, platform-neutral environment validation. SERVER-ONLY: never import this from a client component.
// It takes an env object (process.env on Vercel/Node, the Worker env on Cloudflare) so behaviour is identical on both.
// Error messages name the variable and the expected format. Values are never included in any message.

const isUrl = (v, { https = false, allowLocalHttp = true } = {}) => {
  try {
    const u = new URL(v);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    if (https) return false;
    return u.protocol === 'http:' && allowLocalHttp && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
};
const isInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const isBool = (v) => ['true', 'false', '1', '0'].includes(String(v).toLowerCase());
const isSecret = (v) => v.length >= 16 && !/\s/.test(v);
const isJwtLike = (v) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v) || /^sb_(publishable|secret)_[\w-]+$/.test(v);

// kind: format check. scope: 'secret' (never public) | 'public' (browser-safe) | 'config'.
// platforms: where it must be provided. group: integration it belongs to.
export const ENV_SPEC = [
  {name:'JOBS_TOKEN',group:'core',scope:'secret',required:false,format:'random secret, 32+ characters',check:v=>v.length>=32&&!/\s/.test(v)},
  {name:'CRON_SECRET',group:'core',scope:'secret',required:false,format:'random secret, 32+ characters (Vercel Cron sends it automatically)',check:v=>v.length>=32&&!/\s/.test(v)},
  {name:'AD_ALLOWED_ORIGINS',group:'ads',scope:'config',required:false,format:'comma-separated exact https origins',check:v=>v.split(',').map(s=>s.trim()).filter(Boolean).every(s=>{try{return new URL(s).origin===s&&s.startsWith('https://');}catch{return false;}})},
  {name:'AI_VOICE_ENABLED',group:'ai',scope:'config',required:false,format:'true | false',check:isBool},
  {name:'OPENROUTER_API_KEY',group:'ai',scope:'secret',required:false,format:'provider API key',check:v=>v.length>=8&&!/\s/.test(v)},
  { name: 'NODE_ENV', group: 'core', scope: 'config', required: false, format: 'development | test | production', check: (v) => ['development', 'test', 'production'].includes(v) },
  { name: 'APP_URL', group: 'core', scope: 'config', required: 'production', format: 'absolute URL; https:// in production', check: (v, c) => isUrl(v, { https: c.production }) },
  { name: 'SITE_API_URL', group: 'core', scope: 'config', required: false, format: 'absolute URL of the Express API (…/api/v1); https:// in production', check: (v, c) => isUrl(v, { https: c.production }) },
  { name: 'ALLOWED_ORIGINS', group: 'core', scope: 'config', required: false, format: 'comma-separated https:// origins', check: (v) => v.split(',').map((s) => s.trim()).filter(Boolean).every((o) => isUrl(o)) },
  { name: 'HEALTH_DIAGNOSTICS_TOKEN', group: 'health', scope: 'secret', required: false, format: 'random string, 24+ characters, no whitespace', check: (v) => v.length >= 24 && !/\s/.test(v) },
  { name: 'GOOGLE_AUTH_ENABLED', group: 'google', scope: 'config', required: false, format: 'true | false (true only after enabling the Google provider in Supabase)', check: (v) => ['true', 'false'].includes(v) },
  { name: 'SCHEDULER_ENABLED', group: 'core', scope: 'config', required: false, format: 'true | false (true on exactly ONE deployment)', check: isBool },

  { name: 'SUPABASE_URL', group: 'supabase', scope: 'config', required: 'production', format: 'https://<project-ref>.supabase.co', check: (v, c) => isUrl(v, { https: c.production }) },
  { name: 'SUPABASE_ANON_KEY', group: 'supabase', scope: 'secret', required: 'production', format: 'anon/publishable key', check: isJwtLike },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', group: 'supabase', scope: 'secret', required: 'production', format: 'service-role/secret key (server only)', check: isJwtLike },
  { name: 'SUPABASE_AUTH_HOOK_SECRET', group: 'supabase', scope: 'secret', required: false, format: 'webhook signing secret', check: isSecret },

  { name: 'RESEND_API_KEY', group: 'email', scope: 'secret', required: false, format: 're_… API key', check: (v) => v.length >= 8 && !/\s/.test(v) },
  { name: 'EMAIL_FROM', group: 'email', scope: 'config', required: false, format: 'Name <address@domain> or address@domain', check: (v) => /^(.+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(v) },
  { name: 'EMAIL_TIMEOUT_MS', group: 'email', scope: 'config', required: false, format: 'integer 1000–60000', check: (v) => isInt(v, 1000, 60000) },
  { name: 'NEWSLETTER_BATCH_SIZE', group: 'email', scope: 'config', required: false, format: 'integer 1–50 (emails claimed per request; default 50)', check: (v) => isInt(v, 1, 50) },
  { name: 'GOOGLE_SITE_VERIFICATION', group: 'email', scope: 'config', required: false, format: 'token from Google Search Console (HTML tag method), letters, digits, - and _', check: (v) => /^[A-Za-z0-9_-]{20,100}$/.test(v) },
  { name: 'BING_SITE_VERIFICATION', group: 'email', scope: 'config', required: false, format: 'token from Bing Webmaster Tools (HTML meta tag method)', check: (v) => /^[A-Za-z0-9_-]{16,100}$/.test(v) },
  { name: 'NEWSLETTER_DAILY_LIMIT', group: 'email', scope: 'config', required: false, format: 'integer 1–1000 (newsletter emails per UTC day; default 30; the admin setting overrides it)', check: (v) => isInt(v, 1, 1000) },

  { name: 'PESAPAL_ENV', group: 'pesapal', scope: 'config', required: false, format: 'sandbox | live', check: (v) => ['sandbox', 'live'].includes(v) },
  { name: 'PESAPAL_CONSUMER_KEY', group: 'pesapal', scope: 'secret', required: false, format: 'non-empty string', check: (v) => !/\s/.test(v) },
  { name: 'PESAPAL_CONSUMER_SECRET', group: 'pesapal', scope: 'secret', required: false, format: 'non-empty string', check: (v) => !/\s/.test(v) },
  { name: 'PESAPAL_IPN_ID', group: 'pesapal', scope: 'config', required: false, format: 'IPN id from `npm run pesapal:register-ipn`', check: (v) => /^[\w-]{8,}$/.test(v) },
  { name: 'PESAPAL_IPN_URL', group: 'pesapal', scope: 'config', required: false, format: 'https URL', check: (v) => isUrl(v, { https: true }) },
  { name: 'PESAPAL_CALLBACK_URL', group: 'pesapal', scope: 'config', required: false, format: 'https URL', check: (v) => isUrl(v, { https: true }) },
  { name: 'PESAPAL_CANCELLATION_URL', group: 'pesapal', scope: 'config', required: false, format: 'https URL', check: (v) => isUrl(v, { https: true }) },
  { name: 'PESAPAL_BASE_URL', group: 'pesapal', scope: 'config', required: false, format: 'https URL', check: (v) => isUrl(v, { https: true }) },
  { name: 'PESAPAL_CURRENCY', group: 'pesapal', scope: 'config', required: false, format: 'ISO 4217 code, e.g. KES', check: (v) => /^[A-Z]{3}$/.test(v) },

  { name: 'PAYPAL_BASE_URL', group: 'paypal', scope: 'config', required: false, format: 'https://api-m.sandbox.paypal.com or https://api-m.paypal.com', check: (v) => ['https://api-m.sandbox.paypal.com', 'https://api-m.paypal.com'].includes(v.replace(/\/$/, '')) },
  { name: 'PAYPAL_CLIENT_ID', group: 'paypal', scope: 'secret', required: false, format: 'non-empty string', check: (v) => !/\s/.test(v) },
  { name: 'PAYPAL_CLIENT_SECRET', group: 'paypal', scope: 'secret', required: false, format: 'non-empty string', check: (v) => !/\s/.test(v) },
  { name: 'PAYPAL_WEBHOOK_ID', group: 'paypal', scope: 'config', required: false, format: 'webhook id', check: (v) => /^[\w-]{6,}$/.test(v) },
  { name: 'PAYPAL_CURRENCY', group: 'paypal', scope: 'config', required: false, format: 'ISO 4217 code, e.g. USD', check: (v) => /^[A-Z]{3}$/.test(v) },
  { name: 'PAYMENT_TIMEOUT_MS', group: 'paypal', scope: 'config', required: false, format: 'integer 1000–60000', check: (v) => isInt(v, 1000, 60000) },

  { name: 'GROQ_API_KEY', group: 'ai', scope: 'secret', required: false, format: 'provider API key', check: (v) => v.length >= 8 && !/\s/.test(v) },
  { name: 'GEMINI_API_KEY', group: 'ai', scope: 'secret', required: false, format: 'provider API key', check: (v) => v.length >= 8 && !/\s/.test(v) },
  { name: 'AI_MAX_INPUT_CHARS', group: 'ai', scope: 'config', required: false, format: 'integer 1–100000', check: (v) => isInt(v, 1, 100000) },
  { name: 'AI_MAX_OUTPUT_TOKENS', group: 'ai', scope: 'config', required: false, format: 'integer 1–32768', check: (v) => isInt(v, 1, 32768) },
  { name: 'AI_MAX_RETRIES', group: 'ai', scope: 'config', required: false, format: 'integer 0–5', check: (v) => isInt(v, 0, 5) },
  { name: 'AI_REQUEST_TIMEOUT_MS', group: 'ai', scope: 'config', required: false, format: 'integer 1000–120000', check: (v) => isInt(v, 1000, 120000) },
  { name: 'AI_DEFAULT_MODEL', group: 'ai', scope: 'config', required: false, format: 'model key from ai_models', check: (v) => /^[\w.:-]{2,80}$/.test(v) },
  { name: 'AI_DEFAULT_CAPABILITY', group: 'ai', scope: 'config', required: false, format: 'capability name, e.g. general', check: (v) => /^[\w-]{2,40}$/.test(v) },
  { name: 'AI_ALLOWED_BASE_HOSTS', group: 'ai', scope: 'config', required: false, format: 'comma-separated hostnames', check: (v) => v.split(',').map((x) => x.trim()).filter(Boolean).every((h) => /^[a-z0-9.-]+$/i.test(h)) },
  { name: 'CORS_ORIGIN', group: 'core', scope: 'config', required: false, format: 'legacy alias of ALLOWED_ORIGINS', check: (v) => v.split(',').map((x) => x.trim()).filter(Boolean).every((o) => isUrl(o)) },
  { name: 'PORT', group: 'core', scope: 'config', required: false, format: 'integer 1–65535 (Express only)', check: (v) => isInt(v, 1, 65535) },
  { name: 'JODIT_VERSION', group: 'core', scope: 'config', required: false, format: 'semver, used by `npm run vendor`', check: (v) => /^\d+\.\d+\.\d+$/.test(v) },
];

// Variables injected by the hosting platform; read by code but never set by us.
export const PLATFORM_ENV = ['VERCEL', 'VERCEL_ENV'];

// Groups whose variables must be complete as a set once any of them is provided.
const ALL_OR_NOTHING = { supabase: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'], pesapal: ['PESAPAL_CONSUMER_KEY', 'PESAPAL_CONSUMER_SECRET'], paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] };

const read = (env, name) => (typeof env?.[name] === 'string' ? env[name] : undefined);

export function validateEnv(env = process.env, { mode } = {}) {
  const nodeEnv = read(env, 'NODE_ENV');
  const production = mode ? mode === 'production' : nodeEnv === 'production' || env?.VERCEL_ENV === 'production';
  const ctx = { production };
  const errors = [];
  const present = new Set();

  for (const spec of ENV_SPEC) {
    const raw = read(env, spec.name);
    const missing = raw === undefined;
    const empty = !missing && raw.trim() === '';
    if (!missing && !empty) present.add(spec.name);
    const mustHave = spec.required === true || (spec.required === 'production' && production);
    if (missing && mustHave) errors.push({ variable: spec.name, problem: 'missing', expected: spec.format });
    else if (empty && mustHave) errors.push({ variable: spec.name, problem: 'empty', expected: spec.format });
    else if (!missing && !empty && !spec.check(raw.trim(), ctx)) errors.push({ variable: spec.name, problem: 'invalid', expected: spec.format });
  }

  // Incompatible combinations
  const partial = [];
  for (const [group, names] of Object.entries(ALL_OR_NOTHING)) {
    const have = names.filter((n) => present.has(n));
    if (have.length && have.length < names.length) {
      for (const n of names.filter((x) => !present.has(x))) if (!errors.some((e) => e.variable === n)) errors.push({ variable: n, problem: 'missing', expected: `required when other ${group} variables are set` });
      partial.push(group);
    }
  }
  if (read(env, 'GOOGLE_AUTH_ENABLED') === 'true') {
    for (const n of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) if (!present.has(n) && !errors.some((e) => e.variable === n)) errors.push({ variable: n, problem: 'missing', expected: 'required when GOOGLE_AUTH_ENABLED=true' });
    if (!present.has('APP_URL') && !errors.some((e) => e.variable === 'APP_URL')) errors.push({ variable: 'APP_URL', problem: 'missing', expected: 'required when GOOGLE_AUTH_ENABLED=true (OAuth redirect origin)' });
  }
  if (['true', '1'].includes(String(read(env, 'SCHEDULER_ENABLED')).toLowerCase()) && !present.has('JOBS_TOKEN') && !present.has('CRON_SECRET') && !errors.some((e) => e.variable === 'JOBS_TOKEN')) errors.push({ variable: 'JOBS_TOKEN', problem: 'missing', expected: 'required when SCHEDULER_ENABLED=true: set JOBS_TOKEN (external scheduler) or CRON_SECRET (Vercel Cron), a random secret of 32+ characters' });
  if (production && read(env, 'PAYPAL_BASE_URL')?.includes('sandbox')) errors.push({ variable: 'PAYPAL_BASE_URL', problem: 'incompatible', expected: 'live PayPal endpoint when NODE_ENV=production' });
  if (production && read(env, 'PESAPAL_ENV') === 'sandbox') errors.push({ variable: 'PESAPAL_ENV', problem: 'incompatible', expected: 'live when NODE_ENV=production' });

  const badVars = new Set(errors.map((e) => e.variable));
  const groupState = (group, requiredNames) => {
    const names = requiredNames;
    if (names.some((n) => badVars.has(n))) return names.every((n) => !present.has(n)) ? 'NOT CONFIGURED' : 'INVALID';
    return names.every((n) => present.has(n)) ? 'CONFIGURED' : 'NOT CONFIGURED';
  };
  const integrations = {
    supabase: groupState('supabase', ALL_OR_NOTHING.supabase),
    pesapal: groupState('pesapal', ALL_OR_NOTHING.pesapal),
    paypal: groupState('paypal', ALL_OR_NOTHING.paypal),
    email: groupState('email', ['RESEND_API_KEY']),
    ai: present.has('GROQ_API_KEY') || present.has('GEMINI_API_KEY') ? (badVars.has('GROQ_API_KEY') || badVars.has('GEMINI_API_KEY') ? 'INVALID' : 'CONFIGURED') : 'NOT CONFIGURED',
  };
  return { ok: errors.length === 0, production, errors, integrations };
}

export function formatEnvErrors(result) {
  return result.errors.map((e) => `${e.variable}: ${e.problem} (expected ${e.expected})`).join('\n');
}

// Throws a ConfigError-style error naming variables only. Use for startup where the app cannot work without the group.
export function assertEnv(env = process.env, opts) {
  const result = validateEnv(env, opts);
  if (!result.ok) {
    const error = new Error(`Invalid environment configuration:\n${formatEnvErrors(result)}`);
    error.name = 'EnvConfigError';
    error.code = 'ENV_INVALID';
    error.variables = result.errors.map((e) => e.variable);
    throw error;
  }
  return result;
}

// Return Supabase settings or null when unconfigured. Never substitutes development defaults.
export function supabaseSettings(env = process.env) {
  const url = read(env, 'SUPABASE_URL')?.trim().replace(/\/$/, '');
  const serviceKey = read(env, 'SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const anonKey = read(env, 'SUPABASE_ANON_KEY')?.trim();
  return url && serviceKey ? { url, serviceKey, anonKey: anonKey || null } : null;
}

export const SECRET_NAMES = ENV_SPEC.filter((s) => s.scope === 'secret').map((s) => s.name);
