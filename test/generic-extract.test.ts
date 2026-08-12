/**
 * The generic (breadth) tier: one language-agnostic extractor over a WASM grammar
 * + its tags.scm. These tests prove (a) it emits well-formed graft nodes/edges
 * for a language with NO hand-written extractor, and (b) the EXISTING resolver
 * resolves its bare-name call edges with zero language-specific code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { warmGenericGrammars, extractGeneric, genericLangOf, isWarm } from "../src/graph/generic.js";
import { resolveEdges } from "../src/graph/resolve.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { checkGraph } from "../src/graph/check.js";
import { contextDirFor } from "../src/context/node-file.js";

const RUST = `pub struct Config {
    name: String,
}

pub fn load() -> Config {
    let c = parse();
    Config { name: c }
}

fn parse() -> String {
    helper()
}

fn helper() -> String {
    String::new()
}
`;

test("genericLangOf routes .rs to the breadth tier (and not depth-tier extensions)", () => {
  assert.equal(genericLangOf("src/main.rs")?.name, "rust");
  assert.equal(genericLangOf("src/app.ts"), null); // depth tier owns .ts
  assert.equal(genericLangOf("README.md"), null);
});

test("extractGeneric emits nodes + bare-name call edges for Rust (no rust-specific code)", async () => {
  await warmGenericGrammars(["rust"]);
  assert.ok(isWarm("rust"), "rust grammar should warm");
  const { nodes, rawEdges } = extractGeneric("lib.rs", RUST, "rust");

  const kinds = nodes.filter((n) => n.kind !== "file").map((n) => `${n.kind}:${n.name}`).sort();
  assert.deepEqual(kinds, ["function:helper", "function:load", "function:parse", "struct:Config"]);

  // every non-file node carries the generic provenance + a span + a signature
  for (const n of nodes.filter((n) => n.kind !== "file")) {
    assert.equal(n.origin, "generic");
    assert.match(n.span, /^L\d+-L\d+$/);
    assert.ok(n.signature && n.signature.length > 0, `${n.name} has a signature`);
  }

  // calls are bare-name raw edges attributed to their enclosing function
  const calls = rawEdges.filter((e) => e.relation === "calls");
  const pairs = calls.map((e) => `${e.source.split("#")[1]}→${e.name}`).sort();
  assert.ok(pairs.includes("load→parse"), `load calls parse (got ${pairs.join(", ")})`);
  assert.ok(pairs.includes("parse→helper"), "parse calls helper");
});

test("the EXISTING resolver resolves generic-tier Rust calls by name", async () => {
  await warmGenericGrammars(["rust"]);
  const { nodes, rawEdges } = extractGeneric("lib.rs", RUST, "rust");
  const edges = resolveEdges(nodes, rawEdges);
  const call = edges.find((e) => e.relation === "calls" && e.source.endsWith("#load"));
  assert.ok(call, "load's call edge survived resolution");
  assert.equal(call?.target, "lib.rs#parse", "resolved to the same-file parse definition");
  assert.equal(call?.confidence, "extracted", "same-file → extracted");
});

// One inline snippet per breadth language, each exercising a definition + a call
// that must resolve. Java/Ruby/C# calls target METHODS — proving the generic-origin
// call-kind widening (resolve.ts) works, not just function-target languages.
const SNIPPETS: Array<{ lang: string; file: string; src: string; defs: string[]; call: [string, string] }> = [
  {
    lang: "java", file: "A.java",
    src: `class A {\n  int run() { return helper(); }\n  int helper() { return 1; }\n}\n`,
    defs: ["class:A", "method:helper", "method:run"], call: ["run", "helper"],
  },
  {
    // Explicit call (`self.draw`), not a parenless bareword: graft's ruby query
    // captures only real call nodes — the upstream bareword @reference.call
    // needs locals-tracking graft doesn't run, so it's dropped for precision.
    lang: "ruby", file: "a.rb",
    src: `class Widget\n  def render\n    self.draw\n  end\n  def draw\n    1\n  end\nend\n`,
    defs: ["class:Widget", "method:draw", "method:render"], call: ["render", "draw"],
  },
  {
    lang: "c_sharp", file: "A.cs",
    src: `class A {\n  int Run() { return Helper(); }\n  int Helper() { return 1; }\n}\n`,
    defs: ["class:A", "method:Helper", "method:Run"], call: ["Run", "Helper"],
  },
  {
    lang: "c", file: "a.c",
    src: `int helper() { return 1; }\nint run() { return helper(); }\n`,
    defs: ["function:helper", "function:run"], call: ["run", "helper"],
  },
];

for (const s of SNIPPETS) {
  test(`breadth tier: ${s.lang} — defs + a call that the resolver resolves`, async () => {
    await warmGenericGrammars([s.lang]);
    assert.ok(isWarm(s.lang), `${s.lang} grammar warms`);
    const { nodes, rawEdges } = extractGeneric(s.file, s.src, s.lang);
    const kinds = nodes.filter((n) => n.kind !== "file").map((n) => `${n.kind}:${n.name}`).sort();
    assert.deepEqual(kinds, s.defs, `${s.lang} definitions`);
    const edges = resolveEdges(nodes, rawEdges);
    const call = edges.find((e) => e.relation === "calls" && e.source.endsWith(`#${s.call[0]}`));
    assert.ok(call, `${s.lang}: ${s.call[0]}'s call edge exists and is attributed to the caller`);
    assert.equal(call?.target, `${s.file}#${s.call[1]}`, `${s.lang}: resolved ${s.call[0]}→${s.call[1]}`);
  });
}

test("buildGraph + checkGraph handle a breadth-tier (.rs) repo end-to-end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-rust-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "lib.rs"), RUST);

  await buildGraph(dir, { reuse: false });
  const g = readGraph(wiringPath(contextDirFor(dir)));
  assert.ok(g, "graph built");
  const rust = g!.nodes.filter((n) => n.path.endsWith(".rs") && n.kind !== "file");
  assert.ok(rust.length >= 4, `indexed the rust defs (got ${rust.length})`);
  assert.ok(rust.every((n) => n.origin === "generic"), "rust nodes are generic-tier");
  assert.ok(g!.edges.some((e) => e.relation === "calls"), "rust call edges resolved");

  // check must agree with build — the async warmup means .rs files are re-extracted
  // identically, so a fresh graph reads as in-sync, not perpetually stale.
  const chk = await checkGraph(dir);
  assert.equal(chk.ok, true, `check OK on a breadth-tier repo (added=${chk.added}, removed=${chk.removed})`);
});
