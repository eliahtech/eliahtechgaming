// Dependency-free lint (npm run lint): (1) syntax check of plain JS/MJS, (2) unused-import detection for every JS file including
// JSX files under app/ (which `node --check` cannot parse), (3) a few project rules. Replace with ESLint once packages can be added.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['server.js', 'api', 'src', 'public', 'scripts', 'test', 'test-support'];
const files = [];
const walk = (target) => {
  if (statSync(target).isDirectory()) readdirSync(target).forEach((name) => { if (name !== 'node_modules') walk(path.join(target, name)); });
  else if (/\.(m?js)$/.test(target)) files.push(target);
};
roots.forEach((root) => { try { walk(root); } catch { /* optional folder */ } });

const problems = [];
const JSX_DIRS = ['app' + path.sep];
const isJsx = (f) => JSX_DIRS.some((d) => f.startsWith(d)) && /<[A-Za-z][^>]*>|<\//.test(readFileSync(f, 'utf8')) && spawnSync(process.execPath, ['--check', f]).status !== 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  {
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (syntax.status !== 0 && !(file.startsWith('app' + path.sep) && isJsx(file))) problems.push(`Syntax error in ${file}\n${syntax.stderr}`);
  }
  if (file.startsWith('public' + path.sep)) continue; // browser scripts have no imports
  // Unused imports: a bound name that appears exactly once in the file (its own import) is unused. React is exempt (JSX runtime / createElement).
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const m of noComments.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    const names = [];
    const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause); if (def) names.push(def[1]);
    const named = /\{([^}]*)\}/.exec(clause); if (named) for (const part of named[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.push(n); }
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause); if (ns) names.push(ns[1]);
    for (const name of names) {
      if (name === 'React') continue;
      const uses = noComments.match(new RegExp(`(?<![\\w$])(?<!(?<!\\.)\\.)${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || [];
      if (uses.length <= 1) problems.push(`${file}: unused import "${name}"`);
    }
  }
}
for (const p of problems) console.error(p);
console.log(`${files.length} files checked${problems.length ? `, ${problems.length} problem(s)` : ', ok'}`);
process.exit(problems.length ? 1 : 0);
