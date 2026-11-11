import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFields, slugify, parseTagNames } from '../src/admin/fields.js';
import { RESOURCES } from '../src/admin/resources.js';
import { SETTINGS } from '../src/admin/settings.js';
import { detectImageType, createMediaService, MAX_IMAGE_BYTES } from '../src/admin/media.js';
import { setUserRole } from '../src/admin/users.js';
import { createAdminService } from '../src/admin/service.js';
import { DatabaseError } from '../src/supabase.js';

const sanitize = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '');
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const fieldsOf = (body, key = 'posts', opts = {}) => validateFields(RESOURCES[key].fields, body, { sanitize, ...opts });
const rejects = (fn, status, code) => assert.throws(fn, (e) => e.status === status && (!code || e.code === code));

test('only whitelisted fields are copied; privileged keys are ignored', () => {
  const v = fieldsOf({ title: 'Hello', role: 'admin', author_id: UUID, view_count: 99, id: UUID });
  assert.deepEqual(Object.keys(v), ['title']);
});

test('required fields, enums, urls and uuids are enforced with per-field errors', () => {
  assert.throws(() => fieldsOf({}), (e) => e.status === 422 && e.details.fields.title === 'Required.');
  const bad = (body) => assert.throws(() => fieldsOf({ title: 'Title', ...body }), (e) => e.status === 422);
  bad({ status: 'deleted' });
  // http image links are upgraded to https rather than rejected (see test/images.test.js)
  assert.equal(fieldsOf({ title: 'Title', featured_image_url: 'http://insecure.example/a.png' }).featured_image_url, 'https://insecure.example/a.png');
  bad({ featured_image_url: 'javascript:alert(1)' });
  bad({ category_id: "x' or '1'='1" });
  bad({ is_premium: 'yes' });
  bad({ slug: 'Not A Slug' });
  assert.equal(fieldsOf({ title: 'Title', category_id: UUID }).category_id, UUID);
});

test('empty strings become null only for nullable fields; partial updates skip missing fields', () => {
  assert.equal(fieldsOf({ title: 'Title', excerpt: '' }).excerpt, null);
  assert.throws(() => fieldsOf({ title: '' }), (e) => e.status === 422);
  assert.deepEqual(fieldsOf({ featured: true }, 'posts', { partial: true }), { featured: true });
});

test('html content is sanitized before it is stored, and a sanitizer is mandatory', () => {
  assert.equal(fieldsOf({ title: 'Title', content_html: '<p>ok</p><script>x()</script>' }).content_html, '<p>ok</p>');
  assert.throws(() => validateFields(RESOURCES.posts.fields, { title: 'Title', content_html: '<p>x</p>' }), /sanitize/);
});

test('long articles are accepted (10,000+ words) and not truncated', () => {
  const html = `<p>${'word '.repeat(12000)}</p>`;
  assert.equal(fieldsOf({ title: 'Title', content_html: html }).content_html, html);
});

test('numbers, datetimes, lists and relative urls', () => {
  assert.equal(fieldsOf({ title: 'Service', description: 'Desc', sort_order: '30' }, 'services').sort_order, 30);
  assert.throws(() => fieldsOf({ title: 'Service', description: 'Desc', sort_order: 'abc' }, 'services'), (e) => e.status === 422);
  assert.equal(fieldsOf({ title: 'Service', description: 'Desc', action_url: '/contact' }, 'services').action_url, '/contact');
  assert.throws(() => fieldsOf({ title: 'Service', description: 'Desc', action_url: '//evil.example' }, 'services'));
  assert.deepEqual(fieldsOf({ title: 'Service', description: 'Desc', features: [' a ', '', 'b'] }, 'services').features, ['a', 'b']);
  assert.equal(fieldsOf({ title: 'Title', published_at: '2026-10-10T10:00:00+03:00' }).published_at, '2026-10-10T07:00:00.000Z');
});

test('slugify and tag parsing', () => {
  assert.equal(slugify('  Café: PSP Games & More!! '), 'cafe-psp-games-more');
  assert.equal(slugify('***'), '');
  assert.deepEqual(parseTagNames(['PSP', 'psp', ' Android ', '<b>Mods</b>']), ['PSP', 'psp', 'Android', 'Mods']);
  rejects(() => parseTagNames(['x']), 422);
  rejects(() => parseTagNames('nope'), 422);
  assert.equal(parseTagNames(undefined), undefined);
});

const goodHome = { hero_title: 'Hi', hero_description: 'Desc', cta_label: 'Go', cta_url: '#latest', secondary_cta_label: 'More', secondary_cta_url: '/services', latest_post_count: 6, featured_post_slug: 'a-post', sections: [{ key: 'latest', enabled: true, title: 'Title' }, { key: 'youtube', enabled: false, video_id: 'dQw4w9WgXcQ' }, { key: 'ai', enabled: true, title: 'Ask EliahTech AI' }, { key: 'premium', enabled: true, title: 'Explore Premium' }] };
test('homepage settings: valid document passes, bad ones are rejected', () => {
  const out = SETTINGS.homepage(goodHome);
  assert.equal(out.sections[1].video_id, 'dQw4w9WgXcQ');
  assert.equal(out.featured_post_slug, 'a-post');
  assert.throws(() => SETTINGS.homepage({ ...goodHome, sections: [{ key: 'latest' }, { key: 'latest' }] }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.homepage({ ...goodHome, sections: [{ key: 'ads' }] }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.homepage({ ...goodHome, sections: [{ key: 'youtube', video_id: 'short' }] }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.homepage({ ...goodHome, latest_post_count: 500 }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.homepage({ ...goodHome, cta_url: 'javascript:alert(1)' }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.homepage({ ...goodHome, featured_post_slug: 'Bad Slug' }), (e) => e.status === 422);
  assert.equal(SETTINGS.homepage({ ...goodHome, featured_post_slug: '' }).featured_post_slug, null);
});

test('site profile settings validate required brand, About and SEO information and reject unsafe URLs', () => {
  const site = { brand_name: 'EliahTech', gaming_identity: 'EliahTech Gaming', website_url: 'https://example.com', tagline: 'Gaming & Technology Platform', description: 'Gaming, technology and AI tutorials.', about_title: 'About EliahTech', about_lead: 'Practical information for curious people.', about_text: 'Games and technology.', seo_title: 'EliahTech - PSP, Football, Android, Tech & AI', seo_description: 'Games, mods, tech tutorials and AI tools.', canonical_url: 'https://example.com', contact_faqs: [{ question: 'How long?', answer: 'Two business days.' }] };
  assert.equal(SETTINGS.site(site).brand_name, 'EliahTech');
  assert.deepEqual(SETTINGS.site(site).contact_faqs, site.contact_faqs);
  const escapedFaq = SETTINGS.site({ ...site, contact_faqs: [{ question: '<script>', answer: '<b>safe</b>' }] }).contact_faqs[0];
  assert.equal(escapedFaq.question.includes('<'), false);
  assert.equal(escapedFaq.answer.includes('<'), false);
  assert.throws(() => SETTINGS.site({ ...site, contact_faqs: Array.from({ length: 13 }, () => ({ question: 'Q', answer: 'A' })) }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.site({ ...site, website_url: 'javascript:alert(1)' }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.site({ ...site, seo_description: '' }), (e) => e.status === 422);
});

test('premium settings validation', () => {
  assert.equal(SETTINGS.premium({ status: 'coming_soon', price_label: 'KSh 499', period: 'month', trial_days: 3 }).trial_days, 3);
  assert.throws(() => SETTINGS.premium({ status: 'free', price_label: 'x', period: 'y', trial_days: 3 }), (e) => e.status === 422);
  assert.throws(() => SETTINGS.premium({ status: 'available', price_label: 'x', period: 'y', trial_days: 99 }), (e) => e.status === 422);
});

// ---- media ----
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);

test('image type detection reads real bytes', () => {
  assert.equal(detectImageType(PNG).mime, 'image/png');
  assert.equal(detectImageType(JPG).ext, 'jpg');
  assert.equal(detectImageType(WEBP).mime, 'image/webp');
  assert.equal(detectImageType(GIF).mime, 'image/gif');
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html></html>', 'MZ\u0090\u0000', '#!/bin/sh\nrm -rf /']) assert.equal(detectImageType(Buffer.from(bad)), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

function mediaHarness({ storageStatus = 200 } = {}) {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  const calls = []; const inserted = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: storageStatus < 400, status: storageStatus }; };
  const db = {
    insert: async (table, row) => { inserted.push({ table, row }); return [{ id: UUID, ...row }]; },
    select: async () => [{ id: UUID, path: 'uploads/2026/10/x.png' }],
    remove: async (table, q) => { inserted.push({ table, removed: q }); return []; },
  };
  return { svc: createMediaService({ db, fetchImpl, now: () => new Date('2026-10-05T00:00:00Z') }), calls, inserted };
}

test('upload stores under a generated name, uses detected type and records the row', async () => {
  const { svc, calls, inserted } = mediaHarness();
  const row = await svc.upload({ buffer: PNG, declaredType: 'image/png', altText: ' <b>Cover</b> ', actorId: UUID });
  assert.match(calls[0].url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/media\/uploads\/2026\/10\/[0-9a-f-]{36}\.png$/);
  assert.equal(calls[0].init.headers['Content-Type'], 'image/png');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer service-key-test');
  assert.equal(inserted[0].row.alt_text, 'Cover');
  assert.equal(row.public_url.startsWith('https://proj.supabase.co/storage/v1/object/public/media/uploads/'), true);
});

test('upload rejects spoofed, oversized, empty and non-image files before touching storage', async () => {
  const { svc, calls } = mediaHarness();
  const svg = Buffer.from('<svg onload="alert(1)"></svg>');
  await assert.rejects(() => svc.upload({ buffer: svg, declaredType: 'image/png' }), (e) => e.status === 415);
  // The real bytes decide the type; a wrong or missing browser-declared type (common on phones) no longer blocks the upload.
  assert.equal((await svc.upload({ buffer: PNG, declaredType: 'image/jpeg' })).mime_type, 'image/png');
  await assert.rejects(() => svc.upload({ buffer: Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]), declaredType: 'image/png' }), (e) => e.status === 413);
  await assert.rejects(() => svc.upload({ buffer: Buffer.alloc(0), declaredType: 'image/png' }), (e) => e.status === 422);
  await assert.rejects(() => svc.upload({ buffer: undefined, declaredType: 'image/png' }), (e) => e.status === 422);
  assert.equal(calls.length, 1, 'only the valid PNG reached storage');
});

test('storage failure is a 502 and nothing is recorded; delete tolerates already-missing objects', async () => {
  const log = console.error; console.error = () => {};
  try {
    const failing = mediaHarness({ storageStatus: 500 });
    await assert.rejects(() => failing.svc.upload({ buffer: JPG, declaredType: 'image/jpeg' }), (e) => e.status === 502 && e.code === 'STORAGE_ERROR');
    assert.equal(failing.inserted.length, 0);
  } finally { console.error = log; }
  const gone = mediaHarness({ storageStatus: 404 });
  await gone.svc.remove(UUID);
  assert.ok(gone.inserted.some((c) => c.removed));
  await assert.rejects(() => gone.svc.remove('not-a-uuid'), (e) => e.status === 404);
});

// ---- users ----
test('role changes: validated, never on yourself, and report before/after', async () => {
  const db = { select: async () => [{ id: UUID2, role: 'free_user' }], update: async (_t, _q, v) => [{ id: UUID2, ...v }] };
  assert.deepEqual(await setUserRole(db, { actorId: UUID, targetId: UUID2, role: 'premium_user' }), { before: 'free_user', after: 'premium_user' });
  await assert.rejects(() => setUserRole(db, { actorId: UUID, targetId: UUID, role: 'free_user' }), (e) => e.status === 409);
  await assert.rejects(() => setUserRole(db, { actorId: UUID, targetId: UUID2, role: 'superuser' }), (e) => e.status === 422);
  await assert.rejects(() => setUserRole(db, { actorId: UUID, targetId: 'x),role.eq.admin', role: 'admin' }), (e) => e.status === 404);
  await assert.rejects(() => setUserRole({ select: async () => [] }, { actorId: UUID, targetId: UUID2, role: 'admin' }), (e) => e.status === 404);
});

// ---- generic CRUD service ----
function crudHarness({ existingSlugs = [], existingRow, failWith } = {}) {
  const log = [];
  const db = {
    select: async (table, q) => {
      log.push({ op: 'select', table, q });
      if (q.slug?.startsWith('like.')) return existingSlugs.map((slug, i) => ({ id: `s${i}`, slug }));
      if (table === 'tags') return [{ id: UUID }, { id: UUID2 }];
      return existingRow ? [existingRow] : [];
    },
    selectPage: async (table, q) => { log.push({ op: 'selectPage', table, q }); return { rows: [], total: 0 }; },
    insert: async (table, row, opts) => { log.push({ op: 'insert', table, row, opts }); if (failWith) throw failWith; return [{ id: UUID, ...(Array.isArray(row) ? {} : row) }]; },
    update: async (table, q, v) => { log.push({ op: 'update', table, q, v }); if (failWith) throw failWith; return [{ id: UUID }]; },
    remove: async (table, q) => { log.push({ op: 'remove', table, q }); return []; },
    rpc: async (name, args) => { log.push({ op: 'rpc', name, args }); return null; },
  };
  return { svc: createAdminService({ db, sanitize }), log };
}
const admin = { id: UUID2, profile: { display_name: 'Boss' } };
const stored = { id: UUID, title: 'Old', status: 'draft', published_at: null };

test('create post: unique slug, reading time, author, published date, tags and audit entry', async () => {
  const { svc, log } = crudHarness({ existingSlugs: ['my-post', 'my-post-2'], existingRow: stored });
  const content = `<p>${'word '.repeat(450)}</p>`;
  await svc.create(RESOURCES.posts, { title: 'My Post', status: 'published', content_html: content, tags: ['PSP', 'Android'], role: 'admin' }, admin, '1.2.3.4');
  const post = log.find((c) => c.op === 'insert' && c.table === 'posts').row;
  assert.equal(post.slug, 'my-post-3');
  assert.equal(post.reading_time, 3);
  assert.equal(post.author_id, UUID2);
  assert.equal(post.author_name, 'Boss');
  assert.ok(Date.parse(post.published_at) > Date.now() - 5000);
  assert.equal('role' in post, false);
  const tagInsert = log.find((c) => c.op === 'insert' && c.table === 'tags');
  assert.deepEqual(tagInsert.row.map((t) => t.slug), ['psp', 'android']);
  assert.deepEqual(log.find((c) => c.op === 'rpc').args.p_tag_ids, [UUID, UUID2]);
  const auditRow = log.find((c) => c.op === 'insert' && c.table === 'audit_logs').row;
  assert.equal(auditRow.action, 'post.create');
  assert.equal(JSON.stringify(auditRow).includes('word word'), false); // content never copied into the audit log
});

test('update keeps an existing publish date, only sends supplied fields, and refreshes updated_at', async () => {
  const { svc, log } = crudHarness({ existingRow: { ...stored, status: 'published', published_at: '2026-01-01T00:00:00Z' } });
  await svc.update(RESOURCES.posts, UUID, { title: 'New title' }, admin);
  const upd = log.find((c) => c.op === 'update').v;
  assert.deepEqual(Object.keys(upd).sort(), ['change_summary', 'title', 'updated_at']);
  assert.equal(log.find((c) => c.op === 'update').q.id, `eq.${UUID}`);
  assert.equal(log.some((c) => c.op === 'rpc'), false);
});

test('publishing an existing draft stamps a publish date; clearing tags replaces them with none', async () => {
  const { svc, log } = crudHarness({ existingRow: stored });
  await svc.update(RESOURCES.posts, UUID, { status: 'published', tags: [] }, admin);
  assert.ok(log.find((c) => c.op === 'update').v.published_at);
  assert.deepEqual(log.find((c) => c.op === 'rpc').args.p_tag_ids, []);
});

test('bad ids are 404 without a query; unique and FK violations map to 409/422', async () => {
  const a = crudHarness();
  await assert.rejects(() => a.svc.get(RESOURCES.posts, "1' or '1'='1"), (e) => e.status === 404);
  assert.equal(a.log.length, 0);
  const dup = crudHarness({ failWith: new DatabaseError('x', { status: 409, code: '23505' }) });
  await assert.rejects(() => dup.svc.create(RESOURCES.categories, { name: 'Dup' }, admin), (e) => e.status === 409 && e.code === 'CONFLICT');
  const fk = crudHarness({ failWith: new DatabaseError('x', { status: 409, code: '23503' }), existingRow: stored });
  await assert.rejects(() => fk.svc.update(RESOURCES.posts, UUID, { category_id: UUID2 }, admin), (e) => e.status === 422 && e.code === 'INVALID_REFERENCE');
});

test('list builds a safe search, a status filter only for known values, and caps nothing it was not given', async () => {
  const { svc, log } = crudHarness();
  await svc.list(RESOURCES.posts, { q: 'a),status.eq.draft,(b', limit: 25, offset: 0, filters: { status: 'published' } });
  const q = log.find((c) => c.op === 'selectPage').q;
  assert.equal(q.status, 'eq.published');
  assert.match(q.or, /^\(title\.ilike\.\*[\p{L}\p{N}\s-]+\*,slug\.ilike\.\*[\p{L}\p{N}\s-]+\*\)$/u);
  assert.equal(q.or.includes('draft,('), false);
  await svc.list(RESOURCES.posts, { q: '', limit: 25, offset: 0, filters: { status: 'x,y' } });
  assert.equal(log.filter((c) => c.op === 'selectPage')[1].q.status, undefined);
});

test('delete audits what was removed and guide edits touch updated_at', async () => {
  const { svc, log } = crudHarness({ existingRow: { id: UUID, title: 'Guide A' } });
  await svc.remove(RESOURCES.guides, UUID, admin);
  assert.equal(log.find((c) => c.op === 'insert' && c.table === 'audit_logs').row.action, 'installation_guide.delete');
  await svc.update(RESOURCES.guides, UUID, { content_html: '<p>New steps</p>' }, admin);
  assert.ok(log.find((c) => c.op === 'update' && c.table === 'installation_guides').v.updated_at);
});
