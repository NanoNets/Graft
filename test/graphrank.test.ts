/**
 * Tests for the graph-rank re-ranking stage of `graft ask`.
 *
 * The unit tests exercise {@link personalizedPageRank} directly on hand-built
 * graphs; the integration tests drive the whole `ask` path on real fixtures
 * built by {@link buildGraph}, proving the keyword-collision fix end-to-end:
 * a lexically-matched but structurally isolated node is demoted below a
 * lexically-equal node that is wired into the query's cluster, and strongly
 * connected neighbours the query never named are rescued into the results.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { ask } from "../src/ask/ask.js";
import { personalizedPageRank } from "../src/ask/graphrank.js";
import type { GraphV1, NodeV1, EdgeV1, Relation } from "../src/graph/types.js";

// ── Unit: personalizedPageRank ───────────────────────────────────────────────

function node(id: string): NodeV1 {
  return {
    id,
    name: id,
    kind: "function",
    path: `${id}.ts`,
    span: "L1-L1",
    signature: null,
    exported: true,
    origin: "ast",
    body_hash: id,
    summary_state: "pending",
    summary: null,
    crux: null,
  };
}
function edge(source: string, target: string, relation: Relation = "calls"): EdgeV1 {
  return { source, target, relation, confidence: "extracted" };
}
function graphOf(nodes: string[], edges: EdgeV1[]): GraphV1 {
  return {
    meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: ["ts"] },
    nodes: nodes.map(node),
    edges,
  };
}

test("PageRank: a seed wired to the cluster outranks an isolated seed", () => {
  // hub calls a, b, c; lone is a disconnected seed with equal restart weight.
  const g = graphOf(
    ["hub", "a", "b", "c", "lone"],
    [edge("hub", "a"), edge("hub", "b"), edge("hub", "c")],
  );
  const pr = personalizedPageRank(g, new Map([["hub", 1], ["lone", 1]]));
  assert.ok((pr.get("hub") ?? 0) > (pr.get("lone") ?? 0), "connected seed beats isolated seed");
  assert.equal([...pr.values()].some((v) => v === 1), true, "top node normalized to 1");
});

test("PageRank: neighbours of a seed accrue mass even with zero restart weight", () => {
  const g = graphOf(["hub", "a", "b"], [edge("hub", "a"), edge("hub", "b")]);
  const pr = personalizedPageRank(g, new Map([["hub", 1]]));
  assert.ok((pr.get("a") ?? 0) > 0, "a neighbour of the only seed gets walk mass");
  assert.ok((pr.get("b") ?? 0) > 0);
});

test("PageRank: empty or all-zero seeds yield an empty map", () => {
  const g = graphOf(["a", "b"], [edge("a", "b")]);
  assert.equal(personalizedPageRank(g, new Map()).size, 0);
  assert.equal(personalizedPageRank(g, new Map([["a", 0]])).size, 0);
});

test("PageRank: edges to non-node targets (unresolved imports) are ignored", () => {
  // "react" is an import module string, not a node id — must not crash or count.
  const g = graphOf(["a"], [edge("a", "react", "imports")]);
  const pr = personalizedPageRank(g, new Map([["a", 1]]));
  assert.equal(pr.get("a"), 1, "sole seed with no real neighbours stays at 1");
  assert.equal(pr.has("react"), false, "the module string never becomes a ranked node");
});

// ── Integration: ask() with and without graph-rank ──────────────────────────

/** A fixture with a same-word collision: `fooHandler` (wired to two helpers)
 * and `fooWidget` (isolated) both match the token "foo" equally. */
function makeCollisionFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-graphrank-"));
  writeFileSync(
    join(dir, "connected.ts"),
    `export function fooHandler() {\n  helperAlpha();\n  helperBeta();\n}\n` +
      `export function helperAlpha() { return 1; }\n` +
      `export function helperBeta() { return 2; }\n`,
  );
  writeFileSync(join(dir, "isolated.ts"), `export function fooWidget() { return 0; }\n`);
  return dir;
}

const rank = (dir: string, gr: boolean) =>
  ask(dir, "foo", { graphRank: gr }).hits.map((h) => h.title.split(" ·")[0]);

test("ask (graphRank off): pure lexical does not favour the connected hit", async () => {
  const dir = makeCollisionFixture();
  try {
    await buildGraph(dir);
    const titles = rank(dir, false);
    // Both same-word hits are present, no un-matched helper is rescued, and —
    // the key point — connectivity plays no role: the graph-connected fooHandler
    // is NOT lifted above the isolated fooWidget on pure lexical scoring.
    assert.ok(titles.includes("fooHandler") && titles.includes("fooWidget"));
    assert.ok(!titles.includes("helperAlpha"), "no rescue without graph-rank");
    assert.ok(
      titles.indexOf("fooHandler") >= titles.indexOf("fooWidget"),
      "without graph-rank the connected hit gets no ranking advantage",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask (graphRank on): connected hit outranks the isolated collision", async () => {
  const dir = makeCollisionFixture();
  try {
    await buildGraph(dir);
    const titles = rank(dir, true);
    const iHandler = titles.indexOf("fooHandler");
    const iWidget = titles.indexOf("fooWidget");
    assert.ok(iHandler >= 0 && iWidget >= 0, "both same-word hits still present");
    assert.ok(iHandler < iWidget, "the graph-connected fooHandler ranks above isolated fooWidget");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask (graphRank on): a strongly-connected neighbour is rescued in", async () => {
  const dir = makeCollisionFixture();
  try {
    await buildGraph(dir);
    const titles = rank(dir, true);
    // helperAlpha/helperBeta never contain "foo", but are called by the matched
    // fooHandler — graph-rank surfaces them so the agent gets the whole cluster.
    assert.ok(
      titles.includes("helperAlpha") || titles.includes("helperBeta"),
      "a helper the query never named is rescued via connectivity",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask: graph-rank is on by default (same as graphRank:true)", async () => {
  const dir = makeCollisionFixture();
  try {
    await buildGraph(dir);
    const def = ask(dir, "foo").hits.map((h) => h.title);
    const on = ask(dir, "foo", { graphRank: true }).hits.map((h) => h.title);
    assert.deepEqual(def, on, "default ordering equals explicit graphRank:true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
