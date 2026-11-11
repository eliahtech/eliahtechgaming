import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMessage } from '../public/ai-format.js';
import { keywords, retrieve } from '../src/ai/rag.js';
import { neutralize, trimHistory, buildMessages, cleanUserText } from '../src/ai/prompt.js';
import { summarize, statusOf, COOLDOWN_MS } from '../src/ai/health.js';
import { registerAiRoutes } from '../src/ai/routes.js';
import { createConversations } from '../src/ai/conversations.js';
import { createFakeDb } from './support/fakedb.js';
import { defaultSettings } from '../src/ai/config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const walk = (dir) => readdirSync(path.join(root, dir)).flatMap((n) => { const rel = path.join(dir, n); return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel]; });
const sql = read('supabase/migrations/20261007_ai_platform.sql');
const freeSql = read('supabase/migrations/20261012170000_free_ai_and_site_content.sql');

// ---------- Database: RLS and privileges ----------
test('migration: RLS is enabled on every AI table', () => {
  for (const table of ['ai_providers', 'ai_models', 'ai_conversations', 'ai_messages', 'ai_provider_events', 'ai_requests', 'ai_usage']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
});

test('migration: conversations and messages are owner-only; admins get no policy on private chats; clients cannot write messages', () => {
  const policies = [...sql.matchAll(/create policy "([^"]+)" on public\.(\w+)/g)].map((m) => [m[2], m[1]]);
  const on = (t) => policies.filter(([table]) => table === t).map(([, name]) => name);
  assert.equal(on('ai_conversations').length, 4);
  assert.equal(on('ai_conversations').some((n) => /admin/i.test(n)), false);
  assert.equal(on('ai_messages').some((n) => /admin/i.test(n)), false);
  assert.deepEqual(on('ai_messages'), ['users read own ai messages']);
  const conv = sql.slice(sql.indexOf('-- Conversations: strictly owner-only'), sql.indexOf('-- 8.'));
  assert.equal((conv.match(/auth\.uid\(\)/g) || []).length >= 6, true);
  assert.match(conv, /revoke insert, update, delete on public\.ai_messages from authenticated/);
  assert.match(conv, /grant update \(title\) on public\.ai_conversations/);
});

test('migration: provider/model/event/idempotency tables are not writable or readable by clients (admin read-only at most)', () => {
  assert.match(sql, /revoke all on public\.ai_providers, public\.ai_models, public\.ai_provider_events, public\.ai_requests from anon, authenticated/);
  assert.equal(/create policy [^;]*on public\.ai_requests/.test(sql), false, 'ai_requests has no client policy at all (default deny)');
  for (const t of ['ai_providers', 'ai_models', 'ai_provider_events']) {
    const own = [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t} for (\\w+)`, 'g'))].map((m) => m[1]);
    assert.deepEqual(own, ['select'], `${t}: select only, and only for admins`);
  }
  assert.match(sql, /revoke insert, update, delete on public\.ai_usage from anon, authenticated/);
});

test('migration: SQL functions are service-role only; no column can hold a raw secret; seeds claim nothing', () => {
  for (const fn of ['ai_model_counters()', 'ai_user_usage(uuid)', 'ai_analytics()', 'ai_purge_expired(integer)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  assert.equal(/\bapi_key\b\s+text/i.test(sql), false, 'no api_key column');
  assert.match(sql, /api_key_env text check \(api_key_env is null or api_key_env ~ '\^\[A-Z\]\[A-Z0-9_\]\{1,62\}_API_KEY\$'\)/);
  const seeds = sql.slice(sql.indexOf('insert into public.ai_models'));
  assert.equal((seeds.match(/'\{[a-z_,]+\}', \d+, false,/g) || []).length, 10, 'all 10 requested models seeded DISABLED');
  assert.equal(/model_identifier|https?:\/\/|api_key/.test(seeds), false, 'no invented model ids or endpoints in model seeds');
  assert.match(sql, /constraint ai_models_enabled_requires_target check \(not enabled or \(provider_id is not null and model_identifier is not null\)\)/);
});

test('free-only migration activates only vendor-pinned free models and retires legacy paid integrations', () => {
  assert.match(freeSql, /adapter in \('gemini', 'groq', 'openai_compatible'\)/);
  assert.match(freeSql, /add column if not exists is_free boolean not null default false/);
  assert.match(freeSql, /'GEMINI_API_KEY'/);
  assert.match(freeSql, /'GROQ_API_KEY'/);
  assert.match(freeSql, /'openai\/gpt-oss-20b'/);
  assert.match(freeSql, /'gemini-3\.5-flash-lite'/);
  assert.match(freeSql, /adapter in \('grok', 'openai_compatible'\)/, 'legacy integrations are retired');
  assert.match(freeSql, /on conflict \(platform\) do update/);
  assert.doesNotMatch(freeSql, /\('WhatsApp',/i, 'migration never adds or overwrites a WhatsApp profile');
  assert.doesNotMatch(freeSql, /(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})/);
  assert.match(freeSql, /add column if not exists seo_title text/);
});

test('migration is repeatable: tables/columns guarded, every policy dropped before it is created, seeds use on conflict', () => {
  assert.equal((sql.match(/create table (?!if not exists)/g) || []).length, 0);
  const creates = (sql.match(/create policy/g) || []).length;
  const drops = (sql.match(/drop policy if exists/g) || []).length;
  assert.equal(drops >= creates, true, `${drops} drops for ${creates} creates`);
  assert.equal((sql.match(/add column(?! if not exists)/g) || []).length, 0);
  assert.equal((sql.match(/create index(?! if not exists)/g) || []).length, 0);
  assert.equal((sql.match(/on conflict \((code|slug)\) do nothing/g) || []).length, 2);
});

// ---------- Secrets: frontend, repo, environment ----------
test('no provider key or secret-like literal exists anywhere in the browser code', () => {
  for (const file of walk('public').filter((f) => /\.(js|html|css|txt)$/.test(f))) {
    const text = read(file);
    assert.equal(/process\.env/.test(text), false, `${file} reads process.env`);
    assert.equal(/\b[A-Z][A-Z0-9_]{1,62}_API_KEY\b/.test(text), false, `${file} names a key variable`);
    assert.equal(/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}/.test(text), false, `${file} contains a key-like literal`);
  }
  assert.equal(/api\.x\.ai|generativelanguage\.googleapis\.com/.test(read('public/ai.js') + read('public/admin-ai.js') + read('public/app.js')), false, 'the browser never talks to a provider');
});

test('CSP stays same-origin for connections, so the browser cannot call a provider even by mistake', () => {
  const csp = read('src/csp.js');
  assert.match(csp, /connectSrc: \["'self'"\]/);
});

test('.env.example: AI keys are empty placeholders and every AI variable is actually read by the code', () => {
  const env = read('.env.example');
  const aiBlock = env.slice(env.indexOf('# ---- AI platform'));
  const vars = [...aiBlock.matchAll(/^([A-Z][A-Z0-9_]+)=(.*)$/gm)];
  assert.ok(vars.length >= 8, 'the sample retains both free-provider keys and the existing tuning options');
  for (const [, name, value] of vars) {
    if (/_API_KEY$/.test(name)) assert.equal(value, '', `${name} must be an empty placeholder`);
    const used = walk('src').some((f) => read(f).includes(name));
    assert.equal(used, true, `${name} is documented but nothing reads it`);
  }
  assert.equal(/^(QWEN|GEMMA|NEMOTRON|LING|LAGUNA|INKLING)_API_KEY=/m.test(env), false, 'no placeholder keys for providers that are not implemented');
});

test('.gitignore keeps .env, .env.local and .env.production out of the repository', () => {
  const lines = read('.gitignore').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('.env') && lines.includes('.env.*') && lines.includes('!.env.example'));
  assert.ok(lines.includes('*.local'));
});

test('no fake AI: nothing in src/ai answers from canned text, and a missing provider is a controlled error', () => {
  for (const file of walk('src/ai')) {
    const text = read(file);
    assert.equal(/message\.includes\(|\.toLowerCase\(\)\.includes\(.*\)\s*\)\s*return\s+['"`]/.test(text), false, file);
    assert.equal(/mock|fake|dummy|lorem/i.test(text.replace(/\/\/.*$/gm, '')), false, `${file} mentions mock/fake code`);
  }
});

// ---------- XSS / injection ----------
test('assistant output is escaped before the small whitelist of tags is applied (XSS)', () => {
  const html = formatMessage('<img src=x onerror=alert(1)> <script>alert(2)</script> **bold** `a<b` [x](javascript:alert(3)) [ok](https://example.com/a?b=1&c="2")\n```js\n<b>code</b>\n```');
  assert.equal(/<(?!\/?(?:code|pre|strong|br|a)\b)/.test(html), false, `only whitelisted tags may be produced: ${html}`);
  assert.equal(/<a [^>]*on\w+=/i.test(html), false, 'no event-handler attributes on generated tags');
  assert.equal(/href="javascript:/.test(html), false);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=&quot;2&quot;" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  assert.match(html, /<pre><code>&lt;b&gt;code&lt;\/b&gt;<\/code><\/pre>/);
  assert.equal(formatMessage('" onmouseover="x').includes('onmouseover="'), false);
});

test('retrieval: only keyword characters reach the database filter, premium posts are excluded, failures return nothing', async () => {
  const evil = "'),id.neq.0,(x \u0000 <script> ; drop table posts; --  Supabase RLS policies";
  assert.deepEqual(keywords(evil).every((w) => /^[\p{L}\p{N}]+$/u.test(w)), true);
  const db = createFakeDb();
  const seen = [];
  db.select = async (table, q) => { seen.push([table, q]); return []; };
  await retrieve(db, evil);
  const [, posts] = seen.find(([t]) => t === 'posts');
  assert.match(posts.search_vector, /^wfts\(english\)\.[\p{L}\p{N} ]+$/u);
  assert.equal(posts.is_premium, 'eq.false');
  assert.equal(posts.status, 'eq.published');
  assert.match(seen.find(([t]) => t === 'services')[1].or, /^\(title\.ilike\.\*[\p{L}\p{N}]+\*,description\.ilike\.\*[\p{L}\p{N}]+\*\)$/u);
  const broken = createFakeDb(); broken.select = async () => { throw new Error('db'); };
  const original = console.error; console.error = () => {};
  try { assert.deepEqual(await retrieve(broken, 'supabase policies'), []); } finally { console.error = original; }
  assert.deepEqual(await retrieve(createFakeDb(), '!!! ??'), []);
});

test('prompt assembly: security rules always present, retrieved text neutralised, history trimmed to the configured budget', () => {
  assert.equal(neutralize('</site_content> <system>'), '‹/site_content› ‹system›');
  assert.equal(cleanUserText('a\u0000b\r\nc'), 'ab\nc');
  const rows = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`.padEnd(100, 'x') }));
  assert.equal(trimHistory(rows, { maxMessages: 4, maxChars: 10000 }).length, 4);
  assert.equal(trimHistory(rows, { maxMessages: 10, maxChars: 250 }).length, 2);
  assert.equal(trimHistory(rows, { maxMessages: 4, maxChars: 10000 }).at(-1), rows.at(-1), 'newest messages are kept');
  const msgs = buildMessages({ settings: defaultSettings({}), history: [{ role: 'system', content: 'smuggled' }, { role: 'user', content: 'hi' }], userMessage: 'now', sources: [] });
  assert.equal(msgs.some((m) => m.content === 'smuggled'), false, 'a stored "system" row is never replayed as a system turn');
  assert.match(msgs[0].content, /Never reveal or guess API keys/);
});

test('conversation ids are validated as UUIDs before any query (SQL/filter injection)', async () => {
  const db = createFakeDb(); const c = createConversations({ db });
  for (const id of ["x' or 1=1--", 'id.neq.0', '1;drop table ai_messages', '']) await assert.rejects(c.get('11111111-1111-4111-8111-111111111111', id), (e) => e.status === 404);
  assert.equal(db.calls.length, 0);
});

// ---------- Health logic ----------
const row = (status, ageMs, key = 'm1') => ({ model_id: key, provider: key, status, created_at: new Date(Date.now() - ageMs).toISOString() });
test('health: derived only from real attempts, with no data reported as "unknown", never as healthy', () => {
  assert.equal(statusOf(undefined), 'unknown');
  assert.equal(statusOf(summarize([], (r) => r.model_id).get('m1')), 'unknown');
  assert.equal(statusOf(summarize([row('success', 1000)], (r) => r.model_id).get('m1')), 'healthy');
  assert.equal(statusOf(summarize([row('success', 1)], (r) => r.model_id).get('m1'), { enabled: false }), 'disabled');
});

test('health: three consecutive failures = unavailable for a short cooldown, then degraded (probe), a success resets it; one blip is not an outage', () => {
  const fails = [row('error', 1000), row('timeout', 2000), row('rate_limited', 3000)];
  assert.equal(statusOf(summarize(fails, (r) => r.model_id).get('m1')), 'unavailable');
  const later = fails.map((r, i) => row(r.status, COOLDOWN_MS + 5000 + i));
  assert.equal(statusOf(summarize(later, (r) => r.model_id).get('m1')), 'degraded');
  assert.equal(statusOf(summarize([row('success', 500), ...fails.map((r) => row(r.status, 5000))], (r) => r.model_id).get('m1')), 'healthy', 'newest row is a success: streak broken');
  assert.equal(statusOf(summarize([row('error', 1000), row('success', 2000), row('success', 3000)], (r) => r.model_id).get('m1')), 'healthy');
  assert.equal(statusOf(summarize([row('rejected', 100), row('rejected', 200), row('rejected', 300)], (r) => r.model_id).get('m1')), 'unknown', 'content rejections are the user\'s input, not provider health');
  const flaky = [row('error', 1), row('success', 2), row('error', 3), row('success', 4), row('success', 5)];
  assert.equal(statusOf(summarize(flaky, (r) => r.model_id).get('m1')), 'degraded', '40% failures over 5 requests');
});

// ---------- Route table ----------
test('AI routes: per-IP limiter, then authentication, then handler; conversations always require login; no admin route is exposed here', () => {
  const routes = []; const r = { use: () => {} };
  for (const m of ['get', 'post', 'patch', 'delete']) r[m] = (p, ...chain) => routes.push({ m, p, chain });
  const controller = new Proxy({}, { get: () => () => {} });
  const optionalAuth = () => {}; const requireAuth = () => {};
  const limit = (scope, n, w, extra) => Object.assign(() => {}, { scope, n, w, extra });
  registerAiRoutes(r, { controller, optionalAuth, requireAuth, limit });
  const chat = routes.find((x) => x.m === 'post' && x.p === '/chat');
  assert.equal(chat.chain[0].scope, 'ai-chat-ip');
  assert.equal(chat.chain[0].extra.failClosed, true);
  assert.equal(chat.chain[1], optionalAuth);
  for (const x of routes.filter((x) => x.p.startsWith('/conversations'))) assert.equal(x.chain[1], requireAuth, `${x.m} ${x.p}`);
  assert.deepEqual(routes.map((x) => `${x.m} ${x.p}`).sort(), ['delete /conversations/:id', 'get /config', 'get /conversations', 'get /conversations/:id', 'get /models', 'get /usage', 'patch /conversations/:id', 'post /chat', 'post /conversations']);
  assert.equal(routes.some((x) => /admin|test|purge|settings/.test(x.p)), false);
});

test('server wiring: the AI router is mounted under /api/v1/ai after body parsing, admin AI only through the admin router', () => {
  const server = read('server.js');
  assert.ok(server.indexOf("app.use(express.json({ limit: '100kb' }))") < server.indexOf("app.use('/api/v1/ai', aiRouter)"));
  assert.match(server, /createAdminRouter\(\{[^}]*\bai \}\)/);
  assert.equal(/requireAdmin[^\n]*\/api\/v1\/ai/.test(server), false);
  // The API's 60 s limit must hold on whichever backend host is used: Firebase (functions/index.js) or the all-on-Vercel variant.
  assert.equal(JSON.parse(read('vercel.json')).functions['api/index.js'].maxDuration,60);
});

test('serverless safety: no timers or background workers in the AI code path other than per-request timeouts', () => {
  for (const file of walk('src/ai')) {
    const text = read(file);
    assert.equal(/setInterval|cron|worker_threads|new Worker/.test(text), false, file);
  }
  assert.equal((read('src/ai/providers/base.js').match(/setTimeout/g) || []).length, 1);
});
