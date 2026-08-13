/**
 * The breadth (generic) tier's machinery, as distinct from "does language X extract"
 * (test/generic-extract.test.ts): which grammar a file is routed to, which grammars a
 * build actually loads, how call sites are attributed to their enclosing definition,
 * and what a build says when a grammar simply isn't there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  enclosingDefs,
  extractGeneric,
  isWarm,
  unavailableGrammars,
  warmGenericGrammars,
  type Def,
} from "../src/graph/generic.js";
import { resolveEdges } from "../src/graph/resolve.js";
import { buildGraph } from "../src/graph/build.js";
import { checkGraph } from "../src/graph/check.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { NodeV1 } from "../src/graph/types.js";
import type { RawEdge } from "../src/graph/extract.js";
import { tmpRepo } from "./helpers.js";

function extractAll(files: Record<string, string>, lang: string) {
  const nodes: NodeV1[] = [];
  const raw: RawEdge[] = [];
  for (const [rel, src] of Object.entries(files)) {
    const r = extractGeneric(rel, src, lang);
    nodes.push(...r.nodes);
    raw.push(...r.rawEdges);
  }
  return { nodes, raw };
}

/**
 * The header/implementation split is universal in C, and the upstream tags.scm pattern
 * matches a prototype as readily as a definition — so every function had two nodes of
 * the same name in two files, `resolveName` saw an ambiguous global match, and dropped
 * it. The visible symptom is that no C project with headers had ANY cross-file call.
 */
test("C prototypes in a header are not definitions, so cross-file calls resolve", async () => {
  await warmGenericGrammars(["c"]);
  const { nodes, raw } = extractAll(
    {
      "src/app.h": "int run(void);\nchar *dup_it(const char *);\n",
      "src/app.c": "int run(void){ return 0; }\nchar *dup_it(const char *s){ return 0; }\n",
      "src/other.c": '#include "app.h"\nint go(void){ return run(); }\n',
    },
    "c",
  );

  const named = nodes.filter((n) => n.kind !== "file").map((n) => `${n.path}:${n.name}`).sort();
  assert.deepEqual(
    named,
    ["src/app.c:dup_it", "src/app.c:run", "src/other.c:go"],
    "one node per function, at its definition — the header's two prototypes mint nothing",
  );

  const call = resolveEdges(nodes, raw).find((e) => e.relation === "calls" && e.source === "src/other.c#go");
  assert.ok(call, "the cross-file call must survive resolution");
  assert.equal(call!.target, "src/app.c#run");
});

/**
 * `.h` can only be claimed by one registry row and C claims it — but a C++ project's
 * headers are exactly where the classes, templates and namespaces live, and c.scm has
 * no pattern for any of them. Those symbols were simply absent from the graph.
 */
test("a C++-looking .h is parsed with the cpp grammar once cpp is warm", async () => {
  await warmGenericGrammars(["c", "cpp"]);
  const header = [
    "#pragma once",
    "namespace app {",
    "class Widget {",
    "public:",
    "  void draw();",
    "  int size() const { return 1; }",
    "};",
    "}",
    "",
  ].join("\n");
  const names = extractGeneric("src/widget.h", header, "c")
    .nodes.filter((n) => n.kind !== "file")
    .map((n) => `${n.kind}:${n.name}`)
    .sort();
  assert.deepEqual(names, ["class:Widget", "method:size"], "the C grammar knows no class_specifier at all");

  // …and a plain C header must NOT be dragged along with it, even with cpp warm.
  const plain = extractGeneric("src/plain.h", "struct Point { int x; };\nint run(void);\n", "c")
    .nodes.filter((n) => n.kind !== "file")
    .map((n) => `${n.kind}:${n.name}`);
  assert.deepEqual(plain, ["class:Point"], "no C++ markers → still the C grammar");
});

/**
 * Attribution used to be `defs.filter(contains).sort(bySize)[0]` per token — O(D·C)
 * with two array allocations per token, which on a generated file (15k defs, 50k call
 * sites) is 750M comparisons inside build's synchronous loop.
 */
test("enclosingDefs picks the innermost definition, including nested ones", () => {
  const defs: Def[] = [
    { id: "outer", startIndex: 0, endIndex: 100 },
    { id: "inner", startIndex: 10, endIndex: 40 },
    { id: "deepest", startIndex: 20, endIndex: 30 },
    { id: "sibling", startIndex: 50, endIndex: 70 },
  ];
  const offsets = [5, 15, 25, 35, 60, 80, 120];
  assert.deepEqual(
    enclosingDefs(defs, offsets).map((d) => d?.id),
    ["outer", "inner", "deepest", "inner", "sibling", "outer", undefined],
  );
  // Order of the offsets must not matter — the sweep sorts internally and writes back
  // positionally, so a caller can hand them over in document order or any other.
  assert.deepEqual(
    enclosingDefs(defs, [...offsets].reverse()).map((d) => d?.id),
    ["outer", "inner", "deepest", "inner", "sibling", "outer", undefined].reverse(),
  );
  assert.deepEqual(enclosingDefs([], [1, 2]), [undefined, undefined]);
});

test("enclosingDefs stays fast at generated-file scale", () => {
  // 15k nested-ish definitions and 60k tokens: the quadratic version is ~10^9
  // comparisons plus 60k array allocations, which took tens of seconds for one file.
  const defs: Def[] = [];
  for (let i = 0; i < 15_000; i++) {
    defs.push({ id: `f${i}`, startIndex: i * 100, endIndex: i * 100 + 90 });
  }
  const offsets: number[] = [];
  for (let i = 0; i < 60_000; i++) offsets.push((i % 15_000) * 100 + 10);

  const started = Date.now();
  const got = enclosingDefs(defs, offsets);
  const elapsed = Date.now() - started;

  assert.equal(got[0]?.id, "f0");
  assert.equal(got[14_999]?.id, "f14999");
  assert.ok(elapsed < 3_000, `attribution took ${elapsed}ms — the quadratic shape is back`);
});

/**
 * `warmGenericGrammars` swallows a missing wasm and a failed grammar on purpose
 * (neither should fail a build), which left the caller with no way to tell "indexed"
 * from "indexed as an empty file node".
 */
test("unavailableGrammars names the breadth languages with no loaded grammar", async () => {
  assert.deepEqual(
    unavailableGrammars(["zig", "solidity"]).sort(),
    ["solidity", "zig"],
    "nothing is warm yet in this process",
  );
  await warmGenericGrammars(["zig"]);
  assert.equal(isWarm("zig"), true);
  assert.deepEqual(unavailableGrammars(["zig", "solidity"]), ["solidity"]);
  assert.deepEqual(unavailableGrammars([]), []);
});

/**
 * `.java` is claimed by BOTH registries and the depth tier always wins the actual
 * extraction, so warming its breadth grammar loaded a multi-MB wasm and compiled
 * queries/java.scm on every build of every Java repo, for a path that can never run.
 */
test("a build never warms a breadth grammar the depth tier owns", async () => {
  const d = tmpRepo("breadth-warm-");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "App.java"), "public class App {\n  int run() { return 1; }\n}\n");
  writeFileSync(join(d, "src", "main.py"), "def go():\n    return 1\n");

  await buildGraph(d, { reuse: false });
  assert.equal(isWarm("java"), false, "the java wasm must never be loaded for a .java file");

  // …and the file is still fully indexed, by the depth tier.
  const graph = readGraph(wiringPath(join(d, "graft")))!;
  assert.ok(graph.nodes.some((n) => n.id === "src/App.java#App"), "the depth tier still indexes it");
  assert.ok(graph.meta.languages.includes("java"), "and it is still reported as a language");
});

/**
 * The same filter, on the OTHER caller. `checkGraph` re-runs Tier-1 extraction and so
 * warms grammars too, but warmed the unfiltered set — and `check` runs in CI, from the
 * hooks, and before every query that finds the graph stale, so a Java repo paid the
 * multi-MB wasm load far more often here than on the build path that was fixed first.
 */
test("a check never warms a breadth grammar the depth tier owns", async () => {
  const d = tmpRepo("breadth-warm-check-");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "App.java"), "public class App {\n  int run() { return 1; }\n}\n");

  await buildGraph(d, { reuse: false });
  const r = await checkGraph(d);
  assert.equal(r.missing, false, "the graph built above is what check reads");
  assert.equal(isWarm("java"), false, "the java wasm must never be loaded for a .java file");
  assert.equal(r.ok, true, "and the depth tier still re-extracts it, so nothing reads as drift");
});

/**
 * Reusing one parser per language and deleting each tree is invisible in the output by
 * design — this pins that it stays invisible, since a parser wrongly shared or a tree
 * deleted too early would corrupt the very next file's extraction.
 */
test("repeated extraction through the shared per-language parser is stable", async () => {
  await warmGenericGrammars(["rust"]);
  const src = "pub struct Config { name: String }\n\npub fn load() -> Config {\n    parse()\n}\n\nfn parse() -> Config {\n    load()\n}\n";
  const first = JSON.stringify(extractGeneric("lib.rs", src, "rust"));
  for (let i = 0; i < 200; i++) {
    assert.equal(JSON.stringify(extractGeneric("lib.rs", src, "rust")), first, `run ${i} diverged`);
  }
  // Interleaving a second language must not disturb the first's parser either.
  await warmGenericGrammars(["c"]);
  extractGeneric("a.c", "int f(void){return 1;}\n", "c");
  assert.equal(JSON.stringify(extractGeneric("lib.rs", src, "rust")), first);
});
