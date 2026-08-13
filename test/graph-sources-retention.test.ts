/**
 * `buildGraph`'s `sources` map exists for one consumer: the Tier-2 meaning pass. It was
 * filled unconditionally, so a Tier-1 build — the default, and every pre-query refresh —
 * held the whole repo's text in memory for the length of the build and handed it to a
 * function that returns before reading it. JS strings are UTF-16, so a 200 MB monorepo
 * pinned roughly 400 MB for nothing, on every query that saw drift.
 *
 * The saving itself is invisible from outside, which is exactly why the guarded path
 * needs pinning: the map must still be complete whenever a summarizer IS present, and
 * a Tier-1 build's output must be unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { CruxSummarizer, FileCruxInput, NodeCrux } from "../src/ai/crux.js";
import { tmpRepo } from "./helpers.js";

/** Records exactly what source text the meaning pass was handed, per file. */
class RecordingSummarizer implements CruxSummarizer {
  readonly seen = new Map<string, string>();
  async describeFile(input: FileCruxInput): Promise<NodeCrux[]> {
    this.seen.set(input.path, input.source);
    return input.nodes.map((n) => ({ id: n.id, summary: `about ${n.id}`, crux_start: 0, crux_end: 0 }));
  }
}

function fixture(tag: string): string {
  const d = tmpRepo(tag);
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "a.ts"), "export function alpha(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "src", "b.py"), "def beta():\n    return 2\n");
  return d;
}

test("with a summarizer, every parsed file's source still reaches the meaning pass", async () => {
  const d = fixture("sources-tier2-");
  const summarizer = new RecordingSummarizer();
  await buildGraph(d, { reuse: false, summarizer });

  assert.deepEqual([...summarizer.seen.keys()].sort(), ["src/a.ts", "src/b.py"]);
  assert.match(summarizer.seen.get("src/a.ts")!, /export function alpha/);
  assert.match(summarizer.seen.get("src/b.py")!, /def beta/);

  const graph = readGraph(wiringPath(join(d, "graft")))!;
  assert.ok(
    graph.nodes.some((n) => n.summary_state === "ready" && n.summary?.startsWith("about ")),
    "the summaries really were written",
  );
});

test("a file replayed from the extraction cache still reaches the meaning pass", async () => {
  // The reuse branch has its own `sources.set` — the memo skips the PARSE, never the
  // read — so a Tier-2 build on an already-built repo must summarize just the same.
  const d = fixture("sources-tier2-reuse-");
  await buildGraph(d);
  const summarizer = new RecordingSummarizer();
  const r = await buildGraph(d, { summarizer });
  assert.ok(r.reused > 0, "the second build must actually be replaying from the memo");
  assert.deepEqual([...summarizer.seen.keys()].sort(), ["src/a.ts", "src/b.py"]);
});

test("a Tier-1 build produces the same graph as a Tier-2 one, minus the meaning layer", async () => {
  const plain = fixture("sources-tier1-");
  const enriched = fixture("sources-tier1-ref-");
  const a = await buildGraph(plain, { reuse: false });
  const b = await buildGraph(enriched, { reuse: false, summarizer: new RecordingSummarizer() });

  assert.equal(a.nodes, b.nodes);
  assert.equal(a.edges, b.edges);
  assert.deepEqual(a.byKind, b.byKind);
  assert.deepEqual(a.errors, []);
});
