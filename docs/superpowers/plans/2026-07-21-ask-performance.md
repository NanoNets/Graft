# Ask Performance at Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `graft ask` answers long natural-language queries on a 32k-node graph in well under 2s (today: hangs for minutes), by fixing the PageRank dangling-mass loop and moving per-query corpus tokenization/IDF to build time.

**Architecture:** (1) `personalizedPageRank` gets the standard dangling-mass fix: accumulate escaped mass in a scalar and redistribute once per iteration — identical math, O(nodes+edges+seeds) per iteration instead of O(dangling×seeds). (2) `graft build` emits a sidecar `.graph/index.json` (token bags per node/field + document frequencies + avg body length), and `ask` uses it when present instead of re-tokenizing 32k nodes per query; graphs without a sidecar fall back to the current on-the-fly path. Concept (markdown) docs stay tokenized at query time — there are ~dozens, not 32k.

**Tech Stack:** TypeScript ESM, Node ≥20, node:test + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies; ESM `.js` imports; files under 500 lines.
- Ranking RESULTS must not change: same scores, same order (the PPR fix is algebraically identical; the sidecar stores exactly what tokenize/counts produce today). Existing ask tests must pass unmodified.
- Backward compatible: `ask` on a graph without `index.json` works exactly as today (fallback), so old committed graphs keep working.
- The sidecar is versioned (`{"version": 1, ...}`); an unknown version → fallback path, never a crash.
- Wall-clock acceptance (measured on the 56MB / 32,377-node graph at `/private/tmp/claude-501/-Users-shrishdwivedi-Documents-Context-graphs/d3b217f7-4a78-4399-b91a-8bb7db720797/scratchpad/bigrepo-graft`, repo `/Users/shrishdwivedi/Documents/Nanonets/assign`): the query "How does authentication middleware validate incoming API requests in the backend?" with `--source -n 8` completes in < 5s after Task 1, and < 3s after Task 2 (rebuilt graph with sidecar). Record actual numbers in the task reports.
- No third-party tool names in code/comments/commit messages.
- Tests: `node --import tsx --test test/<file>.test.ts`.

---

## File Structure

- Modify: `src/ask/graphrank.ts` — dangling-mass scalar accumulation.
- Create: `src/ask/index-file.ts` — sidecar read/write (`writeAskIndex`, `readAskIndex`, types).
- Modify: `src/graph/build.ts` — call `writeAskIndex` after writing wiring (find where wiring.json is written; the sidecar lands next to it).
- Modify: `src/ask/ask.ts` — `lexical()` consumes a prebuilt index when available.
- Tests: `test/graphrank.test.ts` (may exist — extend), `test/ask-index.test.ts`.

---

### Task 1: PageRank dangling-mass fix (`src/ask/graphrank.ts`)

**Files:**
- Modify: `src/ask/graphrank.ts` (lines ~84-101, the power-iteration loop)
- Test: extend the existing graphrank/ask test file if present, else create `test/graphrank.test.ts`

**Interfaces:** `personalizedPageRank(graph, seeds, opts)` signature and semantics unchanged.

- [ ] **Step 1: Write the failing tests** (create or extend `test/graphrank.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalizedPageRank } from '../src/ask/graphrank.js';
import type { GraphV1 } from '../src/graph/types.js';

function nodeStub(id: string): any {
  return { id, name: id, kind: 'function', path: 'x.ts', span: 'L1-L1', signature: null,
    exported: true, origin: 'ast', body_hash: 'h', summary_state: 'pending', summary: null, crux: null };
}
function graphOf(nodeIds: string[], edges: Array<[string, string]>): GraphV1 {
  return {
    version: 1,
    nodes: nodeIds.map(nodeStub),
    edges: edges.map(([source, target]) => ({ source, target, relation: 'calls', confidence: 'extracted' })),
  } as any;
}

test('results identical to the reference implementation on a small graph', () => {
  // 5 nodes: a-b-c chain, d dangling with seed mass, e isolated non-seed.
  const g = graphOf(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c']]);
  const seeds = new Map([['a', 2], ['d', 1]]);
  const out = personalizedPageRank(g, seeds);
  // Reference values computed with the pre-fix implementation (identical math):
  // run the OLD code once (git stash the fix) to capture expected values, then
  // hard-code them here with a tolerance:
  //   assert.ok(Math.abs(out.get('a')! - EXPECTED_A) < 1e-9) ... for a,b,c,d
  // The top-ranked node must be 'a' (seed + connected) with score 1.
  assert.equal(out.get('a'), 1);
  assert.ok((out.get('b') ?? 0) > 0);
  assert.ok((out.get('d') ?? 0) > 0, 'dangling seed keeps mass');
  assert.equal(out.get('e'), undefined, 'unreached node absent');
});

test('broad seeds on a large mostly-dangling graph complete fast', () => {
  // 20k dangling nodes (no edges) + 100 connected ones; seed EVERY node —
  // the pathological shape from real 32k-node graphs with common-word queries.
  const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < 100; i++) edges.push([`n${i}`, `n${i + 1}`]);
  const g = graphOf(ids, edges);
  const seeds = new Map(ids.map((id) => [id, 1]));
  const t0 = Date.now();
  const out = personalizedPageRank(g, seeds);
  const ms = Date.now() - t0;
  assert.ok(out.size > 0);
  assert.ok(ms < 3000, `took ${ms}ms — dangling redistribution must not be O(dangling × seeds)`);
});
```

Implementer note for the first test: before applying the fix, run the CURRENT code to capture exact expected scores for nodes a/b/c/d and bake them into the test as high-precision constants. That is what proves the fix is algebraically identical.

- [ ] **Step 2: Run to verify** — the timing test FAILS (takes minutes) against current code; kill after the assertion timeout proves the point (use the 3s assertion, run with a generous test timeout).

- [ ] **Step 3: Implement the fix** — replace the per-dangling-node redistribution in the iteration loop:

```ts
  // Power iteration from the restart distribution.
  let rank = new Map(restart);
  for (let i = 0; i < iters; i++) {
    const next = new Map<string, number>();
    // Teleport: every step, alpha of the mass returns to the seed set.
    for (const [id, r] of restart) next.set(id, alpha * r);
    // Dangling mass (nodes with no walk edges) is pooled and returned to the
    // seed set ONCE per iteration — same math as redistributing per node, but
    // O(nodes + seeds) instead of O(dangling × seeds).
    let dangling = 0;
    for (const [id, mass] of rank) {
      const nbrs = adj.get(id);
      if (!nbrs || nbrs.length === 0) {
        dangling += mass;
        continue;
      }
      const share = ((1 - alpha) * mass) / nbrs.length;
      for (const nb of nbrs) next.set(nb, (next.get(nb) ?? 0) + share);
    }
    if (dangling > 0) {
      const dm = (1 - alpha) * dangling;
      for (const [sid, r] of restart) next.set(sid, (next.get(sid) ?? 0) + dm * r);
    }
    rank = next;
  }
```

- [ ] **Step 4: Run tests + full suite; then the acceptance measurement** — time the previously-hanging query on the big graph (command in Global Constraints); record the number. Expected: seconds, not minutes.

- [ ] **Step 5: Commit** — `fix(ask): pool dangling PageRank mass — O(dangling×seeds) hang on broad queries`

---

### Task 2: Build-time ask index sidecar

**Files:**
- Create: `src/ask/index-file.ts`
- Modify: `src/graph/build.ts` (write sidecar after wiring), `src/ask/ask.ts` (consume it)
- Test: `test/ask-index.test.ts`

**Interfaces:**
- `interface AskIndexDoc { id: string; name: [string, number][]; path: [string, number][]; body: [string, number][] }` (token→count entries)
- `interface AskIndex { version: 1; avgBodyLen: number; df: [string, number][]; docCount: number; docs: AskIndexDoc[] }`
- `writeAskIndex(outDir: string, graph: GraphV1): string` — tokenizes exactly like `ask.ts` does today (import/share the SAME `tokenize`/`counts` — export them from ask.ts or move both into index-file.ts and import back; one source of truth) and writes `<outDir>/.graph/index.json`. Returns the path.
- `readAskIndex(outDir: string): AskIndex | null` — null on missing/unparseable/unknown-version.
- In `ask.ts` `lexical()`: when `readAskIndex` returns data covering the current graph (same doc count as `graph.nodes.length` — cheap staleness guard; on mismatch, fall back), build `symbolDocs` maps from the sidecar instead of tokenizing; IDF comes from stored `df` + concept doc bags (concepts still tokenized live and merged into df counts the same way `computeIdf` sees them today — keep the resulting idf values identical; if exact parity with stored-df-plus-live-concepts is not achievable, store df WITHOUT concepts and add concept bags at query time before computing idf, which reproduces today's inputs exactly).
- `graft build` prints the sidecar in its output (`→ ...` line already prints the dir; no new output needed beyond the report).

- [ ] **Step 1: Write failing tests** covering: (a) `writeAskIndex`+`readAskIndex` round-trip equals live tokenization (build both ways on a small fixture graph and deep-equal the doc maps); (b) `ask` results IDENTICAL with and without the sidecar on a built fixture repo (run `lexical` twice — sidecar present vs renamed away — same hits, same scores); (c) unknown version → fallback (no crash, same results); (d) stale sidecar (docCount mismatch) → fallback.

- [ ] **Step 2: Verify failure, implement, verify pass, full suite green.**

- [ ] **Step 3: Acceptance measurement** — rebuild the big graph (`node dist/cli.js --dir <scratch> build <assign repo>`), then time the long query again; record build-time delta (sidecar write) and ask-time improvement in the report.

- [ ] **Step 4: Commit** — `feat(ask): build-time token/IDF index sidecar — ask stops re-tokenizing the corpus per query`

---

### Task 3: Verification + docs

**Files:**
- Modify: `README.md` (only if numbers/claims need updating — the "What runs where"/ask sections make no latency claims today; add none without measurements).
- No code.

- [ ] **Step 1:** Full suite + build. Run the three A/B queries from the benchmark session on the big graph, timed, and record: short query, medium query, long query — before/after table in the task report (before-numbers from this plan's context: 1.2-1.5s short/medium, hang on long).
- [ ] **Step 2:** Run `graft ask` on the graft repo itself (small graph) — confirm no regression (<0.5s).
- [ ] **Step 3:** Commit any doc touch-ups: `docs: note ask index sidecar in build output docs` (skip commit if no changes).

## Out of scope

- Removing `body_text` from `wiring.json` (moving it fully into the sidecar) — biggest remaining parse win, but it changes the graph schema consumed by other readers; separate plan after this lands.
- Frontier-capped PageRank — unnecessary once the dangling fix lands (25 iterations over 72k edges is ~ms).

## Self-Review

- The hang's root cause (dangling×seeds) is fixed by Task 1 with an equivalence test against captured reference values. ✓
- The 45% tokenization tax is removed by Task 2 with result-parity tests both ways. ✓
- Fallback keeps old graphs working; version field future-proofs. ✓
- No placeholders: Task 1 has full code; Task 2's types and parity strategy are fully specified with the one open detail (df-with-concepts parity) given an exact resolution path. ✓
