/**
 * Tests for the pure graph-traversal core: symbol resolution (bare name,
 * qualified id-suffix, last-segment fallback, `--in` filtering) and
 * callers/callees/impact edge walking.
 *
 * Uses a hand-built fixture graph (nodeStub/graphOf helpers, same pattern as
 * test/graphrank.test.ts) rather than a built repo, so the resolution
 * contract can be pinned down precisely without touching the filesystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSymbol, callersOf, calleesOf, impactOf, impactOfMany, impactOfFile } from "../src/graph/traverse.js";
import type { EdgeV1, GraphV1, NodeV1, Relation } from "../src/graph/types.js";

function nodeStub(partial: Partial<NodeV1> & { id: string }): NodeV1 {
  return {
    name: partial.id,
    kind: "function",
    path: partial.id.split("#")[0],
    span: "L1-L1",
    signature: null,
    exported: true,
    origin: "ast",
    body_hash: partial.id,
    summary_state: "pending",
    summary: null,
    crux: null,
    ...partial,
  };
}

function edge(source: string, target: string, relation: Relation = "calls"): EdgeV1 {
  return { source, target, relation, confidence: "extracted" };
}

function graphOf(nodes: NodeV1[], edges: EdgeV1[]): GraphV1 {
  return {
    meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: ["ts"] },
    nodes,
    edges,
  };
}

// ── Fixture ──────────────────────────────────────────────────────────────

const cacheGet = nodeStub({ id: "src/cache.ts#Cache.get", name: "get", kind: "method", path: "src/cache.ts" });
const widgetRender = nodeStub({
  id: "src/widget.ts#Widget.render",
  name: "render",
  kind: "method",
  path: "src/widget.ts",
});
const otherGet = nodeStub({ id: "src/other.ts#get", name: "get", kind: "function", path: "src/other.ts" });
const hashFn = nodeStub({ id: "pkg/hash.go#Hash", name: "Hash", kind: "function", path: "pkg/hash.go" });
const fileNode = nodeStub({ id: "src/file.ts", name: "file.ts", kind: "file", path: "src/file.ts" });

function baseGraph(): GraphV1 {
  return graphOf(
    [cacheGet, widgetRender, otherGet, hashFn, fileNode],
    [
      edge("src/cache.ts", "src/cache.ts#Cache.get", "contains"),
      edge("src/cache.ts#Cache.get", "src/widget.ts#Widget.render", "calls"),
      edge("src/cache.ts#Cache.get", "npm:lodash", "imports"),
    ],
  );
}

// ── resolveSymbol ────────────────────────────────────────────────────────

test("resolveSymbol: bare name match is case-insensitive", () => {
  const g = baseGraph();
  const matches = resolveSymbol(g, "RENDER");
  assert.deepEqual(matches.map((n) => n.id), ["src/widget.ts#Widget.render"]);
});

test("resolveSymbol: qualified Class.method resolves via id suffix", () => {
  const g = baseGraph();
  const matches = resolveSymbol(g, "Cache.get");
  assert.deepEqual(matches.map((n) => n.id), ["src/cache.ts#Cache.get"]);
});

test("resolveSymbol: last-segment fallback for a dotted package-qualified name", () => {
  const g = baseGraph();
  // "hashstructure.Hash" has no id-suffix match anywhere in the fixture — falls
  // back to matching the last dot-segment ("Hash") as a bare name.
  const matches = resolveSymbol(g, "hashstructure.Hash");
  assert.deepEqual(matches.map((n) => n.id), ["pkg/hash.go#Hash"]);
});

test("resolveSymbol: multi-match returns all matching nodes", () => {
  const g = baseGraph();
  const matches = resolveSymbol(g, "get");
  assert.deepEqual(
    matches.map((n) => n.id).sort(),
    ["src/cache.ts#Cache.get", "src/other.ts#get"].sort(),
  );
});

test("resolveSymbol: --in filters candidates by path substring", () => {
  const g = baseGraph();
  const matches = resolveSymbol(g, "get", { in: "cache" });
  assert.deepEqual(matches.map((n) => n.id), ["src/cache.ts#Cache.get"]);
});

test("resolveSymbol: kind:'file' nodes are excluded when a symbol matches", () => {
  const g = baseGraph();
  // "file.ts" also happens to be the file node's name; "ts" isn't a symbol name
  // so it should not spuriously match anything, but the point being tested is
  // that when a real symbol match exists, file nodes never surface. Use a
  // symbol query instead to keep the assertion about exclusion meaningful:
  const matches = resolveSymbol(g, "render");
  assert.ok(matches.every((n) => n.kind !== "file"));
});

test("resolveSymbol: file nodes are matched as a last resort for filename-shaped queries", () => {
  const g = baseGraph();
  const matches = resolveSymbol(g, "file.ts");
  assert.deepEqual(matches.map((n) => n.id), ["src/file.ts"]);
});

test("resolveSymbol: unknown symbol returns empty array", () => {
  const g = baseGraph();
  assert.deepEqual(resolveSymbol(g, "NoSuchSymbol"), []);
});

// ── callersOf / calleesOf ────────────────────────────────────────────────

test("calleesOf: walks outgoing walk-relation edges, keeping unresolved targets", () => {
  const g = baseGraph();
  const hits = calleesOf(g, cacheGet);
  const byId = new Map(hits.map((h) => [h.id, h]));

  assert.equal(hits.length, 2);
  assert.equal(byId.get("src/widget.ts#Widget.render")?.node?.id, "src/widget.ts#Widget.render");
  assert.equal(byId.get("src/widget.ts#Widget.render")?.relation, "calls");
  assert.equal(byId.get("src/widget.ts#Widget.render")?.depth, 1);

  const unresolved = byId.get("npm:lodash");
  assert.ok(unresolved, "unresolved import target is kept");
  assert.equal(unresolved!.node, null);
  assert.equal(unresolved!.relation, "imports");
  assert.equal(unresolved!.depth, 1);
});

test("callersOf: finds incoming walk-relation edges, excludes 'contains'", () => {
  const g = baseGraph();
  const hits = callersOf(g, widgetRender);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "src/cache.ts#Cache.get");
  assert.equal(hits[0].node?.id, "src/cache.ts#Cache.get");
  assert.equal(hits[0].relation, "calls");
  assert.equal(hits[0].depth, 1);

  // The file that "contains" cacheGet must never show up as a caller.
  const containsCallers = callersOf(g, cacheGet);
  assert.deepEqual(containsCallers, []);
});

test("callersOf / calleesOf: no edges → empty array", () => {
  const g = baseGraph();
  assert.deepEqual(callersOf(g, hashFn), []);
  assert.deepEqual(calleesOf(g, hashFn), []);
});

// ── impactOf ─────────────────────────────────────────────────────────────

function diamondGraph(): GraphV1 {
  const X = nodeStub({ id: "X", name: "X" });
  const A = nodeStub({ id: "A", name: "A" });
  const B = nodeStub({ id: "B", name: "B" });
  const C = nodeStub({ id: "C", name: "C" });
  return {
    node: X,
    graph: graphOf(
      [X, A, B, C],
      [edge("A", "X", "calls"), edge("B", "X", "calls"), edge("C", "A", "calls"), edge("C", "B", "calls")],
    ),
  } as unknown as { node: NodeV1; graph: GraphV1 };
}

test("impactOf: BFS over incoming edges, diamond converges to one hit, deduped at min depth", () => {
  const { node: X, graph } = diamondGraph();
  const hits = impactOf(graph, X, 2);
  const byId = new Map(hits.map((h) => [h.id, h]));

  assert.equal(hits.length, 3, "A, B at depth 1, C once at depth 2 — not twice");
  assert.equal(byId.get("A")?.depth, 1);
  assert.equal(byId.get("B")?.depth, 1);
  assert.equal(byId.get("C")?.depth, 2);
});

test("impactOf: depth cap is respected", () => {
  const { node: X, graph } = diamondGraph();
  const hits = impactOf(graph, X, 1);
  assert.deepEqual(
    hits.map((h) => h.id).sort(),
    ["A", "B"],
  );
});

test("impactOf: default maxDepth is 2", () => {
  const { node: X, graph } = diamondGraph();
  const hits = impactOf(graph, X);
  assert.deepEqual(
    hits.map((h) => h.id).sort(),
    ["A", "B", "C"],
  );
});

test("impactOf: no incoming edges → empty array", () => {
  const g = baseGraph();
  assert.deepEqual(impactOf(g, hashFn), []);
});

// ── impactOfMany / impactOfFile ─────────────────────────────────────────────

/** b.ts imports a.ts (file-level `imports` edge, target = the FILE id) AND
 * calls `helper`, a function defined in a.ts (`calls` edge, target = the
 * SYMBOL id) — the exact shape that regresses a file-scope blast radius that
 * only walks the file node: the `calls` edge is invisible from there. */
function fileAndSymbolGraph() {
  const fileA = nodeStub({ id: "src/a.ts", name: "a.ts", kind: "file", path: "src/a.ts" });
  const helper = nodeStub({ id: "src/a.ts#helper", name: "helper", kind: "function", path: "src/a.ts" });
  const fileB = nodeStub({ id: "src/b.ts", name: "b.ts", kind: "file", path: "src/b.ts" });
  const useB = nodeStub({ id: "src/b.ts#useB", name: "useB", kind: "function", path: "src/b.ts" });
  const graph = graphOf(
    [fileA, helper, fileB, useB],
    [edge("src/b.ts", "src/a.ts", "imports"), edge("src/b.ts#useB", "src/a.ts#helper", "calls")],
  );
  return { fileA, helper, fileB, useB, graph };
}

test("impactOfMany: aggregating over [file, symbol] seeds finds both the importing file and the calling symbol", () => {
  const { fileA, helper, graph } = fileAndSymbolGraph();

  // Walking the file node alone (today's behavior for a file-kind match) sees
  // only the file-level `imports` edge — the `calls` edge targets the symbol
  // id, so it's invisible from here. This is the regression.
  const fileOnly = impactOf(graph, fileA);
  assert.deepEqual(fileOnly.map((h) => h.id), ["src/b.ts"]);

  // impactOfMany over [file, symbol] recovers both dependents.
  const hits = impactOfMany(graph, [fileA, helper], 2);
  assert.deepEqual(hits.map((h) => h.id).sort(), ["src/b.ts", "src/b.ts#useB"]);
  const byId = new Map(hits.map((h) => [h.id, h]));
  assert.equal(byId.get("src/b.ts")?.relation, "imports");
  assert.equal(byId.get("src/b.ts#useB")?.relation, "calls");
});

test("impactOfMany: seeds are excluded from their own results and cross-seed convergence dedups at the min depth", () => {
  const A = nodeStub({ id: "A", name: "A" });
  const B = nodeStub({ id: "B", name: "B" });
  const C = nodeStub({ id: "C", name: "C" });
  // C calls into both A and B — a hit reached from two different seeds at the
  // same depth must still be reported once.
  const g = graphOf([A, B, C], [edge("C", "A", "calls"), edge("C", "B", "calls")]);
  const hits = impactOfMany(g, [A, B], 2);
  assert.deepEqual(hits.map((h) => h.id), ["C"]);
  assert.equal(hits[0].depth, 1);
});

test("impactOfMany: impactOf(g, n, d) is the single-seed special case", () => {
  const { node: X, graph } = diamondGraph();
  assert.deepEqual(impactOfMany(graph, [X], 2), impactOf(graph, X, 2));
});

test("impactOfFile: aggregates over the file node and every symbol node it defines", () => {
  const { fileA, graph } = fileAndSymbolGraph();
  const hits = impactOfFile(graph, fileA, 2);
  assert.deepEqual(hits.map((h) => h.id).sort(), ["src/b.ts", "src/b.ts#useB"]);
});

test("impactOfFile: with no symbol nodes in the file, behaves exactly like impactOf on the file node", () => {
  const g = baseGraph();
  assert.deepEqual(impactOfFile(g, fileNode, 2), impactOf(g, fileNode, 2));
});
