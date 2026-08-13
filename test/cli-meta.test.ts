import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { delimiter, join, resolve, sep } from 'node:path';
import {
  formatVersionReport,
  formatUpgradeReport,
  resolvePackageJsonPath,
  readCurrentVersion,
  isRunningViaNpx,
  getNpmViewVersion,
  runUpgrade,
} from '../src/cli-meta.js';
import { tmpRepo } from './helpers.js';

// --- formatVersionReport: pure formatting, injected npm-view results (no network) ---

test('formatVersionReport: up to date', () => {
  const out = formatVersionReport('0.4.4', { ok: true, version: '0.4.4' });
  assert.equal(out, 'graft 0.4.4\nlatest on npm: 0.4.4 ✓ up to date');
});

test('formatVersionReport: newer version available', () => {
  const out = formatVersionReport('0.4.4', { ok: true, version: '0.4.5' });
  assert.equal(out, 'graft 0.4.4\nlatest on npm: 0.4.5 — run graft upgrade');
});

test('formatVersionReport: offline / unreachable', () => {
  const out = formatVersionReport('0.4.4', { ok: false });
  assert.equal(out, 'graft 0.4.4\nlatest: unreachable (offline?)');
});

// --- formatUpgradeReport: pure formatting, injected upgrade results (no network, no spawn) ---

test('formatUpgradeReport: npx no-op suggests a permanent install', () => {
  const out = formatUpgradeReport({ ran: false, ok: true, oldVersion: '0.4.4' });
  assert.match(out, /npx/);
  assert.match(out, /npm install -g @nanonets\/graft/);
});

test('formatUpgradeReport: successful upgrade shows old -> new', () => {
  const out = formatUpgradeReport({ ran: true, ok: true, oldVersion: '0.4.4', newVersion: '0.4.5' });
  assert.equal(out, 'graft 0.4.4 → 0.4.5');
});

test('formatUpgradeReport: failed install surfaces the error', () => {
  const out = formatUpgradeReport({ ran: true, ok: false, oldVersion: '0.4.4', errorMessage: 'ENOENT' });
  assert.match(out, /failed/);
  assert.match(out, /ENOENT/);
});

// --- resolvePackageJsonPath / readCurrentVersion: real filesystem, no network ---

test('resolvePackageJsonPath finds package.json one level above a dist/cli.js-shaped module path', () => {
  const fakeDistCli = pathToFileURL(resolve(process.cwd(), 'dist/cli.js')).href;
  const found = resolvePackageJsonPath(fakeDistCli);
  assert.equal(found, resolve(process.cwd(), 'package.json'));
});

test('resolvePackageJsonPath finds package.json one level above a src/cli.ts-shaped module path', () => {
  const fakeSrcCli = pathToFileURL(resolve(process.cwd(), 'src/cli.ts')).href;
  const found = resolvePackageJsonPath(fakeSrcCli);
  assert.equal(found, resolve(process.cwd(), 'package.json'));
});

test('readCurrentVersion reads the real package.json version', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  const v = readCurrentVersion(pathToFileURL(resolve(process.cwd(), 'src/cli.ts')).href);
  assert.equal(v, pkg.version);
});

// --- isRunningViaNpx: pure path heuristic ---
//
// Built with `join` rather than a `/`-separated literal so the path carries the
// platform separator: `fileURLToPath` hands back `…\_npx\…` on Windows, where the
// original `includes("/_npx/")` was always false and `graft upgrade` would have run
// `npm install -g` on top of an npx invocation. On posix this is the identity case.

test('isRunningViaNpx detects an npx cache path', () => {
  const npxPath = pathToFileURL(
    join(sep, 'Users', 'x', '.npm', '_npx', 'abc123', 'node_modules', '@nanonets', 'graft', 'dist', 'cli.js'),
  ).href;
  assert.equal(isRunningViaNpx(npxPath), true);
});

test('isRunningViaNpx is false for a regular global install', () => {
  const globalPath = pathToFileURL(
    join(sep, 'usr', 'local', 'lib', 'node_modules', '@nanonets', 'graft', 'dist', 'cli.js'),
  ).href;
  assert.equal(isRunningViaNpx(globalPath), false);
});

// --- the npm invocation itself: a stub `npm` on PATH, no registry, no install ---
//
// These are the tests that were missing while every npm-shaped feature was dead on
// Windows: the file only ever exercised the pure formatters with injected results,
// so nothing noticed that the results could never be anything but `{ ok: false }`
// there. `npm` ships as `npm.cmd` on Windows and `spawnSync` only ever appends
// `.exe`, so the un-shelled call failed with ENOENT before touching the network.
//
// The stub is installed under the real name `npm` at the FRONT of PATH, so this
// exercises exactly the lookup the product code does. On posix it is a `sh` script
// and these pass with or without the fix; on Windows it is the `.cmd` shim that
// reproduces the bug, which is why CI runs a windows-latest leg.

/** A directory containing a fake `npm` that answers `view` and nothing else. */
function stubNpmDir(version: string): string {
  const dir = tmpRepo('npm-stub');
  if (process.platform === 'win32') {
    // `exit /b 0` explicitly: a batch file's exit code is otherwise whatever the
    // last command left behind, which would make the assertions depend on `echo`.
    writeFileSync(join(dir, 'npm.cmd'), `@echo off\r\nif "%1"=="view" echo ${version}\r\nexit /b 0\r\n`);
  } else {
    const p = join(dir, 'npm');
    writeFileSync(p, `#!/bin/sh\nif [ "$1" = "view" ]; then echo ${version}; fi\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

/** Run `fn` with `dir` prepended to PATH, restoring it afterwards. */
function withPath<T>(dir: string, fn: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${saved ?? ''}`;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
}

test('getNpmViewVersion actually reaches npm (Windows: through the .cmd shim)', () => {
  const r = withPath(stubNpmDir('9.9.9'), () => getNpmViewVersion('@nanonets/graft', 30_000));
  assert.deepEqual(r, { ok: true, version: '9.9.9' });
});

test('getNpmViewVersion still reports {ok:false} when npm is genuinely absent', () => {
  // The intended offline answer, and the one the ENOENT bug was masquerading as:
  // an EMPTY PATH must degrade to `{ok:false}`, not throw and not hang.
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.deepEqual(getNpmViewVersion('@nanonets/graft', 30_000), { ok: false });
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
});

test('runUpgrade reports success when npm install -g succeeds', () => {
  // The stub answers `install` with a plain exit 0 and `root -g` with nothing, so
  // the new version falls through to the `view` answer — no global install happens.
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'src/cli.ts')).href;
  const r = withPath(stubNpmDir('9.9.9'), () => runUpgrade(moduleUrl));
  assert.equal(r.ran, true);
  assert.equal(r.ok, true, `upgrade failed: ${r.errorMessage}`);
  assert.equal(r.newVersion, '9.9.9');
});
