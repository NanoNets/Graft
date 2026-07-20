import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/claude/stats.js';

const wiring = {
  meta: { version: 1, nodeCount: 3, edgeCount: 2, languages: ['typescript'] },
  nodes: [
    { id: 'a', summary_state: 'ready' },
    { id: 'b', summary_state: 'pending' },
    { id: 'c', summary_state: 'ready' },
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }],
} as any;

test('computeStats derives counts and readyCount', () => {
  const s = computeStats(wiring);
  assert.equal(s.nodeCount, 3);
  assert.equal(s.edgeCount, 2);
  assert.deepEqual(s.languages, ['typescript']);
  assert.equal(s.totalCount, 3);
  assert.equal(s.readyCount, 2);
});

test('computeStats tolerates missing meta by counting arrays', () => {
  const s = computeStats({ nodes: [{ id: 'x', summary_state: 'pending' }], edges: [] } as any);
  assert.equal(s.nodeCount, 1);
  assert.equal(s.edgeCount, 0);
  assert.equal(s.readyCount, 0);
});
