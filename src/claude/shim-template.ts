// Generates the tiny `.cjs` shims committed into a repo's `.claude/helpers/`. Their only
// job is to locate the installed `@nanonets/graft` package's `dist/claude/<entry>.js` and
// call into it — so the real logic lives in the package and upgrades with it.
//
// Candidates, all four compared against each other:
//   1. `BAKED`      — the `dist/claude` graft was running from at init time. Absolute for a
//                     normal install; RELATIVE when it sits inside the repo being wired (see
//                     `bakedRef` in init.ts), so graft's own checkout stops committing a shim
//                     with one developer's home directory in it.
//   2. repo node_modules — a local dev-dep install.
//   3. `execDir/../lib`  — the cheap legacy guess (nvm / classic posix prefix).
//   4. `npm root -g`     — authoritative global dir, layout-agnostic, and on Windows the only
//                     one that finds anything at all: a global install lands in
//                     `%APPDATA%\npm\node_modules`, and candidate 3 resolves to
//                     `C:\Program Files\lib`, which does not exist.
//
// Among the candidates that exist we take the HIGHEST VERSION, not the first hit. First-hit
// silently pinned users to a stale graft forever: `BAKED` points into one Node install's
// global node_modules, so switching Node versions (nvm/volta) or moving the install leaves
// the old directory on disk and still winning, and `npm i -g @nanonets/graft@latest`
// upgrades a directory the shim never looks at. The upgrade appeared to work and changed
// nothing — the shim kept loading the version from whenever `graft init` was last run.
//
// Candidate 4 has to be IN that comparison, not a fallback behind it. It used to be reached
// only when 1–3 all missed, and `BAKED` almost always exists — so the authoritative global
// directory was in practice never consulted, and the "upgrade changes nothing" bug survived
// the fix that was supposed to kill it, most visibly on Windows where 3 never resolves.
function shim(entryFile: string, call: string, bakedDir: string): string {
  return `#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Relative when graft's dist lives inside this repo; path.resolve leaves an absolute one be.
const BAKED = ${JSON.stringify(bakedDir)};
const bakedDir = BAKED ? path.resolve(dir, BAKED) : null;

// The dist/claude dir of @nanonets/graft resolved from a base whose node_modules is searched.
function fromPkg(base) {
  try {
    const pkg = require.resolve('@nanonets/graft/package.json', { paths: [base] });
    return path.join(path.dirname(pkg), 'dist', 'claude');
  } catch { return null; }
}

// The global node_modules dir per npm (handles Homebrew/Windows/volta).
//
// Asking npm costs a subprocess (~0.5s), and this file runs on every hook and every
// statusline render, so the answer is cached for a day. Under the user's own ~/.graft,
// beside graft's update check — NOT a world-writable path like /tmp, where a co-tenant
// on a shared machine could point the cache at their own code for us to import.
const ROOT_TTL_MS = 24 * 60 * 60 * 1000;
function globalRoot() {
  const cache = path.join(os.homedir(), '.graft', 'npm-root.json');
  try {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (typeof c.at === 'number' && Date.now() - c.at < ROOT_TTL_MS) return c.root || null;
  } catch { /* no cache yet, or unreadable — ask npm */ }
  let root = null;
  try {
    root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim() || null;
  } catch { /* npm unavailable */ }
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ root: root, at: Date.now() }));
  } catch { /* unwritable home — just pay the spawn again next time */ }
  return root;
}

// The version of the package a dist/claude dir belongs to, or null if unreadable.
function versionOf(distClaude) {
  try {
    return JSON.parse(fs.readFileSync(path.join(distClaude, '..', '..', 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

// Numeric-dotted compare of the release part; an unreadable version loses to any known one.
function newer(a, b) {
  if (!a) return false;
  if (!b) return true;
  const p = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);
  const pa = p(a), pb = p(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// The highest-versioned dir in \`dirs\` that actually contains \`name\`, or null.
function best(dirs, name) {
  let bestDir = null, bestVer = null;
  for (const d of dirs) {
    if (!d || !fs.existsSync(path.join(d, name))) continue;
    const v = versionOf(d);
    if (bestDir === null || newer(v, bestVer)) { bestDir = d; bestVer = v; }
  }
  return bestDir;
}

function entry(name) {
  const gr = globalRoot();
  const hit = best([
    bakedDir,
    fromPkg(dir),
    fromPkg(path.join(path.dirname(process.execPath), '..', 'lib')),
    gr && path.join(gr, '@nanonets', 'graft', 'dist', 'claude'),
  ], name);
  if (hit) return path.join(hit, name);
  return path.join(dir, 'dist', 'claude', name); // last-ditch; import will no-op if absent
}

import(pathToFileURL(entry(${JSON.stringify(entryFile)})).href).then((m) => ${call}).catch(() => { /* graft unavailable — no-op */ });
`;
}

export function statuslineShim(bakedDir: string): string { return shim('statusline.js', 'm.main()', bakedDir); }
export function hooksShim(bakedDir: string): string { return shim('hooks.js', 'm.main(process.argv[2])', bakedDir); }
