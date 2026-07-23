/**
 * Tests for the mtime-keyed loader cache (`src/graph/load.ts`) that sits in
 * front of `readGraph`/`readAskIndex` so a long-lived process (the MCP server;
 * `graft ask` invoked repeatedly in one process) doesn't re-parse the wiring
 * graph and ask sidecar on every query.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGraphCached,
  loadAskIndexCached,
  __parseCount,
  __resetParseCounts,
} from "../src/graph/load.js";
import { writeGraph, wiringPath } from "../src/graph/write.js";
import { writeAskIndex, askIndexPath } from "../src/ask/index-file.js";
import { callTool } from "../src/mcp/tools.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

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

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "graft-load-"));
}

/** Force a distinct (mtimeMs, size) from the previous write, even on
 * filesystems with coarse mtime resolution. */
function bump(path: string): void {
  const st = statSync(path);
  const future = new Date(st.mtimeMs + 1000);
  utimesSync(path, future, future);
}

test("loadGraphCached: two loads of an unchanged file return the same parsed object", () => {
  const dir = fixtureDir();
  writeGraph({ version: 1, nodes: [node("a")], edges: [] } as GraphV1, dir);
  __resetParseCounts();

  const g1 = loadGraphCached(dir);
  const g2 = loadGraphCached(dir);
  assert.ok(g1);
  assert.strictEqual(g1, g2, "second load must reuse the cached object, not re-parse");
  assert.equal(__parseCount.graph, 1);
});

test("loadGraphCached: rewriting the wiring file invalidates the cache", () => {
  const dir = fixtureDir();
  writeGraph({ version: 1, nodes: [node("a")], edges: [] } as GraphV1, dir);
  __resetParseCounts();

  const g1 = loadGraphCached(dir);
  assert.equal(g1?.nodes[0]?.id, "a");
  assert.equal(__parseCount.graph, 1);

  // Rewrite with a changed node, then force a distinct mtime so the cache
  // can't coast on a filesystem with coarse mtime granularity.
  writeGraph({ version: 1, nodes: [node("b")], edges: [] } as GraphV1, dir);
  bump(wiringPath(dir));

  const g2 = loadGraphCached(dir);
  assert.equal(g2?.nodes[0]?.id, "b", "reload must see the new content");
  assert.equal(__parseCount.graph, 2, "changed (mtime, size) must trigger a re-parse");
  assert.notStrictEqual(g1, g2);
});

test("loadGraphCached: missing file returns null and a later-created file is picked up", () => {
  const dir = fixtureDir();
  __resetParseCounts();

  const miss = loadGraphCached(dir);
  assert.equal(miss, null);
  assert.equal(__parseCount.graph, 0, "a miss must not count as a parse");

  const missAgain = loadGraphCached(dir);
  assert.equal(missAgain, null, "missing file must not be negatively cached forever");

  writeGraph({ version: 1, nodes: [node("late")], edges: [] } as GraphV1, dir);
  const found = loadGraphCached(dir);
  assert.equal(found?.nodes[0]?.id, "late");
  assert.equal(__parseCount.graph, 1);
});

test("loadAskIndexCached: caches and invalidates the same way as the graph loader", () => {
  const dir = fixtureDir();
  const graph = { version: 1, nodes: [node("a"), node("b")], edges: [] } as GraphV1;
  writeAskIndex(dir, graph);
  __resetParseCounts();

  const i1 = loadAskIndexCached(dir);
  const i2 = loadAskIndexCached(dir);
  assert.ok(i1);
  assert.strictEqual(i1, i2);
  assert.equal(__parseCount.askIndex, 1);

  writeAskIndex(dir, { version: 1, nodes: [node("a")], edges: [] } as GraphV1);
  bump(askIndexPath(dir));

  const i3 = loadAskIndexCached(dir);
  assert.equal(i3?.docCount, 1);
  assert.equal(__parseCount.askIndex, 2);
});

test("callTool: graft_callers on the same dir twice doesn't reparse the graph", () => {
  const dir = fixtureDir();
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "math.ts"), "export function add() { return 1; }\n");
  const graph: GraphV1 = {
    version: 1,
    // A real `buildGraph` always emits a `kind: "file"` node per source file;
    // include one here too so `graft_callers` with depth (a `resolveSymbol` +
    // `edgeWalk` walk, the old `graft impact`) can resolve the filename-shaped
    // query the way it would against a real build.
    nodes: [
      { ...node("src/math.ts#add"), path: "src/math.ts" },
      { ...node("src/math.ts"), kind: "file", path: "src/math.ts", name: "math.ts", signature: null },
    ],
    edges: [],
  } as GraphV1;
  // graft_callers reads through `contextDirFor(root)`, i.e. `<root>/graft`
  // by default — write the graph there directly rather than round-tripping
  // through a real `graft build`.
  const outDir = join(dir, "graft");
  mkdirSync(outDir, { recursive: true });
  writeGraph(graph, outDir);
  __resetParseCounts();

  const r1 = callTool(dir, "graft_callers", { symbol: "src/math.ts", depth: 2 });
  assert.equal(r1.isError, false);
  assert.equal(__parseCount.graph, 1);

  const r2 = callTool(dir, "graft_callers", { symbol: "src/math.ts", depth: 2 });
  assert.equal(r2.isError, false);
  assert.equal(__parseCount.graph, 1, "second call on the same dir must not reparse");
});
