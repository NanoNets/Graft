/**
 * `-e` extension validation (#98): a `graft build -e ".vue"` must not silently index
 * nothing — the CLI warns on any extension no parser claims. These test the pure helper
 * the warning is built on: the supported set (depth + breadth) and which inputs fall
 * outside it, including normalization (leading dot optional, case-insensitive).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportedExtensions, unsupportedExtensions } from "../src/graph/source-files.js";

test("supportedExtensions covers both tiers, sorted and de-duped", () => {
  const exts = supportedExtensions();
  // depth tier
  for (const e of [".ts", ".tsx", ".py", ".go", ".java", ".js"]) assert.ok(exts.includes(e), `depth ${e}`);
  // breadth tier
  for (const e of [".rs", ".rb", ".php", ".c", ".cpp", ".kt", ".swift"]) assert.ok(exts.includes(e), `breadth ${e}`);
  // de-duped (.java is in BOTH tiers but must appear once) and sorted
  assert.equal(exts.filter((e) => e === ".java").length, 1, ".java de-duped across tiers");
  assert.deepEqual(exts, [...exts].sort(), "sorted");
});

test("unsupportedExtensions flags only what has no parser (the #98 repro)", () => {
  // .vue is the reported case — no parser → flagged
  assert.deepEqual(unsupportedExtensions([".vue"]), [".vue"]);
  // mixed: supported ones drop out, unsupported stay
  assert.deepEqual(unsupportedExtensions([".ts", ".vue", ".rs", ".svelte"]), [".vue", ".svelte"]);
  // fully-supported input → nothing flagged
  assert.deepEqual(unsupportedExtensions([".ts", ".php", ".c"]), []);
});

test("extension normalization: missing dot and mixed case still match a parser", () => {
  // a user typing `-e vue` or `-e .TS` should be judged on the normalized form
  assert.deepEqual(unsupportedExtensions(["ts"]), [], "no leading dot still recognized");
  assert.deepEqual(unsupportedExtensions([".TS", ".Php"]), [], "case-insensitive");
  assert.deepEqual(unsupportedExtensions(["vue"]), ["vue"], "unsupported without dot still flagged (echoed as given)");
});
