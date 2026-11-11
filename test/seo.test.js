import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metaDescription, fullTitle, pageLabel, listingDescription, absoluteUrl, isoDate, knownImageSize, twitterHandle, graph, organizationNode, websiteNode, breadcrumbNode, collectionNode, articleNode, tagNames, sitemapUrlset, sitemapIndex, rssFeed, robotsTxt, shellSeo, injectShellSeo, xml, SHELL_PAGES, STATIC_SITEMAP_PATHS, INDEXABLE_ROBOTS, HOME_TITLE } from '../src/seo.js';
import { layout } from '../src/web/templates.js';

const attr = (page, re) => (page.match(re) || [])[1];
const APP = 'https://gaming.example';
const base = { title: 'T', canonical: `${APP}/posts/x`, image: `${APP}/a.jpg`, body: '<p>hi</p>', social: [] };

test('meta descriptions are plain text, trimmed at a word boundary and never empty', () => {
  assert.equal(metaDescription('<p>Fix <b>lag</b>   now</p>'), 'Fix lag now');
  const long = metaDescription('word '.repeat(80)); assert.ok(long.length <= 155 && long.endsWith('…') && !/\s…$/.test(long));
  assert.ok(!long.includes('wor…') || long.endsWith('word…')); // cut on a boundary, not mid-word
  assert.match(metaDescription('', ''), /^$/); assert.match(metaDescription(null), /gaming guides/i); assert.equal(metaDescription(undefined, 'Fallback'), 'Fallback');
  assert.ok(metaDescription('x'.repeat(400)).length <= 155); // a single huge word is still cut
});
test('page titles get the brand only when it fits and is not already there', () => {
  assert.equal(fullTitle('Android Tips'), 'Android Tips | Eliahtech Gaming');
  assert.equal(fullTitle('About Eliahtech Gaming'), 'About Eliahtech Gaming');
  assert.equal(fullTitle('Best PPSSPP settings for smooth gameplay on Android phones'), 'Best PPSSPP settings for smooth gameplay on Android phones'); // would be truncated in results
  assert.equal(fullTitle(HOME_TITLE), HOME_TITLE); assert.equal(fullTitle(''), 'Eliahtech Gaming'); assert.equal(fullTitle('  Fix <lag>   & stutter '), 'Fix <lag> & stutter | Eliahtech Gaming'); // plain text is kept; the layout escapes it
  assert.equal(pageLabel('Guides', 1), 'Guides'); assert.equal(pageLabel('Guides', 3), 'Guides, page 3');
});
test('listing descriptions are unique per topic and per page', () => {
  assert.match(listingDescription({ name: 'PSP Games' }), /PSP Games/);
  assert.match(listingDescription({ name: 'PSP Games', description: 'Own text for the topic.' }), /^Own text for the topic\./);
  assert.match(listingDescription({ name: 'PSP', page: 2 }), /Page 2\.$/);
  assert.notEqual(listingDescription({ name: 'A' }), listingDescription({ name: 'B' })); assert.match(listingDescription(), /latest gaming guides/i);
  assert.ok(!listingDescription({ name: 'X', description: '<script>alert(1)</script>Safe text' }).includes('<'));
});
test('urls, dates, image sizes and the X/Twitter handle are derived safely', () => {
  assert.equal(absoluteUrl('/a.png', APP), `${APP}/a.png`); assert.equal(absoluteUrl('https://cdn.example/x.jpg', APP), 'https://cdn.example/x.jpg'); assert.equal(absoluteUrl('http://[bad', APP), undefined);
  assert.equal(isoDate('2026-10-01T08:00:00Z'), '2026-10-01T08:00:00.000Z'); assert.equal(isoDate('nope'), undefined); assert.equal(isoDate(null), undefined);
  assert.deepEqual(knownImageSize(`${APP}/assets/gaming-cover.jpg`), [1200, 630]); assert.deepEqual(knownImageSize('/covers/psp-ppsspp-games.webp'), [1200, 675]);
  assert.equal(knownImageSize('/covers/tile-default.webp'), undefined); assert.equal(knownImageSize('https://cdn.example/photo.jpg'), undefined);
  assert.equal(twitterHandle([{ url: 'https://x.com/eliahtech' }]), '@eliahtech'); assert.equal(twitterHandle([{ url: 'https://twitter.com/a_b1?lang=en' }]), '@a_b1');
  for (const bad of [[], [{ url: 'https://youtube.com/@x' }], [{ url: 'https://x.com/' }], [{ url: 'https://x.com/this_name_is_far_too_long' }], [{ url: 'javascript:alert(1)' }], [{ url: 'https://evilx.com/user' }]]) assert.equal(twitterHandle(bad), undefined);
});
test('structured data nodes are valid schema.org and link to each other', () => {
  const social = [{ url: 'https://youtube.com/@x' }, { url: 'http://insecure.example' }, { url: 'javascript:1' }];
  const org = organizationNode({ appUrl: APP, social }); assert.deepEqual(org.sameAs, ['https://youtube.com/@x']); assert.equal(org.logo.url, `${APP}/assets/branding/icon-512.png`);
  const site = websiteNode({ appUrl: APP }); assert.equal(site.potentialAction.target.urlTemplate, `${APP}/search?q={search_term_string}`); assert.equal(site.potentialAction['query-input'], 'required name=search_term_string'); assert.deepEqual(site.publisher, { '@id': org['@id'] });
  assert.deepEqual(breadcrumbNode([['Home', APP], ['Guides', `${APP}/posts`]]).itemListElement.map((i) => [i.position, i.name]), [[1, 'Home'], [2, 'Guides']]);
  const posts = Array.from({ length: 30 }, (_, i) => ({ slug: `g ${i}`, title: `G${i}` })); const col = collectionNode({ appUrl: APP, url: `${APP}/posts`, name: 'Guides', description: 'd', posts });
  assert.equal(col.mainEntity.itemListElement.length, 20); assert.equal(col.mainEntity.itemListElement[0].url, `${APP}/posts/g%200`);
  const post = { title: 'T'.repeat(200), excerpt: 'Short', published_at: '2026-10-01', updated_at: '2026-10-05', author: 'Eliah', category: { name: 'Android' } };
  const art = articleNode({ post, url: `${APP}/posts/x`, image: `${APP}/i.jpg`, appUrl: APP, tags: ['a', 'b'] });
  assert.ok(art.headline.length <= 110); assert.deepEqual([art.articleSection, art.keywords, art.inLanguage, art.image], ['Android', 'a, b', 'en', [`${APP}/i.jpg`]]); assert.equal(art.dateModified.slice(0, 10), '2026-10-05');
  assert.equal(articleNode({ post: { ...post, tags: undefined }, url: 'u', appUrl: APP }).keywords, undefined);
  const g = graph(org, null, site); assert.equal(g['@context'], 'https://schema.org'); assert.equal(g['@graph'].length, 2);
  assert.deepEqual(tagNames({ tags: [{ name: 'a' }, 'b', null, {}] }), ['a', 'b']); assert.deepEqual(tagNames({}), []);
});
test('sitemaps have lastmod and images only when known, escape every value and drop invalid control characters', () => {
  const out = sitemapUrlset([{ loc: `${APP}/posts/a&b`, lastmod: '2026-10-05T09:30:00.000Z', images: ['https://cdn.example/a.jpg?x=1&y=2'] }, { loc: `${APP}/posts/c\u0001d` }]);
  assert.match(out, /<loc>https:\/\/gaming\.example\/posts\/a&amp;b<\/loc><lastmod>2026-10-05T09:30:00\.000Z<\/lastmod><image:image><image:loc>https:\/\/cdn\.example\/a\.jpg\?x=1&amp;y=2<\/image:loc><\/image:image>/);
  assert.equal((out.match(/<lastmod>/g) || []).length, 1); assert.ok(!out.includes('\u0001')); assert.match(out, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.equal((sitemapUrlset([{ loc: 'u', images: Array.from({ length: 25 }, (_, i) => `https://i/${i}`) }]).match(/<image:image>/g) || []).length, 10); // Google's per-page limit
  assert.match(sitemapIndex([{ loc: `${APP}/sitemaps/posts-1.xml` }, { loc: `${APP}/sitemaps/posts-2.xml`, lastmod: '2026-10-01' }]), /posts-1\.xml<\/loc><\/sitemap><sitemap><loc>.*posts-2\.xml<\/loc><lastmod>2026-10-01<\/lastmod>/);
  for (const path of ['/premium', '/contact', '/services', '/ai', '/about', '/games', '/posts']) assert.ok(STATIC_SITEMAP_PATHS.includes(path), path);
  for (const path of Object.keys(SHELL_PAGES)) assert.ok(STATIC_SITEMAP_PATHS.includes(path), `${path} is indexable so it belongs in the sitemap`);
  assert.equal(xml('a<b>&"\'\u0000'), 'a&lt;b&gt;&amp;&quot;&apos;');
});
test('the RSS feed is valid, escaped and lists only real covers as images', () => {
  const posts = [{ slug: 'a b', title: 'Fix <lag> & stutter', excerpt: 'Short & sweet', author: 'Eliah', category: { name: 'Android & Tips' }, published_at: '2026-10-01T08:00:00Z', featured_image: 'https://cdn.example/c.jpg' }, { slug: 'b', title: 'No cover', excerpt: '', featured_image: '/assets/gaming-cover.jpg' }];
  const feed = rssFeed({ appUrl: APP, posts, description: 'Guides & more', now: new Date('2026-10-28T00:00:00Z') });
  assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?><rss version="2\.0"/); assert.match(feed, /<atom:link href="https:\/\/gaming\.example\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(feed, /<title>Fix &lt;lag&gt; &amp; stutter<\/title>/); assert.match(feed, /<link>https:\/\/gaming\.example\/posts\/a%20b<\/link>/); assert.match(feed, /<guid isPermaLink="true">https:\/\/gaming\.example\/posts\/a%20b<\/guid>/);
  assert.match(feed, /<pubDate>Thu, 01 Oct 2026 08:00:00 GMT<\/pubDate>/); assert.match(feed, /<category>Android &amp; Tips<\/category>/); assert.match(feed, /<media:content url="https:\/\/cdn\.example\/c\.jpg" medium="image"\/>/);
  assert.equal((feed.match(/<media:content/g) || []).length, 1); assert.equal((feed.match(/<item>/g) || []).length, 2); assert.match(feed, /<lastBuildDate>Wed, 28 Oct 2026 00:00:00 GMT<\/lastBuildDate>/);
  assert.equal((feed.match(/<(\w+)[ >]/g) || []).length > 10, true); assert.equal(rssFeed({ appUrl: APP }).includes('<item>'), false);
});
test('robots.txt blocks private areas and crawl traps, keeps public pages open and lists the sitemap', () => {
  const txt = robotsTxt(APP); const lines = txt.split('\n');
  assert.ok(lines.includes('User-agent: *') && lines.includes('Allow: /') && lines.includes(`Sitemap: ${APP}/sitemap.xml`));
  for (const path of ['/api/', '/admin', '/preview/', '/community', '/search', '/login', '/register', '/forgot-password', '/reset-password', '/auth/', '/payment/', '/newsletter/']) assert.ok(lines.includes(`Disallow: ${path}`), path);
  for (const path of ['/', '/posts', '/premium', '/contact', '/services', '/ai', '/games', '/category', '/feed.xml', '/sitemap.xml']) assert.equal(lines.includes(`Disallow: ${path}`), false, `${path} must stay crawlable`);
  assert.ok(txt.endsWith('\n'));
});
test('app-shell pages: public ones are indexable with full metadata, private ones stay noindex', () => {
  const shell = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(shell, /<meta name="robots" content="noindex,nofollow">/); // the raw shell is private by default
  for (const [path, cfg] of Object.entries(SHELL_PAGES)) {
    const out = injectShellSeo(shell, { pathname: path, appUrl: APP, image: `${APP}/assets/gaming-cover.jpg`, social: [{ url: 'https://x.com/eliahtech' }] });
    assert.ok(out.includes(`<meta name="robots" content="${INDEXABLE_ROBOTS}">`) && !out.includes('noindex'), path);
    assert.ok(attr(out, /<title>(.*?)<\/title>/).includes(cfg.title.slice(0, 12)), path); assert.equal(attr(out, /rel="canonical" href="(.*?)"/), `${APP}${path}`);
    assert.ok(attr(out, /name="description" content="(.*?)"/).length > 60); assert.equal(attr(out, /og:url" content="(.*?)"/), `${APP}${path}`); assert.equal(attr(out, /twitter:site" content="(.*?)"/), '@eliahtech');
    assert.match(out, /<noscript><main><h1>/); assert.match(out, /href="\/posts">Gaming guides/); assert.match(out, /"@type":"WebPage"/); assert.match(out, /"@type":"BreadcrumbList"/);
    assert.ok(!out.includes('Eliah Tech Admin<'), 'no admin title');
  }
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/payment/return', '/payment/cancel', '/newsletter/confirm', '/newsletter/unsubscribe', '/admin', '/admin/newsletter', '/admin/posts/new']) {
    const out = injectShellSeo(shell, { pathname: path, appUrl: APP }); assert.match(out, /<meta name="robots" content="noindex,nofollow">/, path);
    assert.equal(/rel="canonical"|og:title|ld\+json/.test(out), false, `${path} carries no public metadata`); assert.ok(!attr(out, /<title>(.*?)<\/title>/).includes('Admin') || path.startsWith('/admin'));
  }
  assert.equal(shellSeo('/premium/').index, true); assert.equal(shellSeo('/premium?x=1').path, '/premium'); assert.equal(shellSeo('/admin/anything').index, false); assert.equal(shellSeo('/something-else').index, false);
});
test('shell metadata is escaped and the script-safe JSON-LD cannot close its own tag', () => {
  const shell = '<html><head><title>x</title><meta name="robots" content="noindex,nofollow"></head><body><div id="app"></div></body></html>';
  const out = injectShellSeo(shell, { pathname: '/contact', appUrl: 'https://gaming.example', image: 'https://x.example/a.png?a=1&b="2"', social: [{ url: 'https://x.com/</script><script>alert(1)' }] });
  assert.ok(!out.includes('</script><script>')); assert.ok(out.includes('og:image" content="https://x.example/a.png?a=1&amp;b=&quot;2&quot;"'));
});
test('layout: complete social and search tags, article times, verification and a feed link', () => {
  const page = layout({ ...base, title: 'Best PPSSPP settings', description: 'D'.repeat(300), ogType: 'article', imageAlt: 'Alt "text"', imageSize: [1200, 630], twitterSite: '@eliahtech', verification: [['google-site-verification', 'tok_123'], ['msvalidate.01', '']], article: { published: '2026-10-01T00:00:00.000Z', modified: '2026-10-02T00:00:00.000Z', section: 'Android', author: 'Eliah', tags: ['ppsspp', 'lag'] } });
  assert.equal(attr(page, /<title>(.*?)<\/title>/), 'Best PPSSPP settings | Eliahtech Gaming'); assert.ok(attr(page, /name="description" content="(.*?)"/).length <= 160);
  assert.equal(attr(page, /name="robots" content="(.*?)"/), INDEXABLE_ROBOTS);
  for (const [k, v] of [['og:type', 'article'], ['og:site_name', 'Eliahtech Gaming'], ['og:locale', 'en_GB'], ['og:image:width', '1200'], ['og:image:height', '630'], ['og:image:alt', 'Alt &quot;text&quot;'], ['article:published_time', '2026-10-01T00:00:00.000Z'], ['article:modified_time', '2026-10-02T00:00:00.000Z'], ['article:section', 'Android'], ['article:author', 'Eliah']]) assert.equal(attr(page, new RegExp(`property="${k}" content="(.*?)"`)), v, k);
  assert.deepEqual([...page.matchAll(/property="article:tag" content="(.*?)"/g)].map((m) => m[1]), ['ppsspp', 'lag']);
  assert.equal(attr(page, /name="twitter:site" content="(.*?)"/), '@eliahtech'); assert.equal(attr(page, /twitter:image:alt" content="(.*?)"/), 'Alt &quot;text&quot;');
  assert.equal(attr(page, /google-site-verification" content="(.*?)"/), 'tok_123'); assert.equal(page.includes('msvalidate'), false);
  assert.equal(attr(page, /type="application\/rss\+xml" title="[^"]*" href="(.*?)"/), `${APP}/feed.xml`);
  const plain = layout(base); assert.equal(attr(plain, /og:type" content="(.*?)"/), 'website'); for (const k of ['og:image:width', 'og:image:alt', 'article:published_time', 'twitter:site', 'google-site-verification']) assert.equal(plain.includes(k), false, k);
  assert.equal(attr(layout({ ...base, noindex: true }), /name="robots" content="(.*?)"/), 'noindex,nofollow');
  assert.equal(attr(layout({ ...base, canonical: 'not a url' }), /rss\+xml" title="[^"]*" href="(.*?)"/), '/feed.xml');
});
