/**
 * The shim's resolution behaviour, exercised by actually running it.
 *
 * This is the regression test for the "installed graft once, still on the old
 * version" report: the shim used to take the FIRST candidate that existed, and
 * the first candidate is the absolute path baked in at `graft init` time. So
 * `npm i -g @nanonets/graft@latest` upgraded a directory the shim never looked
 * at, and the user's hooks kept loading whatever version wired the repo. The
 * shim now takes the highest-versioned candidate instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hooksShim } from '../src/claude/shim-template.js';
import { tmpRepo } from './helpers.js';

/** A fake installed @nanonets/graft whose hooks entry records that it ran. */
function fakeInstall(root: string, name: string, version: string): string {
  const pkg = join(root, name);
  const distClaude = join(pkg, 'dist', 'claude');
  mkdirSync(distClaude, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@nanonets/graft', version }));
  // CJS on purpose: no "type" field, so `import()` hands back module.exports and
  // `m.main(...)` resolves — same shape the real dist has for the shim's call.
  writeFileSync(
    join(distClaude, 'hooks.js'),
    `module.exports.main = () => require('node:fs').writeFileSync(process.env.MARKER, ${JSON.stringify(version)});\n`,
  );
  return distClaude;
}

/** Pre-answers `npm root -g` in the scratch home, so no case pays for the spawn. */
function seedNpmRoot(home: string, root: string): void {
  mkdirSync(join(home, '.graft'), { recursive: true });
  writeFileSync(join(home, '.graft', 'npm-root.json'), JSON.stringify({ root, at: Date.now() }));
}

/** An `npm` on PATH whose `root -g` prints `root`, to exercise the real query. */
function fakeNpm(dir: string, root: string): string {
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') writeFileSync(join(dir, 'npm.cmd'), `@echo off\r\necho ${root}\r\n`);
  else writeFileSync(join(dir, 'npm'), `#!/bin/sh\necho "${root}"\n`, { mode: 0o755 });
  return dir;
}

/**
 * Runs the shim with the given baked dir and project dir; returns the version
 * of the install that actually got loaded (or null if none did).
 *
 * HOME/USERPROFILE point at a scratch dir and the `npm root -g` answer is seeded
 * there, so the global candidate is exactly what the case says it is — never this
 * machine's real global install (which would otherwise decide these assertions),
 * and never a 0.5s npm spawn per case. `npmRoot`/`fakeNpm` override that.
 */
function runShim(
  root: string,
  bakedDir: string,
  projectDir: string,
  opts: { npmRoot?: string; fakeNpm?: string } = {},
): string | null {
  const shimPath = join(root, 'graft-hooks.cjs');
  const marker = join(root, 'loaded.txt');
  const home = join(root, 'home');
  writeFileSync(shimPath, hooksShim(bakedDir));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, MARKER: marker, CLAUDE_PROJECT_DIR: projectDir };
  if (opts.fakeNpm) {
    // Windows spells it `Path`; leaving both spellings in the child env is a coin flip.
    const prior = env.PATH ?? '';
    for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
    env.PATH = `${opts.fakeNpm}${delimiter}${prior}`;
  } else {
    seedNpmRoot(home, opts.npmRoot ?? join(root, 'no-global-install'));
  }
  const res = spawnSync(process.execPath, [shimPath, 'session-start'], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `shim exited ${res.status}: ${res.stderr}`);
  return existsSync(marker) ? readFileSync(marker, 'utf8') : null;
}

test('an upgraded global install wins over the stale baked path', () => {
  const root = tmpRepo('shim-upgrade');
  const stale = fakeInstall(root, 'old-node-install', '0.9.1');
  fakeInstall(join(root, 'project', 'node_modules', '@nanonets'), 'graft', '0.11.0');
  // BAKED points at the install that `graft init` ran from — still on disk (an
  // nvm switch leaves it there), still first in the candidate list, now stale.
  assert.equal(runShim(root, stale, join(root, 'project')), '0.11.0');
});

test('the baked path still wins when it is the newest', () => {
  const root = tmpRepo('shim-baked-newest');
  const baked = fakeInstall(root, 'current', '0.11.0');
  fakeInstall(join(root, 'project', 'node_modules', '@nanonets'), 'graft', '0.9.1');
  assert.equal(runShim(root, baked, join(root, 'project')), '0.11.0');
});

test('a single candidate is used whatever its version', () => {
  const root = tmpRepo('shim-single');
  const only = fakeInstall(root, 'only', '0.9.1');
  mkdirSync(join(root, 'project'), { recursive: true });
  assert.equal(runShim(root, only, join(root, 'project')), '0.9.1');
});

test('an install with an unreadable version loses to a known one', () => {
  const root = tmpRepo('shim-noversion');
  const broken = fakeInstall(root, 'broken', '0.0.0');
  writeFileSync(join(root, 'broken', 'package.json'), 'not json');
  fakeInstall(join(root, 'project', 'node_modules', '@nanonets'), 'graft', '0.9.1');
  assert.equal(runShim(root, broken, join(root, 'project')), '0.9.1');
});

test('a newer install in the global root wins over an existing baked path', () => {
  // The regression 0.11.0's version comparison was supposed to fix, but did not:
  // `entry()` returned on the first cheap candidate that existed, and BAKED almost
  // always exists — so `npm root -g`, the only candidate that finds a Windows
  // global install (%APPDATA%\npm\node_modules), never entered the comparison and
  // `npm i -g @nanonets/graft@latest` still changed nothing.
  const root = tmpRepo('shim-globalroot');
  const stale = fakeInstall(root, 'baked', '0.9.1');
  const globalRoot = join(root, 'global-node-modules');
  fakeInstall(join(globalRoot, '@nanonets'), 'graft', '0.11.0');
  mkdirSync(join(root, 'project'), { recursive: true });
  assert.equal(runShim(root, stale, join(root, 'project'), { npmRoot: globalRoot }), '0.11.0');
});

test('the global root is queried from npm and the answer cached under the user home', () => {
  const root = tmpRepo('shim-npmquery');
  const stale = fakeInstall(root, 'baked', '0.9.1');
  const globalRoot = join(root, 'global-node-modules');
  fakeInstall(join(globalRoot, '@nanonets'), 'graft', '0.11.0');
  mkdirSync(join(root, 'project'), { recursive: true });

  const loaded = runShim(root, stale, join(root, 'project'), { fakeNpm: fakeNpm(join(root, 'bin'), globalRoot) });
  assert.equal(loaded, '0.11.0');
  // Cached, not re-asked: this file runs on every hook and every statusline render.
  const cache = JSON.parse(readFileSync(join(root, 'home', '.graft', 'npm-root.json'), 'utf8'));
  assert.equal(cache.root, globalRoot);
  assert.ok(typeof cache.at === 'number');
});

test('a baked path relative to the project dir resolves against it', () => {
  // What graft's own checkout commits: BAKED = 'dist/claude', identical on every
  // machine, instead of the absolute path of whoever last ran `graft init`.
  const root = tmpRepo('shim-relative');
  // fakeInstall's layout IS a checkout's: <project>/package.json + <project>/dist/claude.
  fakeInstall(root, 'project', '0.12.0');
  fakeInstall(join(root, 'project', 'node_modules', '@nanonets'), 'graft', '0.9.1');
  assert.equal(runShim(root, 'dist/claude', join(root, 'project')), '0.12.0');
});

test('no candidate at all exits quietly — a hook must never fail the session', () => {
  const root = tmpRepo('shim-none');
  mkdirSync(join(root, 'project'), { recursive: true });
  assert.equal(runShim(root, join(root, 'nowhere'), join(root, 'project')), null);
});
