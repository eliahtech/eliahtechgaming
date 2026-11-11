// Pure SEO helpers (no I/O, no framework imports) so they can be unit-tested and reused by the page layout and the routes.
export const SITE_NAME = 'Eliahtech Gaming';
export const DEFAULT_DESCRIPTION = 'Practical gaming guides, PPSSPP settings and Android troubleshooting.';
export const HOME_TITLE = 'Gaming Guides, PPSSPP Settings & Android Fixes';
export const INDEXABLE_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
export const NOINDEX_ROBOTS = 'noindex,nofollow';
export const OG_LOCALE = 'en_GB';

// ---------- text ----------
const htmlEscape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const xml = (v) => String(v ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// Titles are plain text (only whitespace is tidied; callers escape them). Descriptions and excerpts may contain markup, so those lose their tags.
export const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const plain = (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Search engines show about 155 characters; cut at a word boundary instead of mid-word.
export function metaDescription(text, fallback = DEFAULT_DESCRIPTION, max = 155) {
  const t = plain(text) || plain(fallback);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1); const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}
// "Page title | Brand", but never pad a title that already names the brand or would be cut off in results (about 60 characters).
export function fullTitle(title, brand = SITE_NAME) {
  const t = text(title); if (!t) return brand;
  return new RegExp(brand.split(' ')[0], 'i').test(t) || t.length + brand.length + 3 > 62 ? t : `${t} | ${brand}`;
}
export const pageLabel = (name, page) => (page > 1 ? `${name}, page ${page}` : name);
export const listingDescription = ({ name, description, page = 1 } = {}) => {
  const base = description ? metaDescription(description, '', 130) : name ? `Guides, settings and fixes for ${plain(name)}. Step-by-step help from ${SITE_NAME}.` : 'Browse the latest gaming guides: PPSSPP settings, Android lag fixes, football game updates and troubleshooting.';
  return metaDescription(page > 1 ? `${base} Page ${page}.` : base);
};

// ---------- urls and images ----------
export const absoluteUrl = (value, base) => { try { return new URL(value || '/', base).href; } catch { return undefined; } };
export const isoDate = (v) => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };
export function knownImageSize(url) {
  const path = String(url || '').split('?')[0];
  if (/\/assets\/gaming-cover\.jpg$/.test(path)) return [1200, 630];
  if (/\/covers\/[a-z-]+\.webp$/.test(path) && !/\/tile-/.test(path)) return [1200, 675];
  return undefined;
}
export function twitterHandle(social = []) {
  for (const link of social) {
    try { const u = new URL(link.url); if (/^(www\.)?(twitter|x)\.com$/i.test(u.hostname)) { const name = u.pathname.split('/').filter(Boolean)[0]; if (/^[A-Za-z0-9_]{1,15}$/.test(name || '')) return `@${name}`; } } catch { /* ignore malformed links */ }
  }
  return undefined;
}

// ---------- structured data (JSON-LD nodes; wrap them with graph()) ----------
export const graph = (...nodes) => ({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });
export const organizationNode = ({ appUrl, name = SITE_NAME, social = [] }) => ({ '@type': 'Organization', '@id': `${appUrl}/#organization`, name, url: appUrl, logo: { '@type': 'ImageObject', url: `${appUrl}/assets/branding/icon-512.png`, width: 512, height: 512 }, sameAs: social.map((s) => s.url).filter((u) => /^https:\/\//.test(u || '')) });
export const websiteNode = ({ appUrl, name = SITE_NAME }) => ({ '@type': 'WebSite', '@id': `${appUrl}/#website`, url: appUrl, name, inLanguage: 'en', publisher: { '@id': `${appUrl}/#organization` }, potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${appUrl}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } });
export const breadcrumbNode = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });
export const collectionNode = ({ appUrl, url, name, description, posts = [] }) => ({ '@type': 'CollectionPage', '@id': `${url}#collection`, url, name, description, inLanguage: 'en', isPartOf: { '@id': `${appUrl}/#website` }, mainEntity: { '@type': 'ItemList', itemListElement: posts.slice(0, 20).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${appUrl}/posts/${encodeURIComponent(p.slug)}`, name: p.title })) } });
export const webPageNode = ({ appUrl, url, name, description }) => ({ '@type': 'WebPage', '@id': `${url}#webpage`, url, name, description, inLanguage: 'en', isPartOf: { '@id': `${appUrl}/#website` } });
export function articleNode({ post, url, image, appUrl, tags = [] }) {
  return { '@type': 'BlogPosting', '@id': `${url}#article`, headline: text(post.title).slice(0, 110), description: metaDescription(post.seo_description || post.excerpt), image: image ? [image] : undefined, datePublished: isoDate(post.published_at) || post.published_at, dateModified: isoDate(post.updated_at || post.published_at) || post.updated_at || post.published_at, inLanguage: 'en', author: { '@type': 'Person', name: post.author || SITE_NAME }, publisher: { '@id': `${appUrl}/#organization` }, isPartOf: { '@id': `${appUrl}/#website` }, mainEntityOfPage: url, articleSection: post.category?.name, keywords: tags.length ? tags.join(', ') : undefined };
}
export const tagNames = (post) => (Array.isArray(post?.tags) ? post.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean) : []);

// ---------- sitemap, RSS, robots ----------
export const sitemapUrlset = (entries) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.map((e) => `<url><loc>${xml(e.loc)}</loc>${e.lastmod ? `<lastmod>${xml(e.lastmod)}</lastmod>` : ''}${(e.images || []).slice(0, 10).map((i) => `<image:image><image:loc>${xml(i)}</image:loc></image:image>`).join('')}</url>`).join('')}</urlset>`;
export const sitemapIndex = (entries) => `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((e) => `<sitemap><loc>${xml(e.loc)}</loc>${e.lastmod ? `<lastmod>${xml(e.lastmod)}</lastmod>` : ''}</sitemap>`).join('')}</sitemapindex>`;
export const STATIC_SITEMAP_PATHS = ['', '/posts', '/categories', '/games', '/about', '/contact', '/premium', '/services', '/ai', '/privacy', '/terms', '/disclaimer', '/dmca'];

export function rssFeed({ appUrl, title = `${SITE_NAME} guides`, description = DEFAULT_DESCRIPTION, posts = [], now = new Date() }) {
  const items = posts.map((p) => {
    const link = `${appUrl}/posts/${encodeURIComponent(p.slug)}`; const published = isoDate(p.published_at); const image = p.featured_image && !/gaming-cover\.jpg$/.test(p.featured_image) ? absoluteUrl(p.featured_image, appUrl) : undefined;
    return `<item><title>${xml(text(p.title))}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid>${published ? `<pubDate>${new Date(published).toUTCString()}</pubDate>` : ''}${p.author ? `<dc:creator>${xml(p.author)}</dc:creator>` : ''}${p.category?.name ? `<category>${xml(p.category.name)}</category>` : ''}<description>${xml(metaDescription(p.excerpt, '', 300))}</description>${image ? `<media:content url="${xml(image)}" medium="image"/>` : ''}</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${xml(title)}</title><link>${xml(appUrl)}/</link><description>${xml(plain(description))}</description><language>en</language><lastBuildDate>${now.toUTCString()}</lastBuildDate><atom:link href="${xml(appUrl)}/feed.xml" rel="self" type="application/rss+xml"/>${items.join('')}</channel></rss>`;
}
// Search, account and payment pages are kept out of search results. Pages that must show a noindex tag are NOT blocked here
// (a blocked page can never be crawled to see its noindex), only crawl traps and private areas are.
export const robotsTxt = (appUrl) => ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /admin', 'Disallow: /preview/', 'Disallow: /community', 'Disallow: /search', 'Disallow: /login', 'Disallow: /register', 'Disallow: /forgot-password', 'Disallow: /reset-password', 'Disallow: /auth/', 'Disallow: /payment/', 'Disallow: /newsletter/', '', `Sitemap: ${appUrl}/sitemap.xml`, ''].join('\n');
// Edge caching is safe for these because they are identical for every visitor (no cookies involved).
export const PUBLIC_FILE_CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
export const FEED_CACHE = 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600';

// ---------- app-shell pages (/premium, /contact, /services, /ai, login, admin...) ----------
export const SHELL_PAGES = {
  '/premium': { title: 'Premium Membership: Ad-free Gaming Guides', h1: 'Eliahtech Gaming Premium', description: 'Go Premium for ad-free reading, exclusive in-depth gaming guides and priority setup support. Simple monthly plans with secure online payment.' },
  '/contact': { title: 'Contact Eliahtech Gaming', h1: 'Contact Eliahtech Gaming', description: 'Questions, game requests or feedback? Send the Eliahtech Gaming team a message and get a reply about guides, settings and support.' },
  '/services': { title: 'Gaming Setup and Support Services', h1: 'Gaming setup and support services', description: 'Get hands-on help with game installation, emulator settings and device optimisation from the Eliahtech Gaming team.' },
  '/ai': { title: 'Free AI Gaming Assistant', h1: 'Free AI gaming assistant', description: 'Ask the AI assistant about PPSSPP settings, Android lag fixes, game errors and setup. Free to try and built for gamers.' },
};
const PRIVATE_TITLES = { '/login': 'Sign in', '/register': 'Create your account', '/forgot-password': 'Reset your password', '/reset-password': 'Choose a new password', '/auth/callback': 'Signing you in', '/payment/return': 'Payment status', '/payment/cancel': 'Payment cancelled', '/newsletter/confirm': 'Confirm your subscription', '/newsletter/unsubscribe': 'Unsubscribe' };
export function shellSeo(pathname) {
  const path = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (SHELL_PAGES[path]) return { ...SHELL_PAGES[path], path, index: true };
  if (path === '/admin' || path.startsWith('/admin/')) return { title: 'Admin', description: '', path, index: false };
  return { title: PRIVATE_TITLES[path] || SITE_NAME, description: '', path, index: false };
}
const NOSCRIPT_LINKS = [['/', 'Home'], ['/posts', 'Gaming guides'], ['/games', 'Game hubs'], ['/categories', 'Topics'], ['/premium', 'Premium'], ['/contact', 'Contact']];
// Turns the generic app shell into a page with its own title, description, canonical, social tags and structured data.
// Public pages become indexable; account, payment and admin pages keep noindex.
export function injectShellSeo(html, { pathname, appUrl, image, social = [] }) {
  const cfg = shellSeo(pathname); const title = fullTitle(cfg.title); const url = `${appUrl}${cfg.path === '/' ? '' : cfg.path}`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${htmlEscape(title)}</title>`).replace(/<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${cfg.index ? INDEXABLE_ROBOTS : NOINDEX_ROBOTS}">`);
  if (!cfg.index) return out.replace('<body>', '<body><noscript><p>Please enable JavaScript to use this page.</p></noscript>');
  const desc = htmlEscape(metaDescription(cfg.description)); const img = image ? htmlEscape(image) : '';
  const handle = twitterHandle(social);
  const head = `<meta name="description" content="${desc}"><link rel="canonical" href="${htmlEscape(url)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:locale" content="${OG_LOCALE}"><meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${htmlEscape(url)}">${img ? `<meta property="og:image" content="${img}"><meta property="og:image:alt" content="${SITE_NAME}"><meta name="twitter:image" content="${img}">` : ''}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEscape(title)}"><meta name="twitter:description" content="${desc}">${handle ? `<meta name="twitter:site" content="${htmlEscape(handle)}">` : ''}<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} guides" href="/feed.xml"><script type="application/ld+json">${JSON.stringify(graph(organizationNode({ appUrl, social }), websiteNode({ appUrl }), webPageNode({ appUrl, url, name: cfg.title, description: metaDescription(cfg.description) }), breadcrumbNode([['Home', appUrl], [cfg.title, url]]))).replace(/</g, '\\u003c')}</script>`;
  out = out.replace(/(<meta name="robots" content="[^"]*">)/, `$1${head}`);
  const links = NOSCRIPT_LINKS.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('');
  return out.replace('<body>', `<body><noscript><main><h1>${htmlEscape(cfg.h1)}</h1><p>${desc}</p><nav aria-label="Site"><ul>${links}</ul></nav></main></noscript>`);
}
