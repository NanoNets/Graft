/**
 * The pre-query freshness gate. Two things matter: it notices working-tree edits
 * that nobody committed (or even made through the agent), and it never turns a
 * working query into a failing one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { ensureFreshGraph, refreshNote } from "../src/graph/refresh.js";
import { isClean, probeDrift } from "../src/graph/fingerprint.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { acquireLock, readStats, releaseLock, writeStats, emptyStats } from "../src/util/state.js";
import { callTool } from "../src/mcp/tools.js";
import type { GraphV1 } from "../src/graph/types.js";

const MATH = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-refresh-"));
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "math.ts"), MATH);
  return d;
}

const outOf = (d: string): string => join(d, "graft");
const graphOf = (d: string): GraphV1 => readGraph(wiringPath(outOf(d))) as GraphV1;
const hasSymbol = (d: string, id: string): boolean => graphOf(d).nodes.some((n) => n.id === id);

/** Each test owns the env switch; `graph-load.test.ts` sets it process-wide for
 * its own file, and these run in a separate process. */
function withRefreshDisabled<T>(fn: () => T): T {
  process.env.GRAFT_NO_REFRESH = "1";
  try {
    return fn();
  } finally {
    delete process.env.GRAFT_NO_REFRESH;
  }
}

test("probeDrift: clean after a build, then reports what moved", async () => {
  const d = repo();
  await buildGraph(d);
  const clean = probeDrift(d, outOf(d));
  assert.ok(clean && isClean(clean));

  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const X = 1;\n`);
  writeFileSync(join(d, "src", "new.ts"), "export const N = 2;\n");
  const drift = probeDrift(d, outOf(d));
  assert.deepEqual(drift, { changed: ["src/math.ts"], added: ["src/new.ts"], removed: [] });

  rmSync(join(d, "src", "new.ts"));
  rmSync(join(d, "src", "math.ts"));
  assert.deepEqual(probeDrift(d, outOf(d)), { changed: [], added: [], removed: ["src/math.ts"] });
});

test("probeDrift returns null when no fingerprint was ever written", () => {
  const d = repo();
  mkdirSync(outOf(d), { recursive: true });
  assert.equal(probeDrift(d, outOf(d)), null);
});

test("ensureFreshGraph picks up an uncommitted edit before the query sees the graph", async () => {
  const d = repo();
  await buildGraph(d);
  assert.equal(hasSymbol(d, "src/math.ts#mul"), false);

  // Exactly the state that used to answer stale: a file edited in the working
  // tree, nothing committed, no hook having flagged anything.
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export function mul(a: number, b: number): number {\n  return a * b;\n}\n`);

  const r = await ensureFreshGraph(d);
  assert.equal(r.refreshed, true);
  assert.deepEqual(r.drift?.changed, ["src/math.ts"]);
  assert.equal(hasSymbol(d, "src/math.ts#mul"), true);
  assert.match(refreshNote(r) ?? "", /^\[graft\] refreshed the graph \(1 file changed\)/);
});

test("ensureFreshGraph is a no-op on a clean tree", async () => {
  const d = repo();
  await buildGraph(d);
  const before = readFileSync(wiringPath(outOf(d)), "utf8");
  const r = await ensureFreshGraph(d);
  assert.equal(r.refreshed, false);
  assert.equal(refreshNote(r), null, "silence when there is nothing to say");
  assert.equal(readFileSync(wiringPath(outOf(d)), "utf8"), before, "the graph is not even rewritten");
});

test("ensureFreshGraph rebuilds once when the graph predates the fingerprint", async () => {
  const d = repo();
  await buildGraph(d);
  rmSync(join(outOf(d), ".cache", "fingerprint.json"));

  const first = await ensureFreshGraph(d);
  assert.equal(first.refreshed, true, "no fingerprint = unknown state, so rebuild");
  assert.equal(first.drift, undefined);
  // ...and that rebuild lays one down, so it costs one build, not one per query.
  const second = await ensureFreshGraph(d);
  assert.equal(second.refreshed, false);
});

test("ensureFreshGraph does nothing when there is no graph at all", async () => {
  const d = repo();
  const r = await ensureFreshGraph(d);
  assert.equal(r.refreshed, false);
  assert.equal(probeDrift(d, outOf(d)), null, "and it did not build one behind the user's back");
});

test("GRAFT_NO_REFRESH and { disabled } both short-circuit", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const X = 1;\n`);

  const off = await withRefreshDisabled(() => ensureFreshGraph(d));
  assert.equal(off.refreshed, false);
  const flagged = await ensureFreshGraph(d, { disabled: true });
  assert.equal(flagged.refreshed, false);
  assert.equal(hasSymbol(d, "src/math.ts#X"), false, "the graph must be untouched");

  const on = await ensureFreshGraph(d);
  assert.equal(on.refreshed, true);
});

test("a rebuild already in flight is waited out, then reported — never a hang", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const X = 1;\n`);

  assert.equal(acquireLock(d), true, "hold the lock the way a background sync would");
  const started = Date.now();
  const r = await ensureFreshGraph(d);
  const waited = Date.now() - started;
  releaseLock(d);

  assert.equal(r.refreshed, false);
  assert.match(r.note ?? "", /already in flight/);
  assert.ok(waited >= 1000 && waited < 10000, `should wait out the lock briefly, waited ${waited}ms`);
});

test("a refresh updates the statusline stats, but only where they already exist", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const X = 1;\n`);

  // No stats file (a repo with no Claude Code wiring): nothing is created.
  await ensureFreshGraph(d);
  assert.equal(readStats(d), null);

  // With one, the refresh clears the drift flags the edit hook set mid-turn —
  // that's what flips the statusline from `⚠ stale` to `✓ synced`.
  writeStats(d, { ...emptyStats(), dirty: true, staleCount: 3 });
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const Y = 2;\n`);
  await ensureFreshGraph(d);
  const s = readStats(d);
  assert.equal(s?.dirty, false);
  assert.equal(s?.staleCount, 0);
  assert.ok((s?.nodeCount ?? 0) > 0, "and it refreshes the counts from the new graph");
  assert.ok(s?.syncedAt);
});

test("a failed rebuild still answers from the graph on disk", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root writes anywhere, so a read-only file proves nothing");
  const d = repo();
  await buildGraph(d);
  const before = readFileSync(wiringPath(outOf(d)), "utf8");
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export const X = 1;\n`);

  // Make the graph write itself fail: the query must degrade to the old graph, not
  // start erroring because a rebuild couldn't happen.
  chmodSync(wiringPath(outOf(d)), 0o400);
  const r = await ensureFreshGraph(d);
  chmodSync(wiringPath(outOf(d)), 0o600);

  assert.equal(r.refreshed, false);
  assert.match(r.note ?? "", /refresh skipped/);
  assert.equal(readFileSync(wiringPath(outOf(d)), "utf8"), before, "the old graph is intact");
  assert.match(refreshNote(r) ?? "", /^\[graft\] graph refresh skipped/);

  // The lock must have been released, or every later query would report a
  // rebuild-in-flight that will never finish.
  assert.equal(acquireLock(d), true);
  releaseLock(d);
});

test("callTool refreshes before answering — except for graft_check", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export function mul(a: number, b: number): number {\n  return a * b;\n}\n`);

  // graft_check is the drift report: refreshing first would make it always say OK.
  const check = await callTool(d, "graft_check", {});
  assert.equal(check.isError, false);
  assert.ok(!check.text.startsWith("[graft] refreshed"));
  assert.equal(hasSymbol(d, "src/math.ts#mul"), false, "check must not rebuild");

  const ask = await callTool(d, "graft_ask", { query: "multiply two numbers" });
  assert.equal(ask.isError, false);
  assert.match(ask.text, /^\[graft\] refreshed the graph/);
  assert.equal(hasSymbol(d, "src/math.ts#mul"), true);
  assert.match(ask.text, /mul/, "and the answer knows about the symbol that was never committed");

  const again = await callTool(d, "graft_ask", { query: "multiply two numbers" });
  assert.ok(!again.text.startsWith("[graft] refreshed"), "nothing moved — no note, no rebuild");
});
