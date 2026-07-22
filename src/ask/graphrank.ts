/**
 * Graph-rank re-ranking for `graft ask` — the fix for lexical keyword-collision.
 *
 * Pure term-overlap ranking treats every node independently, so a node that
 * merely shares a word with the query (a window "overlay" widget) can outrank
 * the node the query is actually about (a scroll-"overlay" config) purely on
 * word count. The graph knows better: the right node is the one wired into the
 * cluster of code the query touches.
 *
 * This module runs personalized PageRank (random-walk-with-restart) over the
 * wiring graph, seeded by the lexical scores. Mass concentrates on nodes that
 * are edge-connected to the matched set; a lexically-matched but structurally
 * isolated node keeps only its own restart mass and sinks. "Lexical proposes,
 * graph disposes." Deterministic, $0, no embeddings — a lexical-seed →
 * graph-rank pipeline, the established alternative to vector search for code.
 */
import type { GraphV1 } from "../graph/types.js";
import { WALK_RELATIONS } from "../graph/relations.js";

export interface PageRankOptions {
  /** Restart probability — the mass that teleports back to the seed set each
   * step. Higher keeps the walk closer to the seeds. 0.25 is the standard value. */
  alpha?: number;
  /** Power-iteration count. 25 is plenty to converge on graphs this size. */
  iters?: number;
}

/**
 * Personalized PageRank over the wiring graph.
 *
 * `seeds` maps node id → restart weight (a node's lexical score; only positive
 * weights matter). The graph is treated as UNDIRECTED — for "understand this
 * area" a callee is as relevant as a caller. Returns a score per node
 * normalized so the top node is 1; nodes untouched by the walk are absent.
 *
 * Edges whose endpoints aren't both real nodes (e.g. an unresolved import
 * module string) are ignored, so only genuine symbol-to-symbol wiring counts.
 */
export function personalizedPageRank(
  graph: GraphV1,
  seeds: Map<string, number>,
  opts: PageRankOptions = {},
): Map<string, number> {
  const alpha = opts.alpha ?? 0.25;
  const iters = opts.iters ?? 25;

  const ids = new Set(graph.nodes.map((n) => n.id));

  // Undirected adjacency over walk relations, endpoints restricted to real nodes.
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  };
  for (const e of graph.edges) {
    if (!WALK_RELATIONS.has(e.relation)) continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }

  // Restart distribution: seed weights, restricted to real nodes, normalized.
  let seedTotal = 0;
  for (const [id, w] of seeds) if (ids.has(id) && w > 0) seedTotal += w;
  if (seedTotal <= 0) return new Map();
  const restart = new Map<string, number>();
  for (const [id, w] of seeds)
    if (ids.has(id) && w > 0) restart.set(id, w / seedTotal);

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

  let max = 0;
  for (const v of rank.values()) if (v > max) max = v;
  if (max <= 0) return new Map();
  const out = new Map<string, number>();
  for (const [id, v] of rank) out.set(id, v / max);
  return out;
}
