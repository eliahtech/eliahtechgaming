import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('mobile stylesheet exists and covers the key phone rules', () => {
  assert.ok(existsSync(new URL('../public/mobile.css', import.meta.url)));
  const css = read('public/mobile.css');
  assert.match(css, /font-size:16px!important/); // stops iOS focus-zoom
  assert.match(css, /min-height:44px/); // touch targets
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /max-width:767\.98px/);
});
test('public pages and the account/admin shell load mobile.css last and allow edge-to-edge viewports', () => {
  const templates = read('src/web/templates.js');
  assert.ok(templates.indexOf('/promotions.css') < templates.indexOf('/mobile.css'));
  assert.match(templates, /viewport-fit=cover/);
  const routes = read('src/web/routes.js');
  assert.ok(routes.indexOf('/workspace.css') < routes.indexOf('/mobile.css'));
  assert.match(read('public/admin.html'), /viewport-fit=cover/);
});
test('mobile.css only uses self-hosted, CSP-safe constructs', () => {
  assert.doesNotMatch(read('public/mobile.css'), /@import|url\(\s*['"]?https?:/);
});
