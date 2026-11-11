import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, ConfigError, DatabaseError } from '../src/supabase.js';
import * as repo from '../src/repo.js';

const KEY = 'service-role-secret-for-tests';
function mockDb(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const call = { table: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const result = handler(call);
    return { ok: result.ok !== false, status: result.status || 200, text: async () => JSON.stringify(result.body ?? []) };
  };
  return { db: createDb({ url: 'https://example.supabase.co', key: KEY, fetchImpl }), calls };
}

const postRow = { id: 'p1', slug: 'a-post', title: 'A post', excerpt: 'x', published_at: '2026-09-01T00:00:00Z', featured: true, is_premium: false, featured_image_url: null, author_name: 'Eliah Tech Editorial', reading_time: 3, categories: { slug: 'android-tips', name: 'Android Tips' }, post_tags: [{ tags: { name: 'android' } }] };

test('missing Supabase configuration gives a clear error and makes no request', async () => {
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let called = false;
  const db = createDb({ fetchImpl: async () => { called = true; } });
  await assert.rejects(() => repo.listCategories(db), (e) => e instanceof ConfigError && e.status === 503 && /SUPABASE_URL/.test(e.message));
  assert.equal(called, false);
  Object.assign(process.env, { SUPABASE_URL: saved.u, SUPABASE_SERVICE_ROLE_KEY: saved.k });
  if (saved.u === undefined) delete process.env.SUPABASE_URL;
  if (saved.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test('public site profile reads only the public settings row through the repository API', async () => {
  const profile = { brand_name: 'EliahTech', gaming_identity: 'EliahTech Gaming' };
  const { db, calls } = mockDb((c) => ({ body: c.table === 'settings' && c.params.key === 'eq.site' && c.params.is_public === 'eq.true' ? [{ value: profile }] : [] }));
  assert.deepEqual(await repo.getPublicSite(db), profile);
  assert.equal(calls[0].table, 'settings');
  assert.equal(calls[0].params.key, 'eq.site');
  assert.equal(calls[0].params.is_public, 'eq.true');
});

test('post listing only requests published posts, flags premium ones and omits full content', async () => {
  const { db, calls } = mockDb(() => ({ body: [postRow] }));
  const items = await repo.listPosts(db, { limit: 5 });
  const p = calls[0].params;
  assert.equal(calls[0].table, 'posts');
  assert.equal(p.status, 'eq.published');
  assert.equal(p.is_premium, undefined);
  assert.match(p.select, /is_premium/);
  assert.match(p.published_at, /^lte\./);
  assert.equal(p.limit, '5');
  assert.ok(!p.select.includes('content_html'));
  assert.deepEqual([items[0].category.slug, items[0].tags, items[0].author, items[0].featured_image], ['android-tips', ['android'], 'Eliah Tech Editorial', '/assets/gaming-cover.jpg']);
  assert.equal(calls[0].headers.apikey, KEY);
});

test('category filter uses an inner join on the category slug', async () => {
  const { db, calls } = mockDb(() => ({ body: [] }));
  await repo.listPosts(db, { category: 'psp-games' });
  assert.match(calls[0].params.select, /categories!inner\(/);
  assert.equal(calls[0].params['categories.slug'], 'eq.psp-games');
});

test('single post returns content (with is_premium so the route can gate it), and null when not public', async () => {
  const { db } = mockDb((c) => ({ body: c.params.slug === 'eq.a-post' ? [{ ...postRow, content_html: '<p>Hi</p>' }] : [] }));
  const post = await repo.getPost(db, 'a-post');
  assert.equal(post.content, '<p>Hi</p>');
  assert.equal(post.is_premium, false);
  assert.equal(await repo.getPost(db, 'missing'), null);
});

test('search strips filter-injection characters and skips short terms', async () => {
  const { db, calls } = mockDb(() => ({ body: [] }));
  assert.deepEqual(await repo.searchPosts(db, 'a'), []);
  assert.equal(calls.length, 0);
  await repo.searchPosts(db, 'x),status.eq.draft,(y');
  const or = calls.at(-1).params.or;
  assert.equal(calls.at(-1).table, 'posts');
  // Separators and parentheses were removed from the term, so it cannot add extra filter conditions.
  const term = 'x status eq draft y';
  assert.equal(or, `(search_vector.wfts(english).${term},title.ilike.*${term}*,excerpt.ilike.*${term}*)`);
  assert.equal(calls.at(-1).params.status, 'eq.published');
});

test('search also matches tags and categories', async () => {
  const { db, calls } = mockDb((c) => ({ body: c.table === 'tags' ? [{ id: 't1' }] : c.table === 'post_tags' ? [{ post_id: 'p9' }] : c.table === 'categories' ? [{ id: 'c1' }] : [] }));
  await repo.searchPosts(db, 'android');
  const or = calls.at(-1).params.or;
  assert.match(or, /id\.in\.\(p9\)/);
  assert.match(or, /category_id\.in\.\(c1\)/);
});

test('contact messages are validated and truncated before saving', async () => {
  const { db, calls } = mockDb(() => ({ body: [{ id: 'm1' }] }));
  assert.equal(await repo.createMessage(db, { name: 'A', email: 'bad', subject: 's', message: 'm' }), null);
  const row = await repo.createMessage(db, { name: 'Ann', email: 'ANN@example.com', subject: 'Hi', message: 'x'.repeat(9000) });
  assert.equal(row.id, 'm1');
  assert.equal(calls[0].table, 'messages');
  assert.equal(calls[0].body.message.length, 5000);
  assert.equal(calls[0].body.email, 'ann@example.com');
});

test('database failures become DatabaseError without leaking the key', async () => {
  const { db } = mockDb(() => ({ ok: false, status: 500, body: { message: 'boom' } }));
  await assert.rejects(() => repo.listServices(db), (e) => e instanceof DatabaseError && !JSON.stringify(e).includes(KEY) && !e.message.includes(KEY));
});

test('project has no in-memory production data and no secrets in the browser bundle', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /newsletterSubscribers|contactMessages|const (posts|services|homepage|categories) = [\[{]/);
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const file of walk(fileURLToPath(new URL('../public', import.meta.url)))) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /SERVICE_ROLE|service_role|SUPABASE_URL|_API_KEY|_SECRET/, file);
  }
});

test('access context loads only the given user and rejects non-UUID ids', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const { db, calls } = mockDb((c) => ({ body: c.table === 'profiles' ? [{ id, role: 'free_user' }] : [] }));
  const ctx = await repo.getAccessContext(db, id);
  assert.equal(ctx.profile.role, 'free_user');
  assert.equal(calls.find((c) => c.table === 'profiles').params.id, `eq.${id}`);
  assert.equal(calls.find((c) => c.table === 'subscriptions').params.status, 'eq.active');
  const before = calls.length;
  assert.deepEqual(await repo.getAccessContext(db, 'x),role.eq.admin'), { profile: null, subscriptions: [] });
  assert.equal(calls.length, before);
});

test('own-profile update sends only the display name and filters by id', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const { db, calls } = mockDb(() => ({ body: [{ id }] }));
  await repo.updateOwnProfile(db, id, { displayName: 'Eli' });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].params.id, `eq.${id}`);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['display_name', 'updated_at']);
});
