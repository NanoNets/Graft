/**
 * JS/TS namespace-member functions in the Tier-1 code graph: `NS.foo = (…) => …`,
 * `NS.foo = function () {}`, `exports.foo = …`, `Foo.prototype.bar = function`.
 * Before this, such a definition minted no node at all — `graft callers` said
 * "no symbol", `skeleton` omitted it, and the calls in its body attributed to
 * the file — which hid every function of a codebase written in the
 * one-namespace-object style (`MN.runNode = (g, n) => {…}`, 1,300 of them).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { resolveSymbol } from "../src/graph/traverse.js";
import type { GraphV1 } from "../src/graph/types.js";

async function graphOf(files: Record<string, string>): Promise<{ dir: string; graph: GraphV1 }> {
  const dir = mkdtempSync(join(tmpdir(), "graft-ns-"));
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), src);
  }
  await buildGraph(dir); // $0, Tier-1 only
  const graph = readGraph(wiringPath(join(dir, "graft")));
  assert.ok(graph, "wiring graph should be written");
  return { dir, graph: graph! };
}

function calls(graph: GraphV1, source: string): string[] {
  return graph.edges.filter((e) => e.relation === "calls" && e.source === source).map((e) => e.target).sort();
}

test("NS.foo = arrow / function mint method nodes owned by NS, and NS.foo() calls resolve to them", async () => {
  const { dir, graph } = await graphOf({
    "src/core.js": [
      "const MN = {};",
      "MN.runNode = (g, n) => {",
      "  return MN.charge(n);",
      "};",
      "MN.charge = function (n) {",
      "  return n;",
      "};",
      "MN.sub = {};",
      "MN.sub.fn = () => 1;",
      "exports.run = () => MN.runNode({}, 1);",
      "",
    ].join("\n"),
    "src/use.js": ["function useIt() {", "  return MN.runNode({}, 2) + MN.sub.fn();", "}", ""].join("\n"),
  });
  try {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const runNode = byId.get("src/core.js#MN.runNode");
    assert.ok(runNode, "MN.runNode must mint a node");
    assert.equal(runNode!.kind, "method");
    assert.equal(runNode!.name, "runNode");
    assert.equal(runNode!.owner, "MN");
    assert.equal(runNode!.exported, false);
    assert.match(runNode!.signature ?? "", /MN\.runNode = \(g, n\)/);
    assert.equal(runNode!.span, "L2-L4");

    assert.equal(byId.get("src/core.js#MN.charge")?.kind, "method", "function-expression form too");
    assert.equal(byId.get("src/core.js#MN.sub.fn")?.owner, "MN.sub", "a dotted path owns its member");
    assert.equal(byId.get("src/core.js#exports.run")?.exported, true, "exports.x is a CommonJS export");

    // The body's calls attribute to the member, not the file, and resolve
    // owner-qualified: same file → extracted, other file → inferred.
    assert.deepEqual(calls(graph, "src/core.js#MN.runNode"), ["src/core.js#MN.charge"]);
    const sameFile = graph.edges.find((e) => e.source === "src/core.js#MN.runNode" && e.relation === "calls");
    assert.equal(sameFile?.confidence, "extracted");
    assert.deepEqual(calls(graph, "src/use.js#useIt"), ["src/core.js#MN.runNode", "src/core.js#MN.sub.fn"]);
    const crossFile = graph.edges.find((e) => e.source === "src/use.js#useIt" && e.target === "src/core.js#MN.runNode");
    assert.equal(crossFile?.confidence, "inferred");
    assert.deepEqual(calls(graph, "src/core.js#exports.run"), ["src/core.js#MN.runNode"]);

    // Nothing leaks to the file node: no `calls` edge sourced at src/core.js itself.
    assert.deepEqual(calls(graph, "src/core.js"), []);

    // `graft callers` finds it by bare and by qualified name.
    assert.deepEqual(resolveSymbol(graph, "runNode").map((n) => n.id), ["src/core.js#MN.runNode"]);
    assert.deepEqual(resolveSymbol(graph, "MN.runNode").map((n) => n.id), ["src/core.js#MN.runNode"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Foo.prototype.bar = function is a method of Foo, and this.x() inside it resolves against Foo", async () => {
  const { dir, graph } = await graphOf({
    "cache.js": [
      "function Cache() {}",
      "Cache.prototype.get = function (k) {",
      "  return this.load(k);",
      "};",
      "Cache.prototype.load = function (k) {",
      "  return k;",
      "};",
      "",
    ].join("\n"),
  });
  try {
    const get = graph.nodes.find((n) => n.id === "cache.js#Cache.get");
    assert.ok(get, "prototype member must mint a node under the class");
    assert.equal(get!.kind, "method");
    assert.equal(get!.owner, "Cache");
    assert.deepEqual(calls(graph, "cache.js#Cache.get"), ["cache.js#Cache.load"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a typed local inside a namespace function still resolves (bindings scope stays in step)", async () => {
  const { dir, graph } = await graphOf({
    "app.ts": [
      "class Cache {",
      "  get(k: string): string {",
      "    return k;",
      "  }",
      "}",
      "const MN: Record<string, unknown> = {};",
      "MN.read = (k: string) => {",
      "  const c = new Cache();",
      "  return c.get(k);",
      "};",
      "",
    ].join("\n"),
  });
  try {
    assert.deepEqual(calls(graph, "app.ts#MN.read"), ["app.ts#Cache.get"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a namespace member defined in two files links the caller to both definitions", async () => {
  const { dir, graph } = await graphOf({
    "base.js": ["const MN = {};", "MN.sync = () => 1;", ""].join("\n"),
    "overlay.js": ["MN.sync = () => 2;", ""].join("\n"),
    "use.js": ["function tick() {", "  return MN.sync();", "}", ""].join("\n"),
  });
  try {
    assert.deepEqual(calls(graph, "use.js#tick"), ["base.js#MN.sync", "overlay.js#MN.sync"]);
    for (const e of graph.edges.filter((e) => e.source === "use.js#tick" && e.relation === "calls")) {
      assert.equal(e.confidence, "inferred");
    }
    // A same-file definition still wins outright (extracted), no fan-out.
    const g2 = await graphOf({
      "base.js": ["const MN = {};", "MN.sync = () => 1;", "function local() {", "  return MN.sync();", "}", ""].join("\n"),
      "overlay.js": ["MN.sync = () => 2;", ""].join("\n"),
    });
    try {
      assert.deepEqual(calls(g2.graph, "base.js#local"), ["base.js#MN.sync"]);
    } finally {
      rmSync(g2.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regression guard: an untyped member call with no namespace definition still drops", async () => {
  const { dir, graph } = await graphOf({
    "u.js": ["function foo() {", "  return 1;", "}", "function use(x) {", "  return x.foo();", "}", ""].join("\n"),
  });
  try {
    assert.deepEqual(calls(graph, "u.js#use"), [], "x.foo() must not bind to the free function foo by name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computed keys, this.x = …, and non-function values mint nothing", async () => {
  const { dir, graph } = await graphOf({
    "n.js": [
      "const NS = {};",
      "NS[key] = () => 1;",
      "NS.count = 3;",
      "NS.list = [];",
      "function C() {",
      "  this.handler = () => 2;",
      "}",
      "",
    ].join("\n"),
  });
  try {
    const ids = graph.nodes.filter((n) => n.kind !== "file").map((n) => n.id).sort();
    assert.deepEqual(ids, ["n.js#C"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
