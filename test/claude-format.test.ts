import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusline, enrichedSegment, incomingEdges, formatBlastRadius, formatRetrieval, formatOrientation, renderSubagent } from '../src/claude/format.js';
import { emptyStats } from '../src/claude/state.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('not-built state', () => {
  const lines = renderStatusline(null, null, { ctxPct: null });
  assert.match(strip(lines[0]), /not built/);
});

test('enriched segment hidden when zero ready', () => {
  assert.equal(enrichedSegment({ ...emptyStats(), totalCount: 10, readyCount: 0 }), null);
});

test('enriched segment shown when >=1 ready', () => {
  const seg = enrichedSegment({ ...emptyStats(), totalCount: 4, readyCount: 2 });
  assert.equal(strip(seg!), '50% enriched');
});

test('two-line bar: size + freshness + ctx + last', () => {
  const stats = { ...emptyStats(), nodeCount: 319, edgeCount: 730, totalCount: 319, readyCount: 0,
    dirty: true, staleCount: 4, lastFile: 'pkce.ts' };
  const lines = renderStatusline(stats, null, { ctxPct: 34 }).map(strip);
  assert.match(lines[0], /graft/);
  assert.match(lines[0], /319 nodes \/ 730 edges/);
  assert.doesNotMatch(lines[0], /enriched/); // hidden at readyCount 0
  assert.match(lines[0], /⚠ 4 stale/);
  assert.match(lines[1], /ctx 34%/);
  assert.match(lines[1], /last: pkce\.ts/);
});

test('syncing overrides stale; synced when clean', () => {
  const base = { ...emptyStats(), nodeCount: 1, edgeCount: 0, totalCount: 1 };
  assert.match(strip(renderStatusline({ ...base, syncing: true, dirty: true }, null, { ctxPct: null })[0]), /syncing/);
  assert.match(strip(renderStatusline(base, null, { ctxPct: null })[0]), /✓ synced/);
});

const wiring2 = {
  meta: { nodeCount: 3, edgeCount: 2, languages: ['typescript'] },
  nodes: [
    { id: 'src/pkce.ts#verify', name: 'verify', path: 'src/pkce.ts', summary_state: 'ready' },
    { id: 'src/client.ts#exchange', name: 'exchange', path: 'src/client.ts', summary_state: 'ready' },
    { id: 'src/pkce.ts#gen', name: 'gen', path: 'src/pkce.ts', summary_state: 'ready' },
  ],
  edges: [
    { source: 'src/client.ts#exchange', target: 'src/pkce.ts#verify', relation: 'calls', confidence: 'extracted' },
    { source: 'src/pkce.ts#gen', target: 'src/pkce.ts#verify', relation: 'calls', confidence: 'extracted' },
  ],
} as any;

test('incomingEdges: external callers of nodes in the edited file', () => {
  const e = incomingEdges(wiring2, '/abs/repo/src/pkce.ts');
  assert.equal(e.length, 1, 'same-file edge (gen→verify) excluded');
  assert.equal(e[0].source, 'src/client.ts#exchange');
});

test('formatBlastRadius renders callers or null', () => {
  const txt = formatBlastRadius(wiring2, '/abs/repo/src/pkce.ts');
  assert.match(strip(txt!), /blast radius for pkce\.ts/);
  assert.match(strip(txt!), /exchange \(client\.ts\)/);
  assert.equal(formatBlastRadius(wiring2, '/abs/repo/src/unknown.ts'), null);
});

test('formatRetrieval renders top hits, trims snippet, first pointer only', () => {
  const ask = { query: 'pkce', mode: 'lexical', hits: [
    { kind: 'concept', title: 'PKCE', pointer: 'src/pkce.ts, src/client.ts', snippet: 'Validates   the   challenge.', score: 1 },
  ] } as any;
  const txt = strip(formatRetrieval(ask)!);
  assert.match(txt, /relevant context/);
  assert.match(txt, /PKCE — src\/pkce\.ts — Validates the challenge\./);
  assert.doesNotMatch(txt, /client\.ts/); // only the first pointer segment
});

test('formatRetrieval returns null for no hits', () => {
  assert.equal(formatRetrieval({ query: 'x', mode: 'empty', hits: [] } as any), null);
});

test('formatOrientation labels and truncates to budget', () => {
  const md = 'X'.repeat(3000);
  const out = strip(formatOrientation(md, 1500));
  assert.match(out, /repo map/);
  assert.ok(out.length < 1600, 'trimmed to budget + short header');
});

test('renderSubagent shows agent name and its last query', () => {
  const out = strip(renderSubagent('Explore', { lastQuery: null, perAgentQuery: { Explore: 'pkce flow' }, graftReads: 0, sourceReads: 0 }));
  assert.match(out, /Explore/);
  assert.match(out, /pkce flow/);
});

test('renderSubagent without a query still shows the agent', () => {
  const out = strip(renderSubagent('Plan', null));
  assert.match(out, /Plan/);
});
