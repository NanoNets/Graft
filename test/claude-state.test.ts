import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyStats, readStats, writeStats, patchStats,
  readSession, writeSession, acquireLock, releaseLock, cacheDir, LOCK_STALE_MS,
} from '../src/claude/state.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-state-')); }

test('stats round-trip and patch merge', () => {
  const d = fresh();
  assert.equal(readStats(d), null);
  writeStats(d, { ...emptyStats(), nodeCount: 319, edgeCount: 730 });
  assert.equal(readStats(d)!.nodeCount, 319);
  const patched = patchStats(d, { dirty: true, staleCount: 4 });
  assert.equal(patched.dirty, true);
  assert.equal(patched.staleCount, 4);
  assert.equal(readStats(d)!.edgeCount, 730, 'patch preserves other fields');
});

test('session defaults and round-trip', () => {
  const d = fresh();
  const s = readSession(d, 'abc');
  assert.deepEqual(s, { lastQuery: null, perAgentQuery: {}, graftReads: 0, sourceReads: 0 });
  s.lastQuery = 'pkce'; s.graftReads = 2;
  writeSession(d, 'abc', s);
  assert.equal(readSession(d, 'abc').lastQuery, 'pkce');
  assert.equal(readSession(d, 'xyz').graftReads, 0, 'other sessions isolated');
});

test('lock is exclusive then releasable', () => {
  const d = fresh();
  assert.equal(acquireLock(d), true);
  assert.equal(acquireLock(d), false, 'second acquire blocked while held');
  assert.ok(existsSync(join(cacheDir(d), '.sync.lock')));
  releaseLock(d);
  assert.equal(acquireLock(d), true, 'reacquire after release');
});

test('acquireLock reclaims a stale lock', () => {
  const d = fresh();
  assert.equal(acquireLock(d), true);
  const p = join(cacheDir(d), '.sync.lock');
  const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  utimesSync(p, old, old);
  assert.equal(acquireLock(d), true, 'stale lock reclaimed');
});
