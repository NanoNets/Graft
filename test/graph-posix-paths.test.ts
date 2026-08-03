/**
 * The end-to-end guard on the posix-path invariant: after a real `buildGraph`,
 * no stored path may carry a platform separator — not a node id, not
 * `node.path`, not an extract-cache key, not a fingerprint key, not a card
 * manifest entry.
 *
 * These assertions pass trivially on posix. They are the regression test for
 * Windows, where `relative()` handed every one of those a `src\gate.ts` and the
 * query layer — which parses paths with `/` by hand — silently matched nothing.
 * They earn their keep on CI's `windows-latest` leg; deleting that leg makes
 * this file decorative.
 *
 * The nested fixture mirrors the five-file repro from issue #35 (`src/` ×3,
 * `lib/` ×1, `scripts/` ×1), so `map`'s directory clustering is exercised on a
 * genuinely built graph rather than on hand-written `GraphV1` stubs — the bug
 * lived in path *production*, so stubs cannot see it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readExtractCache } from "../src/graph/extract-cache.js";
import { readFingerprint } from "../src/graph/fingerprint.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { buildRepoMap } from "../src/graph/map.js";
import { ask } from "../src/ask/ask.js";
import type { GraphV1 } from "../src/graph/types.js";

const GATE = ["export function isActive(): boolean {", "  return true;", "}", ""].join("\n");
const DIRECT = [
  'import { isActive } from "./gate.js";',
  "export function callsItDirectly(): boolean {",
  "  return isActive();",
  "}",
  "",
].join("\n");
const CONSUMER = ['import { isActive } from "./gate.js";', "export const check = isActive;", ""].join("\n");
const HELPER = ["export function helper(): number {", "  return 1;", "}", ""].join("\n");
const TOOL = ["export function mjsOnlySymbol() {", "  return 2;", "}", ""].join("\n");

/** Issue #35's repro: 5 files across 3 directories, one of them nested deeper. */
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-posix-"));
  mkdirSync(join(d, "src", "deep"), { recursive: true });
  mkdirSync(join(d, "lib"), { recursive: true });
  mkdirSync(join(d, "scripts"), { recursive: true });
  writeFileSync(join(d, "src", "gate.ts"), GATE);
  writeFileSync(join(d, "src", "direct.ts"), DIRECT);
  writeFileSync(join(d, "src", "deep", "consumer.ts"), CONSUMER);
  writeFileSync(join(d, "lib", "helper.ts"), HELPER);
  writeFileSync(join(d, "scripts", "tool.mjs"), TOOL);
  return d;
}

const outOf = (d: string): string => join(d, "graft");
const graphOf = (d: string): GraphV1 => readGraph(wiringPath(outOf(d)))!;

test("a built graph stores no platform separator in any node id or path", async () => {
  const d = repo();
  await buildGraph(d, { reuse: false });
  const graph = graphOf(d);

  assert.ok(graph.nodes.length > 0, "fixture produced no nodes");
  for (const n of graph.nodes) {
    assert.ok(!n.path.includes("\\"), `node.path carries a backslash: ${n.path}`);
    assert.ok(!n.id.includes("\\"), `node id carries a backslash: ${n.id}`);
  }
  for (const e of graph.edges) {
    assert.ok(!e.source.includes("\\"), `edge source carries a backslash: ${e.source}`);
    assert.ok(!e.target.includes("\\"), `edge target carries a backslash: ${e.target}`);
  }
  // The nested file proves separators are converted at every depth, not just one.
  assert.ok(graph.nodes.some((n) => n.path === "src/deep/consumer.ts"));
});

test("the extract cache and fingerprint are keyed by posix paths", async () => {
  const d = repo();
  await buildGraph(d, { reuse: false });
  const out = outOf(d);

  const cacheKeys = Object.keys(readExtractCache(out).files);
  const printKeys = Object.keys(readFingerprint(out)?.files ?? {});
  assert.ok(cacheKeys.length > 0, "extract cache is empty");
  assert.ok(printKeys.length > 0, "fingerprint is empty");
  for (const k of [...cacheKeys, ...printKeys]) {
    assert.ok(!k.includes("\\"), `cache key carries a backslash: ${k}`);
  }
  // Both are keyed off the same `rel`, so they must agree exactly — a mismatch
  // is what makes `check` report drift that `build` then refuses to repair.
  assert.deepEqual(cacheKeys.sort(), printKeys.sort());
});

test("--in scopes a built graph by directory, at any depth", async () => {
  const d = repo();
  await buildGraph(d, { reuse: false });

  const scoped = ask(d, "isActive", { in: "src" });
  assert.ok(scoped.hits.length > 0, "no hits under src/");
  for (const h of scoped.hits) {
    assert.ok(h.pointer.startsWith("src/"), `leaked out of scope: ${h.pointer}`);
  }

  const deep = ask(d, "check", { in: "src/deep" });
  assert.ok(deep.hits.length > 0, "no hits under src/deep/");
  for (const h of deep.hits) {
    assert.ok(h.pointer.startsWith("src/deep/"), `leaked out of scope: ${h.pointer}`);
  }

  // A prefix that matches nothing is a caller mistake, reported loudly rather
  // than as an empty result the caller has to interpret.
  assert.throws(() => ask(d, "isActive", { in: "nosuchdir" }), /nothing indexed under "nosuchdir\//);
});

test("map clusters a built graph by directory, not one row per file (#35)", async () => {
  const d = repo();
  await buildGraph(d, { reuse: false });
  const map = buildRepoMap(graphOf(d));

  // 5 files across src/, lib/, scripts/ — three groups, not five.
  assert.deepEqual(map.dirs.map((e) => e.path).sort(), ["lib", "scripts", "src"]);
  assert.equal(map.dirs.find((e) => e.path === "src")?.files, 3);
  assert.equal(map.dirs.find((e) => e.path === "lib")?.files, 1);
  assert.equal(map.dirs.find((e) => e.path === "scripts")?.files, 1);
  // Every group is a real directory, not the "bottomed out on a file" fallback.
  assert.ok(map.dirs.every((e) => !e.isFile));
  assert.equal(map.dropped, 0);
});

test("the card manifest records posix card paths", async () => {
  const d = repo();
  const r = await buildGraph(d, { reuse: false });
  assert.ok(r.nodes > 0);

  const index = readFileSync(join(outOf(d), "INDEX.md"), "utf8");
  assert.ok(!/\(\S*\\\S*\.md\)/.test(index), "INDEX.md links carry a backslash");
});
