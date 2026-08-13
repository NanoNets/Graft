#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Relative when graft's dist lives inside this repo; path.resolve leaves an absolute one be.
const BAKED = "dist/claude";
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

// The highest-versioned dir in `dirs` that actually contains `name`, or null.
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

import(pathToFileURL(entry("hooks.js")).href).then((m) => m.main(process.argv[2])).catch(() => { /* graft unavailable — no-op */ });
