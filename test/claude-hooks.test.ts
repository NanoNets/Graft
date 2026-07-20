import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { underGraft, main } from '../src/claude/hooks.js';
import { readStats } from '../src/claude/state.js';
import { runSync } from '../src/claude/sync-run.js';
import { writeStats, emptyStats, acquireLock } from '../src/claude/state.js';

test('underGraft detects edits inside graft/', () => {
  assert.equal(underGraft('/repo', '/repo/graft/x.md'), true);
  assert.equal(underGraft('/repo', '/repo/src/cli.ts'), false);
});

test('post-edit marks dirty and records lastFile', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }));
  // graft check will fail (no dist/cli.js here) → staleCount falls back to 0, but dirty must still be set.
  process.env.CLAUDE_PROJECT_DIR = d;
  const stdin = JSON.stringify({ tool_input: { file_path: join(d, 'src', 'auth.ts') } });
  await runWithStdin(stdin, () => main('post-edit'));
  const s = readStats(d)!;
  assert.equal(s.dirty, true);
  assert.equal(s.lastFile, 'auth.ts');
});

test('post-edit ignores edits inside graft/', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  process.env.CLAUDE_PROJECT_DIR = d;
  await runWithStdin(JSON.stringify({ tool_input: { file_path: join(d, 'graft', 'a.md') } }), () => main('post-edit'));
  assert.equal(readStats(d), null, 'no state written for graft/ edits');
});

// helper: hooks.ts reads process.env.GRAFT_TEST_STDIN first (test seam), else fd 0.
async function runWithStdin(text: string, fn: () => Promise<void>): Promise<void> {
  process.env.GRAFT_TEST_STDIN = text;
  try { await fn(); } finally { delete process.env.GRAFT_TEST_STDIN; }
}

test('runSync clears dirty/syncing, recomputes stats, releases lock', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeStats(d, { ...emptyStats(), dirty: true, syncing: true, staleCount: 3 });
  acquireLock(d);
  // fake build: write a fresh wiring.json with 2 nodes, 1 ready
  const fakeBuild = (dir: string) => writeFileSync(join(dir, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 2, edgeCount: 1, languages: ['typescript'] },
      nodes: [{ id: 'a', summary_state: 'ready' }, { id: 'b', summary_state: 'pending' }],
      edges: [{ from: 'a', to: 'b' }] }));
  runSync(d, fakeBuild);
  const s = readStats(d)!;
  assert.equal(s.dirty, false);
  assert.equal(s.syncing, false);
  assert.equal(s.staleCount, 0);
  assert.equal(s.nodeCount, 2);
  assert.equal(s.readyCount, 1);
  assert.ok(s.syncedAt);
  assert.equal(acquireLock(d), true, 'lock released, so reacquire succeeds');
});

test('runSync clears syncing even if build throws (money-safe failure)', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-'));
  writeStats(d, { ...emptyStats(), dirty: true, syncing: true });
  acquireLock(d);
  runSync(d, () => { throw new Error('build failed'); });
  const s = readStats(d)!;
  assert.equal(s.syncing, false);
  assert.equal(s.dirty, true, 'stays dirty so the bar keeps ⚠ and it retries next turn');
  assert.equal(acquireLock(d), true, 'lock always released');
});

test('runSync stays dirty when build succeeds but wiring is unreadable', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-'));
  writeStats(d, { ...emptyStats(), dirty: true, syncing: true, staleCount: 2 });
  acquireLock(d);
  runSync(d, () => { /* build "succeeds" but writes no wiring.json */ });
  const s = readStats(d)!;
  assert.equal(s.syncing, false);
  assert.equal(s.dirty, true, 'unreadable wiring → stay dirty, retry next turn');
  assert.equal(s.syncedAt, null, 'not marked synced');
  assert.equal(acquireLock(d), true, 'lock released');
});

test('prompt branch stays silent and writes no session when graft is not built', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-prompt-'));
  process.env.CLAUDE_PROJECT_DIR = d;
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (s: any) => { chunks.push(String(s)); return true; };
  try {
    await runWithStdin(
      JSON.stringify({ session_id: 'p1', prompt: 'how does pkce verification work' }),
      () => main('prompt'),
    );
  } finally {
    (process.stdout as any).write = orig;
    delete process.env.CLAUDE_PROJECT_DIR;
  }
  assert.equal(chunks.join(''), '', 'no stdout when graft ask unavailable (no dist/cli.js in temp dir)');
  assert.equal(existsSync(join(d, 'graft', '.cache', 'session', 'p1.json')), false, 'no session file on no-op');
});
