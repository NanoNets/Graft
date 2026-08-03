import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCodexHooks } from '../src/hosts/codex-hooks.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-cxhooks-')); }

/**
 * Windows has no POSIX exec bit — `statSync().mode & 0o111` is always 0 there, and
 * `chmod` cannot strip a bit the filesystem doesn't have. So assert the property
 * that exists on both platforms (the shim is installed where the hook config points)
 * and check the mode only where there is one. Skipping the whole test instead would
 * drop Windows coverage of the install path, which is the part that can actually
 * break.
 */
const HAS_EXEC_BIT = process.platform !== 'win32';

function assertRunnableShim(shim: string, note: string): void {
  assert.ok(existsSync(shim), `${note}: shim missing at ${shim}`);
  if (HAS_EXEC_BIT) assert.ok(statSync(shim).mode & 0o111, note);
}

test('no-op when the CLI home dir is absent', () => {
  assert.deepEqual(installCodexHooks(fresh()), []);
});

test('writes shim + hooks.json entry, idempotent on re-run', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const w = installCodexHooks(home);
  assert.equal(w.length, 2);
  const shim = join(home, '.codex', 'hooks', 'graft', 'graft-hooks.cjs');
  assertRunnableShim(shim, 'shim is executable');
  const cfg = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'));
  const entries = cfg.hooks.PostToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Write|Edit|MultiEdit');
  assert.match(entries[0].hooks[0].command, /post-edit-sync/);
  const again = installCodexHooks(home);
  assert.deepEqual(again.map((x) => x.action), ['unchanged', 'unchanged']);
  assert.equal(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.PostToolUse.length, 1);
});

test('foreign hook entries are preserved; stale graft entries replaced', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
    hooks: { PostToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] },
      { matcher: 'Write', hooks: [{ type: 'command', command: 'node /old/graft-hooks.cjs post-edit' }] },
    ] },
  }));
  installCodexHooks(home);
  const entries = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.PostToolUse;
  assert.equal(entries.length, 2, 'foreign kept, stale graft replaced by fresh');
  assert.ok(entries.some((e: any) => e.hooks[0].command === 'other-tool'));
  assert.ok(entries.some((e: any) => /post-edit-sync/.test(JSON.stringify(e))));
  assert.ok(!JSON.stringify(entries).includes('/old/'));
});

test('unparseable hooks.json is never rewritten', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), '{ nope');
  const w = installCodexHooks(home);
  assert.ok(w.some((x) => x.action === 'skipped-unparseable'));
  assert.equal(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'), '{ nope');
});

test('non-array PostToolUse (foreign single object) is never rewritten', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const original = JSON.stringify({
    hooks: { PostToolUse: { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] } },
  });
  writeFileSync(join(home, '.codex', 'hooks.json'), original);
  const w = installCodexHooks(home);
  assert.ok(w.some((x) => x.action === 'skipped-unparseable'));
  assert.equal(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'), original);
});

test('re-heals shim exec bit when a prior install had its mode stripped', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  installCodexHooks(home);
  const shim = join(home, '.codex', 'hooks', 'graft', 'graft-hooks.cjs');
  if (HAS_EXEC_BIT) {
    chmodSync(shim, 0o644);
    assert.ok(!(statSync(shim).mode & 0o111), 'exec bit stripped before re-run');
  }
  // On Windows this is the plain re-run case: the install must still converge on a
  // shim in place, which is all "re-healing" can mean without an exec bit.
  installCodexHooks(home);
  assertRunnableShim(shim, 'exec bit restored after re-run');
});
