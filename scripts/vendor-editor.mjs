// Copies the Jodit editor into public/vendor/jodit so the admin dashboard never runs third-party code from a CDN.
// Usage: npm run vendor            (downloads the latest Jodit 4.x with `npm pack`)
//        JODIT_VERSION=4.2.1 npm run vendor   (pin an exact version; recommended)
// Commit public/vendor afterwards. The script prints the version and SHA-384 digests for your records.
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const spec = `jodit@${process.env.JODIT_VERSION || '4.18.10'}`;
const work = mkdtempSync(path.join(tmpdir(), 'jodit-'));
const run = (cmd, args, cwd) => {
  const isWin = process.platform === 'win32';
  const r = isWin && cmd === 'npm'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd, encoding: 'utf8' })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  return r.stdout.trim();
};
try {
  const tarball = run('npm', ['pack', spec, '--silent'], work).split('\n').pop();
  run('tar', ['-xzf', tarball], work);
  const pkgDir = path.join(work, 'package');
  const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const out = path.join(process.cwd(), 'public', 'vendor', 'jodit');
  mkdirSync(out, { recursive: true });
  const manifest = { version, files: {} };
  for (const name of ['jodit.min.js', 'jodit.min.css']) {
    const from = path.join(pkgDir, 'es2021', name);
    if (!existsSync(from)) { console.error(`Missing ${from}; the package layout changed.`); process.exit(1); }
    copyFileSync(from, path.join(out, name));
    manifest.files[name] = `sha384-${createHash('sha384').update(readFileSync(from)).digest('base64')}`;
  }
  const license = readdirSync(pkgDir).find((f) => /^licen[cs]e/i.test(f));
  if (license) copyFileSync(path.join(pkgDir, license), path.join(out, 'LICENSE.txt'));
  writeFileSync(path.join(out, 'VERSION.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Jodit ${version} copied to public/vendor/jodit`, manifest.files);
} finally { rmSync(work, { recursive: true, force: true }); }
