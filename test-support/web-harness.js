// Calls the real web routes without opening a socket: the Express router's route table is walked directly and each handler is
// run with a minimal request/response. Works with the real `express` package (used in CI) and needs no supertest.
import { createWebRouter, createNotFoundHandler } from '../src/web/routes.js';
import { fileURLToPath } from 'node:url';

const toRegex = (pattern) => {
  const names = [];
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]+)/g, (_m, name) => { names.push(name); return '([^/]+?)'; }).replace(/\*/g, '(.*)');
  return { names, regex: new RegExp(`^${source}$`) };
};
function match(layer, method, pathname) {
  const route = layer.route; if (!route || !(route.methods?.[method] ?? true)) return null;
  for (const pattern of [].concat(route.path)) {
    if (typeof pattern !== 'string') continue;
    const { names, regex } = toRegex(pattern); const m = regex.exec(pathname);
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
function fakeResponse(req) {
  const res = { statusCode: 200, headers: {}, body: '', req, finished: false, redirectedTo: null };
  const done = (body) => { res.body = typeof body === 'string' ? body : JSON.stringify(body); res.finished = true; return res; };
  Object.assign(res, {
    set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) res.headers[a.toLowerCase()] = b; else res.headers[String(k).toLowerCase()] = String(v); return res; },
    setHeader(k, v) { return res.set(k, v); }, vary() { return res; },
    type(t) { res.headers['content-type'] = { html: 'text/html; charset=utf-8', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json' }[t] || t; return res; },
    status(c) { res.statusCode = c; return res; }, sendStatus(c) { res.statusCode = c; return done(String(c)); },
    send: done, json(o) { res.headers['content-type'] = 'application/json'; return done(o); },
    redirect(c, u) { res.statusCode = c; res.redirectedTo = u; return done(''); },
  });
  return res;
}
export async function call(router, path, { method = 'get', cookie = '', accept = 'text/html', query = {} } = {}) {
  const url = new URL(path, 'https://local.test'); const q = { ...Object.fromEntries(url.searchParams), ...query };
  for (const layer of router.stack) {
    const hit = match(layer, method, url.pathname); if (!hit) continue;
    const req = { path: url.pathname, query: q, params: hit.params, headers: { cookie, accept }, user: null, originalUrl: path, method: method.toUpperCase(), ip: '203.0.113.9', accepts: (type) => (new RegExp(type, 'i').test(accept) ? type : false) };
    const res = fakeResponse(req);
    for (const { handle } of hit.route.stack) {
      await new Promise((resolve, reject) => { try { Promise.resolve(handle(req, res, (err) => (err ? reject(err) : resolve()))).then(() => resolve(), reject); } catch (error) { reject(error); } });
      if (res.finished) break;
    }
    return res;
  }
  return null; // no route matched
}
export const html = (res) => res.body;
export const attr = (page, re) => (page.match(re) || [])[1];
export const sampleRepo = (overrides = {}) => {
  const post = { id: 'p1', slug: 'best-ppsspp-settings', title: 'Best PPSSPP settings for smooth gameplay', excerpt: 'Fix lag and boost the frame rate on any Android phone.', featured_image: 'https://cdn.example/cover.jpg', featured_image_alt: 'PPSSPP running on a phone', category: { slug: 'android-tips', name: 'Android Tips' }, tags: [{ name: 'ppsspp' }, 'lag'], author: 'Eliah', published_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-05T09:30:00Z', reading_time: 4, content: '<p>BODY_SENTINEL</p>', is_premium: false };
  const plainPost = { ...post, id: 'p2', slug: 'second-guide', title: 'Second guide', featured_image: '/assets/gaming-cover.jpg', tags: [] };
  return {
    post, plainPost,
    getPublicSetting: async () => null, getPublicSite: async () => ({ description: 'Guides for gamers & more' }),
    listSocialLinks: async () => [{ platform: 'X', url: 'https://x.com/eliahtech' }, { platform: 'YouTube', url: 'https://youtube.com/@eliah' }],
    listPostsPage: async () => ({ items: [post, plainPost], meta: { total: 2, has_more: false } }),
    listCategories: async () => [{ slug: 'android-tips', name: 'Android Tips', description: 'Fix lag, install games and tune <b>Android</b> phones for smoother play.' }, { slug: 'psp-games', name: 'PSP Games', description: '' }],
    listGameHubs: async () => [{ slug: 'efootball', name: 'eFootball', summary: 'Updates and settings for eFootball.', updated_at: '2026-10-10T00:00:00Z' }],
    listPostSlugs: async () => [{ slug: 'best-ppsspp-settings', updated_at: '2026-10-05T09:30:00Z', published_at: '2026-10-01T08:00:00Z', featured_image_url: 'https://cdn.example/cover.jpg' }, { slug: 'second-guide', updated_at: null, published_at: '2026-09-01T00:00:00Z', featured_image_url: '/assets/gaming-cover.jpg' }, { slug: 'with space & more', updated_at: 'not a date', featured_image_url: null }],
    getPost: async (_db, slug) => (slug === post.slug ? post : null), listPosts: async () => [], listPostUpdates: async () => [], nextGuides: async () => [],
    ...overrides,
  };
}
export function makeSite({ repo = sampleRepo(), siteVerification, total = 2500 } = {}) {
  const db = { select: async () => [], selectPage: async () => ({ rows: [], total }), rpc: async () => null };
  const options = { db, repo, auth: null, optionalAuth: (_q, _s, n) => n(), requireAdmin: (_q, _s, n) => n(), appUrl: 'https://gaming.example', publicDir: fileURLToPath(new URL('../public', import.meta.url)), siteVerification };
  return { router: createWebRouter(options), notFound: createNotFoundHandler(options), repo };
}
export async function callNotFound(site, path, { accept = 'text/html' } = {}) {
  const req = { path, headers: { accept }, accepts: (t) => (new RegExp(t, 'i').test(accept) ? t : false) };
  const res = fakeResponse(req); await site.notFound(req, res); return res;
}
