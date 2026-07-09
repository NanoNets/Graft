/**
 * Auto-watch: the graph evolves as a connected folder changes. All tests run
 * on the offline fake providers; FS events come from real chokidar watchers on
 * temp directories, so generous polling deadlines absorb platform latency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextGraphEngine, GraphWatcher, type WatchEvent } from "../src/index.js";
import { fakeProviders } from "./helpers.ts";

function engine() {
  return new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "cg-watch-"));
}

/** Poll until `cond` holds — FS events arrive with platform-dependent latency. */
async function waitFor(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function collector() {
  const events: WatchEvent[] = [];
  const of = (type: WatchEvent["type"]) => events.filter((e) => e.type === type);
  return { events, of, onEvent: (e: WatchEvent) => events.push(e) };
}

test("initial scan ingests existing files; a second watcher skips them all", async () => {
  const dir = tempDir();
  const e = engine();
  writeFileSync(join(dir, "auth.md"), "[[Auth Service]] ==uses==> [[OAuth]]");
  writeFileSync(join(dir, "deploy.md"), "[[Deploys]] ==run_on==> [[CI]]");

  const first = collector();
  const w1 = new GraphWatcher(e, { debounceMs: 50, onEvent: first.onEvent });
  await w1.add(dir);
  await w1.idle();
  await w1.close();

  assert.equal(first.of("ingested").length, 2);
  assert.ok(first.of("ingested").every((ev) => ev.type === "ingested" && !ev.result.skipped));
  assert.equal((await e.stats()).documents, 2);

  // A fresh watcher over the same unchanged folder is a cheap no-op.
  const second = collector();
  const w2 = new GraphWatcher(e, { debounceMs: 50, onEvent: second.onEvent });
  await w2.add(dir);
  await w2.idle();
  await w2.close();

  assert.equal(second.of("ingested").length, 2);
  assert.ok(second.of("ingested").every((ev) => ev.type === "ingested" && ev.result.skipped));
  assert.equal((await e.stats()).documents, 2);

  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a file created after watching starts is ingested automatically", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  await w.add(dir);

  writeFileSync(join(dir, "new.md"), "[[Billing]] ==bills==> [[Customers]]");
  await waitFor(() => c.of("ingested").length === 1, "the new file to be ingested");

  assert.equal((await e.stats()).documents, 1);
  const [node] = await e.store.findNodesByName("billing");
  assert.ok(node, "entity from the new file reached the graph");

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("rapid successive saves are debounced into one ingest", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 400, onEvent: c.onEvent });
  await w.add(dir);

  const file = join(dir, "notes.md");
  writeFileSync(file, "[[Draft]] v1");
  writeFileSync(file, "[[Draft]] v2");
  writeFileSync(file, "[[Draft]] final version");
  await waitFor(() => c.of("ingested").length >= 1, "the burst of saves to be ingested");
  // Give any straggler event time to (wrongly) trigger a second ingest.
  await new Promise((r) => setTimeout(r, 700));
  await w.idle();

  assert.equal(c.of("ingested").length, 1, "one ingest for the whole burst");
  const docs = await e.store.documentsBySource(file);
  assert.equal(docs.length, 1);

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("editing a file replaces its document instead of piling up copies", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  const file = join(dir, "auth.md");
  writeFileSync(file, "[[Auth Service]] ==uses==> [[OAuth]]");
  await w.add(dir);
  await w.idle();
  const before = await e.store.documentsBySource(file);
  assert.equal(before.length, 1);

  writeFileSync(file, "[[Auth Service]] ==rotates==> [[Tokens]] every 15 minutes");
  await waitFor(() => c.of("ingested").length === 2, "the edited file to be re-ingested");

  const after = await e.store.documentsBySource(file);
  assert.equal(after.length, 1, "still one document for the source");
  assert.notEqual(after[0].hash, before[0].hash, "the document reflects the new content");
  assert.equal((await e.stats()).documents, 1);

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("deleting a file prunes the facts only it supported", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  const file = join(dir, "legacy.md");
  writeFileSync(file, "[[Legacy System]] ==replaced_by==> [[New System]]");
  await w.add(dir);
  await w.idle();
  assert.equal((await e.store.findNodesByName("legacy system")).length, 1);

  rmSync(file);
  await waitFor(() => c.of("deleted").length === 1, "the deletion to be observed");
  await w.idle();

  // The file was the only source for both entities and the relationship, so
  // all of it decays out of the graph.
  assert.equal((await e.store.findNodesByName("legacy system")).length, 0, "entity pruned");
  assert.equal((await e.store.findNodesByName("new system")).length, 0, "entity pruned");
  assert.deepEqual(await e.stats(), { documents: 0, nodes: 0, edges: 0, chunks: 0 });
  assert.equal(c.of("ingested").length, 1, "the delete triggered no ingest");

  const deleted = c.of("deleted")[0];
  assert.ok(deleted.type === "deleted" && deleted.pruned, "delete reports a prune result");
  assert.equal(deleted.pruned.documentsRemoved, 1);
  assert.equal(deleted.pruned.nodesRemoved, 2);
  assert.equal(deleted.pruned.edgesRemoved, 1);

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a shared fact survives when one of its sources is deleted", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  writeFileSync(join(dir, "a.md"), "[[Shared Service]] ==owns==> [[Cache]]");
  writeFileSync(join(dir, "b.md"), "[[Shared Service]] ==owns==> [[Queue]]");
  await w.add(dir);
  await w.idle();
  const shared = (await e.store.findNodesByName("shared service"))[0];
  assert.equal(shared.observations, 2, "seen in both files");

  rmSync(join(dir, "a.md"));
  await waitFor(() => c.of("deleted").length === 1, "the deletion to be observed");
  await w.idle();

  // Shared Service and Queue live on (b.md still asserts them); Cache is gone.
  assert.equal((await e.store.findNodesByName("shared service")).length, 1, "shared entity kept");
  assert.equal((await e.store.findNodesByName("queue")).length, 1);
  assert.equal((await e.store.findNodesByName("cache")).length, 0, "orphaned entity pruned");
  const after = (await e.store.findNodesByName("shared service"))[0];
  assert.equal(after.observations, 1, "confidence decayed to the remaining source");

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a formatting-only save is skipped without re-extraction", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  const file = join(dir, "notes.md");
  writeFileSync(file, "[[Payments]] ==charges==> [[Card]]");
  await w.add(dir);
  await w.idle();
  assert.equal(c.of("ingested").filter((ev) => ev.type === "ingested" && !ev.result.skipped).length, 1);

  // Reformat only: extra spaces, trailing whitespace, blank lines — same content.
  writeFileSync(file, "  [[Payments]]   ==charges==>   [[Card]]  \n\n\n");
  await waitFor(() => c.of("ingested").length === 2, "the reformat to be processed");
  await w.idle();

  const second = c.of("ingested")[1];
  assert.ok(second.type === "ingested" && second.result.skipped, "reformat skipped, no LLM pass");
  assert.equal((await e.stats()).documents, 1, "no new document");
  assert.equal((await e.store.findNodesByName("payments"))[0].observations, 1, "not re-observed");

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a meaningful edit decays facts dropped from the new version", async () => {
  const e = engine();
  await e.ingest("[[Alpha]] ==uses==> [[Beta]]", { source: "spec.md" });
  await e.ingest("[[Alpha]] ==needs==> [[Gamma]]", { source: "spec.md" });

  // Alpha appears in both versions and survives; Beta was dropped and decays;
  // Gamma is new.
  assert.equal((await e.store.findNodesByName("alpha")).length, 1, "kept across versions");
  assert.equal((await e.store.findNodesByName("beta")).length, 0, "dropped fact pruned");
  assert.equal((await e.store.findNodesByName("gamma")).length, 1, "new fact present");
  assert.equal((await e.store.findNodesByName("alpha"))[0].observations, 1, "decayed to the live version");

  const alphaId = (await e.store.findNodesByName("alpha"))[0].id;
  const gammaId = (await e.store.findNodesByName("gamma"))[0].id;
  assert.ok(await e.store.findEdge(alphaId, gammaId, "needs"), "new relationship exists");
  assert.equal((await e.stats()).documents, 1, "still one document for the source");

  await e.close();
});

test("pruning can be disabled, restoring grow-only behavior", async () => {
  const e = new ContextGraphEngine({ dbPath: ":memory:", pruneSuperseded: false, ...fakeProviders() });
  await e.ingest("[[One]] ==links==> [[Two]]", { source: "doc.md" });
  await e.ingest("[[One]] ==links==> [[Three]]", { source: "doc.md" });

  // With pruning off, the superseded "Two" lingers as before.
  assert.equal((await e.store.findNodesByName("two")).length, 1, "stale fact retained when pruning is off");
  assert.equal((await e.store.findNodesByName("three")).length, 1);

  await e.close();
});

test("wrong extensions, oversized files, and skip-dirs are ignored", async () => {
  const dir = tempDir();
  const e = engine();
  const c = collector();
  writeFileSync(join(dir, "keep.md"), "[[Kept]]");
  writeFileSync(join(dir, "skip.log"), "[[Log Noise]]");
  writeFileSync(join(dir, "huge.md"), "x".repeat(1_000_001));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "readme.md"), "[[Vendored]]");

  const w = new GraphWatcher(e, { debounceMs: 50, onEvent: c.onEvent });
  await w.add(dir);
  await w.idle();

  assert.equal(c.of("ingested").length, 1);
  assert.equal((await e.stats()).documents, 1);
  assert.equal((await e.store.findNodesByName("log noise")).length, 0);
  assert.equal((await e.store.findNodesByName("vendored")).length, 0);

  // Live events under a skip-dir are ignored too.
  writeFileSync(join(dir, "node_modules", "later.md"), "[[Vendored Later]]");
  writeFileSync(join(dir, "later.txt"), "[[Arrived Later]]");
  await waitFor(() => c.of("ingested").length === 2, "only the valid live file to be ingested");
  await w.idle();
  assert.equal((await e.store.findNodesByName("vendored later")).length, 0);

  await w.close();
  await e.close();
  rmSync(dir, { recursive: true, force: true });
});

test("the watch registry survives engine restarts", async () => {
  const home = tempDir();
  const dbPath = join(home, "graph.db");
  const notes = join(home, "notes");
  mkdirSync(notes);

  const e1 = new ContextGraphEngine({ dbPath, ...fakeProviders() });
  const added = e1.addWatchedDir(notes, [".md"]);
  assert.equal(added.dir, notes);
  // Re-registering is idempotent and keeps the original timestamp.
  assert.equal(e1.addWatchedDir(notes).addedAt, added.addedAt);
  await e1.close();

  const e2 = new ContextGraphEngine({ dbPath, ...fakeProviders() });
  const listed = e2.listWatchedDirs();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].dir, notes);
  assert.deepEqual(listed[0].extensions, [".md"]);

  assert.equal(e2.removeWatchedDir(notes), true);
  assert.equal(e2.removeWatchedDir(notes), false);
  assert.equal(e2.listWatchedDirs().length, 0);
  await e2.close();

  rmSync(home, { recursive: true, force: true });
});
