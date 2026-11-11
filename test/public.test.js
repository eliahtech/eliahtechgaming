import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const routes = JSON.parse(readFileSync(new URL('../public/manus-routes.json', import.meta.url), 'utf8'));

test('contact page keeps its own copy when Supabase site settings contain About copy', () => {
  assert.match(app, /slug === 'about' && site\?\.about_text/);
  assert.match(app, /id="contact-form"/);
  assert.match(app, /api\('\/contact'/);
  assert.match(app, /id="contact-status"/);
});

test('route manifest covers every Next.js public and migrated application route', () => {
  const paths = new Set(routes.routes.map((route) => route.path));
  for (const path of ['/', '/posts', '/posts/:slug', '/categories', '/categories/:slug', '/ai', '/services', '/premium', '/search', '/login', '/register', '/forgot-password', '/reset-password', '/profile', '/payment/:result', '/newsletter', '/newsletter/:action', '/admin', '/admin/:path*', '/about', '/contact', '/privacy', '/terms', '/disclaimer', '/dmca']) assert.ok(paths.has(path), `missing ${path}`);
  assert.equal(existsSync(new URL('../public/index.html', import.meta.url)), false, 'the App Router owns the public homepage');
});
