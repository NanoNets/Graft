/**
 * Scope-aware ranking for `graft ask` — per-scope ranking + reciprocal-rank
 * fusion (RRF). Pure functions, no fs.
 *
 * The problem: lexical + graph scores are corpus-relative. In a multi-scope
 * repo (a monorepo's `frontend/` + `backend/`, sub-projects under one root),
 * pooling every node into one ranking lets the biggest sub-project set the
 * score scale and drown the small one — its IDF, its BM25 length prior, its
 * PageRank mass. The fix: rank each scope against ITS OWN corpus (per-scope
 * IDF/BM25/walk, done by the caller), then fuse the per-scope ORDERINGS here
 * with RRF — rank positions are comparable across corpora where raw scores
 * are not, so the tiny scope's best hit lands next to the huge scope's best.
 *
 * Soft federation: a scope whose top hit is probably an incidental word
 * collision, not a second home for the query, is left out of the fused order
 * and reported in `alsoMatched` instead, so the output can say "also matched:
 * docs/ — narrow with --in docs/" rather than diluting the pack. The REAL
 * participation gate — used by both `rankScopesAndFuse` here and `federateAsk`
 * (workspace federation) — is the match-STRENGTH signal in {@link
 * STRONG_FLOOR}/{@link HIGH_FLOOR}: a scope's top hit must have matched a
 * query term in a NAME/PATH field, or have broad enough overall coverage to be
 * real even body-only. `fuseScopes`'s own {@link PARTICIPATION_RATIO} gate is
 * a separate, cruder ratio check that still runs internally as a
 * post-normalization safety net, not the primary defense.
 */

/** One scored document, attributed to the ranking scope (path prefix, "" =
 * root) it was scored within. Scores must be per-scope-normalized (each
 * scope's best ≈ its own ceiling) — fusion compares ranks, not raw scores. */
export interface ScopedDoc {
  id: string;
  scope: string;
  score: number;
}

export interface FusionResult {
  /** fused order, best first; carries per-doc scope label + fused score.
   * Normalized so the top MULTI-scope fused doc is 1 — but the single-scoring-
   * scope degenerate case passes ORIGINAL (pre-fusion) scores through
   * unchanged, and those are not guaranteed to fall in [0,1]. */
  ranked: { id: string; scope: string; score: number }[];
  /** scopes that participated in fusion */
  federated: string[];
  /** scopes that matched weakly (≥1 scoring doc but below the participation gate) with their best doc */
  alsoMatched: { scope: string; bestId: string }[];
}

/** RRF smoothing constant — the standard value from the original RRF paper;
 * high enough that rank 1 vs 2 differ gently rather than by 2×. */
export const RRF_K = 60;

/** A scope federates only when its best doc scores at least this share of the
 * global best — below it the match is reported, not fused. Used by
 * `fuseScopes`'s own internal gate (a post-normalization safety net once a
 * caller has already applied the real match-strength gate — see
 * {@link STRONG_FLOOR}/{@link HIGH_FLOOR}). */
export const PARTICIPATION_RATIO = 0.25;

/** The single source of truth for the cross-scope participation gate shared
 * by `rankScopesAndFuse` (single-graph multi-scope) and `federateAsk`
 * (workspace federation, `src/graph/workspace.ts`) — the two paths that solve
 * the identical "a weak scope must not federate beside a strong one" problem.
 * They MUST use the same floors so they can never drift into inconsistent
 * behavior again.
 *
 * A scope federates iff its top hit matched a query term in a NAME/PATH field
 * at all (any strength ≥ `STRONG_FLOOR`) — the primary gate. Well below every
 * genuine fixture (≥0.45) yet strictly above a body-only collision's 0, so a
 * real partial-relevance hit on a common/low-idf term is never overcorrected
 * out. */
export const STRONG_FLOOR = 0.1;
/** …OR the overall (name+path+body) coverage is broad enough to be real even
 * body-only. A single incidental body-token collision measures ~0.29 and RISES
 * with corpus size (0.30+ at 200 nodes) but never approaches this, while a
 * genuinely broad match clears it. This is why the gate is on absolute,
 * scale-invariant floors, NOT a raw-lexical-score ratio (which — calibrated for
 * raw-lexical-SCORE space — was far too lenient in coverage/matched-fraction
 * space and leaked junk, worsening as the corpus grew). */
export const HIGH_FLOOR = 0.5;

/** Score-desc, id-asc ordering — the id tiebreak is what makes fusion
 * deterministic under input shuffle. */
function byScore(a: ScopedDoc, b: ScopedDoc): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

/**
 * Partition by scope, rank within scope (input scores are already
 * per-scope-normalized), gate by soft federation, fuse by RRF:
 * `fused(id) = Σ 1/(K + rank_in_scope(id))`, then normalized so the top fused
 * doc is 1. Non-scoring docs (score ≤ 0) are dropped entirely.
 *
 * Degenerate cases degrade to current behavior: zero scoring docs → empty
 * result; exactly one scoring scope → its docs pass through in score order
 * with their ORIGINAL scores (no RRF re-scoring, no gate) — byte-for-byte the
 * single-corpus ranking the caller would have produced anyway.
 */
export function fuseScopes(docs: ScopedDoc[]): FusionResult {
  const byScope = new Map<string, ScopedDoc[]>();
  for (const d of docs) {
    if (d.score <= 0) continue;
    const list = byScope.get(d.scope);
    if (list) list.push(d);
    else byScope.set(d.scope, [d]);
  }
  for (const list of byScope.values()) list.sort(byScore);

  if (byScope.size === 0) return { ranked: [], federated: [], alsoMatched: [] };
  if (byScope.size === 1) {
    const [scope, list] = byScope.entries().next().value as [string, ScopedDoc[]];
    return {
      ranked: list.map((d) => ({ id: d.id, scope, score: d.score })),
      federated: [scope],
      alsoMatched: [],
    };
  }

  // Gate: order scopes by their best doc (desc, scope-name tiebreak), split
  // into federated (≥ ratio × global best, inclusive) and alsoMatched.
  const scopesByBest = [...byScope.entries()].sort(
    (a, b) => b[1][0].score - a[1][0].score || a[0].localeCompare(b[0]),
  );
  const gate = PARTICIPATION_RATIO * scopesByBest[0][1][0].score;
  const federated: string[] = [];
  const alsoMatched: FusionResult["alsoMatched"] = [];
  for (const [scope, list] of scopesByBest) {
    if (list[0].score >= gate) federated.push(scope);
    else alsoMatched.push({ scope, bestId: list[0].id });
  }

  // RRF: each federated scope contributes 1/(K + rank) per doc; an id listed
  // in more than one scope sums its contributions and is attributed to the
  // scope where it ranked best.
  const acc = new Map<string, { scope: string; score: number; bestRank: number }>();
  for (const scope of federated) {
    byScope.get(scope)!.forEach((d, i) => {
      const contribution = 1 / (RRF_K + i + 1);
      const prev = acc.get(d.id);
      if (!prev) acc.set(d.id, { scope, score: contribution, bestRank: i });
      else {
        prev.score += contribution;
        if (i < prev.bestRank) {
          prev.scope = scope;
          prev.bestRank = i;
        }
      }
    });
  }

  let max = 0;
  for (const e of acc.values()) if (e.score > max) max = e.score;
  const ranked = [...acc.entries()].map(([id, e]) => ({
    id,
    scope: e.scope,
    score: e.score / max,
  }));
  ranked.sort(
    (a, b) => b.score - a.score || a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id),
  );
  return { ranked, federated, alsoMatched };
}

/** The per-scope scoring hooks `rankScopesAndFuse` drives — the caller owns
 * the actual lexical math and graph walk (they need its corpus state); this
 * module owns the orchestration so the shape of "rank per scope, then fuse"
 * lives in one place. */
export interface ScopeRankOps {
  /** Lexical scores for the scope's own docs (positive entries only),
   * computed against the scope's OWN corpus statistics. */
  lex(scope: string): Map<string, number>;
  /** The match-STRENGTH signal for the participation gate, evaluated at one
   * doc id within `scope` (always called on that scope's raw-lex top doc):
   * `coverage` is the idf-weighted matched share over name+path+body;
   * `coverageStrong` is the same over NAME only, with file-kind nodes
   * contributing zero (see `strongShare` in `src/ask/ask.ts`, the function
   * this must be backed by). Computed against the scope's own per-scope idf,
   * same as `lex`. */
  strength(scope: string, id: string): { coverage: number; coverageStrong: number };
  /** Graph walk restricted to the scope's subgraph, seeded by that scope's
   * lexical scores; returns top-normalized centrality (or an empty map). */
  walk(scope: string, seeds: Map<string, number>): Map<string, number>;
}

/**
 * Multi-scope orchestration for `ask`'s symbol ranking: for each scope, score
 * lexically, gate by match STRENGTH (not a lenient ratio), walk the scope's
 * subgraph, blend exactly like the single-scope path (`lexN +
 * graphWeight·pr`, both per-scope-normalized; walk-rescued nodes join above
 * `rescueFloor`), then fuse the surviving scopes' blended lists with
 * {@link fuseScopes}. A scope with zero lexical matches contributes nothing
 * (no seeds → no walk → no docs).
 *
 * The gate is the SAME two-floor signal `federateAsk` (workspace federation,
 * `src/graph/workspace.ts`) uses: a scope participates iff its top hit's
 * `coverageStrong` ≥ {@link STRONG_FLOOR} OR its `coverage` ≥
 * {@link HIGH_FLOOR}. It is evaluated here, on each scope's raw-lex top doc,
 * BEFORE normalization/walk/blend — gated-out scopes never enter the
 * walk/blend/fuse pipeline at all, they go straight to `alsoMatched` with
 * their best raw-lex doc id. (`fuseScopes`'s own internal ratio gate still
 * runs on the survivors' already-normalized input afterward, but since every
 * survivor's blended top is ~1.0 by construction, that gate is now just a
 * no-op safety net rather than the real gate — the real gate is this one.)
 */
export function rankScopesAndFuse(
  scopes: string[],
  ops: ScopeRankOps,
  graphWeight: number,
  rescueFloor: number,
): FusionResult {
  // Pass 1: lexical scoring only, per scope.
  const lexByScope = new Map<string, Map<string, number>>();
  for (const scope of scopes) {
    const lex = ops.lex(scope);
    if (lex.size === 0) continue;
    lexByScope.set(scope, lex);
  }

  const alsoMatched: FusionResult["alsoMatched"] = [];
  const scoped: ScopedDoc[] = [];

  for (const [scope, lex] of lexByScope) {
    // Raw best (+ its doc id) for THIS scope, score desc / id asc — same
    // tiebreak fuseScopes uses, so the reported bestId is deterministic.
    let maxLex = 0;
    let bestId = "";
    for (const [id, v] of lex) {
      if (v > maxLex || (v === maxLex && id < bestId)) {
        maxLex = v;
        bestId = id;
      }
    }
    if (maxLex <= 0) continue; // no positive-scoring doc — contributes nothing

    const { coverage, coverageStrong } = ops.strength(scope, bestId);
    if (coverageStrong < STRONG_FLOOR && coverage < HIGH_FLOOR) {
      alsoMatched.push({ scope, bestId });
      continue; // excluded from fusion — no walk, no blend
    }

    // Pass 2: only surviving scopes pay for the graph walk + blend.
    const pr = ops.walk(scope, lex);
    const candidates = new Set(lex.keys());
    for (const [id, p] of pr) if (p >= rescueFloor) candidates.add(id);
    for (const id of candidates) {
      const lexN = maxLex > 0 ? (lex.get(id) ?? 0) / maxLex : 0;
      const blended = lexN + graphWeight * (pr.get(id) ?? 0);
      if (blended > 0) scoped.push({ id, scope, score: blended });
    }
  }

  // fuseScopes's own gate still runs on this (already-survivor, already-
  // normalized) input — left as-is per its pure-test contract; it's now
  // effectively a no-op safety net rather than the real gate.
  const fused = fuseScopes(scoped);
  return {
    ranked: fused.ranked,
    federated: fused.federated,
    alsoMatched: [...alsoMatched, ...fused.alsoMatched],
  };
}
