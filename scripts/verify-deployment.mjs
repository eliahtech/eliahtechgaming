// Real HTTP verification of a DEPLOYED platform. Usage: DEPLOY_URL=https://... npm run verify:deployment -- --platform vercel|cloudflare
// A bare HTTP 200 is not accepted: the page must contain the application marker and APIs must behave like the app.
const url = process.env.DEPLOY_URL; const platform = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : 'unknown';
if (!url) { console.log(JSON.stringify({ platform, status: 'NOT VERIFIED', reason: 'DEPLOY_URL not set; no deployment was contacted' })); process.exit(2); }
const base = new URL(url); const results = [];
const rec = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const get = async (path, init = {}) => { let u = new URL(path, base).href; for (let i = 0; i < 5; i++) { const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init }); if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).href; continue; } return res; } throw new Error('redirect loop'); };
try {
  rec('HTTPS', base.protocol === 'https:');
  const home = await get('/'); const html = await home.text();
  rec('homepage status 200', home.status === 200, String(home.status));
  rec('homepage content-type html', /text\/html/.test(home.headers.get('content-type') || ''));
  rec('homepage application marker', /Eliah\s*Tech/i.test(html) && /id="main"/.test(html) && !/Application error|This page could not be found/i.test(html));
  const h = await get('/api/v1/health/supabase'); const hb = await h.json().catch(() => null);
  rec('health endpoint shape', hb && ['status', 'service', 'database'].every((k) => k in hb) && !('checks' in hb) && !/supabase\.co|sb_|eyJ/.test(JSON.stringify(hb)), `database=${hb?.database}`);
  rec('Supabase reachable from deployed runtime', h.status === 200 && hb?.database === 'connected', `database=${hb?.database}`);
  if (process.env.HEALTH_DIAGNOSTICS_TOKEN) { const d = await (await get('/api/v1/health/supabase', { headers: { authorization: `Bearer ${process.env.HEALTH_DIAGNOSTICS_TOKEN}` } })).json().catch(() => null); rec('detailed diagnostics (authorized)', d?.status === 'ok', Object.entries(d?.checks || {}).map(([k, v]) => `${k}:${v.status}`).join(' ')); }
  const s = await (await get('/api/session')).json().catch(() => null); rec('anonymous session endpoint', s?.data?.authenticated === false);
  const a = await get('/api/v1/admin/posts'); rec('admin API rejects anonymous', [401, 403].includes(a.status), String(a.status));
  const api = await get('/api/v1/health'); const ab = await api.json().catch(() => null); rec('API route reachable', api.status === 200 && ab?.success === true);
  const lg = await get('/api/v1/auth/login', { method: 'POST',headers:{'Content-Type':'application/json'},body:'{}' }); rec('login validates missing credentials', [422,503].includes(lg.status), String(lg.status));
} catch (e) { rec('deployment reachable', false, e.message.replace(/https?:\/\/\S+/g, '<url>')); }
const failed = results.some((r) => r.status === 'FAIL');
console.log(JSON.stringify({ platform, status: failed ? 'FAIL' : 'PASS', checks: results.length }));
process.exit(failed ? 1 : 0);
