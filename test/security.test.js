import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrub, audit } from '../src/audit.js';
import { cspHeaderValue, cspDirectives } from '../src/csp.js';
import { normalizeEmail, passwordProblem, cleanDisplayName, isUuid } from '../src/validate.js';

test('audit metadata never carries secrets', () => {
  const out = scrub({ email: 'a@b.co', password: 'hunter2', nested: { access_token: 'T', apiKey: 'K', note: 'ok' }, Authorization: 'Bearer x', list: [{ session: 's' }] });
  const text = JSON.stringify(out);
  for (const secret of ['hunter2', '"T"', '"K"', 'Bearer x', '"s"']) assert.equal(text.includes(secret), false, secret);
  assert.equal(out.nested.note, 'ok');
});

test('audit failures are logged, not thrown, and never leave secrets in the log', async () => {
  const lines = []; const log = console.error; console.error = (l) => lines.push(l);
  try {
    await audit({ insert: async () => { throw Object.assign(new Error('boom'), { code: 'DATABASE_ERROR' }); } }, { action: 'x', metadata: { password: 'p' } });
  } finally { console.error = log; }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('"p"'), false);
});

test('input validators', () => {
  assert.equal(normalizeEmail(' A@B.CO '), 'a@b.co');
  assert.equal(normalizeEmail('a@b'), null);
  assert.equal(normalizeEmail(['a@b.co']), null);
  assert.match(passwordProblem('short'), /8 characters/);
  assert.match(passwordProblem('é'.repeat(40)), /72/);
  assert.equal(passwordProblem('correct horse battery'), null);
  assert.equal(cleanDisplayName('  <b>Ann</b>  '), 'Ann');
  assert.equal(cleanDisplayName('A'), null);
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isUuid('x),role.eq.admin'), false);
});

test('Express owns CSP and Vercel routes all pages to the same backend',()=>{
 const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(vercel.framework,null);assert.equal(vercel.functions['api/index.js'].maxDuration,60);
 assert.equal(vercel.rewrites[0].destination,'/api/index');
 assert.ok(cspHeaderValue().startsWith("default-src 'self'"));assert.deepEqual(cspDirectives.objectSrc,["'none'"]);
 assert.equal(cspDirectives.scriptSrc.includes("'unsafe-inline'"),false);
});

test('the service-role key is only referenced in server code', () => {
  for (const file of ['../public/app.js', '../public/content.js']) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /SERVICE_ROLE|service_role/);
});

test('migration closes the privilege-escalation holes', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261001_security_foundation.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke update on public\.profiles from anon, authenticated/);
  assert.match(sql, /grant update \(display_name, avatar_url\)/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /grant execute on function public\.rate_limit_hit[^;]+to service_role/);
});
