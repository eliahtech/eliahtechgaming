import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDashboard, initials, greeting, daysUntil, money, dateText, membership, checklist } from '../public/dashboard.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BAD = '<img src=x onerror=alert(1)>';
const NOW = Date.parse('2026-10-28T10:00:00Z');

test('initials, greeting, dates and money are formatted safely', () => {
  assert.equal(initials('Eliah Tech'), 'ET'); assert.equal(initials('  madonna '), 'M'); assert.equal(initials(''), 'M'); assert.equal(initials(null), 'M');
  assert.equal(initials('élodie ñandú zoe'), 'ÉÑ'); assert.equal(initials('😀 smile'), '😀S');
  assert.deepEqual([greeting(5), greeting(11), greeting(12), greeting(17), greeting(18), greeting(23)], ['Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening']);
  assert.equal(daysUntil('2026-10-31T10:00:00Z', NOW), 3); assert.equal(daysUntil('2026-10-28T11:00:00Z', NOW), 1); assert.equal(daysUntil(null, NOW), null);
  assert.equal(dateText('2026-10-28T10:00:00Z'), 'Oct 28, 2026'); assert.equal(dateText('nonsense'), ''); assert.equal(dateText(undefined), '');
  assert.equal(money(500, 'KES'), 'KES 500'); assert.equal(money('4.5', 'USD'), 'USD 4.5'); assert.equal(money(1234.5, ''), '1,234.5');
});
test('membership explains what the member has, with no broken dates', () => {
  assert.deepEqual(membership({ role: 'admin' }).tier, 'admin');
  const sub = membership({ access: { source: 'subscription', premium_until: '2026-12-01T00:00:00Z' } }, true, NOW);
  assert.deepEqual([sub.tier, sub.label, sub.detail, sub.days], ['premium', 'Premium', 'Active until Dec 1, 2026.', 34]);
  assert.equal(membership({ access: { source: 'subscription' } }, true).detail, 'Your Premium subscription is active.'); // never "Invalid Date"
  const trial = membership({ access: { source: 'trial', trial: { ends_at: '2026-10-30T10:00:00Z' } } }, false, NOW);
  assert.deepEqual([trial.tier, trial.label, trial.days], ['trial', 'Premium trial', 2]);
  assert.equal(membership({ access: { source: 'role' } }, false).tier, 'premium');
  assert.equal(membership({ access: { trial: { expired: true } } }).detail.startsWith('Your trial has ended'), true);
  assert.match(membership({ email_verified: false, access: { trial: {} } }).detail, /Verify your email/);
  assert.match(membership({ email_verified: true, access: { trial: {} } }).detail, /Premium adds/);
  assert.equal(membership({}).tier, 'free'); // missing access object
});
test('the setup checklist reflects real progress', () => {
  const none = checklist({ email_verified: false }, { device: null, game_follows: [], bookmarks: [] });
  assert.deepEqual(none.map((s) => s.done), [false, false, false, false]);
  const all = checklist({ email_verified: true }, { device: { device: 'Pixel' }, game_follows: [{}], bookmarks: [{}] });
  assert.deepEqual(all.map((s) => s.done), [true, true, true, true]);
  assert.deepEqual(none.map((s) => s.tab), ['account', 'account', 'following', 'library']);
});

function harness({ account = { display_name: 'Ann', email: 'ann@x.co', email_verified: true, access: { trial: {} } }, data = {}, extra = {} } = {}) {
  const calls = []; const events = []; const root = { innerHTML: '', querySelector: () => null };
  Object.assign(globalThis, { location: { hash: '', pathname: '/community', assign: (u) => calls.push(['assign', u]) }, history: { replaceState: (_s, _t, url) => events.push(url) }, window: { addEventListener: () => {} }, document: { querySelector: () => null }, confirm: () => true });
  const base = { bookmarks: [], reading_history: [], game_follows: [], notifications: [], support_tickets: [], device: null, is_premium: false, ...data };
  const api = async (path, options = {}) => {
    calls.push([options.method || 'GET', path, options.body]);
    if (path === '/community/me') return base; if (path === '/community/member-benefits') return { support_hours: 'Mon-Fri', community_url: 'https://chat.example/join' };
    if (path === '/payments/mine') return extra.payments ?? []; if (path === '/community/requests') return extra.requests ?? []; return {};
  };
  return { root, calls, events, api, account, run: () => renderDashboard({ root, api, account, e }) };
}
const click = (root, dataset, id) => root.onclick({ target: { closest: () => ({ dataset, id }) } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('every tab renders, with hostile data escaped everywhere', async () => {
  const data = { bookmarks: [{ post_id: 'p1', slug: 'a b/c', title: BAD }], reading_history: [{ slug: 's', title: BAD, created_at: '2026-10-01T00:00:00Z' }], game_follows: [{ id: 'f1', game: BAD }], notifications: [{ message: BAD, created_at: '2026-10-02T00:00:00Z' }], support_tickets: [{ subject: BAD, status: 'weird<status>', admin_reply: BAD, priority: 'high', created_at: '2026-10-03T00:00:00Z' }], device: { device: BAD, ram_gb: 6, emulator: BAD, emulator_version: '1' }, is_premium: true };
  const h = harness({ account: { display_name: BAD, email: BAD, email_verified: false, access: { source: 'subscription', premium_until: '2027-01-01T00:00:00Z' } }, data, extra: { payments: [{ plan: BAD, amount: 5, currency: 'USD', status: BAD, created_at: '2026-10-04T00:00:00Z' }], requests: [{ id: 'r1', title: BAD, description: BAD, status: BAD }] } });
  await h.run();
  for (const tab of ['overview', 'library', 'following', 'support', 'billing', 'account']) {
    click(h.root, { tab }); await tick();
    assert.ok(h.root.innerHTML.includes(`id="tab-${tab}" aria-controls="dash-panel" aria-selected="true"`), tab);
    assert.equal(/<img src=x/i.test(h.root.innerHTML), false, `unescaped markup in ${tab}`);
    assert.equal(/onerror=alert/i.test(h.root.innerHTML.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), false, `raw handler in ${tab}`);
    if (tab === 'library') { assert.ok(h.root.innerHTML.includes('href="/posts/a%20b%2Fc"') && h.root.innerHTML.includes('href="/posts/s"')); } // slugs are URL-encoded in links
  }
});
test('opening the dashboard loads data once, shows the right tab from the URL hash and never leaves a stuck skeleton', async () => {
  const h = harness({ data: { is_premium: true } }); globalThis.location.hash = '#billing';
  await h.run(); await tick();
  assert.match(h.root.innerHTML, /aria-selected="true"[^>]*data-tab="billing"|data-tab="billing"[^>]*aria-selected="true"/);
  assert.match(h.root.innerHTML, /No payments yet/);
  assert.ok(h.calls.some((c) => c[1] === '/payments/mine')); assert.ok(h.calls.some((c) => c[1] === '/community/member-benefits')); // Premium benefits are only fetched for Premium members
  const free = harness(); await free.run(); assert.equal(free.calls.some((c) => c[1] === '/community/member-benefits'), false);
  globalThis.location.hash = '#nonsense'; const bad = harness(); await bad.run(); assert.match(bad.root.innerHTML, /id="tab-overview"[^>]*aria-selected="true"/);
  globalThis.location.hash = '';
});
test('tabs follow the ARIA pattern: roles, roving tabindex and arrow-key navigation', async () => {
  const h = harness(); await h.run();
  assert.match(h.root.innerHTML, /role="tablist" aria-label="Dashboard sections"/); assert.match(h.root.innerHTML, /role="tabpanel" aria-labelledby="tab-overview"/);
  assert.equal((h.root.innerHTML.match(/role="tab"/g) || []).length, 6); assert.equal((h.root.innerHTML.match(/tabindex="-1"/g) || []).length, 5);
  const press = async (key, from) => { let prevented = false; h.root.onkeydown({ key, target: { closest: () => ({ dataset: { tab: from } }) }, preventDefault: () => { prevented = true; } }); await tick(); return prevented; };
  assert.equal(await press('ArrowRight', 'overview'), true); assert.match(h.root.innerHTML, /id="tab-library"[^>]*aria-selected="true"/);
  await press('ArrowLeft', 'overview'); assert.match(h.root.innerHTML, /id="tab-account"[^>]*aria-selected="true"/); // wraps around
  await press('Home', 'support'); assert.match(h.root.innerHTML, /id="tab-overview"[^>]*aria-selected="true"/);
  await press('End', 'support'); assert.match(h.root.innerHTML, /id="tab-account"[^>]*aria-selected="true"/);
  assert.equal(await press('x', 'overview'), false);
  assert.ok(h.events.length > 0 && h.events.every((u) => u === '/community' || /^#[a-z]+$/.test(u)));
});
test('actions call the right API endpoints and refresh the data', async () => {
  const h = harness({ data: { bookmarks: [{ post_id: 'p1', slug: 's', title: 'T' }], game_follows: [{ id: 'f1', game: 'PPSSPP' }], reading_history: [{ slug: 's', title: 'T' }] }, extra: { requests: [{ id: 'r1', title: 'Req', description: 'Desc', status: 'open' }] } });
  await h.run();
  const did = async (dataset, id) => { h.calls.length = 0; click(h.root, dataset, id); await tick(); await tick(); return h.calls.map((c) => `${c[0]} ${c[1]}`); };
  assert.deepEqual((await did({ removeBookmark: 'p1' })).slice(0, 2), ['DELETE /community/bookmarks/p1', 'GET /community/me']);
  assert.deepEqual((await did({ unfollow: 'f1' })).slice(0, 2), ['DELETE /community/follows/f1', 'GET /community/me']);
  assert.deepEqual((await did({}, 'clear-history'))[0], 'DELETE /community/history');
  assert.deepEqual((await did({}, 'delete-reader-data'))[0], 'DELETE /community/data');
  assert.deepEqual(await did({ vote: 'r1' }), ['POST /community/requests/r1/vote']);
  const out = await did({}, 'sign-out'); assert.equal(out[0], 'POST /auth/logout'); assert.deepEqual(h.calls.find((c) => c[0] === 'assign'), ['assign', '/']);
  globalThis.confirm = () => false; assert.deepEqual(await did({}, 'delete-reader-data'), []); // cancelled: nothing is deleted
});
test('a failed load shows a clear error with a retry link instead of a blank page', async () => {
  const h = harness(); const failing = { ...h, api: async () => { throw new Error('Session expired'); } };
  await renderDashboard({ root: h.root, api: failing.api, account: h.account, e });
  assert.match(h.root.innerHTML, /role="alert"/); assert.match(h.root.innerHTML, /We could not load your dashboard/); assert.match(h.root.innerHTML, /Session expired/); assert.match(h.root.innerHTML, /href="\/community"/);
});
test('the dashboard is wired in: signed-out prompt, /profile redirects, skeleton shell, nav links', () => {
  const gaming = read('public/gaming.js'); const routes = read('src/web/routes.js'); const app = read('public/app.js'); const templates = read('src/web/templates.js');
  assert.match(gaming, /import\('\/dashboard\.js'\)/); assert.match(gaming, /Sign in to open your dashboard/); assert.match(gaming, /setAttribute\('href','\/community'\)/);
  assert.doesNotMatch(gaming, /async function renderCommunity/);
  assert.match(routes, /router\.get\('\/profile',\(_req,res\)=>res\.redirect\(302,'\/community'\)\)/);
  assert.doesNotMatch(routes, /'\/reset-password','\/profile'/); // not served by the SPA shell any more
  assert.match(routes, /title:'My dashboard'[^]*noindex:true[^]*id=\\?"community-root\\?" aria-live=\\?"polite\\?" aria-busy=\\?"true\\?"/);
  assert.match(app, /function renderProfile\(\) \{ window\.location\.replace\('\/community'\); \}/);
  assert.match(templates, /\['\/community', 'Dashboard', \['\/community'\]\]/);
});
test('dashboard styles cover the structure in both themes and on phones', () => {
  const css = read('public/theme.css');
  for (const part of ['.dash-hero', '.dash-avatar', '.dash-stats', '.dash-tabs', '.dash-tab[aria-selected="true"]', '.dash-card', '.dash-badge-ok', '.dash-progress', '.dash-steps', '.dash-chip-list', '[data-theme="dark"] .dash-badge-ok']) assert.ok(css.includes(part), part);
  assert.match(css, /\.dash-tabs\{[^}]*overflow-x:auto/); assert.match(css, /\.dash-tab\{[^}]*min-height:44px/);
});

test('the dashboard page hides the marketing carousel; other pages keep it', async () => {
  const { layout } = await import('../src/web/templates.js');
  const base = { title: 'T', canonical: 'https://x.example/', image: '/a.jpg', body: '<p>hi</p>', social: [] };
  assert.equal(layout({ ...base, showSlideshow: false }).includes('data-etg-carousel'), false);
  assert.equal(layout(base).includes('data-etg-carousel'), true);
  assert.match(read('src/web/routes.js'), /title:'My dashboard',showSlideshow:false/);
  assert.match(layout({ ...base, showSlideshow: false }), /slideshow\.js/); // the shared scripts (browsing preferences, promotions) still load
});
test('the selected tab is scrolled into view and a finished checklist says so', async () => {
  assert.match(read('public/dashboard.js'), /strip\.scrollLeft = /);
  const done = harness({ account: { display_name: 'Ann', email: 'a@x.co', email_verified: true, access: { trial: {} } }, data: { device: { device: 'P', ram_gb: 4, emulator: 'x', emulator_version: '1' }, game_follows: [{ id: 'f', game: 'G' }], bookmarks: [{ post_id: 'p', slug: 's', title: 'T' }] } });
  await done.run(); assert.match(done.root.innerHTML, /You&#39;re all set|You're all set/);
  const fresh = harness(); await fresh.run(); assert.match(fresh.root.innerHTML, /Getting set up/); assert.match(fresh.root.innerHTML, /1 of 4 complete/);
});
