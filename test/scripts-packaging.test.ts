/**
 * Guards the tarball's runtime assets — the ones tsc does not emit and whose
 * absence is SILENT.
 *
 * src/graph/generic.ts looks for its tags.scm queries in dist/graph/queries and
 * then falls back to src/graph/queries, so every test and every dev run finds
 * them whether or not build-viewer.mjs copied anything. An installed user has no
 * src/, gets `loadQuery() -> null`, and the grammar is skipped — generic.ts is
 * explicit that this "degrades to a file node only (never throws)". A release
 * could therefore lose the entire breadth tier without a single error line.
 * These tests drive the checker's pure half with hand-built file lists so the
 * failure mode is reproduced here instead of in someone's install.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_FILES,
  missingFromPack,
  queryFileNames,
} from "../scripts/check-package-contents.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A file list standing in for a healthy `npm pack --json` result. */
function completePack(queries: string[]): string[] {
  return [...REQUIRED_FILES, ...queries.map((q) => `dist/graph/queries/${q}`), "package.json"];
}

test("queryFileNames sees every .scm the breadth tier ships", () => {
  const onDisk = readdirSync(join(repoRoot, "src", "graph", "queries"))
    .filter((f) => f.endsWith(".scm"))
    .sort();
  assert.ok(onDisk.length > 0, "the generic tier has no queries at all — wrong path?");
  assert.deepEqual(queryFileNames(repoRoot), onDisk);
});

test("a complete tarball reports nothing missing", () => {
  assert.deepEqual(missingFromPack(completePack(queryFileNames(repoRoot)), queryFileNames(repoRoot)), []);
});

test("a tarball missing the .scm queries is caught", () => {
  // The exact regression: build-viewer.mjs's copy step stops running, tsc still
  // succeeds, and the breadth tier disappears at runtime with no error.
  const queries = queryFileNames(repoRoot);
  const missing = missingFromPack(REQUIRED_FILES, queries);
  assert.deepEqual(missing, queries.map((q) => `dist/graph/queries/${q}`));
});

test("a PARTIAL query copy is caught too", () => {
  // Parity, not "at least one": a copy loop that dies halfway leaves some
  // grammars working and the rest silently degraded, which is harder to notice
  // than losing all of them.
  const queries = queryFileNames(repoRoot);
  const pack = completePack(queries).filter((f) => !f.endsWith(`/${queries[0]}`));
  assert.deepEqual(missingFromPack(pack, queries), [`dist/graph/queries/${queries[0]}`]);
});

test("a tarball missing the viewer bundle is caught", () => {
  const queries = queryFileNames(repoRoot);
  const pack = completePack(queries).filter((f) => f !== "dist/viewer/app.js");
  assert.deepEqual(missingFromPack(pack, queries), ["dist/viewer/app.js"]);
});

test("the required list covers the assets no tsc run produces", () => {
  // dist/viewer/* and dist/graph/queries/* come from scripts/build-viewer.mjs;
  // if someone trims this list, the check stops checking the only files at risk.
  assert.ok(REQUIRED_FILES.includes("dist/cli.js"));
  assert.ok(REQUIRED_FILES.includes("dist/viewer/app.js"));
  assert.ok(REQUIRED_FILES.includes("dist/viewer/index.html"));
});
