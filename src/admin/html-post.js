// "HTML post": the admin pastes one complete HTML page; everything a post needs is read from it so that publishing is a single click.
// Parsing is regex-based on purpose (no extra dependency, nothing executed); the real safety boundary is sanitizeContent() on save.
import { normalizeImageUrl } from '../images.js';
import { slugify } from './fields.js';

const decode = (v) => String(v ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const stripTags = (v) => decode(String(v ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const RETIRED = /https?:\/\/(?:[\w-]+\.)?eliahtechgaming\.blogspot\.com\/?/gi;

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
function metas(html) {
  const map = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.name || a.property || a['http-equiv'] || '').toLowerCase();
    if (key && a.content !== undefined && !(key in map)) map[key] = a.content.trim();
  }
  return map;
}
const bool = (v) => /^(?:1|true|yes|on)$/i.test(String(v ?? '').trim());
const list = (v) => String(v ?? '').split(/[,\n;|]/).map((t) => t.trim()).filter(Boolean);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const iso = (v) => { if (!v) return null; const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const pick = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '');

// Documented meta tags (all optional): see HTML_POST_TEMPLATE below.
export function parseHtmlPost(rawHtml) {
  const warnings = [];
  let html = String(rawHtml ?? '').replace(/^\uFEFF/, '');
  if (!html.trim()) return { fields: {}, hints: {}, warnings: ['Paste your HTML first.'], images: [] };
  if (RETIRED.test(html)) { html = html.replace(RETIRED, ''); warnings.push('The old eliahtechgaming.blogspot.com address was removed from your HTML.'); }
  RETIRED.lastIndex = 0;
  // Bare mentions of the old blog's host name in text ("Published on eliahtechgaming.blogspot.com") become the brand name.
  html = html.replace(/<a\b[^>]*href=(["'])\s*\1[^>]*>([\s\S]*?)<\/a>/gi, '$2').replace(/(?:[\w-]+\.)?eliahtechgaming\.blogspot\.com/gi, 'EliahTech');
  html = html.replace(/<p>\s*Visit:?\s*<\/p>/gi, '').replace(/<footer>\s*©\s*\d{4}\s*ELIAH TECH\s*-\s*<\/footer>/gi, (m) => m.replace(/\s*-\s*</, '<'));

  const m = metas(html);
  const headStyles = [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)].map((x) => x[0]).join('\n');
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  let body = bodyMatch ? bodyMatch[1] : html.replace(/<head\b[\s\S]*?<\/head\s*>/i, '').replace(/<\/?(?:html|body)\b[^>]*>/gi, '').replace(/<!doctype[^>]*>/gi, '');
  body = body.replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<title\b[\s\S]*?<\/title\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

  const titleTag = stripTags((/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html) || [])[1]);
  const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(body);
  const h1 = h1Match ? stripTags(h1Match[1]) : '';
  const title = (pick(m['eliah:title'], h1, m['og:title'], titleTag.replace(/\s*[|\u2013\u2014-]\s*ELIAH\s*TECH.*$/i, '')) || '').slice(0, 200);
  // The post page prints the title itself, so the page's own matching <h1> would repeat it.
  if (h1Match && h1 && h1.toLowerCase() === title.toLowerCase()) body = body.replace(h1Match[0], '');

  const images = [];
  for (const im of body.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(im[0]); const src = a.src || a['data-src'] || a['data-original'] || '';
    images.push({ src: src.length > 200 ? `${src.slice(0, 80)}…` : src, fixed: /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src) ? 'embedded' : normalizeImageUrl(src), alt: a.alt || '' });
  }
  const firstImg = images.find((i) => i.fixed && i.fixed !== 'embedded');
  const featured = normalizeImageUrl(pick(m['eliah:image'], m['og:image'], m['twitter:image'], firstImg?.fixed) || '');
  if (!featured) warnings.push('No cover image found. Add <meta property="og:image" content="https://…"> or an <img>, or set one below.');
  for (const i of images) if (!i.fixed) warnings.push(`An image link could not be read: ${i.src || '(empty src)'}. Use a direct https image link or upload the picture.`);

  const canonical = pick(/<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0] && attrs(/<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html)[0]).href);
  const keywords = list(pick(m['keywords'], m['eliah:tags']));
  const tags = list(pick(m['eliah:tags'], m['keywords'])).slice(0, 15).filter((t) => t.length >= 2 && t.length <= 40 && slugify(t));
  const description = pick(m['eliah:excerpt'], m['description'], m['og:description']) || '';
  const platform = (pick(m['eliah:platform']) || '').toLowerCase();
  const type = (pick(m['eliah:type']) || '').toLowerCase();

  const fields = {
    title,
    slug: m['eliah:slug'] ? slugify(m['eliah:slug']) : slugify(title),
    excerpt: description.slice(0, 500) || null,
    content_html: `<div class="post-html">${headStyles}${body.trim()}</div>`,
    featured_image_url: featured || null,
    featured_image_alt: (pick(m['eliah:image-alt'], m['og:image:alt'], firstImg?.alt, title) || '').slice(0, 200) || null,
    seo_title: (pick(m['eliah:seo-title'], titleTag) || '').slice(0, 120) || null,
    seo_description: description.slice(0, 320) || null,
    seo_keywords: keywords.map((k) => k.slice(0, 60)).slice(0, 20),
    canonical_url: canonical && /^https:\/\//i.test(canonical) ? canonical : null,
    author_name: (pick(m['eliah:author'], m['author']) || '').slice(0, 80) || null,
    tags,
    content_type: ['guide', 'installation', 'settings', 'textures', 'update', 'troubleshooting'].includes(type) ? type : 'guide',
    platform: ['android', 'ppsspp', 'pc', 'console', 'other'].includes(platform) ? platform : null,
    android_min_version: pick(m['eliah:android-min']) || null,
    emulator_version: pick(m['eliah:emulator']) || null,
    min_ram_gb: num(m['eliah:ram']),
    storage_mb: Number.isInteger(num(m['eliah:storage'])) ? num(m['eliah:storage']) : (num(m['eliah:storage']) ? Math.round(num(m['eliah:storage'])) : null),
    tested_devices: list(m['eliah:devices']).slice(0, 20),
    last_tested_at: iso(m['eliah:tested']),
    reviewed_at: iso(m['eliah:reviewed']),
    compatibility_notes: (pick(m['eliah:notes']) || '').slice(0, 1000) || null,
    is_premium: bool(m['eliah:premium']),
    featured: bool(m['eliah:featured']),
    ads_disabled: bool(m['eliah:ads-disabled']),
    published_at: iso(m['eliah:publish-at']),
  };
  if (!title) warnings.push('No title found. Add a <title> or an <h1>.');
  if (!description) warnings.push('No meta description found: the excerpt and SEO description are empty.');
  if (/<script\b/i.test(html)) warnings.push('<script> tags are removed for safety.');
  if (/<form\b|<input\b|<button\b/i.test(body)) warnings.push('Forms, inputs and buttons are removed for safety. Use links styled as buttons instead.');
  return { fields, hints: { category: pick(m['eliah:category']) || '', game: pick(m['eliah:game']) || '', status: pick(m['eliah:status']) || '', slug: pick(m['eliah:slug']) || '' }, warnings, images };
}

export async function resolveRefs(db, hints) {
  const out = {};
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  if (hints.category) {
    const rows = await db.select('categories', { select: 'id,slug,name', limit: '200' });
    const hit = rows.find((c) => norm(c.slug) === norm(hints.category) || norm(c.name) === norm(hints.category) || c.slug === slugify(hints.category));
    if (hit) out.category_id = hit.id;
  }
  if (hints.game) {
    const rows = await db.select('game_hubs', { select: 'id,slug,name', limit: '200' });
    const hit = rows.find((g) => norm(g.slug) === norm(hints.game) || norm(g.name) === norm(hints.game) || g.slug === slugify(hints.game));
    if (hit) out.game_id = hit.id;
  }
  return out;
}

export const HTML_POST_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Download Your Game Here (2026) | ELIAH TECH</title>
<meta name="description" content="One or two sentences that appear on the post card, in Google and when shared.">
<meta name="keywords" content="PPSSPP, Android Games, ELIAH TECH">
<meta property="og:image" content="https://example.com/cover.jpg">
<meta property="og:image:alt" content="Describe the cover image">
<meta name="author" content="ELIAH TECH">

<!-- Optional ETG settings (delete any you do not need) -->
<meta name="eliah:category" content="PSP & PPSSPP Games">
<meta name="eliah:game" content="">
<meta name="eliah:type" content="guide"><!-- guide | installation | settings | textures | update | troubleshooting -->
<meta name="eliah:platform" content="ppsspp"><!-- android | ppsspp | pc | console | other -->
<meta name="eliah:android-min" content="8.0">
<meta name="eliah:emulator" content="PPSSPP 1.17">
<meta name="eliah:ram" content="3"><!-- GB -->
<meta name="eliah:storage" content="1500"><!-- MB -->
<meta name="eliah:devices" content="Tecno Spark 10, Samsung A12">
<meta name="eliah:tested" content="2026-11-01">
<meta name="eliah:notes" content="Runs smoothly at 2x resolution.">
<meta name="eliah:premium" content="false">
<meta name="eliah:featured" content="false">
<meta name="eliah:publish-at" content=""><!-- blank = now -->

<style>
header{padding:28px;background:linear-gradient(135deg,#0d6efd,#172554);color:#fff;text-align:center;border-radius:14px}
.card{background:#f1f5ff;padding:18px;border-radius:12px;margin:18px 0}
a.btn{display:inline-block;padding:12px 18px;background:#0d6efd;color:#fff;border-radius:8px;margin:6px 6px 6px 0}
</style>
</head>
<body>
<header>
  <h1>Download Your Game Here (2026)</h1>
  <p>Published by ELIAH TECH</p>
</header>
<div class="card">
  <h2>Features</h2>
  <ul><li>HD graphics</li><li>Offline play</li></ul>
</div>
<div class="card">
  <h2>Installation</h2>
  <ol><li>Download the file.</li><li>Install it.</li><li>Play.</li></ol>
  <img src="https://example.com/screenshot.jpg" alt="Gameplay screenshot">
</div>
<div class="card">
  <h2>Download</h2>
  <a class="btn" href="https://example.com/download">Download now</a>
</div>
</body>
</html>
`;
