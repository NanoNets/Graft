/**
 * Tests for `graft map`'s pure core: {@link buildRepoMap} + {@link formatRepoMap}.
 *
 * All fixtures are hand-built `GraphV1` graphs (no real repo, no `buildGraph`)
 * — same `nodeStub`/`graphOf` pattern as test/graphrank.test.ts, extended
 * with a `path`/`kind`/`span` so directory grouping and hub ranking have
 * something to chew on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepoMap, formatRepoMap } from "../src/graph/map.js";
import type { GraphV1, NodeV1, EdgeV1, Kind, Relation } from "../src/graph/types.js";

let counter = 0;

function fileNode(path: string): NodeV1 {
  return {
    id: path,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "file",
    path,
    span: "L1-L1",
    signature: null,
    exported: true,
    origin: "ast",
    body_hash: `h${counter++}`,
    summary_state: "pending",
    summary: null,
    crux: null,
  };
}

function symNode(path: string, name: string, opts: { kind?: Kind; span?: string } = {}): NodeV1 {
  const id = `${path}#${name}`;
  return {
    id,
    name,
    kind: opts.kind ?? "function",
    path,
    span: opts.span ?? "L1-L10",
    signature: `${name}()`,
    exported: true,
    origin: "ast",
    body_hash: `h${counter++}`,
    summary_state: "pending",
    summary: null,
    crux: null,
  };
}

function edge(source: string, target: string, relation: Relation = "calls"): EdgeV1 {
  return { source, target, relation, confidence: "extracted" };
}

function graphOf(nodes: NodeV1[], edges: EdgeV1[]): GraphV1 {
  return {
    meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: [] },
    nodes,
    edges,
  };
}

// ── totals ────────────────────────────────────────────────────────────────

test("buildRepoMap: totals count files, symbols, edges, and languages across the whole graph", () => {
  const nodes = [
    fileNode("src/a.ts"),
    symNode("src/a.ts", "fnA"),
    fileNode("docs/readme.py"), // deliberately mixed languages
    symNode("docs/readme.py", "fnB"),
  ];
  const edges = [edge("src/a.ts#fnA", "docs/readme.py#fnB")];
  const map = buildRepoMap(graphOf(nodes, edges));

  assert.equal(map.totals.files, 2);
  assert.equal(map.totals.symbols, 2);
  assert.equal(map.totals.edges, 1);
  assert.deepEqual(map.totals.languages, ["python", "typescript"]);
});

test("buildRepoMap: dirs are grouped by first path segment and sorted by symbol count desc", () => {
  const nodes = [
    fileNode("alpha/a.ts"),
    symNode("alpha/a.ts", "one"),
    fileNode("beta/b.ts"),
    symNode("beta/b.ts", "two"),
    symNode("beta/b.ts", "three"),
  ];
  const map = buildRepoMap(graphOf(nodes, []));

  assert.deepEqual(map.dirs.map((d) => d.path), ["beta", "alpha"], "beta has more symbols, sorts first");
  const beta = map.dirs.find((d) => d.path === "beta")!;
  assert.equal(beta.files, 1);
  assert.equal(beta.symbols, 2);
});

// ── >60% split refinement ────────────────────────────────────────────────

test("buildRepoMap: a segment holding >60% of file nodes is split one level deeper", () => {
  // 7 of 10 files under src/ (70% > 60%) → src/ask, src/graph split out.
  // tests/ (3 files, 30%) stays a single depth-1 group.
  const nodes = [
    fileNode("src/ask/a1.ts"),
    fileNode("src/ask/a2.ts"),
    fileNode("src/ask/a3.ts"),
    fileNode("src/ask/a4.ts"),
    fileNode("src/graph/g1.ts"),
    fileNode("src/graph/g2.ts"),
    fileNode("src/graph/g3.ts"),
    fileNode("tests/t1.ts"),
    fileNode("tests/t2.ts"),
    fileNode("tests/t3.ts"),
  ];
  const map = buildRepoMap(graphOf(nodes, []));
  const paths = map.dirs.map((d) => d.path);

  assert.ok(!paths.includes("src"), "the over-threshold group itself must not survive unsplit");
  assert.ok(paths.includes("src/ask"), "split refines src into its sub-segments");
  assert.ok(paths.includes("src/graph"));
  assert.ok(paths.includes("tests"), "a group under threshold is untouched");

  const ask = map.dirs.find((d) => d.path === "src/ask")!;
  assert.equal(ask.files, 4);
  const graphDir = map.dirs.find((d) => d.path === "src/graph")!;
  assert.equal(graphDir.files, 3);
});

test("buildRepoMap: a segment at or below 60% is not split", () => {
  const nodes = [
    fileNode("src/a.ts"),
    fileNode("src/b.ts"),
    fileNode("src/c.ts"), // src: 3/5 = 60%, not > 60%
    fileNode("tests/t1.ts"),
    fileNode("tests/t2.ts"),
  ];
  const map = buildRepoMap(graphOf(nodes, []));
  assert.ok(map.dirs.some((d) => d.path === "src"), "60% exactly must not trigger the split");
});

// ── hub ordering ─────────────────────────────────────────────────────────

test("buildRepoMap: hubs within a dir are ranked by inDegree desc, ties broken by name asc", () => {
  const nodes = [
    fileNode("lib/x.ts"),
    symNode("lib/x.ts", "zebra", { kind: "function" }),
    symNode("lib/x.ts", "apple", { kind: "function" }),
    symNode("lib/x.ts", "mango", { kind: "function" }),
    // An unrelated dir so "lib" doesn't trivially hold 100% of file nodes
    // and trip the >60% split refinement this test isn't exercising.
    fileNode("other/y.ts"),
  ];
  const edges = [
    // zebra: 2 inbound; apple: 2 inbound (tie, name asc must put apple first); mango: 1 inbound.
    edge("lib/x.ts#caller1", "lib/x.ts#zebra"),
    edge("lib/x.ts#caller2", "lib/x.ts#zebra"),
    edge("lib/x.ts#caller1", "lib/x.ts#apple"),
    edge("lib/x.ts#caller2", "lib/x.ts#apple"),
    edge("lib/x.ts#caller1", "lib/x.ts#mango"),
  ];
  const map = buildRepoMap(graphOf(nodes, edges));
  const lib = map.dirs.find((d) => d.path === "lib")!;

  assert.deepEqual(
    lib.hubs.map((h) => h.name),
    ["apple", "zebra", "mango"],
    "tied inDegree (apple, zebra) breaks by name asc; mango (lower inDegree) last",
  );
  assert.equal(lib.hubs[0].inDegree, 2);
});

test("buildRepoMap: hotspots rank globally by inDegree, ties broken by name asc, capped by opts.hotspots", () => {
  const nodes = [fileNode("a/x.ts"), fileNode("b/y.ts")];
  const names = ["zeta", "beta", "gamma", "alpha"];
  for (const n of names) nodes.push(symNode("a/x.ts", n));
  const edges: EdgeV1[] = [];
  // Every symbol gets exactly 1 inbound edge (tie) except "beta" which gets 2.
  for (const n of names) edges.push(edge("b/y.ts#caller", `a/x.ts#${n}`));
  edges.push(edge("b/y.ts#caller2", "a/x.ts#beta"));

  const map = buildRepoMap(graphOf(nodes, edges), { hotspots: 2 });
  assert.equal(map.hotspots.length, 2, "capped by opts.hotspots");
  assert.equal(map.hotspots[0].name, "beta", "beta has the highest inDegree");
  assert.equal(map.hotspots[1].name, "alpha", "remaining tie broken by name asc");
});

test("buildRepoMap: symbols with zero inbound edges are never listed as hubs or hotspots", () => {
  const nodes = [fileNode("lib/x.ts"), symNode("lib/x.ts", "lonely"), fileNode("other/y.ts")];
  const map = buildRepoMap(graphOf(nodes, []));
  const lib = map.dirs.find((d) => d.path === "lib")!;
  assert.equal(lib.hubs.length, 0);
  assert.equal(map.hotspots.length, 0);
});

// ── dropped-dirs cap ─────────────────────────────────────────────────────

test("buildRepoMap: dirs beyond maxDirs are capped and counted into dropped", () => {
  const nodes: NodeV1[] = [];
  for (const dir of ["a", "b", "c", "d", "e"]) {
    nodes.push(fileNode(`${dir}/x.ts`));
  }
  const map = buildRepoMap(graphOf(nodes, []), { maxDirs: 2 });
  assert.equal(map.dirs.length, 2);
  assert.equal(map.dropped, 3);
});

// ── formatRepoMap ────────────────────────────────────────────────────────

/** 60-node-ish fixture: a handful of dirs, each with several hub-worthy
 * symbols, enough edges to build up inDegree without exploding sizes. */
function bigFixture(): GraphV1 {
  const nodes: NodeV1[] = [];
  const edges: EdgeV1[] = [];
  const dirs = ["alpha", "beta", "gamma", "delta"];
  for (const dir of dirs) {
    for (let f = 0; f < 3; f++) {
      const path = `${dir}/file${f}.ts`;
      nodes.push(fileNode(path));
      for (let s = 0; s < 4; s++) {
        const name = `${dir}Sym${f}_${s}`;
        nodes.push(symNode(path, name));
        // Give the first symbol in each file a bunch of callers so it's a hub.
        if (s === 0) {
          for (let c = 0; c < 5; c++) edges.push(edge(`${dir}/caller${c}.ts#c`, `${path}#${name}`));
        }
      }
    }
  }
  return graphOf(nodes, edges);
}

test("formatRepoMap: stays under the 6000-char budget and surfaces hub names", () => {
  const map = buildRepoMap(bigFixture());
  const text = formatRepoMap(map);

  assert.ok(text.length <= 6000, `formatted map is ${text.length} chars, expected <= 6000`);
  assert.match(text, /^repo map — \d+ files · \d+ symbols · \d+ edges/);
  for (const d of map.dirs) {
    for (const h of d.hubs) {
      assert.ok(text.includes(h.name), `hub name "${h.name}" must appear in the rendered map`);
    }
  }
});

test("formatRepoMap: notes dropped directories beyond the cap", () => {
  const nodes: NodeV1[] = [];
  for (const dir of ["a", "b", "c", "d"]) nodes.push(fileNode(`${dir}/x.ts`));
  const map = buildRepoMap(graphOf(nodes, []), { maxDirs: 1 });
  const text = formatRepoMap(map);
  assert.match(text, /\+3 more directories not shown/);
});

test("formatRepoMap: an empty repo map still renders a well-formed header", () => {
  const map = buildRepoMap(graphOf([], []));
  const text = formatRepoMap(map);
  assert.match(text, /^repo map — 0 files · 0 symbols · 0 edges ·\s*$/m);
  assert.match(text, /^hotspots:\s*$/m);
});
