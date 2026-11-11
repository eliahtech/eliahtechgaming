import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import { GroqProvider } from '../src/ai/providers/groq.js';
import { OpenAICompatibleProvider } from '../src/ai/providers/openai-compatible.js';
import { createProviderFactory, resolveBaseUrl } from '../src/ai/providers/index.js';
import { ProviderError, classifyHttpStatus, assertSafeBaseUrl } from '../src/ai/providers/base.js';

const KEY = 'sentinel-secret-key-123456';
const reply = (status, body) => async (url, init) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const recording = (status, body) => { const seen = []; const fn = async (url, init) => { seen.push({ url, init }); return reply(status, body)(url, init); }; fn.seen = seen; return fn; };
const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const messages = [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'again' }];
const request = (extra = {}) => ({ apiKey: KEY, baseUrl: GeminiProvider.defaultBaseUrl, model: 'models/gemini-x', messages, maxTokens: 100, temperature: 0.3, timeoutMs: 500, ...extra });
const caught = async (fn) => { try { await fn(); } catch (error) { return error; } throw new Error('expected a rejection'); };

test('Gemini: key travels in a header (never the URL), system prompt and roles are mapped, usage is read', async () => {
  const fetchImpl = recording(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hello ' }, { text: 'there' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15, totalTokenCount: 120 } });
  const out = await new GeminiProvider({ fetchImpl }).complete(request());
  const { url, init } = fetchImpl.seen[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
  assert.equal(url.includes(KEY), false);
  assert.equal(init.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'be brief');
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(body.generationConfig.maxOutputTokens, 100);
  assert.equal(out.content, 'Hello there');
  assert.deepEqual(out.usage, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }); // output = total - prompt (includes thinking tokens)
});

test('Gemini: safety blocks are non-recoverable content rejections; an invalid key (HTTP 400) is an auth problem', async () => {
  for (const body of [{ promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'SAFETY' }] }]) {
    const error = await caught(() => new GeminiProvider({ fetchImpl: reply(200, body) }).complete(request()));
    assert.deepEqual([error.code, error.recoverable], ['AI_CONTENT_REJECTED', false]);
  }
  const auth = await caught(() => new GeminiProvider({ fetchImpl: reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }) }).complete(request()));
  assert.deepEqual([auth.code, auth.recoverable], ['AI_PROVIDER_AUTH', false]);
  const plain400 = await caught(() => new GeminiProvider({ fetchImpl: reply(400, { error: { message: 'bad field' } }) }).complete(request()));
  assert.deepEqual([plain400.code, plain400.recoverable], ['AI_PROVIDER_REJECTED_REQUEST', false]);
});

test('HTTP status classification: 429/408/5xx recover on the next model; 400/401/403/404 never do', () => {
  for (const s of [429, 408, 500, 502, 503, 504, 529]) assert.equal(classifyHttpStatus(s).recoverable, true, `status ${s}`);
  for (const s of [400, 401, 403, 404, 422]) assert.equal(classifyHttpStatus(s).recoverable, false, `status ${s}`);
  assert.equal(classifyHttpStatus(429).code, 'AI_PROVIDER_RATE_LIMITED');
});

test('timeouts are enforced and recoverable; network failures and unreadable 200s are recoverable; empty answers too', async () => {
  const t0 = Date.now();
  const timeout = await caught(() => new GeminiProvider({ fetchImpl: hang }).complete(request({ timeoutMs: 40 })));
  assert.deepEqual([timeout.code, timeout.recoverable], ['AI_PROVIDER_TIMEOUT', true]);
  assert.ok(Date.now() - t0 < 1000);
  const net = await caught(() => new GeminiProvider({ fetchImpl: async () => { throw new TypeError('fetch failed'); } }).complete(request()));
  assert.deepEqual([net.code, net.recoverable], ['AI_PROVIDER_UNAVAILABLE', true]);
  const garbled = await caught(() => new GeminiProvider({ fetchImpl: reply(200, '<html>oops') }).complete(request()));
  assert.equal(garbled.recoverable, true);
  const empty = await caught(() => new GeminiProvider({ fetchImpl: reply(200, { candidates: [{ content: { parts: [] } }] }) }).complete(request()));
  assert.deepEqual([empty.code, empty.recoverable], ['AI_PROVIDER_EMPTY_RESPONSE', true]);
});

test('OpenAI-compatible adapter: bearer auth, /chat/completions, usage, content_filter, array content', async () => {
  const fetchImpl = recording(200, { choices: [{ message: { content: [{ type: 'text', text: 'ok' }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } });
  const out = await new OpenAICompatibleProvider({ fetchImpl }).complete({ ...request(), baseUrl: 'https://llm.example.com/v1/', model: 'vendor/model-1' });
  assert.equal(fetchImpl.seen[0].url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(fetchImpl.seen[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(fetchImpl.seen[0].init.body).model, 'vendor/model-1');
  assert.deepEqual(out.usage, { inputTokens: 7, outputTokens: 3, totalTokens: 10 });
  const filtered = await caught(() => new OpenAICompatibleProvider({ fetchImpl: reply(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }) }).complete({ ...request(), baseUrl: 'https://llm.example.com/v1' }));
  assert.equal(filtered.code, 'AI_CONTENT_REJECTED');
});

test('usage is null (not invented) when the provider does not report it', async () => {
  const out = await new OpenAICompatibleProvider({ fetchImpl: reply(200, { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }) }).complete({ ...request(), baseUrl: 'https://llm.example.com/v1' });
  assert.equal(out.usage, null);
});

test('no endpoint is ever invented: the generic adapter needs an explicit base URL, and Grok/Gemini are pinned to their vendor', async () => {
  const err = await caught(() => new OpenAICompatibleProvider({ fetchImpl: reply(200, {}) }).complete({ ...request(), baseUrl: null }));
  assert.equal(err.code, 'AI_PROVIDER_MISCONFIGURED');
  assert.equal(resolveBaseUrl({ adapter: 'openai_compatible', base_url: null }, { base_url: null }), null);
  assert.equal(resolveBaseUrl({ adapter: 'groq', base_url: null }, {}), 'https://api.groq.com/openai/v1');
  const fetchImpl = recording(200, {});
  for (const [Adapter, evil] of [[GroqProvider, 'https://evil.example.com/v1'], [GeminiProvider, 'https://evil.example.com/v1beta']]) {
    const blocked = await caught(() => new Adapter({ fetchImpl }).complete({ ...request(), baseUrl: evil }));
    assert.equal(blocked.code, 'AI_PROVIDER_MISCONFIGURED');
  }
  assert.equal(fetchImpl.seen.length, 0, 'the key must never be sent to a non-vendor host');
});

test('base URL safety (SSRF): https only, no credentials, no IP literals, no internal names, optional operator allow-list', () => {
  for (const bad of ['http://llm.example.com', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://localhost/v1', 'https://user:pw@llm.example.com', 'https://llm.example.com/v1?key=1', 'https://intranet/v1', 'https://svc.internal/v1', 'javascript:alert(1)', '']) {
    assert.throws(() => assertSafeBaseUrl(bad, { allowedHosts: [] }), (e) => e.code === 'AI_PROVIDER_MISCONFIGURED', bad);
  }
  assert.equal(assertSafeBaseUrl('https://llm.example.com/v1/', { allowedHosts: [] }), 'https://llm.example.com/v1');
  assert.throws(() => assertSafeBaseUrl('https://other.example.org/v1', { allowedHosts: ['example.com'] }));
  assert.equal(assertSafeBaseUrl('https://api.example.com/v1', { allowedHosts: ['example.com'] }), 'https://api.example.com/v1');
});

test('thrown errors never contain the API key or provider response text', async () => {
  const secretBody = { error: { message: `leaked ${KEY} in provider text` } };
  for (const status of [400, 401, 429, 500]) {
    const error = await caught(() => new GeminiProvider({ fetchImpl: reply(status, secretBody) }).complete(request()));
    assert.ok(error instanceof ProviderError);
    const dump = `${error.message} ${error.stack} ${JSON.stringify(error)} ${error.publicMessage}`;
    assert.equal(dump.includes(KEY), false, `status ${status}`);
    assert.equal(dump.includes('leaked'), false);
  }
});

test('factory: configured only when the adapter, env credential and endpoint are all valid; keys are read from the environment at call time', async () => {
  const provider = { adapter: 'groq', api_key_env: 'GROQ_API_KEY', base_url: null, is_free: true };
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers.Authorization); return reply(200, { choices: [{ message: { content: 'x' } }] })(); };
  assert.equal(createProviderFactory({ env: {}, fetchImpl }).isConfigured(provider, {}), false);
  const factory = createProviderFactory({ env: { GROQ_API_KEY: KEY }, fetchImpl });
  assert.equal(factory.isConfigured(provider, { is_free: true }), true);
  assert.equal(factory.isConfigured({ ...provider, adapter: 'nope' }, { is_free: true }), false);
  assert.equal(factory.isConfigured({ adapter: 'openai_compatible', api_key_env: 'GROQ_API_KEY', base_url: 'https://llm.example.com/v1', is_free: true }, { is_free: true }), false, 'generic adapter is not an approved free integration');
  await factory.call(provider, { model_identifier: 'openai/gpt-oss-20b', is_free: true }, { messages, maxTokens: 10, timeoutMs: 500 });
  assert.deepEqual(seen, [`Bearer ${KEY}`]);
  assert.throws(() => factory.call({ ...provider, adapter: 'openai_compatible' }, { model_identifier: 'paid-model', is_free: false }, { messages }), (error) => error.code === 'AI_PROVIDER_MISCONFIGURED');
});
