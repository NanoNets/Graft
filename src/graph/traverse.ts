/**
 * Pure graph-traversal core shared by `graft callers` (its `--direction`/
 * `--depth` flags), the MCP `graft_callers` tool, and `ask`'s structural
 * intent path.
 *
 * Centralizes the symbol-resolution contract (bare name, qualified id-suffix,
 * last-segment fallback, `--in` narrowing) so all surfaces agree on what a
 * query like `Cache.get` or `hashstructure.Hash` means, and the direction-aware
 * (incoming/outgoing) depth-1 and BFS edge walks over the wiring graph.
 *
 * No I/O here: callers pass in an already-loaded `GraphV1` (via
 * `loadGraphCached`), which keeps this module trivially unit-testable against
 * hand-built fixture graphs.
 */
import type { EdgeV1, GraphV1, NodeV1, Relation } from "./types.js";
import { WALK_RELATIONS } from "./relations.js";

/** Which way to walk the wiring graph: `in` = incoming edges (who points at
 * the symbol — callers / blast radius), `out` = outgoing edges (what the symbol
 * points at — callees). */
export type Direction = "in" | "out";

/** A resolved symbol-search hit. Reserved for future disambiguation metadata
 * (e.g. why a query matched); today it wraps the node 1:1. */
export interface SymbolMatch {
  node: NodeV1;
}

export interface ResolveSymbolOptions {
  /** Narrow candidates to nodes whose `path` contains this substring. */
  in?: string;
}

/**
 * Resolve a query string to every matching node in the graph.
 *
 * Matching, in order:
 *  1. Non-file nodes whose `name` equals the query case-insensitively, OR
 *     whose `id` ends with `#<query>` or `.<query>` case-insensitively — this
 *     is what makes a qualified name like `Cache.get` resolve against an id
 *     like `src/cache.ts#Cache.get`.
 *  2. If that yields nothing and the query contains a `.`, retry with just
 *     the last dot-segment as a bare name (`hashstructure.Hash` → `Hash`) —
 *     covers package-qualified names (e.g. Go) whose id never contains the
 *     package prefix.
 *  3. If *that* still yields nothing and the query looks like a filename
 *     (contains `.`, no `#`), fall back to `kind: 'file'` nodes matched by
 *     name or path.
 *
 * `opts.in` then filters whichever candidate set was produced, by path
 * substring. Multiple matches are not an error — every match is returned.
 */
export function resolveSymbol(graph: GraphV1, query: string, opts: ResolveSymbolOptions = {}): NodeV1[] {
  const lowerQuery = query.toLowerCase();
  const looksLikeFilename = query.includes(".") && !query.includes("#");

  let matches = symbolMatches(graph.nodes, lowerQuery);

  if (matches.length === 0 && query.includes(".")) {
    const lastSegment = query.slice(query.lastIndexOf(".") + 1).toLowerCase();
    if (lastSegment) {
      matches = graph.nodes.filter((n) => n.kind !== "file" && n.name.toLowerCase() === lastSegment);
    }
  }

  if (matches.length === 0 && looksLikeFilename) {
    matches = graph.nodes.filter(
      (n) =>
        n.kind === "file" &&
        (n.name.toLowerCase() === lowerQuery ||
          n.path.toLowerCase() === lowerQuery ||
          n.path.toLowerCase().endsWith("/" + lowerQuery)),
    );
  }

  if (opts.in) matches = matches.filter((n) => n.path.includes(opts.in!));
  return matches;
}

function symbolMatches(nodes: NodeV1[], lowerQuery: string): NodeV1[] {
  const suffixHash = "#" + lowerQuery;
  const suffixDot = "." + lowerQuery;
  return nodes.filter((n) => {
    if (n.kind === "file") return false;
    if (n.name.toLowerCase() === lowerQuery) return true;
    const lowerId = n.id.toLowerCase();
    return lowerId.endsWith(suffixHash) || lowerId.endsWith(suffixDot);
  });
}

/** One traversed edge. `node` is null when the edge's other endpoint isn't a
 * real node in the graph (e.g. an unresolved import module string) — such
 * hits are kept, labeled by the raw id, rather than dropped. */
export interface EdgeHit {
  node: NodeV1 | null;
  id: string;
  relation: Relation;
  depth: number;
}

/** Depth-1: nodes with a walk-relation edge whose target is `symbol`. */
export function callersOf(graph: GraphV1, symbol: NodeV1): EdgeHit[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hits: EdgeHit[] = [];
  for (const e of graph.edges as EdgeV1[]) {
    if (!WALK_RELATIONS.has(e.relation) || e.target !== symbol.id) continue;
    hits.push({ node: byId.get(e.source) ?? null, id: e.source, relation: e.relation, depth: 1 });
  }
  return hits;
}

/** Depth-1: walk-relation edges whose source is `symbol`. */
export function calleesOf(graph: GraphV1, symbol: NodeV1): EdgeHit[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hits: EdgeHit[] = [];
  for (const e of graph.edges as EdgeV1[]) {
    if (!WALK_RELATIONS.has(e.relation) || e.source !== symbol.id) continue;
    hits.push({ node: byId.get(e.target) ?? null, id: e.target, relation: e.relation, depth: 1 });
  }
  return hits;
}

/**
 * BFS over INCOMING walk-relation edges from `symbol`, up to `maxDepth` hops
 * — "who breaks if this changes". Each reached node is deduped by id and
 * reported once, at the depth it was first reached (a diamond-shaped
 * dependency graph counts its convergence node exactly once).
 */
export function impactOf(graph: GraphV1, symbol: NodeV1, maxDepth = 2): EdgeHit[] {
  return impactOfMany(graph, [symbol], maxDepth);
}

/**
 * BFS over walk-relation edges from *multiple* seed nodes at once, in the given
 * `direction` (`in` = incoming, the default — "who breaks if this changes";
 * `out` = outgoing — "what this reaches"). The multi-seed generalization of
 * {@link impactOf} (`impactOf(g, n, d)` is exactly `impactOfMany(g, [n], d)`).
 * Used when one logical unit spans several graph node ids — e.g. a file plus
 * every symbol defined in it, since a `calls`/`references`/etc. edge from
 * another file always targets the SYMBOL id, never the FILE id, so walking the
 * file node alone misses dependents that call into it rather than merely
 * importing it.
 *
 * Every seed is pre-marked visited (so a seed can never appear as its own
 * hit, and an edge between two seeds is never reported), then the walk
 * proceeds exactly like `impactOf`'s: each reached node deduped by id and
 * reported once, at the depth it was first reached from *any* seed.
 */
export function impactOfMany(graph: GraphV1, seeds: NodeV1[], maxDepth = 2, direction: Direction = "in"): EdgeHit[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Adjacency keyed for the walk direction, restricted to walk relations:
  //   'in'  → key = edge.target, neighbour = edge.source (who points AT key)
  //   'out' → key = edge.source, neighbour = edge.target (what key points TO)
  const adj = new Map<string, { other: string; relation: Relation }[]>();
  for (const e of graph.edges as EdgeV1[]) {
    if (!WALK_RELATIONS.has(e.relation)) continue;
    const key = direction === "in" ? e.target : e.source;
    const other = direction === "in" ? e.source : e.target;
    const entry = { other, relation: e.relation };
    const arr = adj.get(key);
    if (arr) arr.push(entry);
    else adj.set(key, [entry]);
  }

  const visited = new Set<string>(seeds.map((s) => s.id));
  const hits: EdgeHit[] = [];
  let frontier = [...visited];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const { other, relation } of adj.get(current) ?? []) {
        if (visited.has(other)) continue;
        visited.add(other);
        hits.push({ node: byId.get(other) ?? null, id: other, relation, depth });
        next.push(other);
      }
    }
    frontier = next;
  }

  return hits;
}

/** Every non-file node whose `path` equals `fileNode.path` — the symbols
 * defined in that file. */
function symbolsInFile(graph: GraphV1, fileNode: NodeV1): NodeV1[] {
  return graph.nodes.filter((n) => n.kind !== "file" && n.path === fileNode.path);
}

/**
 * `impactOf`, generalized for a `kind: 'file'` seed: aggregates the BFS over
 * the file node AND every symbol node defined in that file (via
 * {@link impactOfMany} — dedup by id, min depth, seeds excluded). Fixes a file
 * query silently dropping dependents that `calls`/`references`/etc. into a
 * symbol the file defines, rather than merely `imports`-ing the file itself —
 * see this module's header and `impactOfMany`'s doc for why. Symbol-kind
 * queries keep using plain `impactOf`; this is only for file-kind matches.
 */
export function impactOfFile(graph: GraphV1, fileNode: NodeV1, maxDepth = 2, direction: Direction = "in"): EdgeHit[] {
  return impactOfMany(graph, [fileNode, ...symbolsInFile(graph, fileNode)], maxDepth, direction);
}

/**
 * The single entry point behind `graft callers` and the MCP `graft_callers`
 * tool, covering all of what were once three commands:
 *   - `direction:in,  depth:1`  → callers      (who calls/references this)
 *   - `direction:out, depth:1`  → callees      (what this calls/references)
 *   - `direction:in,  depth>1`  → blast radius  (transitive dependents)
 *   - `direction:out, depth>1`  → transitive dependencies
 *
 * Depth 1 uses the plain single-hop scan ({@link callersOf}/{@link calleesOf})
 * so `graft callers <symbol>` output is unchanged. Depth >1 runs the BFS, and
 * for a `kind: 'file'` seed aggregates over the symbols the file defines (see
 * {@link impactOfMany}) so file-level dependents aren't silently dropped.
 */
export function edgeWalk(graph: GraphV1, node: NodeV1, direction: Direction, depth: number): EdgeHit[] {
  if (depth <= 1) return direction === "in" ? callersOf(graph, node) : calleesOf(graph, node);
  if (node.kind === "file") return impactOfFile(graph, node, depth, direction);
  return impactOfMany(graph, [node], depth, direction);
}
