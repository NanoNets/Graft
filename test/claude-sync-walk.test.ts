/**
 * The `Stop` hook's background rebuild must keep the walk the last build chose:
 * `--only-dir` / `--exclude-dir` are recorded in the fingerprint, and a plain
 * `graft build` from the sync would widen the graph back to the whole tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, lastWalkFlags } from '../src/claude/sync-run.js';

function repoWithFingerprint(fp: object | null): { d: string; argsFile: string } {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-walk-'));
  mkdirSync(join(d, 'graft', '.cache'), { recursive: true });
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  if (fp) writeFileSync(join(d, 'graft', '.cache', 'fingerprint.deadbeef.json'), JSON.stringify(fp));
  const argsFile = join(d, 'args-seen.json');
  const stub = join(d, 'build-stub.cjs');
  writeFileSync(
    stub,
    `const fs = require('fs');\n` +
      `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n` +
      `fs.writeFileSync(${JSON.stringify(join(d, 'graft', '.graph', 'wiring.json'))}, JSON.stringify({ meta: { nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }));\n`,
  );
  process.env.GRAFT_TEST_CLI = stub;
  return { d, argsFile };
}

test('lastWalkFlags reads only-dir and exclude-dir off the newest fingerprint, and nothing when absent', () => {
  const { d } = repoWithFingerprint({ version: 1, files: {}, onlyDirs: ['src'], excludeDirs: ['cloud/src', 'design'] });
  try {
    assert.deepEqual(lastWalkFlags(join(d, 'graft')), ['--only-dir', 'src', '--exclude-dir', 'cloud/src', '--exclude-dir', 'design']);
    assert.deepEqual(lastWalkFlags(join(d, 'nowhere')), []);
    writeFileSync(join(d, 'graft', '.cache', 'fingerprint.deadbeef.json'), '{not json');
    assert.deepEqual(lastWalkFlags(join(d, 'graft')), [], 'a corrupt sidecar is a plain build, never a crash');
  } finally {
    delete process.env.GRAFT_TEST_CLI;
    rmSync(d, { recursive: true, force: true });
  }
});

test("runSync's default build re-applies the last build's --only-dir / --exclude-dir", () => {
  const { d, argsFile } = repoWithFingerprint({ version: 1, files: {}, excludeDirs: ['cloud/src'] });
  try {
    runSync(d);
    const seen: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.deepEqual(seen.slice(0, 2), ['build', '.']);
    assert.ok(seen.includes('--exclude-dir') && seen[seen.indexOf('--exclude-dir') + 1] === 'cloud/src', `flags carried: ${seen.join(' ')}`);
    assert.ok(!seen.includes('--only-dir'));
  } finally {
    delete process.env.GRAFT_TEST_CLI;
    rmSync(d, { recursive: true, force: true });
  }
});

test("runSync's default build stays a plain `graft build .` when no fingerprint exists", () => {
  const { d, argsFile } = repoWithFingerprint(null);
  try {
    runSync(d);
    const seen: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.deepEqual(seen, ['build', '.']);
  } finally {
    delete process.env.GRAFT_TEST_CLI;
    rmSync(d, { recursive: true, force: true });
  }
});
