import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageUrl } from '../src/images.js';
import { parseHtmlPost, resolveRefs, HTML_POST_TEMPLATE } from '../src/admin/html-post.js';
import { socialBar, socialList, socialIcons, DEFAULT_SOCIAL } from '../public/social-bar.js';

test('image links are normalised: protocol, share pages and junk', () => {
  assert.equal(normalizeImageUrl('//cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
  assert.equal(normalizeImageUrl('http://cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
  assert.equal(normalizeImageUrl('cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
  assert.equal(normalizeImageUrl('/slides/ai-1.webp'), '/slides/ai-1.webp');
  assert.equal(normalizeImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'), 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOp');
  assert.equal(normalizeImageUrl('https://www.dropbox.com/s/abc/pic.png?dl=0'), 'https://dl.dropboxusercontent.com/s/abc/pic.png');
  assert.equal(normalizeImageUrl('https://imgur.com/aBcD123'), 'https://i.imgur.com/aBcD123.jpg');
  assert.equal(normalizeImageUrl('https://github.com/o/r/blob/main/pic.png'), 'https://raw.githubusercontent.com/o/r/main/pic.png');
  for (const bad of ['', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'x', '//', '/\\evil']) assert.equal(normalizeImageUrl(bad), '', bad);
  assert.equal(normalizeImageUrl('https://example.com/' + 'a'.repeat(900) + '.jpg').length > 800, true, 'long CDN links are kept (they used to be rejected above 500 characters)');
});

test('a full HTML page is turned into every post field', () => {
  const { fields, hints, warnings, images } = parseHtmlPost(HTML_POST_TEMPLATE);
  assert.equal(fields.title, 'Download Your Game Here (2026)');
  assert.equal(fields.seo_title, 'Download Your Game Here (2026) | ELIAH TECH');
  assert.equal(fields.slug, 'download-your-game-here-2026');
  assert.match(fields.excerpt, /post card/);
  assert.equal(fields.featured_image_url, 'https://example.com/cover.jpg');
  assert.equal(fields.featured_image_alt, 'Describe the cover image');
  assert.deepEqual(fields.tags, ['PPSSPP', 'Android Games', 'ELIAH TECH']);
  assert.equal(fields.platform, 'ppsspp'); assert.equal(fields.content_type, 'guide');
  assert.equal(fields.min_ram_gb, 3); assert.equal(fields.storage_mb, 1500); assert.deepEqual(fields.tested_devices, ['Tecno Spark 10', 'Samsung A12']);
  assert.equal(fields.is_premium, false); assert.equal(fields.author_name, 'ELIAH TECH');
  assert.equal(hints.category, 'PSP & PPSSPP Games');
  assert.match(fields.content_html, /^<div class="post-html"><style>/);
  assert.doesNotMatch(fields.content_html, /<h1/, 'the duplicate page title is dropped; the post page prints its own');
  assert.match(fields.content_html, /<h2>Features<\/h2>/);
  assert.equal(images.length, 1); assert.equal(images[0].fixed, 'https://example.com/screenshot.jpg');
  assert.ok(Array.isArray(warnings));
});

test('missing pieces are reported, unreadable image links are flagged, retired addresses are stripped', () => {
  const r = parseHtmlPost('<html><body><h1>Hi</h1><img src="notalink"><p>Visit: https://eliahtechgaming.blogspot.com</p><script>alert(1)</script></body></html>');
  assert.equal(r.fields.title, 'Hi');
  assert.ok(r.warnings.some((w) => /cover image/i.test(w)));
  assert.ok(r.warnings.some((w) => /could not be read/i.test(w)));
  assert.ok(r.warnings.some((w) => /blogspot/i.test(w)));
  assert.doesNotMatch(r.fields.content_html, /blogspot|<script|alert\(1\)/);
  assert.deepEqual(parseHtmlPost('').fields, {});
});

test('the first <img> becomes the cover when no og:image is given; pasted pictures are marked for upload', () => {
  const r = parseHtmlPost('<title>T</title><body><img src="//cdn.example/x.png" alt="A"><img src="data:image/png;base64,AAAA"></body>');
  assert.equal(r.fields.featured_image_url, 'https://cdn.example/x.png');
  assert.equal(r.images[1].fixed, 'embedded');
});

test('categories and game hubs are matched by slug or name', async () => {
  const db = { select: async (t) => (t === 'categories' ? [{ id: 'c1', slug: 'psp-ppsspp-games', name: 'PSP & PPSSPP Games' }] : [{ id: 'g1', slug: 'fc-26', name: 'FC 26' }]) };
  assert.deepEqual(await resolveRefs(db, { category: 'PSP & PPSSPP Games', game: 'fc-26' }), { category_id: 'c1', game_id: 'g1' });
  assert.deepEqual(await resolveRefs(db, { category: 'psp-ppsspp-games', game: '' }), { category_id: 'c1' });
  assert.deepEqual(await resolveRefs(db, { category: 'nope', game: 'nope' }), {});
});

test('social bar: coloured icons for every platform, retired blog link never shown, defaults when empty', () => {
  const html = socialBar([...DEFAULT_SOCIAL, { platform: 'Website', url: 'https://eliahtechgaming.blogspot.com', icon: 'fa-globe' }, { platform: 'Bad', url: 'javascript:alert(1)' }]);
  for (const name of ['Telegram', 'Facebook', 'Instagram', 'WhatsApp', 'YouTube']) assert.match(html, new RegExp(`aria-label="${name}"`));
  assert.match(html, /#26A5E4/); assert.match(html, /#1877F2/); assert.match(html, /#25D366/); assert.match(html, /#FF0000/); assert.match(html, /etg-ig/);
  assert.doesNotMatch(html, /blogspot|javascript:/);
  assert.equal(socialList([]).length, DEFAULT_SOCIAL.length);
  assert.match(socialIcons([{ platform: 'TikTok', url: 'https://tiktok.com/@x' }]), /social-tiktok/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('direct ad scripts are written straight into the page with the CSP nonce', async () => {
  const { siteScriptTags, siteScriptOrigins } = await import('../src/web/site-scripts.js');
  const tag = siteScriptTags('N0NCE');
  assert.match(tag, /src="https:\/\/quge5\.com\/88\/tag\.min\.js"/); assert.match(tag, /data-zone="306663"/); assert.match(tag, /data-cfasync="false"/); assert.match(tag, /nonce="N0NCE"/); assert.match(tag, / async /);
  assert.deepEqual(siteScriptOrigins(), ['https://quge5.com', 'https://abscloud.org', 'https://bauval.org']);
});
