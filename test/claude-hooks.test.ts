import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { underGraft, main, lastFileScopeHint } from '../src/claude/hooks.js';
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

test('post-edit-sync marks dirty and kicks off the background sync', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }));
  process.env.CLAUDE_PROJECT_DIR = d;
  // handleStop's spawn path is gated on the sync-run script existing (real installs resolve it
  // via claudeScriptPath('sync-run.js') next to this module). GRAFT_TEST_SYNC_RUN is a test seam
  // (mirrors GRAFT_TEST_STDIN) that lets us point handleStop at a no-op stub inside this test's
  // own sandbox dir, so nothing is written into src/claude/.
  const syncRun = join(d, 'sync-run-stub.js');
  writeFileSync(syncRun, '// test stub: spawned as a detached no-op child\n');
  process.env.GRAFT_TEST_SYNC_RUN = syncRun;
  try {
    const stdin = JSON.stringify({ tool_input: { file_path: join(d, 'src', 'auth.ts') } });
    await runWithStdin(stdin, () => main('post-edit-sync'));
    const s = readStats(d)!;
    assert.equal(s.dirty, true, 'post-edit half ran');
    assert.equal(s.syncing, true, 'stop half ran');
    assert.equal(existsSync(join(d, 'graft', '.cache', '.sync.lock')), true, 'sync lock file exists');
  } finally {
    delete process.env.GRAFT_TEST_SYNC_RUN;
  }
});

test('post-edit-sync on a file under graft/ does not mark dirty', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  process.env.CLAUDE_PROJECT_DIR = d;
  await runWithStdin(JSON.stringify({ tool_input: { file_path: join(d, 'graft', 'a.md') } }), () => main('post-edit-sync'));
  // The under-graft guard means handlePostEdit never marks dirty, and this is a fresh mkdtemp
  // dir so there is no prior state to inherit — stats are either absent or dirty: false.
  const s = readStats(d);
  assert.equal(s === null || s.dirty === false, true, 'dirty not newly set by this call');
});

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

// ── lastFileScopeHint (the "you're working in backend/, weight it" hint) ──

/** backend/ (py) + frontend/ (ts) scopes, one file node each, distinct
 * basenames so a lookup by basename is unambiguous. */
function writeMultiScopeWiring(d: string): void {
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(
    join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({
      meta: {
        nodeCount: 2, edgeCount: 0, languages: ['typescript', 'python'],
        scopes: [
          { prefix: 'backend', label: 'backend', markers: ['pyproject.toml'] },
          { prefix: 'frontend', label: 'frontend', markers: ['package.json'] },
        ],
      },
      nodes: [
        { id: 'backend/app.py', name: 'app.py', kind: 'file', path: 'backend/app.py', span: 'L1-L1' },
        { id: 'frontend/src/auth.ts', name: 'auth.ts', kind: 'file', path: 'frontend/src/auth.ts', span: 'L1-L1' },
      ],
      edges: [],
    }),
  );
}

test('lastFileScopeHint: resolves a matching lastFile to its scope prefix', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hint-'));
  writeMultiScopeWiring(d);
  assert.equal(lastFileScopeHint(d, 'app.py'), 'backend');
  assert.equal(lastFileScopeHint(d, 'auth.ts'), 'frontend');
});

test('lastFileScopeHint: null on a single-scope graph, a missing lastFile, or no graph at all', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hint-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(
    join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({
      meta: { nodeCount: 1, edgeCount: 0, languages: [] },
      nodes: [{ id: 'a.ts', name: 'a.ts', kind: 'file', path: 'a.ts', span: 'L1-L1' }],
      edges: [],
    }),
  );
  assert.equal(lastFileScopeHint(d, 'a.ts'), null, 'single-scope repo: no hint, no --in');
  assert.equal(lastFileScopeHint(d, null), null, 'no lastFile yet: no hint');
  assert.equal(lastFileScopeHint(d, undefined), null);
  const noGraphDir = mkdtempSync(join(tmpdir(), 'graft-hint-nograph-'));
  assert.equal(lastFileScopeHint(noGraphDir, 'a.ts'), null, 'no graph built yet: no hint');
});

test('lastFileScopeHint: a root-scope lastFile needs no --in (root already covers everything)', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hint-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(
    join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({
      meta: {
        nodeCount: 2, edgeCount: 0, languages: [],
        scopes: [
          { prefix: '', label: '', markers: [] },
          { prefix: 'frontend', label: 'frontend', markers: ['package.json'] },
        ],
      },
      nodes: [
        { id: 'README.md', name: 'README.md', kind: 'file', path: 'README.md', span: 'L1-L1' },
        { id: 'frontend/a.ts', name: 'a.ts', kind: 'file', path: 'frontend/a.ts', span: 'L1-L1' },
      ],
      edges: [],
    }),
  );
  assert.equal(lastFileScopeHint(d, 'README.md'), null);
});

test('lastFileScopeHint: fails soft (null, logged to stderr) when lastFile is stale — not in the current graph', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hint-'));
  writeMultiScopeWiring(d);
  const errors: string[] = [];
  const origError = console.error;
  (console as any).error = (...a: unknown[]) => { errors.push(a.join(' ')); };
  try {
    assert.equal(lastFileScopeHint(d, 'nonexistent.ts'), null, 'a stale lastFile degrades to no hint, never throws');
    assert.ok(errors.length > 0, 'the skipped hint is logged to stderr, not silently swallowed');
    assert.match(errors[0], /nonexistent\.ts/);
  } finally {
    console.error = origError;
  }
});

test('lastFileScopeHint: fails soft (null, logged to stderr) when lastFile is ambiguous across scopes', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hint-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(
    join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({
      meta: {
        nodeCount: 2, edgeCount: 0, languages: [],
        scopes: [
          { prefix: 'backend', label: 'backend', markers: ['go.mod'] },
          { prefix: 'frontend', label: 'frontend', markers: ['package.json'] },
        ],
      },
      nodes: [
        { id: 'backend/index.ts', name: 'index.ts', kind: 'file', path: 'backend/index.ts', span: 'L1-L1' },
        { id: 'frontend/index.ts', name: 'index.ts', kind: 'file', path: 'frontend/index.ts', span: 'L1-L1' },
      ],
      edges: [],
    }),
  );
  const errors: string[] = [];
  const origError = console.error;
  (console as any).error = (...a: unknown[]) => { errors.push(a.join(' ')); };
  try {
    assert.equal(lastFileScopeHint(d, 'index.ts'), null, 'ambiguous across scopes degrades to no hint, never throws');
    assert.ok(errors.length > 0, 'the skipped hint is logged to stderr, not silently swallowed');
  } finally {
    console.error = origError;
  }
});

// ── prompt hook: --in <scope> narrowing end-to-end ─────────────────────────

/** A `graft ask` stub (`.cjs` so it runs as CommonJS regardless of this
 * package's `"type": "module"`) that records the exact argv it was invoked
 * with — GRAFT_TEST_CLI (mirrors GRAFT_TEST_STDIN/GRAFT_TEST_SYNC_RUN) points
 * graftJson at it instead of the real, unbuilt-in-tests CLI. */
function writeAskArgsStub(d: string): { stub: string; argsFile: string } {
  const stub = join(d, 'ask-stub.cjs');
  const argsFile = join(d, 'args-seen.json');
  writeFileSync(
    stub,
    `const fs = require('fs');\n` +
      `const args = process.argv.slice(2);\n` +
      `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));\n` +
      `process.stdout.write(JSON.stringify({ query: args[1] || '', mode: 'lexical', hits: [], coverage: 1 }));\n`,
  );
  return { stub, argsFile };
}

test('prompt hook passes --in <scope> when lastFile resolves to a scope on a multi-scope repo', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-prompt-scope-'));
  writeMultiScopeWiring(d);
  writeStats(d, { ...emptyStats(), lastFile: 'app.py' });
  const { stub, argsFile } = writeAskArgsStub(d);
  process.env.CLAUDE_PROJECT_DIR = d;
  process.env.GRAFT_TEST_CLI = stub;
  try {
    await runWithStdin(
      JSON.stringify({ session_id: 'p-scope', prompt: 'how does the backend handle auth' }),
      () => main('prompt'),
    );
    const argsSeen: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
    const inIdx = argsSeen.indexOf('--in');
    assert.ok(inIdx !== -1, 'the ask call carries --in');
    assert.equal(argsSeen[inIdx + 1], 'backend', 'narrowed to the scope lastFile (app.py) resolves to');
  } finally {
    delete process.env.GRAFT_TEST_CLI;
    delete process.env.CLAUDE_PROJECT_DIR;
  }
});

test('prompt hook omits --in on a single-scope repo even with lastFile set', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-prompt-scope-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }));
  writeStats(d, { ...emptyStats(), lastFile: 'auth.ts' });
  const { stub, argsFile } = writeAskArgsStub(d);
  process.env.CLAUDE_PROJECT_DIR = d;
  process.env.GRAFT_TEST_CLI = stub;
  try {
    await runWithStdin(
      JSON.stringify({ session_id: 'p-single', prompt: 'how does auth work here' }),
      () => main('prompt'),
    );
    const argsSeen: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.equal(argsSeen.indexOf('--in'), -1, 'single-scope repo: no --in narrowing');
  } finally {
    delete process.env.GRAFT_TEST_CLI;
    delete process.env.CLAUDE_PROJECT_DIR;
  }
});

test('prompt hook omits --in and logs to stderr when lastFile is ambiguous across scopes', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-prompt-scope-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(
    join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({
      meta: {
        nodeCount: 2, edgeCount: 0, languages: [],
        scopes: [
          { prefix: 'backend', label: 'backend', markers: ['go.mod'] },
          { prefix: 'frontend', label: 'frontend', markers: ['package.json'] },
        ],
      },
      nodes: [
        { id: 'backend/index.ts', name: 'index.ts', kind: 'file', path: 'backend/index.ts', span: 'L1-L1' },
        { id: 'frontend/index.ts', name: 'index.ts', kind: 'file', path: 'frontend/index.ts', span: 'L1-L1' },
      ],
      edges: [],
    }),
  );
  writeStats(d, { ...emptyStats(), lastFile: 'index.ts' });
  const { stub, argsFile } = writeAskArgsStub(d);
  const errors: string[] = [];
  const origError = console.error;
  (console as any).error = (...a: unknown[]) => { errors.push(a.join(' ')); };
  process.env.CLAUDE_PROJECT_DIR = d;
  process.env.GRAFT_TEST_CLI = stub;
  try {
    await runWithStdin(
      JSON.stringify({ session_id: 'p-ambig', prompt: 'how is the index wired up' }),
      () => main('prompt'),
    );
    const argsSeen: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.equal(argsSeen.indexOf('--in'), -1, 'ambiguous lastFile: no --in narrowing');
    assert.ok(errors.length > 0, 'the skipped hint is logged to stderr — never a silent no-op the hook can hide');
  } finally {
    console.error = origError;
    delete process.env.GRAFT_TEST_CLI;
    delete process.env.CLAUDE_PROJECT_DIR;
  }
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
