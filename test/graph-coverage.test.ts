/**
 * Unsupported languages must fail LOUDLY (issue #66).
 *
 * On a repo whose code has no Tier-1 parser, "no hits" / "no symbol" /
 * "no definitions" are confident false negatives: they read as facts about the
 * code when they're really gaps in coverage — and the old wording even steered
 * the caller *away* from raw grep, the only tool that would have worked. These
 * tests pin down the honest versions: the build reports what it skipped, the
 * graph records it, and every query surface says "no parser" when that's the
 * real answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { mergeUnindexed, skippedLine, unindexedNote, unsupportedFileNote } from "../src/graph/coverage.js";
import { looseNoteFor, unknownSymbolNote } from "../src/graph/traverse-cli.js";
import { zeroHitNote } from "../src/search/grep-cli.js";
import { skeleton } from "../src/ask/ask.js";
import { mcpInstructions } from "../src/mcp/instructions.js";
import type { GrepResult } from "../src/search/grep.js";

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-coverage-"));
  writeFileSync(join(dir, "a.ts"), "export function hello(): number { return 1; }\n");
  writeFileSync(join(dir, "engine.rs"), "pub fn snap_entity_to_floor() {}\n");
  writeFileSync(join(dir, "enemy_ai.rs"), "pub fn think() {}\n");
  writeFileSync(join(dir, "README.md"), "# not code\n");
  writeFileSync(join(dir, "notes.txt"), "not code either\n");
  return dir;
}

test("build reports code files no parser covers, and records them in the graph", async () => {
  const dir = makeFixture();
  const result = await buildGraph(dir);

  // .rs is code the concept pass would read, but no Tier-1 grammar parses it;
  // .md/.txt are not code and must NOT be counted as skipped.
  assert.deepEqual(result.skipped, [{ ext: ".rs", files: 2 }]);

  const graph = readGraph(wiringPath(join(dir, "graft")));
  assert.deepEqual(graph?.meta.unindexed, [{ ext: ".rs", files: 2 }]);
});

test("a fully supported repo skips nothing and records nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-coverage-clean-"));
  writeFileSync(join(dir, "a.ts"), "export function hello(): number { return 1; }\n");
  const result = await buildGraph(dir);
  assert.deepEqual(result.skipped, []);
  const graph = readGraph(wiringPath(join(dir, "graft")));
  assert.equal(graph?.meta.unindexed, undefined);
});

test("skippedLine says how many files symbol tools will not cover", () => {
  const line = skippedLine([
    { ext: ".h", files: 200 },
    { ext: ".cpp", files: 150 },
  ]);
  assert.ok(line?.includes("350 files"), line ?? "(null)");
  assert.ok(line?.includes("no parser"), line ?? "(null)");
  assert.ok(line?.includes(".h") && line?.includes(".cpp"), line ?? "(null)");
  assert.ok(line?.includes("symbol tools will not cover them"), line ?? "(null)");
  assert.equal(skippedLine([]), null);
});

function emptyGrep(pattern: string): GrepResult {
  return { pattern, filesSearched: 33, totalHits: 0, groups: [], truncated: { files: 0, hits: 0 } };
}

test("zero-hit grep steers TOWARD raw grep when code was never parsed", () => {
  const note = zeroHitNote(emptyGrep("snapEntityToFloor"), [{ ext: ".cpp", files: 350 }]);
  assert.ok(note.includes("350"), note);
  assert.ok(note.includes(".cpp"), note);
  assert.ok(note.includes("no parser"), note);
  assert.ok(note.includes("grep -rn"), note);
  // The old tail told callers indexed search was sufficient — it must not
  // appear when files were skipped.
  assert.ok(!note.includes("only for genuinely unindexed files"), note);

  // With full coverage, the original message survives unchanged.
  const covered = zeroHitNote(emptyGrep("snapEntityToFloor"));
  assert.ok(covered.includes("All indexed code was searched"), covered);
});

test("unknown symbol mentions unparsed files instead of blaming spelling alone", () => {
  const note = unknownSymbolNote("snapEntityToFloor", [{ ext: ".cpp", files: 350 }]);
  assert.ok(note.includes('no symbol "snapEntityToFloor"'), note);
  assert.ok(note.includes(".cpp"), note);
  assert.ok(note.includes("no parser"), note);
  const base = unknownSymbolNote("snapEntityToFloor", undefined);
  assert.ok(base.includes("check spelling"), base);
  assert.ok(!base.includes("no parser"), base);
});

test("unindexedNote is null when everything is covered", () => {
  assert.equal(unindexedNote(undefined), null);
  assert.equal(unindexedNote([]), null);
});

test("mergeUnindexed sums per-extension counts across workspace children", () => {
  const merged = mergeUnindexed([
    [{ ext: ".cpp", files: 2 }],
    undefined,
    [
      { ext: ".cpp", files: 3 },
      { ext: ".rs", files: 1 },
    ],
  ]);
  assert.deepEqual(merged, [
    { ext: ".cpp", files: 5 },
    { ext: ".rs", files: 1 },
  ]);
});

test("skeleton on an unsupported-language file says 'no parser', not 'no definitions'", async () => {
  const dir = makeFixture();
  await buildGraph(dir);

  const rs = skeleton(dir, "enemy_ai.rs");
  assert.ok(rs.note?.includes("no parser"), rs.note);
  assert.equal(rs.entries.length, 0);

  // A supported-language file that simply isn't in the graph keeps the old note.
  const missing = skeleton(dir, "missing.ts");
  assert.ok(missing.note?.includes("no definitions indexed"), missing.note);
});

test("unsupportedFileNote fires only for code-like extensions", () => {
  assert.ok(unsupportedFileNote("src/game/enemy_ai.cpp".replace(".cpp", ".rs"))?.includes("no parser"));
  assert.equal(unsupportedFileNote("src/app.ts"), null); // has a parser
  assert.equal(unsupportedFileNote("README.md"), null); // not code
});

test("callers on a definitions-only language says 'no edge data', not 'no callers'", () => {
  const note = looseNoteFor("in", "step", 1, { edgeless: true });
  assert.ok(note.includes("definitions-only"), note);
  assert.ok(note.includes("graft grep"), note);
  assert.ok(!note.includes("no indexed callers"), note);

  const normal = looseNoteFor("in", "step", 1);
  assert.ok(normal.includes("no indexed callers"), normal);
});

test("MCP instructions scope the 'prefer these tools' claim to indexed languages", () => {
  const scoped = mcpInstructions([{ ext: ".cpp", files: 350 }]);
  assert.ok(scoped.includes(".cpp"), scoped);
  assert.ok(scoped.includes("no parser"), scoped);
  assert.ok(scoped.length < 1600, `stay near the ~1k char budget, got ${scoped.length}`);

  const plain = mcpInstructions();
  assert.ok(!plain.includes("no parser"), plain);
});
