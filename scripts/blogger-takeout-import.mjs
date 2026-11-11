#!/usr/bin/env node
// Google Takeout (Blogger) -> Supabase SQL. Posts only, published, never premium.
//   node scripts/blogger-takeout-import.mjs "<path>/Takeout/Blogger/Blogs/ELIAHTECH/feed.atom" [outDir]
// Every post-editor field is filled from the post itself (description, labels, images, text). Facts that only real testing can
// provide (devices tested, RAM...) are filled ONLY when the post text states them; otherwise they stay blank and are listed in the report.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseHtmlPost } from '../src/admin/html-post.js';
import { slugify } from '../src/admin/fields.js';
import { scopeCss, STYLE_BLOCK, POST_SCOPE } from '../src/css-scope.js';

const input = process.argv[2]; const outDir = process.argv[3] || 'content/blogger-import';
if (!input) { console.error('Usage: node scripts/blogger-takeout-import.mjs <feed.atom> [outDir]'); process.exit(1); }
const raw = readFileSync(input, 'utf8');
if (/<!DOCTYPE|<!ENTITY/i.test(raw.slice(0, 2000)) && /<!ENTITY/i.test(raw)) throw new Error('XML entities are not accepted.');
let sanitizeContent = null;
try { sanitizeContent = (await import('../src/sanitize.js')).sanitizeContent; } catch { /* sanitize-html not installed: the site still sanitizes on every read */ }

// ---- tiny Atom reader (no dependency) ----
const dec = (v) => String(v ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? dec(m[1]).trim() : ''; };
const entries = [...raw.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
const posts = entries.map((e) => ({
  type: tag(e, 'blogger:type'), status: tag(e, 'blogger:status'), title: tag(e, 'title'), content: tag(e, 'content'),
  description: tag(e, 'blogger:metaDescription'), filename: tag(e, 'blogger:filename'), published: tag(e, 'published'),
  labels: [...e.matchAll(/<category\b[^>]*term='([^']*)'|<category\b[^>]*term="([^"]*)"/g)].map((m) => dec(m[1] ?? m[2])).filter((t) => t && !t.startsWith('http')),
})).filter((p) => p.type === 'POST' && p.status === 'LIVE');

// ---- rules ----
const CATEGORY = { psp: 'psp-ppsspp-games', football: 'football-games-updates', android: 'android-games-mods', install: 'game-installation-setup', graphics: 'game-graphics-textures-mods', tech: 'tech-tips-tutorials', ai: 'ai-tools-tutorials' };
const text = (html) => dec(String(html).replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function classify(title, labels, body) {
  const t = `${title} ${labels.join(' ')}`.toLowerCase(); const b = `${t} ${body.slice(0, 1500).toLowerCase()}`;
  let category, sure = true;
  if (/\bpsp\b|ppsspp|\biso\b/.test(t)) category = CATEGORY.psp;
  else if (/\bfc ?\d\d|fifa|\bfts\b|first touch|\bdls\b|dream league|efootball|football|\bpes\b|soccer/.test(t)) category = CATEGORY.football;
  else if (/\bai\b|chatgpt|prompt/.test(t)) category = CATEGORY.ai;
  else if (/apk|obb|android game|mod\b|\bgta\b|game/.test(t)) category = CATEGORY.android;
  else if (/windows|tech|tips|tricks|vpn|android|phone|internet|facebook|website|blogger|wordpress|settings/.test(t)) category = CATEGORY.tech;
  else if (/\bpsp\b|ppsspp/.test(b)) { category = CATEGORY.psp; sure = false; }
  else { category = CATEGORY.tech; sure = false; }
  const game = /\bfts\b|first touch/.test(t) ? 'fts' : /\bdls\b|dream league/.test(t) ? 'dls' : /efootball/.test(t) ? 'efootball' : /fifa ?16/.test(t) ? 'fifa-16' : /\bpsp\b|ppsspp/.test(t) ? 'ppsspp' : null;
  const type = /how to install|install(ation)?\b|setup/.test(t) ? 'installation' : /settings/.test(t) ? 'settings' : /texture/.test(t) ? 'textures' : /\bupdate|new release|latest version/.test(t) ? 'update' : 'guide';
  const platform = /\bpsp\b|ppsspp/.test(t) ? 'ppsspp' : /apk|obb|android/.test(t) ? 'android' : /windows|\bpc\b/.test(t) ? 'pc' : null;
  return { category, sure, game, type, platform };
}
const cleanLabel = (l) => l.replace(/^[\s"'“”]+|[\s"'“”]+$/g, '').replace(/\s+/g, ' ');
const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
const arr = (a) => (a.length ? `array[${a.map(q).join(',')}]::text[]` : "'{}'::text[]");
const titleCase = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const seen = new Set(); const report = []; const redirects = []; const statements = [];
for (const p of posts) {
  const parsed = parseHtmlPost(p.content); const f = parsed.fields; const notes = [];
  let title = (p.title || f.title || '').trim();
  if (!title) { title = f.seo_title?.replace(/\s*[|–-]\s*ELIAH\s*TECH.*$/i, '').trim() || titleCase((p.filename.split('/').pop() || '').replace(/\.html$/, '')) || ''; notes.push('Title was empty in Blogger: derived from the page.'); }
  if (!title) { report.push({ skipped: true, reason: 'no title could be found', filename: p.filename }); continue; }
  let slug = slugify((p.filename.split('/').pop() || '').replace(/\.html$/, '')) || slugify(title);
  if (!p.filename) notes.push('No old Blogger address: slug made from the title.');
  for (let n = 2; seen.has(slug); n += 1) slug = `${slugify(title)}-${n}`;
  seen.add(slug);
  // CSS from the pasted page is scoped to the post box so it cannot restyle the site or the admin editor.
  let html = f.content_html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"');
  if (sanitizeContent) html = sanitizeContent(html);
  else { const styles = []; html = html.replace(STYLE_BLOCK, (_m, css) => { const s = scopeCss(css); if (s) styles.push(s); return ''; }); if (styles.length) html = `<style>${styles.join('\n')}</style>${html}`; }
  const plain = text(f.content_html);
  const labels = [...new Set(p.labels.map(cleanLabel).filter((l) => l.length >= 2 && l.length <= 40 && slugify(l)))].slice(0, 15);
  const c = classify(title, labels, plain);
  if (!c.sure) notes.push('Category was a low-confidence guess: please check it.');
  const tags = labels.length ? labels : [titleCase(c.category)]; if (!labels.length) notes.push('No labels in Blogger: tag set from the category.');
  const description = (p.description || f.excerpt || plain.slice(0, 160)).replace(/\s+/g, ' ').trim();
  if (!p.description) notes.push('No Blogger description: excerpt taken from the post.');
  const image = f.featured_image_url; if (!image) notes.push('No image found in the post: the default cover is used until you add one.');
  const published = p.published && !Number.isNaN(Date.parse(p.published)) ? new Date(p.published).toISOString() : new Date().toISOString();
  const android = /android\s*(\d{1,2}(?:\.\d)?)\s*\+/i.exec(plain)?.[1] || null;
  const ram = /(\d{1,2})\s*gb\s*ram|ram[^.]{0,12}?(\d{1,2})\s*gb/i.exec(plain); const ramGb = ram ? Number(ram[1] || ram[2]) : null;
  const emulator = /ppsspp\s*v?(\d\.\d{1,2}(?:\.\d{1,2})?)/i.exec(plain)?.[1] || null;
  const words = plain.split(/\s+/).filter(Boolean).length;
  const missing = ['min_ram_gb', 'storage_mb', 'tested_devices', 'last_tested_at', 'compatibility_notes'].filter((k) => !(k === 'min_ram_gb' && ramGb)); if (android) missing.splice(0, 0); 
  statements.push([
    `insert into public.posts(title,slug,excerpt,content_html,status,published_at,featured_image_url,featured_image_alt,seo_title,seo_description,seo_keywords,author_name,category_id,game_id,content_type,platform,android_min_version,emulator_version,min_ram_gb,reading_time,is_premium,featured,ads_disabled) values(` +
    `${q(title.slice(0, 200))},${q(slug)},${q(description.slice(0, 500))},${q(html)},'published',${q(published)},${q(image)},${q((f.featured_image_alt || title).slice(0, 200))},${q((f.seo_title || title).slice(0, 120))},${q(description.slice(0, 320))},${arr(labels.length ? labels : [title.slice(0, 60)])},'ELIAH TECH',` +
    `(select id from public.categories where slug=${q(c.category)}),${c.game ? `(select id from public.game_hubs where slug=${q(c.game)})` : 'null'},${q(c.type)},${q(c.platform)},${q(android)},${q(emulator)},${ramGb ?? 'null'},${Math.max(1, Math.ceil(words / 200))},false,false,false) on conflict(slug) do nothing;`,
    ...tags.flatMap((name) => [`insert into public.tags(name,slug) values(${q(name)},${q(slugify(name))}) on conflict do nothing;`, `insert into public.post_tags(post_id,tag_id) select p.id,t.id from public.posts p,public.tags t where p.slug=${q(slug)} and t.slug=${q(slugify(name))} on conflict do nothing;`]),
  ].join('\n'));
  if (p.filename) redirects.push({ from: p.filename.replace(/\.html$/, '.html'), to: `/posts/${slug}` });
  report.push({ title, slug, old_path: p.filename || null, category: c.category, game_hub: c.game, guide_type: c.type, platform: c.platform, tags, has_image: Boolean(image), has_description: Boolean(p.description), words, found_in_text: { android_min: android, ram_gb: ramGb, emulator }, notes });
}

mkdirSync(outDir, { recursive: true });
const files = []; let chunk = []; let size = 0;
const flush = () => { if (!chunk.length) return; const name = `part-${String(files.length + 1).padStart(2, '0')}.sql`; writeFileSync(`${outDir}/${name}`, `-- Blogger import ${name}: published, free posts. Safe to re-run (existing slugs are left unchanged).\nbegin;\n${chunk.join('\n')}\ncommit;\n`); files.push(name); chunk = []; size = 0; };
for (const s of statements) { if (size + s.length > 300_000) flush(); chunk.push(s); size += s.length; }
flush();
writeFileSync(`${outDir}/redirects.json`, JSON.stringify(redirects, null, 2) + '\n');
writeFileSync(`${outDir}/review-report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`Posts: ${statements.length} imported, ${report.filter((r) => r.skipped).length} skipped. SQL files: ${files.join(', ')}. Sanitized with sanitize-html: ${Boolean(sanitizeContent)}.`);
