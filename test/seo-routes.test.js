import test from 'node:test';
import assert from 'node:assert/strict';
import { call, callNotFound, makeSite, sampleRepo, attr } from '../test-support/web-harness.js';

const APP = 'https://gaming.example';
const site = makeSite();
const ld = (page) => JSON.parse(attr(page, /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s));
const types = (page) => ld(page)['@graph'].map((n) => n['@type']);
const robots = (page) => attr(page, /name="robots" content="(.*?)"/);

test('homepage: keyword title, its own description, WebSite + Organization data, correct og:type', async () => {
  const res = await call(site.router, '/'); const page = res.body;
  assert.equal(res.statusCode, 200);
  assert.equal(attr(page, /<title>(.*?)<\/title>/), 'Gaming Guides, PPSSPP Settings &amp; Android Fixes');
  assert.ok(attr(page, /name="description" content="(.*?)"/).length > 40); assert.equal(attr(page, /rel="canonical" href="(.*?)"/), `${APP}/`);
  assert.deepEqual(types(page).sort(), ['Organization', 'WebSite']); assert.equal(attr(page, /og:type" content="(.*?)"/), 'website');
  const website = ld(page)['@graph'].find((n) => n['@type'] === 'WebSite'); assert.equal(website.potentialAction.target.urlTemplate, `${APP}/search?q={search_term_string}`);
  assert.deepEqual(ld(page)['@graph'].find((n) => n['@type'] === 'Organization').sameAs, ['https://x.com/eliahtech', 'https://youtube.com/@eliah']);
  assert.equal(attr(page, /twitter:site" content="(.*?)"/), '@eliahtech'); assert.equal(attr(page, /og:image:width" content="(.*?)"/), '1200');
  assert.match(page, /<h1>[^<]*<\/h1>/); assert.equal(robots(page).startsWith('index,follow'), true);
});
test('listings: unique title, description and canonical per page, with collection and breadcrumb data', async () => {
  const p1 = (await call(site.router, '/posts')).body; const p2 = (await call(site.router, '/posts?page=2')).body;
  assert.notEqual(attr(p1, /name="description" content="(.*?)"/), attr(p2, /name="description" content="(.*?)"/));
  assert.match(attr(p2, /<title>(.*?)<\/title>/), /, page 2/); assert.equal(attr(p2, /rel="canonical" href="(.*?)"/), `${APP}/posts?page=2`); assert.equal(attr(p1, /rel="canonical" href="(.*?)"/), `${APP}/posts`);
  assert.deepEqual(types(p1), ['CollectionPage', 'BreadcrumbList']); assert.equal(ld(p1)['@graph'][0].mainEntity.itemListElement.length, 2);
  const cat = (await call(site.router, '/category/android-tips')).body;
  assert.match(attr(cat, /name="description" content="(.*?)"/), /^Fix lag, install games and tune Android phones/); assert.ok(!attr(cat, /name="description" content="(.*?)"/).includes('&lt;b&gt;')); // markup in the admin text never leaks into the tag
  const other = (await call(site.router, '/category/psp-games')).body; assert.match(attr(other, /name="description" content="(.*?)"/), /PSP Games/);
  assert.notEqual(attr(cat, /name="description" content="(.*?)"/), attr(other, /name="description" content="(.*?)"/));
  assert.equal(ld(cat)['@graph'][1].itemListElement.at(-1).name, 'Android Tips');
});
test('a category that does not exist is a real 404 and is not indexed', async () => {
  const res = await call(site.router, '/category/nope'); assert.equal(res.statusCode, 404); assert.equal(robots(res.body), 'noindex,nofollow');
});
test('article: article social tags, BlogPosting with publisher and keywords, breadcrumb, image alt', async () => {
  const res = await call(site.router, '/posts/best-ppsspp-settings'); const page = res.body;
  assert.equal(res.statusCode, 200); assert.equal(attr(page, /og:type" content="(.*?)"/), 'article'); assert.equal(attr(page, /article:published_time" content="(.*?)"/), '2026-10-01T08:00:00.000Z'); assert.equal(attr(page, /article:modified_time" content="(.*?)"/), '2026-10-05T09:30:00.000Z');
  assert.equal(attr(page, /article:section" content="(.*?)"/), 'Android Tips'); assert.deepEqual([...page.matchAll(/article:tag" content="(.*?)"/g)].map((m) => m[1]), ['ppsspp', 'lag']);
  assert.equal(attr(page, /og:image" content="(.*?)"/), 'https://cdn.example/cover.jpg'); assert.equal(attr(page, /og:image:alt" content="(.*?)"/), 'PPSSPP running on a phone'); assert.equal(page.includes('og:image:width'), false); // unknown size: not guessed
  assert.deepEqual(types(page).sort(), ['BlogPosting', 'BreadcrumbList', 'Organization', 'WebSite']);
  const art = ld(page)['@graph'].find((n) => n['@type'] === 'BlogPosting'); assert.deepEqual([art.keywords, art.articleSection, art.author.name, art.publisher], ['ppsspp, lag', 'Android Tips', 'Eliah', { '@id': `${APP}/#organization` }]);
  assert.equal(attr(page, /rel="canonical" href="(.*?)"/), `${APP}/posts/best-ppsspp-settings`); assert.ok(page.includes('BODY_SENTINEL'));
});
test('static pages have their own titles', async () => {
  for (const [path, title] of [['/about', 'About Eliahtech Gaming'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service'], ['/disclaimer', 'Disclaimer'], ['/dmca', 'DMCA and Copyright Policy']]) {
    const res = await call(site.router, path); assert.equal(res.statusCode, 200, path); assert.match(attr(res.body, /<title>(.*?)<\/title>/), new RegExp(`^${title}`), path);
  }
});
test('game hubs and topics pages carry descriptions and breadcrumbs', async () => {
  for (const path of ['/games', '/categories']) { const page = (await call(site.router, path)).body; assert.ok(attr(page, /name="description" content="(.*?)"/).length > 60, path); assert.ok(types(page).includes('BreadcrumbList'), path); }
});
test('sitemap index and post sitemaps: real lastmod dates, cover images, key pages, safe escaping, edge-cacheable', async () => {
  const index = await call(site.router, '/sitemap.xml'); assert.equal(index.headers['content-type'].startsWith('application/xml'), true); assert.equal((index.body.match(/<sitemap>/g) || []).length, 3); // 2,500 posts = 3 files
  assert.match(index.headers['cache-control'], /s-maxage=3600/); assert.doesNotMatch(index.headers['cache-control'], /private|no-store/);
  const first = (await call(site.router, '/sitemaps/posts-1.xml')).body;
  assert.match(first, /<loc>https:\/\/gaming\.example\/posts\/best-ppsspp-settings<\/loc><lastmod>2026-10-05T09:30:00\.000Z<\/lastmod><image:image><image:loc>https:\/\/cdn\.example\/cover\.jpg<\/image:loc><\/image:image>/);
  assert.match(first, /<loc>https:\/\/gaming\.example\/posts\/second-guide<\/loc><lastmod>2026-09-01T00:00:00\.000Z<\/lastmod><\/url>/); // falls back to the publish date; the default cover is not listed as an image
  assert.match(first, /posts\/with%20space%20%26%20more<\/loc><\/url>/); // an invalid date is dropped, never invented
  for (const path of ['', '/premium', '/contact', '/services', '/ai', '/games/efootball', '/category/android-tips', '/about']) assert.ok(first.includes(`<loc>${APP}${path}</loc>`), path || '/');
  assert.match(first, /games\/efootball<\/loc><lastmod>2026-10-10T00:00:00\.000Z/);
  assert.equal(first.includes('/search'), false); assert.equal(first.includes('/login'), false); assert.equal(first.includes('/community'), false);
  const later = (await call(site.router, '/sitemaps/posts-2.xml')).body; assert.equal(later.includes('/premium'), false); assert.equal(later.includes('<loc>https://gaming.example</loc>'), false); // static pages only appear once
  assert.equal((await call(site.router, '/sitemaps/posts-0.xml')).statusCode, 404);
});
test('feed.xml is a cacheable RSS feed of the latest guides, advertised in every page head', async () => {
  const res = await call(site.router, '/feed.xml'); assert.equal(res.statusCode, 200); assert.match(res.headers['content-type'], /^application\/rss\+xml/); assert.match(res.headers['cache-control'], /s-maxage=900/);
  assert.match(res.body, /<rss version="2\.0"/); assert.equal((res.body.match(/<item>/g) || []).length, 2); assert.match(res.body, /<description>Guides for gamers &amp; more<\/description>/); assert.equal(res.body.includes('BODY_SENTINEL'), false); // excerpts only, never full premium content
  assert.equal(attr((await call(site.router, '/about')).body, /rss\+xml" title="[^"]*" href="(.*?)"/), `${APP}/feed.xml`);
});
test('robots.txt is served and edge-cacheable', async () => {
  const res = await call(site.router, '/robots.txt'); assert.match(res.headers['content-type'], /^text\/plain/); assert.match(res.body, /Sitemap: https:\/\/gaming\.example\/sitemap\.xml/); assert.match(res.body, /Disallow: \/search/); assert.match(res.headers['cache-control'], /s-maxage=3600/);
});
test('app pages: /premium /contact /services /ai are indexable with metadata; sign-in, payment and admin pages are noindex', async () => {
  for (const path of ['/premium', '/contact', '/services', '/ai']) {
    const res = await call(site.router, path); const page = res.body; assert.equal(res.statusCode, 200, path);
    assert.equal(robots(page).startsWith('index,follow'), true, path); assert.equal(page.includes('noindex'), false, path); assert.equal(res.headers['x-robots-tag'], undefined, path);
    assert.equal(attr(page, /rel="canonical" href="(.*?)"/), `${APP}${path}`, path); assert.ok(attr(page, /name="description" content="(.*?)"/).length > 60, path); assert.ok(attr(page, /og:title" content="(.*?)"/), path);
    assert.match(page, /<noscript><main><h1>/); assert.match(res.headers['cache-control'], /s-maxage=300/); assert.doesNotMatch(res.headers['cache-control'], /private/);
  }
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/payment/return', '/newsletter/confirm', '/admin', '/admin/newsletter']) {
    const res = await call(site.router, path); assert.equal(res.statusCode, 200, path); assert.equal(robots(res.body), 'noindex,nofollow', path);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', path); assert.equal(res.headers['cache-control'], 'private, no-store', path); assert.equal(res.body.includes('rel="canonical"'), false, path);
  }
  assert.equal(await call(site.router, '/profile', { method: 'get' }).then((r) => r.redirectedTo), '/community');
});
test('page caching: anonymous pages revalidate, signed-in pages are never stored, files are edge-cacheable', async () => {
  assert.equal((await call(site.router, '/')).headers['cache-control'], 'private, no-cache');
  for (const cookie of ['eliah_at=abc', '__Host-eliah_rt=abc', 'a=1; eliah_at=abc; b=2']) assert.equal((await call(site.router, '/posts/best-ppsspp-settings', { cookie })).headers['cache-control'], 'private, no-store', cookie);
  for (const cookie of ['theme=dark', 'my_eliah_at=1']) assert.equal((await call(site.router, '/', { cookie })).headers['cache-control'], 'private, no-cache', cookie); // unrelated cookies do not count as signed in
});
test('search-engine verification tags appear only when configured', async () => {
  const configured = makeSite({ siteVerification: { google: 'google_token_1234567890', bing: 'BING1234567890ABCDEF' } });
  const page = (await call(configured.router, '/')).body; assert.equal(attr(page, /google-site-verification" content="(.*?)"/), 'google_token_1234567890'); assert.equal(attr(page, /msvalidate\.01" content="(.*?)"/), 'BING1234567890ABCDEF');
  const bare = (await call(site.router, '/')).body; assert.equal(bare.includes('google-site-verification'), false); assert.equal(bare.includes('msvalidate'), false);
});
test('unknown browser URLs get a friendly noindex 404; API clients get JSON', async () => {
  const res = await callNotFound(site, '/definitely/missing'); assert.equal(res.statusCode, 404); assert.equal(res.headers['x-robots-tag'], 'noindex'); assert.equal(robots(res.body), 'noindex,nofollow'); assert.match(res.body, /We could not find that page/); assert.equal(res.headers['cache-control'], 'no-store');
  const api = await callNotFound(site, '/api/v1/nothing', { accept: 'application/json' }); assert.equal(api.statusCode, 404); assert.equal(JSON.parse(api.body).error.code, 'NOT_FOUND');
  assert.equal((await callNotFound(site, '/missing', { accept: 'application/json' })).headers['content-type'], 'application/json');
  const down = makeSite({ repo: sampleRepo({ getPublicSite: async () => { throw new Error('db down'); } }) }); assert.equal((await callNotFound(down, '/gone')).statusCode, 404); // renders even if the database is unavailable
});
