import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStats } from '../src/claude/statusline.js';
import { writeStats, emptyStats } from '../src/claude/state.js';

function repo(): string { return mkdtempSync(join(tmpdir(), 'graft-sl-')); }
function writeWiring(dir: string, obj: unknown): void {
  mkdirSync(join(dir, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(dir, 'graft', '.graph', 'wiring.json'), JSON.stringify(obj));
}

test('resolveStats returns the hook-maintained cache when present and non-empty', () => {
  const d = repo();
  writeStats(d, { ...emptyStats(), nodeCount: 5, edgeCount: 9, dirty: true, staleCount: 2 });
  const s = resolveStats(d)!;
  assert.equal(s.nodeCount, 5);
  assert.equal(s.dirty, true, 'cache is the source of truth when present');
});

test('resolveStats falls back to wiring.json when no cache (manual graft build / fresh checkout)', () => {
  const d = repo();
  writeWiring(d, {
    meta: { nodeCount: 42, edgeCount: 100, languages: ['typescript'] },
    nodes: [{ id: 'a', summary_state: 'ready' }, { id: 'b', summary_state: 'pending' }],
    edges: [],
  });
  const s = resolveStats(d)!;
  assert.equal(s.nodeCount, 42, 'reflects the graph immediately instead of "not built"');
  assert.equal(s.readyCount, 1);
  assert.equal(s.dirty, false, 'defaults to synced — no drift signal available from the graph alone');
});

test('resolveStats prefers the cache over the graph even when both exist', () => {
  const d = repo();
  writeWiring(d, { meta: { nodeCount: 42, edgeCount: 100, languages: [] }, nodes: [], edges: [] });
  writeStats(d, { ...emptyStats(), nodeCount: 7, edgeCount: 3, dirty: true, staleCount: 4 });
  const s = resolveStats(d)!;
  assert.equal(s.nodeCount, 7, 'cache wins (it carries live drift state the graph cannot)');
  assert.equal(s.staleCount, 4);
});

test('resolveStats returns null when neither cache nor graph exists', () => {
  assert.equal(resolveStats(repo()), null);
});
