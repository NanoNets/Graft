/**
 * Pure tests for `fuseScopes` (src/ask/fuse.ts) — per-scope ranking +
 * reciprocal-rank fusion. No fs, no graph build: these pin the fusion math
 * that keeps a big sub-project from drowning a small one in `graft ask`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fuseScopes,
  rankScopesAndFuse,
  RRF_K,
  PARTICIPATION_RATIO,
  STRONG_FLOOR,
  HIGH_FLOOR,
  type ScopedDoc,
  type ScopeRankOps,
} from "../src/ask/fuse.js";
import { formatAsk, type AskHit, type AskResult } from "../src/ask/ask.js";

/** A scope's docs with per-scope-normalized-looking scores, best first. */
function scopeDocs(scope: string, scores: number[]): ScopedDoc[] {
  return scores.map((score, i) => ({ id: `${scope}${i + 1}`, scope, score }));
}

test("fusion constants match the spec", () => {
  assert.equal(RRF_K, 60);
  assert.equal(PARTICIPATION_RATIO, 0.25);
  assert.equal(STRONG_FLOOR, 0.1);
  assert.equal(HIGH_FLOOR, 0.5);
});

test("10-doc scope vs 2-doc scope: top-6 of the fused order contains both scopes' best", () => {
  const huge = scopeDocs("h", [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]);
  const tiny = scopeDocs("t", [1.0, 0.4]);
  const { ranked, federated } = fuseScopes([...huge, ...tiny]);
  const top6 = ranked.slice(0, 6).map((d) => d.id);
  assert.ok(top6.includes("h1"), `huge scope's best in top-6, got ${top6}`);
  assert.ok(top6.includes("t1"), `tiny scope's best in top-6, got ${top6}`);
  assert.deepEqual([...federated].sort(), ["h", "t"], "both scopes federated");
});

test("rank-1 of the tiny scope fuses equal to rank-1 of the huge scope, by construction", () => {
  const { ranked } = fuseScopes([
    ...scopeDocs("huge", [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]),
    ...scopeDocs("tiny", [0.9]),
  ]);
  const byId = new Map(ranked.map((d) => [d.id, d.score]));
  assert.equal(byId.get("huge1"), byId.get("tiny1"), "equal fused score for both rank-1 docs");
  assert.equal(byId.get("huge1"), 1, "fused scores are normalized to [0,1], top = 1");
  assert.ok(byId.get("huge2")! < 1, "rank-2 fuses strictly below rank-1");
});

test("participation gate: a scope whose best is < 0.25 × global best is excluded but reported in alsoMatched", () => {
  const strong = scopeDocs("a", [1.0, 0.5, 0.3]);
  const weak = scopeDocs("b", [0.2, 0.1]); // 0.2 < 0.25 × 1.0
  const r = fuseScopes([...strong, ...weak]);
  assert.deepEqual(r.federated, ["a"]);
  assert.deepEqual(r.alsoMatched, [{ scope: "b", bestId: "b1" }]);
  assert.ok(r.ranked.every((d) => d.scope === "a"), "gated scope's docs are not in the fused order");
});

test("a scope at exactly the gate participates (gate is inclusive)", () => {
  const r = fuseScopes([...scopeDocs("a", [1.0]), ...scopeDocs("b", [0.25])]);
  assert.deepEqual([...r.federated].sort(), ["a", "b"]);
  assert.deepEqual(r.alsoMatched, []);
});

test("single-scope input returns the docs unchanged in order, with their original scores", () => {
  const docs = scopeDocs("only", [1.4, 0.9, 0.2, 0.05]); // below-gate scores stay too: no gate with one scope
  const r = fuseScopes(docs);
  assert.deepEqual(
    r.ranked,
    docs.map((d) => ({ id: d.id, scope: "only", score: d.score })),
    "order and scores pass through untouched — degrades to current single-scope behavior",
  );
  assert.deepEqual(r.federated, ["only"]);
  assert.deepEqual(r.alsoMatched, []);
});

test("non-scoring docs (score <= 0) never rank, federate, or report", () => {
  const r = fuseScopes([
    ...scopeDocs("a", [1.0, 0.6]),
    { id: "z1", scope: "z", score: 0 },
    { id: "z2", scope: "z", score: -1 },
  ]);
  assert.deepEqual(r.federated, ["a"]);
  assert.deepEqual(r.alsoMatched, []);
  assert.ok(r.ranked.every((d) => d.scope === "a"));
});

test("empty input fuses to an empty result", () => {
  assert.deepEqual(fuseScopes([]), { ranked: [], federated: [], alsoMatched: [] });
});

test("deterministic under input shuffle, including score ties", () => {
  const docs: ScopedDoc[] = [
    ...scopeDocs("api", [1.0, 0.8, 0.8, 0.3]), // tie inside a scope
    ...scopeDocs("web", [1.0, 0.5]),
    ...scopeDocs("docs", [0.1]), // gated out — must still be reported identically
  ];
  const baseline = fuseScopes(docs);
  const shuffles = [
    [...docs].reverse(),
    [docs[3], docs[6], docs[0], docs[5], docs[2], docs[1], docs[4]],
  ];
  for (const shuffled of shuffles) {
    assert.deepEqual(fuseScopes(shuffled), baseline, "same result regardless of input order");
  }
});

// ── rankScopesAndFuse: the participation gate is the SAME two-floor
// match-STRENGTH signal `federateAsk` (workspace federation) uses — a scope
// participates iff its top hit's `coverageStrong` (name-only, file-kind-
// excluded idf share) ≥ STRONG_FLOOR OR its `coverage` (name+path+body idf
// share) ≥ HIGH_FLOOR. Gated-out scopes go to `alsoMatched`. This is NOT the
// old `PARTICIPATION_RATIO` (0.25 × raw-lexical-best) ratio — Task 5's
// investigation proved that ratio "far too lenient, leaks junk, worsens as
// corpus grows" for exactly this reason: a body-only incidental collision's
// raw lexical score can clear 0.25× of another scope's best even though it
// never matched a name/path field at all. These drive `rankScopesAndFuse` end
// to end (through its `lex`/`strength`/`walk` callback seam, the same seam
// `ask.ts` drives it through) so a regression here is caught even if
// `fuseScopes`'s own (pure, post-normalization, ratio-based) gate still
// passes its tests — that gate is now just a no-op safety net once real
// scopes have already survived this one. ────────────────────────────────────

/** Scope "a": five docs with a real raw-lex spread (best = 10), always a
 * strong (name-matched) hit. Scope "b": one doc whose raw score is fixed but
 * whose match-strength (`coverage`/`coverageStrong`) is the probe knob — the
 * exact signal the real gate checks, decoupled from the raw-lex ratio the old
 * (buggy) gate used. No graph walk (PR rescue isn't what's under test). */
function makeOps(bStrength: { coverage: number; coverageStrong: number }): ScopeRankOps {
  const aLex = new Map([
    ["a1", 10],
    ["a2", 8],
    ["a3", 6],
    ["a4", 4],
    ["a5", 2],
  ]);
  const bLex = new Map([["b1", 3]]); // raw score irrelevant to the new gate
  return {
    lex: (s) => (s === "a" ? new Map(aLex) : new Map(bLex)),
    strength: (s) => (s === "a" ? { coverage: 1, coverageStrong: 1 } : bStrength),
    walk: () => new Map(),
  };
}

test("rankScopesAndFuse: a scope with ONLY a body-token match (coverageStrong 0, coverage below HIGH_FLOOR) is excluded from ranked and reported in alsoMatched", () => {
  // b's top hit never matched a name/path field (coverageStrong = 0) and its
  // overall coverage (0.3) is well under HIGH_FLOOR (0.5) — an incidental
  // body-comment collision, same shape as the monorepo junk/ repro.
  const r = rankScopesAndFuse(["a", "b"], makeOps({ coverage: 0.3, coverageStrong: 0 }), 0.5, 0.05);
  assert.deepEqual(r.federated, ["a"], "b must not federate on a body-only, sub-floor match");
  assert.deepEqual(r.alsoMatched, [{ scope: "b", bestId: "b1" }]);
  assert.ok(
    r.ranked.every((d) => d.scope === "a"),
    "b's junk match must not appear anywhere in the fused order",
  );
  assert.deepEqual(
    r.ranked.map((d) => d.id),
    ["a1", "a2", "a3", "a4", "a5"],
    "sole surviving scope passes through in raw score order",
  );
});

test("rankScopesAndFuse: positive — a scope with a real NAME/PATH match (coverageStrong ≥ STRONG_FLOOR) federates", () => {
  const r = rankScopesAndFuse(["a", "b"], makeOps({ coverage: 0.2, coverageStrong: STRONG_FLOOR }), 0.5, 0.05);
  assert.deepEqual([...r.federated].sort(), ["a", "b"], "b federates at exactly the strength gate");
  assert.deepEqual(r.alsoMatched, []);
  assert.ok(
    r.ranked.some((d) => d.id === "b1"),
    "b's doc appears in the fused order",
  );
});

test("rankScopesAndFuse: recall valve — body-only (coverageStrong 0) but BROAD (coverage ≥ HIGH_FLOOR) still federates", () => {
  const r = rankScopesAndFuse(["a", "b"], makeOps({ coverage: HIGH_FLOOR, coverageStrong: 0 }), 0.5, 0.05);
  assert.deepEqual([...r.federated].sort(), ["a", "b"], "a broad body-only match still federates via HIGH_FLOOR");
  assert.deepEqual(r.alsoMatched, []);
  assert.ok(r.ranked.some((d) => d.id === "b1"));
});

test("formatAsk: 'also matched … --in …' actually renders for a scope gated out on match strength", () => {
  const fusion = rankScopesAndFuse(["a", "b"], makeOps({ coverage: 0.3, coverageStrong: 0 }), 0.5, 0.05);
  const hits: AskHit[] = fusion.ranked.map((d) => ({
    kind: "symbol",
    title: d.id,
    pointer: d.id,
    snippet: "",
    score: d.score,
    scope: d.scope,
  }));
  const scopes =
    fusion.federated.length > 1 || fusion.alsoMatched.length > 0
      ? { federated: fusion.federated, alsoMatched: fusion.alsoMatched }
      : undefined;
  const result: AskResult = { query: "weak-scope probe", mode: "lexical", hits, scopes };
  const out = formatAsk(result);
  assert.match(
    out,
    /also matched: b\/ — narrow with --in b\//,
    `expected an "also matched" footer line for b/, got:\n${out}`,
  );
});
