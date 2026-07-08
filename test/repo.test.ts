import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextGraphEngine, type Summarizer } from "../src/index.js";
import { fakeProviders } from "./helpers.ts";

/** Deterministic summarizer: counts calls, emits bracket markup the BracketExtractor understands. */
class FakeSummarizer implements Summarizer {
  calls: string[] = [];
  async summarize(code: string, opts: { path: string }): Promise<string> {
    this.calls.push(opts.path);
    return `[[${opts.path}]] is a module in this repo. It contains: ${code.trim()}`;
  }
}

function repoFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "cge-repo-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "lib"));
  mkdirSync(join(dir, "node_modules", "leftpad"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(dir, "lib", "c.py"), "c = 3\n");
  writeFileSync(join(dir, "main.ts"), "console.log('hi');\n");
  writeFileSync(join(dir, "notes.md"), "# not code\n"); // ignored: not a code extension
  writeFileSync(join(dir, "node_modules", "leftpad", "index.js"), "junk"); // ignored: skip dir
  return dir;
}

test("ingest replaces a changed document with the same source", async () => {
  const e = new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
  const v1 = await e.ingest("[[Alpha]] version one", { source: "docs/x.md" });
  assert.equal(v1.skipped, false);

  // Identical content → skipped, nothing replaced.
  const again = await e.ingest("[[Alpha]] version one", { source: "docs/x.md" });
  assert.equal(again.skipped, true);
  assert.equal((await e.store.allDocuments()).length, 1);

  // Changed content, same source → old document (and its chunks) replaced.
  const v2 = await e.ingest("[[Alpha]] version two", { source: "docs/x.md" });
  assert.equal(v2.skipped, false);
  const docs = await e.store.allDocuments();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, v2.documentId);
  const chunks = await e.store.allChunks();
  assert.ok(chunks.every((c) => c.documentId === v2.documentId));

  // "inline" sources are exempt — unrelated pastes must not clobber each other.
  await e.ingest("[[Beta]] one thing");
  await e.ingest("[[Gamma]] another thing");
  assert.equal((await e.store.allDocuments()).length, 3);
  await e.close();
});

test("ingestRepo summarizes code files into module documents, incrementally", async () => {
  const dir = repoFixture();
  const summarizer = new FakeSummarizer();
  const e = new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders(), summarizer });
  try {
    const r1 = await e.ingestRepo(dir);
    // 4 code files (a.ts, b.ts, c.py, main.ts) — .md and node_modules excluded.
    assert.equal(r1.files, 4);
    assert.equal(r1.summarized, 4);
    assert.equal(r1.cached, 0);
    assert.deepEqual(r1.errors, []);
    // 3 modules: src, lib, and (root) for main.ts.
    assert.equal(r1.modules.length, 3);
    assert.ok(r1.modules.every((m) => !m.skipped));
    // Summaries flowed through extraction into the graph.
    const nodes = await e.store.findNodesByName(join("src", "a.ts").toLowerCase());
    assert.equal(nodes.length, 1);

    // Unchanged re-run: all cache hits, all module docs skipped by hash dedup.
    const r2 = await e.ingestRepo(dir);
    assert.equal(r2.summarized, 0);
    assert.equal(r2.cached, 4);
    assert.ok(r2.modules.every((m) => m.skipped));
    assert.equal(summarizer.calls.length, 4);

    // Touch one file: only it is re-summarized; only its module re-ingests.
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 42;\n");
    const r3 = await e.ingestRepo(dir);
    assert.equal(r3.summarized, 1);
    assert.equal(r3.cached, 3);
    assert.equal(r3.modules.filter((m) => !m.skipped).length, 1);
    // The changed module document replaced its predecessor (no stale duplicate).
    const srcDocs = (await e.store.allDocuments()).filter((d) => d.source.endsWith("#src"));
    assert.equal(srcDocs.length, 1);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
