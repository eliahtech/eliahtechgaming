import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { layout, siteNav, siteFooter, homeHero, homeSection, topicTiles, promoBand, newsletterCard, postCover, categoryCover, categoryTile, cards, articleCover, emptyState, skeletonLines, skeletonPanel, skeletonCards, themeToggle } from '../src/web/templates.js';

const pub = f => new URL(`../public/${f}`, import.meta.url);
const base = { title: 'T', canonical: 'https://gaming.example/posts/x', image: '/a.jpg', body: '<p>hi</p>', social: [{ platform: 'YouTube', url: 'https://youtube.com/x' }] };
const balanced = html => (html.match(/<div\b/g) || []).length === (html.match(/<\/div>/g) || []).length;

test('fonts are self-hosted, small, preloaded and declared with font-display:swap', () => {
  for (const w of [400, 500, 700]) { assert.ok(existsSync(pub(`fonts/poppins-${w}.woff`))); assert.ok(statSync(pub(`fonts/poppins-${w}.woff`)).size < 40 * 1024); }
  assert.ok(existsSync(pub('fonts/POPPINS-LICENSE.txt')));
  const css = readFileSync(pub('fonts.css'), 'utf8');
  assert.equal((css.match(/font-display:swap;src:/g) || []).length, 3);
  assert.doesNotMatch(css, /https?:\/\//); // CSP: no third-party font hosts
  const html = layout(base);
  assert.match(html, /rel="preload" href="\/fonts\/poppins-700\.woff" as="font" type="font\/woff" crossorigin/);
  assert.ok(html.indexOf('/fonts.css') < html.indexOf('/theme.css') && html.indexOf('/theme.css') < html.indexOf('/mobile.css'));
});
test('navigation marks the current section, keeps the account hook and styles Premium', () => {
  assert.match(siteNav('https://x.example/posts/abc'), /nav-link active" href="\/posts" aria-current="page"/);
  assert.match(siteNav('https://x.example/category/android'), /class="nav-link active" href="\/posts"/);
  assert.match(siteNav('https://x.example/'), /nav-link active" href="\/" aria-current="page">Home</);
  assert.equal((siteNav('https://x.example/').match(/aria-current/g) || []).length, 1, 'only Home is current on the homepage');
  const nav = siteNav('https://x.example/games/pes');
  assert.match(nav, /href="\/games" aria-current="page"/);
  assert.match(nav, /id="account-nav"/);
  assert.match(nav, /nav-premium/);
  assert.equal(siteNav('not a url').includes('nav-link'), true);
});
test('footer has link columns, socials, a working newsletter form and a back-to-top link', () => {
  const html = siteFooter([{ platform: 'YouTube', url: 'https://youtube.com/x' }, { platform: 'Bad', url: 'javascript:alert(1)' }]);
  for (const href of ['/games', '/posts', '/categories', '/search', '/about', '/contact', '/privacy', '/terms', '/dmca', '/disclaimer', '#main']) assert.ok(html.includes(`href="${href}"`), href);
  assert.match(html, /data-newsletter/); assert.match(html, /autocomplete="email"/);
  assert.match(html, /data-browsing-settings/);
  assert.ok(html.includes('youtube.com') && !html.includes('javascript:'));
  assert.ok(balanced(html));
  assert.doesNotMatch(siteFooter([], false), /footer-cta|data-newsletter/);
  assert.equal(layout({ ...base, showSubscribe: false }).includes('footer-cta'), false);
});
test('homepage hero escapes content, only shows real stats and honours the CTA settings', () => {
  const html = homeHero({ title: '<script>x</script>', description: 'D & E', categories: [{ slug: 'a', name: 'A' }], total: 12, settings: { cta_label: 'Go', cta_url: '/x', secondary_cta_label: 'More', secondary_cta_url: '/y' }, safeLink: v => v });
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;') && html.includes('D &amp; E'));
  assert.match(html, /<strong>12<\/strong> guides/); assert.match(html, /role="search"/); assert.match(html, /href="\/category\/a"/);
  assert.match(html, /btn-warning btn-lg" href="\/x"/); assert.match(html, /btn-outline-light btn-lg" href="\/y"/);
  const bare = homeHero({ title: 'T', description: 'D', categories: [], total: 0, settings: {} });
  assert.doesNotMatch(bare, /guides<\/li>|topics<\/li>|hero-actions|hero-chips/);
  assert.ok(balanced(html));
});
test('homepage sections never reuse post-card markup and escape their headings', () => {
  const tiles = topicTiles([{ slug: 'psp-games', name: 'PSP <b>' }, { slug: 'unknown', name: 'X' }]);
  assert.ok(tiles.includes('/covers/tile-psp-ppsspp-games.webp') && tiles.includes('/covers/tile-default.webp') && tiles.includes('PSP &lt;b&gt;'));
  const all = [tiles, promoBand({ kind: 'ai', text: 't', href: '/ai', label: 'Go', buttonClass: 'btn-warning' }), newsletterCard(), homeSection({ key: 'x', heading: '<h>', inner: 'i', action: ['/a', 'All'] })].join('');
  assert.doesNotMatch(all, /class="card post-card/);
  assert.match(homeSection({ key: 'x', heading: '<h>', inner: '' }), /&lt;h&gt;/);
});
test('posts without their own cover get the branded category template; uploads are left untouched', () => {
  assert.deepEqual(postCover({ featured_image: '/assets/gaming-cover.jpg', category: { slug: 'android-tips' } }), { src: '/covers/android-games-mods.webp', branded: true });
  assert.deepEqual(postCover({ category: { slug: 'ai-tools-tutorials' } }), { src: '/covers/ai-tools-tutorials.webp', branded: true });
  assert.deepEqual(postCover({ featured_image: 'https://cdn.example/c.jpg' }), { src: 'https://cdn.example/c.jpg', branded: false });
  assert.deepEqual(postCover({ featured_image: 'javascript:alert(1)' }).branded, true);
  assert.equal(categoryCover('nope'), '/covers/default.webp'); assert.equal(categoryTile('tech-tricks'), '/covers/tile-tech-tips-tutorials.webp');
  assert.match(articleCover({ title: 'T', featured_image: 'https://cdn.example/c.jpg', featured_image_alt: 'Alt' }), /cover-frame article-cover-frame"><img class="article-cover" referrerpolicy="no-referrer" src="https:\/\/cdn.example\/c.jpg" alt="Alt" width="1200" height="675"/);
  assert.match(articleCover({ title: 'T', category: { slug: 'psp-games' } }), /cover-baked/);
  assert.match(cards([{ slug: 's', title: 'T', excerpt: 'e', featured_image: 'https://cdn.example/c.jpg' }]), /class="cover-frame" href="\/posts\/s"/);
});
test('every generated cover and tile exists at the expected size budget', () => {
  for (const slug of ['football-games-updates', 'psp-ppsspp-games', 'android-games-mods', 'game-installation-setup', 'game-graphics-textures-mods', 'tech-tips-tutorials', 'ai-tools-tutorials', 'default']) {
    assert.ok(statSync(pub(`covers/${slug}.webp`)).size < 150 * 1024, slug);
    assert.ok(statSync(pub(`covers/tile-${slug}.webp`)).size < 40 * 1024, `tile ${slug}`);
  }
});
test('theme.css defines the mobile-safe pieces the markup relies on', () => {
  const css = readFileSync(pub('theme.css'), 'utf8');
  for (const selector of ['.home-hero', '.hero-search', '.topic-grid', '.topic-tile', '.promo-band', '.cover-frame', '.cover-baked', '.site-footer', '.footer-cta', '.nav-premium', ':focus-visible', 'prefers-reduced-motion']) assert.ok(css.includes(selector) || selector === '.cover-baked' && css.includes('cover-baked'), selector);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
});

// ---------- Dark mode, contrast, loading and empty states ----------
const luminance = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const cssVars = text => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
const cssBlock = (css, selector) => css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'))[1];

test('light and dark palettes meet WCAG AA (4.5:1) for text pairs', () => {
  const css = readFileSync(pub('theme.css'), 'utf8');
  const light = cssVars(cssBlock(css, ':root')); const dark = { ...light, ...cssVars(cssBlock(css, '[data-theme="dark"]')) };
  const pairs = [['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['link', 'bg'], ['link', 'surface'], ['badge-blue-text', 'blue-soft'], ['gold-text', 'gold-soft']];
  for (const [name, palette] of [['light', light], ['dark', dark]]) for (const [fg, bg] of pairs) assert.ok(contrast(palette[fg], palette[bg]) >= 4.5, `${name}: ${fg} on ${bg} = ${contrast(palette[fg], palette[bg]).toFixed(2)}`);
});
test('theme script runs in the head before CSS, follows the device and remembers the choice safely', () => {
  const html = layout(base);
  assert.ok(html.indexOf('<script src="/theme.js"></script>') > 0 && html.indexOf('/theme.js') < html.indexOf('/vendor/bootstrap.min.css'));
  const js = readFileSync(pub('theme.js'), 'utf8');
  assert.match(js, /prefers-color-scheme: dark/); assert.match(js, /localStorage/); assert.match(js, /try \{/); assert.match(js, /data-bs-theme/);
  assert.match(js, /theme-color/); assert.doesNotMatch(js, /https?:\/\/|eval\(|innerHTML/);
});
test('the theme toggle is an accessible button in the navigation with icons for both states', () => {
  const nav = siteNav('https://x.example/');
  assert.equal(nav, siteNav('https://x.example/')); assert.ok(nav.includes(themeToggle()));
  assert.match(themeToggle(), /<button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false" aria-label="Switch to dark mode">/);
  assert.match(themeToggle(), /icon-moon/); assert.match(themeToggle(), /icon-sun/); assert.match(themeToggle(), /aria-hidden="true"/);
});
test('dark theme styles every light-only surface', () => {
  const css = readFileSync(pub('theme.css'), 'utf8');
  for (const part of ['.reader-actions', '.community-panel', '.post-card', '.newsletter-card', '.etg-browsing-dialog', '.text-bg-light', '.form-control', '.btn-outline-primary', '.article-body pre']) assert.ok(css.includes(part), part);
  assert.match(css, /color-scheme:dark/); assert.match(css, /color-scheme:light/);
});
test('empty states are friendly, escaped, accessible and actionable', () => {
  const html = emptyState({ icon: 'search', title: 'No <b>match</b>', text: 'Try again & again', action: ['/search', 'Search guides'] });
  assert.ok(html.includes('role="status"') && html.includes('No &lt;b&gt;match&lt;/b&gt;') && html.includes('again &amp; again'));
  assert.match(html, /<a class="btn btn-primary" href="\/search">Search guides<\/a>/); assert.match(html, /<svg viewBox="0 0 24 24">/);
  assert.doesNotMatch(emptyState({ title: 'T', small: true }), /<svg|btn/);
  assert.match(emptyState({ icon: 'unknown-icon', title: 'T' }), /<svg/);
  assert.ok(balanced(html));
});
test('loading skeletons are decorative, shimmer-only and never shown to screen readers', () => {
  assert.equal((skeletonLines(3).match(/skeleton-line/g) || []).length, 3);
  assert.match(skeletonPanel(), /aria-hidden="true"/); assert.match(skeletonCards(2), /aria-hidden="true"/);
  assert.equal((skeletonCards(4).match(/skeleton-panel/g) || []).length, 4); assert.ok(balanced(skeletonCards(3)) && balanced(skeletonPanel(2)));
  const css = readFileSync(pub('theme.css'), 'utf8');
  assert.match(css, /@keyframes skeleton-shimmer/); assert.match(css, /prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important/);
});
test('client script replaces plain "No … yet" text with empty states and clears the busy flag', () => {
  const js = readFileSync(pub('gaming.js'), 'utf8');
  assert.match(js, /const empty=/); assert.doesNotMatch(js, /'<p>No (approved reader solutions|published requests|updates|tickets) yet\.<\/p>'/);
  assert.match(js, /removeAttribute\('aria-busy'\)/);
});
