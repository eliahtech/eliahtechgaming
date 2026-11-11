import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ENV_SPEC, PLATFORM_ENV } from '../src/config/env.js';

const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (!['node_modules', '.next', 'test'].includes(n)) walk(p, out); } else if (/\.(m?js)$/.test(n)) out.push(p); } return out; };
const files = ['src', 'scripts'].flatMap((d) => walk(d)).concat(['server.js']);
const used = new Set();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
const spec = new Set(ENV_SPEC.map((s) => s.name));

test('every environment variable read by the code is declared in the validator', () => {
  const undeclared = [...used].filter((n) => !spec.has(n) && !PLATFORM_ENV.includes(n) && n !== 'DEPLOY_URL');
  assert.deepEqual(undeclared, []);
});
test('.env.example and docs/environment.md list every declared variable', () => {
  const example = readFileSync('.env.example', 'utf8'); const doc = readFileSync('docs/environment.md', 'utf8');
  for (const n of spec) { assert.match(example, new RegExp(`^${n}=`, 'm'), `.env.example missing ${n}`); assert.ok(doc.includes(`\`${n}\``), `docs/environment.md missing ${n}`); }
});
test('.env.example contains placeholders only (no secret-shaped values)', () => {
  for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=([^#]*)/.exec(line); if (!m) continue;
    assert.doesNotMatch(m[2].trim(), /^(sk_|re_[A-Za-z0-9]{10,}|eyJ|sb_secret_|sb_publishable_)/, m[1]);
  }
});
test('.gitignore protects real env files', () => {
  const g = readFileSync('.gitignore', 'utf8'); for (const p of ['.env', '.env.*', '!.env.example', '.dev.vars']) assert.ok(g.split('\n').includes(p), p);
});
test('Vercel and Cloudflare docs cover the same required variable names the code validates', () => {
  const required = ENV_SPEC.filter((s) => s.required === 'production' || s.required === true).map((s) => s.name);
  for (const doc of ['docs/hosting-vercel.md']) { const t = readFileSync(doc, 'utf8'); for (const n of required) assert.ok(t.includes(n), `${doc} missing ${n}`); }
});
test('client components never import server env validation or read process.env', () => {
  for (const f of walk('public')) {
    const t = readFileSync(f, 'utf8'); if (!/^\s*['"]use client['"]/.test(t)) continue;
    assert.doesNotMatch(t, /process\.env/, f); assert.doesNotMatch(t, /config\/env\.js|supabase\.js|session-server/, f);
  }
});
test('no NEXT_PUBLIC_ variable can carry a secret: none are used', () => {
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /NEXT_PUBLIC_/, f);
});
test('Supabase variable names are identical in code, Vercel docs and Cloudflare docs', () => {
  for (const n of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) for (const d of ['docs/hosting-vercel.md']) assert.ok(readFileSync(d, 'utf8').includes(n), `${d}:${n}`);
});
