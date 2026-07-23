import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusline, enrichedSegment, incomingEdges, formatBlastRadius, formatRetrieval, formatOrientation, renderSubagent, relevantRetrieval, INJECT_MIN_COVERAGE } from '../src/claude/format.js';
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
  assert.match(txt, /starting points for this task/); // pointers-only header (no inlined code)
  assert.match(txt, /PKCE — src\/pkce\.ts/);
  assert.match(txt, /Validates the challenge\./); // snippet trimmed, own line
  assert.doesNotMatch(txt, /client\.ts/); // only the first pointer segment
});

test('formatRetrieval keeps the substitutive header when code is inlined', () => {
  const ask = { query: 'pkce', mode: 'lexical', hits: [
    { kind: 'symbol', title: 'verify', pointer: 'src/pkce.ts:L1-L4', snippet: 's', score: 1, code: 'a\nb' },
  ] } as any;
  assert.match(strip(formatRetrieval(ask)!), /retrieved context — read these spans/);
});

test('formatRetrieval appends a tokens-saved line when ask reports a baseline', () => {
  const ask = { query: 'pkce', mode: 'lexical', saved: { files: 1, baselineChars: 8000 }, hits: [
    { kind: 'symbol', title: 'verify', pointer: 'src/pkce.ts:L1-L4', snippet: 's', score: 1, code: 'a\nb' },
  ] } as any;
  const txt = strip(formatRetrieval(ask)!);
  assert.match(txt, /tokens saved ≈ [\d,]+ \(\d+%\)/);
});

test('formatRetrieval returns null for no hits', () => {
  assert.equal(formatRetrieval({ query: 'x', mode: 'empty', hits: [] } as any), null);
});

// ── relevantRetrieval: the per-prompt injection gate ──
const gateAsk = (over: Record<string, unknown> = {}) => ({
  query: 'pkce', mode: 'lexical', coverage: 1,
  hits: [
    { kind: 'symbol', title: 'verify', pointer: 'src/pkce.ts:L1-L4', snippet: 's', score: 1 },
    { kind: 'symbol', title: 'gen', pointer: 'src/pkce.ts:L6-L9', snippet: 's', score: 0.8 },
  ],
  ...over,
}) as any;
const freshSession = () => ({ lastQuery: null, perAgentQuery: {}, graftReads: 0, sourceReads: 0, savedTokens: 0, injectedPointers: [] as string[] });

test('relevantRetrieval injects on good coverage and records pointers', () => {
  const s = freshSession();
  const txt = relevantRetrieval(gateAsk(), s);
  assert.ok(txt && /verify/.test(strip(txt)));
  assert.deepEqual(s.injectedPointers, ['src/pkce.ts:L1-L4', 'src/pkce.ts:L6-L9']);
});

test('relevantRetrieval skips when coverage is below the floor', () => {
  const s = freshSession();
  assert.equal(relevantRetrieval(gateAsk({ coverage: INJECT_MIN_COVERAGE - 0.01 }), s), null);
  assert.deepEqual(s.injectedPointers, [], 'nothing recorded on skip');
});

test('relevantRetrieval treats missing coverage (structural mode) as relevant', () => {
  const txt = relevantRetrieval(gateAsk({ coverage: undefined, mode: 'structural' }), freshSession());
  assert.ok(txt);
});

test('relevantRetrieval drops already-injected pointers, skips when none are fresh', () => {
  const s = freshSession();
  assert.ok(relevantRetrieval(gateAsk(), s), 'first prompt injects');
  assert.equal(relevantRetrieval(gateAsk(), s), null, 'same hits again → silent');
  const oneNew = gateAsk({ hits: [
    { kind: 'symbol', title: 'verify', pointer: 'src/pkce.ts:L1-L4', snippet: 's', score: 1 },
    { kind: 'symbol', title: 'exchange', pointer: 'src/client.ts:L2-L8', snippet: 's', score: 0.9 },
  ] });
  const txt = strip(relevantRetrieval(oneNew, s)!);
  assert.match(txt, /exchange/, 'fresh hit injected');
  assert.doesNotMatch(txt, /verify/, 'stale hit dropped from the pack');
});

test('formatOrientation labels and truncates to budget', () => {
  const md = 'X'.repeat(3000);
  const out = strip(formatOrientation(md, 1500));
  assert.match(out, /repo map/);
  assert.match(out, /reach for graft first/, 'always-on usage directive present');
  // index truncated to budget (1500) + the fixed usage directive header (~500).
  assert.ok(out.length < 2200, 'index trimmed to budget; only the fixed directive adds to it');
  // Regression: `graft impact` was folded into `graft callers --depth` in 0.6.0 —
  // the always-on directive must teach the current command, not a dead one.
  assert.doesNotMatch(out, /graft impact\b/, 'does not teach the removed `graft impact` command');
  assert.match(out, /graft callers .*--depth/, 'teaches blast radius via callers --depth instead');
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
