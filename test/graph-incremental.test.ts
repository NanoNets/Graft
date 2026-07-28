/**
 * The extraction cache's contract: replaying unchanged files must be
 * indistinguishable from re-parsing them. Every test here is a variation on
 * "cold build == incremental build" — because that equality is what lets a
 * rebuild run before every query.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readExtractCache } from "../src/graph/extract-cache.js";
import { isClean, probeDrift, readFingerprint } from "../src/graph/fingerprint.js";
import { readAskIndex } from "../src/ask/index-file.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1 } from "../src/graph/types.js";

const MATH = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "export function sub(a: number, b: number): number {",
  "  return add(a, -b);",
  "}",
  "",
].join("\n");

const APP = ['import { add } from "./math.js";', "export function main(): number {", "  return add(1, 2);", "}", ""].join("\n");

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-incr-"));
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "math.ts"), MATH);
  writeFileSync(join(d, "src", "app.ts"), APP);
  return d;
}

const outOf = (d: string): string => join(d, "graft");
const wiringOf = (d: string): string => readFileSync(wiringPath(outOf(d)), "utf8");

test("an incremental rebuild writes byte-identical wiring.json to a cold one", async () => {
  const d = repo();
  await buildGraph(d, { reuse: false });
  const cold = wiringOf(d);
  await buildGraph(d);
  assert.equal(wiringOf(d), cold, "replaying cached parses must not change a single byte of the graph");
});

test("unchanged files are replayed, not re-parsed", async () => {
  const d = repo();
  const first = await buildGraph(d);
  assert.equal(first.parsed, 2, "cold build parses every file");
  assert.equal(first.reused, 0);

  const second = await buildGraph(d);
  assert.equal(second.parsed, 0, "nothing changed — nothing to parse");
  assert.equal(second.reused, 2);

  // Same content, newer mtime: the stat check misses, the hash check saves it.
  const later = new Date(Date.now() + 5000);
  utimesSync(join(d, "src", "math.ts"), later, later);
  const third = await buildGraph(d);
  assert.equal(third.parsed, 0, "a touch changes no bytes, so it must not cost a parse");
  assert.equal(third.reused, 2);
});

test("an edit re-parses only the file that changed, and lands in the graph", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "math.ts"), `${MATH}export function mul(a: number, b: number): number {\n  return a * b;\n}\n`);
  const r = await buildGraph(d);
  assert.equal(r.parsed, 1);
  assert.equal(r.reused, 1);
  const g = readGraph(wiringPath(outOf(d))) as GraphV1;
  assert.ok(g.nodes.some((n) => n.id === "src/math.ts#mul"), "the new symbol must be in the graph");

  // ...and the result is still exactly what a cold build would produce.
  const warm = wiringOf(d);
  await buildGraph(d, { reuse: false });
  assert.equal(warm, wiringOf(d));
});

test("adding and deleting files stays consistent with a cold build", async () => {
  const d = repo();
  await buildGraph(d);

  writeFileSync(join(d, "src", "extra.ts"), "export const EXTRA = 1;\n");
  const added = await buildGraph(d);
  assert.equal(added.parsed, 1, "only the new file is parsed");
  assert.equal(added.reused, 2);

  rmSync(join(d, "src", "app.ts"));
  await buildGraph(d);
  const g = readGraph(wiringPath(outOf(d))) as GraphV1;
  assert.ok(!g.nodes.some((n) => n.path === "src/app.ts"), "a deleted file leaves no nodes behind");

  const cache = readExtractCache(outOf(d));
  assert.ok(!("src/app.ts" in cache.files), "and no cache entry");
  const fp = readFingerprint(outOf(d));
  assert.ok(fp && !("src/app.ts" in fp.files), "and no fingerprint entry");

  const warm = wiringOf(d);
  await buildGraph(d, { reuse: false });
  assert.equal(warm, wiringOf(d));
});

test("the ask sidecar still covers every node after an incremental rebuild", async () => {
  const d = repo();
  await buildGraph(d);
  writeFileSync(join(d, "src", "app.ts"), `${APP}export function other(): number {\n  return 7;\n}\n`);
  await buildGraph(d);

  const g = readGraph(wiringPath(outOf(d))) as GraphV1;
  const idx = readAskIndex(outOf(d));
  assert.ok(idx, "sidecar written");
  // ask.ts falls back to live tokenization unless the sidecar covers every node
  // by id — a replayed node with no body would silently degrade ranking.
  assert.equal(idx!.docs.length, g.nodes.length);
  const ids = new Set(idx!.docs.map((doc) => doc.id));
  for (const n of g.nodes) assert.ok(ids.has(n.id), `sidecar missing ${n.id}`);
  const replayed = idx!.docs.find((doc) => doc.id === "src/math.ts#add");
  assert.ok(replayed && replayed.body.length > 0, "a replayed node must keep its body tokens");
});

test("the cache holds pristine Tier-1 output — no enrichment leaks into it", async () => {
  const d = repo();
  await buildGraph(d);
  // Stamp a summary onto the graph the way a `--deep` build would, then rebuild
  // structurally: the meaning layer must survive (it is keyed on body_hash in
  // wiring.json) while the extraction cache stays free of it.
  const path = wiringPath(outOf(d));
  const g = readGraph(path) as GraphV1;
  const target = g.nodes.find((n) => n.id === "src/math.ts#add");
  assert.ok(target);
  target!.summary = "adds two numbers";
  target!.summary_state = "ready";
  writeFileSync(path, `${JSON.stringify(g, null, 2)}\n`);

  await buildGraph(d);
  const after = readGraph(path) as GraphV1;
  const kept = after.nodes.find((n) => n.id === "src/math.ts#add");
  assert.equal(kept?.summary, "adds two numbers", "an unchanged body keeps its summary");
  assert.equal(kept?.summary_state, "ready");

  const cache = readExtractCache(outOf(d));
  const cachedNode = cache.files["src/math.ts"].nodes.find((n) => n.id === "src/math.ts#add");
  assert.ok(cachedNode);
  assert.equal(cachedNode!.summary, null, "the parse memo must not carry meaning-layer state");
  assert.equal(cachedNode!.summary_state, "pending", "it holds extractFile's output, pre-enrichment");
});

test("every file on disk lands in the fingerprint", async () => {
  const d = repo();
  await buildGraph(d);
  const fp = readFingerprint(outOf(d));
  assert.ok(fp);
  assert.deepEqual(Object.keys(fp!.files).sort(), ["src/app.ts", "src/math.ts"]);
});

test("an unreadable file is still recorded, so it can't look new on every probe", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads anything, so chmod 000 proves nothing");
  const d = repo();
  const secret = join(d, "src", "secret.ts");
  writeFileSync(secret, "export function secretFn(): number {\n  return 1;\n}\n");
  chmodSync(secret, 0o000);

  const r = await buildGraph(d);
  assert.ok(
    r.errors.some((e) => e.startsWith("src/secret.ts:")),
    `expected a read error for src/secret.ts, got ${JSON.stringify(r.errors)}`,
  );
  // The point: it IS in the fingerprint. Otherwise the probe would report it as a
  // new file forever and every single query would trigger a rebuild.
  const fp = readFingerprint(outOf(d));
  assert.ok(fp && "src/secret.ts" in fp.files);
  const drift = probeDrift(d, outOf(d));
  assert.ok(drift && isClean(drift), `expected a clean probe, got ${JSON.stringify(drift)}`);

  // And the error keeps being reported while the file stays unreadable.
  const again = await buildGraph(d);
  assert.ok(again.errors.some((e) => e.startsWith("src/secret.ts:")));

  // A chmod changes neither size nor mtime, so recovery must not depend on the
  // stat fast path — the file has to be retried on the next build regardless.
  chmodSync(secret, 0o644);
  const recovered = await buildGraph(d);
  assert.deepEqual(recovered.errors, []);
  const g = readGraph(wiringPath(outOf(d))) as GraphV1;
  assert.ok(g.nodes.some((n) => n.id === "src/secret.ts#secretFn"), "the once-unreadable file is indexed now");
});
