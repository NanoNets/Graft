// Generates the tiny `.cjs` shims committed into a repo's `.claude/helpers/`. Their only
// job is to locate the installed `@nanonets/graft` package's `dist/claude/<entry>.js` and
// call into it — so the real logic lives in the package and upgrades with it.
//
// Resolution order (first hit wins), designed so a global install works regardless of how
// Node was installed (Homebrew/Windows/volta all shipped broken before this):
//   1. `bakedDir`   — the absolute `dist/claude` graft was running from at init time.
//                     Correct with zero guesswork for whoever ran `graft init`.
//   2. repo node_modules — a local dev-dep install.
//   3. `execDir/../lib`  — the cheap legacy guess (covers nvm / classic prefix layout).
//   4. `npm root -g`     — authoritative global dir, layout-agnostic. Only shelled out to
//                     when 1–3 miss (the baked path hits first for the installer), so it's
//                     rarely reached; queried on demand — no on-disk cache, which on a
//                     shared machine would be a world-writable path an attacker could point
//                     at their own code for us to import.
function shim(entryFile: string, call: string, bakedDir: string): string {
  return `#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const BAKED = ${JSON.stringify(bakedDir)};

// The dist/claude dir of @nanonets/graft resolved from a base whose node_modules is searched.
function fromPkg(base) {
  try {
    const pkg = require.resolve('@nanonets/graft/package.json', { paths: [base] });
    return path.join(path.dirname(pkg), 'dist', 'claude');
  } catch { return null; }
}

// The global node_modules dir per npm (handles Homebrew/Windows/volta). Queried on demand.
function globalRoot() {
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim();
    return root || null;
  } catch { return null; /* npm unavailable */ }
}

function candidates() {
  const out = [];
  if (BAKED) out.push(BAKED);
  const local = fromPkg(dir); if (local) out.push(local);
  const legacy = fromPkg(path.join(path.dirname(process.execPath), '..', 'lib')); if (legacy) out.push(legacy);
  const gr = globalRoot(); if (gr) out.push(path.join(gr, '@nanonets', 'graft', 'dist', 'claude'));
  return out;
}

function entry(name) {
  for (const d of candidates()) {
    const f = path.join(d, name);
    if (fs.existsSync(f)) return f;
  }
  return path.join(dir, 'dist', 'claude', name); // last-ditch; import will no-op if absent
}

import(pathToFileURL(entry(${JSON.stringify(entryFile)})).href).then((m) => ${call}).catch(() => { /* graft unavailable — no-op */ });
`;
}

export function statuslineShim(bakedDir: string): string { return shim('statusline.js', 'm.main()', bakedDir); }
export function hooksShim(bakedDir: string): string { return shim('hooks.js', 'm.main(process.argv[2])', bakedDir); }
