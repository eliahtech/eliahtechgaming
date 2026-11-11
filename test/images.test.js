import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';

const pub = (f) => new URL(`../public/${f}`, import.meta.url);
const kb = (f) => statSync(pub(f)).size / 1024;
const pngSize = (f) => { const b = readFileSync(pub(f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('app icons are square, correctly sized and light enough for mobile', () => {
  for (const [f, size] of [['icon-32.png', 32], ['icon-64.png', 64], ['icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
    assert.deepEqual(pngSize(`assets/branding/${f}`), [size, size], f);
    assert.ok(kb(`assets/branding/${f}`) < 200, `${f} is ${Math.round(kb(`assets/branding/${f}`))} KB`);
  }
});
test('web manifest offers any and maskable icons that exist', () => {
  const manifest = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8'));
  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'));
  for (const icon of manifest.icons) assert.ok(existsSync(pub(icon.src.slice(1))), icon.src);
});
test('social share cover and email logo are light enough for WhatsApp, Facebook and mail clients', () => {
  assert.ok(existsSync(pub('assets/gaming-cover.jpg')));
  assert.ok(kb('assets/gaming-cover.jpg') < 300, 'share image must stay under 300 KB');
  assert.ok(kb('assets/branding/etg-logo-email.png') < 100);
  assert.ok(existsSync(pub('assets/branding/etg-logo-320.webp')));
});
test('promotion popups are compressed WebP files', () => {
  const data = readFileSync(pub('promotions-data.js'), 'utf8');
  for (const name of ['premium', 'guides', 'latest']) {
    assert.match(data, new RegExp(`/promotions/${name}\\.webp`));
    assert.ok(kb(`promotions/${name}.webp`) < 250, name);
  }
  assert.equal(readdirSync(pub('promotions/')).filter((f) => f.endsWith('.png')).length, 0);
});
test('no oversized raster images are served to visitors (logo master excepted)', () => {
  const walk = (dir, out = []) => { for (const e of readdirSync(pub(dir), { withFileTypes: true })) { const p = `${dir}${e.name}`; if (e.isDirectory()) { if (e.name !== 'vendor') walk(`${p}/`, out); } else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(p); } return out; };
  const heavy = walk('').filter((f) => f !== 'assets/branding/etg-logo.png' && kb(f) > 400);
  assert.deepEqual(heavy, []);
});
test('cacheable image headers are configured for Vercel and Express', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(vercel.headers.some((h) => /webp/.test(h.source) && h.headers.some((x) => /max-age=\d{6,}/.test(x.value))));
  assert.match(readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /setHeaders/);
});
